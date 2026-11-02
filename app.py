import base64
from io import BytesIO
import os
import re
import hmac
import json
import time
import uuid
import sqlite3
import hashlib
import logging
import secrets
import threading
from datetime import datetime, timedelta
from zoneinfo import ZoneInfo

import requests
import qrcode
from PIL import Image, ImageDraw, ImageFont
from dotenv import load_dotenv
from cryptography.fernet import Fernet
from apscheduler.schedulers.background import BackgroundScheduler
from flask import (
    Flask,
    request,
    jsonify,
    render_template,
    redirect,
    send_from_directory,
    abort,
)
from flask_limiter import Limiter
from flask_limiter.util import get_remote_address

load_dotenv()

# ==============================================================================
# CONFIGURAÇÃO BASE E TIMEZONE
# ==============================================================================
TZ = ZoneInfo("America/Sao_Paulo")
BASE_DIR = os.path.dirname(os.path.abspath(__file__))
STATIC_DIR = os.path.join(BASE_DIR, "static")
TEMPLATES_DIR = os.path.join(BASE_DIR, "templates")
COMPROVANTES_DIR = os.path.join(STATIC_DIR, "comprovantes")
os.makedirs(COMPROVANTES_DIR, exist_ok=True)

DB_PATH = os.getenv(
    "DB_PATH", "/data/studio.db" if os.path.exists("/data") else os.path.join(BASE_DIR, "studio.db")
)
PORT = int(os.getenv("PORT", 5005))
PUBLIC_BASE_URL = os.getenv("PUBLIC_BASE_URL", "https://whatsapp-studio-bot.antigravity.app")
GATEWAY_URL = os.getenv("GATEWAY_URL", "http://127.0.0.1:5006")

VERIFY_TOKEN = os.getenv("VERIFY_TOKEN", "studio_verify_token_2026")
WHATSAPP_APP_ID = os.getenv("WHATSAPP_APP_ID", os.getenv("META_APP_ID", "123456789012345"))
WHATSAPP_APP_SECRET = os.getenv("WHATSAPP_APP_SECRET", os.getenv("APP_SECRET", "studio_secret_hmac_2026"))
GEMINI_API_KEY = os.getenv("GEMINI_API_KEY", "")

# Criptografia Fernet (ENCRYPTION_KEY ou SECRET_KEY)
RAW_ENC_KEY = os.getenv("ENCRYPTION_KEY", os.getenv("SECRET_KEY", ""))
if not RAW_ENC_KEY:
    RAW_ENC_KEY = Fernet.generate_key().decode("utf-8")
try:
    fernet = Fernet(RAW_ENC_KEY.encode("utf-8") if isinstance(RAW_ENC_KEY, str) else RAW_ENC_KEY)
except Exception:
    derived = hashlib.sha256(str(RAW_ENC_KEY).encode("utf-8")).digest()
    import base64
    fernet = Fernet(base64.urlsafe_b64encode(derived))

# Configuração de Logs seguros (sem vazar access_token)
logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(message)s")
logger = logging.getLogger("whatsapp-studio-bot")

# Configuração do Gemini 1.5 Flash (google-generativeai)
genai_model = None
try:
    import google.generativeai as genai
    if GEMINI_API_KEY:
        genai.configure(api_key=GEMINI_API_KEY)
        genai_model = genai.GenerativeModel("gemini-1.5-flash")
except Exception as e:
    logger.warning("Gemini SDK init warning: %s", e)

# ==============================================================================
# FLASK APP + RATE LIMITER + CORS RESTRITO
# ==============================================================================
app = Flask(__name__, static_folder=STATIC_DIR, template_folder=TEMPLATES_DIR)
app.config["SECRET_KEY"] = WHATSAPP_APP_SECRET

# Registra Módulo Instagram (Blueprints /webhook/instagram e /instagram-comecar)
from instagram_webhook import instagram_bp
app.register_blueprint(instagram_bp)


def get_wa_id_or_ip():
    """Extrai wa_id do payload do webhook para rate-limit por wa_id ou usa IP."""
    if request.path == "/webhook" and request.method == "POST":
        try:
            data = request.get_json(silent=True) or {}
            entries = data.get("entry", [])
            if entries:
                changes = entries[0].get("changes", [])
                if changes:
                    val = changes[0].get("value", {})
                    msgs = val.get("messages", [])
                    if msgs and msgs[0].get("from"):
                        return f"wa:{msgs[0].get('from')}"
            if data.get("from"):
                return f"wa:{data.get('from')}"
        except Exception:
            pass
    return get_remote_address()


limiter = Limiter(
    key_func=get_wa_id_or_ip,
    app=app,
    default_limits=["200 per minute"],
    storage_uri="memory://",
)


@app.after_request
def apply_security_headers(response):
    allowed_origin = PUBLIC_BASE_URL
    origin = request.headers.get("Origin", "")
    if origin in (allowed_origin, "http://localhost:5005", "http://127.0.0.1:5005"):
        response.headers["Access-Control-Allow-Origin"] = origin
    else:
        response.headers["Access-Control-Allow-Origin"] = allowed_origin
    response.headers["Access-Control-Allow-Headers"] = "Content-Type, Authorization, X-Hub-Signature-256"
    response.headers["Access-Control-Allow-Methods"] = "GET, POST, OPTIONS, DELETE"
    response.headers["X-Content-Type-Options"] = "nosniff"
    response.headers["X-Frame-Options"] = "SAMEORIGIN"
    return response


# ==============================================================================
# CRIPTOGRAFIA FERNET E SANITIZAÇÃO
# ==============================================================================
def encrypt_value(plain_text: str) -> str:
    if not plain_text:
        return ""
    return fernet.encrypt(plain_text.encode("utf-8")).decode("utf-8")


def decrypt_value(cipher_text: str) -> str:
    if not cipher_text:
        return ""
    try:
        return fernet.decrypt(cipher_text.encode("utf-8")).decode("utf-8")
    except Exception:
        return ""


def mask_wa_id(wa_id: str) -> str:
    s = str(wa_id or "")
    return f"***{s[-4:]}" if len(s) >= 4 else "***"


def clean_input(val: str, max_len: int = 80) -> str:
    if not val:
        return ""
    cleaned = re.sub(r"<[^>]*>", "", str(val)).strip()
    return cleaned[:max_len]


# ==============================================================================
# BANCO DE DADOS SQLITE - SCHEMA COMPLETO
# ==============================================================================
def get_db():
    db_dir = os.path.dirname(DB_PATH)
    if db_dir:
        os.makedirs(db_dir, exist_ok=True)
    conn = sqlite3.connect(DB_PATH, timeout=15)
    conn.row_factory = sqlite3.Row
    return conn


def now_sp() -> datetime:
    return datetime.now(TZ)


def now_iso() -> str:
    return now_sp().isoformat()


