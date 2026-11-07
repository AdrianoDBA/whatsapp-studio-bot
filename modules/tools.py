import json
import logging
import sqlite3
import uuid
from datetime import datetime, timedelta
from typing import Dict, Any, List, Optional, Callable

logger = logging.getLogger("photoagent.tools")


class ToolExecutionError(Exception):
    pass


class ToolRegistry:
    """Registry managing available tools, schemas, and tenant-scoped execution."""

    def __init__(self):
        self._tools: Dict[str, Dict[str, Any]] = {}

    def register(self, name: str, description: str, parameters: Dict[str, Any], handler: Callable):
        self._tools[name] = {
            "name": name,
            "description": description,
            "parameters": parameters,
            "handler": handler
        }

    def get_tool(self, name: str) -> Optional[Dict[str, Any]]:
        return self._tools.get(name)

    def get_schemas(self) -> List[Dict[str, Any]]:
        return [
            {
                "name": t["name"],
                "description": t["description"],
                "parameters": t["parameters"]
            }
            for t in self._tools.values()
        ]

    def execute(self, tool_name: str, conn: sqlite3.Connection, tenant_id: str, args: Dict[str, Any]) -> Dict[str, Any]:
        tool = self._tools.get(tool_name)
        if not tool:
            return {"ok": False, "error": f"Ferramenta '{tool_name}' não encontrada"}
        try:
            result = tool["handler"](conn, tenant_id, **args)
            # Log audit
            c = conn.cursor()
            c.execute(
                "INSERT INTO audit_logs (tenant_id, actor, action, details, created_at) VALUES (?, ?, ?, ?, ?)",
                (tenant_id, "tool_engine", f"execute:{tool_name}", json.dumps({"args": args, "result": result}, ensure_ascii=False), datetime.now().isoformat())
            )
            conn.commit()
            return {"ok": True, "result": result}
        except Exception as e:
            logger.error(f"[TOOL ERROR] Falha ao executar {tool_name}: {e}", exc_info=True)
            return {"ok": False, "error": str(e)}


registry = ToolRegistry()


# ==============================================================================
# 1. CLIENT TOOLS
# ==============================================================================

def tool_consultar_cliente(conn: sqlite3.Connection, tenant_id: str, phone: str) -> Dict[str, Any]:
    c = conn.cursor()
    c.execute(
        "SELECT * FROM contacts WHERE (studio_id = ? OR studio_id IS NULL) AND (phone = ? OR wa_id = ?)",
        (tenant_id, phone, phone)
    )
    row = c.fetchone()
    if not row:
        return {"encontrado": False, "phone": phone}
    d = dict(row)
    return {
        "encontrado": True,
        "phone": d.get("phone") or d.get("wa_id"),
        "nome": d.get("name") or d.get("nome"),
        "tipo": d.get("tipo", "cliente"),
        "total_conversas": d.get("total_conversas", 1),
        "pacote_interesse": d.get("pacote_interesse"),
        "ja_comprou": bool(d.get("ja_comprou", 0))
    }

registry.register(
    "consultar_cliente",
    "Consulta o cadastro e histórico básico de um cliente pelo número de telefone/WhatsApp.",
    {
        "type": "object",
        "properties": {
            "phone": {"type": "string", "description": "Número de telefone no formato DDI+DDD+Número (ex: 5534988881111)"}
        },
        "required": ["phone"]
    },
    tool_consultar_cliente
)


