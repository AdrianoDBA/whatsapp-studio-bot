import json
import logging
import sqlite3
import uuid
from datetime import datetime
from typing import Dict, Any, List, Optional

logger = logging.getLogger("photoagent.multitenant")

DEFAULT_TENANT_ID = "studio-principal"


def init_multitenant_db(conn: sqlite3.Connection):
    """
    Initializes multi-tenant database tables and migrates existing single-studio
    data into tenant structure while preserving all existing records.
    """
    c = conn.cursor()

    # 1. Tenants Table
    c.execute("""
        CREATE TABLE IF NOT EXISTS tenants (
            id TEXT PRIMARY KEY,
            name TEXT NOT NULL,
            photographer_name TEXT NOT NULL,
            secretary_name TEXT NOT NULL,
            phone_number TEXT,
            whatsapp_phone_number_id TEXT,
            waba_id TEXT,
            instagram_username TEXT,
            mode TEXT DEFAULT 'NORMAL',
            status TEXT DEFAULT 'ACTIVE',
            dashboard_token TEXT UNIQUE,
            created_at TEXT
        )
    """)

    # 2. Agent Configuration Table (No-code builder per tenant)
    c.execute("""
        CREATE TABLE IF NOT EXISTS agent_configs (
            tenant_id TEXT PRIMARY KEY,
            agent_name TEXT DEFAULT 'Bruna',
            personality TEXT,
            model_name TEXT DEFAULT 'gemini-1.5-flash',
            temperature REAL DEFAULT 0.4,
            max_output_tokens INTEGER DEFAULT 800,
            system_prompt TEXT,
            packages_json TEXT,
            specialties TEXT,
            allowed_tools TEXT,
            updated_at TEXT,
            FOREIGN KEY (tenant_id) REFERENCES tenants(id)
        )
    """)

    # 3. Knowledge Documents (RAG)
    c.execute("""
        CREATE TABLE IF NOT EXISTS knowledge_documents (
            id TEXT PRIMARY KEY,
            tenant_id TEXT NOT NULL,
            title TEXT NOT NULL,
            category TEXT NOT NULL,
            file_type TEXT DEFAULT 'pdf',
            source_path TEXT,
            content_text TEXT,
            created_at TEXT,
            FOREIGN KEY (tenant_id) REFERENCES tenants(id)
        )
    """)

    # 4. Knowledge Chunks with Vector Embedding storage
    c.execute("""
        CREATE TABLE IF NOT EXISTS knowledge_chunks (
            id TEXT PRIMARY KEY,
            tenant_id TEXT NOT NULL,
            document_id TEXT NOT NULL,
            chunk_index INTEGER NOT NULL,
            category TEXT NOT NULL,
            chunk_text TEXT NOT NULL,
            embedding_json TEXT,
            created_at TEXT,
            FOREIGN KEY (tenant_id) REFERENCES tenants(id),
            FOREIGN KEY (document_id) REFERENCES knowledge_documents(id)
        )
    """)

    # 5. Versioned Quotes & Proposals
    c.execute("""
        CREATE TABLE IF NOT EXISTS quotes (
            id TEXT PRIMARY KEY,
            tenant_id TEXT NOT NULL,
            contact_wa_id TEXT NOT NULL,
            client_name TEXT,
            package_name TEXT NOT NULL,
            base_price REAL NOT NULL,
            extras_json TEXT,
            total_price REAL NOT NULL,
            status TEXT DEFAULT 'sent',
            valid_until TEXT,
            pdf_path TEXT,
            created_at TEXT,
            FOREIGN KEY (tenant_id) REFERENCES tenants(id)
        )
    """)

    # 6. Automations Engine
    c.execute("""
        CREATE TABLE IF NOT EXISTS automations (
            id TEXT PRIMARY KEY,
            tenant_id TEXT NOT NULL,
            name TEXT NOT NULL,
            event_trigger TEXT NOT NULL,
            channel TEXT DEFAULT 'whatsapp',
            delay_minutes INTEGER DEFAULT 0,
            is_active INTEGER DEFAULT 1,
            template_text TEXT,
            created_at TEXT,
            FOREIGN KEY (tenant_id) REFERENCES tenants(id)
        )
    """)

    # 7. Audit Logs for Compliance and Execution Tracking
    c.execute("""
        CREATE TABLE IF NOT EXISTS audit_logs (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            tenant_id TEXT,
            actor TEXT,
            action TEXT NOT NULL,
            details TEXT,
            created_at TEXT
        )
    """)

    # Ensure waiting_queue has wa_id column for compatibility
    try:
        c.execute("ALTER TABLE waiting_queue ADD COLUMN wa_id TEXT")
        c.execute("UPDATE waiting_queue SET wa_id = client_phone WHERE wa_id IS NULL")
    except Exception:
        pass

    # Seed Default Tenant #1: Gustavo Alves Fotografia (preserving existing studio data)
    c.execute("SELECT id FROM tenants WHERE id = ?", (DEFAULT_TENANT_ID,))
    if not c.fetchone():
        # Check if existing studios table has data to copy over
        c.execute("SELECT * FROM studios WHERE id = ?", (DEFAULT_TENANT_ID,))
        st = c.fetchone()
        now = datetime.now().isoformat()
        if st:
            c.execute("""
                INSERT INTO tenants (
                    id, name, photographer_name, secretary_name,
                    phone_number, whatsapp_phone_number_id, waba_id,
                    instagram_username, mode, status, dashboard_token, created_at
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """, (
                st["id"],
                st["studio_name"] or "Gustavo Alves Fotografia",
                st["photographer_name"] or "Gustavo Alves",
                st["secretary_name"] or "Bruna",
                None,
                st["phone_number_id"],
                st["waba_id"],
                "@gustavoalvsfotografia",
                st["mode"] or "NORMAL",
                st["status"] or "ACTIVE",
                st["dashboard_token"] or "painel-seguro-studio-2026",
                st["created_at"] or now,
            ))
        else:
            c.execute("""
                INSERT INTO tenants (
                    id, name, photographer_name, secretary_name,
                    instagram_username, mode, status, dashboard_token, created_at
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
            """, (
                DEFAULT_TENANT_ID,
                "Gustavo Alves Fotografia",
                "Gustavo Alves",
                "Bruna",
                "@gustavoalvsfotografia",
                "DND",
                "ACTIVE",
                "painel-seguro-studio-2026",
                now,
            ))

    # Seed Default Agent Config for Gustavo Alves Fotografia
    c.execute("SELECT tenant_id FROM agent_configs WHERE tenant_id = ?", (DEFAULT_TENANT_ID,))
    if not c.fetchone():
        now = datetime.now().isoformat()
        default_packages = [
            {
                "id": "essencial",
                "nome": "Essencial",
                "preco": 7500.0,
                "duracao_horas": 9,
                "fotografos": 2,
                "qtd_fotos": "800+ fotos tratadas",
                "descricao": "9h de cobertura, 2 fotógrafos, 800+ fotos tratadas em alta resolução, galeria online por 60 dias."
            },
            {
                "id": "premium",
                "nome": "Premium",
                "preco": 8800.0,
                "duracao_horas": 10,
                "fotografos": 2,
                "qtd_fotos": "1000+ fotos tratadas",
                "descricao": "10h de cobertura, 1.000+ fotos tratadas + Ensaio Pré-casamento (2h com 40 fotos). Mais contratado."
            },
            {
                "id": "black",
                "nome": "Black",
                "preco": 11350.0,
                "duracao_horas": 10,
                "fotografos": 3,
                "qtd_fotos": "2000+ fotos tratadas",
                "descricao": "10h de cobertura, 2.000+ fotos tratadas, casamento civil incluso, Pré-casamento (3h), 3 fotógrafos (1 dedicado para decoração/família), quadro 25x30 e foto 10x15."
            }
        ]
        default_extras = {
            "pre_wedding_avulso": 1500.0,
            "civil_avulso": 800.0,
            "hora_extra": 1000.0,
            "fotografo_extra": 1000.0,
            "pacote_3h": 2250.0,
            "entrega_expressa": 1500.0,
            "album_25x30_caixa": 4950.0
        }
        packages_payload = {
            "pacotes": default_packages,
            "extras": default_extras
        }
        c.execute("""
            INSERT INTO agent_configs (
                tenant_id, agent_name, personality, model_name,
                temperature, max_output_tokens, packages_json,
                specialties, allowed_tools, updated_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        """, (
            DEFAULT_TENANT_ID,
            "Bruna",
            "Consultora comercial acolhedora, objetiva e transparente. Nunca inventa preços ou disponibilidade.",
            "gemini-1.5-flash",
            0.4,
            800,
            json.dumps(packages_payload, ensure_ascii=False),
            "Casamentos, Gestantes, Ensaios de Família, Eventos Sociais",
            json.dumps(["consultar_pacotes", "calcular_orcamento", "consultar_disponibilidade", "reservar_horario", "buscar_na_base"]),
            now
        ))

    conn.commit()


