import json
import logging
import sqlite3
from datetime import datetime
from typing import Dict, Any, List, Optional, Tuple

from modules.multitenant import get_tenant, get_agent_config
from modules.tools import registry, ToolRegistry
from modules.rag import search_knowledge_base

logger = logging.getLogger("photoagent.agents")


class BaseSpecialist:
    """Base class for domain-specific agent specialists."""

    def __init__(self, name: str, description: str):
        self.name = name
        self.description = description

    def handle(self, context: Dict[str, Any]) -> Dict[str, Any]:
        raise NotImplementedError


class ReceptionSpecialist(BaseSpecialist):
    """
    Handles triage, general greeting, friendly inquiries, and
    enforces strict friend/family filtering (NO SALES PITCH TO FRIENDS/FAMILY).
    """

    def __init__(self):
        super().__init__("reception", "Recepção, triagem de contatos e dúvidas institucionais.")

    def handle(self, context: Dict[str, Any]) -> Dict[str, Any]:
        contact = context.get("contact", {})
        tipo = contact.get("tipo", "cliente")
        client_name = contact.get("nome") or contact.get("name") or ""
        msg_text = context.get("message_text", "")

        # 1. Filtro estrito de Amigo / Família
        if tipo in ("amigo", "familia"):
            saudacao = f"Oi {client_name}!" if client_name else "Oi!"
            reply = f"{saudacao} Tudo bem? Aqui é a Bruna do estúdio. O Gustavo tá em ensaio no momento! Quer deixar algum recado pra ele que eu já anoto aqui?"
            return {
                "specialist": self.name,
                "reply": reply,
                "action": "friend_family_handled",
                "should_sell": False
            }

        # 2. Fornecedor / Spam
        if tipo == "fornecedor":
            return {
                "specialist": self.name,
                "reply": "Olá! Sou a Bruna, secretária do estúdio. Se for proposta de fornecimento ou parceria comercial, por favor envie por e-mail ou deixe os detalhes por aqui que repasso ao Gustavo.",
                "action": "supplier_handled",
                "should_sell": False
            }

        # 3. Cliente novo ou recorrente
        msg_lower = msg_text.lower()
        if "gestante" in msg_lower or "familia" in msg_lower or "família" in msg_lower:
            saudacao_cliente = f"Olá {client_name}! Sou a Bruna, secretária virtual do Gustavo Alves Fotografia 😊" if client_name else "Olá! Sou a Bruna, secretária virtual do Gustavo Alves Fotografia 😊"
            reply = f"{saudacao_cliente} Fazemos sim! Temos ensaios especiais de gestante e família com todo carinho. Gostaria de conhecer nossas opções e pacotes?"
        else:
            saudacao_cliente = f"Oi {client_name}! Que bom falar com você de novo 😊" if client_name else "Olá! Sou a Bruna, secretária virtual do Gustavo Alves Fotografia 😊"
            reply = f"{saudacao_cliente} Em que posso te ajudar hoje? Temos pacotes para casamentos, ensaios de gestante e família!"

        return {
            "specialist": self.name,
            "reply": reply,
            "action": "reception_greeted",
            "should_sell": True
        }


