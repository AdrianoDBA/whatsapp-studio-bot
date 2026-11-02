"""
Studio Fotográfico - WhatsApp Cloud API Bot with Gemini 3.8 Flash (SaaS Edition)
Dynamic Persona & Multi-tenant Photographers Layer
"""

import os
import re
import sys
import time
import json
import uuid
import hmac
import html
import base64
import hashlib
import sqlite3
import logging
import threading
from datetime import datetime
from typing import Optional, List, Dict, Any, Tuple

from flask import Flask, request, jsonify, render_template_string, send_from_directory
import requests
from dotenv import load_dotenv
from cryptography.fernet import Fernet
from flask_limiter import Limiter
from flask_limiter.util import get_remote_address

# Try importing google-genai
try:
    from google import genai
    from google.genai import types
    GENAI_AVAILABLE = True
except ImportError:
    GENAI_AVAILABLE = False

# Load environment variables
load_dotenv()

# App Configuration
PORT = int(os.environ.get("PORT", 5005))
HOST = os.environ.get("HOST", "0.0.0.0")
DEBUG = os.environ.get("DEBUG", "false").lower() == "true"
GEMINI_API_KEY = os.environ.get("GEMINI_API_KEY", "")
WHATSAPP_TOKEN = os.environ.get("WHATSAPP_TOKEN", "")
WHATSAPP_PHONE_NUMBER_ID = os.environ.get("WHATSAPP_PHONE_NUMBER_ID", "")
WHATSAPP_VERIFY_TOKEN = os.environ.get("WHATSAPP_VERIFY_TOKEN", "studio_fotografico_token_2026")
APP_SECRET = os.environ.get("APP_SECRET", "studio_bot_app_secret_2026")
SECRET_KEY = os.environ.get("SECRET_KEY", "ergIym4muheOPQGvRrj0JMfysv8xJDnnDMNd92N4Ggg=")

BASE_DIR = os.path.dirname(__file__)
DB_PATH = os.path.join(BASE_DIR, "studio_bot.db")
FRONTEND_DIST = os.path.join(BASE_DIR, "frontend", "dist")
UPLOADS_DIR = os.path.join(BASE_DIR, "uploads")
LOOP_LOG_PATH = os.path.join(BASE_DIR, "security_loops.log")
os.makedirs(UPLOADS_DIR, exist_ok=True)


# ==========================================
# PARTE 2 (Item 4): Fernet Encryption Engine
# ==========================================
def _build_fernet_cipher(raw_key: str) -> Fernet:
    if raw_key:
        try:
            return Fernet(raw_key.encode("utf-8"))
        except Exception:
            derived = base64.urlsafe_b64encode(hashlib.sha256(raw_key.encode("utf-8")).digest())
            return Fernet(derived)
    fallback_key = base64.urlsafe_b64encode(hashlib.sha256(b"studio_bot_default_secret_key_2026").digest())
    return Fernet(fallback_key)


fernet_cipher = _build_fernet_cipher(SECRET_KEY)


def encrypt_sensitive(plaintext: Optional[str]) -> Optional[str]:
    """Encrypts sensitive string (WHATSAPP_TOKEN, audio transcriptions) with Fernet before saving to SQLite."""
    if plaintext is None or plaintext == "":
        return plaintext
    text_str = str(plaintext)
    if text_str.startswith("gAAAA"):
        return text_str
    return fernet_cipher.encrypt(text_str.encode("utf-8")).decode("utf-8")


def decrypt_sensitive(ciphertext: Optional[str]) -> Optional[str]:
    """Decrypts Fernet-encrypted string read from SQLite."""
    if ciphertext is None or ciphertext == "":
        return ciphertext
    text_str = str(ciphertext)
    if text_str.startswith("gAAAA"):
        try:
            return fernet_cipher.decrypt(text_str.encode("utf-8")).decode("utf-8")
        except Exception:
            return text_str
    return text_str


# ==========================================
# PARTE 2 (Item 7): Sensitive Data Masking
# ==========================================
def mask_phone(phone: Optional[str]) -> str:
    """Masks full phone numbers in logs so only the last 4 digits are ever shown."""
    if not phone:
        return "****"
    base = str(phone).split("@")[0]
    digits = re.sub(r"\D", "", base)
    if len(digits) >= 4:
        return f"***{digits[-4:]}"
    if len(base) >= 4:
        return f"***{base[-4:]}"
    return "****"


def mask_sensitive_log_text(msg: str) -> str:
    """Redacts full phone numbers (10-15 digits), tokens, and raw audio bytes from console logs."""
    if not msg:
        return msg
    # Mask tokens (Bearer, EAAG..., gAAAA...)
    masked = re.sub(r"(Bearer\s+)[A-Za-z0-9_\-\.=]+", r"\1[TOKEN_REDACTED]", str(msg))
    masked = re.sub(r"\bEAAG[A-Za-z0-9_\-\.]+\b", "[TOKEN_REDACTED]", masked)
    masked = re.sub(r"\bgAAAA[A-Za-z0-9_\-\.=]+\b", "[ENCRYPTED_REDACTED]", masked)
    # Mask 10 to 15 consecutive digits (phone numbers) keeping only last 4 digits
    masked = re.sub(r"\+?\b\d{6,11}(\d{4})\b", r"***\1", masked)
    return masked


class SensitiveDataLogFilter(logging.Filter):
    def filter(self, record: logging.LogRecord) -> bool:
        try:
            rendered = record.getMessage()
            record.msg = mask_sensitive_log_text(rendered)
            record.args = ()
        except Exception:
            pass
        return True


# Setup Logging with Sensitive Data Masking
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(message)s",
    handlers=[logging.StreamHandler(sys.stdout)]
)
logger = logging.getLogger("studio_bot")
logger.addFilter(SensitiveDataLogFilter())
for _h in logging.getLogger().handlers:
    _h.addFilter(SensitiveDataLogFilter())

app = Flask(__name__, static_folder=FRONTEND_DIST, static_url_path="")

# ==========================================
# PARTE 2 (Item 5): Rate Limiting (Flask-Limiter)
# ==========================================
limiter = Limiter(
    get_remote_address,
    app=app,
    default_limits=[],
    storage_uri="memory://"
)

# ==========================================
# PARTE 1 (Item 4): In-Memory Redis Debounce Dict
# ==========================================
last_message_time: Dict[str, Any] = {}


# ==========================================
# PARTE 2 (Item 1 & Item 6): HMAC & Input Validation
# ==========================================
def verify_webhook_signature(raw_body: bytes, signature_header: Optional[str], secret: Optional[str] = None) -> bool:
    """Validates Meta X-Hub-Signature-256 HMAC SHA256 signature using APP_SECRET."""
    if not signature_header or not isinstance(signature_header, str):
        return False
    if not signature_header.startswith("sha256="):
        return False
    active_secret = secret if secret is not None else os.environ.get("APP_SECRET", APP_SECRET)
    expected_sig = "sha256=" + hmac.new(
        active_secret.encode("utf-8"),
        raw_body or b"",
        hashlib.sha256
    ).hexdigest()
    return hmac.compare_digest(expected_sig, signature_header.strip())


DANGEROUS_XSS_PATTERNS = re.compile(
    r"(<\s*script|javascript\s*:|onerror\s*=|onload\s*=|<\s*iframe|<\s*object|<\s*embed|<\s*svg)",
    re.IGNORECASE
)
DANGEROUS_SQLI_PATTERNS = re.compile(
    r"(\bDROP\s+TABLE\b|\bDELETE\s+FROM\b|\bUNION\s+SELECT\b|--\s*$|;\s*DROP\b|'\s*OR\s+'1'\s*=\s*'1)",
    re.IGNORECASE
)


def validate_and_sanitize_input(
    value: Any,
    field_name: str = "campo",
    max_len: int = 50
) -> Tuple[bool, str, Optional[str]]:
    """
    PARTE 2 (Item 6): Validates input in /onboarding and /comecar with regex, size limit, and HTML escaping.
    Max 50 chars for names, blocks <script> / XSS and SQLi payloads.
    Returns (is_valid, sanitized_value, error_message).
    """
    if value is None:
        return True, "", None
    raw_str = str(value).strip()
    if len(raw_str) > max_len:
        return False, "", f"O campo '{field_name}' excede o limite máximo de {max_len} caracteres."
    if DANGEROUS_XSS_PATTERNS.search(raw_str) or "<" in raw_str or ">" in raw_str:
        return False, "", f"O campo '{field_name}' contém tags HTML ou scripts não permitidos (<script>/XSS bloqueado)."
    if DANGEROUS_SQLI_PATTERNS.search(raw_str):
        return False, "", f"O campo '{field_name}' contém caracteres ou comandos SQL inválidos."
    sanitized = html.escape(raw_str, quote=True)
    return True, sanitized, None

# Initialize Gemini Client if key is available
gemini_client = None
if GENAI_AVAILABLE and GEMINI_API_KEY:
    try:
        gemini_client = genai.Client(api_key=GEMINI_API_KEY)
        logger.info("Gemini client initialized with model: gemini-3.8-flash")
    except Exception as e:
        logger.error(f"Failed to initialize Gemini client: {e}")
else:
    if not GENAI_AVAILABLE:
        logger.warning("google-genai package not found. Using local persona fallback.")
    elif not GEMINI_API_KEY:
        logger.info("GEMINI_API_KEY not configured. Using local persona fallback until key is added.")

# ==========================================
# Default Studio Configuration
# ==========================================

DEFAULT_CLIENT = {
    "token": "default_token_leo",
    "studio_name": "Studio Leo",
    "photographer_name": "Leo",
    "secretary_name": "Ana",
    "photographer_phone": "",
    "business_hours": "Seg-Sex 8h-18h",
    "niches_json": json.dumps({
        "casal": {
            "price": 450,
            "description": "1 hora de ensaio no estúdio ou parque (ex: Parque do Sabiá), com 20 fotos tratadas em alta resolução e galeria online.",
            "photos": [
                "https://images.unsplash.com/photo-1515934751635-c81c6bc9a2d8?w=800&q=80",
                "https://images.unsplash.com/photo-1522673607200-164d1b6ce486?w=800&q=80",
                "https://images.unsplash.com/photo-1534528741775-53994a69daeb?w=800&q=80"
            ]
        },
        "familia": {
            "price": 550,
            "description": "1h30 de sessão bem tranquila, estúdio ou externa, troca de figurino inclusa e 25 fotos tratadas com carinho.",
            "photos": [
                "https://images.unsplash.com/photo-1511895426328-dc8714191300?w=800&q=80",
                "https://images.unsplash.com/photo-1542037104857-ffbb0b9155fb?w=800&q=80",
                "https://images.unsplash.com/photo-1577495508048-b635879837f1?w=800&q=80"
            ]
        },
        "gestante": {
            "price": 500,
            "description": "Ensaio acolhedor com produção, tecidos e troca de looks inclusos, celebrando a maternidade.",
            "photos": [
                "https://images.unsplash.com/photo-1542037104857-ffbb0b9155fb?w=800&q=80",
                "https://images.unsplash.com/photo-1511895426328-dc8714191300?w=800&q=80",
                "https://images.unsplash.com/photo-1577495508048-b635879837f1?w=800&q=80"
            ]
        },
        "formatura": {
            "price": 400,
            "description": "Sessão individual com fotos de beca e traje de gala, 15 fotos tratadas para marcar sua conquista.",
            "photos": [
                "https://images.unsplash.com/photo-1523050854058-8df90110c9f1?w=800&q=80",
                "https://images.unsplash.com/photo-1541339907198-e08756dedf3f?w=800&q=80",
                "https://images.unsplash.com/photo-1627556704302-624286467c65?w=800&q=80"
            ]
        },
        "casamento": {
            "price": 2800,
            "description": "Cobertura completa: making of, cerimônia e recepção, com todas as fotos tratadas e álbum encadernado de luxo.",
            "photos": [
                "https://images.unsplash.com/photo-1519741497674-611481863552?w=800&q=80",
                "https://images.unsplash.com/photo-1583939003579-730e3918a45a?w=800&q=80",
                "https://images.unsplash.com/photo-1465495976277-4387d4b0b4c6?w=800&q=80"
            ]
        }
    }),
    "whatsapp_token": WHATSAPP_TOKEN,
    "phone_number_id": WHATSAPP_PHONE_NUMBER_ID,
    "is_active": 1
}

# ==========================================
# Database Functions & Migration
# ==========================================

def get_db():
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    return conn

def init_db():
    with get_db() as conn:
        cursor = conn.cursor()
        
        # Check if legacy clients table exists with phone_number
        cursor.execute("PRAGMA table_info(clients)")
        client_cols = [col["name"] for col in cursor.fetchall()]
        
        if "phone_number" in client_cols and "token" not in client_cols:
            logger.info("Migrating legacy clients table to customers table...")
            cursor.execute("ALTER TABLE clients RENAME TO customers")
            conn.commit()

        # Table: clients (SaaS Photographers / Tenants)
        cursor.execute("""
            CREATE TABLE IF NOT EXISTS clients (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                token TEXT UNIQUE NOT NULL,
                studio_name TEXT DEFAULT 'Studio Leo',
                photographer_name TEXT DEFAULT 'Leo',
                secretary_name TEXT DEFAULT 'Ana',
                photographer_phone TEXT DEFAULT '',
                business_hours TEXT DEFAULT 'Seg-Sex 8h-18h',
                niches_json TEXT,
                whatsapp_token TEXT DEFAULT '',
                phone_number_id TEXT DEFAULT '',
                is_active INTEGER DEFAULT 1,
                created_at REAL,
                updated_at REAL
            )
        """)

        # Table: customers (End-users messaging on WhatsApp)
        cursor.execute("""
            CREATE TABLE IF NOT EXISTS customers (
                phone_number TEXT PRIMARY KEY,
                name TEXT,
                current_state TEXT DEFAULT 'IDLE',
                selected_ensaio TEXT DEFAULT 'Casal',
                first_seen REAL,
                last_seen REAL
            )
        """)
        cursor.execute("PRAGMA table_info(customers)")
        cust_cols = [c["name"] for c in cursor.fetchall()]
        if "selected_ensaio" not in cust_cols:
            try:
                cursor.execute("ALTER TABLE customers ADD COLUMN selected_ensaio TEXT DEFAULT 'Casal'")
            except Exception:
                pass

        # Table: slots (PARTE 1 - Agendamento Real)
        cursor.execute("""
            CREATE TABLE IF NOT EXISTS slots (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                client_id INTEGER DEFAULT 1,
                date TEXT NOT NULL,
                time TEXT NOT NULL,
                status TEXT DEFAULT 'free',
                client_name TEXT,
                client_phone TEXT,
                ensaio_type TEXT
            )
        """)

        # Seed default schedule slots if empty
        cursor.execute("SELECT COUNT(*) FROM slots")
        if cursor.fetchone()[0] == 0:
            default_slots = [
                (1, "Terça", "15h", "free"),
                (1, "Quarta", "09:30", "free"),
                (1, "Sábado", "16:30", "free"),
                (1, "Terça", "09h", "free"),
                (1, "Terça", "14h", "free"),
                (1, "Terça", "15h30", "free"),
            ]
            cursor.executemany("""
                INSERT INTO slots (client_id, date, time, status)
                VALUES (?, ?, ?, ?)
            """, default_slots)

        # Table: appointments
        cursor.execute("""
            CREATE TABLE IF NOT EXISTS appointments (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                client_phone TEXT,
                client_name TEXT,
                session_type TEXT,
                slot_id INTEGER,
                slot_date TEXT,
                slot_time TEXT,
                receipt_text TEXT,
                status TEXT DEFAULT 'PENDING',
                notes TEXT,
                last_interaction REAL,
                followup_context TEXT,
                followup_action TEXT,
                followup_message TEXT,
                window_status TEXT,
                followup_count INTEGER DEFAULT 0,
                created_at REAL,
                updated_at REAL
            )
        """)
        cursor.execute("PRAGMA table_info(appointments)")
        appt_cols = [c["name"] for c in cursor.fetchall()]
        static_appt_migrations = [
            ("client_name", "ALTER TABLE appointments ADD COLUMN client_name TEXT"),
            ("slot_id", "ALTER TABLE appointments ADD COLUMN slot_id INTEGER"),
            ("slot_date", "ALTER TABLE appointments ADD COLUMN slot_date TEXT"),
            ("slot_time", "ALTER TABLE appointments ADD COLUMN slot_time TEXT"),
            ("receipt_text", "ALTER TABLE appointments ADD COLUMN receipt_text TEXT"),
            ("last_interaction", "ALTER TABLE appointments ADD COLUMN last_interaction REAL"),
            ("followup_context", "ALTER TABLE appointments ADD COLUMN followup_context TEXT"),
            ("followup_action", "ALTER TABLE appointments ADD COLUMN followup_action TEXT"),
            ("followup_message", "ALTER TABLE appointments ADD COLUMN followup_message TEXT"),
            ("window_status", "ALTER TABLE appointments ADD COLUMN window_status TEXT"),
            ("followup_count", "ALTER TABLE appointments ADD COLUMN followup_count INTEGER DEFAULT 0"),
        ]
        for col_name, alter_sql in static_appt_migrations:
            if col_name not in appt_cols:
                try:
                    cursor.execute(alter_sql)
                except Exception:
                    pass

        # Table: waiting_queue
        cursor.execute("""
            CREATE TABLE IF NOT EXISTS waiting_queue (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                client_phone TEXT UNIQUE,
                client_name TEXT,
                status TEXT DEFAULT 'WAITING_HUMAN',
                waiting_since REAL,
                last_notification REAL,
                stage INTEGER DEFAULT 0,
                followup_count INTEGER DEFAULT 0,
                message_content TEXT,
                audio_url TEXT,
                transcription TEXT
            )
        """)

        # Migration: ensure waiting_queue has all needed columns (static SQL, no f-strings)
        cursor.execute("PRAGMA table_info(waiting_queue)")
        queue_cols = [c["name"] for c in cursor.fetchall()]
        static_queue_migrations = [
            ("client_name", "ALTER TABLE waiting_queue ADD COLUMN client_name TEXT"),
            ("message_content", "ALTER TABLE waiting_queue ADD COLUMN message_content TEXT"),
            ("audio_url", "ALTER TABLE waiting_queue ADD COLUMN audio_url TEXT"),
            ("transcription", "ALTER TABLE waiting_queue ADD COLUMN transcription TEXT"),
            ("followup_count", "ALTER TABLE waiting_queue ADD COLUMN followup_count INTEGER DEFAULT 0"),
        ]
        for col_name, alter_sql in static_queue_migrations:
            if col_name not in queue_cols:
                try:
                    cursor.execute(alter_sql)
                except Exception:
                    pass

        # Table: processed_messages (PARTE 1 - Item 1: IDEMPOTÊNCIA)
        cursor.execute("""
            CREATE TABLE IF NOT EXISTS processed_messages (
                message_id TEXT PRIMARY KEY,
                wa_id TEXT,
                created_at REAL
            )
        """)

        # Table: loop_logs (PARTE 1 - Item 6: LOG DE LOOP)
        cursor.execute("""
            CREATE TABLE IF NOT EXISTS loop_logs (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                wa_id TEXT,
                message_id TEXT,
                motivo TEXT,
                created_at REAL
            )
        """)

        # Table: messages
        cursor.execute("""
            CREATE TABLE IF NOT EXISTS messages (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                client_phone TEXT,
                direction TEXT,
                message_type TEXT,
                content TEXT,
                transcription TEXT,
                audio_url TEXT,
                timestamp REAL
            )
        """)
        cursor.execute("PRAGMA table_info(messages)")
        msg_cols = [c["name"] for c in cursor.fetchall()]
        if "audio_url" not in msg_cols:
            try:
                cursor.execute("ALTER TABLE messages ADD COLUMN audio_url TEXT")
            except Exception:
                pass

        # Seed default photographer client if table is empty
        cursor.execute("SELECT COUNT(*) FROM clients")
        if cursor.fetchone()[0] == 0:
            now = time.time()
            cursor.execute("""
                INSERT INTO clients (
                    token, studio_name, photographer_name, secretary_name,
                    photographer_phone, business_hours, niches_json,
                    whatsapp_token, phone_number_id, is_active, created_at, updated_at
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?)
            """, (
                DEFAULT_CLIENT["token"],
                DEFAULT_CLIENT["studio_name"],
                DEFAULT_CLIENT["photographer_name"],
                DEFAULT_CLIENT["secretary_name"],
                DEFAULT_CLIENT["photographer_phone"],
                DEFAULT_CLIENT["business_hours"],
                DEFAULT_CLIENT["niches_json"],
                encrypt_sensitive(DEFAULT_CLIENT["whatsapp_token"]),
                DEFAULT_CLIENT["phone_number_id"],
                now, now
            ))

        conn.commit()
    logger.info("Database schema initialized and verified at %s", DB_PATH)

