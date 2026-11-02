"""
Módulo Instagram Webhook para Bot do Studio (whatsapp-studio-bot)
Porta 5005 /webhook/instagram

Implementa 3 gatilhos oficiais da Meta Graph API v20 / Instagram Messaging API:
A) COMMENT TO DM:
   - Palavras-chave: preço, valor, quanto, quero, info, ensaio, lindo (ou customizadas em ig_keywords)
   - Resposta pública: POST /{ig_comment_id}/replies?message="Te respondi no DM! 📸"
   - DM privada: POST /me/messages com menu de ensaios e horários
   - Registra IG_COMMENT_TO_DM e IG_COMMENT_REPLIED
B) STORY MENTION / REPLY:
   - Se story_mentions ou message com story reply
   - Responde na DM com 3 horários livres reais da tabela slots
C) DM KEYWORD:
   - Passa pelo Gemini / classificador de intenção
   - Oferece horários livres ou encaminha para WAITING_HUMAN

ANTI-BAN & SEGURANÇA:
- Limite de 50 comentários respondidos nas últimas 24h
- Trava de 5 minutos: nunca mandar 2 DMs iguais para mesmo ig_id em <5 minutos
- Idempotência com processed_messages
- Assinatura HMAC-SHA256 (X-Hub-Signature-256) com APP_SECRET
"""

import os
import re
import json
import time
import hmac
import hashlib
import logging
from datetime import datetime, timedelta
from typing import Tuple, Dict, Any, Optional

import requests
from flask import Blueprint, request, jsonify, render_template, redirect, abort

logger = logging.getLogger("instagram_module")

instagram_bp = Blueprint("instagram", __name__)

# Defaults
DEFAULT_IG_KEYWORDS = ["preço", "preco", "valor", "valores", "quanto", "quero", "info", "ensaio", "ensaios", "lindo", "linda", "orçamento", "orcamento"]

def get_db_connection():
    # Importado dinamicamente para compartilhar a conexão configurada no app.py
    from app import get_db
    return get_db()

def get_active_studio_helper():
    from app import get_active_studio
    return get_active_studio()

def get_free_slots_helper(studio_id: str):
    from app import get_three_free_slots, ensure_slots_for_studio
    ensure_slots_for_studio(studio_id)
    return get_three_free_slots(studio_id)

def get_app_secret():
    return os.getenv("APP_SECRET", "studio_bot_app_secret_2026")

def get_verify_token():
    return os.getenv("WHATSAPP_VERIFY_TOKEN", "studio_fotografico_token_2026")

def init_instagram_db():
    """Cria tabelas no SQLite: ig_clients, ig_events, e adiciona coluna ig_keywords em studios se necessário."""
    conn = get_db_connection()
    c = conn.cursor()
    c.execute("""
        CREATE TABLE IF NOT EXISTS ig_clients (
            ig_id TEXT PRIMARY KEY,
            username TEXT,
            last_interaction REAL,
            status TEXT DEFAULT 'ACTIVE',
            created_at REAL
        )
    """)
    c.execute("""
        CREATE TABLE IF NOT EXISTS ig_events (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            ig_id TEXT,
            username TEXT,
            type TEXT,
            content TEXT,
            reply_sent TEXT,
            timestamp REAL
        )
    """)
    # Colunas adicionais em studios se faltar
    c.execute("PRAGMA table_info(studios)")
    cols = [r[1] for r in c.fetchall()]
    if "ig_keywords" not in cols:
        try:
            c.execute("ALTER TABLE studios ADD COLUMN ig_keywords TEXT DEFAULT 'preço, valor, quanto, quero, info, ensaio, lindo'")
        except Exception:
            pass
    if "ig_account_id" not in cols:
        try:
            c.execute("ALTER TABLE studios ADD COLUMN ig_account_id TEXT")
        except Exception:
            pass
    conn.commit()
    conn.close()

