-- ============================================================================
-- O padrão da base de conhecimento passa a ser o embedding via OpenRouter.
--
-- POR QUÊ: o OpenRouter FAZ embedding — o endpoint /embeddings responde e
-- devolve 1536 dimensões, que é exatamente o tipo da coluna. O catálogo público
-- deles (420 modelos) não lista nenhum modelo de embedding, o que deu a
-- impressão contrária e fez o template tratar OpenRouter como "não serve pra
-- documento". Conferido ao vivo em 21/08/2026.
--
-- Isso importa pro aluno: a chave do OpenRouter é a que o template recomenda
-- pra começar, justamente por ser UMA chave só. Com ela fora do padrão, quem
-- seguisse a recomendação ficaria sem base de conhecimento.
--
-- ⚠️ Este valor tem que ser o MESMO de `DEFAULT_EMBEDDING_MODEL_ID` em
-- lib/ai/embeddings.ts — existe teste que confere os dois.
-- ============================================================================

alter table public.knowledge_bases
  alter column embedding_model set default 'openrouter:openai/text-embedding-3-small';