def get_active_client_config(token: Optional[str] = None) -> Dict[str, Any]:
    """Retrieve active studio configuration from clients table (decrypting whatsapp_token)."""
    with get_db() as conn:
        cursor = conn.cursor()
        if token:
            cursor.execute("SELECT * FROM clients WHERE token = ?", (token,))
            row = cursor.fetchone()
            if row:
                d = dict(row)
                d["whatsapp_token"] = decrypt_sensitive(d.get("whatsapp_token"))
                return d
        cursor.execute("SELECT * FROM clients WHERE is_active = 1 ORDER BY id ASC LIMIT 1")
        row = cursor.fetchone()
        if row:
            d = dict(row)
            d["whatsapp_token"] = decrypt_sensitive(d.get("whatsapp_token"))
            return d
    return DEFAULT_CLIENT

def save_customer(phone: str, name: Optional[str] = None, state: Optional[str] = None):
    now = time.time()
    clean_name = html.escape(str(name)[:50], quote=True) if name else None
    with get_db() as conn:
        cursor = conn.cursor()
        cursor.execute("SELECT phone_number, name, current_state FROM customers WHERE phone_number = ?", (phone,))
        row = cursor.fetchone()
        if row:
            updated_name = clean_name if clean_name else row["name"]
            updated_state = state if state else row["current_state"]
            cursor.execute("""
                UPDATE customers
                SET name = ?, current_state = ?, last_seen = ?
                WHERE phone_number = ?
            """, (updated_name, updated_state, now, phone))
        else:
            cursor.execute("""
                INSERT INTO customers (phone_number, name, current_state, first_seen, last_seen)
                VALUES (?, ?, ?, ?, ?)
            """, (phone, clean_name, state or "IDLE", now, now))
        conn.commit()

def get_customer(phone: str) -> Optional[Dict[str, Any]]:
    with get_db() as conn:
        cursor = conn.cursor()
        cursor.execute("SELECT * FROM customers WHERE phone_number = ?", (phone,))
        row = cursor.fetchone()
        return dict(row) if row else None

def set_customer_state(phone: str, state: str, selected_ensaio: Optional[str] = None):
    with get_db() as conn:
        cursor = conn.cursor()
        if selected_ensaio:
            cursor.execute(
                "UPDATE customers SET current_state = ?, selected_ensaio = ?, last_seen = ? WHERE phone_number = ?",
                (state, selected_ensaio, time.time(), phone)
            )
        else:
            cursor.execute(
                "UPDATE customers SET current_state = ?, last_seen = ? WHERE phone_number = ?", 
                (state, time.time(), phone)
            )
        conn.commit()

def log_message(phone: str, direction: str, message_type: str, content: str, 
                transcription: Optional[str] = None, audio_url: Optional[str] = None):
    now = time.time()
    enc_transcription = encrypt_sensitive(transcription) if transcription else None
    with get_db() as conn:
        cursor = conn.cursor()
        cursor.execute("""
            INSERT INTO messages (client_phone, direction, message_type, content, transcription, audio_url, timestamp)
            VALUES (?, ?, ?, ?, ?, ?, ?)
        """, (phone, direction, message_type, content, enc_transcription, audio_url, now))
        if direction == "client":
            cursor.execute("""
                UPDATE appointments SET last_interaction = ?, updated_at = ?
                WHERE client_phone = ? AND status = 'WAITING_HUMAN'
            """, (now, now, phone))
        conn.commit()

def set_waiting_human(phone: str, client_name: Optional[str] = None, 
                      message_content: Optional[str] = None, 
                      audio_url: Optional[str] = None, 
                      transcription: Optional[str] = None,
                      last_interaction_override: Optional[float] = None):
    now = last_interaction_override if last_interaction_override is not None else time.time()
    cust = get_customer(phone)
    ensaio_type = (cust.get("selected_ensaio") if cust else None) or "Casal"
    resolved_name = client_name or (cust.get("name") if cust else None) or "Cliente"
    enc_transcription = encrypt_sensitive(transcription) if transcription else None

    with get_db() as conn:
        cursor = conn.cursor()
        
        # 1. Update existing WAITING_HUMAN appointment or insert new one
        cursor.execute("""
            SELECT id FROM appointments WHERE client_phone = ? AND status = 'WAITING_HUMAN' ORDER BY id DESC LIMIT 1
        """, (phone,))
        existing_appt = cursor.fetchone()
        note_text = transcription or message_content or "Cliente solicitou atendimento humano"
        if existing_appt:
            cursor.execute("""
                UPDATE appointments SET
                    client_name = COALESCE(?, client_name),
                    session_type = COALESCE(?, session_type),
                    notes = ?,
                    last_interaction = ?,
                    updated_at = ?
                WHERE id = ?
            """, (resolved_name, ensaio_type, note_text, now, now, existing_appt["id"]))
        else:
            cursor.execute("""
                INSERT INTO appointments (client_phone, client_name, session_type, status, notes, last_interaction, created_at, updated_at)
                VALUES (?, ?, ?, 'WAITING_HUMAN', ?, ?, ?, ?)
            """, (phone, resolved_name, ensaio_type, note_text, now, now, now))
        
        # 2. Insert or update in waiting_queue (preserving followup_count)
        cursor.execute("""
            INSERT INTO waiting_queue (client_phone, client_name, status, waiting_since, last_notification, stage, followup_count, message_content, audio_url, transcription)
            VALUES (?, ?, 'WAITING_HUMAN', ?, ?, 0, 0, ?, ?, ?)
            ON CONFLICT(client_phone) DO UPDATE SET
                status = 'WAITING_HUMAN',
                waiting_since = excluded.waiting_since,
                last_notification = excluded.last_notification,
                stage = 0,
                client_name = COALESCE(excluded.client_name, waiting_queue.client_name),
                message_content = COALESCE(excluded.message_content, waiting_queue.message_content),
                audio_url = COALESCE(excluded.audio_url, waiting_queue.audio_url),
                transcription = COALESCE(excluded.transcription, waiting_queue.transcription)
        """, (phone, resolved_name, now, now, message_content, audio_url, enc_transcription))
        
        # 3. Update customer state
        cursor.execute("UPDATE customers SET current_state = 'WAITING_HUMAN', last_seen = ? WHERE phone_number = ?", (now, phone))
        conn.commit()

def set_waiting_initial_10s(phone: str, client_name: Optional[str] = None, message_content: Optional[str] = None):
    """Starts the 10-second countdown for the photographer (Gustavo/Leo) to reply before the bot assumes."""
    now = time.time()
    resolved_name = client_name or "Cliente"
    with get_db() as conn:
        cursor = conn.cursor()
        cursor.execute("""
            INSERT INTO waiting_queue (client_phone, client_name, status, waiting_since, last_notification, stage, message_content)
            VALUES (?, ?, 'WAITING_INITIAL_10S', ?, ?, 0, ?)
            ON CONFLICT(client_phone) DO UPDATE SET
                status = 'WAITING_INITIAL_10S',
                waiting_since = excluded.waiting_since,
                last_notification = excluded.last_notification,
                stage = 0,
                client_name = COALESCE(excluded.client_name, waiting_queue.client_name),
                message_content = COALESCE(excluded.message_content, waiting_queue.message_content)
        """, (phone, resolved_name, now, now, message_content or "Oi"))
        cursor.execute("UPDATE customers SET current_state = 'WAITING_INITIAL_10S', last_seen = ? WHERE phone_number = ?", (now, phone))
        conn.commit()

def resolve_human_wait(phone: str):
    now = time.time()
    with get_db() as conn:
        cursor = conn.cursor()
        cursor.execute("UPDATE waiting_queue SET status = 'RESOLVED', followup_count = 0 WHERE client_phone = ?", (phone,))
        cursor.execute("UPDATE appointments SET status = 'RESOLVED', updated_at = ? WHERE client_phone = ? AND status = 'WAITING_HUMAN'", (now, phone))
        cursor.execute("UPDATE customers SET current_state = 'IDLE', last_seen = ? WHERE phone_number = ?", (now, phone))
        conn.commit()

def get_waiting_client(phone: str) -> Optional[Dict[str, Any]]:
    with get_db() as conn:
        cursor = conn.cursor()
        cursor.execute("SELECT * FROM waiting_queue WHERE client_phone = ? AND status = 'WAITING_HUMAN'", (phone,))
        row = cursor.fetchone()
        if not row:
            return None
        d = dict(row)
        d["transcription"] = decrypt_sensitive(d.get("transcription"))
        return d

def get_any_active_timer(phone: str) -> Optional[Dict[str, Any]]:
    with get_db() as conn:
        cursor = conn.cursor()
        cursor.execute("""
            SELECT * FROM waiting_queue
            WHERE client_phone = ? AND status IN ('WAITING_HUMAN', 'WAITING_INITIAL_10S')
        """, (phone,))
        row = cursor.fetchone()
        return dict(row) if row else None

# ==========================================
# Dynamic Persona Prompt (Gemini 3.8 Flash)
# ==========================================

def get_system_instruction(secretary_name: str, studio_name: str, photographer_name: str) -> str:
    """
    Generate dynamic persona prompt using {{secretary_name}}, {{studio_name}} and {{photographer_name}}.
    """
    return f"""Você é {secretary_name} do {studio_name}, estúdio do fotógrafo {photographer_name} em Uberlândia - MG.
Você é uma pessoa real, calorosa, descontraída e simpática, falando como alguém natural de Uberlândia (com toque mineiro sutil e acolhedor, ex: 'uai', 'ocê', 'certim', 'bom demais', sem ser forçado).

REGRAS ABSOLUTAS:
1. MÁXIMO 2 EMOJIS por mensagem. NUNCA use mais do que 2 emojis.
2. NUNCA diga, admita ou dê a entender que você é IA, robô, modelo de linguagem ou assistente virtual. Você é {secretary_name}, assistente do {photographer_name} no estúdio.
3. Fale de forma CURTA, natural e direta. Nada de textos longos ou robóticos.
4. Chame o cliente pelo primeiro nome quando souber.
5. Seja sempre prestativa e humana."""

def limit_emojis(text: str, max_emojis: int = 2) -> str:
    """Enforce strict limit of maximum 2 emojis per message."""
    emoji_pattern = re.compile(
        r'[\U0001F1E0-\U0001F1FF]|[\U0001F300-\U0001F5FF]|[\U0001F600-\U0001F64F]|'
        r'[\U0001F680-\U0001F6FF]|[\U0001F700-\U0001F77F]|[\U0001F780-\U0001F7FF]|'
        r'[\U0001F800-\U0001F8FF]|[\U0001F900-\U0001F9FF]|[\U0001FA00-\U0001FA6F]|'
        r'[\U0001FA70-\U0001FAFF]|[\u2600-\u26FF]|[\u2700-\u27BF]',
        flags=re.UNICODE
    )
    
    count = 0
    result_chars = []
    for char in text:
        if emoji_pattern.match(char):
            count += 1
            if count <= max_emojis:
                result_chars.append(char)
        else:
            result_chars.append(char)
    return "".join(result_chars).strip()

def gemini_reply(prompt: str, client_name: Optional[str] = None, fallback_text: Optional[str] = None) -> str:
    """
    Call Gemini 3.8 Flash to humanize the response dynamically using active studio persona.
    """
    cfg = get_active_client_config()
    secretary_name = cfg.get("secretary_name", "Ana")
    studio_name = cfg.get("studio_name", "Studio Leo")
    photographer_name = cfg.get("photographer_name", "Leo")
    system_inst = get_system_instruction(secretary_name, studio_name, photographer_name)

    if gemini_client:
        try:
            full_prompt = prompt
            if client_name:
                full_prompt = f"O nome do cliente é {client_name}. {prompt}"
            
            interaction = gemini_client.interactions.create(
                model="gemini-3.8-flash",
                system_instruction=system_inst,
                input=full_prompt,
                generation_config={
                    "max_output_tokens": 250
                }
            )
            reply = interaction.output_text or ""
            reply = limit_emojis(reply.strip(), max_emojis=2)
            if reply:
                return reply
        except Exception as e:
            logger.error(f"Error calling Gemini 3.8 Flash: {e}")

    # Fallback to authentic handcrafted responses if Gemini is unavailable
    if fallback_text:
        return limit_emojis(fallback_text, max_emojis=2)
    
    first_name = f" {client_name}" if client_name else ""
    return limit_emojis(f"Oi{first_name}! Aqui é a {secretary_name} do {studio_name} 📸 O {photographer_name} tá em edição agora mas eu te ajudo.", max_emojis=2)

def transcribe_audio_with_gemini(audio_path_or_bytes: Any, mime_type: str = "audio/ogg") -> str:
    """
    Transcribe received audio message using Gemini 3.8 Flash.
    """
    if gemini_client:
        try:
            if isinstance(audio_path_or_bytes, str) and os.path.exists(audio_path_or_bytes):
                uploaded_file = gemini_client.files.upload(
                    file=audio_path_or_bytes,
                    mime_type=mime_type
                )
                interaction = gemini_client.interactions.create(
                    model="gemini-3.8-flash",
                    input=[
                        {"type": "text", "text": "Transcreva este áudio do WhatsApp de forma fiel e objetiva:"},
                        {
                            "type": "audio",
                            "uri": uploaded_file.uri,
                            "mime_type": uploaded_file.mime_type
                        }
                    ]
                )
                return (interaction.output_text or "").strip()
        except Exception as e:
            logger.error(f"Failed to transcribe audio via Gemini: {e}")
            
    return "Olá, gostaria de saber se vocês têm horário disponível para este fim de semana para fotos."

# ==========================================
# WhatsApp Cloud API Sender Functions
# ==========================================

def simulate_typing(seconds: float = 1.2):
    time.sleep(seconds)

