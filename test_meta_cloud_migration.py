import time
"""
Test Suite para Migração WhatsApp Cloud API Adapter & Webhook Oficial.
Verifica:
1. GET /webhook com hub.challenge e verify_token retorna texto puro.
2. POST /webhook processa payload oficial Meta Cloud API e envia resposta via CloudApiProvider.
3. Provedor Baileys funciona quando USE_PROVIDER=baileys.
4. Provedor CloudApiProvider funciona quando USE_PROVIDER=meta e envia payload oficial graph.facebook.com/v20.0.
5. follow_up_30h_job despacha mensagens via adapter WhatsAppProvider.
"""

import os
import sys
import unittest
import json
from datetime import timedelta
from unittest.mock import patch, MagicMock

os.environ["PORT"] = "10000"
os.environ["VERIFY_TOKEN"] = "botcoromandel123"
os.environ["USE_PROVIDER"] = "meta"
os.environ["PHONE_NUMBER_ID"] = "100654321098765"
os.environ["WHATSAPP_TOKEN"] = "EAABtesttoken123"

from app import app, init_db, get_db, send_whatsapp_message, followup_30h_job, now_sp
from providers.whatsapp_provider import (
    WhatsAppProvider,
    BaileysProvider,
    CloudApiProvider,
    get_whatsapp_provider,
)


class TestWhatsAppCloudApiMigration(unittest.TestCase):
    def setUp(self):
        self.client = app.test_client()
        init_db()

    def test_webhook_get_verification_plain_text(self):
        """Critério 1: GET /webhook?hub.mode=subscribe&hub.verify_token=botcoromandel123&hub.challenge=12345 retorna 12345 texto puro."""
        resp = self.client.get("/webhook?hub.mode=subscribe&hub.verify_token=botcoromandel123&hub.challenge=12345")
        self.assertEqual(resp.status_code, 200)
        self.assertEqual(resp.data.decode("utf-8"), "12345")
        self.assertIn("text/plain", resp.content_type)

    def test_webhook_get_verification_invalid_token(self):
        """GET /webhook com token incorreto retorna 403."""
        resp = self.client.get("/webhook?hub.mode=subscribe&hub.verify_token=token_invalido&hub.challenge=999")
        self.assertEqual(resp.status_code, 403)

    @patch("providers.whatsapp_provider.requests.post")
    def test_webhook_post_meta_cloud_api_message(self, mock_post):
        """Critério 2: POST /webhook processa payload oficial Meta Cloud API e envia resposta via CloudApiProvider."""
        mock_resp = MagicMock()
        mock_resp.status_code = 200
        mock_resp.json.return_value = {"messages": [{"id": "wamid.HBgL..."}]}
        mock_post.return_value = mock_resp

        official_payload = {
            "object": "whatsapp_business_account",
            "entry": [
                {
                    "id": "100123456789",
                    "changes": [
                        {
                            "value": {
                                "messaging_product": "whatsapp",
                                "metadata": {
                                    "display_phone_number": "553488412981",
                                    "phone_number_id": "100654321098765"
                                },
                                "contacts": [
                                    {
                                        "profile": {"name": "Mariana Souza"},
                                        "wa_id": "5534988776655"
                                    }
                                ],
                                "messages": [
                                    {
                                        "from": "5534988776655",
                                        "id": f"wamid.HBgL{int(time.time()*1000)}",
                                        "timestamp": "1730638800",
                                        "text": {"body": "Olá! Gostaria de saber os pacotes de casamento"},
                                        "type": "text"
                                    }
                                ]
                            },
                            "field": "messages"
                        }
                    ]
                }
            ]
        }

        resp = self.client.post("/webhook", json=official_payload)
        self.assertEqual(resp.status_code, 200)
        data = resp.get_json()
        self.assertEqual(data.get("status"), "processed")
        self.assertTrue(len(data.get("responses", [])) > 0)

        # Verifica se despachou para a Cloud API
        self.assertTrue(mock_post.called)
        sent_url = mock_post.call_args[0][0]
        self.assertIn("graph.facebook.com/v20.0/100654321098765/messages", sent_url)

    def test_provider_factory_switching(self):
        """Critério 4 & 6: Factory alterna corretamente entre BaileysProvider e CloudApiProvider."""
        with patch.dict(os.environ, {"USE_PROVIDER": "baileys"}):
            p = get_whatsapp_provider()
            self.assertIsInstance(p, BaileysProvider)

        with patch.dict(os.environ, {"USE_PROVIDER": "meta", "PHONE_NUMBER_ID": "123", "WHATSAPP_TOKEN": "abc"}):
            p = get_whatsapp_provider()
            self.assertIsInstance(p, CloudApiProvider)

    @patch("providers.whatsapp_provider.requests.post")
    def test_cloud_api_provider_send_text_and_mark_read(self, mock_post):
        """Testa envio de texto e marcação de lido no CloudApiProvider."""
        mock_resp = MagicMock()
        mock_resp.status_code = 200
        mock_post.return_value = mock_resp

        provider = CloudApiProvider(phone_number_id="test_phone_id", token="test_token")
        success = provider.send_text("5534999998888", "Mensagem de teste oficial")
        self.assertTrue(success)

        # Verifica payload
        called_payload = mock_post.call_args[1]["json"]
        self.assertEqual(called_payload["messaging_product"], "whatsapp")
        self.assertEqual(called_payload["to"], "5534999998888")
        self.assertEqual(called_payload["text"]["body"], "Mensagem de teste oficial")

        # Teste de marcar como lido
        read_success = provider.mark_as_read("wamid.12345")
        self.assertTrue(read_success)
        read_payload = mock_post.call_args[1]["json"]
        self.assertEqual(read_payload["status"], "read")
        self.assertEqual(read_payload["message_id"], "wamid.12345")

    @patch("providers.whatsapp_provider.requests.post")
    def test_followup_30h_calls_cloud_provider(self, mock_post):
        """Critério 3: follow_up_30h despacha via adapter CloudApiProvider."""
        mock_resp = MagicMock()
        mock_resp.status_code = 200
        mock_post.return_value = mock_resp

        # Insere mensagem de 35h atrás no banco para disparar o followup
        conn = get_db()
        c = conn.cursor()
        c.execute("SELECT id FROM studios LIMIT 1")
        studio_id = c.fetchone()["id"]
        test_phone = "5534998822119"
        c.execute("DELETE FROM messages WHERE wa_id = ?", (test_phone,))
        c.execute("DELETE FROM followups WHERE wa_id = ?", (test_phone,))
        c.execute("DELETE FROM slots WHERE client_wa_id = ?", (test_phone,))
        old_time = (now_sp() - timedelta(hours=35)).isoformat()
        c.execute(
            """
            INSERT INTO messages (studio_id, wa_id, direction, content, timestamp, status)
            VALUES (?, ?, 'in', 'Olá gostaria de orçamento para casamento', ?, 'received')
            """,
            (studio_id, test_phone, old_time)
        )
        conn.commit()
        conn.close()

        results = followup_30h_job()
        self.assertTrue(any(r.get("wa_id") == test_phone for r in results))
        self.assertTrue(mock_post.called)


if __name__ == "__main__":
    unittest.main()