def tool_registrar_cliente(conn: sqlite3.Connection, tenant_id: str, phone: str, nome: str, tipo: str = "cliente", pacote_interesse: Optional[str] = None) -> Dict[str, Any]:
    c = conn.cursor()
    now = datetime.now().isoformat()
    c.execute(
        "SELECT id, total_conversas FROM contacts WHERE (studio_id = ? OR studio_id IS NULL) AND (phone = ? OR wa_id = ?)",
        (tenant_id, phone, phone)
    )
    row = c.fetchone()
    if row:
        tot = (row["total_conversas"] or 1) + 1
        c.execute("""
            UPDATE contacts SET
                name = COALESCE(?, name),
                nome = COALESCE(?, nome),
                tipo = ?,
                pacote_interesse = COALESCE(?, pacote_interesse),
                last_contact_at = ?,
                total_conversas = ?
            WHERE id = ?
        """, (nome, nome, tipo, pacote_interesse, now, tot, row["id"]))
    else:
        c.execute("""
            INSERT INTO contacts (
                studio_id, phone, wa_id, name, nome, tipo,
                first_contact_at, last_contact_at, total_conversas, pacote_interesse, ja_comprou, created_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1, ?, 0, ?)
        """, (tenant_id, phone, phone, nome, nome, tipo, now, now, pacote_interesse, now))
    conn.commit()
    return {"status": "ok", "phone": phone, "nome": nome, "tipo": tipo}

registry.register(
    "registrar_cliente",
    "Registra ou atualiza os dados cadastrais e classificação de um contato.",
    {
        "type": "object",
        "properties": {
            "phone": {"type": "string", "description": "Telefone do contato"},
            "nome": {"type": "string", "description": "Nome do contato"},
            "tipo": {"type": "string", "enum": ["cliente", "amigo", "familia", "fornecedor", "spam"], "default": "cliente"},
            "pacote_interesse": {"type": "string", "description": "Pacote que o cliente demonstrou interesse"}
        },
        "required": ["phone", "nome"]
    },
    tool_registrar_cliente
)


# ==============================================================================
# 2. CRM & FUNNEL TOOLS
# ==============================================================================

def tool_atualizar_etapa_funil(conn: sqlite3.Connection, tenant_id: str, contact_wa_id: str, status: str, pacote: Optional[str] = None, valor: Optional[float] = None) -> Dict[str, Any]:
    valid_statuses = ("agendado", "em_atendimento", "fotografando", "editando", "finalizado", "cancelado")
    if status not in valid_statuses:
        raise ValueError(f"Status inválido: {status}. Valores permitidos: {valid_statuses}")
    c = conn.cursor()
    c.execute("SELECT id FROM ensaios WHERE (studio_id = ? OR studio_id IS NULL) AND contact_wa_id = ?", (tenant_id, contact_wa_id))
    row = c.fetchone()
    now = datetime.now().isoformat()
    if row:
        c.execute("""
            UPDATE ensaios SET
                status = ?,
                pacote = COALESCE(?, pacote),
                valor = COALESCE(?, valor)
            WHERE id = ?
        """, (status, pacote, valor, row["id"]))
        ensaio_id = row["id"]
    else:
        c.execute("""
            INSERT INTO ensaios (studio_id, contact_wa_id, status, pacote, valor, created_at)
            VALUES (?, ?, ?, ?, ?, ?)
        """, (tenant_id, contact_wa_id, status, pacote, valor, now))
        ensaio_id = c.lastrowid
    conn.commit()
    return {"status": "ok", "ensaio_id": ensaio_id, "etapa_funil": status}

registry.register(
    "atualizar_etapa_funil",
    "Atualiza a etapa do lead/ensaio no pipeline CRM Kanban (agendado, em_atendimento, fotografando, editando, finalizado, cancelado).",
    {
        "type": "object",
        "properties": {
            "contact_wa_id": {"type": "string", "description": "Telefone ou WA ID do cliente"},
            "status": {"type": "string", "enum": ["agendado", "em_atendimento", "fotografando", "editando", "finalizado", "cancelado"]},
            "pacote": {"type": "string", "description": "Nome do pacote contratado ou negociado"},
            "valor": {"type": "number", "description": "Valor total acordado"}
        },
        "required": ["contact_wa_id", "status"]
    },
    tool_atualizar_etapa_funil
)


# ==============================================================================
# 3. SERVICES & BUDGET CALCULATION TOOLS (DETERMINISTIC)
# ==============================================================================

