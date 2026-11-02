"""
Automated Security & Anti-Loop Audit Suite (20 Tests)
Verifies PARTE 1 (Definitive Anti-Loop Protections) & PARTE 2 (Total Data Security & LGPD Compliance).
"""

import os
import re
import sys
import time
import json
import hmac
import hashlib
import tempfile
import unittest

os.environ["PORT"] = "5005"
os.environ["DEBUG"] = "false"

from cryptography.fernet import InvalidToken
from main import (
    app, init_db, get_db, DB_PATH, LOOP_LOG_PATH,
    APP_SECRET, WHATSAPP_VERIFY_TOKEN,
    process_incoming_message, get_active_client_config,
    encrypt_sensitive, decrypt_sensitive,
    mask_phone, mask_sensitive_log_text,
    verify_webhook_signature, validate_and_sanitize_input,
    check_and_mark_idempotency, is_echo_message,
    is_status_or_non_message_event, trigger_reengagement_for_client,
    set_waiting_human, last_message_time, limiter
)
from backup import create_encrypted_backup, decrypt_backup


def _sign_payload(payload_bytes: bytes, secret: str = APP_SECRET) -> str:
    return "sha256=" + hmac.new(secret.encode("utf-8"), payload_bytes, hashlib.sha256).hexdigest()


