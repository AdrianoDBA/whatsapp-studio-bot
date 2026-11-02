import unittest
import time
import json
import sqlite3
import app
from instagram_webhook import can_reply_comment, can_send_dm

class TestInstagramE2E(unittest.TestCase):
    def setUp(self):
        self.client = app.app.test_client()
        conn = app.get_db()
        c = conn.cursor()
        c.execute("UPDATE studios SET status = 'ACTIVE', ig_account_id = 'adrianodba' WHERE id = 'studio-principal'")
        conn.commit()
        conn.close()

    def test_01_conectar_instagram(self):
        resp = self.client.post("/conectar-instagram", json={
            "username": "adrianodba",
            "fb_email": "adrianodba@ymail.com"
        })
        self.assertEqual(resp.status_code, 200)
        data = resp.json
        self.assertTrue(data["ok"])
        self.assertEqual(data["username"], "adrianodba")

    def test_02_comentario_gatilho_comment_to_dm(self):
        payload = {
            "entry": [{
                "changes": [{
                    "field": "comments",
                    "value": {
                        "id": f"cmt_{int(time.time()*1000)}",
                        "text": "Qual o valor do ensaio gestante? Achei lindo!",
                        "from": {"id": "ig_cliente_teste_01", "username": "anacliente"}
                    }
                }]
            }]
        }
        resp = self.client.post("/webhook/instagram", json=payload)
        self.assertEqual(resp.status_code, 200)
        events = resp.json.get("events", [])
        self.assertTrue(len(events) > 0)
        self.assertEqual(events[0]["type"], "IG_COMMENT_TO_DM")

    def test_03_story_reply(self):
        payload = {
            "type": "story_reply",
            "ig_id": "ig_story_user_02",
            "username": "story_cliente",
            "text": "quero"
        }
        resp = self.client.post("/simular-instagram", json=payload)
        self.assertEqual(resp.status_code, 200)
        events = resp.json.get("events", [])
        self.assertTrue(len(events) > 0)
        self.assertEqual(events[0]["type"], "IG_STORY_REPLY")

    def test_04_dm_keyword(self):
        payload = {
            "ig_id": "ig_dm_user_03",
            "username": "dm_cliente",
            "text": "qual preço e horários?"
        }
        resp = self.client.post("/simular-instagram", json=payload)
        self.assertEqual(resp.status_code, 200)
        events = resp.json.get("events", [])
        self.assertTrue(len(events) > 0)
        self.assertEqual(events[0]["type"], "IG_DM_KEYWORD")

    def test_05_dm_humano(self):
        payload = {
            "ig_id": "ig_dm_user_04",
            "username": "humano_cliente",
            "text": "quero falar com o fotografo gustavo"
        }
        resp = self.client.post("/simular-instagram", json=payload)
        self.assertEqual(resp.status_code, 200)
        events = resp.json.get("events", [])
        self.assertTrue(len(events) > 0)
        self.assertTrue(events[0]["waiting_human"])

if __name__ == "__main__":
    unittest.main()