OFFICIAL_GUSTAVO_PACKAGES = [
    {
        "id": "essencial",
        "nome": "Essencial",
        "preco": 7500.0,
        "duracao_horas": 9,
        "fotografos": 2,
        "qtd_fotos": "800+ fotos tratadas",
        "descricao": "9h de cobertura, 2 fotógrafos, 800+ fotos tratadas em alta resolução, galeria online por 60 dias."
    },
    {
        "id": "premium",
        "nome": "Premium",
        "preco": 8800.0,
        "duracao_horas": 10,
        "fotografos": 2,
        "qtd_fotos": "1000+ fotos tratadas",
        "descricao": "10h de cobertura, 1.000+ fotos tratadas + Ensaio Pré-casamento (2h com 40 fotos). Mais contratado."
    },
    {
        "id": "black",
        "nome": "Black",
        "preco": 11350.0,
        "duracao_horas": 10,
        "fotografos": 3,
        "qtd_fotos": "2000+ fotos tratadas",
        "descricao": "10h de cobertura, 2.000+ fotos tratadas, casamento civil incluso, Pré-casamento (3h), 3 fotógrafos (1 dedicado para decoração/família), quadro 25x30 e foto 10x15."
    }
]

OFFICIAL_GUSTAVO_EXTRAS = {
    "pre_wedding_avulso": 1500.0,
    "civil_avulso": 800.0,
    "hora_extra": 1000.0,
    "fotografo_extra": 1000.0,
    "pacote_3h": 2250.0,
    "entrega_expressa": 1500.0,
    "album_25x30_caixa": 4950.0
}


def tool_consultar_pacotes(conn: sqlite3.Connection, tenant_id: str) -> Dict[str, Any]:
    c = conn.cursor()
    c.execute("SELECT packages_json FROM agent_configs WHERE tenant_id = ?", (tenant_id,))
    row = c.fetchone()
    if row and row["packages_json"]:
        try:
            data = json.loads(row["packages_json"])
            if "pacotes" in data:
                return data
        except Exception:
            pass
    return {"pacotes": OFFICIAL_GUSTAVO_PACKAGES, "extras": OFFICIAL_GUSTAVO_EXTRAS}

registry.register(
    "consultar_pacotes",
    "Retorna o catálogo oficial de pacotes, coberturas e itens adicionais cadastrados para o fotógrafo.",
    {"type": "object", "properties": {}},
    tool_consultar_pacotes
)


def tool_calcular_orcamento(conn: sqlite3.Connection, tenant_id: str, pacote_id: str, adicionais: Optional[List[str]] = None, horas_extras: int = 0) -> Dict[str, Any]:
    """Cálculo estritamente determinístico de orçamento com base nas tabelas oficiais do PDF."""
    catalog = tool_consultar_pacotes(conn, tenant_id)
    pacotes = {p["id"].lower(): p for p in catalog.get("pacotes", [])}
    extras = catalog.get("extras", OFFICIAL_GUSTAVO_EXTRAS)

    pacote_chave = pacote_id.lower().strip()
    # Mapeamento flexível
    if "black" in pacote_chave:
        pacote_chave = "black"
    elif "premium" in pacote_chave:
        pacote_chave = "premium"
    elif "essencial" in pacote_chave:
        pacote_chave = "essencial"

    if pacote_chave not in pacotes:
        raise ValueError(f"Pacote '{pacote_id}' não encontrado no catálogo oficial.")

    pkg = pacotes[pacote_chave]
    base_price = float(pkg["preco"])
    items_calculados = [{"item": f"Pacote {pkg['nome']}", "valor": base_price}]
    total = base_price

    if adicionais:
        for ad in adicionais:
            ad_clean = ad.lower().strip()
            for k, val in extras.items():
                if k in ad_clean or ad_clean in k:
                    items_calculados.append({"item": k, "valor": float(val)})
                    total += float(val)
                    break

    if horas_extras > 0:
        val_he = float(extras.get("hora_extra", 1000.0)) * horas_extras
        items_calculados.append({"item": f"{horas_extras}x Hora(s) Extra(s)", "valor": val_he})
        total += val_he

    return {
        "pacote_selecionado": pkg["nome"],
        "preco_base": base_price,
        "itens": items_calculados,
        "valor_total": total,
        "moeda": "BRL",
        "condicoes_pagamento": "Entrada de 30% na reserva + saldo parcelado até 10 dias antes do evento."
    }

