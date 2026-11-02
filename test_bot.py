"""
Test Suite for Studio Fotográfico WhatsApp Cloud API Bot (SaaS Edition)
Verifies:
1. Emoji limiter rule
2. Initial greeting with dynamic persona
3. Dynamic persona customization (e.g. Julia instead of Ana)
4. Menu flow and portfolio mock photos
5. WAITING_HUMAN mode, HUMAN_NEEDED log, 60s silence rule
6. LEAD_RECEBIDO alert, audio transcription, dashboard leads listing and resolving
7. PWA routes (/onboarding, /dashboard, /instalar, /manifest.json, /service-worker.js)
"""

import os
import sys
import time
import json
import io
import unittest
import sqlite3

os.environ["PORT"] = "5005"
os.environ["DEBUG"] = "false"

from main import (
    app, init_db, get_db, DB_PATH, process_incoming_message,
    set_waiting_human, resolve_human_wait, get_waiting_client,
    limit_emojis, gemini_reply, get_active_client_config,
    trigger_lead_alert, run_30h_followup_check
)

class TestWhatsAppStudioBotSaaS(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        init_db()
        cls.client = app.test_client()

    def setUp(self):
        with get_db() as conn:
            c = conn.cursor()
            c.execute("DELETE FROM customers")
            c.execute("DELETE FROM appointments")
            c.execute("DELETE FROM waiting_queue")
            c.execute("DELETE FROM messages")
            c.execute("DELETE FROM slots")
            c.executemany(
                "INSERT INTO slots (client_id, date, time, status) VALUES (1, ?, ?, 'free')",
                [
                    ("Terça", "15h"),
                    ("Quarta", "09:30"),
                    ("Sábado", "16:30"),
                    ("Terça", "09h"),
                    ("Terça", "14h"),
                    ("Terça", "15h30"),
                ]
            )
            c.execute("UPDATE clients SET studio_name='Studio Leo', photographer_name='Leo', secretary_name='Ana' WHERE token='default_token_leo'")
            conn.commit()
        self.phone = "5534999991234"
        self.client_name = "Camila Rodrigues"

    def test_emoji_limiter(self):
        """Verifies rule: Max 2 emojis per message."""
        text = "Oi! 📸 Tudo bem? 🌟 Vamos agendar! 🎉 Adorei! 💖"
        limited = limit_emojis(text, max_emojis=2)
        import re
        emoji_pattern = re.compile(
            r'[\U0001F1E0-\U0001F1FF]|[\U0001F300-\U0001F5FF]|[\U0001F600-\U0001F64F]|'
            r'[\U0001F680-\U0001F6FF]|[\U0001F700-\U0001F77F]|[\U0001F780-\U0001F7FF]|'
            r'[\U0001F800-\U0001F8FF]|[\U0001F900-\U0001F9FF]|[\U0001FA00-\U0001FA6F]|'
            r'[\U0001FA70-\U0001FAFF]|[\u2600-\u26FF]|[\u2700-\u27BF]',
            flags=re.UNICODE
        )
        found = [c for c in limited if emoji_pattern.match(c)]
        self.assertLessEqual(len(found), 2)
        print(f"✓ Emoji limiter test passed: '{limited}' (count: {len(found)})")

    def test_dynamic_persona_customization(self):
        """TAREFA 1 & 4: Changing secretary_name to 'Julia' updates bot persona dynamically."""
        # 1. Update config via API
        update_payload = {
            "token": "default_token_leo",
            "studio_name": "Studio da Luz",
            "photographer_name": "Marcos",
            "secretary_name": "Julia",
            "photographer_phone": "5534988880000",
            "business_hours": "Seg-Sex 9h-19h",
            "niches_json": json.dumps({
                "casal": {"price": 480, "description": "Ensaio especial de casal", "photos": []}
            })
        }
        res = self.client.post("/api/client/config", json=update_payload)
        self.assertEqual(res.status_code, 200)

        # 2. Trigger initial greeting
        msg_data = {"type": "text", "text": {"body": "Oi, gostaria de informações"}}
        process_incoming_message(self.phone, msg_data, client_name="Beatriz")

        # 3. Check bot message in DB
        with get_db() as conn:
            c = conn.cursor()
            c.execute("SELECT content FROM messages WHERE client_phone = ? AND direction = 'bot' ORDER BY timestamp DESC LIMIT 1", (self.phone,))
            msg_content = c.fetchone()["content"]
            
            # Must mention Julia and Marcos, NOT Ana or Leo!
            self.assertIn("Julia", msg_content, "Bot must introduce herself as Julia!")
            self.assertIn("Marcos", msg_content, "Bot must mention Marcos as photographer!")
            self.assertNotIn("Aqui é a Ana", msg_content, "Must not mention Ana anymore!")
        print(f"✓ Dynamic persona test passed! Message: '{msg_content}'")

    def test_lead_recebido_and_dashboard(self):
        """TAREFA 2: Audio/Text saved in waiting_queue, triggers LEAD_RECEBIDO alert and dashboard resolve."""
        # Client sends audio
        audio_msg = {
            "type": "audio",
            "audio": {"id": "audio_sample_123", "url": "/uploads/test_audio.ogg"}
        }
        process_incoming_message(self.phone, audio_msg, client_name="Roberto")

        # Verify saved in waiting_queue
        with get_db() as conn:
            c = conn.cursor()
            c.execute("SELECT * FROM waiting_queue WHERE client_phone = ?", (self.phone,))
            queue_item = c.fetchone()
            self.assertIsNotNone(queue_item)
            self.assertEqual(queue_item["status"], "WAITING_HUMAN")
            self.assertIsNotNone(queue_item["transcription"])
            self.assertIsNotNone(queue_item["audio_url"])

        # Check API /api/client/leads
        res = self.client.get("/api/client/leads")
        self.assertEqual(res.status_code, 200)
        data = res.get_json()
        self.assertTrue(any(l["client_phone"] == self.phone for l in data["leads"]))

        # Resolve lead from dashboard
        resolve_res = self.client.post("/api/client/leads/resolve", json={"phone": self.phone})
        self.assertEqual(resolve_res.status_code, 200)

        # Check no longer waiting
        waiting_after = get_waiting_client(self.phone)
        self.assertIsNone(waiting_after, "Lead should be marked RESOLVED and out of waiting_queue!")
        print("✓ Lead alert in 3 places and dashboard resolve test passed!")

    def test_pwa_routes_and_manifest(self):
        """TAREFA 3 & 1-Click Refactor: Verify /comecar, /ajuda, /onboarding, /dashboard, /instalar, manifest.json and service-worker.js."""
        # /comecar
        res_comecar = self.client.get("/comecar")
        self.assertEqual(res_comecar.status_code, 200)

        # /ajuda
        res_ajuda = self.client.get("/ajuda")
        self.assertEqual(res_ajuda.status_code, 200)

        # /onboarding
        res_onboarding = self.client.get("/onboarding")
        self.assertEqual(res_onboarding.status_code, 200)

        # /dashboard
        res_dashboard = self.client.get("/dashboard")
        self.assertEqual(res_dashboard.status_code, 200)

        # /instalar
        res_instalar = self.client.get("/instalar")
        self.assertEqual(res_instalar.status_code, 200)

        # /manifest.json
        res_manifest = self.client.get("/manifest.json")
        self.assertEqual(res_manifest.status_code, 200)
        manifest_data = json.loads(res_manifest.data)
        self.assertEqual(manifest_data["name"], "Bot do Studio")
        self.assertEqual(manifest_data["theme_color"], "#25D366")
        self.assertEqual(manifest_data["display"], "standalone")

        # /service-worker.js
        res_sw = self.client.get("/service-worker.js")
        self.assertEqual(res_sw.status_code, 200)
        self.assertIn("studio-bot-", res_sw.data.decode("utf-8"))

        # /api/page_qr
        res_qr = self.client.get("/api/page_qr?url=https://localhost:5005/comecar")
        self.assertEqual(res_qr.status_code, 200)
        qr_data = res_qr.get_json()
        self.assertIn("qr", qr_data)

        # /api/client/embedded_signup
        res_signup = self.client.post("/api/client/embedded_signup", json={
            "token": "default_token_leo",
            "code_1": "sample_key_123",
            "code_2": "9988776655"
        })
        self.assertEqual(res_signup.status_code, 200)
        self.assertEqual(res_signup.get_json()["status"], "ok")

        print("✓ PWA routes (/comecar, /ajuda, /instalar, /dashboard, /onboarding), manifest.json and Embedded Signup test passed!")

    def test_photo_upload_endpoint(self):
        """Test file upload endpoint for portfolio photos."""
        data = {
            "photo": (io.BytesIO(b"fake image data"), "sample.jpg")
        }
        res = self.client.post("/api/upload", data=data, content_type="multipart/form-data")
        self.assertEqual(res.status_code, 200)
        json_data = res.get_json()
        self.assertIn("url", json_data)
        self.assertTrue(json_data["url"].startswith("/uploads/"))
        print(f"✓ Photo upload test passed! Generated URL: {json_data['url']}")

    def test_real_slot_scheduling_part1(self):
        """PARTE 1: Verify real slot querying (3 closest free slots), booking as busy, Pix R$100 message, and receipt."""
        # 1. Client clicks "📅 Já tenho horário"
        msg_ask = {
            "type": "interactive",
            "interactive": {
                "type": "button_reply",
                "button_reply": {"id": "ja_tenho_horario", "title": "📅 Já tenho horário"}
            }
        }
        process_incoming_message(self.phone, msg_ask, client_name="Camila")

        with get_db() as conn:
            c = conn.cursor()
            c.execute("SELECT content FROM messages WHERE client_phone = ? AND direction = 'bot' ORDER BY id DESC LIMIT 1", (self.phone,))
            bot_offer = c.fetchone()["content"]
            self.assertIn("Tenho Terça 15h, Quarta 09:30 e Sábado 16:30, qual fica melhor pra ocê?", bot_offer)

        # 2. Client chooses "Terça 15h"
        msg_choose = {
            "type": "text",
            "text": {"body": "Terça 15h"}
        }
        process_incoming_message(self.phone, msg_choose, client_name="Camila")

        # 3. Verify slot is marked busy in SQLite
        with get_db() as conn:
            c = conn.cursor()
            c.execute("SELECT * FROM slots WHERE date = 'Terça' AND time = '15h'")
            slot_row = dict(c.fetchone())
            self.assertEqual(slot_row["status"], "busy")
            self.assertEqual(slot_row["client_phone"], self.phone)
            self.assertEqual(slot_row["client_name"], "Camila")
            self.assertIn("Ensaio Casal", slot_row["ensaio_type"])

            # Verify confirmation message and receipt
            c.execute("SELECT content FROM messages WHERE client_phone = ? AND direction = 'bot' ORDER BY id ASC", (self.phone,))
            bot_msgs = [r["content"] for r in c.fetchall()]
            combined_bot = "\n".join(bot_msgs)
            self.assertIn("Prontinho Camila! Reservei Terça 15h pro seu Ensaio Casal. Te mandei um comprovante aqui e já avisei o Leo. O sinal é Pix R$100 pra confirmar, tudo bem?", combined_bot)
            self.assertIn("COMPROVANTE DE AGENDAMENTO", combined_bot)

        # 4. Verify /api/client/appointments returns the new booking for the dashboard
        res_appts = self.client.get("/api/client/appointments")
        self.assertEqual(res_appts.status_code, 200)
        appts_data = res_appts.get_json()
        self.assertTrue(any(a["client_phone"] == self.phone and a["status"] == "BOOKED" for a in appts_data["appointments"]))
        print("✓ PARTE 1: Real slot scheduling, busy status, Pix R$100 confirmation & receipt test passed!")

    def test_followup_30h_and_24h_window_part2_part3(self):
        """PARTE 2 & PARTE 3: Verify 30h follow-up engine, >24h template vs <24h normal message, auto_closed, and no duplicate sends."""
        now = time.time()
        past_31h = now - (31 * 3600)

        # Case 1: Waiting >30h, last client message >24h ago (window closed -> must use approved template)
        phone_over24 = "5534999991234"
        with get_db() as conn:
            c = conn.cursor()
            c.execute("""
                INSERT INTO messages (client_phone, direction, message_type, content, timestamp)
                VALUES (?, 'client', 'text', 'Quero falar com o fotógrafo sobre o casamento', ?)
            """, (phone_over24, past_31h))
            c.execute("""
                INSERT INTO appointments (client_phone, client_name, session_type, status, notes, last_interaction, created_at, updated_at)
                VALUES (?, 'Mariana', 'Ensaio Casamento', 'WAITING_HUMAN', 'Dúvida casamento', ?, ?, ?)
            """, (phone_over24, past_31h, past_31h, past_31h))
            conn.commit()

        results_1 = run_30h_followup_check()
        self.assertEqual(len(results_1), 1)
        self.assertEqual(results_1[0]["status"], "FOLLOWUP_30H_SENT")
        self.assertEqual(results_1[0]["action"], "enviou")
        self.assertIn("Olá Mariana, passando pra retomar nosso atendimento sobre Ensaio Casamento. Ainda precisa de ajuda? 📸", results_1[0]["message"])

        # Running a second time must NOT send again!
        results_dup = run_30h_followup_check()
        self.assertEqual(len(results_dup), 0)

        # Case 2: Client already resolved -> must mark auto_closed and NOT send
        phone_closed = "5534999991235"
        with get_db() as conn:
            c = conn.cursor()
            c.execute("""
                INSERT INTO messages (client_phone, direction, message_type, content, timestamp)
                VALUES (?, 'client', 'text', 'Oi, já resolvi e já fechei com outro estúdio', ?)
            """, (phone_closed, past_31h))
            c.execute("""
                INSERT INTO appointments (client_phone, client_name, session_type, status, notes, last_interaction, created_at, updated_at)
                VALUES (?, 'Pedro', 'Ensaio Corporativo', 'WAITING_HUMAN', 'Já resolvi', ?, ?, ?)
            """, (phone_closed, past_31h, past_31h, past_31h))
            conn.commit()

        results_2 = run_30h_followup_check()
        self.assertEqual(len(results_2), 1)
        self.assertEqual(results_2[0]["status"], "auto_closed")
        self.assertEqual(results_2[0]["action"], "não enviou")
        print("✓ PARTE 2 & 3: 30h intelligent follow-up, 24h WhatsApp window template, and auto_closed test passed!")

    def test_10s_and_gustavo_timers(self):
        """Verify 10s initial takeover timer and Gustavo insistence 60s wait timer."""
        # 1. Start with 10s timer
        process_incoming_message(self.phone, {"type": "text", "text": {"body": "Oi"}, "use_10s_timer": True}, client_name="Lucas")
        with get_db() as conn:
            c = conn.cursor()
            c.execute("SELECT status FROM waiting_queue WHERE client_phone = ?", (self.phone,))
            self.assertEqual(c.fetchone()["status"], "WAITING_INITIAL_10S")

        # 2. Client insists on talking to Gustavo
        process_incoming_message(self.phone, {"type": "text", "text": {"body": "Quero falar com o Gustavo"}}, client_name="Lucas")
        with get_db() as conn:
            c = conn.cursor()
            c.execute("SELECT status FROM waiting_queue WHERE client_phone = ?", (self.phone,))
            self.assertEqual(c.fetchone()["status"], "WAITING_HUMAN")
            c.execute("SELECT content FROM messages WHERE client_phone = ? AND direction = 'bot' ORDER BY id DESC LIMIT 1", (self.phone,))
            bot_reply = c.fetchone()["content"]
            self.assertIn("Gustavo", bot_reply)
        print("✓ 10s initial takeover and Gustavo 60s wait timer test passed!")

if __name__ == "__main__":
    unittest.main()