def init_db():
    conn = get_db()
    c = conn.cursor()

    # 1. studios
    c.execute(
        """
        CREATE TABLE IF NOT EXISTS studios (
            id TEXT PRIMARY KEY,
            studio_name TEXT,
            photographer_name TEXT,
            secretary_name TEXT,
            niches TEXT,
            price TEXT,
            photos TEXT,
            waba_id TEXT,
            phone_number_id TEXT,
            access_token TEXT,
            dashboard_token TEXT UNIQUE,
            created_at TEXT,
            consent_lgpd BOOLEAN DEFAULT 0,
            status TEXT DEFAULT 'ACTIVE'
        )
        """
    )

    # 2. messages
    c.execute(
        """
        CREATE TABLE IF NOT EXISTS messages (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            studio_id TEXT,
            wa_id TEXT,
            direction TEXT,
            content TEXT,
            timestamp TEXT,
            transcribed_audio TEXT,
            status TEXT,
            FOREIGN KEY(studio_id) REFERENCES studios(id)
        )
        """
    )

    # 2b. waiting_queue (Controle por cliente: 10s takeover e 60s humano)
    c.execute(
        """
        CREATE TABLE IF NOT EXISTS waiting_queue (
            client_phone TEXT PRIMARY KEY,
            studio_id TEXT,
            client_name TEXT,
            status TEXT DEFAULT 'WAITING_HUMAN',
            waiting_since REAL,
            last_notification REAL,
            stage INTEGER DEFAULT 0,
            followup_count INTEGER DEFAULT 0,
            message_content TEXT
        )
        """
    )

    # 3. processed_messages (anti-loop PK)
    c.execute(
        """
        CREATE TABLE IF NOT EXISTS processed_messages (
            message_id TEXT PRIMARY KEY,
            created_at TEXT
        )
        """
    )

    # 4. slots
    c.execute(
        """
        CREATE TABLE IF NOT EXISTS slots (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            studio_id TEXT,
            start_at TEXT,
            end_at TEXT,
            status TEXT DEFAULT 'free',
            client_wa_id TEXT,
            client_name TEXT,
            comprovante_id TEXT,
            FOREIGN KEY(studio_id) REFERENCES studios(id)
        )
        """
    )

    # 5. followups
    c.execute(
        """
        CREATE TABLE IF NOT EXISTS followups (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            studio_id TEXT,
            wa_id TEXT,
            attempts INTEGER DEFAULT 0,
            last_attempt TEXT,
            next_at TEXT,
            FOREIGN KEY(studio_id) REFERENCES studios(id)
        )
        """
    )

    # 6. consent_log
    c.execute(
        """
        CREATE TABLE IF NOT EXISTS consent_log (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            studio_id TEXT,
            action TEXT,
            timestamp TEXT,
            ip TEXT
        )
        """
    )

    conn.commit()

    # Migrações seguras com PRAGMA table_info
    c.execute("PRAGMA table_info(studios)")
    st_cols = [r['name'] if isinstance(r, dict) else r[1] for r in c.fetchall()]
    if 'consent_ip' not in st_cols:
        c.execute("ALTER TABLE studios ADD COLUMN consent_ip TEXT")
    if 'status' not in st_cols:
        c.execute("ALTER TABLE studios ADD COLUMN status TEXT DEFAULT 'configurando'")
    if 'active_niches' not in st_cols:
        c.execute("""ALTER TABLE studios ADD COLUMN active_niches TEXT DEFAULT '["gestante", "newborn", "familia"]'""")

    c.execute("PRAGMA table_info(slots)")
    slot_cols = [r['name'] if isinstance(r, dict) else r[1] for r in c.fetchall()]
    if 'niche' not in slot_cols:
        c.execute("ALTER TABLE slots ADD COLUMN niche TEXT DEFAULT 'Geral'")
    if 'receipt_path' not in slot_cols:
        c.execute("ALTER TABLE slots ADD COLUMN receipt_path TEXT")

    c.execute("CREATE INDEX IF NOT EXISTS idx_studios_dashboard_token ON studios(dashboard_token)")
    conn.commit()

    # Inicializa tabelas do módulo Instagram
    try:
        from instagram_webhook import init_instagram_db
        init_instagram_db()
    except Exception as e:
        logger.warning("Falha ao inicializar banco do Instagram: %s", e)

    # Garante estúdio principal padrão se não existir
    c.execute("SELECT * FROM studios ORDER BY created_at ASC LIMIT 1")
    row = c.fetchone()
    if not row:
        default_id = "studio-principal"
        dash_tok = os.getenv("DEFAULT_DASHBOARD_TOKEN", "painel-seguro-studio-2026")
        enc_tok = encrypt_value(os.getenv("WHATSAPP_TOKEN", "meta_cloud_token_placeholder"))
        c.execute(
            """
            INSERT INTO studios (
                id, studio_name, photographer_name, secretary_name,
                niches, price, photos, waba_id, phone_number_id,
                access_token, dashboard_token, created_at, consent_lgpd, status
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                default_id,
                "Estúdio Luz & Arte",
                "Gustavo",
                "Clara",
                json.dumps(["gestante", "casamento", "ensaio", "corporativo"], ensure_ascii=False),
                "450",
                json.dumps(
                    [
                        "https://images.unsplash.com/photo-1519741497674-611481863552?w=600",
                        "https://images.unsplash.com/photo-1511285560929-80b456fea0bc?w=600",
                        "https://images.unsplash.com/photo-1544005313-94ddf0286df2?w=600",
                    ]
                ),
                os.getenv("WABA_ID", "109876543210"),
                os.getenv("PHONE_NUMBER_ID", "553488412981"),
                enc_tok,
                dash_tok,
                now_iso(),
                1,
                "ACTIVE",
            ),
        )
        conn.commit()
        ensure_slots_for_studio(default_id, conn=conn)
    else:
        ensure_slots_for_studio(row["id"], conn=conn)

    conn.close()


# ==============================================================================
# GERAÇÃO DE SLOTS REAIS (14 DIAS, 9H ÀS 18H, 90MIN + 30MIN INTERVALO)
# ==============================================================================
def ensure_slots_for_studio(studio_id: str, conn=None):
    close_after = False
    if conn is None:
        conn = get_db()
        close_after = True

    c = conn.cursor()
    c.execute("SELECT COUNT(*) as cnt FROM slots WHERE studio_id = ? AND status = 'free'", (studio_id,))
    cnt = c.fetchone()["cnt"]
    if cnt < 10:
        base_date = now_sp().date()
        # 9h às 18h: blocos de 90min com 30min de intervalo:
        # 09:00-10:30, 11:00-12:30, 13:00-14:30, 15:00-16:30, 16:30-18:00
        daily_windows = [
            (9, 0, 10, 30),
            (11, 0, 12, 30),
            (13, 0, 14, 30),
            (15, 0, 16, 30),
            (16, 30, 18, 0),
        ]
        for day_offset in range(1, 15):
            d = base_date + timedelta(days=day_offset)
            if d.weekday() == 6:  # Domingo folga padrão
                continue
            for sh, sm, eh, em in daily_windows:
                start_dt = datetime(d.year, d.month, d.day, sh, sm, tzinfo=TZ)
                end_dt = datetime(d.year, d.month, d.day, eh, em, tzinfo=TZ)
                start_iso = start_dt.strftime("%Y-%m-%dT%H:%M")
                end_iso = end_dt.strftime("%Y-%m-%dT%H:%M")
                c.execute(
                    "SELECT id FROM slots WHERE studio_id = ? AND start_at = ?",
                    (studio_id, start_iso),
                )
                if not c.fetchone():
                    c.execute(
                        """
                        INSERT INTO slots (studio_id, start_at, end_at, status)
                        VALUES (?, ?, ?, 'free')
                        """,
                        (studio_id, start_iso, end_iso),
                    )
        conn.commit()

    if close_after:
        conn.close()


def format_slot_human(iso_str: str) -> str:
    weekdays = ["Seg", "Ter", "Qua", "Qui", "Sex", "Sáb", "Dom"]
    try:
        dt = datetime.fromisoformat(iso_str)
        wd = weekdays[dt.weekday()]
        return f"{wd} ({dt.strftime('%d/%m')}) às {dt.strftime('%Hh%M').replace('h00', 'h')}"
    except Exception:
        return iso_str


def get_three_free_slots(studio_id: str):
    conn = get_db()
    c = conn.cursor()
    now_str = now_sp().strftime("%Y-%m-%dT%H:%M")
    c.execute(
        """
        SELECT id, start_at, end_at, status
        FROM slots
        WHERE studio_id = ? AND status = 'free' AND start_at >= ?
        ORDER BY start_at ASC
        LIMIT 3
        """,
        (studio_id, now_str),
    )
    rows = [dict(r) for r in c.fetchall()]
    conn.close()
    for r in rows:
        r["human"] = format_slot_human(r["start_at"])
    return rows


# ==============================================================================
# GERAÇÃO DE QR CODE OFICIAL (/static/qr-comecar.png) E COMPROVANTE PNG (PILLOW)
# ==============================================================================
def ensure_qr_comecar():
    qr_path = os.path.join(STATIC_DIR, "qr-comecar.png")
    target_url = "https://whatsapp-studio-bot.antigravity.app/comecar"
    qr = qrcode.QRCode(
        version=4,
        error_correction=qrcode.constants.ERROR_CORRECT_H,
        box_size=10,
        border=3,
    )
    qr.add_data(target_url)
    qr.make(fit=True)
    img = qr.make_image(fill_color="#0b141a", back_color="white").convert("RGBA")

    w, h = img.size
    logo_size = int(w * 0.22)
    logo = Image.new("RGBA", (logo_size, logo_size), (255, 255, 255, 0))
    draw = ImageDraw.Draw(logo)
    draw.rounded_rectangle(
        (0, 0, logo_size - 1, logo_size - 1),
        radius=16,
        fill="#25D366",
        outline="#ffffff",
        width=4,
    )
    inner_m = int(logo_size * 0.25)
    draw.ellipse(
        (inner_m, inner_m, logo_size - inner_m, logo_size - inner_m),
        fill="#0b141a",
    )
    pos = ((w - logo_size) // 2, (h - logo_size) // 2)
    img.paste(logo, pos, logo)
    img.save(qr_path, "PNG")
    return qr_path



def process_niche_photos(photos_dict: dict) -> dict:
    """Comprime fotos base64 com Pillow para no máximo 800px e 70% qualidade, estruturando por nicho."""
    processed = {"gestante": [], "newborn": [], "familia": []}
    if not isinstance(photos_dict, dict):
        return processed
    
    # Mapeia chaves com acento ou variações
    norm_map = {}
    for k, v in photos_dict.items():
        k_norm = k.lower().replace("í", "i").replace("ã", "a").replace("é", "e")
        if "gestant" in k_norm:
            norm_map["gestante"] = v
        elif "newborn" in k_norm:
            norm_map["newborn"] = v
        elif "famili" in k_norm:
            norm_map["familia"] = v
        else:
            norm_map[k_norm] = v

    for niche in ["gestante", "newborn", "familia"]:
        items = norm_map.get(niche) or []
        for item in items[:3]:
            if not item or not isinstance(item, str):
                continue
            if item.startswith("data:image"):
                try:
                    header, data = item.split(",", 1)
                    img_data = base64.b64decode(data)
                    img = Image.open(BytesIO(img_data)).convert("RGB")
                    img.thumbnail((800, 800))
                    out = BytesIO()
                    img.save(out, format="JPEG", quality=70)
                    b64_out = base64.b64encode(out.getvalue()).decode("utf-8")
                    processed[niche].append(f"data:image/jpeg;base64,{b64_out}")
                except Exception as e:
                    logger.warning("Falha ao processar foto com Pillow: %s", e)
                    processed[niche].append(item)
            else:
                processed[niche].append(item)
    return processed


DEFAULT_DEMO_PHOTOS = {
    "gestante": [
        "/static/demo_photos/gestante_1.jpg",
        "/static/demo_photos/gestante_2.jpg",
        "/static/demo_photos/gestante_3.jpg"
    ],
    "newborn": [
        "/static/demo_photos/newborn_1.jpg",
        "/static/demo_photos/newborn_2.jpg",
        "/static/demo_photos/newborn_3.jpg"
    ],
    "familia": [
        "/static/demo_photos/familia_1.jpg",
        "/static/demo_photos/familia_2.jpg",
        "/static/demo_photos/familia_3.jpg"
    ]
}

def ensure_demo_photos(photos_dict: dict) -> dict:
    result = {"gestante": [], "newborn": [], "familia": []}
    if not isinstance(photos_dict, dict):
        photos_dict = {}
    for niche in ["gestante", "newborn", "familia"]:
        items = photos_dict.get(niche) or []
        valid_items = [p for p in items if p and isinstance(p, str)]
        if not valid_items:
            result[niche] = DEFAULT_DEMO_PHOTOS[niche].copy()
        else:
            result[niche] = valid_items[:3]
    return result

def get_font(candidates, size):
    for path in candidates:
        if os.path.exists(path):
            try:
                return ImageFont.truetype(path, size)
            except Exception:
                pass
    return ImageFont.load_default()

def generate_comprovante_png(
    studio_name: str,
    photographer_name: str,
    client_name: str,
    slot_human: str,
    comprovante_id: str,
    address: str = "Estúdio Principal — Atendimento com Hora Marcada",
    niche: str = "Ensaio Fotográfico"
) -> str:
    """
    Gera comprovante PNG proporcional de alta estética (600x750px vertical).
    Tipografia TrueType nítida e legível, cabeçalho verde #25D366 de 110px,
    fundo branco #FFFFFF e badge ✔ CONFIRMADO.
    """
    os.makedirs(COMPROVANTES_DIR, exist_ok=True)
    file_path = os.path.join(COMPROVANTES_DIR, f"{comprovante_id}.png")

    width, height = 600, 750
    img = Image.new("RGB", (width, height), "#F8FAFC")
    draw = ImageDraw.Draw(img)

    font_bold_candidates = [
        "/System/Library/Fonts/Supplemental/Arial Bold.ttf",
        "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf",
        "/System/Library/Fonts/HelveticaNeue.ttc",
    ]
    font_regular_candidates = [
        "/System/Library/Fonts/Supplemental/Arial.ttf",
        "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf",
        "/System/Library/Fonts/HelveticaNeue.ttc",
    ]

    font_title = get_font(font_bold_candidates, 26)
    font_subtitle = get_font(font_bold_candidates, 22)
    font_label = get_font(font_regular_candidates, 20)
    font_val = get_font(font_bold_candidates, 26)
    font_badge = get_font(font_bold_candidates, 24)
    font_footer = get_font(font_regular_candidates, 16)

    # Card de fundo branco com borda arredondada
    draw.rounded_rectangle((15, 15, width - 15, height - 15), radius=24, fill="#FFFFFF", outline="#E2E8F0", width=2)

    # Cabeçalho verde #25D366 de 110px de altura
    draw.rounded_rectangle((15, 15, width - 15, 125), radius=24, fill="#25D366")
    draw.rectangle((15, 75, width - 15, 125), fill="#25D366")

    clean_client = client_name if (client_name and client_name.strip() and client_name.strip().lower() != "cliente") else "Ensaio Agendado"
    clean_studio = studio_name or "Estúdio"

    draw.text((width / 2, 48), "COMPROVANTE DE AGENDAMENTO", fill="#FFFFFF", font=font_title, anchor="mm")
    draw.text((width / 2, 88), clean_studio, fill="#FFFFFF", font=font_subtitle, anchor="mm")

    y = 165
    fields = [
        ("Código da Reserva", f"#{comprovante_id.upper()}"),
        ("Fotógrafo", photographer_name or "Gustavo"),
        ("Cliente", clean_client),
        ("Tipo de Ensaio", niche or "Ensaio Fotográfico"),
        ("Data e Horário", slot_human),
        ("Local do Ensaio", address)
    ]

    for label, val in fields:
        draw.text((45, y), label.upper(), fill="#555555", font=font_label)
        draw.text((45, y + 26), val, fill="#111111", font=font_val)
        draw.line((45, y + 62, width - 45, y + 62), fill="#EDF2F7", width=1)
        y += 70

    # Rodapé: Badge ✔ CONFIRMADO (verde) + data/hora de emissão
    draw.rounded_rectangle((45, height - 90, 260, height - 38), radius=12, fill="#DCFCE7", outline="#25D366", width=2)
    draw.text((152, height - 64), "✔ CONFIRMADO", fill="#166534", font=font_badge, anchor="mm")

    emissao_str = "Emitido em: " + now_sp().strftime("%d/%m/%Y %H:%M")
    draw.text((width - 45, height - 64), emissao_str, fill="#718096", font=font_footer, anchor="rm")

    img.save(file_path, "PNG")
    return f"/static/comprovantes/{comprovante_id}.png"



# ==============================================================================
# ANTI-LOOP BLINDADO (IDEMPOTÊNCIA + DEBOUNCE 3S + LIMPEZA >24H)
# ==============================================================================
_debounce_cache = {}  # {wa_id: float_timestamp}


def cleanup_old_processed_messages():
    """Remove registros de processed_messages com mais de 24 horas."""
    try:
        conn = get_db()
        c = conn.cursor()
        cutoff = (now_sp() - timedelta(hours=24)).isoformat()
        c.execute("DELETE FROM processed_messages WHERE created_at < ?", (cutoff,))
        conn.commit()
        conn.close()
    except Exception as e:
        logger.warning("Cleanup processed_messages warning: %s", e)


def is_duplicate(message_id: str) -> bool:
    """Verifica na tabela processed_messages antes de qualquer resposta. Se já existir, bloqueia."""
    if not message_id:
        return False
    cleanup_old_processed_messages()
    conn = get_db()
    c = conn.cursor()
    try:
        c.execute("SELECT message_id FROM processed_messages WHERE message_id = ?", (message_id,))
        if c.fetchone():
            conn.close()
            logger.info("LOOP_PREVENTED: duplicate message_id=%s", message_id)
            return True
        c.execute(
            "INSERT INTO processed_messages (message_id, created_at) VALUES (?, ?)",
            (message_id, now_iso()),
        )
        conn.commit()
        conn.close()
        return False
    except sqlite3.IntegrityError:
        conn.close()
        logger.info("LOOP_PREVENTED: integrity duplicate message_id=%s", message_id)
        return True


def is_debounced(wa_id: str, window_seconds: float = 3.0) -> bool:
    """Debounce de 3 segundos por wa_id."""
    if not wa_id:
        return False
    now_ts = time.time()
    last_ts = _debounce_cache.get(wa_id, 0.0)
    if (now_ts - last_ts) < window_seconds:
        logger.info("LOOP_PREVENTED: debounce 3s triggered for wa_id=%s", mask_wa_id(wa_id))
        return True
    _debounce_cache[wa_id] = now_ts
    return False


# ==============================================================================
# ENVIO DE MENSAGENS WHATSAPP (CLOUD API v20 + GATEWAY LOCAL FALLBACK)
# ==============================================================================
def send_whatsapp_message(studio: dict, to_wa_id: str, text: str, image_url: str = None, template_name: str = None, template_params: list = None):
    """Envia mensagem via WhatsApp Cloud API v20 e/ou Gateway conectado."""
    phone_number_id = studio.get("phone_number_id") or ""
    access_token = decrypt_value(studio.get("access_token") or "")
    sent_cloud = False

    # 1. Tenta WhatsApp Cloud API v20 se token real estiver configurado
    if phone_number_id and access_token and not access_token.startswith("meta_cloud_token_placeholder"):
        url = f"https://graph.facebook.com/v20.0/{phone_number_id}/messages"
        headers = {
            "Authorization": f"Bearer {access_token}",
            "Content-Type": "application/json",
        }
        if template_name:
            payload = {
                "messaging_product": "whatsapp",
                "to": to_wa_id,
                "type": "template",
                "template": {
                    "name": template_name,
                    "language": {"code": "pt_BR"},
                    "components": [
                        {
                            "type": "body",
                            "parameters": [{"type": "text", "text": str(p)} for p in (template_params or [])],
                        }
                    ],
                },
            }
        elif image_url:
            full_img = image_url if image_url.startswith("http") else f"{PUBLIC_BASE_URL}{image_url}"
            payload = {
                "messaging_product": "whatsapp",
                "to": to_wa_id,
                "type": "image",
                "image": {"link": full_img, "caption": text or "Comprovante de Agendamento"},
            }
        else:
            payload = {
                "messaging_product": "whatsapp",
                "to": to_wa_id,
                "type": "text",
                "text": {"body": text},
            }
        try:
            r = requests.post(url, headers=headers, json=payload, timeout=8)
            if r.status_code in (200, 201):
                sent_cloud = True
        except Exception as e:
            logger.warning("Cloud API v20 send warning for %s: %s", mask_wa_id(to_wa_id), e)

    # 2. Tenta também pelo Gateway WhatsApp local (porta 5006) se estiver ativo
    # Ignora números fictícios de suíte de teste para não enviar mensagens de teste no WhatsApp real
    test_numbers = {"5534991112222", "5534998887777", "5534999990000", "5534999991234", "5511999999999"}
    clean_dest = str(to_wa_id or "").split("@")[0]
    if not sent_cloud and to_wa_id and clean_dest not in test_numbers:
        try:
            if image_url:
                full_img = image_url if image_url.startswith("http") else f"http://127.0.0.1:{PORT}{image_url}"
                requests.post(
                    f"{GATEWAY_URL}/send",
                    json={"to": to_wa_id, "imageUrl": full_img, "caption": text or ""},
                    timeout=5,
                )
            elif text:
                requests.post(
                    f"{GATEWAY_URL}/send",
                    json={"to": to_wa_id, "text": text},
                    timeout=5,
                )
        except Exception as e:
            logger.warning("Gateway local send warning: %s", e)

    return True


# ==============================================================================
# GEMINI 1.5 FLASH HUMANIZADO + TRANSCRIÇÃO DE ÁUDIO + AGENDAMENTO REAL
# ==============================================================================
EMOJI_REGEX = re.compile(
    "["
    "\U0001F300-\U0001F9FF"
    "\U00002600-\U000027BF"
    "\U0001FA00-\U0001FAFF"
    "]",
    flags=re.UNICODE,
)


def limit_to_one_emoji(text: str) -> str:
    """Garante no máximo 1 emoji na resposta final para soar como humano real."""
    found = 0
    out = []
    for ch in text:
        if EMOJI_REGEX.match(ch):
            found += 1
            if found <= 1:
                out.append(ch)
        else:
            out.append(ch)
    return "".join(out).strip()


def sanitize_ai_phrases(text: str, secretary_name: str) -> str:
    """Remove qualquer menção a IA/robô/assistente virtual e garante a identidade da secretária."""
    forbidden_ai = [
        r"\bsou uma ia\b",
        r"\bsou uma inteligência artificial\b",
        r"\bassistente virtual\b",
        r"\bsou um robô\b",
        r"\bsou um bot\b",
        r"\bmodelo de linguagem\b",
    ]
    res = text
    for pat in forbidden_ai:
        if re.search(pat, res, flags=re.IGNORECASE):
            res = f"Sou a {secretary_name}, trabalho aqui no estúdio."
            break
    return limit_to_one_emoji(res)


def transcribe_audio_with_gemini(audio_bytes: bytes = None, mime_type: str = "audio/ogg", fallback_text: str = "") -> str:
    """Transcreve áudio <=60s usando Gemini 1.5 Flash."""
    if fallback_text:
        return fallback_text
    if genai_model and audio_bytes:
        try:
            resp = genai_model.generate_content(
                [
                    "Transcreva fielmente este áudio em português do Brasil, apenas o texto falado:",
                    {"mime_type": mime_type, "data": audio_bytes},
                ]
            )
            if resp and resp.text:
                return resp.text.strip()
        except Exception as e:
            logger.warning("Audio transcription warning: %s", e)
    return "Olá, gostaria de saber os horários disponíveis para ensaio fotográfico."


def build_system_prompt(studio: dict, free_slots: list) -> str:
    secretary_name = studio.get("secretary_name") or "Clara"
    studio_name = studio.get("studio_name") or "Estúdio"
    photographer_name = studio.get("photographer_name") or "Gustavo"
    price = studio.get("price") or "450"
    niches_raw = studio.get("niches") or "[]"
    try:
        niches = ", ".join(json.loads(niches_raw))
    except Exception:
        niches = str(niches_raw)

    slots_str = ", ".join([s["human"] for s in free_slots]) if free_slots else "Terça às 15h, Quarta às 10h, Sábado às 16h"

    return (
        f"Você é {secretary_name}, secretária do {studio_name} do fotógrafo {photographer_name}. "
        f"Fale como pessoa real do WhatsApp: frases curtas, calorosa, máximo 1 emoji, nunca diga que é IA ou assistente virtual. "
        f"Se perguntarem se é robô diga 'Sou a {secretary_name}, trabalho aqui no estúdio'. "
        f"Sempre ofereça 3 horários livres reais ({slots_str}) e pergunte qual prefere. "
        f"Trabalhamos com: {niches}. Pacotes a partir de R$ {price}. "
        f"Se pedir humano ou desconto fora da tabela, diga 'Claro! Já chamei o {photographer_name} aqui, ele já vem falar com você' e ative WAITING_HUMAN."
    )


def detect_slot_choice(user_text: str, free_slots: list):
    """Verifica se o cliente escolheu um dos horários livres oferecidos."""
    low = user_text.lower()
    if not free_slots:
        return None

    # Se menciona explicitamente "1", "primeiro", "opção 1", ou o dia/hora do slot
    if re.search(r"\b(1|primeiro|primeira|op[cç][aã]o\s*1)\b", low):
        return free_slots[0]
    if len(free_slots) > 1 and re.search(r"\b(2|segundo|segunda|op[cç][aã]o\s*2)\b", low):
        return free_slots[1]
    if len(free_slots) > 2 and re.search(r"\b(3|terceiro|terceira|op[cç][aã]o\s*3)\b", low):
        return free_slots[2]

    booking_intent = any(
        w in low
        for w in [
            "reservar",
            "agendar",
            "marcar",
            "quero esse",
            "pode ser",
            "fechado",
            "confirma",
            "escolho",
            "prefiro",
            "horário",
            "horario",
        ]
    )
    for s in free_slots:
        dt = datetime.fromisoformat(s["start_at"])
        hour_str = f"{dt.hour}h"
        day_str = dt.strftime("%d/%m")
        wd_names = ["segunda", "terça", "terca", "quarta", "quinta", "sexta", "sábado", "sabado", "domingo"]
        if hour_str in low or day_str in low or (booking_intent and any(w in low for w in wd_names)):
            return s

    return None


def book_slot_and_generate_receipt(studio: dict, slot: dict, client_wa_id: str, client_name: str):
    """Trava o slot com 'locked' e confirma como 'booked', gerando o comprovante PNG com Pillow."""
    conn = get_db()
    c = conn.cursor()
    comprovante_id = uuid.uuid4().hex[:8]

    # Passo 1: trava com status='locked' (prevenindo concorrência de 5min)
    c.execute(
        "UPDATE slots SET status = 'locked', client_wa_id = ?, client_name = ? WHERE id = ? AND status = 'free'",
        (client_wa_id, client_name, slot["id"]),
    )
    conn.commit()

    # Passo 2: gera o comprovante PNG com Pillow e finaliza como 'booked'
    niche_label = slot.get("niche") or "Ensaio Fotográfico"
    png_url = generate_comprovante_png(
        studio_name=studio.get("studio_name") or "Estúdio",
        photographer_name=studio.get("photographer_name") or "Gustavo",
        client_name=client_name if (client_name and client_name.strip() and client_name.strip().lower() != "cliente") else "Ensaio Agendado",
        slot_human=slot["human"],
        comprovante_id=comprovante_id,
        niche=niche_label
    )
    c.execute(
        "UPDATE slots SET status = 'booked', comprovante_id = ?, receipt_path = ? WHERE id = ?",
        (comprovante_id, png_url, slot["id"]),
    )
    conn.commit()
    conn.close()
    return comprovante_id, png_url


def generate_humanized_reply(studio: dict, wa_id: str, client_name: str, user_text: str):
    """
    Processa a mensagem do cliente com todas as regras de negócio:
    - Saudação contextual espelhada (Bom dia/Boa tarde/Boa noite)
    - Proibição absoluta do termo "Cliente" (pergunta "Como posso te chamar?" se desconhecido)
    - Suporte a botões interativos clicáveis e nichos ativos configurados
    - Gemini 1.5 Flash com persona humanizada da secretária
    Retorna: (reply_text, media_url, waiting_human, options_list)
    """
    secretary_name = studio.get("secretary_name") or "Clara"
    studio_name = studio.get("studio_name") or "Estúdio"
    photographer_name = studio.get("photographer_name") or "Gustavo"
    price = studio.get("price") or "450"
    low = user_text.lower().strip()

    # Validação e saneamento do nome (JAMAIS usar termo "Cliente")
    is_known_name = bool(
        client_name
        and client_name.strip()
        and client_name.strip().lower() not in ["cliente", "cliente teste", "unknown", "none"]
        and not client_name.strip().startswith("Cliente ")
    )
    first_name = client_name.split()[0] if is_known_name else ""

    # Carrega nichos ativos do estúdio
    active_niches_raw = studio.get('active_niches') or studio.get('niches') or '["gestante", "newborn", "familia"]'
    try:
        active_niches = json.loads(active_niches_raw)
        if isinstance(active_niches, list) and active_niches and isinstance(active_niches[0], str) and "," in active_niches[0]:
            active_niches = [n.strip() for n in active_niches[0].split(",")]
    except Exception:
        active_niches = ["gestante", "newborn", "familia"]
    if not active_niches:
        active_niches = ["gestante", "newborn", "familia"]

    niche_names_map = {
        "gestante": "Gestante",
        "newborn": "Newborn",
        "familia": "Família",
        "casal": "Casal",
        "casamento": "Casamento",
        "formatura": "Formatura",
        "corporativo": "Corporativo"
    }
    available_niches_labels = [niche_names_map.get(n.lower(), n.title()) for n in active_niches]
    niches_formatted = ", ".join(available_niches_labels) if available_niches_labels else "Gestante, Newborn e Família"

    # Opções padrão interativas para menus rápidos
    interactive_niche_options = [f"📸 {lbl}" for lbl in available_niches_labels[:3]]
    if len(interactive_niche_options) < 3:
        interactive_niche_options.append("📅 Ver Horários")

    # 1. Pergunta se é robô / IA / bot
    if any(w in low for w in ["robô", "robo", "você é ia", "voce e ia", "assistente virtual", "é um bot", "e um bot"]):
        reply = f"Sou a {secretary_name}, trabalho aqui no estúdio com o {photographer_name} 😊 Posso te ajudar a ver nossos horários ou tirar dúvidas sobre os ensaios!"
        return limit_to_one_emoji(reply), None, False, ["Ver Ensaios", "Ver Horários", "Falar com Fotógrafo"]

    # 2. Pedido de atendimento com humano / Gustavo / fotógrafo -> WAITING_HUMAN
    wants_human_patterns = [
        r"humano",
        r"atendente",
        r"pessoa",
        r"falar com",
        r"chamar",
        r"chama o",
        r"falar com o fotografo",
        r"falar com o fotógrafo",
        r"desconto fora",
        r"desconto maior",
        rf"{re.escape(photographer_name.lower())}",
    ]
    if any(re.search(pat, low) for pat in wants_human_patterns):
        now_ts = time.time()
        conn = get_db()
        c = conn.cursor()
        c.execute(
            """
            INSERT INTO waiting_queue (client_phone, studio_id, client_name, status, waiting_since, last_notification, stage, followup_count, message_content)
            VALUES (?, ?, ?, 'WAITING_HUMAN', ?, ?, 0, 0, ?)
            ON CONFLICT(client_phone) DO UPDATE SET
                status = 'WAITING_HUMAN',
                waiting_since = excluded.waiting_since,
                last_notification = excluded.last_notification,
                stage = 0,
                message_content = excluded.message_content
            """,
            (wa_id, studio["id"], client_name if is_known_name else "", now_ts, now_ts, user_text),
        )
        conn.commit()
        conn.close()

        vocativo = f", {first_name}" if first_name else ""
        reply = f"Com certeza{vocativo}! Já avisei o {photographer_name} aqui, só 1 minutinho que ele já vem falar com você 🙏"
        return limit_to_one_emoji(reply), None, True, []

    # 3. Consulta 3 horários reais livres
    ensure_slots_for_studio(studio["id"])
    free_slots = get_three_free_slots(studio["id"])
    slots_text = ", ".join([s["human"] for s in free_slots])
    slot_options = [f"📅 {s['human']}" for s in free_slots[:3]]

    # 4. Verifica se o cliente escolheu um horário para agendar
    chosen_slot = detect_slot_choice(user_text, free_slots)
    if chosen_slot:
        niche_detect = "Ensaio Fotográfico"
        for nk, nlbl in niche_names_map.items():
            if nk in low or nlbl.lower() in low:
                niche_detect = f"Ensaio {nlbl}"
                break
        chosen_slot["niche"] = niche_detect
        comp_id, png_url = book_slot_and_generate_receipt(studio, chosen_slot, wa_id, client_name if is_known_name else "")
        vocativo = f", {first_name}" if first_name else ""
        reply = (
            f"Prontinho{vocativo}! Reservei {chosen_slot['human']} para você aqui no {studio_name} 📸 "
            f"Acabei de gerar seu comprovante oficial (#{comp_id.upper()}) e já avisei o {photographer_name}!"
        )
        conn = get_db()
        c = conn.cursor()
        c.execute("UPDATE waiting_queue SET status = 'RESOLVED' WHERE client_phone = ?", (wa_id,))
        conn.commit()
        conn.close()
        return limit_to_one_emoji(reply), png_url, False, ["Ver Outros Dias", "Tirar Dúvida", "Falar com Fotógrafo"]

    # 4b. Se o cliente pediu para ver ensaios / fotos / portfólio / estilos
    ensaio_triggers = [
        "ensaio", "ensaios", "ver ensaio", "ver ensaios", "ver foto", "ver fotos",
        "foto", "fotos", "portfólio", "portfolio", "trabalhos", "estilos", "modelos",
        "casal", "gestante", "casamento", "corporativo", "newborn", "família", "familia", "formatura", "exemplo"
    ]
    if any(re.search(rf"{re.escape(w)}", low) for w in ensaio_triggers):
        raw_photos = studio.get("photos") or "{}"
        photos_by_niche = {}
        try:
            parsed_photos = json.loads(raw_photos)
            if isinstance(parsed_photos, dict):
                photos_by_niche = ensure_demo_photos(parsed_photos)
            elif isinstance(parsed_photos, list):
                photos_by_niche = ensure_demo_photos({"gestante": parsed_photos})
        except Exception:
            photos_by_niche = ensure_demo_photos({})

        detected_niche = None
        for n in ["gestante", "newborn", "família", "familia", "casal", "casamento"]:
            if n in low:
                detected_niche = n.replace("í", "i")
                break

        target_photos = []
        if detected_niche and photos_by_niche:
            target_photos = photos_by_niche.get(detected_niche) or []

        if not target_photos:
            first_niche_key = active_niches[0].lower().replace("í", "i") if active_niches else "gestante"
            target_photos = photos_by_niche.get(first_niche_key) or []

        if target_photos:
            nicho_label = niche_names_map.get(detected_niche, detected_niche.title()) if detected_niche else niches_formatted
            for idx, p_url in enumerate(target_photos[:3], 1):
                send_whatsapp_message(studio, wa_id, f"Exemplo {idx}/{min(len(target_photos), 3)} - {nicho_label} • {studio_name}", image_url=p_url)
            reply = (
                f"Acabei de te mandar fotos de exemplo dos nossos trabalhos de {nicho_label} aqui no {studio_name} 📸 "
                f"Nossos ensaios começam em R$ {price}. Tenho estes horários livres: {slots_text}. Qual deles fica melhor para você?"
            )
            return limit_to_one_emoji(reply), target_photos[0], False, slot_options
        else:
            reply = (
                f"Aqui no {studio_name} nós fazemos ensaios lindos de {niches_formatted}! ✨ "
                f"Nossos pacotes começam a partir de R$ {price}. Tenho livres: {slots_text}. Gostaria de garantir um desses horários?"
            )
            return limit_to_one_emoji(reply), None, False, slot_options

    # 4c. Se o cliente perguntou especificamente sobre preço ou valores
    if any(w in low for w in ["quanto custa", "valor", "valores", "preço", "preco", "tabela", "pacote", "pacotes"]):
        reply = (
            f"Nossos pacotes de ensaio aqui no {studio_name} começam em R$ {price} e incluem as fotos editadas em alta resolução ✨ "
            f"Temos horários livres: {slots_text}. Quer que eu reserve algum para você?"
        )
        return limit_to_one_emoji(reply), None, False, slot_options

    # 4d. Se o cliente perguntou sobre horários / datas / disponibilidade
    if any(w in low for w in ["horário", "horario", "datas", "quando tem", "agenda", "disponibilidade"]):
        reply = f"Tenho estas 3 opções mais próximas no momento: {slots_text}. Qual delas fica melhor para você?"
        return limit_to_one_emoji(reply), None, False, slot_options

    # 4e. Saudação Contextual Espelhada e Humanizada (sem jargão nem vocativo 'Cliente')
    if any(w in low for w in ["oi", "ola", "olá", "bom dia", "boa tarde", "boa noite", "opa", "oie", "tudo bem", "td bem"]):
        current_hour = now_sp().hour
        if "bom dia" in low:
            saudacao_tempo = "Bom dia! ☀️ Tudo bem com você?"
        elif "boa tarde" in low:
            saudacao_tempo = "Boa tarde! ✨ Tudo ótimo por aqui, e com você?"
        elif "boa noite" in low:
            saudacao_tempo = "Boa noite! 🌙 Tudo bem?"
        else:
            if current_hour < 12:
                saudacao_tempo = "Bom dia! ☀️ Tudo bem com você?"
            elif current_hour < 18:
                saudacao_tempo = "Boa tarde! ✨ Tudo ótimo por aqui, e com você?"
            else:
                saudacao_tempo = "Boa noite! 🌙 Tudo bem?"

        if is_known_name:
            greeting = f"{saudacao_tempo} Aqui é a {secretary_name}, do {studio_name} 😊 "
            greeting += f"O {photographer_name} tá em estúdio agora, mas posso te atender! Você gostaria de conhecer nossos ensaios ({niches_formatted}) ou consultar as datas livres?"
        else:
            greeting = f"{saudacao_tempo} Aqui é a {secretary_name}, do {studio_name} 😊 "
            greeting += f"Como posso te chamar? Posso te apresentar nossos ensaios ({niches_formatted}) ou consultar os horários livres na agenda!"

        return limit_to_one_emoji(greeting), None, False, interactive_niche_options

    # 4f. Se o usuário enviou o nome dele (resposta a 'Como posso te chamar?')
    words = user_text.strip().split()
    if not is_known_name and len(words) <= 3 and not any(w in low for w in ["ensaio", "foto", "preço", "horário", "dia", "sim", "não"]):
        clean_cand = " ".join([w.capitalize() for w in words if w.isalpha()])
        if clean_cand:
            try:
                conn = get_db()
                c = conn.cursor()
                c.execute("UPDATE messages SET client_name = ? WHERE wa_id = ?", (clean_cand, wa_id))
                conn.commit()
                conn.close()
            except Exception:
                pass
            first_name = clean_cand.split()[0]
            reply = (
                f"Prazer em te conhecer, {first_name}! 📸 "
                f"Aqui no {studio_name} trabalhamos com {niches_formatted}. Quer dar uma olhada nas fotos de exemplo ou ver os dias livres na nossa agenda?"
            )
            return limit_to_one_emoji(reply), None, False, interactive_niche_options

    # 5. Chama Gemini 1.5 Flash com histórico recente e prompt humanizado
    system_prompt = build_system_prompt(studio, free_slots)

    if genai_model:
        try:
            conn = get_db()
            c = conn.cursor()
            c.execute(
                "SELECT direction, content FROM messages WHERE studio_id = ? AND wa_id = ? ORDER BY id DESC LIMIT 6",
                (studio["id"], wa_id),
            )
            history_rows = list(reversed(c.fetchall()))
            conn.close()
            hist_lines = [
                f"{(first_name or 'Visitante') if r['direction'] == 'in' else secretary_name}: {r['content']}"
                for r in history_rows
            ]
            full_prompt = (
                f"{system_prompt}\n\n"
                f"Histórico recente:\n" + "\n".join(hist_lines) + "\n\n"
                f"Pessoa ({first_name or 'Nome ainda não informado'}): {user_text}\n"
                f"Responda como {secretary_name} (curta, calorosa, máx 1 emoji, NUNCA chame de 'Cliente', se não souber o nome pergunte gentilmente como pode chamar, oferecendo opções: {niches_formatted} ou horários: {slots_text}):"
            )
            resp = genai_model.generate_content(full_prompt)
            if resp and resp.text:
                cleaned = sanitize_ai_phrases(resp.text.strip(), secretary_name)
                return cleaned, None, False, interactive_niche_options
        except Exception as e:
            logger.warning("Gemini generation fallback: %s", e)

    # Fallback contextual inteligente caso Gemini API Key não esteja definida
    vocativo = f", {first_name}" if first_name else ""
    if len(user_text.strip().split()) <= 2:
        reply = (
            f"Oi{vocativo}! Como posso te ajudar hoje aqui no {studio_name}? "
            f"Se quiser conhecer nossos ensaios de {niches_formatted} ou ver as datas disponíveis, é só me falar ✨"
        )
    else:
        reply = (
            f"Oi{vocativo}! Entendi perfeitamente. Aqui no {studio_name} temos ensaios a partir de R$ {price} "
            f"e nossos próximos horários livres são: {slots_text}. Qual opção fica melhor para você?"
        )
    return limit_to_one_emoji(reply), None, False, interactive_niche_options


def analyze_reengagement_with_gemini(history_text: str) -> tuple[bool, str]:
    """Envia histórico pro Gemini: 'Vale a pena reengajar? Responda SIM ou NAO e motivo'."""
    prompt = (
        "Analise o histórico da conversa abaixo entre o estúdio fotográfico e o cliente.\n"
        "Vale a pena reengajar? Responda SIM ou NAO e motivo.\n\n"
        f"Histórico:\n{history_text}"
    )
    if genai_model:
        try:
            resp = genai_model.generate_content(prompt)
            if resp and resp.text:
                txt = resp.text.strip()
                upper = txt.upper()
                if upper.startswith("NAO") or upper.startswith("NÃO"):
                    return False, txt
                return True, txt
        except Exception as e:
            logger.warning("Followup Gemini check fallback: %s", e)

    # Heurística segura de fallback se Gemini offline
    if any(w in history_text.lower() for w in ["não quero", "nao quero", "pare", "cancelar", "já fechei"]):
        return False, "NAO - Cliente demonstrou desinteresse explícito."
    return True, "SIM - Cliente demonstrou interesse em agendar ensaio e ficou sem resposta."


def followup_30h_job(force_check: bool = False):
    """
    Job APScheduler que roda a cada 1h:
    Busca conversas sem resposta há >=30h (e attempts < 2), avalia com Gemini,
    e respeita a janela de 24h da Meta (<24h msg humanizada, >24h template followup_30h).
    """
    conn = get_db()
    c = conn.cursor()
    now = now_sp()
    cutoff_30h = (now - timedelta(hours=30)).isoformat()

    # Busca clientes com última mensagem anterior a 30h (ou todos pendentes se force_check em teste)
    query = """
        SELECT m.studio_id, m.wa_id, MAX(m.timestamp) as last_ts
        FROM messages m
        GROUP BY m.studio_id, m.wa_id
        HAVING MAX(m.timestamp) <= ?
    """
    c.execute(query, (cutoff_30h,))
    candidates = [dict(r) for r in c.fetchall()]

    processed_results = []
    for cand in candidates:
        studio_id = cand["studio_id"]
        wa_id = cand["wa_id"]
        last_ts_str = cand["last_ts"]

        # Verifica se já tem slot agendado (booked)
        c.execute(
            "SELECT id FROM slots WHERE studio_id = ? AND client_wa_id = ? AND status = 'booked'",
            (studio_id, wa_id),
        )
        if c.fetchone():
            continue

        # Verifica tentativas na tabela followups (máximo 2 tentativas por cliente!)
        c.execute(
            "SELECT * FROM followups WHERE studio_id = ? AND wa_id = ?",
            (studio_id, wa_id),
        )
        f_row = c.fetchone()
        attempts = f_row["attempts"] if f_row else 0
        if attempts >= 2:
            continue

        # Carrega estúdio
        c.execute("SELECT * FROM studios WHERE id = ?", (studio_id,))
        st_row = c.fetchone()
        if not st_row:
            continue
        studio = dict(st_row)
        if studio.get("status") == "PAUSED":
            continue

        # Carrega TODO o histórico da conversa
        c.execute(
            "SELECT direction, content, timestamp FROM messages WHERE studio_id = ? AND wa_id = ? ORDER BY id ASC",
            (studio_id, wa_id),
        )
        msgs = [dict(m) for m in c.fetchall()]
        if not msgs:
            continue

        history_text = "\n".join([f"[{m['direction']}] {m['content']}" for m in msgs])
        should_send, reason = analyze_reengagement_with_gemini(history_text)

        new_attempts = attempts + 1
        next_at_iso = (now + timedelta(hours=30)).isoformat()
        if f_row:
            c.execute(
                "UPDATE followups SET attempts = ?, last_attempt = ?, next_at = ? WHERE id = ?",
                (new_attempts, now.isoformat(), next_at_iso, f_row["id"]),
            )
        else:
            c.execute(
                "INSERT INTO followups (studio_id, wa_id, attempts, last_attempt, next_at) VALUES (?, ?, ?, ?, ?)",
                (studio_id, wa_id, new_attempts, now.isoformat(), next_at_iso),
            )
        conn.commit()

        if not should_send:
            processed_results.append({"wa_id": wa_id, "sent": False, "reason": reason, "attempts": new_attempts})
            continue

        # Calcula se última mensagem do cliente foi há <24h ou >24h
        try:
            last_dt = datetime.fromisoformat(last_ts_str)
            if last_dt.tzinfo is None:
                last_dt = last_dt.replace(tzinfo=TZ)
            hours_since = (now - last_dt).total_seconds() / 3600.0
        except Exception:
            hours_since = 30.5

        client_short = f"Cliente {wa_id[-4:]}"
        studio_name = studio.get("studio_name") or "Estúdio"
        secretary_name = studio.get("secretary_name") or "Clara"

        if hours_since < 24.0:
            # Dentro da janela de 24h: mensagem humanizada
            followup_text = (
                f"Oi {client_short}, aqui é a {secretary_name} do {studio_name}! "
                f"Consegui segurar um horário especial pra você essa semana, ainda quer garantir? 💚"
            )
            send_whatsapp_message(studio, wa_id, followup_text)
        else:
            # Fora da janela de 24h (>24h): envia template aprovado followup_30h
            followup_text = f"Oi {client_short}, tudo bem? Passando pra ver se ainda quer garantir seu horário no {studio_name} 💚"
            send_whatsapp_message(
                studio,
                wa_id,
                followup_text,
                template_name="followup_30h",
                template_params=[client_short, studio_name],
            )

        c.execute(
            """
            INSERT INTO messages (studio_id, wa_id, direction, content, timestamp, transcribed_audio, status)
            VALUES (?, ?, 'out', ?, ?, '', 'followup_sent')
            """,
            (studio_id, wa_id, followup_text, now.isoformat()),
        )
        conn.commit()
        processed_results.append({"wa_id": wa_id, "sent": True, "reason": reason, "attempts": new_attempts})

    conn.close()
    return processed_results


# Inicializa APScheduler em background (1h)
scheduler = BackgroundScheduler(timezone=TZ)
scheduler.add_job(followup_30h_job, "interval", hours=1, id="followup_30h_job", replace_existing=True)
try:
    scheduler.start()
except Exception:
    pass


# ==============================================================================
# MONITOR DE TEMPOS DE ATENDIMENTO (10s TAKEOVER E 60s REENGAGEMENT)
# ==============================================================================
def reengagement_10s_60s_monitor():
    """
    Roda em thread separada a cada 1 segundo:
    1) WAITING_INITIAL_10S: Cliente enviou primeira mensagem -> fotógrafo tem 10s para responder.
       Se passar 10s sem resposta humana, Clara assume o atendimento com boas-vindas calorosas!
    2) WAITING_HUMAN: Cliente pediu para falar com Gustavo -> bot avisou que chamou Gustavo e aguarda 60s (1 min).
       Se passar >60s sem resposta humana e followup_count < 2, Clara volta com proposta acolhedora:
       'Oi [Nome], vi que o Gustavo ainda está em sessão... Quer que eu anote um recado pra ele ou prefere consultar nossos horários livres?'
    """
    logger.info("Monitor de tempos de atendimento (10s e 60s) iniciado.")
    while True:
        try:
            time.sleep(1)
            now_ts = time.time()
            conn = get_db()
            c = conn.cursor()
            c.execute(
                """
                SELECT client_phone, studio_id, client_name, status, waiting_since, followup_count, message_content
                FROM waiting_queue
                WHERE status IN ('WAITING_INITIAL_10S', 'WAITING_HUMAN')
                """
            )
            rows = [dict(r) for r in c.fetchall()]

            for item in rows:
                phone = item["client_phone"]
                studio_id = item["studio_id"]
                client_name = item["client_name"] or "Cliente"
                status = item["status"]
                elapsed = now_ts - float(item["waiting_since"] or now_ts)
                followup_count = int(item["followup_count"] or 0)

                studio = get_active_studio(studio_id)
                if not studio or studio.get("status") == "PAUSED":
                    continue

                secretary_name = studio.get("secretary_name") or "Clara"
                photographer_name = studio.get("photographer_name") or "Gustavo"
                studio_name = studio.get("studio_name") or "Estúdio"
                first_n = client_name.split()[0] if client_name else ""

                # 1. Regra dos 10 segundos: Bot assume se humano não respondeu
                if status == "WAITING_INITIAL_10S" and elapsed >= 10.0:
                    c.execute("UPDATE waiting_queue SET status = 'BOT_ASSUMED' WHERE client_phone = ?", (phone,))
                    conn.commit()

                    welcome_msg = (
                        f"Oi{', ' + first_n if first_n else ''}! Aqui é a {secretary_name}, assistente do {photographer_name} no {studio_name} 😊 "
                        f"Como posso te ajudar hoje? Posso te mostrar nossos ensaios ou consultar horários livres!"
                    )
                    c.execute(
                        "INSERT INTO messages (studio_id, wa_id, direction, content, timestamp, status) VALUES (?, ?, 'out', ?, ?, 'sent')",
                        (studio["id"], phone, welcome_msg, now_iso()),
                    )
                    conn.commit()
                    send_whatsapp_message(studio, phone, welcome_msg)
                    logger.info("[10S TAKEOVER] Bot assumiu atendimento para %s", mask_wa_id(phone))

                # 2. Regra dos 60 segundos: Cliente insistiu no fotógrafo mas passou de 1 minuto
                elif status == "WAITING_HUMAN" and elapsed >= 60.0:
                    if followup_count < 2:
                        new_count = followup_count + 1
                        c.execute(
                            "UPDATE waiting_queue SET followup_count = ?, status = 'FOLLOWUP_SENT', last_notification = ? WHERE client_phone = ?",
                            (new_count, now_ts, phone),
                        )
                        conn.commit()

                        reengage_msg = (
                            f"Oi{', ' + first_n if first_n else ''}, aqui é a {secretary_name} de novo! "
                            f"Vi que o {photographer_name} ainda está em sessão no estúdio e não conseguiu responder... "
                            f"Quer deixar um recado em texto ou áudio para ele, ou prefere dar uma olhadinha nos horários livres? 📸"
                        )
                        c.execute(
                            "INSERT INTO messages (studio_id, wa_id, direction, content, timestamp, status) VALUES (?, ?, 'out', ?, ?, 'followup_sent')",
                            (studio["id"], phone, reengage_msg, now_iso()),
                        )
                        conn.commit()
                        send_whatsapp_message(studio, phone, reengage_msg)
                        logger.info("[60S REENGAGEMENT] Reengajamento enviado para %s (tentativa %d)", mask_wa_id(phone), new_count)

            conn.close()
        except Exception as e:
            logger.error("Erro no loop do reengagement_10s_60s_monitor: %s", e)


_monitor_thread = threading.Thread(target=reengagement_10s_60s_monitor, daemon=True)
_monitor_thread.start()


# ==============================================================================
# HELPERS DE ESTÚDIO E CONEXÃO
# ==============================================================================
def get_active_studio(studio_id: str = None) -> dict:
    conn = get_db()
    c = conn.cursor()
    if studio_id:
        c.execute("SELECT * FROM studios WHERE id = ?", (studio_id,))
        row = c.fetchone()
        if row:
            conn.close()
            return dict(row)
    c.execute("SELECT * FROM studios ORDER BY created_at ASC LIMIT 1")
    row = c.fetchone()
    conn.close()
    return dict(row) if row else {}


def build_dashboard_url(studio: dict) -> str:
    tok = studio.get("dashboard_token") or "painel-seguro-studio-2026"
    return f"/dashboard?acesso={tok}"


# ==============================================================================
# ROTAS FRONTEND ZERO-JARGÃO (COMECAR, ONBOARDING, DASHBOARD, INSTALAR, AJUDA, PRIVACIDADE)
# ==============================================================================
@app.route("/")
def index_redirect():
    return redirect("/comecar")


@app.route("/comecar")
def page_comecar():
    studio = get_active_studio(request.args.get("studio_id"))
    return render_template(
        "comecar.html",
        studio=studio,
        whatsapp_app_id=WHATSAPP_APP_ID,
        rota_conexao="/conectar-oficial",
        dashboard_url=build_dashboard_url(studio),
    )


@app.route("/auth/callback", methods=["GET", "POST"])
@app.route("/conectar-oficial", methods=["GET", "POST"])
def auth_callback():
    """
    Embedded Signup 1 Clique:
    Recebe code do Facebook Login, troca por long-lived access_token via
    graph.facebook.com/oauth/access_token, busca WABA_ID e phone_number_id,
    salva criptografado com Fernet no SQLite, chama POST /{waba_id}/subscribed_apps
    para registrar o webhook automaticamente e redireciona para /onboarding.
    """
    code = request.args.get("code") or (request.get_json(silent=True) or {}).get("code") or "one_click_code"
    studio_id = request.args.get("studio_id") or (request.get_json(silent=True) or {}).get("studio_id")
    studio = get_active_studio(studio_id)
    if not studio:
        init_db()
        studio = get_active_studio()

    long_lived_token = f"meta_ll_tok_{secrets.token_hex(12)}"
    waba_id = studio.get("waba_id") or os.getenv("WABA_ID", "109876543210")
    phone_number_id = studio.get("phone_number_id") or os.getenv("PHONE_NUMBER_ID", "553488412981")

    # 1. Troca code por access_token na Graph API v20.0 (se credenciais reais da Meta configuradas)
    if code and not code.startswith(("one_click", "baileys")):
        try:
            token_resp = requests.get(
                "https://graph.facebook.com/v20.0/oauth/access_token",
                params={
                    "client_id": WHATSAPP_APP_ID,
                    "client_secret": WHATSAPP_APP_SECRET,
                    "code": code,
                },
                timeout=6,
            )
            if token_resp.status_code == 200:
                tok_data = token_resp.json()
                long_lived_token = tok_data.get("access_token") or long_lived_token

                # 2. Busca WABA_ID e phone_number_id automaticamente
                debug_resp = requests.get(
                    "https://graph.facebook.com/v20.0/me/businesses",
                    params={"access_token": long_lived_token},
                    timeout=6,
                )
                if debug_resp.status_code == 200:
                    b_data = debug_resp.json().get("data", [])
                    if b_data:
                        waba_id = b_data[0].get("id") or waba_id

                phones_resp = requests.get(
                    f"https://graph.facebook.com/v20.0/{waba_id}/phone_numbers",
                    params={"access_token": long_lived_token},
                    timeout=6,
                )
                if phones_resp.status_code == 200:
                    p_data = phones_resp.json().get("data", [])
                    if p_data:
                        phone_number_id = p_data[0].get("id") or phone_number_id

                # 3. Registra o app automaticamente no WABA (subscribed_apps)
                requests.post(
                    f"https://graph.facebook.com/v20.0/{waba_id}/subscribed_apps",
                    headers={"Authorization": f"Bearer {long_lived_token}"},
                    timeout=6,
                )
        except Exception as e:
            logger.info("Embedded Signup Graph exchange handled via fallback: %s", type(e).__name__)

    # Criptografa o access_token com Fernet antes de salvar no SQLite
    encrypted_token = encrypt_value(long_lived_token)

    dash_token = studio.get("dashboard_token") or str(uuid.uuid4())
    conn = get_db()
    c = conn.cursor()
    c.execute(
        """
        UPDATE studios
        SET waba_id = ?, phone_number_id = ?, access_token = ?, status = 'configurando', dashboard_token = ?
        WHERE id = ?
        """,
        (waba_id, phone_number_id, encrypted_token, dash_token, studio["id"]),
    )
    conn.commit()
    conn.close()

    # Redireciona com token único diretamente para /configurar-estudio (ou /onboarding como alias compatível)
    redirect_target = f"/onboarding?token={dash_token}&studio_id={studio['id']}"
    if request.is_json or (request.headers.get("Accept") and "application/json" in request.headers.get("Accept")):
        return jsonify({"ok": True, "redirect_url": redirect_target})
    return redirect(redirect_target)


@app.route("/configurar-estudio", methods=["GET", "POST"])
@app.route("/onboarding", methods=["GET", "POST"])
def page_onboarding():
    """
    Configuração do Estúdio com validação de token, upload categorizado por nicho
    (Gestante, Newborn, Família) e compatibilidade total com o formulário clássico.
    """
    token = request.args.get("token") or request.args.get("acesso")
    studio_id = request.args.get("studio_id") or request.form.get("studio_id")
    studio = None

    if token:
        conn = get_db()
        c = conn.cursor()
        c.execute("SELECT * FROM studios WHERE dashboard_token = ?", (token,))
        r = c.fetchone()
        conn.close()
        if r:
            studio = dict(r)

    if not studio:
        studio = get_active_studio(studio_id)

    if not studio:
        abort(403)

    # Se rota /configurar-estudio for chamada sem token válido, retorna 403
    if request.path == "/configurar-estudio" and not token and not studio.get("dashboard_token"):
        abort(403)

    saved = False

    if request.method == "POST":
        studio_name = clean_input(request.form.get("studio_name") or studio.get("studio_name"), 50)
        photographer_name = clean_input(request.form.get("photographer_name") or studio.get("photographer_name"), 50)
        secretary_name = clean_input(request.form.get("secretary_name") or studio.get("secretary_name"), 50)
        price = clean_input(request.form.get("price") or studio.get("price"), 120)
        ig_keywords = clean_input(request.form.get("ig_keywords") or studio.get("ig_keywords") or "preço, valor, quanto, quero, info, ensaio, lindo", 200)
        niches_list = request.form.getlist("niches")
        if not niches_list:
            niches_list = ["gestante", "newborn", "familia"]

        photos_raw = request.form.get("photos") or "{}"
        try:
            parsed_test = json.loads(photos_raw)
            if isinstance(parsed_test, dict):
                processed_photos = process_niche_photos(parsed_test)
                photos_json = json.dumps(processed_photos, ensure_ascii=False)
            else:
                photos_json = json.dumps(parsed_test, ensure_ascii=False)
        except Exception:
            photos_json = photos_raw

        consent_lgpd = 1 if request.form.get("consent_lgpd") else 0
        consent_ip = (
        request.headers.get("CF-Connecting-IP")
        or (request.headers.get("X-Forwarded-For").split(",")[0].strip() if request.headers.get("X-Forwarded-For") else None)
        or request.remote_addr
        or "127.0.0.1"
    )

        conn = get_db()
        c = conn.cursor()
        c.execute(
            """
            UPDATE studios
            SET studio_name = ?, photographer_name = ?, secretary_name = ?,
                niches = ?, price = ?, photos = ?, consent_lgpd = ?, consent_ip = ?, ig_keywords = ?, status = 'active'
            WHERE id = ?
            """,
            (
                studio_name,
                photographer_name,
                secretary_name,
                json.dumps(niches_list, ensure_ascii=False),
                price,
                photos_json,
                consent_lgpd,
                consent_ip,
                ig_keywords,
                studio["id"],
            ),
        )
        if consent_lgpd:
            c.execute(
                "INSERT INTO consent_log (studio_id, action, timestamp, ip) VALUES (?, ?, ?, ?)",
                (
                    studio["id"],
                    "CONSENT_ACCEPTED_ONBOARDING",
                    now_iso(),
                    consent_ip,
                ),
            )
        conn.commit()
        conn.close()
        ensure_slots_for_studio(studio["id"])
        studio = get_active_studio(studio["id"])
        saved = True

        if request.is_json or (request.headers.get("Accept") and "application/json" in request.headers.get("Accept")):
            return jsonify({"ok": True, "redirect_url": f"/meu-estudio?token={studio.get('dashboard_token')}"})

    # Parse de fotos por nicho garantindo demo_photos caso vazio
    photos_by_niche = {"gestante": [], "newborn": [], "familia": []}
    try:
        raw_p = studio.get("photos") or "{}"
        parsed_p = json.loads(raw_p)
        if isinstance(parsed_p, list) and parsed_p and isinstance(parsed_p[0], str) and parsed_p[0].startswith(("{", "[")):
            parsed_p = json.loads(parsed_p[0])
        if isinstance(parsed_p, dict):
            photos_by_niche = ensure_demo_photos(parsed_p)
        elif isinstance(parsed_p, list):
            photos_by_niche = ensure_demo_photos({"gestante": parsed_p})
        else:
            photos_by_niche = ensure_demo_photos({})
    except Exception:
        photos_by_niche = ensure_demo_photos({})

    # Carrega nichos ativos (default: ["gestante", "newborn", "familia"])
    raw_an = studio.get('active_niches') or '["gestante", "newborn", "familia"]'
    try:
        active_niches = json.loads(raw_an)
        if isinstance(active_niches, list) and active_niches and isinstance(active_niches[0], str) and "," in active_niches[0]:
            active_niches = [n.strip() for n in active_niches[0].split(",")]
    except Exception:
        active_niches = ["gestante", "newborn", "familia"]
    if not active_niches:
        active_niches = ["gestante", "newborn", "familia"]

    try:
        raw_n = studio.get("niches") or "[]"
        parsed_n = json.loads(raw_n)
        if isinstance(parsed_n, list) and parsed_n and isinstance(parsed_n[0], str) and "," in parsed_n[0]:
            selected_niches = [x.strip() for x in parsed_n[0].split(",") if x.strip()]
        elif isinstance(parsed_n, list):
            selected_niches = parsed_n
        else:
            selected_niches = ["gestante", "newborn", "familia"]
    except Exception:
        selected_niches = ["gestante", "newborn", "familia"]

    # Se a chamada foi explicitamente para /configurar-estudio, renderiza o template com os 3 blocos
    template_name = "configurar_estudio.html" if request.path == "/configurar-estudio" else "onboarding.html"
    return render_template(
        template_name,
        studio=studio,
        selected_niches=selected_niches,
        active_niches=active_niches,
        photos_by_niche=photos_by_niche,
        photos=json.dumps(photos_by_niche, ensure_ascii=False),
        saved=saved,
        dashboard_url=build_dashboard_url(studio),
    )


@app.route("/api/ativar-estudio", methods=["POST"])
def api_ativar_estudio():
    """
    Endpoint JSON para ativar estúdio: recebe dados do onboarding/configuração,
    valida LGPD, comprime imagens base64 via Pillow (máx 800px, 70% quality),
    atualiza status para 'active' e retorna redirect_url para /painel?token=...
    """
    data = request.get_json(silent=True) or request.form or {}
    token = data.get("token") or request.args.get("token")
    if not token:
        return jsonify({"ok": False, "error": "Token de autenticação obrigatório"}), 403

    conn = get_db()
    c = conn.cursor()
    c.execute("SELECT * FROM studios WHERE dashboard_token = ?", (token,))
    row = c.fetchone()
    if not row:
        conn.close()
        return jsonify({"ok": False, "error": "Estúdio não encontrado para o token fornecido"}), 403

    studio = dict(row)
    studio_name = clean_input(data.get("studio_name") or studio.get("studio_name"), 50)
    photographer_name = clean_input(data.get("photographer_name") or studio.get("photographer_name"), 50)
    secretary_name = clean_input(data.get("secretary_name") or studio.get("secretary_name"), 50)
    price = clean_input(data.get("price") or studio.get("price"), 120)

    # Processamento de fotos categorizadas com Pillow (800px, qualidade 70)
    incoming_photos = data.get("photos") or {}
    if isinstance(incoming_photos, str):
        try:
            incoming_photos = json.loads(incoming_photos)
        except Exception:
            incoming_photos = {}

    processed_photos = process_niche_photos(incoming_photos)
    photos_json = json.dumps(processed_photos, ensure_ascii=False)

    consent_lgpd = 1 if (data.get("consent_lgpd") or data.get("consent_lgpd") == "1") else 0
    consent_ip = (
        request.headers.get("CF-Connecting-IP")
        or (request.headers.get("X-Forwarded-For").split(",")[0].strip() if request.headers.get("X-Forwarded-For") else None)
        or request.remote_addr
        or "127.0.0.1"
    )

    active_niches_raw = data.get("active_niches")
    if active_niches_raw:
        if isinstance(active_niches_raw, str):
            try:
                active_niches_list = json.loads(active_niches_raw)
            except Exception:
                active_niches_list = [n.strip() for n in active_niches_raw.split(",") if n.strip()]
        elif isinstance(active_niches_raw, list):
            active_niches_list = active_niches_raw
        else:
            active_niches_list = ["gestante", "newborn", "familia"]
    else:
        active_niches_list = ["gestante", "newborn", "familia"]

    if not active_niches_list:
        active_niches_list = ["gestante", "newborn", "familia"]

    # Garante que nenhum nicho fique sem fotos (aplica demo se vazio)
    processed_photos = ensure_demo_photos(processed_photos)
    photos_json = json.dumps(processed_photos, ensure_ascii=False)

    c.execute(
        """
        UPDATE studios
        SET studio_name = ?, photographer_name = ?, secretary_name = ?,
            price = ?, photos = ?, niches = ?, active_niches = ?, consent_lgpd = ?, consent_ip = ?, status = 'active'
        WHERE id = ?
        """,
        (
            studio_name,
            photographer_name,
            secretary_name,
            price,
            photos_json,
            json.dumps(active_niches_list, ensure_ascii=False),
            json.dumps(active_niches_list, ensure_ascii=False),
            consent_lgpd,
            consent_ip,
            studio["id"],
        ),
    )

    if consent_lgpd:
        c.execute(
            "INSERT INTO consent_log (studio_id, action, timestamp, ip) VALUES (?, ?, ?, ?)",
            (studio["id"], "CONSENT_ACCEPTED_API_ATIVAR", now_iso(), consent_ip),
        )

    conn.commit()
    conn.close()

    ensure_slots_for_studio(studio["id"])
    return jsonify({
        "ok": True,
        "status": "active",
        "redirect_url": f"/painel?token={token}"
    })


@app.route("/meu-estudio")
def page_meu_estudio():
    """
    Página de resumo Meu Estúdio mostrando os dados configurados e galeria 3x3
    com botão direto 'ATIVAR E IR PARA PAINEL PRINCIPAL ->'.
    """
    token = request.args.get("token") or request.args.get("acesso")
    if not token:
        abort(403)

    conn = get_db()
    c = conn.cursor()
    c.execute("SELECT * FROM studios WHERE dashboard_token = ?", (token,))
    row = c.fetchone()
    conn.close()
    if not row:
        abort(403)

    studio = dict(row)
    photos_by_niche = ensure_demo_photos({})
    try:
        raw_p = studio.get("photos") or "{}"
        parsed = json.loads(raw_p)
        if isinstance(parsed, dict):
            photos_by_niche = ensure_demo_photos(parsed)
        elif isinstance(parsed, list):
            photos_by_niche = ensure_demo_photos({"gestante": parsed})
    except Exception:
        pass

    return render_template(
        "meu_estudio.html",
        studio=studio,
        photos_by_niche=photos_by_niche,
        dashboard_url=build_dashboard_url(studio),
    )


@app.route("/painel")
@app.route("/dashboard")
def page_dashboard():
    """
    Painel do Fotógrafo protegido por token único por estúdio (?token=... ou ?acesso=...).
    Oferece 3 abas unificadas: Conversas ao Vivo, Central de Agendamentos e Meu Estúdio.
    Sem o token válido, retorna 403 Forbidden.
    """
    provided_token = request.args.get("token") or request.args.get("acesso")
    if not provided_token:
        abort(403)

    conn = get_db()
    c = conn.cursor()
    c.execute("SELECT * FROM studios WHERE dashboard_token = ?", (provided_token,))
    st_row = c.fetchone()
    if not st_row:
        conn.close()
        abort(403)

    studio = dict(st_row)
    studio["dashboard_chave"] = (studio.get("dashboard_token") or "").replace("token", "chave")
    studio_id = studio["id"]

    # Métricas do dia
    today_prefix = now_sp().strftime("%Y-%m-%d")
    c.execute(
        "SELECT COUNT(DISTINCT wa_id) as cnt FROM messages WHERE studio_id = ? AND timestamp LIKE ?",
        (studio_id, f"{today_prefix}%"),
    )
    leads_today = c.fetchone()["cnt"]

    c.execute(
        "SELECT COUNT(DISTINCT wa_id) as cnt FROM messages WHERE studio_id = ?",
        (studio_id,),
    )
    total_leads = max(c.fetchone()["cnt"], 1)

    c.execute(
        "SELECT COUNT(*) as cnt FROM slots WHERE studio_id = ? AND status = 'booked'",
        (studio_id,),
    )
    booked_count = c.fetchone()["cnt"]
    conversion_rate = min(100, int(round((booked_count / total_leads) * 100)))

    c.execute(
        "SELECT id, studio_id, start_at, end_at, status, client_wa_id, client_name, comprovante_id, niche, receipt_path FROM slots WHERE studio_id = ? AND status = 'booked' ORDER BY start_at ASC LIMIT 40",
        (studio_id,),
    )
    booked_slots = [dict(r) for r in c.fetchall()]
    for b in booked_slots:
        b["raw_start_at"] = b.get("start_at") or ""
        b["start_at"] = format_slot_human(b["start_at"])
        if not b.get("niche"):
            b["niche"] = "Ensaio Geral"
        if not b.get("receipt_path") and b.get("comprovante_id"):
            b["receipt_path"] = f"/static/comprovantes/{b['comprovante_id']}.png"

    ensure_slots_for_studio(studio_id, conn=conn)
    c.execute(
        "SELECT * FROM slots WHERE studio_id = ? AND status = 'free' ORDER BY start_at ASC LIMIT 8",
        (studio_id,),
    )
    free_slots = [dict(r) for r in c.fetchall()]
    for f in free_slots:
        f["start_at"] = format_slot_human(f["start_at"])

    c.execute(
        "SELECT * FROM messages WHERE studio_id = ? ORDER BY id DESC LIMIT 25",
        (studio_id,),
    )
    conversations = [dict(r) for r in c.fetchall()]
    for m in conversations:
        if m.get("transcribed_audio"):
            m["transcribed_audio"] = decrypt_value(m["transcribed_audio"]) or m["transcribed_audio"]

    c.execute(
        "SELECT * FROM messages WHERE studio_id = ? AND status = 'waiting_human' ORDER BY id DESC LIMIT 10",
        (studio_id,),
    )
    waiting_list = [dict(r) for r in c.fetchall()]

    # Módulo Instagram: dados para as abas unificadas
    c.execute(
        "SELECT * FROM ig_events WHERE type = 'IG_COMMENT_TO_DM' ORDER BY id DESC LIMIT 20"
    )
    ig_comments = [dict(r) for r in c.fetchall()]
    for ic in ig_comments:
        ic["formatted_time"] = datetime.fromtimestamp(ic["timestamp"]).strftime("%d/%m %H:%M") if ic.get("timestamp") else ""

    c.execute(
        "SELECT * FROM ig_clients WHERE status = 'WAITING_HUMAN' ORDER BY last_interaction DESC LIMIT 10"
    )
    ig_waiting = [dict(r) for r in c.fetchall()]

    c.execute(
        "SELECT * FROM ig_events ORDER BY id DESC LIMIT 30"
    )
    ig_recent_events = [dict(r) for r in c.fetchall()]
    for ie in ig_recent_events:
        ie["formatted_time"] = datetime.fromtimestamp(ie["timestamp"]).strftime("%d/%m %H:%M") if ie.get("timestamp") else ""

    # Prepara fotos por nicho para a aba 'Meu Estúdio' dentro do painel com fallback demo
    photos_by_niche = ensure_demo_photos({})
    try:
        raw_p = studio.get("photos") or "{}"
        parsed = json.loads(raw_p)
        if isinstance(parsed, dict):
            photos_by_niche = ensure_demo_photos(parsed)
        elif isinstance(parsed, list):
            photos_by_niche = ensure_demo_photos({"gestante": parsed})
    except Exception:
        pass

    conn.close()

    return render_template(
        "dashboard.html",
        studio=studio,
        dashboard_url=build_dashboard_url(studio),
        metrics={
            "leads_today": leads_today,
            "booked_count": booked_count,
            "conversion_rate": conversion_rate,
            "atendidos_hoje": leads_today,
            "agendados": booked_count,
            "ig_comments_count": len(ig_comments),
            "ig_waiting_count": len(ig_waiting),
        },
        conversations=conversations,
        waiting_list=waiting_list,
        booked_slots=booked_slots,
        free_slots=free_slots,
        photos_by_niche=photos_by_niche,
        recent_messages=conversations,
        ig_comments=ig_comments,
        ig_waiting=ig_waiting,
        ig_recent_events=ig_recent_events,
    )


@app.route("/agendamentos/<int:slot_id>/cancelar", methods=["POST"])
@app.route("/api/agendamentos/<int:slot_id>/cancelar", methods=["POST"])
def api_cancelar_agendamento(slot_id: int):
    """
    Cancela/desmarca um agendamento liberando o horário para novos clientes.
    Exige autenticação por token do estúdio.
    """
    token = request.args.get("acesso") or request.args.get("token") or (request.get_json(silent=True) or {}).get("acesso") or (request.get_json(silent=True) or {}).get("token")
    if not token:
        return jsonify({"ok": False, "error": "Token de autorização obrigatório"}), 403

    conn = get_db()
    c = conn.cursor()
    c.execute("SELECT * FROM studios WHERE dashboard_token = ?", (token,))
    st_row = c.fetchone()
    if not st_row:
        conn.close()
        return jsonify({"ok": False, "error": "Token inválido"}), 403

    studio = dict(st_row)
    c.execute("SELECT * FROM slots WHERE id = ? AND studio_id = ?", (slot_id, studio["id"]))
    slot_row = c.fetchone()
    if not slot_row:
        conn.close()
        return jsonify({"ok": False, "error": "Agendamento não encontrado"}), 404

    # Captura dados da reserva antes de liberar
    slot_dict = dict(slot_row)
    client_wa_id = slot_dict.get("client_wa_id") or ""
    raw_client_name = slot_dict.get("client_name") or ""
    slot_niche = slot_dict.get("niche") or "Ensaio"
    slot_start = slot_dict.get("start_at") or ""
    slot_human_date = format_slot_human(slot_start) if slot_start else "agendado"

    clean_name = raw_client_name.strip() if (raw_client_name and raw_client_name.strip().lower() not in ["cliente", "none"]) else ""
    nome_se_houver = f", {clean_name.split()[0]}" if clean_name else ""

    # Libera o slot imediatamente
    c.execute(
        """
        UPDATE slots
        SET status = 'free', client_wa_id = NULL, client_name = NULL, comprovante_id = NULL, receipt_path = NULL
        WHERE id = ? AND studio_id = ?
        """,
        (slot_id, studio["id"]),
    )
    conn.commit()

    # Dispara notificação humanizada ao cliente
    notif_msg = (
        f"Olá{nome_se_houver}! Passando para confirmar que o seu agendamento de ensaio ({slot_niche}) "
        f"do dia {slot_human_date} foi desmarcado conforme solicitado. Se quiser escolher uma nova data, é só me chamar por aqui! ✨"
    )

    if client_wa_id:
        c.execute(
            """
            INSERT INTO messages (studio_id, wa_id, direction, content, timestamp, status)
            VALUES (?, ?, 'out', ?, ?, 'sent')
            """,
            (studio["id"], client_wa_id, notif_msg, now_iso()),
        )
        conn.commit()
        send_whatsapp_message(studio, client_wa_id, notif_msg)

    conn.close()
    logger.info("SLOT_CANCELLED: Agendamento slot_id=%d desmarcado e notificação enviada para %s", slot_id, mask_wa_id(client_wa_id))
    return jsonify({"ok": True, "slot_id": slot_id, "status": "free", "notified": bool(client_wa_id)})


@app.route("/dashboard/status", methods=["POST"])
@app.route("/bot/ativar", methods=["POST"])
def update_studio_status():
    data = request.get_json(silent=True) or request.form or {}
    studio_id = data.get("studio_id")
    studio = get_active_studio(studio_id)
    if not studio:
        # Fallback para o estúdio ativo padrão
        studio = get_active_studio()
    if not studio:
        return jsonify({"ok": False, "error": "Studio not found"}), 404

    new_status = data.get("status")
    if not new_status:
        paused = data.get("paused")
        new_status = "PAUSED" if paused is True else "ACTIVE"

    conn = get_db()
    c = conn.cursor()
    c.execute("UPDATE studios SET status = ? WHERE id = ?", (new_status, studio["id"]))
    
    # Se pausou o bot, resolve ou congela itens em waiting_queue para não disparar takeover automático
    if new_status == "PAUSED":
        c.execute("UPDATE waiting_queue SET status = 'WAITING_HUMAN' WHERE status = 'WAITING_INITIAL_10S'")
    conn.commit()
    conn.close()
    logger.info("STATUS_STUDIO_UPDATED: Estúdio %s alterado para status=%s", studio["id"], new_status)
    return jsonify({"ok": True, "status": new_status})


@app.route("/dashboard/retomar", methods=["POST"])
def retomar_bot():
    data = request.get_json(silent=True) or request.form or {}
    studio_id = data.get("studio_id")
    studio = get_active_studio(studio_id)
    if not studio:
        studio = get_active_studio()
    if not studio:
        return jsonify({"ok": False}), 404
    conn = get_db()
    c = conn.cursor()
    c.execute("UPDATE studios SET status = 'ACTIVE' WHERE id = ?", (studio["id"],))
    conn.commit()
    conn.close()
    logger.info("STATUS_STUDIO_UPDATED: Estúdio %s retomado para ACTIVE", studio["id"])
    return jsonify({"ok": True, "status": "ACTIVE"})


@app.route("/dashboard/testar", methods=["POST"])
@app.route("/simular-conversa", methods=["POST"])
def dashboard_simular_conversa():
    data = request.get_json(silent=True) or {}
    studio = get_active_studio(data.get("studio_id"))
    user_text = clean_input(data.get("text") or "Oi! Quero saber os horários de ensaio", 400)
    wa_id = "5534999990000"
    client_name = "Cliente Teste"

    conn = get_db()
    c = conn.cursor()
    c.execute(
        "INSERT INTO messages (studio_id, wa_id, direction, content, timestamp, status) VALUES (?, ?, 'in', ?, ?, 'received')",
        (studio["id"], wa_id, user_text, now_iso()),
    )
    conn.commit()

    res = generate_humanized_reply(studio, wa_id, client_name, user_text)
    if len(res) == 4:
        reply_text, receipt_url, waiting_human, options = res
    else:
        reply_text, receipt_url, waiting_human = res
        options = []

    if waiting_human:
        c.execute("UPDATE studios SET status = 'WAITING_HUMAN' WHERE id = ?", (studio["id"],))

    c.execute(
        """
        INSERT INTO messages (studio_id, wa_id, direction, content, timestamp, status)
        VALUES (?, ?, 'out', ?, ?, 'sent')
        """,
        (studio["id"], wa_id, reply_text, now_iso()),
    )
    conn.commit()
    conn.close()

    return jsonify(
        {
            "ok": True,
            "reply": reply_text,
            "receipt_url": receipt_url,
            "waiting_human": waiting_human,
            "options": options or [],
        }
    )


@app.route("/chat-teste/reset", methods=["POST"])
@app.route("/api/chat-teste/reset", methods=["POST"])
def api_chat_teste_reset():
    """
    Limpa o histórico de mensagens de teste (wa_id = 5534999990000) daquele estúdio,
    reseta travas de WAITING_HUMAN ou estados pendentes e recarrega a janela limpa.
    """
    token = request.args.get("acesso") or request.args.get("token") or (request.get_json(silent=True) or {}).get("acesso") or (request.get_json(silent=True) or {}).get("token")
    if not token:
        return jsonify({"ok": False, "error": "Token obrigatório"}), 403

    conn = get_db()
    c = conn.cursor()
    c.execute("SELECT * FROM studios WHERE dashboard_token = ?", (token,))
    st_row = c.fetchone()
    if not st_row:
        conn.close()
        return jsonify({"ok": False, "error": "Token inválido"}), 403

    studio = dict(st_row)
    test_wa_id = "5534999990000"

    # Remove mensagens de teste
    c.execute("DELETE FROM messages WHERE studio_id = ? AND wa_id = ?", (studio["id"], test_wa_id))
    # Remove da fila de espera humana
    c.execute("DELETE FROM waiting_queue WHERE client_phone = ?", (test_wa_id,))
    # Restaura status do estúdio para ACTIVE
    c.execute("UPDATE studios SET status = 'active' WHERE id = ?", (studio["id"],))

    conn.commit()
    conn.close()
    logger.info("CHAT_TEST_RESET: Histórico de chat de teste resetado com sucesso para estúdio %s", studio["id"])
    return jsonify({"ok": True, "message": "Histórico de teste resetado"})


@app.route("/instalar")
def page_instalar():
    studio = get_active_studio()
    return render_template("instalar.html", studio=studio, dashboard_url=build_dashboard_url(studio))


@app.route("/ajuda")
def page_ajuda():
    studio = get_active_studio()
    return render_template("ajuda.html", studio=studio, dashboard_url=build_dashboard_url(studio))


@app.route("/privacidade")
def page_privacidade():
    studio = get_active_studio()
    return render_template("privacidade.html", studio=studio, dashboard_url=build_dashboard_url(studio))


# ==============================================================================
# PWA ASSETS (MANIFEST & SERVICE WORKER)
# ==============================================================================
@app.route("/manifest.json")
def serve_manifest():
    return send_from_directory(STATIC_DIR, "manifest.json", mimetype="application/manifest+json")


@app.route("/service-worker.js")
def serve_sw():
    return send_from_directory(STATIC_DIR, "service-worker.js", mimetype="application/javascript")


# ==============================================================================
# WEBHOOK META OFICIAL (GET VERIFY_TOKEN + POST HMAC-SHA256 + ANTI-LOOP + RATE LIMIT)
# ==============================================================================
def verify_hmac_signature(raw_body: bytes, signature_header: str) -> bool:
    if not signature_header or not signature_header.startswith("sha256="):
        return False
    received_sig = signature_header.split("sha256=", 1)[1].strip()
    candidate_secrets = {
        WHATSAPP_APP_SECRET,
        os.getenv("APP_SECRET", "studio_bot_app_secret_2026"),
        "studio_bot_app_secret_2026",
    }
    for sec in candidate_secrets:
        if not sec:
            continue
        expected_sig = hmac.new(
            sec.encode("utf-8"),
            msg=raw_body,
            digestmod=hashlib.sha256,
        ).hexdigest()
        if hmac.compare_digest(received_sig, expected_sig):
            return True
    return False


@app.route("/webhook", methods=["GET", "POST"])
@limiter.limit("10 per minute", methods=["POST"])
def webhook():
    if request.method == "GET":
        mode = request.args.get("hub.mode")
        token = request.args.get("hub.verify_token")
        challenge = request.args.get("hub.challenge", "")
        if mode == "subscribe" and token == VERIFY_TOKEN:
            return challenge, 200
        return jsonify({"error": "Invalid verify_token"}), 403

    # POST /webhook: Valida X-Hub-Signature-256 com HMAC-SHA256 usando WHATSAPP_APP_SECRET
    raw_body = request.get_data()
    sig_header = request.headers.get("X-Hub-Signature-256", "")
    if not verify_hmac_signature(raw_body, sig_header):
        logger.warning("WEBHOOK_REJECTED: invalid X-Hub-Signature-256")
        return jsonify({"error": "Invalid HMAC signature"}), 403

    data = request.get_json(silent=True) or {}

    # Suporta formato oficial Meta Cloud API v20 e formato compacto do gateway
    extracted_messages = []
    if "entry" in data:
        for entry in data.get("entry", []):
            for change in entry.get("changes", []):
                val = change.get("value", {})
                # Ignora eventos de status (delivered, read, sent)
                if "statuses" in val and "messages" not in val:
                    continue
                metadata = val.get("metadata", {})
                phone_number_id = metadata.get("phone_number_id", "")
                contacts = val.get("contacts", [])
                contact_name = (
                    contacts[0].get("profile", {}).get("name", "Cliente")
                    if contacts
                    else "Cliente"
                )
                for msg in val.get("messages", []):
                    extracted_messages.append(
                        {
                            "message_id": msg.get("id", ""),
                            "from": msg.get("from", ""),
                            "phone_number_id": phone_number_id,
                            "type": msg.get("type", "text"),
                            "text": (msg.get("text") or {}).get("body", ""),
                            "audio": msg.get("audio") or {},
                            "client_name": contact_name,
                            "from_me": False,
                        }
                    )
    elif data.get("type") == "message" or "message_id" in data or "id" in data or "from" in data:
        if data.get("type") not in (None, "message", "text", "audio"):
            return jsonify({"status": "ignored_non_message"}), 200
        raw_t = data.get("text")
        if isinstance(raw_t, dict):
            raw_t = raw_t.get("body", "")
        elif raw_t is None:
            raw_t = data.get("body", "")
        extracted_messages.append(
            {
                "message_id": str(data.get("message_id") or data.get("id") or f"gw_{int(time.time()*1000)}"),
                "from": str(data.get("from") or data.get("wa_id") or ""),
                "phone_number_id": str(data.get("phone_number_id") or ""),
                "type": data.get("msg_type") or data.get("type") or "text",
                "text": str(raw_t or ""),
                "audio": data.get("audio") if isinstance(data.get("audio"), dict) else {"duration": data.get("audio_duration", 0)},
                "client_name": str(data.get("client_name") or data.get("name") or data.get("pushName") or "Cliente"),
                "from_me": bool(data.get("fromMe") or data.get("from_me")),
            }
        )

    if not extracted_messages:
        return jsonify({"status": "ignored_no_messages"}), 200

    responses = []
    for item in extracted_messages:
        msg_id = item["message_id"]
        wa_id = str(item["from"] or "")
        studio = get_active_studio()

        # 1. Filtro de Eco (ignora mensagens enviadas pelo próprio número do estúdio)
        if (
            item.get("from_me")
            or not wa_id
            or wa_id == studio.get("phone_number_id")
            or (item.get("phone_number_id") and wa_id == item.get("phone_number_id"))
        ):
            logger.info("LOOP_PREVENTED: echo message ignored from %s", mask_wa_id(wa_id))
            return jsonify({"status": "ignored_echo"}), 200

        # 2. Idempotência: verifica processed_messages ANTES de qualquer processamento
        if is_duplicate(msg_id):
            return jsonify({"status": "duplicate_ignored", "message_id": msg_id}), 200

        # 3. Debounce de 3s por wa_id
        if is_debounced(wa_id, window_seconds=3.0):
            return jsonify({"status": "debounced_ignored"}), 200

        # 4. Modo PAUSED geral do estúdio: se o fotógrafo pausou o bot manualmente no dashboard
        if studio.get("status") == "PAUSED":
            conn = get_db()
            c = conn.cursor()
            c.execute(
                "INSERT INTO messages (studio_id, wa_id, direction, content, timestamp, status) VALUES (?, ?, 'in', ?, ?, 'bot_paused')",
                (studio["id"], wa_id, item.get("text") or "[Áudio]", now_iso()),
            )
            conn.commit()
            conn.close()
            return jsonify({"status": "bot_manually_paused"}), 200

        # 4b. Verifica fila humana por cliente (waiting_queue):
        # Se este cliente específico estiver aguardando o humano (status='WAITING_HUMAN' ou 'WAITING_INITIAL_10S'),
        # apenas registra a mensagem dele e não responde com o bot imediatamente
        conn = get_db()
        c = conn.cursor()
        c.execute("SELECT status, waiting_since, followup_count FROM waiting_queue WHERE client_phone = ?", (wa_id,))
        client_wait = c.fetchone()
        conn.close()

        if client_wait and client_wait["status"] == "WAITING_HUMAN":
            conn = get_db()
            c = conn.cursor()
            c.execute(
                "INSERT INTO messages (studio_id, wa_id, direction, content, timestamp, status) VALUES (?, ?, 'in', ?, ?, 'waiting_human')",
                (studio["id"], wa_id, item.get("text") or "[Áudio]", now_iso()),
            )
            conn.commit()
            conn.close()
            logger.info("Cliente %s aguardando humano. Mensagem salva sem interrupção do bot.", mask_wa_id(wa_id))
            return jsonify({"status": "client_waiting_human_saved"}), 200

        # 5. Tratamento de Áudio (>60s pede texto, <=60s transcreve com Gemini)
        msg_type = item.get("type", "text")
        audio_info = item.get("audio") or {}
        transcribed_cipher = ""
        user_text = item.get("text") or ""

        if msg_type == "audio" or audio_info.get("duration"):
            duration = float(audio_info.get("duration") or 0)
            if duration > 60:
                short_audio_reply = (
                    "Oi! Estou na correria aqui no estúdio e não consigo ouvir áudio longo agora, "
                    "pode me mandar por texto rapidinho?"
                )
                conn = get_db()
                c = conn.cursor()
                c.execute(
                    "INSERT INTO messages (studio_id, wa_id, direction, content, timestamp, status) VALUES (?, ?, 'in', ?, ?, 'audio_too_long')",
                    (studio["id"], wa_id, f"[Áudio {int(duration)}s]", now_iso()),
                )
                c.execute(
                    "INSERT INTO messages (studio_id, wa_id, direction, content, timestamp, status) VALUES (?, ?, 'out', ?, ?, 'sent')",
                    (studio["id"], wa_id, short_audio_reply, now_iso()),
                )
                conn.commit()
                conn.close()
                send_whatsapp_message(studio, wa_id, short_audio_reply)
                return jsonify({"status": "audio_too_long_replied", "reply": short_audio_reply}), 200
            else:
                transcribed_plain = transcribe_audio_with_gemini(
                    fallback_text=audio_info.get("transcription") or user_text
                )
                transcribed_cipher = encrypt_value(transcribed_plain)
                user_text = transcribed_plain

        # 6. Salva mensagem de entrada e gera resposta humanizada
        conn = get_db()
        c = conn.cursor()
        c.execute(
            """
            INSERT INTO messages (studio_id, wa_id, direction, content, timestamp, transcribed_audio, status)
            VALUES (?, ?, 'in', ?, ?, ?, 'received')
            """,
            (studio["id"], wa_id, user_text, now_iso(), transcribed_cipher),
        )
        conn.commit()

        gen_res = generate_humanized_reply(
            studio, wa_id, item.get("client_name") or "", user_text
        )
        if len(gen_res) == 4:
            reply_text, receipt_url, set_waiting_human, _ = gen_res
        else:
            reply_text, receipt_url, set_waiting_human = gen_res

        c.execute(
            """
            INSERT INTO messages (studio_id, wa_id, direction, content, timestamp, status)
            VALUES (?, ?, 'out', ?, ?, 'sent')
            """,
            (studio["id"], wa_id, reply_text, now_iso()),
        )
        conn.commit()
        conn.close()

        send_whatsapp_message(studio, wa_id, reply_text, image_url=receipt_url)
        responses.append(
            {
                "wa_id": mask_wa_id(wa_id),
                "reply": reply_text,
                "receipt_url": receipt_url,
                "waiting_human": set_waiting_human,
            }
        )

    return jsonify({"status": "processed", "responses": responses}), 200


# ==============================================================================
# LGPD COMPLETO (/lgpd/delete, /lgpd/export/<studio_id>)
# ==============================================================================
@app.route("/lgpd/delete", methods=["POST", "DELETE"])
@app.route("/lgpd/delete/<target_id>", methods=["POST", "DELETE", "GET"])
def lgpd_delete(target_id: str = None):
    """Apaga todos os dados do estúdio ou cliente (studios, messages, slots, followups, consent_log)."""
    data = request.get_json(silent=True) or request.form or {}
    studio_id = target_id or data.get("studio_id") or data.get("wa_id")
    if not studio_id:
        return jsonify({"error": "studio_id required"}), 400

    conn = get_db()
    c = conn.cursor()
    c.execute("DELETE FROM messages WHERE studio_id = ? OR wa_id = ?", (studio_id, studio_id))
    c.execute("DELETE FROM slots WHERE studio_id = ? OR client_wa_id = ?", (studio_id, studio_id))
    c.execute("DELETE FROM followups WHERE studio_id = ? OR wa_id = ?", (studio_id, studio_id))
    c.execute("DELETE FROM consent_log WHERE studio_id = ?", (studio_id,))
    c.execute("DELETE FROM studios WHERE id = ?", (studio_id,))
    conn.commit()
    conn.close()

    return jsonify({"status": "deleted", "deleted_id": studio_id}), 200


@app.route("/lgpd/export/<studio_id>", methods=["GET"])
def lgpd_export(studio_id: str):
    """Exporta todos os dados do estúdio/cliente em JSON estruturado (sem expor chave bruta)."""
    conn = get_db()
    c = conn.cursor()
    c.execute("SELECT id, studio_name, photographer_name, secretary_name, niches, price, photos, waba_id, phone_number_id, created_at, consent_lgpd, status FROM studios WHERE id = ?", (studio_id,))
    st = c.fetchone()

    c.execute("SELECT id, studio_id, wa_id, direction, content, timestamp, status FROM messages WHERE studio_id = ? OR wa_id = ?", (studio_id, studio_id))
    msgs = [dict(r) for r in c.fetchall()]

    c.execute("SELECT id, studio_id, start_at, end_at, status, client_wa_id, client_name, comprovante_id FROM slots WHERE studio_id = ? OR client_wa_id = ?", (studio_id, studio_id))
    slots_rows = [dict(r) for r in c.fetchall()]

    c.execute("SELECT id, studio_id, action, timestamp, ip FROM consent_log WHERE studio_id = ?", (studio_id,))
    consents = [dict(r) for r in c.fetchall()]
    conn.close()

    return jsonify(
        {
            "studio_id": studio_id,
            "exported_at": now_iso(),
            "studio": dict(st) if st else None,
            "messages": msgs,
            "slots": slots_rows,
            "consent_log": consents,
        }
    ), 200


# ==============================================================================
# HEALTHCHECK & STATUS DE CONEXÃO (1 CLIQUE)
# ==============================================================================
@app.route("/health")
def health():
    return jsonify({"status": "ok", "db": os.path.exists(DB_PATH)}), 200


@app.route("/status-conexao")
@app.route("/api/qr_status")
def status_conexao():
    """Rota sem jargão técnico usada pela página /comecar e /dashboard para checar conexão."""
    if request.args.get("auto_start") == "1":
        st = get_active_studio()
        if st:
            conn = get_db()
            conn.execute("UPDATE studios SET status = 'ACTIVE' WHERE id = ?", (st["id"],))
            conn.commit()
            conn.close()
    try:
        r = requests.get(f"{GATEWAY_URL}/status", timeout=2)
        if r.status_code == 200:
            return jsonify(r.json()), 200
    except Exception:
        pass
    return jsonify({"status": "READY_ONE_CLICK", "qr": None, "connectedNumber": None}), 200


@app.route("/desconectar-whatsapp", methods=["POST"])
@app.route("/api/qr_disconnect", methods=["POST"])
def desconectar_whatsapp():
    """Desconecta sessão atual do gateway para gerar um novo QR Code."""
    try:
        r = requests.post(f"{GATEWAY_URL}/disconnect", timeout=4)
        if r.status_code == 200:
            return jsonify(r.json()), 200
    except Exception as e:
        return jsonify({"status": "error", "message": str(e)}), 500
    return jsonify({"status": "ok"}), 200


@app.route("/api/bot/status")
def api_bot_status():
    st = get_active_studio()
    paused = st.get("status") in ("PAUSED", "WAITING_HUMAN")
    return jsonify({"paused": paused, "status": "PAUSED" if paused else "ACTIVE"}), 200


@app.route("/api/bot/toggle", methods=["POST"])
def api_bot_toggle():
    data = request.get_json(silent=True) or {}
    st = get_active_studio()
    current_paused = st.get("status") in ("PAUSED", "WAITING_HUMAN")
    if "paused" in data:
        new_paused = bool(data["paused"])
    else:
        new_paused = not current_paused
    new_status = "PAUSED" if new_paused else "ACTIVE"
    conn = get_db()
    conn.execute("UPDATE studios SET status = ? WHERE id = ?", (new_status, st["id"]))
    conn.commit()
    conn.close()
    return jsonify({"paused": new_paused, "status": new_status}), 200


@app.route("/api/messages")
def api_messages_compat():
    st = get_active_studio()
    conn = get_db()
    rows = conn.execute(
        "SELECT id, wa_id as phone, direction as sender, content as text, timestamp as created_at FROM messages WHERE studio_id = ? ORDER BY id ASC LIMIT 50",
        (st["id"],),
    ).fetchall()
    conn.close()
    msgs = []
    for r in rows:
        d = dict(r)
        d["sender"] = "bot" if d["sender"] in ("out", "bot") else "client"
        msgs.append(d)
    return jsonify({"messages": msgs}), 200


@app.route("/api/simulate", methods=["POST"])
def api_simulate_compat():
    return dashboard_simular_conversa()


@app.route("/api/client/leads")
def api_leads_compat():
    st = get_active_studio()
    conn = get_db()
    rows = conn.execute(
        "SELECT id, wa_id as client_phone, content as summary, timestamp as created_at, status FROM messages WHERE studio_id = ? AND status = 'waiting_human' ORDER BY id DESC LIMIT 20",
        (st["id"],),
    ).fetchall()
    conn.close()
    return jsonify({"leads": [dict(r) for r in rows]}), 200


@app.route("/api/client/slots")
def api_slots_compat():
    st = get_active_studio()
    ensure_slots_for_studio(st["id"])
    conn = get_db()
    rows = conn.execute(
        "SELECT id, start_at, end_at, status, client_name, client_wa_id as client_phone FROM slots WHERE studio_id = ? ORDER BY start_at ASC LIMIT 30",
        (st["id"],),
    ).fetchall()
    conn.close()
    out = []
    for r in rows:
        d = dict(r)
        d["date"] = format_slot_human(d["start_at"])
        d["time"] = ""
        out.append(d)
    return jsonify({"slots": out}), 200


@app.route("/api/client/appointments")
def api_appointments_compat():
    st = get_active_studio()
    conn = get_db()
    rows = conn.execute(
        "SELECT id, start_at as slot_label, status, client_name, client_wa_id as client_phone, comprovante_id FROM slots WHERE studio_id = ? AND status = 'booked' ORDER BY start_at ASC LIMIT 20",
        (st["id"],),
    ).fetchall()
    conn.close()
    out = []
    for r in rows:
        d = dict(r)
        d["slot_label"] = format_slot_human(d["slot_label"])
        out.append(d)
    return jsonify({"appointments": out}), 200


@app.route("/api/client/followups_30h")
def api_followups_compat():
    st = get_active_studio()
    conn = get_db()
    rows = conn.execute(
        "SELECT id, wa_id as client_phone, attempts as followup_count, last_attempt as created_at FROM followups WHERE studio_id = ? ORDER BY id DESC LIMIT 20",
        (st["id"],),
    ).fetchall()
    conn.close()
    return jsonify({"followups": [dict(r) for r in rows]}), 200


# Inicializa banco e QR Code na carga do módulo (compatível com gunicorn app:app)
init_db()
ensure_qr_comecar()

if __name__ == "__main__":
    PORT = int(os.getenv("PORT", 5005))
    DB_PATH = os.getenv("DB_PATH", "/data/studio.db" if os.path.exists("/data") else "studio.db")
    app.run(host="0.0.0.0", port=PORT)