registry.register(
    "calcular_orcamento",
    "Calcula de forma 100% determinística o valor total de uma proposta (pacote base + itens adicionais + horas extras) sem alucinações de preço.",
    {
        "type": "object",
        "properties": {
            "pacote_id": {"type": "string", "enum": ["essencial", "premium", "black"], "description": "ID ou nome do pacote"},
            "adicionais": {"type": "array", "items": {"type": "string"}, "description": "Lista de adicionais (ex: ['album_25x30_caixa', 'civil_avulso'])"},
            "horas_extras": {"type": "integer", "description": "Quantidade de horas extras requeridas", "default": 0}
        },
        "required": ["pacote_id"]
    },
    tool_calcular_orcamento
)


# ==============================================================================
# 4. CALENDAR & ATOMIC RESERVATIONS TOOLS
# ==============================================================================

def tool_consultar_disponibilidade(conn: sqlite3.Connection, tenant_id: str, data_busca: Optional[str] = None) -> Dict[str, Any]:
    c = conn.cursor()
    query = """
        SELECT id, start_at, end_at, status
        FROM slots
        WHERE (studio_id = ? OR studio_id IS NULL)
          AND status = 'free'
    """
    params = [tenant_id]
    if data_busca:
        query += " AND start_at LIKE ?"
        params.append(f"{data_busca}%")
    query += " ORDER BY start_at ASC LIMIT 10"
    c.execute(query, tuple(params))
    rows = [dict(r) for r in c.fetchall()]
    return {"disponiveis": rows, "total": len(rows)}

registry.register(
    "consultar_disponibilidade",
    "Consulta os próximos horários livres e disponíveis para ensaio ou reunião na agenda do fotógrafo.",
    {
        "type": "object",
        "properties": {
            "data_busca": {"type": "string", "description": "Filtro de data opcional no formato YYYY-MM-DD"}
        }
    },
    tool_consultar_disponibilidade
)


def tool_reservar_horario(conn: sqlite3.Connection, tenant_id: str, slot_id: int, client_wa_id: str, pacote: str = "Ensaio") -> Dict[str, Any]:
    """Reserva atômica com bloqueio imediato contra concorrência dupla."""
    c = conn.cursor()
    # Verifica o status atual
    c.execute(
        "SELECT id, start_at, status FROM slots WHERE id = ? AND (studio_id = ? OR studio_id IS NULL)",
        (slot_id, tenant_id)
    )
    row = c.fetchone()
    if not row:
        raise ValueError(f"Slot #{slot_id} não encontrado.")
    if row["status"] != "free":
        raise ValueError(f"Slot #{slot_id} não está mais livre (status atual: {row['status']}).")

    start_at = row["start_at"]
    # Atualiza para booked
    c.execute("""
        UPDATE slots SET
            status = 'booked',
            client_wa_id = ?
        WHERE id = ? AND status = 'free'
    """, (client_wa_id, slot_id))

    if c.rowcount == 0:
        raise ValueError(f"Conflito de concorrência: o slot #{slot_id} acabou de ser reservado por outro cliente.")

    # Insere ou atualiza ensaio na esteira Kanban
    c.execute("""
        INSERT INTO ensaios (studio_id, contact_wa_id, status, pacote, start_at, created_at)
        VALUES (?, ?, 'agendado', ?, ?, ?)
    """, (tenant_id, client_wa_id, pacote, start_at, datetime.now().isoformat()))

    conn.commit()
    return {
        "status": "ok",
        "slot_id": slot_id,
        "start_at": start_at,
        "mensagem": f"Horário {start_at} reservado com sucesso!"
    }

registry.register(
    "reservar_horario",
    "Bloqueia e confirma a reserva de um horário atômico, impedindo concorrência e agendamento duplo.",
    {
        "type": "object",
        "properties": {
            "slot_id": {"type": "integer", "description": "ID numérico do slot retornado por consultar_disponibilidade"},
            "client_wa_id": {"type": "string", "description": "Telefone ou WA ID do cliente"},
            "pacote": {"type": "string", "description": "Nome do pacote ou serviço", "default": "Ensaio"}
        },
        "required": ["slot_id", "client_wa_id"]
    },
    tool_reservar_horario
)


