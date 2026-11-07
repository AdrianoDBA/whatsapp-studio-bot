import json
import logging
import re
import sqlite3
import uuid
from datetime import datetime
from typing import Dict, Any, List, Optional

logger = logging.getLogger("photoagent.rag")

# Stopwords em português para filtrar na busca semântica/léxica
PORTUGUESE_STOPWORDS = {
    "o", "a", "os", "as", "um", "uma", "uns", "umas", "de", "do", "da", "dos", "das",
    "em", "no", "na", "nos", "nas", "por", "para", "com", "sem", "sob", "sobre",
    "que", "se", "ou", "e", "ao", "aos", "você", "voce", "vocês", "voces", "qual",
    "quais", "quanto", "quantos", "onde", "quando", "como", "quem", "ter", "tem",
    "temos", "têm", "fazer", "faz", "fazem", "ser", "é", "são", "sao", "era", "está",
    "esta", "estão", "estao", "gostaria", "queria", "quero", "saber", "favor"
}

# Prompt injection patterns to sanitize from ingested user documents
INJECTION_PATTERNS = [
    r"ignore\s+(all\s+)?(previous|prior)\s+instructions",
    r"you\s+are\s+now\s+in\s+developer\s+mode",
    r"system\s+prompt\s+override",
    r"dan\s+mode",
    r"jailbreak",
    r"give\s+free\s+discounts",
    r"set\s+price\s+to\s+0",
]


def sanitize_rag_chunk(text: str) -> str:
    """Sanitizes text chunks to prevent indirect prompt injection."""
    clean = text
    for pat in INJECTION_PATTERNS:
        clean = re.sub(pat, "[CONTEÚDO_REMOVIDO_POR_SEGURANÇA]", clean, flags=re.IGNORECASE)
    return clean.strip()


def chunk_text(text: str, chunk_size: int = 500, overlap: int = 80) -> List[str]:
    """Splits document text into overlapping chunks for semantic retrieval."""
    if not text:
        return []
    words = text.split()
    if len(words) <= chunk_size:
        return [text]

    chunks = []
    i = 0
    while i < len(words):
        chunk = " ".join(words[i:i + chunk_size])
        chunks.append(chunk)
        i += chunk_size - overlap
    return chunks


def ingest_document(
    conn: sqlite3.Connection,
    tenant_id: str,
    title: str,
    category: str,
    content_text: str,
    file_type: str = "pdf",
    source_path: Optional[str] = None
) -> str:
    """
    Ingests a document into the tenant's isolated knowledge base,
    chunks it, sanitizes it, and indexes it for hybrid search.
    """
    c = conn.cursor()
    doc_id = f"doc_{uuid.uuid4().hex[:10]}"
    now = datetime.now().isoformat()

    c.execute("""
        INSERT INTO knowledge_documents (
            id, tenant_id, title, category, file_type, source_path, content_text, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    """, (doc_id, tenant_id, title, category, file_type, source_path, content_text, now))

    chunks = chunk_text(content_text, chunk_size=300, overlap=50)
    for idx, raw_chunk in enumerate(chunks):
        chunk_clean = sanitize_rag_chunk(raw_chunk)
        chunk_id = f"chk_{doc_id}_{idx}"
        c.execute("""
            INSERT INTO knowledge_chunks (
                id, tenant_id, document_id, chunk_index, category, chunk_text, embedding_json, created_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        """, (chunk_id, tenant_id, doc_id, idx, category, chunk_clean, None, now))

    conn.commit()
    logger.info(f"[RAG] Documento '{title}' ({doc_id}) indexado com {len(chunks)} chunks para tenant {tenant_id}.")
    return doc_id