def get_tenant(conn: sqlite3.Connection, tenant_id: str = DEFAULT_TENANT_ID) -> Optional[Dict[str, Any]]:
    """Retrieves tenant profile by ID."""
    c = conn.cursor()
    c.execute("SELECT * FROM tenants WHERE id = ?", (tenant_id,))
    row = c.fetchone()
    if not row:
        c.execute("SELECT * FROM tenants WHERE id = ?", (DEFAULT_TENANT_ID,))
        row = c.fetchone()
    return dict(row) if row else None


def list_all_tenants(conn: sqlite3.Connection) -> List[Dict[str, Any]]:
    """Lists all registered photographer tenants."""
    c = conn.cursor()
    c.execute("SELECT * FROM tenants ORDER BY created_at DESC")
    return [dict(r) for r in c.fetchall()]


def create_tenant(conn: sqlite3.Connection, tenant_data: Dict[str, Any]) -> Dict[str, Any]:
    """Creates a new isolated photographer tenant."""
    c = conn.cursor()
    tenant_id = tenant_data.get("id") or f"tenant-{uuid.uuid4().hex[:8]}"
    now = datetime.now().isoformat()

    c.execute("""
        INSERT INTO tenants (
            id, name, photographer_name, secretary_name,
            phone_number, whatsapp_phone_number_id, instagram_username,
            mode, status, dashboard_token, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    """, (
        tenant_id,
        tenant_data.get("name", "Novo Estúdio"),
        tenant_data.get("photographer_name", "Fotógrafo"),
        tenant_data.get("secretary_name", "Assistente"),
        tenant_data.get("phone_number"),
        tenant_data.get("whatsapp_phone_number_id"),
        tenant_data.get("instagram_username"),
        tenant_data.get("mode", "NORMAL"),
        tenant_data.get("status", "ACTIVE"),
        tenant_data.get("dashboard_token") or f"token-{uuid.uuid4().hex[:12]}",
        now
    ))

    # Initialize default agent config for new tenant
    c.execute("""
        INSERT INTO agent_configs (
            tenant_id, agent_name, personality, model_name,
            temperature, max_output_tokens, packages_json,
            specialties, allowed_tools, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    """, (
        tenant_id,
        tenant_data.get("secretary_name", "Assistente"),
        "Consultora comercial simpática, prestativa e focada em qualificar o cliente.",
        "gemini-1.5-flash",
        0.4,
        800,
        tenant_data.get("packages_json") or "{}",
        "Fotografia em Geral",
        json.dumps(["consultar_pacotes", "calcular_orcamento", "consultar_disponibilidade", "reservar_horario"]),
        now
    ))

    conn.commit()
    return get_tenant(conn, tenant_id)


