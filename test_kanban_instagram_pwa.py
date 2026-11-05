import unittest
import json
import os
import sqlite3
import app
from providers.instagram_provider import InstagramProvider, get_instagram_provider


class TestKanbanInstagramPWA(unittest.TestCase):
    def setUp(self):
        self.client = app.app.test_client()
        self.studio = app.get_active_studio()
        self.token = self.studio["dashboard_token"]

    def test_kanban_api_columns(self):
        """Verifica se /api/kanban retorna as 4 colunas com status 200 OK."""
        res = self.client.get(f"/api/kanban?acesso={self.token}")
        self.assertEqual(res.status_code, 200)
        data = res.get_json()
        self.assertTrue(data.get("ok"))
        self.assertIn("kanban", data)
        k = data["kanban"]
        self.assertIn("agendados", k)
        self.assertIn("em_atendimento", k)
        self.assertIn("fotografando", k)
        self.assertIn("editando_finalizado", k)

    def test_kanban_mover(self):
        """Testa arrastar e soltar card atualizando status na tabela ensaios."""
        conn = app.get_db()
        c = conn.cursor()
        c.execute("SELECT id FROM ensaios LIMIT 1")
        row = c.fetchone()
        conn.close()
        self.assertIsNotNone(row)
        ensaio_id = row["id"]

        res = self.client.post("/api/kanban/mover", json={
            "id": ensaio_id,
            "status": "editando",
            "acesso": self.token
        })
        self.assertEqual(res.status_code, 200)
        data = res.get_json()
        self.assertTrue(data.get("ok"))
        self.assertEqual(data.get("status"), "editando")

        # Verifica no banco
        conn = app.get_db()
        c = conn.cursor()
        c.execute("SELECT status FROM ensaios WHERE id = ?", (ensaio_id,))
        updated = c.fetchone()["status"]
        conn.close()
        self.assertEqual(updated, "editando")

    def test_instagram_provider_and_postar_previa(self):
        """Testa o InstagramProvider e o endpoint /api/instagram/postar-previa."""
        prov = InstagramProvider()
        feed_res = prov.post_feed("https://images.unsplash.com/photo-1519741497674-611481863552?w=600", "Foto linda")
        self.assertTrue(feed_res.get("success"))
        self.assertIn("instagram.com/p/", feed_res.get("permalink"))

        story_res = prov.post_story("https://images.unsplash.com/photo-1519741497674-611481863552?w=600")
        self.assertTrue(story_res.get("success"))

        # Testa endpoint
        conn = app.get_db()
        c = conn.cursor()
        c.execute("SELECT id FROM ensaios LIMIT 1")
        ensaio_id = c.fetchone()["id"]
        conn.close()

        res = self.client.post("/api/instagram/postar-previa", json={
            "ensaio_id": ensaio_id,
            "image_url": "/static/demo_photos/casamento_01.jpg",
            "caption": "Prévia oficial de teste @gustavoalvsfotografia",
            "post_type": "feed"
        })
        self.assertEqual(res.status_code, 200)
        data = res.get_json()
        self.assertTrue(data.get("ok"))
        self.assertIn("instagram.com", data.get("permalink"))

    def test_flow_cade_minha_previa(self):
        """Cliente pergunta 'cadê minha prévia?' e Bruna responde e gera alerta na waiting_queue."""
        test_wa = "5534988774444"
        reply, media, waiting, opts = app.generate_humanized_reply(
            self.studio, test_wa, "Fernanda", "Oi Bruna, cadê minha prévia?"
        )
        self.assertIn("prévia", reply.lower())
        self.assertIn("ilha de edição", reply.lower())

        # Checa waiting_queue
        conn = app.get_db()
        c = conn.cursor()
        c.execute("SELECT * FROM waiting_queue WHERE client_phone = ? AND status = 'previa_pendente'", (test_wa,))
        row = c.fetchone()
        conn.close()
        self.assertIsNotNone(row)

    def test_token_economy_contacts(self):
        """Amigo não recebe pitch de vendas do Gemini, responde curto e incrementa conversas."""
        amigo_wa = "5534977770001"
        conn = app.get_db()
        c = conn.cursor()
        c.execute("""
            INSERT OR REPLACE INTO contacts (studio_id, wa_id, phone, name, nome, tipo, total_conversas, first_contact_at, last_contact_at)
            VALUES (?, ?, ?, 'Lucas Amigo', 'Lucas Amigo', 'amigo', 1, ?, ?)
        """, (self.studio["id"], amigo_wa, amigo_wa, app.now_iso(), app.now_iso()))
        conn.commit()
        conn.close()

        reply, media, waiting, opts = app.generate_humanized_reply(
            self.studio, amigo_wa, "Lucas", "E aí Gustavo, tudo bem?"
        )
        self.assertIn("tá em ensaio", reply.lower())
        self.assertIn("recado", reply.lower())
        self.assertNotIn("R$ 7.500", reply)
        self.assertNotIn("pacote", reply.lower())

    def test_service_worker_indexeddb(self):
        """Verifica se o service worker possui o IndexedDB configurado com as stores requeridas."""
        sw_path = os.path.join(os.path.dirname(__file__), "static", "service-worker.js")
        with open(sw_path, "r", encoding="utf-8") as f:
            content = f.read()
        self.assertIn('indexedDB.open("BotStudio", 1)', content)
        self.assertIn('"contacts"', content)
        self.assertIn('"ensaios"', content)
        self.assertIn('"fila_offline"', content)

    def test_postgres_schema_file(self):
        """Verifica se o schema PostgreSQL existe e possui todas as tabelas requeridas."""
        pg_path = os.path.join(os.path.dirname(__file__), "schema_postgres.sql")
        with open(pg_path, "r", encoding="utf-8") as f:
            sql = f.read()
        self.assertIn("CREATE TABLE IF NOT EXISTS contacts", sql)
        self.assertIn("CREATE TABLE IF NOT EXISTS ensaios", sql)
        self.assertIn("CREATE TABLE IF NOT EXISTS slots", sql)
        self.assertIn("CREATE TABLE IF NOT EXISTS waiting_queue", sql)
        self.assertIn("CREATE TABLE IF NOT EXISTS blocked_dates", sql)


if __name__ == "__main__":
    unittest.main()
