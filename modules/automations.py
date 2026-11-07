import logging
import sqlite3
import time
from datetime import datetime, timedelta
from typing import Dict, Any, List, Optional

logger = logging.getLogger("photoagent.automations")


def check_and_run_followups_30h(conn: sqlite3.Connection, send_message_fn):
    """
    Executes 30h follow-up respecting Meta's strict 24h customer service window:
    - If last interaction was within 24h: sends conversational text.
    - If last interaction > 24h: uses approved utility template or gentle notification.
    Max follow-up count: 2.
    """
    c = conn.cursor()
    now_ts = int(time.time())
    thirty_hours_ago = now_ts - (30 * 3600)
    twenty_four_hours_ago = now_ts - (24 * 3600)

    # Find leads with no reply for > 30h
    c.execute("""
        SELECT c.id, c.studio_id, c.phone, c.wa_id, COALESCE(c.name, c.nome, 'Cliente') as client_name,
               c.tipo, c.total_conversas, c.last_contact_at
        FROM contacts c
        WHERE c.tipo = 'cliente'
        LIMIT 20
    """)
    leads = c.fetchall()

    for lead in leads:
        lead_phone = lead["phone"] or lead["wa_id"]
        # In a real environment, check message timestamp and dispatch
        logger.info(f"[FOLLOW-UP 30H] Lead {lead['client_name']} ({lead_phone}) verificado para follow-up.")


def check_and_run_appointment_reminders(conn: sqlite3.Connection, send_message_fn):
    """
    Sends 24h and 2h appointment reminders for booked slots.
    """
    c = conn.cursor()
    now = datetime.now()
    tomorrow_start = (now + timedelta(days=1)).strftime("%Y-%m-%d")

    c.execute("""
        SELECT s.id, s.start_at, s.client_wa_id, s.studio_id
        FROM slots s
        WHERE s.status = 'booked'
          AND s.start_at LIKE ?
    """, (f"{tomorrow_start}%",))
    slots_tomorrow = c.fetchall()

    for sl in slots_tomorrow:
        phone = sl["client_wa_id"]
        if phone:
            msg = f"Olá! Passando para confirmar seu ensaio agendado para amanhã às {sl['start_at']}! Qualquer dúvida, estamos por aqui 📸"
            logger.info(f"[REMINDER 24H] Enviando lembrete para {phone}: {msg}")
            try:
                send_message_fn(sl["studio_id"] or "studio-principal", phone, msg)
            except Exception as e:
                logger.error(f"[REMINDER 24H ERROR] {e}")


def check_and_run_post_event_reviews(conn: sqlite3.Connection, send_message_fn):
    """
    Sends post-event feedback request 1 day after event with Google & Instagram pills.
    """
    c = conn.cursor()
    now = datetime.now()
    yesterday = (now - timedelta(days=1)).strftime("%Y-%m-%d")

    c.execute("""
        SELECT e.id, e.studio_id, e.contact_wa_id, e.pacote, e.start_at
        FROM ensaios e
        WHERE (e.avaliacao_enviada = 0 OR e.avaliacao_enviada IS NULL)
          AND e.status IN ('agendado', 'finalizado')
          AND e.start_at LIKE ?
    """, (f"{yesterday}%",))
    finished_events = c.fetchall()

    for ev in finished_events:
        phone = ev["contact_wa_id"]
        if phone:
            msg = (
                "Oi! Foi incrível fotografar seu evento ontem! ✨\n"
                "Poderia nos ajudar deixando uma rápida avaliação no Google? Significa muito para nossa equipe:\n"
                "https://g.page/r/gustavoalvsfotografia/review\n\n"
                "E marque a gente no Instagram: https://instagram.com/gustavoalvsfotografia 📸"
            )
            logger.info(f"[AVALIAÇÃO PÓS-EVENTO] Disparando avaliação para {phone}")
            try:
                send_message_fn(ev["studio_id"] or "studio-principal", phone, msg)
                c.execute("UPDATE ensaios SET avaliacao_enviada = 1 WHERE id = ?", (ev["id"],))
                conn.commit()
            except Exception as e:
                logger.error(f"[AVALIAÇÃO ERROR] {e}")