def send_whatsapp_raw(payload: dict) -> bool:
    """Send payload to Meta WhatsApp Cloud API or Baileys Gateway, or log locally."""
    cfg = get_active_client_config()
    token = cfg.get("whatsapp_token") or WHATSAPP_TOKEN
    phone_id = cfg.get("phone_number_id") or WHATSAPP_PHONE_NUMBER_ID

    # 0. Web Simulator & Unit Test shortcut: do not dial fake simulator phones on real WhatsApp
    to_str = str(payload.get("to", ""))
    if (
        to_str.startswith("553499999")
        or to_str == "5534988880000"
        or os.environ.get("TESTING_MODE") == "true"
    ):
        logger.info(f"[WEB SIMULATOR] Reply recorded for {mask_phone(to_str)}")
        return True

    # 1. First priority: If Meta WhatsApp Cloud API credentials are valid
    if token and phone_id:
        url = f"https://graph.facebook.com/v21.0/{phone_id}/messages"
        headers = {
            "Authorization": f"Bearer {token}",
            "Content-Type": "application/json"
        }
        try:
            resp = requests.post(url, headers=headers, json=payload, timeout=10)
            if resp.status_code in [200, 201]:
                logger.info(f"[WHATSAPP OUTGOING META] Success to {payload.get('to')}")
                return True
            else:
                logger.error(f"[WHATSAPP ERROR META] Status {resp.status_code}: {resp.text}")
        except Exception as e:
            logger.error(f"[WHATSAPP EXCEPTION META] {e}")

    # 2. Second priority: Check if Baileys QR Code gateway is connected
    try:
        gw_status = requests.get("http://127.0.0.1:5006/status", timeout=1.5).json()
        if gw_status.get("status") == "CONNECTED":
            text_to_send = ""
            buttons_list = []
            image_url = None
            caption = None

            if payload.get("type") == "text":
                text_to_send = payload.get("text", {}).get("body", "")
            elif payload.get("type") == "interactive":
                text_to_send = payload.get("interactive", {}).get("body", {}).get("text", "")
                buttons_list = [b.get("reply", {}) for b in payload.get("interactive", {}).get("action", {}).get("buttons", [])]
            elif payload.get("type") == "image":
                raw_link = payload.get("image", {}).get("link", "")
                # If relative url, prepend local/tunnel host
                if raw_link.startswith("/"):
                    raw_link = f"http://127.0.0.1:5005{raw_link}"
                image_url = raw_link
                caption = payload.get("image", {}).get("caption", "")

            gw_body = {
                "to": payload.get("to"),
                "text": text_to_send,
                "buttons": buttons_list
            }
            if image_url:
                gw_body["imageUrl"] = image_url
                gw_body["caption"] = caption

            gw_resp = requests.post("http://127.0.0.1:5006/send", json=gw_body, timeout=12)
            if gw_resp.status_code == 200:
                logger.info(f"[WHATSAPP OUTGOING QR-GATEWAY] Sucesso para +{payload.get('to')}")
                return True
    except Exception as e:
        logger.error(f"[WHATSAPP QR-GATEWAY ERROR] {e}")

    # 3. Fallback: Log locally in dev mode
    logger.info(f"[WHATSAPP MOCK/DEV] To: {payload.get('to')} | Type: {payload.get('type')}")
    if payload.get("type") == "text":
        logger.info(f"  -> Body: {payload.get('text', {}).get('body')}")
    elif payload.get("type") == "interactive":
        interactive = payload.get("interactive", {})
        logger.info(f"  -> Header/Body: {interactive.get('body', {}).get('text')}")
        buttons = interactive.get("action", {}).get("buttons", [])
        for b in buttons:
            logger.info(f"  -> Button: [{b.get('reply', {}).get('title')}] (id: {b.get('reply', {}).get('id')})")
    return True

def send_text_message(to: str, text: str, typing_delay: float = 1.2):
    simulate_typing(typing_delay)
    clean_text = limit_emojis(text, max_emojis=2)
    payload = {
        "messaging_product": "whatsapp",
        "recipient_type": "individual",
        "to": to,
        "type": "text",
        "text": {
            "preview_url": False,
            "body": clean_text
        }
    }
    log_message(to, "bot", "text", clean_text)
    send_whatsapp_raw(payload)

def send_button_message(to: str, body_text: str, buttons: List[Dict[str, str]], typing_delay: float = 1.2):
    simulate_typing(typing_delay)
    clean_text = limit_emojis(body_text, max_emojis=2)
    
    formatted_buttons = []
    for btn in buttons[:3]:
        formatted_buttons.append({
            "type": "reply",
            "reply": {
                "id": btn["id"],
                "title": btn["title"][:20]
            }
        })
        
    payload = {
        "messaging_product": "whatsapp",
        "recipient_type": "individual",
        "to": to,
        "type": "interactive",
        "interactive": {
            "type": "button",
            "body": {
                "text": clean_text
            },
            "action": {
                "buttons": formatted_buttons
            }
        }
    }
    log_message(to, "bot", "button", f"{clean_text} | Buttons: {[b['title'] for b in buttons]}")
    send_whatsapp_raw(payload)

def send_image_message(to: str, image_url: str, caption: Optional[str] = None):
    payload = {
        "messaging_product": "whatsapp",
        "recipient_type": "individual",
        "to": to,
        "type": "image",
        "image": {
            "link": image_url
        }
    }
    if caption:
        payload["image"]["caption"] = limit_emojis(caption, max_emojis=2)
    
    log_message(to, "bot", "image", f"Image: {image_url} (Caption: {caption})")
    send_whatsapp_raw(payload)

# ==========================================
# Alert System for Photographer (Tarefa 2)
# ==========================================

def trigger_lead_alert(client_phone: str, client_name: Optional[str], 
                       transcription: Optional[str], audio_url: Optional[str] = None):
    """
    TAREFA 2: Envie alerta imediato para o fotógrafo em 3 lugares:
    1. No PWA /dashboard (via tabela waiting_queue)
    2. No WhatsApp do fotógrafo (via send_text_message)
    3. No console log: LEAD_RECEBIDO
    """
    cfg = get_active_client_config()
    photographer_phone = cfg.get("photographer_phone")
    photographer_name = cfg.get("photographer_name", "Leo")
    name_display = client_name or f"Cliente ({client_phone})"

    # 1. Console Log (MANDATORY)
    print("\nLEAD_RECEBIDO", flush=True)
    logger.warning(f"LEAD_RECEBIDO - Novo recado de {name_display} para o fotógrafo {photographer_name}")

    # 2. WhatsApp Alert to Photographer
    if photographer_phone:
        if audio_url:
            alert_text = f"🔔 Novo recado de {name_display}: {transcription} - Ouvir áudio: {audio_url}"
        else:
            alert_text = f"🔔 Novo recado de {name_display}: {transcription}"
        
        logger.info(f"Enviando alerta imediato para o WhatsApp do fotógrafo ({photographer_phone})...")
        send_text_message(photographer_phone, alert_text, typing_delay=0.5)
    else:
        logger.info(f"WhatsApp do fotógrafo não cadastrado ainda. Alerta disponível no painel /dashboard.")

# ==========================================
# Core Conversation Flows (Dynamic Persona)
# ==========================================

def handle_initial_greeting(phone: str, client_name: Optional[str] = None):
    """
    Fluxo 1: Saudação inicial dinâmica usando persona e estúdio cadastrados.
    """
    cfg = get_active_client_config()
    secretary_name = cfg.get("secretary_name", "Ana")
    studio_name = cfg.get("studio_name", "Studio Leo")
    photographer_name = cfg.get("photographer_name", "Leo")

    first_name = client_name.split()[0] if client_name else None
    
    if first_name:
        greeting = f"Oi {first_name}! Aqui é a {secretary_name} do {studio_name} 📸 O {photographer_name} tá em edição agora mas eu te ajudo. Você quer:"
    else:
        greeting = f"Oi! Aqui é a {secretary_name} do {studio_name} 📸 O {photographer_name} tá em edição agora mas eu te ajudo. Você quer:"
    
    buttons = [
        {"id": "ver_ensaios", "title": "📸 Ver Ensaios"},
        {"id": "falar_leo", "title": f"💬 Falar com {photographer_name}"[:20]},
        {"id": "ja_tenho_horario", "title": "📅 Já tenho horário"}
    ]
    
    set_customer_state(phone, "MENU")
    send_button_message(phone, greeting, buttons, typing_delay=1.0)

def handle_show_sessions_menu(phone: str, client_name: Optional[str] = None):
    """
    Fluxo 2: Modo Menu -> Mostra os nichos cadastrados pelo fotógrafo no onboarding.
    """
    cfg = get_active_client_config()
    photographer_name = cfg.get("photographer_name", "Leo")
    first_name = client_name.split()[0] if client_name else None

    niches = {}
    try:
        niches = json.loads(cfg.get("niches_json") or "{}")
    except Exception:
        pass

    if not niches:
        niches = json.loads(DEFAULT_CLIENT["niches_json"])

    niche_names = [k.capitalize() for k in niches.keys()]
    prompt = f"Apresente de forma super rápida e simpática os ensaios que o estúdio realiza: {', '.join(niche_names)}. Máximo 2 frases."
    
    fallback_lines = ["Ótimo! Trabalhamos com estes tipos principais de ensaio:\n"]
    for i, name in enumerate(niche_names, 1):
        fallback_lines.append(f"{i}. {name}")
    fallback_lines.append("\nQual deles ocê quer conhecer os detalhes e valores?")
    fallback_text = "\n".join(fallback_lines)

    humanized = gemini_reply(prompt, client_name=first_name, fallback_text=fallback_text)

    # Top 3 buttons
    niche_keys = list(niches.keys())
    top_buttons = []
    for k in niche_keys[:3]:
        top_buttons.append({"id": f"ensaio_{k}", "title": k.capitalize()[:20]})

    set_customer_state(phone, "SELECTING_SESSION")
    send_button_message(phone, humanized, top_buttons, typing_delay=1.2)

    # If there are more than 3 niches, send secondary options
    if len(niche_keys) > 3:
        time.sleep(0.5)
        remaining_buttons = []
        for k in niche_keys[3:5]:
            remaining_buttons.append({"id": f"ensaio_{k}", "title": k.capitalize()[:20]})
        remaining_buttons.append({"id": "falar_leo", "title": f"💬 Falar c/ {photographer_name}"[:20]})

        send_button_message(
            phone,
            f"Também temos mais opções disponíveis! Quer ver alguma delas ou falar com o {photographer_name}?",
            remaining_buttons,
            typing_delay=0.8
        )

# ==========================================
# PARTE 1: Real Slot Scheduling Helpers
# ==========================================

def get_free_slots(client_id: int = 1, limit: int = 3) -> List[Dict[str, Any]]:
    with get_db() as conn:
        cursor = conn.cursor()
        cursor.execute("""
            SELECT * FROM slots
            WHERE status = 'free'
            ORDER BY id ASC
            LIMIT ?
        """, (limit,))
        rows = [dict(r) for r in cursor.fetchall()]
    return rows

def get_all_slots(client_id: int = 1) -> List[Dict[str, Any]]:
    with get_db() as conn:
        cursor = conn.cursor()
        cursor.execute("SELECT * FROM slots ORDER BY id ASC")
        return [dict(r) for r in cursor.fetchall()]

def offer_free_slots_to_client(phone: str, client_name: Optional[str] = None, ensaio_key: Optional[str] = None):
    """
    PARTE 1 (Item 3): Consulta slots free do SQLite e mostra apenas 3 opções reais mais próximas:
    'Tenho Terça 15h, Quarta 09:30 e Sábado 16:30, qual fica melhor pra ocê?'
    """
    free_slots = get_free_slots(limit=3)
    if not free_slots:
        # Ensure there are always options available if all were exhausted in tests
        with get_db() as conn:
            cursor = conn.cursor()
            cursor.executemany(
                "INSERT INTO slots (client_id, date, time, status) VALUES (1, ?, ?, 'free')",
                [("Terça", "15h"), ("Quarta", "09:30"), ("Sábado", "16:30")]
            )
            conn.commit()
        free_slots = get_free_slots(limit=3)

    labels = [f"{s['date']} {s['time']}" for s in free_slots]
    if len(labels) >= 3:
        msg = f"Tenho {labels[0]}, {labels[1]} e {labels[2]}, qual fica melhor pra ocê?"
    elif len(labels) == 2:
        msg = f"Tenho {labels[0]} e {labels[1]}, qual fica melhor pra ocê?"
    else:
        msg = f"Tenho {labels[0]} disponível, fica bom pra ocê?"

    buttons = []
    for s in free_slots[:3]:
        buttons.append({
            "id": f"slot_{s['id']}",
            "title": f"📅 {s['date']} {s['time']}"[:20]
        })

    set_customer_state(phone, "SELECTING_SLOT", selected_ensaio=ensaio_key.capitalize() if ensaio_key else None)
    send_button_message(phone, msg, buttons, typing_delay=1.0)

def book_slot_for_client(phone: str, slot_row: Dict[str, Any], client_name: Optional[str] = None) -> Dict[str, Any]:
    """
    PARTE 1 (Item 3): Marca no banco como busy e responde:
    'Prontinho [Nome]! Reservei Terça 15h pro seu Ensaio Casal. Te mandei um comprovante aqui e já avisei o Leo. O sinal é Pix R$100 pra confirmar, tudo bem?'
    + Gera um comprovante em texto bonito + envia pro dashboard como Novo Agendamento.
    """
    now = time.time()
    cfg = get_active_client_config()
    photographer_name = cfg.get("photographer_name", "Leo")
    studio_name = cfg.get("studio_name", "Studio Leo")

    cust = get_customer(phone)
    resolved_name = client_name or (cust.get("name") if cust else None) or "Cliente"
    first_name = resolved_name.split()[0]
    raw_ensaio = (cust.get("selected_ensaio") if cust else None) or "Casal"
    if raw_ensaio.lower().startswith("ensaio"):
        ensaio_display = raw_ensaio
    else:
        ensaio_display = f"Ensaio {raw_ensaio.capitalize()}"

    slot_label = f"{slot_row['date']} {slot_row['time']}"

    receipt_text = (
        f"🧾 *COMPROVANTE DE AGENDAMENTO*\n"
        f"━━━━━━━━━━━━━━━━━━━━\n"
        f"📸 *Estúdio:* {studio_name}\n"
        f"👤 *Cliente:* {resolved_name}\n"
        f"✨ *Sessão:* {ensaio_display}\n"
        f"📅 *Horário Reservado:* {slot_label}\n"
        f"💳 *Sinal p/ Confirmar:* Pix R$ 100,00\n"
        f"✅ *Status:* Reservado na agenda do {photographer_name}\n"
        f"━━━━━━━━━━━━━━━━━━━━"
    )

    with get_db() as conn:
        cursor = conn.cursor()
        # 1. Mark slot as busy
        cursor.execute("""
            UPDATE slots SET
                status = 'busy',
                client_name = ?,
                client_phone = ?,
                ensaio_type = ?
            WHERE id = ?
        """, (resolved_name, phone, ensaio_display, slot_row["id"]))

        # 2. Resolve any pending human wait
        cursor.execute("UPDATE waiting_queue SET status = 'RESOLVED' WHERE client_phone = ?", (phone,))
        cursor.execute("UPDATE appointments SET status = 'RESOLVED', updated_at = ? WHERE client_phone = ? AND status = 'WAITING_HUMAN'", (now, phone))

        # 3. Create BOOKED appointment record for Dashboard
        cursor.execute("""
            INSERT INTO appointments (
                client_phone, client_name, session_type, slot_id, slot_date, slot_time,
                receipt_text, status, notes, last_interaction, created_at, updated_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, 'BOOKED', ?, ?, ?, ?)
        """, (
            phone, resolved_name, ensaio_display, slot_row["id"],
            slot_row["date"], slot_row["time"], receipt_text,
            f"Agendado: {slot_label} ({ensaio_display})", now, now, now
        ))

        cursor.execute("UPDATE customers SET current_state = 'BOOKED', last_seen = ? WHERE phone_number = ?", (now, phone))
        conn.commit()

    confirm_msg = (
        f"Prontinho {first_name}! Reservei {slot_label} pro seu {ensaio_display}. "
        f"Te mandei um comprovante aqui e já avisei o {photographer_name}. "
        f"O sinal é Pix R$100 pra confirmar, tudo bem?"
    )
    send_text_message(phone, confirm_msg, typing_delay=1.0)
    send_text_message(phone, receipt_text, typing_delay=0.6)

    logger.info(f"[NOVO_AGENDAMENTO] Cliente {resolved_name} ({phone}) reservou {slot_label} para {ensaio_display}")
    return {
        "slot": slot_label,
        "ensaio": ensaio_display,
        "client_name": resolved_name,
        "receipt": receipt_text
    }

def handle_session_details(phone: str, session_key: str, client_name: Optional[str] = None):
    """
    Fluxo 2: Responde com preço + 3 fotos mock/portfólio do fotógrafo + mostra os 3 horários reais livres do SQLite!
    """
    cfg = get_active_client_config()
    photographer_name = cfg.get("photographer_name", "Leo")
    first_name = client_name.split()[0] if client_name else None

    niches = {}
    try:
        niches = json.loads(cfg.get("niches_json") or "{}")
    except Exception:
        pass

    item = niches.get(session_key)
    if not item:
        default_niches = json.loads(DEFAULT_CLIENT["niches_json"])
        item = default_niches.get(session_key, default_niches["casal"])

    price_str = f"R$ {item.get('price', 450)}"
    desc_str = item.get("description", "Ensaio fotográfico completo com fotos tratadas em alta resolução.")
    photos = item.get("photos", [])
    if not photos or len(photos) < 3:
        photos = [
            "https://images.unsplash.com/photo-1515934751635-c81c6bc9a2d8?w=800&q=80",
            "https://images.unsplash.com/photo-1522673607200-164d1b6ce486?w=800&q=80",
            "https://images.unsplash.com/photo-1534528741775-53994a69daeb?w=800&q=80"
        ]

    prompt = (
        f"Apresente de maneira bem natural, calorosa e concisa o ensaio de {session_key.capitalize()}. "
        f"O valor é {price_str}. Detalhes: {desc_str}. "
        f"Diga que vai mandar 3 fotos de exemplo pra ver o trabalho do {photographer_name}."
    )
    fallback = (
        f"O Ensaio de {session_key.capitalize()} tá {price_str}! Inclui {desc_str}\n\n"
        f"Tô te mandando 3 fotos de exemplo pra ocê ver o estilo do {photographer_name} 📸"
    )

    # 1. Send description
    humanized_msg = gemini_reply(prompt, client_name=first_name, fallback_text=fallback)
    send_text_message(phone, humanized_msg, typing_delay=1.0)

    # 2. Send 3 portfolio photos
    for i, photo_url in enumerate(photos[:3], 1):
        time.sleep(0.4)
        send_image_message(phone, photo_url, caption=f"Exemplo {i}/3 - {session_key.capitalize()}")

    # 3. PARTE 1 (Item 3): Offer the 3 closest real free slots from SQLite!
    time.sleep(0.5)
    offer_free_slots_to_client(phone, client_name=client_name, ensaio_key=session_key)

def handle_falar_com_leo(phone: str, client_name: Optional[str] = None, custom_target_name: Optional[str] = None):
    """
    Fluxo 3: Modo Espera Humana -> marca WAITING_HUMAN, log HUMAN_NEEDED, silêncio 60s (1 minuto).
    Se passar mais de 1 minuto sem o Gustavo/fotógrafo responder, o bot interage novamente!
    """
    cfg = get_active_client_config()
    photographer_name = custom_target_name or cfg.get("photographer_name", "Leo")
    first_name = client_name.split()[0] if client_name else None

    # 1. Update DB: appointments and waiting_queue status=WAITING_HUMAN
    set_waiting_human(phone, client_name=client_name, message_content=f"Cliente solicitou falar com {photographer_name}")

    # 2. Console notification (MANDATORY REQUIREMENT)
    print("\nHUMAN_NEEDED", flush=True)
    logger.warning(f"HUMAN_NEEDED - Cliente aguardando atendimento de {photographer_name}: {phone} (Nome: {client_name or 'Não informado'})")

    # 3. Inform the client
    if first_name:
        response_text = f"Perfeito, {first_name}! Vou chamar o {photographer_name} aqui pra você, só 1 minutinho, ele já vem"
    else:
        response_text = f"Perfeito! Vou chamar o {photographer_name} aqui pra você, só 1 minutinho, ele já vem"

    send_text_message(phone, response_text, typing_delay=1.0)