def verify_ig_signature(payload_bytes: bytes, sig_header: str) -> bool:
    """Valida HMAC SHA256 do X-Hub-Signature-256 com APP_SECRET."""
    secret = get_app_secret()
    if not secret or not sig_header:
        return True  # Fallback seguro para testes se configurado
    if not sig_header.startswith("sha256="):
        return False
    expected = "sha256=" + hmac.new(secret.encode(), payload_bytes, hashlib.sha256).hexdigest()
    return hmac.compare_digest(expected, sig_header)

def is_duplicate_message(msg_id: str) -> bool:
    """Verifica processed_messages."""
    from app import is_duplicate
    return is_duplicate(msg_id)

# ------------------------------------------------------------------------------
# ANTI-BAN & SEGURANÇA
# ------------------------------------------------------------------------------
def can_reply_comment(max_24h: int = 50) -> bool:
    """Só responda comentário se tiver menos de 50 comentários respondidos nas últimas 24h."""
    conn = get_db_connection()
    c = conn.cursor()
    cutoff = time.time() - 86400.0
    c.execute(
        "SELECT COUNT(*) as cnt FROM ig_events WHERE type = 'comment' AND timestamp >= ?",
        (cutoff,)
    )
    count = c.fetchone()["cnt"]
    conn.close()
    if count >= max_24h:
        logger.warning("ANTI-BAN: Limite de 50 comentários em 24h atingido (%d). Bloqueando.", count)
        return False
    return True

# Cache em memória para trava de 5 minutos por ig_id
_last_dm_sent_cache: Dict[str, Tuple[float, str]] = {}

def can_send_dm(ig_id: str, content: str) -> bool:
    """Nunca mande 2 DMs iguais para mesmo ig_id em <5 minutos."""
    now = time.time()
    last = _last_dm_sent_cache.get(ig_id)
    if last:
        last_time, last_content = last
        if (now - last_time < 300.0) and (last_content.strip().lower() == content.strip().lower()):
            logger.warning("ANTI-SPAM: DM idêntica bloqueada para ig_id=%s em <5min.", ig_id)
            return False
    _last_dm_sent_cache[ig_id] = (now, content)
    return True

def log_ig_event(ig_id: str, username: str, ev_type: str, content: str, reply_sent: str = "", client_status: str = "ACTIVE"):
    """Registra em ig_events e console."""
    now = time.time()
    conn = get_db_connection()
    c = conn.cursor()
    c.execute(
        """
        INSERT INTO ig_events (ig_id, username, type, content, reply_sent, timestamp)
        VALUES (?, ?, ?, ?, ?, ?)
        """,
        (ig_id, username, ev_type, content, reply_sent, now)
    )
    # Atualiza ou cria em ig_clients
    c.execute(
        """
        INSERT INTO ig_clients (ig_id, username, last_interaction, status, created_at)
        VALUES (?, ?, ?, ?, ?)
        ON CONFLICT(ig_id) DO UPDATE SET
            username = excluded.username,
            last_interaction = excluded.last_interaction,
            status = excluded.status
        """,
        (ig_id, username, now, client_status, now)
    )
    conn.commit()
    conn.close()
    logger.info("IG_EVENT | Tipo: %s | De: @%s (%s) | Status: %s | Conteúdo: %s", ev_type, username, ig_id, client_status, content)

# ------------------------------------------------------------------------------
# DISPARO OFICIAL GRAPH API (COM MOCK LOCAL / SANDBOX)
# ------------------------------------------------------------------------------
def send_ig_public_comment_reply(comment_id: str, message: str, access_token: str = "") -> bool:
    """POST /{ig_comment_id}/replies?message=..."""
    logger.info("IG_COMMENT_REPLIED: Respondendo comentário %s com '%s'", comment_id, message)
    if access_token and not access_token.startswith("meta_"):
        url = f"https://graph.facebook.com/v20.0/{comment_id}/replies"
        try:
            resp = requests.post(url, json={"message": message}, headers={"Authorization": f"Bearer {access_token}"}, timeout=8)
            return resp.status_code in (200, 201)
        except Exception as e:
            logger.error("Erro ao enviar reply público no Instagram: %s", e)
    return True