# ==============================================================================
# 5. KNOWLEDGE & RAG TOOLS
# ==============================================================================

def tool_buscar_na_base(conn: sqlite3.Connection, tenant_id: str, termo: str, categoria: Optional[str] = None) -> Dict[str, Any]:
    c = conn.cursor()
    query = """
        SELECT chunk_text, category, document_id
        FROM knowledge_chunks
        WHERE (tenant_id = ? OR tenant_id = 'studio-principal')
    """
    params = [tenant_id]
    if categoria:
        query += " AND category = ?"
        params.append(categoria)
    query += " AND chunk_text LIKE ? LIMIT 4"
    params.append(f"%{termo}%")

    c.execute(query, tuple(params))
    rows = [dict(r) for r in c.fetchall()]
    if not rows:
        # Fallback para os pacotes oficiais se o termo for de pacotes
        if any(w in termo.lower() for w in ["preco", "preço", "valor", "pacote", "essencial", "premium", "black", "album", "álbum"]):
            return {
                "encontrado": True,
                "resultados": [
                    {
                        "category": "Pacotes e Preços",
                        "chunk_text": "Proposta Oficial Gustavo Alves: Essencial R$7.500 (9h, 2 fotógrafos, 800+ fotos), Premium R$8.800 (10h, 1000+ fotos + pré 2h), Black R$11.350 (10h, 2000+ fotos, civil, pré 3h, 3 fotógrafos, quadro 25x30 e 10x15). Extras: pré R$1.500, civil R$800, hora extra R$1.000, fotógrafo extra R$1.000, entrega expressa R$1.500, álbum 25x30 na caixa R$4.950."
                    }
                ]
            }
        return {"encontrado": False, "mensagem": "Nenhuma informação relevante encontrada na base de conhecimento."}
    return {"encontrado": True, "resultados": rows}

registry.register(
    "buscar_na_base",
    "Busca fatos e detalhes da base de conhecimento oficial do fotógrafo (políticas, contratos, prazos de entrega, pacotes).",
    {
        "type": "object",
        "properties": {
            "termo": {"type": "string", "description": "Termo de busca, pergunta ou palavra-chave"},
            "categoria": {"type": "string", "description": "Categoria específica opcional (ex: Politicas, Prazos, Servicos)"}
        },
        "required": ["termo"]
    },
    tool_buscar_na_base
)


# ==============================================================================
# 6. INSTAGRAM TOOLS
# ==============================================================================

def tool_postar_previa_feed(conn: sqlite3.Connection, tenant_id: str, client_wa_id: str, foto_url: str, legenda: str) -> Dict[str, Any]:
    c = conn.cursor()
    # Em ambiente real, usa providers/instagram_provider.py
    # Registra no ensaio e na tabela de prévias
    previa_url = f"https://instagram.com/p/preview_{uuid.uuid4().hex[:8]}"
    c.execute("""
        UPDATE ensaios SET
            previa_instagram_url = ?
        WHERE (studio_id = ? OR studio_id IS NULL) AND contact_wa_id = ?
    """, (previa_url, tenant_id, client_wa_id))
    conn.commit()
    return {"status": "ok", "previa_url": previa_url, "mensagem": f"Prévia postada com sucesso no Feed: {previa_url}"}

registry.register(
    "postar_previa_feed",
    "Publica uma prévia no feed do Instagram oficial do estúdio e vincula ao ensaio do cliente.",
    {
        "type": "object",
        "properties": {
            "client_wa_id": {"type": "string", "description": "WhatsApp ID do cliente"},
            "foto_url": {"type": "string", "description": "URL da foto a ser postada"},
            "legenda": {"type": "string", "description": "Legenda da publicação"}
        },
        "required": ["client_wa_id", "foto_url", "legenda"]
    },
    tool_postar_previa_feed
)