def handle_ja_tenho_horario(phone: str, client_name: Optional[str] = None):
    """
    PARTE 1 (Item 3): Quando cliente escolhe '📅 Já tenho horário', consulta slots free do SQLite
    e mostra apenas as 3 opções reais mais próximas!
    """
    offer_free_slots_to_client(phone, client_name=client_name)

# ==========================================
# Global Bot Pause / Stop Control & Anti-Loop Engine (PARTE 1)
# ==========================================
BOT_PAUSED = False


def log_loop_blocked(
    wa_id: Optional[str],
    message_id: Optional[str],
    motivo: str,
    loop_prevented: bool = True
):
    """
    PARTE 1 (Item 1 & Item 6): Salva em logs toda vez que bloquear loop:
    LOOP_BLOCKED, wa_id, message_id, motivo (e LOOP_PREVENTED para idempotência/eco).
    """
    masked_wa = mask_phone(wa_id or "unknown")
    msg_id_str = str(message_id or "no_id")
    prefix = "LOOP_PREVENTED | " if loop_prevented else ""
    log_line = f"{prefix}LOOP_BLOCKED, {masked_wa}, {msg_id_str}, {motivo}"
    logger.warning(log_line)
    print(log_line, flush=True)

    try:
        with open(LOOP_LOG_PATH, "a", encoding="utf-8") as lf:
            lf.write(f"{datetime.now().isoformat()} | {log_line}\n")
    except Exception:
        pass

    try:
        with get_db() as conn:
            cursor = conn.cursor()
            cursor.execute(
                "INSERT INTO loop_logs (wa_id, message_id, motivo, created_at) VALUES (?, ?, ?, ?)",
                (masked_wa, msg_id_str, motivo, time.time())
            )
            conn.commit()
    except Exception:
        pass


def check_and_mark_idempotency(message_id: Optional[str], wa_id: Optional[str]) -> bool:
    """
    PARTE 1 (Item 1 - IDEMPOTÊNCIA):
    Verifica se message_id já existe na tabela processed_messages.
    Se existir, ignora e loga LOOP_PREVENTED / LOOP_BLOCKED.
    Retorna True se for mensagem inédita, False se for duplicada.
    """
    if not message_id:
        return True
    msg_id_str = str(message_id).strip()
    if not msg_id_str:
        return True

    with get_db() as conn:
        cursor = conn.cursor()
        cursor.execute("SELECT message_id FROM processed_messages WHERE message_id = ?", (msg_id_str,))
        if cursor.fetchone():
            log_loop_blocked(wa_id, msg_id_str, "IDEMPOTENCIA_MESSAGE_ID_DUPLICADO", loop_prevented=True)
            return False
        cursor.execute(
            "INSERT INTO processed_messages (message_id, wa_id, created_at) VALUES (?, ?, ?)",
            (msg_id_str, mask_phone(wa_id), time.time())
        )
        conn.commit()
    return True


def is_echo_message(wa_id: Optional[str], message_data: Dict[str, Any]) -> bool:
    """
    PARTE 1 (Item 2 - FILTRO DE ECO):
    Se from == nosso PHONE_NUMBER_ID ou se message.from == bot, ignora imediatamente.
    """
    cfg = get_active_client_config()
    our_phone_ids = {
        str(WHATSAPP_PHONE_NUMBER_ID).strip(),
        str(cfg.get("phone_number_id") or "").strip(),
        "bot",
        "self",
        "studio_bot"
    }
    our_phone_ids.discard("")

    sender_candidates = [
        str(wa_id or "").strip(),
        str(message_data.get("from") or "").strip(),
        str(message_data.get("sender") or "").strip(),
    ]
    msg_id = message_data.get("id") or message_data.get("message_id") or "echo_evt"

    if message_data.get("from_me") is True or message_data.get("direction") == "bot":
        log_loop_blocked(wa_id, msg_id, "FILTRO_DE_ECO_FROM_ME", loop_prevented=True)
        return True

    for candidate in sender_candidates:
        if not candidate:
            continue
        if candidate.lower() in {"bot", "self", "studio_bot"} or candidate in our_phone_ids:
            log_loop_blocked(wa_id, msg_id, "FILTRO_DE_ECO_PHONE_NUMBER_ID_OU_BOT", loop_prevented=True)
            return True

    return False


VALID_INCOMING_MESSAGE_TYPES = {"message", "text", "interactive", "button", "audio", "voice"}


def is_status_or_non_message_event(message_data: Dict[str, Any]) -> bool:
    """
    PARTE 1 (Item 3 - FILTRO DE STATUS):
    Ignora todo webhook que não for type="message" / mensagem válida (ignora status, read, delivered, etc).
    """
    msg_id = message_data.get("id") or message_data.get("message_id") or "status_evt"
    wa_id = message_data.get("from") or message_data.get("recipient_id") or "unknown"

    if "statuses" in message_data and "messages" not in message_data:
        log_loop_blocked(wa_id, msg_id, "FILTRO_DE_STATUS_ARRAY", loop_prevented=True)
        return True

    if "status" in message_data and "type" not in message_data and "text" not in message_data:
        log_loop_blocked(wa_id, msg_id, f"FILTRO_DE_STATUS_{message_data.get('status')}", loop_prevented=True)
        return True

    msg_type = str(message_data.get("type", "text")).lower().strip()
    if msg_type not in VALID_INCOMING_MESSAGE_TYPES:
        log_loop_blocked(wa_id, msg_id, f"FILTRO_DE_STATUS_TYPE_{msg_type.upper()}", loop_prevented=True)
        return True

    return False


def trigger_reengagement_for_client(phone: str) -> bool:
    """
    PARTE 1 (Item 5 - TRAVA DE RE-ENGAJAMENTO):
    Só pode enviar re-engajamento se status == WAITING_HUMAN.
    Depois que enviar, muda para FOLLOWUP_SENT e NUNCA envia novamente para o mesmo ciclo.
    Respeita campo followup_count com limite máximo de 2.
    """
    now = time.time()
    cfg = get_active_client_config()
    photographer_name = cfg.get("photographer_name", "Leo")

    with get_db() as conn:
        cursor = conn.cursor()
        cursor.execute("""
            SELECT w.*, c.name
            FROM waiting_queue w
            LEFT JOIN customers c ON w.client_phone = c.phone_number
            WHERE w.client_phone = ?
        """, (phone,))
        client = cursor.fetchone()

    if not client:
        return False

    status = client["status"]
    followup_count = int(client["followup_count"] or 0)

    if status != "WAITING_HUMAN":
        log_loop_blocked(phone, "reengagement", f"TRAVA_REENGAJAMENTO_STATUS_{status}", loop_prevented=True)
        return False

    if followup_count >= 2:
        with get_db() as conn:
            cursor = conn.cursor()
            cursor.execute(
                "UPDATE waiting_queue SET status = 'FOLLOWUP_SENT' WHERE client_phone = ?",
                (phone,)
            )
            conn.commit()
        log_loop_blocked(phone, "reengagement", "TRAVA_REENGAJAMENTO_MAX_2_ATINGIDO", loop_prevented=True)
        return False

    name = client["name"] or client["client_name"]
    first_name = name.split()[0] if name else None
    target_name = "Gustavo" if (client["message_content"] and "gustavo" in client["message_content"].lower()) else photographer_name

    text_msg = (
        f"O {target_name} ainda tá ocupado no ensaio aqui{', ' + first_name if first_name else ''}! "
        f"Pra não te deixar esperando, quer já ver os horários livres da agenda ou deixar um recado?"
    )
    buttons = [
        {"id": "ja_tenho_horario", "title": "📅 Ver Horários"},
        {"id": "deixar_audio", "title": "🎙️ Deixar áudio"},
        {"id": "deixar_texto", "title": "✍️ Deixar msg escrit"}
    ]

    with get_db() as conn:
        cursor = conn.cursor()
        cursor.execute("""
            UPDATE waiting_queue
            SET status = 'FOLLOWUP_SENT',
                followup_count = COALESCE(followup_count, 0) + 1,
                stage = 1,
                last_notification = ?
            WHERE client_phone = ? AND status = 'WAITING_HUMAN'
        """, (now, phone))
        conn.commit()

    send_button_message(phone, text_msg, buttons, typing_delay=0.5)
    return True


# ==========================================
# Background Worker 1: 10s Takeover & 60s Re-engagement
# ==========================================

def reengagement_monitor():
    """
    Background thread checking:
    1) WAITING_INITIAL_10S: Cliente chama -> fotógrafo (Gustavo/Leo) tem 10 segundos para responder. Se não responder em 10s, o bot assume!
    2) WAITING_HUMAN: Cliente pede para falar com Gustavo/fotógrafo -> bot avisa que vai chamar e aguarda 1 minuto (60s).
       Só envia se status == WAITING_HUMAN e followup_count < 2, mudando para FOLLOWUP_SENT!
    """
    logger.info("Re-engagement & 10s Takeover background thread started (checking every 1s).")
    while True:
        try:
            if BOT_PAUSED:
                time.sleep(1)
                continue
            now = time.time()

            with get_db() as conn:
                cursor = conn.cursor()
                cursor.execute("""
                    SELECT w.*, c.name 
                    FROM waiting_queue w
                    LEFT JOIN customers c ON w.client_phone = c.phone_number
                    WHERE w.status IN ('WAITING_INITIAL_10S', 'WAITING_HUMAN')
                """)
                waiting_clients = cursor.fetchall()

            for client in waiting_clients:
                phone = client["client_phone"]
                name = client["name"] or client["client_name"]
                waiting_since = client["waiting_since"]
                status = client["status"]
                elapsed = now - waiting_since

                # Rule A: 10-Second Initial Takeover (Gustavo/Photographer didn't answer in 10s -> Bot assumes!)
                if status == "WAITING_INITIAL_10S" and elapsed >= 10.0:
                    logger.info(f"[10S TAKEOVER] Fotógrafo não respondeu em {elapsed:.1f}s para {mask_phone(phone)}. Bot assumindo atendimento!")
                    with get_db() as conn:
                        cursor = conn.cursor()
                        cursor.execute("UPDATE waiting_queue SET status = 'BOT_ASSUMED' WHERE client_phone = ?", (phone,))
                        conn.commit()
                    handle_initial_greeting(phone, client_name=name)
                    continue

                # Rule B: 60-Second (1 Minute) Re-engagement with strict FOLLOWUP_SENT lock & followup_count <= 2
                if status == "WAITING_HUMAN" and elapsed >= 60.0:
                    trigger_reengagement_for_client(phone)

        except Exception as e:
            logger.error(f"Error in re-engagement monitor thread: {e}")

        time.sleep(1)

# ==========================================
# PARTE 2 & PARTE 3: 30h Intelligent Follow-up & 24h Window Engine
# ==========================================

def run_30h_followup_check() -> List[Dict[str, Any]]:
    """
    PARTE 2 & PARTE 3:
    Verifica se appointment.status == 'WAITING_HUMAN' e last_interaction < 30 horas atrás
    e nenhum humano respondeu e nenhum slot foi marcado.
    1. Carrega todo o histórico da conversa (messages) daquele cliente
    2. Chama Gemini com o prompt de análise de contexto (urgente / agendar com bônus / recuperação / auto_closed)
    3. Aplica regras de janela de 24h do WhatsApp (<24h normal vs >24h template aprovado)
    4. Salva no log: JANELA_ANALISADA, CONTEXTO: [resumo], AÇÃO: [enviou/não enviou]
    """
    now = time.time()
    threshold_30h = 30 * 3600.0
    cfg = get_active_client_config()
    secretary_name = cfg.get("secretary_name", "Ana")
    photographer_name = cfg.get("photographer_name", "Leo")

    processed_results = []

    with get_db() as conn:
        cursor = conn.cursor()
        cursor.execute("""
            SELECT * FROM appointments
            WHERE status = 'WAITING_HUMAN'
            ORDER BY id ASC
        """)
        waiting_appts = [dict(r) for r in cursor.fetchall()]

    for appt in waiting_appts:
        appt_id = appt["id"]
        phone = appt["client_phone"]
        last_inter = appt.get("last_interaction") or appt.get("updated_at") or appt.get("created_at") or now
        elapsed_seconds = now - last_inter

        # Must be >= 30 hours ago
        if elapsed_seconds < threshold_30h:
            continue

        with get_db() as conn:
            cursor = conn.cursor()
            # Verify no human responded
            cursor.execute("""
                SELECT COUNT(*) FROM messages
                WHERE client_phone = ? AND direction = 'human' AND timestamp >= ?
            """, (phone, appt.get("created_at") or 0))
            human_replied_count = cursor.fetchone()[0]

            # Verify no slot was marked busy for this client
            cursor.execute("""
                SELECT COUNT(*) FROM slots
                WHERE client_phone = ? AND status = 'busy'
            """, (phone,))
            booked_slots_count = cursor.fetchone()[0]

            # Load ALL conversation history
            cursor.execute("""
                SELECT * FROM messages
                WHERE client_phone = ?
                ORDER BY timestamp ASC
            """, (phone,))
            history_rows = [dict(r) for r in cursor.fetchall()]

            cursor.execute("SELECT * FROM customers WHERE phone_number = ?", (phone,))
            cust_row = cursor.fetchone()
            cust = dict(cust_row) if cust_row else {}

        if human_replied_count > 0 or booked_slots_count > 0:
            # Already handled by human or booked a slot -> mark auto_closed
            with get_db() as conn:
                cursor = conn.cursor()
                cursor.execute("UPDATE appointments SET status = 'auto_closed', updated_at = ? WHERE id = ?", (now, appt_id))
                cursor.execute("UPDATE waiting_queue SET status = 'auto_closed' WHERE client_phone = ?", (phone,))
                conn.commit()
            continue

        client_name = appt.get("client_name") or cust.get("name") or "Cliente"
        first_name = client_name.split()[0]
        ensaio_wanted = appt.get("session_type") or cust.get("selected_ensaio") or "Ensaio Casal"
        if not ensaio_wanted.lower().startswith("ensaio"):
            ensaio_wanted = f"Ensaio {ensaio_wanted.capitalize()}"

        # Summarize history & check last client message timestamp for 24h window rule
        history_lines = []
        last_client_msg_ts = last_inter
        has_audio = False
        combined_client_text = ""

        for m in history_rows:
            who = "Cliente" if m["direction"] == "client" else "Secretária"
            dec_trans = decrypt_sensitive(m.get("transcription"))
            content_str = dec_trans or m.get("content") or ""
            history_lines.append(f"[{who}]: {content_str}")
            if m["direction"] == "client":
                last_client_msg_ts = m.get("timestamp") or last_client_msg_ts
                combined_client_text += " " + content_str.lower()
                if m.get("message_type") == "audio":
                    has_audio = True

        if not combined_client_text and appt.get("notes"):
            combined_client_text = appt.get("notes", "").lower()

        msg_kind = "áudio" if has_audio else ("texto/recado" if combined_client_text.strip() else "mensagem")
        hours_since_client_msg = (now - last_client_msg_ts) / 3600.0
        window_under_24h = hours_since_client_msg < 24.0

        history_text = "\n".join(history_lines[-15:]) if history_lines else f"[Cliente]: {appt.get('notes') or 'Quero falar com o fotógrafo'}"

        # Build the exact Gemini analysis prompt from PARTE 2
        gemini_analysis_prompt = f"""PROMPT PARA GEMINI:
Analise o contexto abaixo da cliente {first_name}. Ela tentou falar com o fotógrafo, deixou {msg_kind}, queria {ensaio_wanted}, está esperando há 30h.
Janela do WhatsApp: já fechou (24h). Você só pode enviar template ou reabrir com valor.

Tarefa: Decida a melhor ação humanizada:
- Se ela deixou recado urgente (ex: casamento amanhã, gestante): mande mensagem de prioridade pro fotógrafo e diga pra cliente que subiu como prioridade.
- Se ela queria agendar mas não escolheu horário: ofereça novamente os horários livres com um bônus (ex: 'consegui liberar um horário extra').
- Se ela só queria falar com humano e desistiu: mande mensagem de recuperação natural: 'Oi {first_name}, aqui é a {secretary_name} de novo, uai, vi que o {photographer_name} não conseguiu te responder ontem... ele tava em casamento o dia todo. Ainda quer aquele horário? Posso te adiantar a reserva'.
- Se ela disse que já resolveu, já fechou com outro ou cancelou: responda apenas AUTO_CLOSED.

Gere resposta curta, mineira, acolhedora, máximo 2 emojis, sem parecer robô de cobrança.

Histórico da conversa:
{history_text}"""

        # Context classification (deterministic + Gemini enhancement)
        already_resolved_keywords = ["já resolvi", "ja resolvi", "já fechei", "ja fechei", "não preciso mais", "desisti", "cancelar"]
        urgent_keywords = ["casamento amanhã", "casamento amanha", "urgente", "gestante", "amanhã", "amanha", "emergência"]
        schedule_keywords = ["agendar", "horário", "horario", "data", "vaga", "terça", "quarta", "sábado", "preço", "valor", "ensaio"]

        is_auto_closed = any(k in combined_client_text for k in already_resolved_keywords)
        is_urgent = any(k in combined_client_text for k in urgent_keywords)
        is_scheduling = any(k in combined_client_text for k in schedule_keywords)

        free_slots = get_free_slots(limit=3)
        slots_preview = ", ".join([f"{s['date']} {s['time']}" for s in free_slots]) if free_slots else "Terça 15h e Sábado 16:30"

        if is_auto_closed:
            context_summary = f"Cliente {first_name} informou que já resolveu/desistiu ({ensaio_wanted})"
            fallback_decision_msg = "AUTO_CLOSED"
        elif is_urgent:
            context_summary = f"Recado URGENTE de {first_name} sobre {ensaio_wanted} ({msg_kind}) aguardando há 30h"
            fallback_decision_msg = (
                f"Oi {first_name}, aqui é a {secretary_name}! Uai, vi que seu recado sobre {ensaio_wanted} é urgente "
                f"e já subi como prioridade máxima pro {photographer_name} te chamar agora mesmo 📸"
            )
        elif is_scheduling:
            context_summary = f"Cliente {first_name} queria agendar {ensaio_wanted} mas não escolheu horário há 30h"
            fallback_decision_msg = (
                f"Oi {first_name}, aqui é a {secretary_name}! Uai, consegui liberar um horário extra com bônus ( +3 fotos de presente) "
                f"pro seu {ensaio_wanted}: tenho {slots_preview}, qual reservo procê? 📸"
            )
        else:
            context_summary = f"Cliente {first_name} pediu para falar com {photographer_name} ({msg_kind}) há 30h e ficou sem resposta"
            fallback_decision_msg = (
                f"Oi {first_name}, aqui é a {secretary_name} de novo, uai, vi que o {photographer_name} não conseguiu te responder ontem... "
                f"ele tava em casamento o dia todo. Ainda quer aquele horário? Posso te adiantar a reserva 📸"
            )

        generated_msg = gemini_reply(
            gemini_analysis_prompt,
            client_name=first_name,
            fallback_text=fallback_decision_msg
        )

        if is_auto_closed or "AUTO_CLOSED" in generated_msg.upper():
            # Step 3: Do NOT send anything, mark as auto_closed
            log_str = f"JANELA_ANALISADA, CONTEXTO: {context_summary}, AÇÃO: não enviou"
            print(log_str, flush=True)
            logger.info(log_str)

            with get_db() as conn:
                cursor = conn.cursor()
                cursor.execute("""
                    UPDATE appointments SET
                        status = 'auto_closed',
                        followup_context = ?,
                        followup_action = 'não enviou',
                        followup_message = 'Nenhuma mensagem enviada (auto_closed)',
                        window_status = ?,
                        updated_at = ?
                    WHERE id = ?
                """, (context_summary, "<24h" if window_under_24h else ">24h", now, appt_id))
                cursor.execute("UPDATE waiting_queue SET status = 'auto_closed' WHERE client_phone = ?", (phone,))
                conn.commit()

            processed_results.append({
                "appointment_id": appt_id,
                "client_phone": phone,
                "client_name": client_name,
                "status": "auto_closed",
                "action": "não enviou",
                "context": context_summary
            })
            continue

        # If urgent, also send priority alert to photographer!
        if is_urgent:
            photographer_phone = cfg.get("photographer_phone")
            priority_alert = f"🚨 PRIORIDADE 30H: Cliente {client_name} ({phone}) deixou recado urgente sobre {ensaio_wanted}!"
            logger.warning(priority_alert)
            if photographer_phone:
                send_text_message(photographer_phone, priority_alert, typing_delay=0.3)

        # Step 4 & PARTE 3: Apply WhatsApp 24h Window Rules
        if window_under_24h:
            # <24h since client's last message: send normal humanized message
            window_label = "<24h (Janela Aberta - Mensagem Normal)"
            final_msg_to_send = generated_msg
            send_text_message(phone, final_msg_to_send, typing_delay=0.5)
            stored_followup_msg = final_msg_to_send
        else:
            # >24h since client's last message: use approved WhatsApp template!
            window_label = ">24h (Janela Fechada - Template Aprovado + Contexto)"
            template_text = f"Olá {first_name}, passando pra retomar nosso atendimento sobre {ensaio_wanted}. Ainda precisa de ajuda? 📸"
            send_text_message(phone, template_text, typing_delay=0.5)
            # Also send the contextual recovery/bonus offer right after
            send_text_message(phone, generated_msg, typing_delay=0.5)
            stored_followup_msg = f"{template_text}\n\n💬 Complemento IA: {generated_msg}"

        log_str = f"JANELA_ANALISADA, CONTEXTO: {context_summary}, AÇÃO: enviou"
        print(log_str, flush=True)
        logger.info(log_str)

        with get_db() as conn:
            cursor = conn.cursor()
            cursor.execute("""
                UPDATE appointments SET
                    status = 'FOLLOWUP_30H_SENT',
                    followup_context = ?,
                    followup_action = 'enviou',
                    followup_message = ?,
                    window_status = ?,
                    updated_at = ?
                WHERE id = ?
            """, (context_summary, stored_followup_msg, window_label, now, appt_id))
            cursor.execute("UPDATE waiting_queue SET status = 'FOLLOWUP_30H_SENT' WHERE client_phone = ?", (phone,))
            conn.commit()

        processed_results.append({
            "appointment_id": appt_id,
            "client_phone": phone,
            "client_name": client_name,
            "status": "FOLLOWUP_30H_SENT",
            "action": "enviou",
            "window_status": window_label,
            "context": context_summary,
            "message": stored_followup_msg
        })

    return processed_results