class TestSecurityAndAntiLoopAudit(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        init_db()
        cls.client = app.test_client()

    def setUp(self):
        # Reset rate limiter storage before each test so only test_20 triggers 429
        try:
            limiter.reset()
        except Exception:
            pass
        last_message_time.clear()
        with get_db() as conn:
            c = conn.cursor()
            c.execute("DELETE FROM processed_messages")
            c.execute("DELETE FROM loop_logs")
            c.execute("DELETE FROM messages")
            c.execute("DELETE FROM waiting_queue")
            c.execute("DELETE FROM appointments")
            c.execute("DELETE FROM customers")
            c.execute(
                "UPDATE clients SET studio_name='Studio Leo', photographer_name='Leo', secretary_name='Ana', phone_number_id='9988776655' WHERE token='default_token_leo'"
            )
            conn.commit()
        self.test_phone = "5534999998877"

    # =========================================================================
    # PARTE 1: ANTI-LOOP TESTS (Tests 01 - 08)
    # =========================================================================

    def test_01_loop_idempotency_5x(self):
        """1. IDEMPOTÊNCIA: Sending same message_id 5x processes only 1x and logs LOOP_PREVENTED."""
        payload = {
            "object": "whatsapp_business_account",
            "entry": [{
                "changes": [{
                    "value": {
                        "contacts": [{"profile": {"name": "Maria"}}],
                        "messages": [{
                            "id": "wamid.IDEMPOTENT_TEST_001",
                            "from": self.test_phone,
                            "type": "text",
                            "text": {"body": "Oi"}
                        }]
                    }
                }]
            }]
        }
        raw = json.dumps(payload).encode("utf-8")
        headers = {"X-Hub-Signature-256": _sign_payload(raw), "Content-Type": "application/json"}

        for _ in range(5):
            res = self.client.post("/webhook", data=raw, headers=headers)
            self.assertEqual(res.status_code, 200)

        with get_db() as conn:
            c = conn.cursor()
            c.execute("SELECT COUNT(*) FROM messages WHERE client_phone = ? AND direction = 'client'", (self.test_phone,))
            client_msg_count = c.fetchone()[0]
            self.assertEqual(client_msg_count, 1, "Message with identical message_id sent 5x must be processed exactly 1x!")

            c.execute("SELECT COUNT(*) FROM loop_logs WHERE message_id = 'wamid.IDEMPOTENT_TEST_001'")
            blocked_count = c.fetchone()[0]
            self.assertEqual(blocked_count, 4, "Must log LOOP_BLOCKED 4 times for the 4 duplicate deliveries!")
        print("✓ [01/20] Idempotency test passed (5x same message_id -> processed 1x, blocked 4x)")

    def test_02_loop_echo_filter_phone_number_id(self):
        """2. FILTRO DE ECO (PHONE_NUMBER_ID): Messages from our own PHONE_NUMBER_ID are ignored."""
        msg = {
            "id": "wamid.ECHO_PHONE_ID",
            "from": "9988776655",  # Matches client's phone_number_id
            "type": "text",
            "text": {"body": "Oi! Aqui é a Ana"}
        }
        process_incoming_message("9988776655", msg, client_name="Bot")

        with get_db() as conn:
            c = conn.cursor()
            c.execute("SELECT COUNT(*) FROM messages WHERE client_phone = '9988776655'")
            self.assertEqual(c.fetchone()[0], 0)
            c.execute("SELECT motivo FROM loop_logs WHERE message_id = 'wamid.ECHO_PHONE_ID'")
            row = c.fetchone()
            self.assertIsNotNone(row)
            self.assertIn("FILTRO_DE_ECO", row["motivo"])
        print("✓ [02/20] Echo filter (PHONE_NUMBER_ID) test passed")

    def test_03_loop_echo_filter_bot_self(self):
        """3. FILTRO DE ECO (message.from == bot / from_me): Messages from bot are ignored immediately."""
        msg_bot = {"id": "wamid.ECHO_BOT", "from": "bot", "type": "text", "text": {"body": "Teste eco"}}
        process_incoming_message("bot", msg_bot)

        msg_from_me = {"id": "wamid.ECHO_FROM_ME", "from": self.test_phone, "from_me": True, "type": "text", "text": {"body": "Teste from_me"}}
        process_incoming_message(self.test_phone, msg_from_me)

        with get_db() as conn:
            c = conn.cursor()
            c.execute("SELECT COUNT(*) FROM messages")
            self.assertEqual(c.fetchone()[0], 0)
            c.execute("SELECT COUNT(*) FROM loop_logs WHERE motivo LIKE 'FILTRO_DE_ECO%'")
            self.assertEqual(c.fetchone()[0], 2)
        print("✓ [03/20] Echo filter (from == bot & from_me) test passed")

    def test_04_loop_status_filter_webhook(self):
        """4. FILTRO DE STATUS: Ignore status, read, delivered, and statuses array in webhook."""
        for invalid_type in ["status", "read", "delivered", "sent"]:
            payload = {"from": self.test_phone, "id": f"evt_{invalid_type}", "type": invalid_type}
            raw = json.dumps(payload).encode("utf-8")
            res = self.client.post(
                "/webhook",
                data=raw,
                headers={"X-Hub-Signature-256": _sign_payload(raw), "Content-Type": "application/json"}
            )
            self.assertEqual(res.status_code, 200)

        meta_status_payload = {
            "object": "whatsapp_business_account",
            "entry": [{"changes": [{"value": {"statuses": [{"id": "wamid.st1", "status": "read", "recipient_id": self.test_phone}]}}]}]
        }
        raw_meta = json.dumps(meta_status_payload).encode("utf-8")
        res_meta = self.client.post(
            "/webhook",
            data=raw_meta,
            headers={"X-Hub-Signature-256": _sign_payload(raw_meta), "Content-Type": "application/json"}
        )
        self.assertEqual(res_meta.status_code, 200)

        with get_db() as conn:
            c = conn.cursor()
            c.execute("SELECT COUNT(*) FROM messages")
            self.assertEqual(c.fetchone()[0], 0)
            c.execute("SELECT COUNT(*) FROM loop_logs WHERE motivo LIKE 'FILTRO_DE_STATUS%'")
            self.assertGreaterEqual(c.fetchone()[0], 5)
        print("✓ [04/20] Status filter (status/read/delivered/statuses) test passed")

    def test_05_loop_debounce_under_3_seconds(self):
        """5. DEBOUNCE: 2 messages from same wa_id in <3s are merged into one and processed only once."""
        msg1 = {"id": "wamid.DEB_1", "type": "text", "text": {"body": "Oi"}}
        msg2 = {"id": "wamid.DEB_2", "type": "text", "text": {"body": "quero ver ensaios"}}

        process_incoming_message(self.test_phone, msg1, client_name="Fernanda")
        process_incoming_message(self.test_phone, msg2, client_name="Fernanda")

        self.assertIn(self.test_phone, last_message_time)
        self.assertEqual(last_message_time[self.test_phone]["text"], "Oi quero ver ensaios")

        with get_db() as conn:
            c = conn.cursor()
            c.execute("SELECT content FROM messages WHERE client_phone = ? AND direction = 'client'", (self.test_phone,))
            client_rows = c.fetchall()
            self.assertEqual(len(client_rows), 1, "Rapid <3s messages must be coalesced into 1 client message!")
            self.assertEqual(client_rows[0]["content"], "Oi quero ver ensaios")

            c.execute("SELECT COUNT(*) FROM loop_logs WHERE motivo = 'DEBOUNCE_<3S_MERGED'")
            self.assertEqual(c.fetchone()[0], 1)
        print("✓ [05/20] Debounce (<3s merge in last_message_time) test passed")

    def test_06_loop_reengagement_status_lock(self):
        """6. TRAVA DE RE-ENGAJAMENTO: Only sends if status == WAITING_HUMAN, then changes to FOLLOWUP_SENT and never sends again in same cycle."""
        set_waiting_human(self.test_phone, client_name="Carla", message_content="Quero falar com o Leo")

        sent_first = trigger_reengagement_for_client(self.test_phone)
        self.assertTrue(sent_first)

        with get_db() as conn:
            c = conn.cursor()
            c.execute("SELECT status, followup_count FROM waiting_queue WHERE client_phone = ?", (self.test_phone,))
            row = c.fetchone()
            self.assertEqual(row["status"], "FOLLOWUP_SENT")
            self.assertEqual(row["followup_count"], 1)

        # Second attempt in the same cycle must be blocked because status is now FOLLOWUP_SENT
        sent_second = trigger_reengagement_for_client(self.test_phone)
        self.assertFalse(sent_second)
        print("✓ [06/20] Re-engagement status lock (WAITING_HUMAN -> FOLLOWUP_SENT) test passed")

    def test_07_loop_reengagement_max_2_limit(self):
        """7. LIMITE DE RE-ENGAJAMENTO: followup_count limited to maximum 2."""
        set_waiting_human(self.test_phone, client_name="Carla", message_content="Ciclo 1")
        self.assertTrue(trigger_reengagement_for_client(self.test_phone))  # count = 1

        # Start 2nd cycle
        set_waiting_human(self.test_phone, client_name="Carla", message_content="Ciclo 2")
        self.assertTrue(trigger_reengagement_for_client(self.test_phone))  # count = 2

        # Attempt 3rd cycle -> must be blocked because followup_count == 2!
        set_waiting_human(self.test_phone, client_name="Carla", message_content="Ciclo 3")
        self.assertFalse(trigger_reengagement_for_client(self.test_phone))

        with get_db() as conn:
            c = conn.cursor()
            c.execute("SELECT followup_count, status FROM waiting_queue WHERE client_phone = ?", (self.test_phone,))
            row = c.fetchone()
            self.assertEqual(row["followup_count"], 2)
            self.assertEqual(row["status"], "FOLLOWUP_SENT")
        print("✓ [07/20] Re-engagement followup_count <= 2 limit test passed")

    def test_08_loop_blocked_audit_log_format(self):
        """8. LOG DE LOOP: Verifies LOOP_BLOCKED, wa_id, message_id, motivo is written to security_loops.log and SQLite."""
        check_and_mark_idempotency("wamid.LOG_FORMAT_01", self.test_phone)
        check_and_mark_idempotency("wamid.LOG_FORMAT_01", self.test_phone)

        self.assertTrue(os.path.exists(LOOP_LOG_PATH))
        with open(LOOP_LOG_PATH, "r", encoding="utf-8") as f:
            log_text = f.read()
        self.assertIn("LOOP_BLOCKED, ***8877, wamid.LOG_FORMAT_01, IDEMPOTENCIA_MESSAGE_ID_DUPLICADO", log_text)
        print("✓ [08/20] LOOP_BLOCKED audit log format test passed")

    # =========================================================================
    # PARTE 2: TOTAL DATA SECURITY & LGPD TESTS (Tests 09 - 20)
    # =========================================================================

    def test_09_webhook_hmac_invalid_returns_403(self):
        """9. WEBHOOK HMAC INVÁLIDO: Invalid or missing X-Hub-Signature-256 must return 403."""
        payload = json.dumps({"from": self.test_phone, "type": "text", "text": {"body": "Oi"}}).encode("utf-8")

        res_no_sig = self.client.post("/webhook", data=payload, content_type="application/json")
        self.assertEqual(res_no_sig.status_code, 403)

        res_bad_sig = self.client.post(
            "/webhook",
            data=payload,
            headers={"X-Hub-Signature-256": "sha256=00000000000000000000000000000000", "Content-Type": "application/json"}
        )
        self.assertEqual(res_bad_sig.status_code, 403)
        print("✓ [09/20] Invalid HMAC SHA256 returns 403 Forbidden test passed")

    def test_10_webhook_hmac_valid_returns_200(self):
        """10. WEBHOOK HMAC VÁLIDO: Valid X-Hub-Signature-256 signed with APP_SECRET returns 200."""
        payload = json.dumps({"from": self.test_phone, "id": "wamid.VALID_HMAC", "type": "text", "text": {"body": "Oi"}}).encode("utf-8")
        sig = _sign_payload(payload)
        res = self.client.post(
            "/webhook",
            data=payload,
            headers={"X-Hub-Signature-256": sig, "Content-Type": "application/json"}
        )
        self.assertEqual(res.status_code, 200)
        print("✓ [10/20] Valid HMAC SHA256 returns 200 OK test passed")

    def test_11_webhook_get_verify_token_strict(self):
        """11. WEBHOOK GET VERIFY_TOKEN: Rejects missing/wrong token with 403, accepts valid token with 200."""
        res_missing = self.client.get("/webhook")
        self.assertEqual(res_missing.status_code, 403)

        res_wrong = self.client.get("/webhook?hub.mode=subscribe&hub.verify_token=wrong_token&hub.challenge=12345")
        self.assertEqual(res_wrong.status_code, 403)

        res_ok = self.client.get(f"/webhook?hub.mode=subscribe&hub.verify_token={WHATSAPP_VERIFY_TOKEN}&hub.challenge=987654")
        self.assertEqual(res_ok.status_code, 200)
        self.assertEqual(res_ok.data.decode("utf-8"), "987654")
        print("✓ [11/20] Webhook GET verify_token validation test passed")

    def test_12_sql_injection_customer_and_onboarding(self):
        """12. SQL INJECTION: Parameterized queries (?) block ' ; DROP TABLE and static code scan finds 0 f-string SQL."""
        sqli_payload = "'; DROP TABLE clients; DROP TABLE customers; --"

        # 1. Onboarding API must reject SQLi payload with 400
        res = self.client.post("/api/client/config", json={
            "token": "default_token_leo",
            "studio_name": sqli_payload,
            "photographer_name": "Leo"
        })
        self.assertEqual(res.status_code, 400)

        # 2. Even if passed directly to DB helper, parameterized queries keep tables intact
        process_incoming_message(self.test_phone, {"type": "text", "text": {"body": sqli_payload}}, client_name=sqli_payload)
        with get_db() as conn:
            c = conn.cursor()
            c.execute("SELECT COUNT(*) FROM clients")
            self.assertGreaterEqual(c.fetchone()[0], 1, "clients table must remain intact!")
            c.execute("SELECT COUNT(*) FROM customers")
            self.assertGreaterEqual(c.fetchone()[0], 1, "customers table must remain intact!")

        # 3. Static scan of main.py for f-string inside cursor.execute
        main_py_path = os.path.join(os.path.dirname(DB_PATH), "main.py")
        with open(main_py_path, "r", encoding="utf-8") as f:
            code = f.read()
        fstring_sql_matches = re.findall(r"cursor\.execute\(\s*f[\"']", code)
        self.assertEqual(len(fstring_sql_matches), 0, "Zero f-string SQL queries allowed in main.py!")
        print("✓ [12/20] SQL Injection defense & zero f-string SQL audit passed")

    def test_13_xss_blocking_in_onboarding_and_comecar(self):
        """13. XSS NO ONBOARDING E COMECAR: Blocks <script> and event handlers with 400."""
        xss_payloads = [
            "<script>alert('xss')</script>",
            "<img src=x onerror=alert(1)>",
            "javascript:alert(1)"
        ]
        for xss in xss_payloads:
            res_onb = self.client.post("/api/client/config", json={
                "token": "default_token_leo",
                "studio_name": xss,
                "photographer_name": "Leo",
                "secretary_name": "Ana"
            })
            self.assertEqual(res_onb.status_code, 400)

            res_com = self.client.post("/api/client/embedded_signup", json={
                "token": "default_token_leo",
                "code_1": xss,
                "code_2": "123456"
            })
            self.assertEqual(res_com.status_code, 400)
        print("✓ [13/20] XSS protection in /onboarding and /comecar test passed")

    def test_14_input_max_length_50_chars_validation(self):
        """14. VALIDAÇÃO DE TAMANHO: Names > 50 chars are rejected in /onboarding."""
        long_name = "A" * 51
        res = self.client.post("/api/client/config", json={
            "token": "default_token_leo",
            "studio_name": long_name,
            "photographer_name": "Leo",
            "secretary_name": "Ana"
        })
        self.assertEqual(res.status_code, 400)
        self.assertIn("50", res.get_json().get("error", ""))
        print("✓ [14/20] Input max length (50 chars) validation test passed")

    def test_15_gitignore_and_env_example_no_secrets(self):
        """15. .ENV NUNCA NO GIT: Verifies .gitignore contains .env, *.db, __pycache__ and .env.example has no real secrets."""
        base_dir = os.path.dirname(DB_PATH)
        gitignore_path = os.path.join(base_dir, ".gitignore")
        env_example_path = os.path.join(base_dir, ".env.example")

        self.assertTrue(os.path.exists(gitignore_path))
        with open(gitignore_path, "r", encoding="utf-8") as f:
            gi_content = f.read()
        self.assertIn(".env", gi_content)
        self.assertIn("*.db", gi_content)
        self.assertIn("__pycache__", gi_content)

        self.assertTrue(os.path.exists(env_example_path))
        with open(env_example_path, "r", encoding="utf-8") as f:
            env_ex = f.read()
        self.assertNotIn("EAAG", env_ex)
        self.assertNotIn("AIza", env_ex)
        self.assertNotIn("ergIym4muheOPQGvRrj0JMfysv8xJDnnDMNd92N4Ggg=", env_ex)
        print("✓ [15/20] .gitignore & .env.example security verification passed")

    def test_16_fernet_encryption_whatsapp_token(self):
        """16. CRIPTOGRAFIA FERNET (WHATSAPP_TOKEN): Encrypted at rest in SQLite, decrypted on read."""
        secret_wa_token = "EAAG_SUPER_SECRET_META_TOKEN_2026_XYZ"
        res = self.client.post("/api/client/activate_whatsapp", json={
            "token": "default_token_leo",
            "whatsapp_token": secret_wa_token,
            "phone_number_id": "1122334455"
        })
        self.assertEqual(res.status_code, 200)

        # Verify raw value in SQLite is encrypted with Fernet (starts with gAAAA)
        with get_db() as conn:
            c = conn.cursor()
            c.execute("SELECT whatsapp_token FROM clients WHERE token = 'default_token_leo'")
            raw_db_token = c.fetchone()["whatsapp_token"]
            self.assertNotEqual(raw_db_token, secret_wa_token)
            self.assertTrue(raw_db_token.startswith("gAAAA"), "Token in SQLite must be Fernet ciphertext!")

        # Verify application read decrypts transparently
        cfg = get_active_client_config("default_token_leo")
        self.assertEqual(cfg["whatsapp_token"], secret_wa_token)
        print("✓ [16/20] Fernet encryption for WHATSAPP_TOKEN at rest & decryption on read passed")

    def test_17_fernet_encryption_audio_transcriptions(self):
        """17. CRIPTOGRAFIA FERNET (TRANSCRIÇÕES DE ÁUDIO): Encrypted at rest in SQLite, decrypted on read."""
        audio_msg = {
            "id": "wamid.AUDIO_ENC_TEST",
            "type": "audio",
            "audio": {"id": "aud_01", "url": "/uploads/test.ogg"}
        }
        process_incoming_message(self.test_phone, audio_msg, client_name=" Rodrigo ")

        with get_db() as conn:
            c = conn.cursor()
            c.execute("SELECT transcription FROM messages WHERE client_phone = ? AND message_type = 'audio'", (self.test_phone,))
            raw_msg_trans = c.fetchone()["transcription"]
            self.assertTrue(raw_msg_trans.startswith("gAAAA"), "Audio transcription in messages table must be Fernet-encrypted!")

            c.execute("SELECT transcription FROM waiting_queue WHERE client_phone = ?", (self.test_phone,))
            raw_queue_trans = c.fetchone()["transcription"]
            self.assertTrue(raw_queue_trans.startswith("gAAAA"), "Audio transcription in waiting_queue must be Fernet-encrypted!")

        # Verify /api/messages decrypts it transparently
        res_msgs = self.client.get(f"/api/messages?phone={self.test_phone}")
        msgs_json = res_msgs.get_json()["messages"]
        audio_items = [m for m in msgs_json if m["message_type"] == "audio"]
        self.assertEqual(len(audio_items), 1)
        self.assertNotIn("gAAAA", audio_items[0]["transcription"])
        self.assertIn("horário", audio_items[0]["transcription"])
        print("✓ [17/20] Fernet encryption for audio transcriptions at rest & decryption on read passed")

    def test_18_sensitive_data_log_masking(self):
        """18. DADOS SENSÍVEIS: Masks phone numbers to last 4 digits and redacts tokens in logs."""
        self.assertEqual(mask_phone("5534999991234"), "***1234")
        self.assertEqual(mask_phone("5534988412981@s.whatsapp.net"), "***2981")

        sample_log = "Enviando para +5534999991234 com Authorization: Bearer EAAG1234567890SECRET"
        masked_log = mask_sensitive_log_text(sample_log)
        self.assertNotIn("5534999991234", masked_log)
        self.assertIn("***1234", masked_log)
        self.assertNotIn("EAAG1234567890SECRET", masked_log)
        self.assertIn("[TOKEN_REDACTED]", masked_log)
        print("✓ [18/20] Sensitive data masking (last 4 digits & token redaction) test passed")

    def test_19_lgpd_export_and_1click_delete(self):
        """19. LGPD: /lgpd/export/:wa_id exports JSON and /lgpd/delete/:wa_id deletes all client data in 1 click."""
        process_incoming_message(self.test_phone, {"type": "text", "text": {"body": "Quero falar com o Leo"}}, client_name="Larissa")

        # 1. Export client data
        res_exp = self.client.get(f"/lgpd/export/{self.test_phone}")
        self.assertEqual(res_exp.status_code, 200)
        exp_data = res_exp.get_json()
        self.assertTrue(exp_data["lgpd_export"])
        self.assertEqual(exp_data["wa_id"], self.test_phone)
        self.assertIsNotNone(exp_data["customer"])
        self.assertGreaterEqual(len(exp_data["messages"]), 1)

        # 2. Delete all client data in 1 click
        res_del = self.client.delete(f"/lgpd/delete/{self.test_phone}")
        self.assertEqual(res_del.status_code, 200)
        self.assertTrue(res_del.get_json()["lgpd_compliant"])

        # 3. Verify zero records remain in messages, appointments, waiting_queue, customers
        with get_db() as conn:
            c = conn.cursor()
            for tbl, col in [
                ("messages", "client_phone"),
                ("appointments", "client_phone"),
                ("waiting_queue", "client_phone"),
                ("customers", "phone_number"),
            ]:
                c.execute(f"SELECT COUNT(*) FROM {tbl} WHERE {col} = ?", (self.test_phone,))
                self.assertEqual(c.fetchone()[0], 0, f"Table {tbl} must have 0 records for {self.test_phone} after LGPD delete!")
        print("✓ [19/20] LGPD /lgpd/export/:wa_id and /lgpd/delete/:wa_id test passed")

    def test_20_rate_limit_60_per_minute_and_encrypted_backup(self):
        """20. RATE LIMIT (60 req/min -> 429) & BACKUP CRIPTOGRAFADO (backup.py)."""
        # Part A: Test encrypted SQLite backup creation & password decryption
        with tempfile.TemporaryDirectory() as tmpdir:
            enc_path = os.path.join(tmpdir, "test_backup.db.enc")
            out_path = create_encrypted_backup(password="SenhaForteLGPD2026!", output_path=enc_path)
            self.assertTrue(os.path.exists(out_path))

            # Raw file must not contain plaintext SQL
            with open(out_path, "rb") as f:
                raw_bytes = f.read()
            self.assertNotIn(b"CREATE TABLE", raw_bytes)

            # Correct password decrypts SQL dump
            decrypted_sql = decrypt_backup(out_path, password="SenhaForteLGPD2026!")
            self.assertIn("CREATE TABLE", decrypted_sql)

            # Wrong password raises InvalidToken
            with self.assertRaises(InvalidToken):
                decrypt_backup(out_path, password="SenhaErrada")

        # Part B: Test Rate Limiting on /webhook (60 req/min per IP -> 429 on 61st request)
        limiter.reset()
        url = f"/webhook?hub.mode=subscribe&hub.verify_token={WHATSAPP_VERIFY_TOKEN}&hub.challenge=ok"
        status_codes = []
        for _ in range(65):
            r = self.client.get(url)
            status_codes.append(r.status_code)

        self.assertIn(200, status_codes[:60])
        self.assertIn(429, status_codes[60:], "Requests exceeding 60 req/min on /webhook must return HTTP 429!")
        limiter.reset()
        print("✓ [20/20] Rate limiting (60 req/min -> 429) & encrypted SQLite backup (backup.py) test passed")


if __name__ == "__main__":
    unittest.main()