class CommercialSpecialist(BaseSpecialist):
    """
    Qualifies leads, explains packages, manages sales funnel, and
    handles objections while strictly honoring official pricing and discounts.
    """

    def __init__(self):
        super().__init__("commercial", "Qualificação de noivas/clientes e negociação orientada a valor.")

    def handle(self, context: Dict[str, Any]) -> Dict[str, Any]:
        msg_lower = context.get("message_text", "").lower()
        contact = context.get("contact", {})
        client_name = contact.get("nome") or contact.get("name") or "Noiva"
        conn = context["conn"]
        tenant_id = context["tenant_id"]

        # Objeção de desconto
        if any(w in msg_lower for w in ["desconto", "mais barato", "abaixar", "faz por menos", "choro"]):
            return {
                "specialist": self.name,
                "reply": f"Entendo perfeitamente, {client_name}! Os valores do Gustavo são calculados para garantir uma equipe de 2 a 3 fotógrafos profissionais de altíssimo nível, tratamento minucioso de cada foto e galeria online protegida. O que conseguimos fazer de melhor é parcelar a entrada e facilitar o saldo até 10 dias antes do seu evento. O que acha de agendarmos uma conversa rápida com o Gustavo?",
                "action": "objection_handled"
            }

        # Apresentação do menu humanizado com pacotes reais do PDF
        saudacao = f"Que alegria falar com você, {client_name}! ✨\n\n" if client_name and client_name not in ("Noiva", "Cliente") else ""
        reply = (
            f"{saudacao}"
            f"Trabalhamos com 3 opções principais de cobertura para casamentos, todas com padrão impecável:\n\n"
            f"💍 1. Essencial — R$ 7.500\n"
            f"• 09h de cobertura • 2 Fotógrafos • 800+ fotos tratadas • Galeria por 60 dias\n\n"
            f"🌟 2. Premium — R$ 8.800 (Mais contratado)\n"
            f"• 10h de cobertura • 2 Fotógrafos • 1.000+ fotos • Ensaio Pré-casamento (2h) incluso\n\n"
            f"👑 3. Black — R$ 11.350\n"
            f"• 10h de cobertura • 3 Fotógrafos (1 dedicado para decoração/família) • 2.000+ fotos • Casamento Civil + Pré-casamento (3h) • Quadro 25x30 e foto 10x15\n\n"
            f"Se preferir adicionar álbum ou ensaio avulso, também temos opções personalizadas. Qual dessas opções faz mais sentido para o seu sonho?"
        )
        # Atualiza etapa do CRM para 'em_atendimento'
        phone = contact.get("phone") or contact.get("wa_id")
        if phone:
            registry.execute("atualizar_etapa_funil", conn, tenant_id, {
                "contact_wa_id": phone,
                "status": "em_atendimento"
            })

        return {
            "specialist": self.name,
            "reply": reply,
            "action": "packages_presented"
        }


class BudgetSpecialist(BaseSpecialist):
    """
    Computes deterministic, accurate quotes based on the official PDF price lists.
    NEVER hallucinate numbers or discounts.
    """

    def __init__(self):
        super().__init__("budget", "Cálculo determinístico de orçamentos e propostas personalizadas.")

    def handle(self, context: Dict[str, Any]) -> Dict[str, Any]:
        conn = context["conn"]
        tenant_id = context["tenant_id"]
        msg_lower = context.get("message_text", "").lower()

        pacote = "premium"
        if "black" in msg_lower:
            pacote = "black"
        elif "essencial" in msg_lower:
            pacote = "essencial"

        extras = []
        if "album" in msg_lower or "álbum" in msg_lower:
            extras.append("album_25x30_caixa")
        if "civil" in msg_lower and pacote != "black":
            extras.append("civil_avulso")
        if "pre" in msg_lower or "pré" in msg_lower:
            if pacote == "essencial":
                extras.append("pre_wedding_avulso")

        res = registry.execute("calcular_orcamento", conn, tenant_id, {
            "pacote_id": pacote,
            "adicionais": extras
        })

        if not res.get("ok"):
            return {
                "specialist": self.name,
                "reply": "Não consegui calcular o orçamento agora. Vou repassar suas preferências para o Gustavo entrar em contato!",
                "action": "calc_error"
            }

        calc = res["result"]
        detalhes_itens = "\n".join([f"• {it['item']}: R$ {it['valor']:,.2f}".replace(",", "X").replace(".", ",").replace("X", ".") for it in calc["itens"]])

        reply = (
            f"Montei uma proposta personalizada para você:\n\n"
            f"{detalhes_itens}\n\n"
            f"💰 Valor Total: R$ {calc['valor_total']:,.2f}\n".replace(",", "X").replace(".", ",").replace("X", ".") +
            f"💳 Condições: {calc['condicoes_pagamento']}\n\n"
            f"Deseja que eu reserve uma data preliminar na agenda para conversarem?"
        )
        return {
            "specialist": self.name,
            "reply": reply,
            "action": "quote_calculated",
            "calculation": calc
        }