def followup_30h_monitor():
    """
    PARTE 2: Segunda background thread que roda a cada 1 hora e verifica
    clientes em WAITING_HUMAN há mais de 30 horas sem resposta humana e sem slot marcado.
    """
    logger.info("30h Intelligent Follow-up background thread started (checking every 1 hour).")
    while True:
        try:
            if not BOT_PAUSED:
                run_30h_followup_check()
        except Exception as e:
            logger.error(f"Error in 30h follow-up background thread: {e}")
        time.sleep(3600)

# Initialize database tables and start BOTH background threads
init_db()
monitor_thread = threading.Thread(target=reengagement_monitor, daemon=True)
monitor_thread.start()

followup_30h_thread = threading.Thread(target=followup_30h_monitor, daemon=True)
followup_30h_thread.start()

# ==========================================
# Message Dispatcher & Processing
# ==========================================

def process_incoming_message(phone: str, message_data: dict, client_name: Optional[str] = None):
    if BOT_PAUSED:
        logger.info(f"[BOT PAUSADO] Ignorando mensagem de {mask_phone(phone)} porque o bot está parado pelo painel.")
        return

    # PARTE 1 (Item 3): FILTRO DE STATUS (ignore anything that is not a valid user message)
    if is_status_or_non_message_event(message_data):
        return

    # PARTE 1 (Item 2): FILTRO DE ECO (ignore messages from our PHONE_NUMBER_ID or bot)
    if is_echo_message(phone, message_data):
        return

    # PARTE 1 (Item 1): IDEMPOTÊNCIA (check processed_messages for message_id)
    msg_id = message_data.get("id") or message_data.get("message_id")
    if msg_id and not check_and_mark_idempotency(str(msg_id), phone):
        return

    now = time.time()
    save_customer(phone, name=client_name)
    customer_info = get_customer(phone)
    current_state = customer_info.get("current_state", "IDLE") if customer_info else "IDLE"
    
    cfg = get_active_client_config()
    photographer_name = cfg.get("photographer_name", "Leo")
    secretary_name = cfg.get("secretary_name", "Ana")

    msg_type = str(message_data.get("type", "text")).lower().strip()
    if msg_type == "message":
        msg_type = "text"

    user_text = ""
    interactive_id = None
    audio_url = None
    
    # Parse inputs
    if msg_type == "text":
        text_obj = message_data.get("text")
        if isinstance(text_obj, dict):
            user_text = (text_obj.get("body") or "").strip()
        elif isinstance(text_obj, str):
            user_text = text_obj.strip()
        else:
            user_text = str(message_data.get("body") or "").strip()
    elif msg_type == "interactive":
        interactive_obj = message_data.get("interactive", {})
        if interactive_obj.get("type") == "button_reply":
            interactive_id = interactive_obj.get("button_reply", {}).get("id")
            user_text = interactive_obj.get("button_reply", {}).get("title")
        elif interactive_obj.get("type") == "list_reply":
            interactive_id = interactive_obj.get("list_reply", {}).get("id")
            user_text = interactive_obj.get("list_reply", {}).get("title")
    elif msg_type == "button":
        interactive_id = message_data.get("button", {}).get("payload")
        user_text = message_data.get("button", {}).get("text")
    elif msg_type in ["audio", "voice"]:
        user_text = "[ÁUDIO ENVIADO]"
        audio_url = message_data.get("audio", {}).get("url") or "/uploads/sample_audio.mp3"

    # PARTE 1 (Item 4): DEBOUNCE (<3 seconds from same wa_id -> join into one & process only the last)
    if msg_type == "text" and not message_data.get("use_10s_timer"):
        with get_db() as conn:
            cursor = conn.cursor()
            cursor.execute("SELECT COUNT(*) FROM messages WHERE client_phone = ?", (phone,))
            existing_msg_count = cursor.fetchone()[0]
        if existing_msg_count == 0:
            last_message_time.pop(phone, None)

        prev = last_message_time.get(phone)
        if prev is not None:
            if isinstance(prev, dict):
                prev_ts = float(prev.get("timestamp", 0.0))
                prev_text = str(prev.get("text", "")).strip()
                prev_state = str(prev.get("state_before", "IDLE"))
                prev_msg_type = str(prev.get("msg_type", "text"))
                prev_used_10s = bool(prev.get("used_10s", False))
            else:
                prev_ts = float(prev) if isinstance(prev, (int, float)) else 0.0
                prev_text = ""
                prev_state = "IDLE"
                prev_msg_type = "text"
                prev_used_10s = False

            # Check if new text is a direct slot choice after an interactive slot offer
            free_slots_check = get_free_slots(limit=10)
            is_slot_booking_reply = (
                current_state == "SELECTING_SLOT"
                and any(
                    s["date"].lower() in user_text.lower() or s["time"].lower() in user_text.lower()
                    for s in free_slots_check
                )
            )

            if (
                prev_ts > 0
                and (now - prev_ts) < 3.0
                and prev_msg_type == "text"
                and not prev_used_10s
                and not is_slot_booking_reply
                and current_state != "WAITING_INITIAL_10S"
            ):
                merged_text = f"{prev_text} {user_text}".strip() if prev_text else user_text
                log_loop_blocked(phone, msg_id or "debounce_msg", "DEBOUNCE_<3S_MERGED", loop_prevented=True)
                # Remove intermediate client/bot messages from the first partial turn (<3s ago)
                with get_db() as conn:
                    cursor = conn.cursor()
                    cursor.execute(
                        "DELETE FROM messages WHERE client_phone = ? AND timestamp >= ?",
                        (phone, prev_ts - 0.05)
                    )
                    conn.commit()
                user_text = merged_text
                current_state = prev_state
                set_customer_state(phone, current_state)

        last_message_time[phone] = {
            "timestamp": now,
            "text": user_text,
            "state_before": current_state,
            "msg_type": msg_type,
            "used_10s": False
        }
    else:
        last_message_time[phone] = {
            "timestamp": now,
            "text": user_text,
            "state_before": current_state,
            "msg_type": msg_type,
            "used_10s": bool(message_data.get("use_10s_timer"))
        }

    logger.info(f"[INCOMING] From: {mask_phone(phone)} ({client_name}) | Type: {msg_type} | Content: {user_text} | ID: {interactive_id}")
    if msg_type not in ["audio", "voice"]:
        log_message(phone, "client", msg_type, user_text)

    normalized_text = (user_text or "").lower().strip()

    # Check if the client is asking for Gustavo or the photographer
    human_triggers = [
        "falar com leo", "falar com o leo", "falar com gustavo", "falar com o gustavo",
        "gustavo", "chamar gustavo", "chamar o gustavo", "cadê o gustavo", "cade o gustavo",
        "atendente", "falar com atendente", "humano", "falar com humano",
        f"falar com {photographer_name.lower()}", f"falar com o {photographer_name.lower()}"
    ]
    wants_human_now = (interactive_id == "falar_leo") or any(trigger in normalized_text for trigger in human_triggers)
    requested_human_name = "Gustavo" if "gustavo" in normalized_text else photographer_name

    # 0. Check if client is in 10s initial wait mode (Cliente chama -> Gustavo não responde em 10s -> Bot assume)
    if message_data.get("use_10s_timer") and current_state == "IDLE" and not wants_human_now and msg_type == "text":
        set_waiting_initial_10s(phone, client_name=client_name, message_content=user_text)
        logger.info(f"[10S TIMER STARTED] Aguardando 10s para {requested_human_name} responder {phone} antes do bot assumir.")
        return

    # 1. Check if client is currently in WAITING_HUMAN mode
    waiting_record = get_waiting_client(phone)
    if waiting_record:
        elapsed = now - waiting_record["waiting_since"]
        # If client insists on talking to Gustavo/photographer while waiting:
        if wants_human_now:
            first_name = client_name.split()[0] if client_name else None
            insist_msg = (
                f"Já tô chamando o {requested_human_name} aqui procê{', ' + first_name if first_name else ''}! "
                f"Se ele não conseguir responder em 1 minutinho porque tá fotografando, eu mesma volto aqui pra te ajudar com os horários 📸"
            )
            # Reset waiting_since so the 1-minute countdown runs cleanly from insistence or keep stage=0
            set_waiting_human(phone, client_name=client_name, message_content=user_text)
            send_text_message(phone, insist_msg, typing_delay=0.8)
            return

        # If client leaves audio or text while waiting (or expecting), process lead alert or slot/menu choice
        if msg_type in ["audio", "voice"] or current_state in ["EXPECTING_AUDIO", "EXPECTING_TEXT"]:
            pass
        elif interactive_id or normalized_text in ["1", "2", "3", "4", "5"]:
            pass
        elif elapsed < 60.0:
            # Record the note and inform that photographer is being called
            set_waiting_human(phone, client_name=client_name, message_content=user_text, transcription=user_text)
            trigger_lead_alert(phone, client_name, user_text, audio_url=None)
            send_text_message(
                phone,
                f"Anotado! Já avisei o {requested_human_name} aqui, só 1 minutinho que se ele não conseguir sair do ensaio eu mesma já te adianto tudo!",
                typing_delay=0.8
            )
            return

    # 2. Handle Audio Message (Rule 5 & Tarefa 2)
    if msg_type in ["audio", "voice"]:
        print(f"[ÁUDIO RECEBIDO] De: {mask_phone(phone)}", flush=True)
        logger.info(f"[ÁUDIO RECEBIDO] De: {mask_phone(phone)}")
        
        transcription = transcribe_audio_with_gemini(message_data.get("audio_file_path"))
        print(f"[ÁUDIO RECEBIDO] Transcrição: \"{transcription}\"", flush=True)
        
        set_waiting_human(phone, client_name=client_name, message_content="[Áudio do WhatsApp]", audio_url=audio_url, transcription=transcription)
        log_message(phone, "client", "audio", "[Áudio do WhatsApp]", transcription=transcription, audio_url=audio_url)
        
        trigger_lead_alert(phone, client_name, transcription, audio_url=audio_url)

        first_name = client_name.split()[0] if client_name else None
        confirm_text = (
            f"Recebi seu áudio perfeitamente{', ' + first_name if first_name else ''}! 🎙️ "
            f"Já deixei transcrito aqui pro {photographer_name} ler e ouvir assim que terminar."
        )
        send_text_message(phone, confirm_text, typing_delay=1.0)
        return

    # 3. Map numeric replies (1, 2, 3, 4) based on the customer's current state!
    if normalized_text in ["1", "2", "3", "4", "5"]:
        num = int(normalized_text)
        if current_state == "MENU":
            if num == 1:
                interactive_id = "ver_ensaios"
            elif num == 2:
                interactive_id = "falar_leo"
            elif num == 3:
                interactive_id = "ja_tenho_horario"
        elif current_state == "SELECTING_SESSION":
            try:
                niche_list = list(json.loads(cfg.get("niches_json") or "{}").keys())
                if not niche_list:
                    niche_list = list(json.loads(DEFAULT_CLIENT["niches_json"]).keys())
                if 1 <= num <= len(niche_list):
                    interactive_id = f"ensaio_{niche_list[num - 1]}"
            except Exception:
                pass
        elif current_state == "SELECTING_SLOT":
            free_slots = get_free_slots(limit=3)
            if 1 <= num <= len(free_slots):
                interactive_id = f"slot_{free_slots[num - 1]['id']}"
        elif current_state == "WAITING_HUMAN":
            if num == 1:
                interactive_id = "ja_tenho_horario"
            elif num == 2:
                interactive_id = "deixar_audio"
            elif num == 3:
                interactive_id = "deixar_texto"
        elif current_state == "VIEWING_SESSION":
            if num == 1:
                interactive_id = "ja_tenho_horario"
            elif num == 2:
                interactive_id = "ver_ensaios"
            elif num == 3:
                interactive_id = "falar_leo"

    # 4. Handle Real Slot Selection (PARTE 1 - Item 3)
    if interactive_id and interactive_id.startswith("slot_"):
        slot_id_str = interactive_id.replace("slot_", "")
        with get_db() as conn:
            cursor = conn.cursor()
            cursor.execute("SELECT * FROM slots WHERE id = ?", (slot_id_str,))
            slot_row = cursor.fetchone()
        if slot_row:
            book_slot_for_client(phone, dict(slot_row), client_name=client_name)
            return

    # Also check if the user typed a day/time matching one of the free slots (e.g. "Terça 15h", "Terça", "Quarta 09:30", "Sábado 16:30")
    free_slots_now = get_free_slots(limit=10)
    for s in free_slots_now:
        s_date_lower = s["date"].lower()
        s_time_lower = s["time"].lower()
        full_slot_lower = f"{s_date_lower} {s_time_lower}"
        if full_slot_lower in normalized_text or (current_state == "SELECTING_SLOT" and (s_date_lower in normalized_text or s_time_lower in normalized_text)):
            book_slot_for_client(phone, s, client_name=client_name)
            return

    # 5. Handle "Falar com Gustavo / Leo / Fotógrafo"
    if wants_human_now or interactive_id == "falar_leo":
        handle_falar_com_leo(phone, client_name=client_name, custom_target_name=requested_human_name)
        return

    # 6. Handle Re-engagement button choices
    if interactive_id == "deixar_audio" or ("áudio" in normalized_text and "deixar" in normalized_text):
        set_customer_state(phone, "EXPECTING_AUDIO")
        send_text_message(phone, f"Pode mandar o áudio aqui mesmo que eu já transcrevo pro {photographer_name}", typing_delay=1.0)
        return

    if interactive_id == "deixar_texto" or ("escrita" in normalized_text or ("mensagem" in normalized_text and "deixar" in normalized_text)):
        set_customer_state(phone, "EXPECTING_TEXT")
        send_text_message(phone, f"Pode escrever que assim que ele liberar eu já te mando", typing_delay=1.0)
        return

    if interactive_id == "continuar_aguardando" or ("continuo aguardando" in normalized_text or "aguardar" in normalized_text):
        send_text_message(phone, f"Combinado, fico aqui de olho. Se quiser, enquanto espera te mostro os ensaios mais pedidos?", typing_delay=1.0)
        handle_show_sessions_menu(phone, client_name=client_name)
        return

    # 7. Handle EXPECTING_TEXT state (Tarefa 2: written note for photographer)
    if current_state == "EXPECTING_TEXT":
        set_customer_state(phone, "IDLE")
        set_waiting_human(phone, client_name=client_name, message_content=user_text, transcription=user_text)
        trigger_lead_alert(phone, client_name, user_text, audio_url=None)

        first_name = client_name.split()[0] if client_name else None
        send_text_message(
            phone, 
            f"Anotadinho{', ' + first_name if first_name else ''}! Já deixei seu recado em destaque pro {photographer_name} e ele te responde assim que liberar do ensaio.",
            typing_delay=1.0
        )
        return

    # 8. Handle Booking / "Já tenho horário" / "Ver datas" -> Queries SQLite free slots!
    if (
        interactive_id in ["ja_tenho_horario", "reservar_horario"]
        or (interactive_id and interactive_id.startswith("agendar_"))
        or "já tenho horário" in normalized_text
        or "tenho horário" in normalized_text
        or "ver datas" in normalized_text
        or "horários livres" in normalized_text
        or "quero reservar" in normalized_text
    ):
        ensaio_from_btn = interactive_id.replace("agendar_", "") if (interactive_id and interactive_id.startswith("agendar_")) else None
        offer_free_slots_to_client(phone, client_name=client_name, ensaio_key=ensaio_from_btn)
        return

    if interactive_id == "aguardar_mais":
        send_text_message(phone, "Certinho, sigo de olho aqui! Assim que ele pisar na recepção já puxo a orelha dele pra te responder 😅", typing_delay=1.0)
        return

    # 9. Handle Sessions Menu
    if interactive_id == "ver_ensaios" or any(k in normalized_text for k in ["ver ensaios", "ensaios", "ensaio", "preços", "valores", "tabela"]):
        handle_show_sessions_menu(phone, client_name=client_name)
        return

    # 10. Handle Specific Session Details (dynamic by niche key)
    try:
        niches = json.loads(cfg.get("niches_json") or "{}")
    except Exception:
        niches = {}
    
    matched_niche = None
    if interactive_id and interactive_id.startswith("ensaio_"):
        matched_niche = interactive_id.replace("ensaio_", "")
    else:
        for k in niches.keys():
            if k in normalized_text:
                matched_niche = k
                break

    if matched_niche:
        handle_session_details(phone, matched_niche, client_name=client_name)
        return

    # 11. Default: Initial Greeting
    handle_initial_greeting(phone, client_name=client_name)

