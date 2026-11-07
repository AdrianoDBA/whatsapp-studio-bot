# CLAUDE.md — lib/knowledge

## O que essa pasta faz

Faz o agente responder **com os documentos do time** em vez de só com o que
está nas instruções dele.

O caminho inteiro, em uma frase: o arquivo entra → vira texto → o texto vira
pedaços → cada pedaço vira uma lista de 1536 números que representa o
**significado** dele → na hora da pergunta, o banco acha os pedaços mais
parecidos e entrega pro modelo.

```
mime.ts      "esse arquivo é mesmo o que ele diz que é?"  (magic bytes)
extract/     PDF e texto → string                          (unpdf mora aqui, só aqui)
chunk.ts     string → pedaços de ~1.000 letras            (PURO, tem teste)
embed.ts     pedaços → vetores                             (fala com o provedor)
ingest.ts    junta tudo e grava                            (NUNCA lança)
search.ts    pergunta → trechos                            (é o que a ferramenta usa)
storage.ts   o balde `knowledge-docs`
queries.ts   o que as telas mostram
actions.ts   "use server" — as 6 funções do servidor (subir/apagar documento,
             testar de novo, colar texto, link assinado, testar busca — nunca
             criar/editar base: isso nasce de arquivo, ver `blueprint.ts`)
schemas.ts   Zod de tudo que entra                         (PURO)
types.ts     a casa dos tipos                              (PURO)
```

## As oito regras que não se negociam

### 1. A dimensão é 1536, e isso é o TIPO da coluna

`document_chunks.embedding` é `vector(1536)`. Não é configuração, não é
constante ajustável. Modelo de embedding que nasce com outro tamanho é
**truncado no pedido** (`opcoesDeEmbedding` em `lib/ai/providers.ts`), e
`embed.ts` confere o tamanho **antes** de gravar — porque o erro do Postgres pra
vetor errado não diz nada pra um leigo.

### 2. O modelo de embedding é escolhido na CRIAÇÃO da base e congelado

Gatilho `freeze_knowledge_base_slug` no banco. Motivo: metade dos trechos lidos
por um modelo e metade por outro faz a busca devolver **trecho aleatório**, sem
erro nenhum aparecendo — e não tem conserto sem reindexar tudo.

Base nasce de arquivo (`lib/knowledge/blueprint.ts` + `lib/seed/registro.ts`) —
não existe tela que crie uma. Por isso, hoje, **"crie outra base e suba os
arquivos de novo" quer dizer declarar outra `KnowledgeBaseBlueprint` no
arquivo, com outro apelido**, e rodar `npm run semear` (ou esperar o próximo
workspace nascer) pra ela existir de verdade. O rodapé de
`conhecimento/[slug]/page.tsx` diz isso com essas palavras.

`search.ts` tem a segunda camada disso: buscando em "todas as bases", ela só
varre as bases que usam **o mesmo modelo da primeira**.

### 3. `ingest.ts` NUNCA lança. Nunca.

Toda falha vira `documents.status = 'failed'` com uma frase em português que a
tela mostra crua. Exceção vazando de lá deixa o documento parado em
"Processando" pra sempre, e o botão "Tentar de novo" perde o sentido.

### 3b. INDEXAR GASTA DINHEIRO, e por isso respeita o teto de gasto

Quem lê o arquivo pra deixar ele pesquisável é a IA, e ela cobra por isso. Se a
indexação ficasse de fora do teto, o teto teria um buraco do tamanho de um PDF.

Duas consequências, e as duas já estão no código:

1. **`ingest.ts` confere o teto no passo 1b**, ANTES de marcar "processando" —
   documento que nem começou a ser lido não pode ficar preso em "Lendo...". A
   frase que a tela mostra é a da audiência `documento`
   (`budgetBlockedMessageFromStatus(teto, "documento")`), e ela diz, com essas
   palavras, que **indexar também gasta** — quase ninguém sabe disso.
2. **`finish_document_indexing` soma `embed_cost_micros` no medidor**, na mesma
   transação que marca o documento como pronto, em coluna própria
   (`org_ai_spend.embedding_micros`). É por isso que a tela de Limites consegue
   dizer "US$ 2,90 de agentes · US$ 0,57 de indexar documentos".

⚠️ **Consequência conhecida no "Tentar de novo":** `queue_document` já apagou os
trechos antigos antes de a conferência acontecer, então um documento que esbarra
no teto nessa hora fica sem índice até alguém tentar de novo. É o mesmo que
acontece com qualquer outra falha de releitura. Ver `lib/limits/CLAUDE.md`.

### 4. ARQUIVO vai pela fila; TEXTO COLADO roda na hora — e o endereço do arquivo viaja junto

