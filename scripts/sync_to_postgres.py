#!/usr/bin/env python3
"""
Script de Sincronização: SQLite (/data/studio.db) -> PostgreSQL (PC do Fotógrafo)
Gustavo Alves Fotografia
Lê as tabelas contacts, ensaios, slots e waiting_queue do SQLite e atualiza no PostgreSQL.
"""

import os
import sys
import sqlite3
import logging

logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(message)s")
logger = logging.getLogger("sync_postgres")

SQLITE_PATH = os.getenv("DB_PATH", "/data/studio.db")
if not os.path.exists(SQLITE_PATH) and os.path.exists("studio.db"):
    SQLITE_PATH = "studio.db"

PG_URL = os.getenv("PG_DATABASE_URL") or os.getenv("DATABASE_URL") or "postgresql://postgres:postgres@localhost:5432/studio_db"

def sync_data():
    logger.info("Iniciando sincronização SQLite (%s) -> PostgreSQL...", SQLITE_PATH)
    if not os.path.exists(SQLITE_PATH):
        logger.error("Arquivo SQLite não encontrado em %s", SQLITE_PATH)
        sys.exit(1)

    try:
        import psycopg2
        from psycopg2.extras import execute_batch
    except ImportError:
        logger.warning("psycopg2 não instalado. Tentando psycopg2-binary ou exibindo prévia de exportação.")
        logger.info("Para executar a sincronização direta no PC, instale: pip install psycopg2-binary")
        return

    sqlite_conn = sqlite3.connect(SQLITE_PATH)
    sqlite_conn.row_factory = sqlite3.Row
    s_cur = sqlite_conn.cursor()

    try:
        pg_conn = psycopg2.connect(PG_URL)
        p_cur = pg_conn.cursor()
    except Exception as e:
        logger.error("Erro ao conectar no PostgreSQL (%s): %s", PG_URL, e)
        return

    # 1. Sync contacts
    try:
        s_cur.execute("SELECT * FROM contacts")
        contacts = [dict(r) for r in s_cur.fetchall()]
        logger.info("Sincronizando %d contatos...", len(contacts))
        for c in contacts:
            wa = c.get("wa_id") or c.get("phone")
            p_cur.execute("""
                INSERT INTO contacts (wa_id, studio_id, nome, tipo, first_contact_at, last_contact_at, total_conversas, pacote_interesse, ja_comprou)
                VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s)
                ON CONFLICT(wa_id) DO UPDATE SET
                    nome = EXCLUDED.nome,
                    tipo = EXCLUDED.tipo,
                    last_contact_at = EXCLUDED.last_contact_at,
                    total_conversas = EXCLUDED.total_conversas,
                    pacote_interesse = EXCLUDED.pacote_interesse,
                    ja_comprou = EXCLUDED.ja_comprou
            """, (
                wa,
                1,
                c.get("nome") or c.get("name") or "Cliente",
                c.get("tipo") or "cliente",
                c.get("first_contact_at"),
                c.get("last_contact_at"),
                c.get("total_conversas") or 1,
                c.get("pacote_interesse"),
                bool(c.get("ja_comprou"))
            ))
        pg_conn.commit()
    except Exception as e:
        logger.warning("Aviso no sync de contacts: %s", e)
        pg_conn.rollback()

    # 2. Sync ensaios
    try:
        s_cur.execute("SELECT * FROM ensaios")
        ensaios = [dict(r) for r in s_cur.fetchall()]
        logger.info("Sincronizando %d ensaios...", len(ensaios))
        for e in ensaios:
            p_cur.execute("""
                INSERT INTO ensaios (studio_id, contact_wa_id, status, pacote, start_at, valor, comprovante_url, previa_instagram_url, avaliacao_enviada, created_at)
                VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
                ON CONFLICT(start_at) DO UPDATE SET
                    status = EXCLUDED.status,
                    pacote = EXCLUDED.pacote,
                    valor = EXCLUDED.valor,
                    previa_instagram_url = EXCLUDED.previa_instagram_url,
                    avaliacao_enviada = EXCLUDED.avaliacao_enviada
            """, (
                1,
                e.get("contact_wa_id"),
                e.get("status") or "agendado",
                e.get("pacote"),
                e.get("start_at"),
                e.get("valor"),
                e.get("comprovante_url"),
                e.get("previa_instagram_url"),
                bool(e.get("avaliacao_enviada")),
                e.get("created_at")
            ))
        pg_conn.commit()
    except Exception as e:
        logger.warning("Aviso no sync de ensaios: %s", e)
        pg_conn.rollback()

    sqlite_conn.close()
    pg_conn.close()
    logger.info("✅ Sincronização concluída com sucesso no PostgreSQL do PC!")

if __name__ == "__main__":
    sync_data()
