import json
import logging
import sqlite3
from datetime import datetime
from typing import Dict, Any, List

logger = logging.getLogger("photoagent.offline_sync")

INDEXED_DB_SCHEMA_JS = """
const DB_NAME = 'PhotoAgentOfflineDB';
const DB_VERSION = 1;

function openOfflineDB() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = (event) => {
      const db = event.target.result;
      if (!db.objectStoreNames.contains('contacts')) {
        db.createObjectStore('contacts', { keyPath: 'wa_id' });
      }
      if (!db.objectStoreNames.contains('ensaios')) {
        db.createObjectStore('ensaios', { keyPath: 'id' });
      }
      if (!db.objectStoreNames.contains('fila_offline')) {
        db.createObjectStore('fila_offline', { autoIncrement: true });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}
"""


def process_offline_sync_batch(conn: sqlite3.Connection, tenant_id: str, batch: List[Dict[str, Any]]) -> Dict[str, Any]:
    """
    Applies offline actions queued in IndexedDB when mobile phone reconnects.
    """
    applied = 0
    errors = []
    c = conn.cursor()

    for item in batch:
        action = item.get("action")
        payload = item.get("payload", {})
        try:
            if action == "upsert_contact":
                phone = payload.get("phone") or payload.get("wa_id")
                nome = payload.get("nome") or payload.get("name")
                tipo = payload.get("tipo", "cliente")
                now = datetime.now().isoformat()
                c.execute("""
                    INSERT INTO contacts (studio_id, phone, wa_id, name, nome, tipo, created_at)
                    VALUES (?, ?, ?, ?, ?, ?, ?)
                    ON CONFLICT(studio_id, phone) DO UPDATE SET
                        name = excluded.name,
                        nome = excluded.nome,
                        tipo = excluded.tipo
                """, (tenant_id, phone, phone, nome, nome, tipo, now))
                applied += 1

            elif action == "update_ensaio_status":
                ensaio_id = payload.get("id")
                status = payload.get("status")
                c.execute("UPDATE ensaios SET status = ? WHERE id = ?", (status, ensaio_id))
                applied += 1

            elif action == "new_appointment_request":
                slot_id = payload.get("slot_id")
                client_phone = payload.get("phone")
                c.execute("""
                    UPDATE slots SET status = 'booked', client_wa_id = ?
                    WHERE id = ? AND status = 'free'
                """, (client_phone, slot_id))
                applied += 1

        except Exception as e:
            errors.append({"item": item, "error": str(e)})

    conn.commit()
    return {
        "status": "ok",
        "applied_count": applied,
        "errors": errors
    }