class SchedulerSpecialist(BaseSpecialist):
    """
    Manages atomic schedule lookup and booking with anti-duplication locks (UNIQUE + BEGIN IMMEDIATE).
    """

    def __init__(self):
        super().__init__("scheduler", "Gestão de disponibilidade, agendamentos e reagendamentos sem duplicidade.")

    def handle(self, context: Dict[str, Any]) -> Dict[str, Any]:
        conn = context["conn"]
        tenant_id = context["tenant_id"]
        contact = context.get("contact", {})
        client_phone = contact.get("phone") or contact.get("wa_id") or "55000000000"

        # Consulta slots livres
        res = registry.execute("consultar_disponibilidade", conn, tenant_id, {})
        slots = res.get("result", {}).get("disponiveis", [])

        if not slots:
            return {
                "specialist": self.name,
                "reply": "No momento não temos horários abertos no calendário imediato, mas posso verificar com o Gustavo uma data de encaixe para você!",
                "action": "no_slots"
            }

        opcoes = []
        for s in slots[:3]:
            dt = s["start_at"]
            opcoes.append(f"• Código #{s['id']}: {dt}")

        reply = (
            f"Tenho os seguintes horários disponíveis na agenda do estúdio:\n\n"
            f"{chr(10).join(opcoes)}\n\n"
            f"Qual desses horários fica melhor para você? Basta me responder com o dia ou o código do horário!"
        )
        return {
            "specialist": self.name,
            "reply": reply,
            "action": "slots_offered",
            "slots": slots[:3]
        }


class PostSaleSpecialist(BaseSpecialist):
    """
    Tracks session editing, deadlines, Instagram previews, and
    post-event feedback reviews (1 day after event).
    """

    def __init__(self):
        super().__init__("post_sale", "Pós-venda, prazos de entrega de fotos, prévias no Instagram e avaliação.")

    def handle(self, context: Dict[str, Any]) -> Dict[str, Any]:
        msg_lower = context.get("message_text", "").lower()
        contact = context.get("contact", {})
        client_phone = contact.get("phone") or contact.get("wa_id")

        if "prazo" in msg_lower or "entrega" in msg_lower or "quando fica pronto" in msg_lower or "dias" in msg_lower:
            return {
                "specialist": self.name,
                "reply": "O prazo padrão para envio das primeiras prévias é de 48h, e a galeria completa tratada com todas as fotos é entregue em até 45 dias úteis. Todo o processo pode ser acompanhado pelo nosso painel!",
                "action": "timeline_explained"
            }

        if "previa" in msg_lower or "prévia" in msg_lower:
            return {
                "specialist": self.name,
                "reply": "Sua prévia fotográfica já está sendo separada pelo Gustavo! O prazo padrão de prévias é de 48h. Assim que ele postar no Instagram @gustavoalvsfotografia, eu te envio o link direto por aqui!",
                "action": "preview_requested"
            }

        # Avaliação pós-ensaio
        tenant = context.get("tenant", {})
        google_url = tenant.get("google_review_url") or "https://g.page/r/gustavoalvsfotografia/review"
        ig_url = tenant.get("instagram_url") or "https://instagram.com/gustavoalvsfotografia"

        reply = (
            f"Oi! Foi incrível fotografar seu momento ontem! ✨\n"
            f"Poderia nos ajudar deixando uma rápida avaliação no Google? Significa muito para nós:\n"
            f"{google_url}\n\n"
            f"E marque a gente no Instagram: {ig_url} 📸"
        )
        return {
            "specialist": self.name,
            "reply": reply,
            "action": "review_requested"
        }