def get_agent_config(conn: sqlite3.Connection, tenant_id: str = DEFAULT_TENANT_ID) -> Dict[str, Any]:
    """Retrieves agent configuration for a specific tenant."""
    c = conn.cursor()
    c.execute("SELECT * FROM agent_configs WHERE tenant_id = ?", (tenant_id,))
    row = c.fetchone()
    if not row:
        c.execute("SELECT * FROM agent_configs WHERE tenant_id = ?", (DEFAULT_TENANT_ID,))
        row = c.fetchone()
    return dict(row) if row else {}


def update_agent_config(conn: sqlite3.Connection, tenant_id: str, config_updates: Dict[str, Any]) -> bool:
    """Updates agent prompt, parameters, or packages for a specific tenant."""
    c = conn.cursor()
    now = datetime.now().isoformat()
    fields = []
    values = []
    for k, v in config_updates.items():
        if k in ("agent_name", "personality", "model_name", "temperature", "max_output_tokens", "system_prompt", "packages_json", "specialties", "allowed_tools"):
            fields.append(f"{k} = ?")
            values.append(v)
    if not fields:
        return False
    fields.append("updated_at = ?")
    values.append(now)
    values.append(tenant_id)
    c.execute(f"UPDATE agent_configs SET {', '.join(fields)} WHERE tenant_id = ?", tuple(values))
    conn.commit()
    return True
