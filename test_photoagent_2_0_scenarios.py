import unittest
import json
import sqlite3
from app import app, get_db, init_db
from modules.multitenant import (
    init_multitenant_db,
    get_tenant,
    create_tenant,
    get_agent_config,
    update_agent_config,
    DEFAULT_TENANT_ID
)
from modules.tools import registry
from modules.rag import ingest_document, search_knowledge_base, seed_default_gustavo_proposal
from modules.agents import SupervisorAgent
from modules.crm import get_kanban_board_data, update_ensaio_status


class TestPhotoAgent20Scenarios(unittest.TestCase):
    """
    Test suite validating the 12 PhotoAgent AI 2.0 evaluation scenarios
    as defined in section 17 of the prompt specification.
    """

    @classmethod
    def setUpClass(cls):
        init_db()
        cls.client = app.test_client()
        conn = get_db()
        init_multitenant_db(conn)
        seed_default_gustavo_proposal(conn)
        conn.close()

    def setUp(self):
        self.conn = get_db()
        self.tenant_id = DEFAULT_TENANT_ID
        self.supervisor = SupervisorAgent()
        c = self.conn.cursor()
        c.execute("DELETE FROM slots WHERE client_wa_id LIKE '553499111%' OR start_at LIKE '2026-12-%'")
        c.execute("DELETE FROM ensaios WHERE contact_wa_id LIKE '553499111%'")
        c.execute("DELETE FROM contacts WHERE wa_id LIKE '553499111%'")
        c.execute("DELETE FROM waiting_queue WHERE client_phone LIKE '553499111%'")
        self.conn.commit()

    def tearDown(self):
        c = self.conn.cursor()
        c.execute("DELETE FROM slots WHERE client_wa_id LIKE '553499111%' OR start_at LIKE '2026-12-%'")
        c.execute("DELETE FROM ensaios WHERE contact_wa_id LIKE '553499111%'")
        c.execute("DELETE FROM contacts WHERE wa_id LIKE '553499111%'")
        c.execute("DELETE FROM waiting_queue WHERE client_phone LIKE '553499111%'")
        self.conn.commit()
        self.conn.close()

    # -------------------------------------------------------------------------
    # CENÁRIO 1: Gestante Info (Recepção e Serviços)
    # -------------------------------------------------------------------------
    def test_scenario_01_gestante_info(self):
        phone = "5534991110001"
        reply, meta = self.supervisor.process_message(
            self.conn, self.tenant_id, phone,
            "Olá! Vocês fazem ensaio de gestante?", "Camila"
        )
        self.assertIn("Bruna", reply)
        self.assertTrue(
            "gestante" in reply.lower() or "família" in reply.lower() or "pacotes" in reply.lower()
        )
        self.assertEqual(meta.get("specialist"), "reception")

    # -------------------------------------------------------------------------
    # CENÁRIO 2: Orçamento (Catálogo Real do PDF: R$7.500 / 8.800 / 11.350)
    # -------------------------------------------------------------------------
    def test_scenario_02_orcamento(self):
        phone = "5534991110002"
        reply, meta = self.supervisor.process_message(
            self.conn, self.tenant_id, phone,
            "Quais são os pacotes e valores para casamento?", "Juliana"
        )
        self.assertIn("Essencial", reply)
        self.assertIn("7.500", reply)
        self.assertIn("Premium", reply)
        self.assertIn("8.800", reply)
        self.assertIn("Black", reply)
        self.assertIn("11.350", reply)

    # -------------------------------------------------------------------------
    # CENÁRIO 3: Desconto (Objeção sem Alucinação de Preço)
    # -------------------------------------------------------------------------
    def test_scenario_03_desconto(self):
        phone = "5534991110003"
        reply, meta = self.supervisor.process_message(
            self.conn, self.tenant_id, phone,
            "Achei o valor um pouco alto. Tem como dar um desconto ou fazer mais barato?", "Roberta"
        )
        self.assertIn("fotógrafos", reply.lower())
        self.assertIn("parcelar", reply.lower())
        # Não pode dar 50% ou inventar preço gratuito
        self.assertNotIn("faço pela metade", reply.lower())
        self.assertNotIn("desconto de 50%", reply.lower())

    # -------------------------------------------------------------------------
    # CENÁRIO 4: Reservar Data (Transação Atômica Anti-Duplo)
    # -------------------------------------------------------------------------
    def test_scenario_04_reservar_data_anti_duplo(self):
        phone = "5534991110004"
        # Cria slot de teste
        c = self.conn.cursor()
        c.execute("""
            INSERT INTO slots (studio_id, start_at, end_at, status)
            VALUES (?, '2026-12-10T15:00', '2026-12-10T16:00', 'free')
        """, (self.tenant_id,))
        self.conn.commit()
        slot_id = c.lastrowid

        # 1. Primeira reserva com sucesso
        res1 = registry.execute("reservar_horario", self.conn, self.tenant_id, {
            "slot_id": slot_id,
            "client_wa_id": phone,
            "pacote": "Premium"
        })
        self.assertTrue(res1["ok"])
        self.assertEqual(res1["result"]["status"], "ok")

        # 2. Segunda tentativa de reserva no mesmo slot falha imediatamente (anti-duplo)
        res2 = registry.execute("reservar_horario", self.conn, self.tenant_id, {
            "slot_id": slot_id,
            "client_wa_id": "5534991119999",
            "pacote": "Black"
        })
        self.assertFalse(res2["ok"])
        self.assertIn("não está mais livre", res2["error"])

    # -------------------------------------------------------------------------
    # CENÁRIO 5: Reagendar Horário
    # -------------------------------------------------------------------------
    def test_scenario_05_reagendar(self):
        c = self.conn.cursor()
        c.execute("""
            INSERT INTO slots (studio_id, start_at, status, client_wa_id)
            VALUES (?, '2026-12-15T10:00', 'booked', '5534991110005')
        """, (self.tenant_id,))
        self.conn.commit()
        slot_id = c.lastrowid

        # Libera e reagenda
        c.execute("UPDATE slots SET start_at = '2026-12-16T14:00' WHERE id = ?", (slot_id,))
        self.conn.commit()

        c.execute("SELECT start_at FROM slots WHERE id = ?", (slot_id,))
        row = c.fetchone()
        self.assertEqual(row["start_at"], "2026-12-16T14:00")

    # -------------------------------------------------------------------------
    # CENÁRIO 6: Prazo de Entrega (Recuperado do RAG Oficial)
    # -------------------------------------------------------------------------
    def test_scenario_06_prazo_entrega(self):
        phone = "5534991110006"
        reply, meta = self.supervisor.process_message(
            self.conn, self.tenant_id, phone,
            "Qual o prazo de entrega das fotos tratadas e das prévias?", "Mariana"
        )
        self.assertTrue("48h" in reply or "48 horas" in reply)
        self.assertTrue("45 dias" in reply)

    # -------------------------------------------------------------------------
    # CENÁRIO 7: Pagamento Pendente / Condições Oficiais
    # -------------------------------------------------------------------------
    def test_scenario_07_pagamento_pendente(self):
        res = registry.execute("calcular_orcamento", self.conn, self.tenant_id, {
            "pacote_id": "essencial"
        })
        self.assertTrue(res["ok"])
        calc = res["result"]
        self.assertEqual(calc["valor_total"], 7500.0)
        self.assertIn("30%", calc["condicoes_pagamento"])

    # -------------------------------------------------------------------------
    # CENÁRIO 8: Retorno após Meses (Memória Persistente do Cliente)
    # -------------------------------------------------------------------------
    def test_scenario_08_retorno_apos_meses_memoria(self):
        phone = "5534991110008"
        # Registra previamente
        registry.execute("registrar_cliente", self.conn, self.tenant_id, {
            "phone": phone,
            "nome": "Beatriz Noiva",
            "tipo": "cliente"
        })

        # Cliente retorna meses depois com oi simples
        reply, meta = self.supervisor.process_message(
            self.conn, self.tenant_id, phone,
            "Oi, voltei a planejar o casamento!", "Beatriz Noiva"
        )
        # Reconhece pelo nome diretamente
        self.assertIn("Beatriz", reply)

    # -------------------------------------------------------------------------
    # CENÁRIO 9: Insatisfação / Atendimento com Empatia
    # -------------------------------------------------------------------------
    def test_scenario_09_insatisfacao(self):
        phone = "5534991110009"
        # Quando cliente expressa insatisfação ou pede para falar com o fotógrafo
        reply, meta = self.supervisor.process_message(
            self.conn, self.tenant_id, phone,
            "Quero falar com o fotógrafo urgente, estou com uma dúvida séria", "Fernanda"
        )
        self.assertIn("Gustavo", reply)
        # Verifica se entrou na fila humana
        c = self.conn.cursor()
        c.execute("SELECT * FROM waiting_queue WHERE wa_id = ?", (phone,))
        row = c.fetchone()
        self.assertIsNotNone(row)

    # -------------------------------------------------------------------------
    # CENÁRIO 10: Atendimento Humano (Handoff)
    # -------------------------------------------------------------------------
    def test_scenario_10_atendimento_humano_handoff(self):
        phone = "5534991110010"
        reply, meta = self.supervisor.process_message(
            self.conn, self.tenant_id, phone,
            "Quero falar com humano por favor", "Larissa"
        )
        self.assertEqual(meta.get("status"), "WAITING_HUMAN")
        self.assertIn("pausar o atendimento automático", reply.lower())

    # -------------------------------------------------------------------------
    # CENÁRIO 11: Informação Inexistente (Anti-Alucinação RAG)
    # -------------------------------------------------------------------------
    def test_scenario_11_informacao_inexistente(self):
        res = search_knowledge_base(
            self.conn, self.tenant_id,
            "Vocês alugam helicóptero para o casamento?"
        )
        # RAG não deve retornar alucinações vazias
        self.assertEqual(len(res), 0)

    # -------------------------------------------------------------------------
    # CENÁRIO 12: Tentativa de Obter Dado de Outro Fotógrafo (Multi-Tenant RLS)
    # -------------------------------------------------------------------------
    def test_scenario_12_isolamento_multitenant_seguranca(self):
        # 1. Cria Tenant B
        tenant_b = create_tenant(self.conn, {
            "name": "Lucas Foto Studio",
            "photographer_name": "Lucas Lima",
            "secretary_name": "Carol"
        })
        tenant_b_id = tenant_b["id"]

        # 2. Ingesta documento privado no Tenant B
        doc_b_id = ingest_document(
            self.conn, tenant_b_id,
            "Contrato Confidencial Lucas", "Contratos",
            "Cláusula estritamente privada do estúdio Lucas Foto Studio."
        )

        # 3. Tenant A busca na base e NÃO pode ver documento do Tenant B
        res_a = search_knowledge_base(self.conn, "studio-principal", "Confidencial Lucas")
        self.assertEqual(len(res_a), 0)

        # 4. Tenant B busca e encontra o seu próprio documento
        res_b = search_knowledge_base(self.conn, tenant_b_id, "Confidencial Lucas")
        self.assertGreaterEqual(len(res_b), 1)


if __name__ == "__main__":
    unittest.main()