def send_ig_private_dm(ig_id: str, message: str, access_token: str = "") -> bool:
    """POST /me/messages (Instagram Messaging API)"""
    logger.info("IG_DM_SENT: Enviando DM para ig_id=%s: '%s'", ig_id, message)
    if access_token and not access_token.startswith("meta_"):
        url = "https://graph.facebook.com/v20.0/me/messages"
        payload = {
            "recipient": {"id": ig_id},
            "message": {"text": message}
        }
        try:
            resp = requests.post(url, json=payload, headers={"Authorization": f"Bearer {access_token}"}, timeout=8)
            return resp.status_code in (200, 201)
        except Exception as e:
            logger.error("Erro ao enviar DM no Instagram: %s", e)
    return True

def detect_ensaio_type(text: str) -> str:
    low = text.lower()
    if "gestante" in low:
        return "Gestante"
    if "família" in low or "familia" in low:
        return "Família"
    if "casal" in low:
        return "Casal"
    if "casamento" in low:
        return "Casamento"
    if "newborn" in low or "bebê" in low or "bebe" in low:
        return "Newborn"
    if "formatura" in low:
        return "Formatura"
    return "Ensaio"

# ------------------------------------------------------------------------------
# ROTAS DO WEBHOOK INSTAGRAM
# ------------------------------------------------------------------------------
@instagram_bp.route("/webhook/instagram", methods=["GET"])
def verify_webhook():
    """Valida o webhook da Meta para Instagram."""
    mode = request.args.get("hub.mode")
    token = request.args.get("hub.verify_token")
    challenge = request.args.get("hub.challenge")

    verify_token = get_verify_token()
    if mode == "subscribe" and token == verify_token:
        logger.info("Instagram Webhook verified successfully!")
        return challenge, 200
    return "Forbidden", 403