def search_knowledge_base(
    conn: sqlite3.Connection,
    tenant_id: str,
    query: str,
    category: Optional[str] = None,
    limit: int = 3
) -> List[Dict[str, Any]]:
    """
    Hybrid semantic/lexical search with tenant isolation.
    Uses stopword filtering and relevance scoring to prevent hallucinations.
    Returns sanitized chunks wrapped in strict reference tags.
    """
    c = conn.cursor()
    # Limpa pontuação e extrai termos
    cleaned_query = re.sub(r"[^\w\s]", " ", query.lower())
    all_words = [w.strip() for w in cleaned_query.split() if len(w.strip()) > 1]
    filtered_terms = [w for w in all_words if w not in PORTUGUESE_STOPWORDS and len(w) > 2]
    terms = filtered_terms if filtered_terms else all_words
    if not terms:
        return []

    sql = """
        SELECT c.id, c.category, c.chunk_text, d.title
        FROM knowledge_chunks c
        JOIN knowledge_documents d ON c.document_id = d.id
        WHERE (c.tenant_id = ? OR c.tenant_id = 'studio-principal')
    """
    params = [tenant_id]

    if category:
        sql += " AND c.category = ?"
        params.append(category)

    c.execute(sql, tuple(params))
    rows = c.fetchall()

    # Pontuação por termos encontrados no chunk
    scored_results = []
    total_query_terms = len(terms)

    for r in rows:
        chunk_lower = r["chunk_text"].lower()
        matched_count = sum(1 for t in terms if t in chunk_lower)
        if matched_count == 0:
            continue

        match_ratio = matched_count / total_query_terms
        # Critério de relevância estrito contra alucinações:
        # Se query tem 2 ou mais termos significativos, exige pelo menos 2 termos ou >= 50% de match
        if total_query_terms >= 2:
            if matched_count < 2 and match_ratio < 0.5:
                continue

        scored_results.append({
            "chunk_id": r["id"],
            "title": r["title"],
            "category": r["category"],
            "score": matched_count,
            "text": f"<DADO_REFERENCIA_FOTOGRAFO>{r['chunk_text']}</DADO_REFERENCIA_FOTOGRAFO>"
        })

    # Ordena por relevância (maior número de termos correspondentes primeiro)
    scored_results.sort(key=lambda x: x["score"], reverse=True)
    return scored_results[:limit]


def seed_default_gustavo_proposal(conn: sqlite3.Connection, tenant_id: str = "studio-principal"):
    """
    Ingests the official truth from Gustavo Alves Proposal into the RAG base
    if not already present.
    """
    c = conn.cursor()
    c.execute("SELECT id FROM knowledge_documents WHERE tenant_id = ? AND title = 'Proposta Oficial Gustavo Alves'", (tenant_id,))
    if c.fetchone():
        return

    proposal_text = """
    PROPOSTA COMERCIAL GUSTAVO ALVES FOTOGRAFIA
    
    1. Pacote Essencial - R$ 7.500
    - Cobertura de 09 horas contínuas de evento.
    - 2 Fotógrafos experientes presentes na cerimônia e recepção.
    - 800+ fotos tratadas com correção de cor e luz em alta resolução.
    - Galeria online protegida por senha disponível por 60 dias para download dos convidados.
    
    2. Pacote Premium - R$ 8.800 (Mais Contratado)
    - Cobertura de 10 horas contínuas de evento.
    - 2 Fotógrafos experientes presentes.
    - 1.000+ fotos tratadas com padrão premium em alta resolução.
    - Galeria online por 60 dias.
    - Ensaio Pré-casamento (Pré-wedding) incluso: 2 horas de sessão externa com 40 fotos tratadas.
    
    3. Pacote Black - R$ 11.350
    - Cobertura de 10 horas de evento.
    - 3 Fotógrafos profissionais (sendo 1 fotógrafo dedicado exclusivamente à decoração, mesa de doces e fotos de família).
    - 2.000+ fotos tratadas em altíssima resolução.
    - Casamento Civil incluso (cobertura no cartório em data prévia).
    - Ensaio Pré-casamento completo de 3 horas com 60 fotos tratadas.
    - 1 Quadro com moldura fina tamanho 25x30 cm + foto 10x15 cm para porta-retrato.
    
    4. Serviços Extras e Opcionais
    - Ensaio Pré-wedding avulso: R$ 1.500
    - Cobertura de Casamento Civil avulso: R$ 800
    - Hora extra de cobertura no evento: R$ 1.000 / hora
    - Fotógrafo adicional extra: R$ 1.000
    - Pacote Mini Wedding / Ensaio Especial 3 horas: R$ 2.250
    - Taxa de entrega expressa (fotos tratadas em 7 dias): R$ 1.500
    - Álbum encadernado 25x30 cm na caixa com 60 páginas: R$ 4.950
    
    5. Políticas e Prazos
    - Reserva da data mediante contrato e entrada de 30%.
    - Saldo parcelado sem juros via Pix ou cartão até 10 dias antes do casamento.
    - Prazo padrão de entrega da prévia: 48 horas após o casamento.
    - Prazo de entrega de todas as fotos na galeria: 45 dias úteis.
    - Política de reagendamento: permitido com até 30 dias de antecedência sem custo adicional caso a nova data esteja disponível.
    """

    ingest_document(
        conn=conn,
        tenant_id=tenant_id,
        title="Proposta Oficial Gustavo Alves",
        category="Pacotes e Preços",
        content_text=proposal_text,
        file_type="pdf",
        source_path="/mnt/data/Proposta_-_Gustavo_Alves.pdf"
    )