class SupervisorAgent:
    """
    Master Supervisor: Interprets incoming user intent, loads customer memory,
    routes to appropriate specialist, executes tool calling, and consolidates
    natural language responses.
    """

    def __init__(self):
        self.reception = ReceptionSpecialist()
        self.commercial = CommercialSpecialist()
        self.budget = BudgetSpecialist()
        self.scheduler = SchedulerSpecialist()
        self.post_sale = PostSaleSpecialist()

    def process_message(
        self,
        conn: sqlite3.Connection,
        tenant_id: str,
        phone: str,
        message_text: str,
        client_name: Optional[str] = None
    ) -> Tuple[str, Dict[str, Any]]:
        """
        Processes an incoming customer message end-to-end.
        """
        # 1. Recupera ou registra na memória persistente do cliente
        res_cli = registry.execute("consultar_cliente", conn, tenant_id, {"phone": phone})
        contact = res_cli.get("result", {})
        if not contact.get("encontrado"):
            registry.execute("registrar_cliente", conn, tenant_id, {
                "phone": phone,
                "nome": client_name or "Cliente",
                "tipo": "cliente"
            })
            contact = {
                "encontrado": True,
                "phone": phone,
                "nome": client_name or "Cliente",
                "tipo": "cliente",
                "total_conversas": 1
            }

        tenant = get_tenant(conn, tenant_id) or {}
        agent_cfg = get_agent_config(conn, tenant_id) or {}

        context = {
            "conn": conn,
            "tenant_id": tenant_id,
            "tenant": tenant,
            "agent_config": agent_cfg,
            "contact": contact,
            "message_text": message_text
        }

        msg_lower = message_text.lower().strip()

        # 2. Transferência para Atendimento Humano
        if any(term in msg_lower for term in [
            "falar com fotografo", "falar com fotógrafo", "falar com o fotografo", "falar com o fotógrafo",
            "falar com humano", "falar com o humano", "atendente humano", "falar com gustavo", "falar com o gustavo",
            "gustavo alves", "dúvida séria", "duvida seria", "reclamação", "reclamacao", "insatisfeito", "insatisfeita"
        ]):
            c = conn.cursor()
            c.execute("UPDATE studios SET status = 'WAITING_HUMAN' WHERE id = ?", (tenant_id,))
            c.execute("""
                INSERT OR REPLACE INTO waiting_queue (client_phone, wa_id, studio_id, client_name, status, waiting_since, message_content)
                VALUES (?, ?, ?, ?, 'WAITING_HUMAN', ?, ?)
            """, (phone, phone, tenant_id, client_name or "Cliente", datetime.now().timestamp(), message_text))
            conn.commit()
            return (
                "Com certeza! Já notifiquei o Gustavo aqui. Vou pausar o atendimento automático temporariamente para que ele continue diretamente com você em instantes! 🙏",
                {"specialist": "human_handoff", "status": "WAITING_HUMAN"}
            )

        # 3. Roteamento de Especialista pelo Supervisor
        tipo = contact.get("tipo", "cliente")
        if tipo in ("amigo", "familia", "fornecedor"):
            res = self.reception.handle(context)
            return res["reply"], res

        # Intenção de recepção / dúvidas sobre nichos específicos (gestante, família)
        if any(w in msg_lower for w in ["gestante", "familia", "família", "newborn"]) and not any(w in msg_lower for w in ["quanto custa", "preço", "preco", "orçamento", "orcamento"]):
            res = self.reception.handle(context)
            return res["reply"], res

        # Intenção de pós-venda (prévia, fotos prontas, avaliação)
        if any(w in msg_lower for w in ["previa", "prévia", "prazo", "fotos prontas", "entrega", "avaliacao", "avaliação"]):
            res = self.post_sale.handle(context)
            return res["reply"], res

        # Intenção de orçamento detalhado ou cálculo com adicionais
        if any(w in msg_lower for w in ["calcular", "com album", "com álbum", "adicionar", "quanto fica com"]):
            res = self.budget.handle(context)
            return res["reply"], res

        # Intenção de agenda / data / horários
        if any(w in msg_lower for w in ["agendar", "horario", "horário", "disponivel", "disponível", "data", "quando tem"]):
            res = self.scheduler.handle(context)
            return res["reply"], res

        # Intenção comercial de pacotes e valores gerais
        if any(w in msg_lower for w in ["preço", "preco", "valor", "pacote", "quanto custa", "casamento", "ensaio"]):
            res = self.commercial.handle(context)
            return res["reply"], res

        # Padrão: Recepção / Boas-vindas
        res = self.reception.handle(context)
        return res["reply"], res