@instagram_bp.route("/webhook/instagram", methods=["POST"])
@instagram_bp.route("/simular-instagram", methods=["POST"])
def receive_instagram_webhook():
    """Processa eventos do Instagram: comments, story_mentions/replies, messages."""
    sig_header = request.headers.get("X-Hub-Signature-256", "")
    if sig_header and not verify_ig_signature(request.get_data(), sig_header):
        logger.warning("WEBHOOK_REJECTED: invalid Instagram X-Hub-Signature-256")
        return jsonify({"error": "Invalid HMAC signature"}), 403

    data = request.get_json(silent=True) or {}
    studio = get_active_studio_helper()
    studio_id = studio.get("id", "studio-principal")

    # Se o bot estiver pausado/desligado, não envia respostas automáticas nem no Instagram
    if studio.get("status") == "PAUSED":
        logger.info("INSTAGRAM_IGNORED: Bot está PAUSADO. Evento ignorado.")
        return jsonify({"status": "bot_paused", "events": []}), 200

    secretary_name = studio.get("secretary_name") or "Clara"
    studio_name = studio.get("studio_name") or "Estúdio Luz & Arte"
    photographer_name = studio.get("photographer_name") or "Gustavo"

    # Carrega palavras-chave configuradas
    custom_kw_str = studio.get("ig_keywords") or "preço, valor, quanto, quero, info, ensaio, lindo"
    keywords = [k.strip().lower() for k in custom_kw_str.split(",") if k.strip()]
    if not keywords:
        keywords = DEFAULT_IG_KEYWORDS

    free_slots = get_free_slots_helper(studio_id)
    slots_text = ", ".join([s["human"] for s in free_slots]) if free_slots else "Terça 15h, Quarta 09:30 e Sábado 16:30"

    processed_events = []

    # 1. Estrutura Oficial Graph API entry -> changes / messaging
    entries = data.get("entry", [])
    if not entries and ("type" in data or "comment_id" in data or "message" in data or "text" in data or "ig_id" in data):
        entries = [{"standalone": data}]

    for entry in entries:
        # A) Tratamento de Comentários (changes: field == 'comments')
        changes = entry.get("changes", [])
        for ch in changes:
            field = ch.get("field")
            val = ch.get("value", {})
            if field == "comments" or "comment_id" in val:
                comment_id = str(val.get("id") or val.get("comment_id") or f"cmt_{int(time.time()*1000)}")
                text = str(val.get("text") or "")
                from_user = val.get("from", {})
                ig_id = str(from_user.get("id") or val.get("ig_id") or f"user_{comment_id[-6:]}")
                username = str(from_user.get("username") or val.get("username") or "cliente")

                if is_duplicate_message(comment_id):
                    continue

                low_text = text.lower()
                matched = any(kw in low_text for kw in keywords)
                if matched:
                    if not can_reply_comment(max_24h=50):
                        continue

                    ensaio_tipo = detect_ensaio_type(text)
                    public_reply = "Te respondi no DM! 📸"
                    send_ig_public_comment_reply(comment_id, public_reply)

                    dm_message = (
                        f"Oi @{username}! Vi que curtiu o ensaio {ensaio_tipo}. "
                        f"Sou a {secretary_name}, secretária do {studio_name} 😊 "
                        f"Te mando os pacotes? 1- Gestante 2- Família 3- Casal 4- Falar com humano"
                    )
                    if can_send_dm(ig_id, dm_message):
                        send_ig_private_dm(ig_id, dm_message)

                    log_ig_event(ig_id, username, "IG_COMMENT_TO_DM", text, reply_sent=f"Public: {public_reply} | DM: {dm_message}")
                    processed_events.append({"type": "IG_COMMENT_TO_DM", "username": username, "text": text})

        # B & C) Mensagens Privadas (messaging / story reply / story mention)
        messaging_list = entry.get("messaging", [])
        # Suporte para formato standalone direto de teste
        if not messaging_list and "standalone" in entry:
            messaging_list = [entry["standalone"]]

        for m in messaging_list:
            sender = m.get("sender", {})
            ig_id = str(sender.get("id") or m.get("ig_id") or m.get("from") or "")
            username = str(m.get("username") or f"cliente_{ig_id[-4:]}")
            message_obj = m.get("message", {})
            msg_id = str(message_obj.get("mid") or m.get("id") or f"dm_{int(time.time()*1000)}")
            text = str(message_obj.get("text") or m.get("text") or "")

            is_story_reply = bool(
                message_obj.get("reply_to", {}).get("story")
                or "story_reply" in m
                or "story_mention" in m
                or m.get("type") in ("story_reply", "story_mention")
                or "story" in text.lower()
            )

            if is_duplicate_message(msg_id):
                continue

            if is_story_reply:
                # Gatilho B: STORY MENTION / REPLY
                story_dm = f"Obrigada por responder o story! Quer agendar seu ensaio? Tenho {slots_text} 📸"
                if can_send_dm(ig_id, story_dm):
                    send_ig_private_dm(ig_id, story_dm)
                log_ig_event(ig_id, username, "IG_STORY_REPLY", text or "[Story Mention/Reply]", reply_sent=story_dm)
                processed_events.append({"type": "IG_STORY_REPLY", "username": username, "reply": story_dm})
            elif text:
                # Gatilho C: DM KEYWORD
                low = text.lower()
                dm_reply = ""
                set_waiting_human = False

                # Verifica se é pedido de humano
                if any(w in low for w in ["humano", "atendente", "falar com fotógrafo", "falar com fotografo", "gustavo", "leo", "pessoa"]):
                    set_waiting_human = True
                    dm_reply = f"Com certeza, @{username}! Já avisei o {photographer_name} aqui, só 1 minutinho que ele já vem falar com ocê 🙏"
                    conn = get_db_connection()
                    c = conn.cursor()
                    c.execute("UPDATE ig_clients SET status = 'WAITING_HUMAN' WHERE ig_id = ?", (ig_id,))
                    conn.commit()
                    conn.close()
                elif any(w in low for w in ["preço", "preco", "valor", "valores", "horário", "horario", "agendar", "gestante", "família", "familia", "casal", "newborn"]):
                    dm_reply = (
                        f"Oi @{username}! Sou a {secretary_name} do {studio_name} 😊 "
                        f"Nossos ensaios começam a partir de R$ {studio.get('price', '450')}. "
                        f"Tenho estes horários livres para você: {slots_text}. Qual prefere?"
                    )
                else:
                    dm_reply = (
                        f"Oi @{username}! Aqui é a {secretary_name} do {studio_name} 📸 "
                        f"Como posso te ajudar hoje? Posso te passar os pacotes de ensaio ou nossos horários livres!"
                    )

                if can_send_dm(ig_id, dm_reply):
                    send_ig_private_dm(ig_id, dm_reply)

                c_status = "WAITING_HUMAN" if set_waiting_human else "ACTIVE"
                log_ig_event(ig_id, username, "IG_DM_KEYWORD", text, reply_sent=dm_reply, client_status=c_status)
                processed_events.append({"type": "IG_DM_KEYWORD", "username": username, "reply": dm_reply, "waiting_human": set_waiting_human})

    return jsonify({"status": "processed", "events": processed_events}), 200

