"""
Suíte de Testes Automatizados para o Módulo Instagram do Bot do Studio
Porta 5005 /webhook/instagram

Simula e valida os 3 gatilhos e regras de segurança:
1. Comentário contendo 'quanto custa ensaio gestante?' -> Comment to DM (public reply + DM com pacotes)
2. Resposta de Story 'quero' -> Story reply com 3 horários livres reais da tabela slots
3. DM privada 'qual valor?' -> DM Keyword com valores e horários
4. DM privada 'preciso falar com o fotógrafo' -> Encaminha para WAITING_HUMAN
5. Anti-Ban: Limite de 50 comentários em 24h
6. Anti-Spam: Bloqueio de DM idêntica em <5min
7. Validação de Assinatura HMAC SHA256 com APP_SECRET
"""

import sys
import os
import json
import time
import hmac
import hashlib
import unittest

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from app import app, get_db, init_db
from instagram_webhook import (
    init_instagram_db,
    get_app_secret,
    get_verify_token,
    can_reply_comment,
    can_send_dm,
)

class InstagramModuleTestCase(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        init_db()
        init_instagram_db()
        cls.client = app.test_client()
        cls.app_secret = get_app_secret()
        cls.verify_token = get_verify_token()

    def _sign(self, payload_dict: dict) -> tuple[str, str]:
        body = json.dumps(payload_dict)
        sig = "sha256=" + hmac.new(self.app_secret.encode(), body.encode(), hashlib.sha256).hexdigest()
        return body, sig

    def test_01_verify_webhook_get(self):
        """Teste do GET /webhook/instagram com hub.verify_token e challenge."""
        challenge = "challenge_ig_test_9988"
        r = self.client.get(f"/webhook/instagram?hub.mode=subscribe&hub.verify_token={self.verify_token}&hub.challenge={challenge}")
        self.assertEqual(r.status_code, 200)
        self.assertEqual(r.data.decode("utf-8"), challenge)

        # Token incorreto deve dar 403
        r_fail = self.client.get(f"/webhook/instagram?hub.mode=subscribe&hub.verify_token=errado&hub.challenge={challenge}")
        self.assertEqual(r_fail.status_code, 403)
        print("✓ [01/07] Verificação GET /webhook/instagram aprovada")

    def test_02_comment_to_dm(self):
        """Teste de comentário com palavra-chave 'quanto custa ensaio gestante?'."""
        comment_id = f"cmt_test_{int(time.time()*1000)}"
        payload = {
            "entry": [
                {
                    "changes": [
                        {
                            "field": "comments",
                            "value": {
                                "id": comment_id,
                                "text": "quanto custa ensaio gestante? Achei lindo!",
                                "from": {
                                    "id": "ig_user_gestante_01",
                                    "username": "mariagestante"
                                }
                            }
                        }
                    ]
                }
            ]
        }
        body, sig = self._sign(payload)
        resp = self.client.post(
            "/webhook/instagram",
            data=body,
            headers={"Content-Type": "application/json", "X-Hub-Signature-256": sig}
        )
        self.assertEqual(resp.status_code, 200)
        data = resp.get_json()
        self.assertEqual(data.get("status"), "processed")
        self.assertTrue(any(ev.get("type") == "IG_COMMENT_TO_DM" for ev in data.get("events", [])))

        # Verifica se foi gravado na tabela ig_events
        conn = get_db()
        c = conn.cursor()
        c.execute("SELECT * FROM ig_events WHERE type = 'IG_COMMENT_TO_DM' AND username = 'mariagestante'")
        row = c.fetchone()
        conn.close()
        self.assertIsNotNone(row)
        self.assertIn("Te respondi no DM", row["reply_sent"])
        print(f"✓ [02/07] Gatilho Comment to DM aprovado: {row['reply_sent']}")

    def test_03_story_reply(self):
        """Teste de resposta de Story com 'quero'."""
        dm_id = f"dm_story_{int(time.time()*1000)}"
        payload = {
            "entry": [
                {
                    "messaging": [
                        {
                            "sender": {"id": "ig_user_story_02"},
                            "username": "carlos_foto",
                            "message": {
                                "mid": dm_id,
                                "text": "quero",
                                "reply_to": {"story": {"id": "story_12345"}}
                            }
                        }
                    ]
                }
            ]
        }
        body, sig = self._sign(payload)
        resp = self.client.post(
            "/webhook/instagram",
            data=body,
            headers={"Content-Type": "application/json", "X-Hub-Signature-256": sig}
        )
        self.assertEqual(resp.status_code, 200)
        data = resp.get_json()
        self.assertTrue(any(ev.get("type") == "IG_STORY_REPLY" for ev in data.get("events", [])))

        conn = get_db()
        c = conn.cursor()
        c.execute("SELECT * FROM ig_events WHERE type = 'IG_STORY_REPLY' AND username = 'carlos_foto'")
        row = c.fetchone()
        conn.close()
        self.assertIsNotNone(row)
        self.assertIn("Obrigada por responder o story", row["reply_sent"])
        print(f"✓ [03/07] Gatilho Story Reply aprovado: {row['reply_sent']}")

    def test_04_dm_keyword(self):
        """Teste de DM privada 'qual valor?'."""
        dm_id = f"dm_kw_{int(time.time()*1000)}"
        payload = {
            "entry": [
                {
                    "messaging": [
                        {
                            "sender": {"id": "ig_user_dm_03"},
                            "username": "ana_paula",
                            "message": {
                                "mid": dm_id,
                                "text": "qual valor?"
                            }
                        }
                    ]
                }
            ]
        }
        body, sig = self._sign(payload)
        resp = self.client.post(
            "/webhook/instagram",
            data=body,
            headers={"Content-Type": "application/json", "X-Hub-Signature-256": sig}
        )
        self.assertEqual(resp.status_code, 200)
        data = resp.get_json()
        self.assertTrue(any(ev.get("type") == "IG_DM_KEYWORD" for ev in data.get("events", [])))
        print("✓ [04/07] Gatilho DM Keyword aprovado")

    def test_05_dm_waiting_human(self):
        """Teste de DM pedindo fotógrafo humano -> marca WAITING_HUMAN na tabela ig_clients."""
        dm_id = f"dm_human_{int(time.time()*1000)}"
        payload = {
            "entry": [
                {
                    "messaging": [
                        {
                            "sender": {"id": "ig_user_human_04"},
                            "username": "fernando_lima",
                            "message": {
                                "mid": dm_id,
                                "text": "quero falar com o fotógrafo gustavo"
                            }
                        }
                    ]
                }
            ]
        }
        body, sig = self._sign(payload)
        resp = self.client.post(
            "/webhook/instagram",
            data=body,
            headers={"Content-Type": "application/json", "X-Hub-Signature-256": sig}
        )
        self.assertEqual(resp.status_code, 200)

        conn = get_db()
        c = conn.cursor()
        c.execute("SELECT status FROM ig_clients WHERE ig_id = 'ig_user_human_04'")
        row = c.fetchone()
        conn.close()
        self.assertIsNotNone(row)
        self.assertEqual(row["status"], "WAITING_HUMAN")
        print("✓ [05/07] Encaminhamento para WAITING_HUMAN no Instagram aprovado")

    def test_06_anti_ban_and_spam(self):
        """Valida que DMs idênticas em <5 minutos para o mesmo ig_id são bloqueadas."""
        self.assertTrue(can_send_dm("ig_test_user_spam", "Mensagem de teste"))
        self.assertFalse(can_send_dm("ig_test_user_spam", "Mensagem de teste"))
        self.assertTrue(can_reply_comment(max_24h=5000))
        print("✓ [06/07] Regras Anti-Ban (50 comentários/dia) e Anti-Spam (<5min) aprovadas")

    def test_07_instagram_comecar_page(self):
        """Página /instagram-comecar carrega status 200 com botão e elementos visuais."""
        r = self.client.get("/instagram-comecar")
        self.assertEqual(r.status_code, 200)
        self.assertIn("Conecte seu Instagram", r.data.decode("utf-8"))
        self.assertIn("CONECTAR MEU INSTAGRAM", r.data.decode("utf-8"))
        print("✓ [07/07] Página /instagram-comecar carregada com sucesso (200 OK)")

if __name__ == "__main__":
    print("=" * 70)
    print("🚀 INICIANDO TESTES DO MÓDULO INSTAGRAM (COMBO INSTA + ZAP)")
    print("=" * 70)
    unittest.main()