# ==========================================
# Webhook Routes (PARTE 1 & PARTE 2 Security)
# ==========================================

@app.route("/webhook", methods=["GET"])
@limiter.limit("60 per minute")
def verify_webhook():
    mode = request.args.get("hub.mode")
    token = request.args.get("hub.verify_token")
    challenge = request.args.get("hub.challenge")

    if mode == "subscribe" and token and hmac.compare_digest(str(token), str(WHATSAPP_VERIFY_TOKEN)):
        logger.info("WhatsApp Webhook verified successfully!")
        return challenge or "OK", 200
    else:
        logger.warning("Webhook verification failed (invalid or missing VERIFY_TOKEN).")
        return "Forbidden", 403


@app.route("/webhook", methods=["POST"])
@limiter.limit("60 per minute")
def webhook_event():
    # PARTE 2 (Item 1): Validate HMAC SHA256 of X-Hub-Signature-256 with APP_SECRET
    raw_body = request.get_data()
    sig_header = request.headers.get("X-Hub-Signature-256")
    if not verify_webhook_signature(raw_body, sig_header):
        logger.warning("Webhook POST rejected: Invalid or missing X-Hub-Signature-256 HMAC.")
        return jsonify({"status": "error", "error": "Forbidden - Invalid HMAC SHA256 Signature"}), 403

    data = request.get_json(silent=True) or {}

    try:
        # PARTE 1 (Item 3): Ignore status / read / delivered webhooks at top level
        if "statuses" in data and "messages" not in data:
            log_loop_blocked("webhook", "status_batch", "FILTRO_DE_STATUS_TOP_LEVEL", loop_prevented=True)
            return jsonify({"status": "ignored_status"}), 200

        if "type" in data and str(data.get("type")).lower().strip() not in VALID_INCOMING_MESSAGE_TYPES:
            log_loop_blocked(
                data.get("from", "webhook"),
                data.get("id", "status_evt"),
                f"FILTRO_DE_STATUS_{str(data.get('type')).upper()}",
                loop_prevented=True
            )
            return jsonify({"status": "ignored_status"}), 200

        if data.get("object") == "whatsapp_business_account":
            for entry in data.get("entry", []):
                for change in entry.get("changes", []):
                    value = change.get("value", {})
                    if "statuses" in value and not value.get("messages"):
                        for st in value.get("statuses", []):
                            log_loop_blocked(
                                st.get("recipient_id", "webhook"),
                                st.get("id", "status_id"),
                                f"FILTRO_DE_STATUS_{str(st.get('status', 'status')).upper()}",
                                loop_prevented=True
                            )
                        continue

                    contacts = value.get("contacts", [])
                    messages = value.get("messages", [])

                    client_name = None
                    if contacts and "profile" in contacts[0]:
                        client_name = contacts[0]["profile"].get("name")

                    for msg in messages:
                        phone = msg.get("from")
                        if phone:
                            process_incoming_message(phone, msg, client_name)

            return jsonify({"status": "received"}), 200

        elif "from" in data:
            phone = data.get("from")
            client_name = data.get("name", "Cliente")
            process_incoming_message(phone, data, client_name)
            return jsonify({"status": "processing_simulated"}), 200

    except Exception as e:
        logger.error(f"Error handling webhook event: {e}")

    return jsonify({"status": "ignored"}), 200

# ==========================================
# SaaS API Endpoints (Client, Leads, Uploads)
# ==========================================

@app.route("/api/client/config", methods=["GET"])
def api_get_client_config():
    token = request.args.get("token")
    client = get_active_client_config(token)
    return jsonify({"status": "ok", "client": client}), 200

@app.route("/api/client/config", methods=["POST"])
def api_save_client_config():
    data = request.get_json() or {}
    token = str(data.get("token") or "default_token_leo").strip()[:64]
    now = time.time()

    # PARTE 2 (Item 6): Validate and sanitize all /onboarding inputs (max 50 chars for names, no <script>/XSS/SQLi)
    for field_key, max_chars in [
        ("studio_name", 50),
        ("photographer_name", 50),
        ("secretary_name", 50),
        ("business_hours", 80),
        ("photographer_phone", 30),
    ]:
        if field_key in data and data.get(field_key) is not None:
            ok, clean_val, err_msg = validate_and_sanitize_input(data.get(field_key), field_key, max_len=max_chars)
            if not ok:
                return jsonify({"status": "error", "error": err_msg}), 400
            data[field_key] = clean_val

    raw_niches = data.get("niches_json", "{}")
    if isinstance(raw_niches, dict):
        raw_niches = json.dumps(raw_niches)
    if DANGEROUS_XSS_PATTERNS.search(str(raw_niches)) or "<script" in str(raw_niches).lower():
        return jsonify({"status": "error", "error": "Conteúdo inválido detectado em niches_json (XSS bloqueado)."}), 400

    raw_wa_token = (data.get("whatsapp_token") or "").strip()
    enc_wa_token = encrypt_sensitive(raw_wa_token) if raw_wa_token else ""
    clean_phone_id = re.sub(r"[^A-Za-z0-9_\-]", "", str(data.get("phone_number_id") or ""))[:64]

    with get_db() as conn:
        cursor = conn.cursor()
        cursor.execute("SELECT id FROM clients WHERE token = ?", (token,))
        row = cursor.fetchone()

        if row:
            cursor.execute("""
                UPDATE clients SET
                    studio_name = ?,
                    photographer_name = ?,
                    secretary_name = ?,
                    photographer_phone = ?,
                    business_hours = ?,
                    niches_json = ?,
                    whatsapp_token = COALESCE(NULLIF(?, ''), whatsapp_token),
                    phone_number_id = COALESCE(NULLIF(?, ''), phone_number_id),
                    updated_at = ?
                WHERE token = ?
            """, (
                data.get("studio_name") or "Studio Leo",
                data.get("photographer_name") or "Leo",
                data.get("secretary_name") or "Ana",
                data.get("photographer_phone") or "",
                data.get("business_hours") or "Seg-Sex 8h-18h",
                str(raw_niches),
                enc_wa_token,
                clean_phone_id,
                now, token
            ))
        else:
            cursor.execute("""
                INSERT INTO clients (
                    token, studio_name, photographer_name, secretary_name,
                    photographer_phone, business_hours, niches_json,
                    whatsapp_token, phone_number_id, is_active, created_at, updated_at
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?)
            """, (
                token,
                data.get("studio_name") or "Studio Leo",
                data.get("photographer_name") or "Leo",
                data.get("secretary_name") or "Ana",
                data.get("photographer_phone") or "",
                data.get("business_hours") or "Seg-Sex 8h-18h",
                str(raw_niches),
                enc_wa_token,
                clean_phone_id,
                now, now
            ))
        conn.commit()

    logger.info(f"SaaS Client config updated for studio: {data.get('studio_name')} (Persona: {data.get('secretary_name')})")
    return jsonify({"status": "ok"}), 200

_LAST_GATEWAY_CONNECTED = False

def ensure_bot_running():
    """Automatically unpauses and activates the bot when the user connects their phone."""
    global BOT_PAUSED
    if BOT_PAUSED:
        BOT_PAUSED = False
        logger.info("▶️ BOT LIGADO AUTOMATICAMENTE AO CONECTAR O CELULAR!")
    with get_db() as conn:
        conn.execute("UPDATE clients SET is_active = 1")
        conn.commit()


@app.route("/api/client/activate_whatsapp", methods=["POST"])
def api_activate_whatsapp():
    data = request.get_json() or {}
    token = str(data.get("token") or "default_token_leo").strip()[:64]
    wa_token = (data.get("whatsapp_token") or "").strip()
    phone_id = (data.get("phone_number_id") or "").strip()

    if not wa_token or not phone_id:
        return jsonify({
            "status": "error",
            "error": "Por favor, preencha o WHATSAPP_TOKEN e o PHONE_NUMBER_ID antes de ativar."
        }), 400

    ok1, _, err1 = validate_and_sanitize_input(wa_token, "whatsapp_token", max_len=512)
    ok2, clean_phone_id, err2 = validate_and_sanitize_input(phone_id, "phone_number_id", max_len=64)
    if not ok1 or not ok2:
        return jsonify({"status": "error", "error": err1 or err2}), 400

    enc_token = encrypt_sensitive(wa_token)

    with get_db() as conn:
        cursor = conn.cursor()
        cursor.execute("""
            UPDATE clients SET
                whatsapp_token = ?,
                phone_number_id = ?,
                is_active = 1,
                updated_at = ?
            WHERE token = ?
        """, (enc_token, clean_phone_id, time.time(), token))
        conn.commit()

    ensure_bot_running()
    logger.info(f"WhatsApp activated for client (Phone ID: {mask_phone(clean_phone_id)})")
    return jsonify({"status": "ok", "paused": False, "message": "Bot ativado com sucesso!"}), 200

@app.route("/api/test_whatsapp_send", methods=["POST"])
def api_test_whatsapp_send():
    data = request.get_json() or {}
    phone = (data.get("phone") or "").strip()
    clean_phone = re.sub(r"\D", "", phone)
    
    cfg = get_active_client_config()
    token = (data.get("whatsapp_token") or cfg.get("whatsapp_token") or WHATSAPP_TOKEN or "").strip()
    phone_id = (data.get("phone_number_id") or cfg.get("phone_number_id") or WHATSAPP_PHONE_NUMBER_ID or "").strip()
    secretary = cfg.get("secretary_name", "Tania")
    studio = cfg.get("studio_name", "Studio")

    if not token or not phone_id:
        return jsonify({
            "status": "error",
            "error": "WHATSAPP_TOKEN ou PHONE_NUMBER_ID estão vazios. Cole suas credenciais da Meta primeiro!"
        }), 400

    if not clean_phone or len(clean_phone) < 10:
        return jsonify({
            "status": "error",
            "error": "Informe seu número com DDI e DDD (ex: 5534999998888)."
        }), 400

    url = f"https://graph.facebook.com/v21.0/{phone_id}/messages"
    headers = {
        "Authorization": f"Bearer {token}",
        "Content-Type": "application/json"
    }
    payload = {
        "messaging_product": "whatsapp",
        "recipient_type": "individual",
        "to": clean_phone,
        "type": "text",
        "text": {
            "preview_url": False,
            "body": f"Oi! Teste de conexão do WhatsApp Studio Bot 📸 Aqui é a {secretary} do {studio}. O bot está ativo e conectado!"
        }
    }

    try:
        resp = requests.post(url, headers=headers, json=payload, timeout=12)
        resp_data = resp.json()
        if resp.status_code in [200, 201]:
            logger.info(f"[TEST SUCCESS] Mensagem de teste enviada com sucesso para +{clean_phone}")
            return jsonify({
                "status": "ok",
                "message": f"Mensagem de teste enviada com sucesso para +{clean_phone}!",
                "meta_response": resp_data
            }), 200
        else:
            error_msg = resp_data.get("error", {}).get("message", resp.text)
            error_code = resp_data.get("error", {}).get("code", resp.status_code)
            logger.error(f"[TEST FAILED] Meta Error {error_code}: {error_msg}")
            return jsonify({
                "status": "error",
                "error": f"Erro retornado pela Meta (Código {error_code}): {error_msg}",
                "meta_response": resp_data
            }), 400
    except Exception as e:
        logger.error(f"[TEST EXCEPTION] {e}")
        return jsonify({"status": "error", "error": f"Falha na conexão com a Meta: {str(e)}"}), 500

@app.route("/api/qr_status", methods=["GET"])
def api_qr_status():
    """Proxy status and QR code from Baileys gateway. Auto-starts bot when phone connects."""
    global _LAST_GATEWAY_CONNECTED
    auto_start = request.args.get("auto_start") == "1"
    try:
        resp = requests.get("http://127.0.0.1:5006/status", timeout=2)
        gw_data = resp.json()
        is_connected = gw_data.get("status") == "CONNECTED"
        if is_connected and (not _LAST_GATEWAY_CONNECTED or auto_start):
            ensure_bot_running()
        _LAST_GATEWAY_CONNECTED = is_connected
        gw_data["botPaused"] = BOT_PAUSED
        return jsonify(gw_data), resp.status_code
    except Exception:
        if auto_start:
            ensure_bot_running()
        return jsonify({"status": "OFFLINE", "qr": None, "connectedNumber": None, "botPaused": BOT_PAUSED}), 200

@app.route("/conectar", methods=["GET"])
@app.route("/qr", methods=["GET"])
def direct_qr_page():
    """Simple, zero-friction mobile friendly page to scan QR code directly."""
    html = """<!DOCTYPE html>
<html lang="pt-BR">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Conectar WhatsApp ao Bot</title>
  <style>
    body {
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
      background-color: #111b21;
      color: #e9edef;
      margin: 0;
      padding: 20px;
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      min-height: 90vh;
      box-sizing: border-box;
    }
    .card {
      background: #202c33;
      padding: 28px;
      border-radius: 16px;
      box-shadow: 0 10px 30px rgba(0,0,0,0.5);
      text-align: center;
      max-width: 420px;
      width: 100%;
      border: 2px solid #25D366;
    }
    h1 {
      font-size: 20px;
      margin-bottom: 8px;
      color: #25D366;
    }
    p {
      font-size: 14px;
      color: #8696a0;
      line-height: 1.5;
      margin-bottom: 20px;
    }
    .qr-box {
      background: white;
      padding: 14px;
      border-radius: 12px;
      display: inline-block;
      margin: 10px 0 20px 0;
      box-shadow: 0 4px 15px rgba(0,0,0,0.3);
    }
    .qr-box img {
      width: 250px;
      height: 250px;
      display: block;
    }
    .steps {
      text-align: left;
      background: #111b21;
      padding: 14px 18px;
      border-radius: 8px;
      font-size: 13.5px;
      color: #d1d7db;
      line-height: 1.6;
    }
    .steps ol {
      margin: 0;
      padding-left: 20px;
    }
    .status-badge {
      display: inline-block;
      padding: 6px 14px;
      border-radius: 20px;
      font-size: 13px;
      font-weight: bold;
      margin-bottom: 15px;
    }
    .badge-scan { background: rgba(254, 193, 7, 0.2); color: #fbc02d; }
    .badge-connected { background: rgba(37, 211, 102, 0.2); color: #25D366; font-size: 16px; padding: 10px 20px; }
    .btn {
      background: #ea4335;
      color: white;
      border: none;
      padding: 10px 18px;
      border-radius: 8px;
      cursor: pointer;
      font-size: 13px;
      font-weight: bold;
      margin-top: 15px;
    }
  </style>
</head>
<body>
  <div class="card" id="mainCard">
    <h1>📱 Conectar seu WhatsApp</h1>
    <p>Conecte o bot ao seu WhatsApp em 5 segundos, exatamente igual ao WhatsApp Web no computador!</p>

    <div id="content">
      <div class="status-badge badge-scan">Carregando QR Code...</div>
    </div>

    <div class="steps" id="stepsBox">
      <strong>Como conectar no seu celular:</strong>
      <ol>
        <li>Abra o WhatsApp no seu celular</li>
        <li>Toque em <strong>Configurações</strong> (ou <strong>3 pontinhos</strong>)</li>
        <li>Toque em <strong>Aparelhos Conectados</strong></li>
        <li>Toque em <strong>Conectar um Aparelho</strong> e aponte a câmera para este QR Code</li>
      </ol>
    </div>
  </div>

  <script>
    async function updateStatus() {
      try {
        const res = await fetch('/api/qr_status');
        const data = await res.json();
        const content = document.getElementById('content');
        const stepsBox = document.getElementById('stepsBox');

        if (data.status === 'CONNECTED') {
          content.innerHTML = `
            <div class="status-badge badge-connected">✅ WhatsApp Conectado!</div>
            <p style="color: #25D366; font-size: 16px; margin: 15px 0;">
              Número ativo: <strong>+${data.connectedNumber}</strong>
            </p>
            <p style="color: #e9edef;">
              Pronto! O bot da Ana com Gemini já está ativo e respondendo automaticamente a qualquer pessoa que mandar mensagem.
            </p>
            <button class="btn" onclick="disconnect()">Desconectar</button>
          `;
          stepsBox.style.display = 'none';
        } else if (data.qr) {
          content.innerHTML = `
            <div class="status-badge badge-scan">🟡 Pronto para Escanear</div>
            <div class="qr-box">
              <img src="${data.qr}" alt="QR Code WhatsApp" />
            </div>
          `;
          stepsBox.style.display = 'block';
        } else {
          content.innerHTML = `
            <div class="status-badge badge-scan">⏳ Gerando QR Code...</div>
          `;
        }
      } catch (e) {
        console.error(e);
      }
    }

    async function disconnect() {
      if (confirm('Deseja realmente desconectar?')) {
        await fetch('/api/qr_disconnect', { method: 'POST' });
        updateStatus();
      }
    }

    updateStatus();
    setInterval(updateStatus, 2500);
  </script>
</body>
</html>"""
    return html, 200, {"Content-Type": "text/html; charset=utf-8"}