Um PDF de 50 páginas vira dezenas de chamadas de embedding em série, e o proxy
do EasyPanel corta requisição parada em ~60 s. Por isso **arquivo enviado é
trabalho de fila**. Texto colado já chega pronto na linha do documento e
continua sendo lido dentro da própria requisição.

⚠️ **E aqui está a parte que quebra se alguém mexer sem ler.** A ponte da
automação **não serve Storage** (regra R5 do contrato do bloco 2): o trabalhador
NÃO consegue baixar nada do balde. Quem faz o meio de campo é a função do
servidor, que é o único ponto do caminho com sessão de gente de verdade:

```
uploadDocumentAction  →  urlAssinada(caminho, SEGUNDOS_DO_LINK_DA_FILA)
                      →  enqueue_document_job(documento, endereço)
                                                          ↓  jobs.payload
trabalhador           →  processarDocumento({ downloadUrl })
                      →  baixarDeUrl()   ← `fetch` comum, não sabe o que é bucket
```

**Isso já falhou de verdade.** A fila entrou numa migration sem o endereço, e
TODO arquivo enviado passou a morrer com "Não achei mais o arquivo original
desse documento". Os 719 testes continuaram verdes — só apareceu subindo um
arquivo no navegador.

Duas coisas que seguem valendo:

- `baixarDeUrl` **só aceita endereço do próprio Supabase** e recusa
  redirecionamento. O endereço vem do banco, e "veio do banco" não é "é seguro".
- Os tetos de `chunk.ts` (300 mil letras, 900 pedaços, lote de 32) continuam
  existindo — agora pela memória do container, não mais pelo corte de 60 s.

### 5. O `id` do documento é sorteado no TypeScript, ANTES do insert

O caminho no balde é `{org}/{base}/{documento}.{ext}`, e `documents` **não tem
`grant update`** pra quem está logado. Não existe "insere agora, preenche o
caminho depois": `crypto.randomUUID()` e o `storage_path` vão no **mesmo**
insert. Está escrito também na migration.

### 6. `buscar-na-base.ts` é PURO — só `zod` e `defineTool`

`lib/agents/tools/index.ts` é importado por componente com `"use client"` (a
bolha do chat pega o rótulo em `getTool(id)?.label`). Importar
`@/lib/knowledge/search` dentro da ferramenta arrastaria o cliente do Supabase e
o cofre pro lado do navegador, e o build quebra com uma mensagem que não aponta
pra lá. A busca chega por **`ctx.knowledge`**.

### 7. `ctx.db.from("document_chunks").select()` traz o vetor inteiro

São ~20 KB por linha. Cinco linhas já passam do teto de 8.000 caracteres de
resposta de ferramenta. **Pra procurar trecho use `ctx.knowledge.search()`**; o
acesso direto existe só pra CONTAR. Tem comentário gritado em
`lib/agents/tool-context.ts`.

### 8. O orçamento de caracteres da ferramenta

`tool-runtime.ts` **troca a resposta inteira** por uma falha acima de 8.000
caracteres — e o agente não diz "passei do tamanho", ele diz que não achou nada.
Por isso `buscar-na-base.ts` tem teto de 5 trechos, corte de 900 letras por
trecho e um orçamento somado de 5.200. `tests/knowledge-tool.test.ts` prova o
pior caso. **Mexer nesses números sem rodar esse teste quebra a ferramenta em
silêncio.**

## A busca também roda DENTRO de uma automação

Um agente disparado por agendamento ou webhook roda sem ninguém logado, e o
transporte dele é a ponte de `lib/automation/postgrest-bridge.ts`. A busca
continua funcionando ali porque `match_document_chunks` está na lista fechada de
funções da ponte, com os cinco argumentos certos.

Duas consequências:

1. **Mexeu na assinatura de `match_document_chunks`?** Mexa junto em
   `FUNCOES_DA_PONTE` / `FORMA_DA_FUNCAO`. Esquecer não quebra o painel —
   quebra só a automação, de madrugada.
2. **A INGESTÃO DE ARQUIVO roda pela fila** (regra 4 acima), mas o trabalhador
   nunca fala com o Storage: o endereço do arquivo é gerado pela função do
   servidor e viaja dentro do trabalho. Texto colado continua sendo lido na
   hora, pela tela.

## A armadilha da Anthropic (leia antes de "melhorar" o catálogo)

A Anthropic **não tem** serviço de embedding. Um workspace com só essa chave
conversa com agente normalmente e **não indexa nada**.

(O OpenRouter **repassa** embedding, sim — `/embeddings`, 1536 dimensões,
conferido com chave de verdade. Ele é o caminho recomendado justamente por isso:
uma chave só serve pros agentes e pra ler os documentos. O catálogo de modelos
dele não lista modelo de embedding, e é essa lista que engana quem for conferir.)

Mitigado em dois lugares, e os dois precisam continuar existindo:

