import unittest
import json
from datetime import datetime, timedelta
from app import (
    app,
    get_db,
    init_db,
    generate_humanized_reply,
    avaliacao_pos_evento_job,
    get_active_studio,
    TZ,
)

class TestPropostaEPainelFinal(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        init_db()
        cls.client = app.test_client()

    def setUp(self):
        self.studio = get_active_studio()
        self.token = self.studio.get("dashboard_token") or "painel-seguro-studio-2026"

    def test_01_contacts_upsert_and_friend_flow(self):
        # 1. Upsert amigo
        res = self.client.post("/api/contacts/upsert", json={
            "studio_id": self.studio["id"],
            "phone": "5534988881111",
            "name": "Carlos Amigo",
            "tipo": "amigo"
        })
        self.assertEqual(res.status_code, 200)
        data = res.get_json()
        self.assertTrue(data["ok"])
        self.assertEqual(data["tipo"], "amigo")

        # 2. Verifica se a secretária não vende para amigo
        reply, media, waiting, opts = generate_humanized_reply(
            self.studio,
            "5534988881111",
            "Carlos Amigo",
            "Oi Gustavo, você tá aí?"
        )
        self.assertIn("tá em ensaio no momento", reply)
        self.assertNotIn("7.500", reply)
        self.assertNotIn("Essencial", reply)

        # 3. Upsert cliente
        res2 = self.client.post("/api/contacts/upsert", json={
            "studio_id": self.studio["id"],
            "phone": "5534988882222",
            "name": "Mariana Noiva",
            "tipo": "cliente"
        })
        self.assertEqual(res2.status_code, 200)

        # 4. Verifica se a secretária atende cliente com a proposta oficial
        reply_cli, _, _, _ = generate_humanized_reply(
            self.studio,
            "5534988882222",
            "Mariana Noiva",
            "Quero saber sobre os pacotes de casamento"
        )
        self.assertTrue(
            "Essencial" in reply_cli or "Premium" in reply_cli or "casamento" in reply_cli.lower()
        )

    def test_02_painel_html_renders_all_requirements(self):
        res = self.client.get(f"/painel?token={self.token}")
        self.assertEqual(res.status_code, 200)
        html = res.get_data(as_text=True)

        # Header requerido: Gustavo Alves Fotografia | Bruna | 7.500/8.800/11.350
        self.assertIn("Gustavo Alves Fotografia | Bruna | 7.500/8.800/11.350", html)

        # 3 botões expediente requeridos
        self.assertIn("🟢 Normal", html)
        self.assertIn("🌙 Não Perturbe", html)
        self.assertIn("🔴 Pausada", html)

        # Aba Pacotes com 3 pacotes reais do PDF
        self.assertIn("💍 Pacotes Oficiais (PDF)", html)
        self.assertIn("1. Essencial", html)
        self.assertIn("R$ 7.500", html)
        self.assertIn("2. Premium", html)
        self.assertIn("R$ 8.800", html)
        self.assertIn("3. Black", html)
        self.assertIn("R$ 11.350", html)

        # Aba Conversas com botões Marcar como Cliente/Amigo/Família/Fornecedor
        self.assertIn("Gerenciador de Contatos (tabela contacts)", html)
        self.assertIn("marcarContatoRapido", html)
        self.assertIn("cadastrarContatoManual", html)

    def test_03_anti_duplo_horario_e_delete_commit(self):
        conn = get_db()
        c = conn.cursor()
        c.execute(
            "INSERT INTO slots (studio_id, start_at, end_at, status) VALUES (?, '2026-12-25T14:00:00-03:00', '2026-12-25T15:00:00-03:00', 'free')",
            (self.studio["id"],)
        )
        slot_id = c.lastrowid
        conn.commit()
        conn.close()

        # Primeiro agendamento -> sucesso
        res1 = self.client.post("/api/agendar", json={
            "studio_id": self.studio["id"],
            "slot_id": slot_id,
            "client_name": "Noiva Um",
            "client_wa_id": "5534999990001",
            "niche": "Casamento Premium"
        })
        self.assertEqual(res1.status_code, 200)
        self.assertTrue(res1.get_json()["ok"])

        # Segundo agendamento no mesmo slot -> conflito 409
        res2 = self.client.post("/api/agendar", json={
            "studio_id": self.studio["id"],
            "slot_id": slot_id,
            "client_name": "Noiva Dois",
            "client_wa_id": "5534999990002"
        })
        self.assertEqual(res2.status_code, 409)

        # Exclusão com commit no banco
        res_del = self.client.delete(f"/api/agendamento/{slot_id}?token={self.token}")
        self.assertEqual(res_del.status_code, 200)
        self.assertTrue(res_del.get_json()["deleted"])

        conn = get_db()
        c = conn.cursor()
        c.execute("SELECT * FROM slots WHERE id = ?", (slot_id,))
        self.assertIsNone(c.fetchone())
        conn.close()

    def test_04_modo_expediente_dnd(self):
        res = self.client.post("/api/expediente/modo", json={
            "studio_id": self.studio["id"],
            "mode": "DND"
        })
        self.assertEqual(res.status_code, 200)
        self.assertEqual(res.get_json()["mode"], "DND")

        conn = get_db()
        c = conn.cursor()
        c.execute("SELECT mode FROM studios WHERE id = ?", (self.studio["id"],))
        self.assertEqual(c.fetchone()["mode"], "DND")
        conn.close()

    def test_05_job_avaliacao_pos_evento(self):
        # Cria slot booked realizado há 24h atrás
        past_dt = datetime.now(TZ) - timedelta(hours=25)
        conn = get_db()
        c = conn.cursor()
        c.execute(
            "INSERT INTO slots (studio_id, start_at, end_at, status, client_wa_id, client_name) VALUES (?, ?, ?, 'booked', '5534988771234', 'Fernanda Lima')",
            (self.studio["id"], past_dt.isoformat(), (past_dt + timedelta(hours=1)).isoformat())
        )
        conn.commit()
        conn.close()

        # Roda o job de avaliação
        avaliacao_pos_evento_job()

        # Verifica se gravou mensagem status='avaliacao_sent'
        conn = get_db()
        c = conn.cursor()
        c.execute(
            "SELECT * FROM messages WHERE studio_id = ? AND wa_id = '5534988771234' AND status = 'avaliacao_sent'",
            (self.studio["id"],)
        )
        msg_row = c.fetchone()
        self.assertIsNotNone(msg_row)
        self.assertIn("@gustavoalvsfotografia", msg_row["content"])
        self.assertIn("Google", msg_row["content"])
        conn.close()

if __name__ == "__main__":
    unittest.main()