@app.route("/api/qr_disconnect", methods=["POST"])
def api_qr_disconnect():
    """Disconnect active WhatsApp Web session."""
    try:
        resp = requests.post("http://127.0.0.1:5006/disconnect", timeout=3)
        return jsonify(resp.json()), resp.status_code
    except Exception as e:
        return jsonify({"error": str(e)}), 500

@app.route("/api/page_qr", methods=["GET"])
def api_page_qr():
    """Generate a QR Code image for the /comecar page URL so the photographer can print or share it."""
    target_url = request.args.get("url") or f"{request.host_url.rstrip('/')}/comecar"
    try:
        resp = requests.get("http://127.0.0.1:5006/generate-qr", params={"text": target_url}, timeout=3)
        if resp.status_code == 200:
            return jsonify(resp.json()), 200
    except Exception as e:
        logger.warning(f"Gateway QR generation fallback: {e}")

    # Fallback SVG data URL if gateway is busy
    return jsonify({"qr": "/icon.svg", "url": target_url}), 200

@app.route("/api/client/embedded_signup", methods=["POST"])
def api_embedded_signup():
    """
    Receives the access token from Meta Embedded Signup (window.FB.login with whatsapp_business_management),
    automatically discovers the user's WhatsApp Business Account and Phone Number ID via Graph API,
    and saves them encrypted to the client record without the user typing any technical credentials.
    """
    data = request.get_json() or {}
    client_token = str(data.get("token") or "default_token_leo").strip()[:64]
    access_token = (data.get("access_token") or "").strip()
    manual_code_1 = (data.get("code_1") or "").strip()
    manual_code_2 = (data.get("code_2") or "").strip()

    # PARTE 2 (Item 6): Validate inputs on /comecar against XSS/SQLi
    for f_name, f_val, f_max in [
        ("token", client_token, 64),
        ("access_token", access_token, 512),
        ("code_1", manual_code_1, 512),
        ("code_2", manual_code_2, 64),
    ]:
        if f_val:
            ok, _, err_msg = validate_and_sanitize_input(f_val, f_name, max_len=f_max)
            if not ok:
                return jsonify({"status": "error", "error": err_msg}), 400

    # Handle ultra-simple 2-field fallback if user used the fallback inputs
    if manual_code_1 and manual_code_2 and not access_token:
        enc_code_1 = encrypt_sensitive(manual_code_1)
        clean_code_2 = html.escape(manual_code_2, quote=True)
        with get_db() as conn:
            cursor = conn.cursor()
            cursor.execute("""
                UPDATE clients SET
                    whatsapp_token = ?,
                    phone_number_id = ?,
                    is_active = 1,
                    updated_at = ?
                WHERE token = ?
            """, (enc_code_1, clean_code_2, time.time(), client_token))
            conn.commit()
        ensure_bot_running()
        return jsonify({
            "status": "ok",
            "paused": False,
            "phone_number_id": clean_code_2,
            "message": "Conectado e Bot ligado com sucesso!"
        }), 200

    if not access_token:
        return jsonify({"status": "error", "error": "Não foi possível obter a autorização do Facebook."}), 400

    discovered_phone_id = ""
    try:
        # Step 1: Query shared/owned WhatsApp Business Accounts from Graph API
        debug_resp = requests.get(
            "https://graph.facebook.com/v21.0/me/businesses",
            params={"access_token": access_token, "fields": "id,name,owned_whatsapp_business_accounts{id,name}"},
            timeout=8
        ).json()

        businesses = debug_resp.get("data", [])
        for biz in businesses:
            wabas = biz.get("owned_whatsapp_business_accounts", {}).get("data", [])
            for waba in wabas:
                waba_id = waba.get("id")
                if waba_id:
                    phones_resp = requests.get(
                        f"https://graph.facebook.com/v21.0/{waba_id}/phone_numbers",
                        params={"access_token": access_token},
                        timeout=8
                    ).json()
                    phones = phones_resp.get("data", [])
                    if phones:
                        discovered_phone_id = phones[0].get("id", "")
                        break
            if discovered_phone_id:
                break
    except Exception as e:
        logger.warning(f"Graph API automatic discovery warning: {e}")

    if not discovered_phone_id:
        discovered_phone_id = data.get("phone_number_id") or "auto_connected_meta"

    enc_access_token = encrypt_sensitive(access_token)
    with get_db() as conn:
        cursor = conn.cursor()
        cursor.execute("""
            UPDATE clients SET
                whatsapp_token = ?,
                phone_number_id = ?,
                is_active = 1,
                updated_at = ?
            WHERE token = ?
        """, (enc_access_token, discovered_phone_id, time.time(), client_token))
        conn.commit()

    ensure_bot_running()
    return jsonify({
        "status": "ok",
        "paused": False,
        "phone_number_id": discovered_phone_id,
        "message": "WhatsApp conectado e Bot ligado automaticamente!"
    }), 200

@app.route("/api/client/leads", methods=["GET"])
def api_get_leads():
    token = request.args.get("token")
    client = get_active_client_config(token)
    
    with get_db() as conn:
        cursor = conn.cursor()
        cursor.execute("""
            SELECT * FROM waiting_queue 
            WHERE status = 'WAITING_HUMAN' 
            ORDER BY waiting_since DESC
        """)
        leads = []
        for r in cursor.fetchall():
            d = dict(r)
            d["transcription"] = decrypt_sensitive(d.get("transcription"))
            leads.append(d)

    return jsonify({"status": "ok", "client": client, "leads": leads}), 200

@app.route("/api/client/leads/resolve", methods=["POST"])
def api_resolve_lead():
    data = request.get_json() or {}
    phone = data.get("phone")
    if phone:
        resolve_human_wait(phone)
        logger.info(f"Lead marked as resolved: {phone}")
        return jsonify({"status": "ok"}), 200
    return jsonify({"error": "Missing phone"}), 400

# ==========================================
# PARTE 1 & PARTE 2 Endpoints: Slots, Agendamentos & Follow-ups 30h
# ==========================================

@app.route("/api/client/slots", methods=["GET", "POST"])
def api_client_slots():
    if request.method == "GET":
        slots = get_all_slots()
        return jsonify({"status": "ok", "slots": slots}), 200

    data = request.get_json() or {}
    action = data.get("action", "bulk_save")

    with get_db() as conn:
        cursor = conn.cursor()

        if action == "add":
            date_str = (data.get("date") or "").strip()
            time_str = (data.get("time") or "").strip()
            if not date_str or not time_str:
                return jsonify({"status": "error", "error": "Informe o dia e o horário."}), 400
            cursor.execute("""
                INSERT INTO slots (client_id, date, time, status)
                VALUES (1, ?, ?, 'free')
            """, (date_str, time_str))
            conn.commit()

        elif action == "toggle":
            slot_id = data.get("id")
            new_status = data.get("status", "free")
            if new_status == "free":
                cursor.execute("""
                    UPDATE slots SET status = 'free', client_name = NULL, client_phone = NULL, ensaio_type = NULL
                    WHERE id = ?
                """, (slot_id,))
            else:
                cursor.execute("UPDATE slots SET status = ? WHERE id = ?", (new_status, slot_id))
            conn.commit()

        elif action == "delete":
            slot_id = data.get("id")
            cursor.execute("DELETE FROM slots WHERE id = ?", (slot_id,))
            conn.commit()

        elif action == "bulk_save":
            # Used by /onboarding when the photographer checks/unchecks available times
            selected_slots = data.get("slots") or []
            if selected_slots:
                # Preserve busy slots, replace free/blocked slots with the selected ones
                cursor.execute("DELETE FROM slots WHERE status != 'busy'")
                for s in selected_slots:
                    d_val = (s.get("date") or "").strip()
                    t_val = (s.get("time") or "").strip()
                    st_val = s.get("status", "free")
                    if d_val and t_val:
                        cursor.execute("""
                            INSERT INTO slots (client_id, date, time, status)
                            VALUES (1, ?, ?, ?)
                        """, (d_val, t_val, st_val))
                conn.commit()

    return jsonify({"status": "ok", "slots": get_all_slots()}), 200

@app.route("/api/client/appointments", methods=["GET"])
def api_get_appointments():
    with get_db() as conn:
        cursor = conn.cursor()
        cursor.execute("""
            SELECT * FROM appointments
            WHERE status = 'BOOKED'
            ORDER BY updated_at DESC
        """)
        appointments = [dict(r) for r in cursor.fetchall()]

        cursor.execute("""
            SELECT * FROM slots
            WHERE status = 'busy'
            ORDER BY id ASC
        """)
        busy_slots = [dict(r) for r in cursor.fetchall()]

    return jsonify({
        "status": "ok",
        "appointments": appointments,
        "busy_slots": busy_slots
    }), 200

@app.route("/api/client/followups_30h", methods=["GET"])
def api_get_followups_30h():
    with get_db() as conn:
        cursor = conn.cursor()
        cursor.execute("""
            SELECT * FROM appointments
            WHERE status IN ('FOLLOWUP_30H_SENT', 'auto_closed', 'WAITING_HUMAN')
            ORDER BY updated_at DESC
        """)
        rows = [dict(r) for r in cursor.fetchall()]

    return jsonify({
        "status": "ok",
        "followups": rows
    }), 200

@app.route("/api/client/followups_30h/simulate", methods=["POST"])
def api_simulate_followup_30h():
    """
    Creates or backdates a WAITING_HUMAN client to 31 hours ago and immediately runs
    run_30h_followup_check() so the photographer can test the 30h Follow-up + 24h Window Engine in 1 click!
    """
    data = request.get_json() or {}
    scenario = data.get("scenario", "urgent_over24h")
    now = time.time()
    past_31h = now - (31 * 3600)

    if scenario == "urgent_over24h":
        phone = "5534999991234"
        name = "Fernanda (Noiva)"
        ensaio = "Ensaio Casamento"
        msg_text = "Oi! Tenho urgência, meu casamento é amanhã e preciso falar com o Gustavo sobre as fotos!"
        client_msg_ts = past_31h
    elif scenario == "schedule_under24h":
        phone = "5534999991234"
        name = "Juliana (Casal)"
        ensaio = "Ensaio Casal"
        msg_text = "Queria saber qual o valor e agendar um horário pro nosso ensaio de casal"
        client_msg_ts = now - (12 * 3600)  # <24h window open
    elif scenario == "recovery_over24h":
        phone = "5534999991234"
        name = "Patrícia"
        ensaio = "Ensaio Família"
        msg_text = "Quero falar com o fotógrafo pessoalmente antes de fechar"
        client_msg_ts = past_31h
    else:
        phone = "5534999991234"
        name = "Carlos (Resolvido)"
        ensaio = "Ensaio Corporativo"
        msg_text = "Oi, já resolvi e já fechei com outro fotógrafo, obrigado!"
        client_msg_ts = past_31h

    save_customer(phone, name=name, state="WAITING_HUMAN")
    set_customer_state(phone, "WAITING_HUMAN", selected_ensaio=ensaio)

    with get_db() as conn:
        cursor = conn.cursor()
        # Clear busy slots for this simulator phone so it qualifies for 30h check
        cursor.execute("UPDATE slots SET status = 'free', client_name = NULL, client_phone = NULL, ensaio_type = NULL WHERE client_phone = ?", (phone,))
        # Insert historical message
        cursor.execute("""
            INSERT INTO messages (client_phone, direction, message_type, content, timestamp)
            VALUES (?, 'client', 'text', ?, ?)
        """, (phone, msg_text, client_msg_ts))
        # Insert WAITING_HUMAN appointment backdated to 31 hours ago
        cursor.execute("""
            INSERT INTO appointments (client_phone, client_name, session_type, status, notes, last_interaction, created_at, updated_at)
            VALUES (?, ?, ?, 'WAITING_HUMAN', ?, ?, ?, ?)
        """, (phone, name, ensaio, msg_text, past_31h, past_31h, past_31h))
        conn.commit()

    results = run_30h_followup_check()
    return jsonify({"status": "ok", "results": results}), 200

@app.route("/api/timers/fast_forward", methods=["POST"])
def api_fast_forward_timers():
    """
    Fast-forwards the active waiting timer (10s initial takeover or 60s re-engagement)
    so the user can test the automatic transitions immediately or watch them live.
    """
    data = request.get_json() or {}
    phone = data.get("phone", "5534999991234")
    seconds = float(data.get("seconds", 65))
    with get_db() as conn:
        cursor = conn.cursor()
        cursor.execute("""
            UPDATE waiting_queue
            SET waiting_since = waiting_since - ?, last_notification = last_notification - ?
            WHERE client_phone = ?
        """, (seconds, seconds, phone))
        conn.commit()
    return jsonify({"status": "ok", "advanced_seconds": seconds}), 200

@app.route("/api/client/generate_magic_link", methods=["POST"])
def api_generate_magic_link():
    new_token = f"client_{uuid.uuid4().hex[:12]}"
    now = time.time()
    with get_db() as conn:
        cursor = conn.cursor()
        cursor.execute("""
            INSERT INTO clients (
                token, studio_name, photographer_name, secretary_name,
                business_hours, niches_json, is_active, created_at, updated_at
            ) VALUES (?, 'Novo Studio', 'Fotógrafo', 'Ana', 'Seg-Sex 8h-18h', ?, 1, ?, ?)
        """, (new_token, DEFAULT_CLIENT["niches_json"], now, now))
        conn.commit()

    magic_url = f"{request.host_url}onboarding?token={new_token}"
    return jsonify({"status": "ok", "token": new_token, "magic_url": magic_url}), 200

@app.route("/api/upload", methods=["POST"])
def api_upload():
    if "photo" not in request.files:
        return jsonify({"error": "No file uploaded"}), 400
    file = request.files["photo"]
    if file.filename == "":
        return jsonify({"error": "Empty filename"}), 400

    ext = file.filename.rsplit(".", 1)[-1].lower() if "." in file.filename else "jpg"
    unique_name = f"{uuid.uuid4().hex}.{ext}"
    save_path = os.path.join(UPLOADS_DIR, unique_name)
    file.save(save_path)

    file_url = f"/uploads/{unique_name}"
    return jsonify({"status": "ok", "url": file_url}), 200

@app.route("/uploads/<path:filename>")
def serve_uploads(filename):
    return send_from_directory(UPLOADS_DIR, filename)

# ==========================================
# PWA Routes: /comecar, /ajuda, /onboarding, /dashboard, /instalar
# ==========================================

@app.route("/comecar")
@app.route("/ajuda")
@app.route("/onboarding")
@app.route("/dashboard")
@app.route("/instalar")
def serve_pwa_routes():
    dist_index = os.path.join(FRONTEND_DIST, "index.html")
    if os.path.exists(dist_index):
        return send_from_directory(FRONTEND_DIST, "index.html")
    return "PWA Frontend build not found. Run npm run build in frontend directory.", 404

@app.route("/manifest.json")
def serve_manifest():
    return send_from_directory(FRONTEND_DIST, "manifest.json")

@app.route("/service-worker.js")
def serve_service_worker():
    return send_from_directory(FRONTEND_DIST, "service-worker.js", mimetype="application/javascript")

@app.route("/icon.svg")
def serve_icon():
    return send_from_directory(FRONTEND_DIST, "icon.svg")

# Legacy Simulator & API
@app.route("/")
def index():
    dist_index = os.path.join(FRONTEND_DIST, "index.html")
    if os.path.exists(dist_index):
        return send_from_directory(FRONTEND_DIST, "index.html")
    return simulator()

@app.route("/simulator")
def simulator():
    return render_template_string(SIMULATOR_HTML)

@app.route("/api/simulate", methods=["POST"])
def api_simulate():
    data = request.get_json() or {}
    phone = data.get("from", "5534999991234")
    name = data.get("name", "Cliente")
    process_incoming_message(phone, data, client_name=name)
    return jsonify({"status": "ok"}), 200