1. `getEmbeddingReadiness` + `EmbeddingKeyCard`, no topo da tela de
   Conhecimento — avisa quem administra ANTES de existir qualquer documento pra
   subir. Não é mais um botão de criar que nasce desligado (base não tem botão
   de criar nenhum); é um aviso simples, com a frase explicando e um link pra
   cadastrar a chave;
2. se escapar, `resolveEmbeddingModel` lança `AiConfigError` de código
   `provedor-sem-embedding`, e o documento vai pra "Falhou" com a **mesma
   frase** (ela mora em `textoAjudaEmbedding()`, num lugar só).

**Nunca aparece "model not found" pro aluno.**

## Dinheiro

- `documents.embed_cost_micros` é **micro-dólar inteiro**. `null` = preço
  desconhecido; `0` = custou zero mesmo. `formatUsdFromMicros(null)` escreve
  "preço desconhecido", nunca "US$ 0,00".
- **Um único lote sem preço deixa o total do documento `null`.** Somar como zero
  mostraria menos do que o real.
- **O custo de INDEXAR entra no teto de gasto do workspace** (regra 3b): a mesma
  transação que marca o documento como pronto soma `embed_cost_micros` em
  `org_ai_spend.embedding_micros`. Documento sem preço conhecido soma **zero** e
  é contado à parte em `unpriced_documents` — nunca como zero disfarçado.
- **O custo do embedding da PERGUNTA não entra no rastro da execução.**
  `recordToolStep` grava `cost_micros: 0` fixo ("ferramenta não gasta token de
  modelo") e a nossa gasta ~1 micro-dólar por busca. Decisão consciente do
  contrato (risco 24); o dinheiro de verdade — indexar — está em
  `documents.embed_tokens` / `embed_cost_micros`. **Reabrir** se um dia entrar
  reranking ou embedding caro.

## O plano B do PDF (risco 7 do contrato)

`unpdf` é a única dependência npm nova da onda 5, e ela vive **num arquivo só**:
`extract/pdf.ts`. Se ela não subir no container:

1. apague `lib/knowledge/extract/pdf.ts`;
2. tire `"application/pdf"` de `KNOWLEDGE_ACCEPTED_MIMES` (`mime.ts`);
3. tire do `allowed_mime_types` do bucket, na migration;
4. a tela passa a dizer "por enquanto aceito .txt, .md e .csv — abra o PDF e
   cole o texto na aba ao lado".

Nenhum outro arquivo muda. A aba "Colar texto" existe exatamente pra o PDF nunca
ser um bloqueio duro.

## Números que andam juntos (mudou um, confira os outros)

| O que | Onde |
|---|---|
| 5 MB | `KNOWLEDGE_MAX_BYTES` · `file_size_limit` do bucket · texto da tela |
| 6 MB | `bodySizeLimit` do `next.config.ts` (tem que ser MAIOR que os 5 MB) |
| 8000 letras por pedaço | `CHUNK_MAX_CHARS` · check `document_chunks_content_len` |
| 300 mil letras | `MAX_CHARS_POR_DOCUMENTO` · check `documents_content_len` · Zod |
| 1536 | `dimensions` do catálogo · tipo da coluna · `embedding_dimensions` |
| `openrouter:openai/text-embedding-3-small` | `DEFAULT_EMBEDDING_MODEL_ID` · `default` da coluna |
| 1 hora do link da fila | `SEGUNDOS_DO_LINK_DA_FILA` (`storage.ts`) · a espera máxima da fila |
| 32 por lote | `LOTE_EMBEDDING` (o teto de `append_document_chunks` é 300) |

## Onde tem teste, e o que ele prova

- `tests/knowledge-chunk.test.ts` — o recorte. Prova que **nenhuma letra do
  documento se perde**, que `seq` não pula, que a sobreposição existe e que
  texto sem espaço nenhum não trava o laço.
- `tests/knowledge-org-scope.test.ts` — **isolamento entre workspaces na
  busca**, inclusive com um pedaço plantado (org B, base do A) e com duas bases
  de mesmo apelido em workspaces diferentes.
- `tests/knowledge-mime.test.ts` — binário renomeado pra `.txt` é recusado; PDF
  chamado `.txt` é reconhecido.
- `tests/knowledge-embeddings.test.ts` — catálogo, dimensão e a regra do `null`.
- `tests/knowledge-tool.test.ts` — o orçamento de caracteres da ferramenta.
- `tests/automation-tools-supported.test.ts` — que `buscar-na-base.ts` (e
  qualquer ferramenta nova) cabe no que a ponte traduz.

## Quando estiver perdido

Leia `search.ts` primeiro: ele é o arquivo que amarra tudo (base → modelo →
vetor → função do banco → trechos) e é o único caminho que o agente usa.
