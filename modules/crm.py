import logging
import sqlite3
from typing import Dict, Any, List, Optional

logger = logging.getLogger("photoagent.crm")

KANBAN_COLUMNS = [
    {"id": "agendados", "title": "📅 Agendados", "color": "#60a5fa"},
    {"id": "em_atendimento", "title": "💬 Em Atendimento", "color": "#fbbc04"},
    {"id": "fotografando", "title": "📸 Fotografando", "color": "#a855f7"},
    {"id": "editando", "title": "🎨 Editando", "color": "#38bdf8"},
    {"id": "finalizado", "title": "✅ Finalizado", "color": "#25D366"},
    {"id": "cancelado", "title": "❌ Cancelado / Perdido", "color": "#ea4335"},
]


def get_kanban_board_data(conn: sqlite3.Connection, tenant_id: str = "studio-principal") -> Dict[str, Any]:
    """
    Returns grouped Kanban cards for the 5-column dashboard pipeline.
    """
    c = conn.cursor()
    c.execute("""
        SELECT e.id, e.contact_wa_id, e.status, e.pacote, e.start_at, e.valor,
               e.comprovante_url, e.previa_instagram_url, e.created_at,
               COALESCE(c.name, c.nome, 'Cliente') as client_name,
               c.tipo as contact_tipo
        FROM ensaios e
        LEFT JOIN contacts c ON (e.contact_wa_id = c.phone OR e.contact_wa_id = c.wa_id)
        WHERE (e.studio_id = ? OR e.studio_id IS NULL)
        ORDER BY e.id DESC
    """, (tenant_id,))
    rows = [dict(r) for r in c.fetchall()]

    board = {col["id"]: [] for col in KANBAN_COLUMNS}
    total_revenue = 0.0
    active_leads_count = 0

    for r in rows:
        st = r.get("status") or "agendado"
        if st in board:
            board[st].append(r)
        else:
            board["agendados"].append(r)

        if r.get("valor"):
            total_revenue += float(r["valor"])
        if st in ("agendado", "em_atendimento", "fotografando", "editando"):
            active_leads_count += 1

    return {
        "columns": KANBAN_COLUMNS,
        "cards": board,
        "metrics": {
            "total_ensaios": len(rows),
            "ativos": active_leads_count,
            "finalizados": len(board["finalizado"]),
            "cancelados": len(board["cancelado"]),
            "faturamento_estimado": total_revenue
        }
    }


def update_ensaio_status(conn: sqlite3.Connection, tenant_id: str, ensaio_id: int, new_status: str) -> bool:
    """Updates an ensaio position on the Kanban board."""
    valid_statuses = [col["id"] for col in KANBAN_COLUMNS]
    if new_status not in valid_statuses:
        raise ValueError(f"Status inválido: {new_status}. Opções: {valid_statuses}")
    c = conn.cursor()
    c.execute(
        "UPDATE ensaios SET status = ? WHERE id = ? AND (studio_id = ? OR studio_id IS NULL)",
        (new_status, ensaio_id, tenant_id)
    )
    conn.commit()
    logger.info(f"[CRM KANBAN] Ensaio #{ensaio_id} movido para status '{new_status}'.")
    return c.rowcount > 0