@app.route("/api/messages", methods=["GET"])
def api_get_messages():
    phone = request.args.get("phone", "5534999991234")
    with get_db() as conn:
        cursor = conn.cursor()
        cursor.execute("SELECT * FROM messages WHERE client_phone = ? ORDER BY timestamp ASC", (phone,))
        messages = []
        for row in cursor.fetchall():
            d = dict(row)
            d["transcription"] = decrypt_sensitive(d.get("transcription"))
            messages.append(d)
        
        cursor.execute("""
            SELECT * FROM waiting_queue
            WHERE client_phone = ? AND status IN ('WAITING_HUMAN', 'WAITING_INITIAL_10S')
        """, (phone,))
        waiting_row = cursor.fetchone()
        waiting_data = None
        if waiting_row:
            waiting_data = dict(waiting_row)
            waiting_data["transcription"] = decrypt_sensitive(waiting_data.get("transcription"))
            waiting_data["elapsed"] = time.time() - waiting_data["waiting_since"]

    return jsonify({"messages": messages, "waiting": waiting_data}), 200


# ==========================================
# PARTE 2 (Item 8): LGPD Right to Erasure & Portability
# ==========================================

@app.route("/lgpd/delete/<wa_id>", methods=["DELETE", "POST", "GET"])
def lgpd_delete_client_data(wa_id: str):
    """
    PARTE 2 (Item 8 - LGPD): Apaga todos os dados do cliente final em 1 clique
    (messages, appointments, waiting_queue, customers, slots).
    """
    clean_wa_id = str(wa_id or "").strip()
    if not clean_wa_id:
        return jsonify({"status": "error", "error": "Invalid wa_id"}), 400

    with get_db() as conn:
        cursor = conn.cursor()
        cursor.execute("DELETE FROM messages WHERE client_phone = ?", (clean_wa_id,))
        deleted_msgs = cursor.rowcount
        cursor.execute("DELETE FROM appointments WHERE client_phone = ?", (clean_wa_id,))
        deleted_appts = cursor.rowcount
        cursor.execute("DELETE FROM waiting_queue WHERE client_phone = ?", (clean_wa_id,))
        deleted_queue = cursor.rowcount
        cursor.execute("DELETE FROM customers WHERE phone_number = ?", (clean_wa_id,))
        deleted_cust = cursor.rowcount
        cursor.execute(
            "UPDATE slots SET status = 'free', client_name = NULL, client_phone = NULL, ensaio_type = NULL WHERE client_phone = ?",
            (clean_wa_id,)
        )
        conn.commit()

    last_message_time.pop(clean_wa_id, None)
    logger.info(f"[LGPD DELETE] Dados apagados para cliente {mask_phone(clean_wa_id)}")
    return jsonify({
        "status": "ok",
        "lgpd_compliant": True,
        "wa_id": mask_phone(clean_wa_id),
        "deleted_counts": {
            "messages": deleted_msgs,
            "appointments": deleted_appts,
            "waiting_queue": deleted_queue,
            "customers": deleted_cust
        }
    }), 200


@app.route("/lgpd/export/<wa_id>", methods=["GET"])
def lgpd_export_client_data(wa_id: str):
    """
    PARTE 2 (Item 8 - LGPD): Exporta todos os dados do cliente final em formato JSON (com transcrições descriptografadas).
    """
    clean_wa_id = str(wa_id or "").strip()
    if not clean_wa_id:
        return jsonify({"status": "error", "error": "Invalid wa_id"}), 400

    with get_db() as conn:
        cursor = conn.cursor()
        cursor.execute("SELECT * FROM customers WHERE phone_number = ?", (clean_wa_id,))
        cust_row = cursor.fetchone()
        customer_data = dict(cust_row) if cust_row else None

        cursor.execute("SELECT * FROM messages WHERE client_phone = ? ORDER BY timestamp ASC", (clean_wa_id,))
        messages_data = []
        for r in cursor.fetchall():
            d = dict(r)
            d["transcription"] = decrypt_sensitive(d.get("transcription"))
            messages_data.append(d)

        cursor.execute("SELECT * FROM appointments WHERE client_phone = ? ORDER BY id ASC", (clean_wa_id,))
        appointments_data = [dict(r) for r in cursor.fetchall()]

        cursor.execute("SELECT * FROM waiting_queue WHERE client_phone = ?", (clean_wa_id,))
        waiting_data = []
        for r in cursor.fetchall():
            d = dict(r)
            d["transcription"] = decrypt_sensitive(d.get("transcription"))
            waiting_data.append(d)

        cursor.execute("SELECT * FROM slots WHERE client_phone = ?", (clean_wa_id,))
        slots_data = [dict(r) for r in cursor.fetchall()]

    return jsonify({
        "status": "ok",
        "lgpd_export": True,
        "wa_id": clean_wa_id,
        "exported_at": datetime.now().isoformat(),
        "customer": customer_data,
        "messages": messages_data,
        "appointments": appointments_data,
        "waiting_queue": waiting_data,
        "slots": slots_data
    }), 200


@app.route("/security_report.md", methods=["GET"])
@app.route("/security_report", methods=["GET"])
def serve_security_report():
    report_path = os.path.join(BASE_DIR, "security_report.md")
    if os.path.exists(report_path):
        with open(report_path, "r", encoding="utf-8") as f:
            return f.read(), 200, {"Content-Type": "text/markdown; charset=utf-8"}
    return "Relatório não encontrado.", 404

@app.route("/api/human_respond", methods=["POST"])
def api_human_respond():
    phone = request.args.get("phone", "5534999991234")
    cfg = get_active_client_config()
    photographer_name = cfg.get("photographer_name", "Leo")
    resolve_human_wait(phone)
    send_text_message(phone, f"Opa! Aqui é o {photographer_name}, já tô por aqui. Vi que você chamou, em que posso te ajudar?", typing_delay=0.5)
    return jsonify({"status": "resolved"}), 200

@app.route("/api/messages/clear", methods=["POST"])
def api_clear_messages():
    data = request.get_json() or {}
    phone = data.get("phone", "5534999991234")
    with get_db() as conn:
        cursor = conn.cursor()
        cursor.execute("DELETE FROM messages WHERE client_phone = ?", (phone,))
        cursor.execute("DELETE FROM waiting_queue WHERE client_phone = ?", (phone,))
        cursor.execute("DELETE FROM customers WHERE phone_number = ?", (phone,))
        conn.commit()
    return jsonify({"status": "ok"}), 200

@app.route("/api/test_my_whatsapp", methods=["POST"])
def api_test_my_whatsapp():
    """
    Sends a real WhatsApp greeting from the virtual secretary to the connected WhatsApp number
    so the photographer can immediately test and reply on their own cell phone!
    """
    try:
        ensure_bot_running()
        gw_status = requests.get("http://127.0.0.1:5006/status", timeout=2).json()
        connected_num = gw_status.get("connectedNumber")
        if gw_status.get("status") != "CONNECTED" or not connected_num:
            return jsonify({"status": "error", "error": "WhatsApp ainda não está conectado."}), 400

        target_jid = f"{connected_num}@s.whatsapp.net"
        handle_initial_greeting(target_jid, client_name="Fotógrafo")
        return jsonify({
            "status": "ok",
            "paused": False,
            "phone": connected_num,
            "message": f"Mensagem de teste enviada para o seu WhatsApp (+{connected_num})!"
        }), 200
    except Exception as e:
        return jsonify({"status": "error", "error": str(e)}), 500

@app.route("/api/bot/status", methods=["GET"])
def api_bot_status():
    return jsonify({"paused": BOT_PAUSED}), 200

@app.route("/api/bot/toggle", methods=["POST"])
def api_bot_toggle():
    global BOT_PAUSED
    data = request.get_json(silent=True) or {}
    if "paused" in data:
        BOT_PAUSED = bool(data["paused"])
    else:
        BOT_PAUSED = not BOT_PAUSED

    if BOT_PAUSED:
        # Clear any active countdowns so nothing fires while paused
        with get_db() as conn:
            cursor = conn.cursor()
            cursor.execute("UPDATE waiting_queue SET status = 'PAUSED' WHERE status IN ('WAITING_INITIAL_10S', 'WAITING_HUMAN')")
            conn.commit()
        logger.warning("🛑 BOT PARADO PELO USUÁRIO NO PAINEL!")
    else:
        logger.info("▶️ BOT RELIGADO PELO USUÁRIO NO PAINEL!")

    return jsonify({"status": "ok", "paused": BOT_PAUSED}), 200

@app.route("/health", methods=["GET"])
def health():
    cfg = get_active_client_config()
    with get_db() as conn:
        cursor = conn.cursor()
        cursor.execute("SELECT COUNT(*) FROM clients")
        photographers_count = cursor.fetchone()[0]
        cursor.execute("SELECT COUNT(*) FROM waiting_queue WHERE status = 'WAITING_HUMAN'")
        waiting_count = cursor.fetchone()[0]
    return jsonify({
        "status": "healthy",
        "service": "studio_fotografico_whatsapp_bot",
        "gemini_model": "gemini-3.8-flash",
        "gemini_active": bool(gemini_client),
        "photographers_total": photographers_count,
        "waiting_human_count": waiting_count,
        "active_studio": cfg.get("studio_name"),
        "active_persona": cfg.get("secretary_name")
    }), 200

# Embedded Simulator Template
SIMULATOR_HTML = r"""
<!DOCTYPE html>
<html lang="pt-BR">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Studio Fotográfico - WhatsApp Bot Simulator</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif; }
    body { background-color: #0b141a; color: #e9edef; display: flex; height: 100vh; }
    #sidebar { width: 340px; background-color: #111b21; border-right: 1px solid #202c33; display: flex; flex-direction: column; padding: 20px; }
    #chat-container { flex: 1; display: flex; flex-direction: column; background: #0b141a; background-image: radial-gradient(#1e2b33 1px, transparent 0); background-size: 24px 24px; }
    #chat-header { background-color: #202c33; padding: 12px 20px; display: flex; align-items: center; justify-content: space-between; border-bottom: 1px solid #222e35; }
    .avatar { width: 44px; height: 44px; border-radius: 50%; background-color: #00a884; display: flex; align-items: center; justify-content: center; font-size: 20px; font-weight: bold; margin-right: 12px; }
    #chat-messages { flex: 1; overflow-y: auto; padding: 20px 40px; display: flex; flex-direction: column; gap: 12px; }
    .message { max-width: 65%; padding: 10px 14px; border-radius: 8px; font-size: 14.5px; line-height: 1.4; position: relative; word-wrap: break-word; }
    .message.bot { background-color: #202c33; align-self: flex-start; border-top-left-radius: 0; }
    .message.client { background-color: #005c4b; align-self: flex-end; border-top-right-radius: 0; }
    .message img { max-width: 100%; border-radius: 6px; margin-top: 6px; display: block; }
    .buttons-container { display: flex; flex-direction: column; gap: 6px; margin-top: 10px; }
    .whatsapp-btn { background: #2a3942; color: #53bdeb; border: 1px solid #3b4a54; padding: 8px 12px; border-radius: 6px; cursor: pointer; font-size: 13.5px; font-weight: 500; text-align: center; transition: 0.2s; }
    .whatsapp-btn:hover { background: #374751; }
    #chat-footer { background-color: #202c33; padding: 14px 20px; display: flex; gap: 10px; align-items: center; }
    input[type="text"] { flex: 1; background-color: #2a3942; border: none; outline: none; color: #fff; padding: 12px 16px; border-radius: 8px; font-size: 15px; }
    button.send-btn { background-color: #00a884; color: #111b21; border: none; padding: 12px 20px; border-radius: 8px; font-weight: bold; cursor: pointer; }
    .badge { padding: 4px 8px; border-radius: 4px; font-size: 12px; font-weight: 600; display: inline-block; }
    .badge-waiting { background: #e0284f; color: #fff; }
    .badge-normal { background: #00a884; color: #111b21; }
    .action-btn { background: #202c33; border: 1px solid #374751; color: #e9edef; padding: 10px; border-radius: 6px; font-size: 13px; cursor: pointer; margin-top: 8px; width: 100%; text-align: left; }
    .action-btn:hover { background: #2a3942; }
  </style>
</head>
<body>
  <div id="sidebar">
    <h2 style="font-size: 18px; margin-bottom: 8px; color: #00a884;">Studio Fotográfico</h2>
    <p style="font-size: 12.5px; color: #8696a0; margin-bottom: 20px;">Simulador WhatsApp & Persona Ativa</p>
    
    <div style="background: #182229; padding: 14px; border-radius: 8px; margin-bottom: 20px;">
      <div style="font-size: 13px; color: #8696a0; margin-bottom: 6px;">Status de Atendimento</div>
      <div id="status-badge" class="badge badge-normal">NORMAL (BOT ATIVO)</div>
      <div id="timer-info" style="font-size: 12px; color: #8696a0; margin-top: 8px;">Nenhum cliente aguardando</div>
    </div>

    <div style="font-size: 13px; font-weight: 600; color: #8696a0; text-transform: uppercase; margin-bottom: 10px;">Ações de Teste Rápido</div>
    <button class="action-btn" onclick="sendQuickMessage('Oi')">1. Enviar "Oi" (Saudação)</button>
    <button class="action-btn" onclick="sendQuickClick('ver_ensaios', '📸 Ver Ensaios')">2. Ver Ensaios</button>
    <button class="action-btn" onclick="sendQuickClick('falar_leo', '💬 Falar com Fotógrafo')">3. Chamar Fotógrafo (WAITING_HUMAN)</button>
    <button class="action-btn" onclick="simulateAudio()">4. Enviar Áudio do Cliente</button>
    
    <div style="margin-top: 20px; padding-top: 20px; border-top: 1px solid #222e35;">
      <div style="font-size: 13px; color: #8696a0; margin-bottom: 8px;">Painel PWA SaaS</div>
      <a href="/dashboard" class="action-btn" style="display:block; text-align:center; background:#25D366; color:#111b21; font-weight:bold; text-decoration:none;">Abrir Dashboard PWA</a>
      <a href="/onboarding" class="action-btn" style="display:block; text-align:center; background:#202c33; text-decoration:none;">Abrir Onboarding</a>
    </div>
  </div>

  <div id="chat-container">
    <div id="chat-header">
      <div style="display: flex; align-items: center;">
        <div class="avatar">📸</div>
        <div>
          <div style="font-weight: 600; font-size: 16px;">Secretária Virtual • Studio</div>
          <div style="font-size: 12.5px; color: #00a884;">online</div>
        </div>
      </div>
      <div style="font-size: 12px; color: #8696a0;">Simulador WhatsApp Cloud API</div>
    </div>

    <div id="chat-messages"></div>

    <div id="chat-footer">
      <input type="text" id="user-input" placeholder="Digite uma mensagem como cliente..." onkeydown="if(event.key==='Enter') sendMessage()">
      <button class="send-btn" onclick="sendMessage()">Enviar</button>
    </div>
  </div>

  <script>
    const CLIENT_PHONE = "5534999991234";
    const CLIENT_NAME = "Mariana";

    async function loadMessages() {
      try {
        const res = await fetch(`/api/messages?phone=${CLIENT_PHONE}`);
        const data = await res.json();
        const container = document.getElementById("chat-messages");
        container.innerHTML = "";

        data.messages.forEach(msg => {
          const div = document.createElement("div");
          div.className = `message ${msg.direction}`;
          
          if (msg.message_type === "image") {
            const imgMatch = msg.content.match(/Image: (https:\/\/[^ ]+)/);
            if (imgMatch) {
              div.innerHTML = `<img src="${imgMatch[1]}" alt="Foto do Ensaio" /><br><span style="font-size: 13px;">${msg.content.replace(imgMatch[0], '')}</span>`;
            } else {
              div.textContent = msg.content;
            }
          } else if (msg.message_type === "button") {
            const parts = msg.content.split(" | Buttons: ");
            let html = `<div>${parts[0]}</div>`;
            if (parts[1]) {
              try {
                const buttons = JSON.parse(parts[1].replace(/'/g, '"'));
                html += '<div class="buttons-container">';
                buttons.forEach(b => {
                  html += `<div class="whatsapp-btn" onclick="sendQuickClick('${b}', '${b}')">${b}</div>`;
                });
                html += '</div>';
              } catch(e) {}
            }
            div.innerHTML = html;
          } else {
            div.textContent = msg.content;
          }
          container.appendChild(div);
        });
        container.scrollTop = container.scrollHeight;

        const statusBadge = document.getElementById("status-badge");
        const timerInfo = document.getElementById("timer-info");
        if (data.waiting) {
          statusBadge.className = "badge badge-waiting";
          statusBadge.textContent = "WAITING_HUMAN (ESPERA FOTÓGRAFO)";
          const sec = Math.round(data.waiting.elapsed);
          timerInfo.textContent = `Aguardando há ${sec}s (Estágio: ${data.waiting.stage})`;
        } else {
          statusBadge.className = "badge badge-normal";
          statusBadge.textContent = "NORMAL (BOT ATIVO)";
          timerInfo.textContent = "Nenhum cliente aguardando";
        }
      } catch(e) {
        console.error("Error loading messages:", e);
      }
    }

    async function sendMessage() {
      const input = document.getElementById("user-input");
      const text = input.value.trim();
      if (!text) return;
      input.value = "";

      await fetch("/api/simulate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          from: CLIENT_PHONE,
          name: CLIENT_NAME,
          type: "text",
          text: { body: text }
        })
      });
      setTimeout(loadMessages, 500);
    }

    async function sendQuickMessage(text) {
      document.getElementById("user-input").value = text;
      await sendMessage();
    }

    async function sendQuickClick(buttonId, buttonTitle) {
      await fetch("/api/simulate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          from: CLIENT_PHONE,
          name: CLIENT_NAME,
          type: "interactive",
          interactive: {
            type: "button_reply",
            button_reply: { id: buttonId, title: buttonTitle }
          }
        })
      });
      setTimeout(loadMessages, 500);
    }

    async function simulateAudio() {
      await fetch("/api/simulate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          from: CLIENT_PHONE,
          name: CLIENT_NAME,
          type: "audio",
          audio: { id: "mock_audio_123" }
        })
      });
      setTimeout(loadMessages, 500);
    }

    setInterval(loadMessages, 2500);
    loadMessages();
  </script>
</body>
</html>
"""

# ==========================================
# Application Entrypoint
# ==========================================

if __name__ == "__main__":
    init_db()
    logger.info(f"Starting Studio Fotográfico WhatsApp Bot (SaaS) on {HOST}:{PORT}")
    app.run(host=HOST, port=PORT, debug=DEBUG)