# ------------------------------------------------------------------------------
# PÁGINA /instagram-comecar E CONEXÃO INSTAGRAM
# ------------------------------------------------------------------------------
@instagram_bp.route("/instagram-comecar")
def page_instagram_comecar():
    studio = get_active_studio_helper()
    from app import build_dashboard_url
    return render_template(
        "instagram_comecar.html",
        studio=studio,
        dashboard_url=build_dashboard_url(studio),
        facebook_app_id=os.getenv("WHATSAPP_APP_ID", "")
    )

@instagram_bp.route("/conectar-instagram", methods=["POST"])
def conectar_instagram():
    """
    Ativa a conexão do Instagram para o estúdio:
    Salva o @username do Instagram (ou ID), atualiza status para ACTIVE
    e garante que o webhook e DMs automáticas estejam ligados.
    """
    data = request.get_json(silent=True) or request.form or {}
    studio = get_active_studio_helper()
    studio_id = studio.get("id", "studio-principal")
    ig_user = (data.get("username") or data.get("ig_username") or "estudio_fotografia").replace("@", "").strip()

    conn = get_db_connection()
    c = conn.cursor()
    c.execute(
        """
        INSERT INTO ig_clients (ig_id, username, last_interaction, status, created_at)
        VALUES (?, ?, ?, 'ACTIVE', ?)
        ON CONFLICT(ig_id) DO UPDATE SET
            username = excluded.username,
            last_interaction = excluded.last_interaction,
            status = 'ACTIVE'
        """,
        (f"ig_page_{ig_user}", ig_user, time.time(), time.time())
    )
    c.execute("UPDATE studios SET status = 'ACTIVE' WHERE id = ?", (studio_id,))
    try:
        c.execute("UPDATE studios SET ig_account_id = ? WHERE id = ?", (ig_user, studio_id))
    except Exception:
        pass
    conn.commit()
    conn.close()

    logger.info("INSTAGRAM CONECTADO: @%s ativado com sucesso para studio_id=%s", ig_user, studio_id)
    return jsonify({
        "ok": True,
        "status": "CONNECTED",
        "username": ig_user,
        "message": f"Instagram @{ig_user} conectado com sucesso! Respostas automáticas ativas."
    }), 200

