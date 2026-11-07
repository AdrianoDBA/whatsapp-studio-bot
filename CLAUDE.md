# CLAUDE.md — Elite da IA - Template

Esse arquivo orienta o Claude Code quando ele trabalha neste projeto.

## O que é esse projeto

Template SaaS multi-tenant em Next.js 16 + Supabase. Feito pra alunos do curso de Claude Code (público **leigo**) criarem seus próprios produtos (agentes IA, CRM, ERP, etc.).

## Stack

- **Framework:** Next.js 16 (App Router) + TypeScript strict
- **Banco:** Supabase Cloud (PostgreSQL + RLS + Auth + Storage)
- **UI:** shadcn/ui (base-nova preset, sobre `@base-ui/react`) + Tailwind CSS 4 (CSS variables, tema dark com accent verde Kawasaki)
- **Forms:** React Hook Form + Zod + componentes shadcn Form (wrapper em `components/forms/`)
- **Data:** Server Components + Server Actions (sem TanStack Query nesta versão)
- **Charts:** Recharts via shadcn/ui Chart
- **Lint/Format:** Biome
- **Package manager:** npm

## Vocabulário leigo (NÃO IGNORE)

O aluno **não codifica**. Toda mensagem visível pra ele em PT-BR coloquial. Jargão técnico SÓ em código e comentários técnicos.

| Em vez de | Use |
|---|---|
| "schema" | "tabela do banco" |
| "Server Action" | "função do servidor" |
| "RSC / Server Component" | "página" |
| "hydration mismatch" | "o servidor mostrou uma coisa e o navegador esperava outra" |
| "TypeError" | "o código tentou usar uma variável que estava vazia" |
| "PostgREST error / RLS denied" | "a regra de segurança do banco bloqueou essa consulta" |

## Como o aluno pede coisas

Aluno fala em PT-BR coloquial em linguagem natural ("quero planejar uma feature de leads", "esse botão não tá funcionando", "revisa o que mudei"). Use as **skills do superpowers** correspondentes:

| Aluno pede... | Use skill |
|---|---|
| Brainstorm/plano antes de codar | `superpowers:brainstorming` + `writing-plans` |
| Construir feature nova | `superpowers:writing-plans` + `executing-plans` |
| Debug / "isso não funciona" | `superpowers:systematic-debugging` |
| Code review do diff | `superpowers:requesting-code-review` |
| Validar que algo funciona (com evidência) | `superpowers:verification-before-completion` |

**Sempre responda em PT-BR coloquial** independente do idioma da skill. Use o vocabulário leigo da próxima seção.

## Convenções

1. **PT-BR em UI / docs / mensagens.** Código (vars, funções, arquivos, tabelas, colunas) em inglês.
2. **Arquivos:** kebab-case. **Componentes React:** PascalCase. **Vars/funções:** camelCase. **Tabelas/colunas:** snake_case.
3. **Toda página em `/app/[orgSlug]/` começa com `requireOrgMember`** (ou `requireOrgRole`). Ver `lib/auth/CLAUDE.md`.
4. **Server Actions retornam `{ ok: true; data?: T } | { ok: false; error: string }`.** Nunca jogue exception sem tratamento.
5. **Padrão de slot do shadcn aqui é `render={<X />}`**, NÃO `asChild`:
   ```tsx
   <Button render={<Link href="/x" />}>Texto</Button>
   ```
6. **Texto de tela que o aluno vai reescrever mora em `config/`, não no JSX.**
   Vale hoje pra página de entrada (`config/landing.config.ts`): quem troca
   aquelas frases é alguém que não programa, e ele não deveria ter que achar a
   palavra certa no meio de 400 linhas de componente. E **o nome do app nunca
   se escreve na mão** — ele vem de `appConfig.name`, senão renomear o app
   deixa o nome velho perdido num canto (foi o que aconteceu na landing).
   `tests/landing-config.test.ts` monta guarda contra as frases que não podem
   voltar: promessa de preço, licença inventada e integração que não existe.

7. **Tela nova que o aluno vai usar ganha uma seção em `docs/`.** O template é
   material de curso: uma feature que só existe no código é uma feature que
   ninguém vai achar. Vale a mesma regra do resto — PT-BR coloquial, zero
   jargão, e **nada de prometer botão que não existe** (se o número mora numa
   função do banco, escreva isso em vez de inventar uma tela de configuração).

## Regras absolutas (violar = bug crítico)

### Banco / segurança
1. **Toda tabela de domínio tem `organization_id`** + RLS habilitada + policies usando `is_org_member` / `has_org_role`. Sem exceção. Ver `lib/supabase/CLAUDE.md`.
2. **NÃO usar `FORCE ROW LEVEL SECURITY`** — com FORCE, as policies valem até pro papel `postgres`, que é quem roda as migrations e o SQL Editor. Lá o `auth.uid()` é nulo, então correção de dado na mão afeta 0 linhas **em silêncio**, e funções `security definer` passam a falhar. `ENABLE` é suficiente.
3. **Helpers RLS (`is_org_member`, `has_org_role`) usam `security definer` + `set row_security = off`** — sem o segundo, recursão infinita. Ver `lib/supabase/CLAUDE.md`.
4. **Variáveis de ambiente só via `lib/env.ts`.** Nunca leia `process.env` direto no código do app. E **nunca crie variável com prefixo `NEXT_PUBLIC_`** — ela é colada dentro do JavaScript no momento do build, então trocar o valor no painel do EasyPanel não teria efeito. O template não usa nenhuma.
5. **Todo input do aluno valida com Zod** antes de tocar banco.
6. **Server Actions NUNCA retornam `error.message` direto** do Postgres/Supabase — traduz pra mensagem leiga e loga server-side com `logError()` de `lib/logger.ts`. Evita vazamento de schema interno.
7. **Uploads validam por MIME (magic bytes)**, não pela extensão do `file.name`.
8. **Aprovação humana antes de migrations destrutivas** (drop column, drop table).
9. **Toda migration tem que poder rodar duas vezes sem quebrar.** O container aplica migrations no boot, então uma migration que falha na segunda execução trava o deploy. Use `if exists` / `if not exists`. Postgres NÃO tem `create policy if not exists` — faça `drop policy if exists` antes do `create policy`; nem `add constraint if not exists` — faça `drop constraint if exists` antes. O critério de verdade **não** é "rodei duas vezes e passou": é **apagar `supabase_migrations.schema_migrations` num banco que já tem tudo e reaplicar a pilha inteira por cima**. É esse o caso que o boot do container faz acontecer.
10. **Nunca APAGUE uma policy de SELECT sem substituir.** Quando o app grava e pede o dado de volta na mesma operação (`.insert().select()`), o banco só devolve a linha se quem gravou também puder lê-la. Sem policy de leitura, criar registro passa a falhar com `violates row-level security`.

#### Exceção fechada à regra 1 (duas tabelas, e só elas)

A regra 1 diz "toda tabela de domínio tem `organization_id`". Duas tabelas
fogem disso **de propósito**, e a lista está fechada:

| Tabela | Por quê | Como fica protegida |
|---|---|---|
| `platform_admins` | é o nível ACIMA de workspace: quem é dono do sistema inteiro | RLS com uma policy de SELECT via `is_platform_admin()`; sem insert/update/delete pra `authenticated` |
| `credentials` | `organization_id` é NULLABLE — nulo quer dizer "chave da plataforma, vale pra todo mundo" | RLS + helper `can_manage_credential()` + `grant select` coluna a coluna (a coluna do embrulho não sai) |

**Não copie esse padrão numa tabela de domínio nova.** Se a sua tabela guarda
dado de um time, ela precisa de `organization_id not null`. Copiar a exceção é
o jeito mais rápido de fazer dado de um workspace aparecer no outro.

### Agentes de IA e chaves de API

10-A. **Ferramenta de agente NUNCA importa cliente de banco cru.** Dentro de `lib/agents/tools/`, o único jeito de tocar no banco é `ctx.db`, que já vem preso ao workspace da execução. `import { createClient } from "@/lib/supabase/server"` ali dentro quebra o `npm run verify` (`tests/agents-tools-no-raw-client.test.ts` monta guarda). Ver `lib/agents/CLAUDE.md`.

10-B. **Nenhuma chave de API chega no navegador.** O mascaramento (`sk-ant-…4f2a`) acontece NO SERVIDOR, a partir de pedaços não-secretos já guardados. Nenhum tipo que vai pra tela carrega a chave inteira. Ver `lib/secrets/CLAUDE.md`.

10-C. **Dinheiro é inteiro, em micro-dólares.** Do catálogo (`lib/ai/catalog.ts`) até `agent_runs.cost_micros`. Nada de float. `null` = preço desconhecido; `0` = custou zero mesmo — e `formatUsdFromMicros(null)` escreve "preço desconhecido", nunca "US$ 0,00".

10-D. **Formatar dinheiro, duração e data mora só em `lib/format.ts`.** Um lugar só, com fuso fixo em São Paulo (senão servidor e navegador escrevem textos diferentes e o React reclama).

10-E. **Tabela nova escopada por org precisa de um bloco em `lib/agents/tool-context.ts`.** Sem ele, nenhuma ferramenta consegue ler/gravar nela — e esquecer vira erro de compilação com o nome que falta, não dado vazando.

10-F. **`ENCRYPTION_KEY` é a 4ª variável obrigatória, e trocar/perder ela apaga todas as chaves de API cadastradas.** São quatro e só quatro no `.env.example`: `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `DATABASE_URL`, `ENCRYPTION_KEY` — nenhuma opcional. Quando ela falta, o `docker-entrypoint.sh` gera uma **temporária**, imprime no registro (log) com a instrução de colar no painel e exporta a marca `ENCRYPTION_KEY_EPHEMERAL=1`; com essa marca o cofre **se recusa a guardar segredo**, senão o aluno cadastraria uma chave que sumiria no reinício seguinte. Não crie variável de chave de API nova: chave de provedor se cadastra pelas telas (`/plataforma/configuracoes` e `/app/[orgSlug]/settings/integracoes`), e as variáveis antigas (`ANTHROPIC_API_KEY`, `OPENAI_API_KEY`, `RESEND_API_KEY`, `EMAIL_FROM`) sobrevivem só como último recurso de compatibilidade.

### Automação, conversa e conhecimento

10-G. **Automação roda "no nome de" alguém que não está logado — e a identidade
NUNCA vem do pedido HTTP.** O corpo de `/api/internal/run-job` carrega **um**
campo: `jobId`. Workspace, agente e `run_as` saem da linha da tabela `jobs`, que
foi gravada por uma função `security definer` do banco. Duas consequências que
mordem quem for mexer:

- **`systemPool()` (papel `postgres`) só em `lib/automation/queue.ts`, e só
  chamando função com nome.** Sem `FORCE ROW LEVEL SECURITY` (regra 2), uma
  consulta solta por ali pularia a regra de segurança do banco inteira. Ler dado
  do aluno é trabalho da **ponte**, que entra como `authenticated`.
- **A ponte fala um subconjunto do PostgREST.** Ferramenta que use um filtro
  fora de `OPERADORES_DA_PONTE` funciona no painel (API de verdade) e **quebra
  na automação**. `tests/automation-tools-supported.test.ts` lê o código de
  `lib/agents/tools/**` e monta guarda. Ver `lib/automation/CLAUDE.md`.

10-H. **A conversa com o agente é DO WORKSPACE, e a tela avisa com essas
palavras.** Todo membro lê; só quem começou escreve; quem administra também
apaga. Não é descuido: `agent_runs` + `agent_run_steps` já guardam a pergunta, a
resposta e o que a ferramenta devolveu, e qualquer membro abre aquilo em
Execuções. Trancar a conversa deixando o rastro aberto prometeria uma
privacidade que o banco não entrega. **Se um dia for pra fechar, fecha nos DOIS
lugares, na mesma migration.** Ver `lib/threads/CLAUDE.md`.

10-I. **Base de conhecimento não reindexa sozinha — o modelo é escolhido na
criação e congelado.** Misturar trechos lidos por dois modelos de embedding faz
a busca devolver **trecho aleatório**, sem erro nenhum aparecendo. Por isso o
gatilho `freeze_knowledge_base_slug` congela `slug`, `embedding_model` e
`embedding_dimensions`, e a saída é **criar outra base e subir os arquivos de
novo** (a tela diz isso em dois lugares). A dimensão 1536 é o **tipo da coluna**
`document_chunks.embedding`, não configuração. Ver `lib/knowledge/CLAUDE.md`.

### Teto de gasto

10-J. **Teto de gasto é em DÓLAR, e o medidor é intocável.** O template não
guarda nem busca cotação: cotação parada faz o teto mentir, e teto que mente é
pior que teto nenhum. `org_ai_spend` **não aceita escrita de ninguém logado**
(sem grant, sem policy) — quem soma é `org_ai_spend_add`, dentro da mesma
transação que fecha a execução. **Apagar execução não devolve saldo.** O teto é
uma **linha de parada**, não uma trava: a última execução atravessa, e quem
limita esse estouro é `max_run_cost_micros` (em memória, sem consultar o banco)
— nunca uma checagem por passo. Os três baldes (token/pessoa/dia,
token/automação/dia, dinheiro/workspace) viram à **meia-noite de Brasília**, por
`public.ai_today()` / `public.ai_month_start()`, nunca por `current_date`. Ver
`lib/limits/CLAUDE.md`.

### O agente que age

10-K. **Agir só acontece por `ctx.acao`.** Ferramenta que importe `lib/email` ou
chame `fetch` direto está errada por construção — e o motivo não é estilo: em
modo ensaio `ctx.acao` não faz nada, e um caminho paralelo agiria de verdade
achando que estava simulando. É a mesma disciplina de `ctx.db` (regra 10-A):
quem protege é não existir outro caminho; o teste é rede.

10-L. **Automação e webhook nascem em ensaio.** O padrão do banco é `'ensaio'` e
quem liga o modo real é uma pessoa, numa tela que diz o que vai passar a
acontecer.

10-M. **Entrega do resultado é passo do trabalho, nunca ferramenta.** O modelo
não decide se entrega, e não pode esquecer.

10-N. **Definição nasce em arquivo; a tela só opera.** Agente, base de
conhecimento, agendamento e webhook são declarados em `lib/seed/registro.ts` e
gravados por `materializarWorkspace`. **Não crie formulário de criação**: ele
vira um segundo dono da verdade, o banco passa a divergir do repositório e nada
acusa — o `npm run semear` seguinte simplesmente não enxerga a linha que o
formulário criou. Tela nova responde "quem faz isso?": se for o aluno
construindo o produto, é arquivo; se for alguém usando o produto pronto, é tela.
Segredo é a única coisa que o arquivo nunca carrega — o token do webhook nasce
sorteado e só é revelado por ação de gente, uma vez.
`tests/sem-telas-de-montagem.test.ts` monta guarda.

10-O. **Tipo novo de coisa declarada NÃO reescreve o algoritmo — declara um
recurso.** O "leia o que já existe, grave o que falta, atualize o que mudou"
mora em `lib/seed/recurso.ts`, escrito uma vez, e é o que faz este template
virar qualquer software: o CRM do aluno declara `PIPELINES` do mesmo jeito que
o produto declara `AGENTES`. **Copiar lógica de leitura/escrita é o erro** —
os dois defeitos que este mecanismo já produziu foram os dois "uma cópia
divergiu das outras" (a base sem `created_by`, que impedia QUALQUER base de
nascer; o agente quase sem `status`, que teria feito a tela prometer um jeito
de aposentar que não funcionava). Omissão não aparece em revisão de diff: o que
não foi escrito não fica destacado em verde. Por isso toda coluna que o INSERT
escreve precisa estar classificada em uma das quatro gavetas (arquivo, só ao
nascer, banco, pessoa) — `colunasNaoClassificadas` reprova no `npm run verify`
com o NOME da coluna solta. Ver `lib/seed/CLAUDE.md`, que tem a receita
completa.

10-P. **Toda coisa declarada precisa de um jeito de ser APOSENTADA, e alguém
tem que aplicar isso.** O materializador nunca apaga (o dublê de teste lança se
alguém chamar `delete`), então a saída é o túmulo: a declaração fica no
arquivo, com `status: "archived"`. Coluna `status` que ninguém confere é pior
que não ter — a tela promete que aposentar faz algo, e não faz. Agente recusa
em 5 lugares; base some da busca e não aceita documento novo; agendamento e
webhook herdam do agente. Tipo novo seu: escreva o teste que prova que
aposentado realmente para.

Ver `lib/seed/CLAUDE.md` (a receita de um tipo novo e a matriz de posse de
coluna), `lib/agents/CLAUDE.md` (o mecanismo de `ctx.acao`) e
`lib/automation/CLAUDE.md` (modo, entrega e webhook síncrono).

### O que chega na mão do aluno

21. **Tudo que está rastreado no git VIAJA — não existe filtro no meio do
    caminho.** O aluno não clona este repositório: ele baixa um zip pela área de
    membros, e esse zip é o **tarball da tag, arquivo por arquivo, sem nada
    sendo apagado**. `CLAUDE.md` (raiz + filhos), `docs/`, `tests/` e os
    comentários vão de propósito — são o material do curso. Três consequências:

    - **rascunho interno fica fora do git.** `docs/superpowers/` (os planos e
      contratos de cada onda) mora no disco e no `.gitignore`.
    - **chave de verdade nunca é commitada** — commitar uma é publicá-la pra
      turma inteira.
    - **CLAUDE.md não descreve pasta que não existe.** Já aconteceu duas vezes
      (`lib/billing/` prometendo Stripe, `lib/messaging/` prometendo WhatsApp:
      um CLAUDE.md e zero código do lado). O Claude Code do aluno lê aquilo como
      verdade e passa a responder sobre uma função que não está lá.

    `tests/entrega-ao-aluno.test.ts` monta guarda nas três.

### Auth
11. **Senhas mínimo 10 caracteres** (definido em `lib/auth/schemas.ts`).
12. **Signup nunca confirma se email já existe** — retorna sucesso genérico (evita user enumeration).
13. **Redirects pós-auth validam o `next` param** contra `//evil.com`, encoded variants (usa `safeNext`).

### React + Next.js
14. **Server vs Client boundary é real.** Hooks (`useState`, `useEffect`, `useTransition`) e event handlers (`onClick`) só funcionam em Client Component (`"use client"` no topo).
15. **Schema Zod com `.default()` quebra tipagem do `useForm`** — não use `.default()` em schemas usados por RHF.
16. **`<Button render={<Link />}>` precisa `nativeButton={false}`** (base-ui pattern).
17. **`page.tsx` é Server.** Componentes interativos vão em `*-form.tsx`, `*-table.tsx` com `"use client"`.

### TypeScript
18. **NUNCA use `any`.** Se não souber o tipo, pergunte ou pesquise.
19. **NUNCA `@ts-ignore` / `@ts-expect-error`** sem comentário explicando.
20. **Tipos do Supabase vêm de `types/supabase.ts`** — após mudar schema, rode `npm run types`.

## Verificação obrigatória antes de dizer "feito"

Toda mudança em código DEVE passar:

```bash
npm run verify     # typecheck + lint + testes, tudo verde
```

Se mexeu em Dockerfile, migration ou variável de ambiente, teste o container de
verdade — não confie só no `npm run dev`:

```bash
docker build -t teste . && docker run --rm -p 8080:80 --env-file .env.local teste
```

Se a feature muda comportamento visível: peça pro aluno abrir e validar, ou use Playwright MCP se disponível. **Não afirme "funciona" sem evidência** — use `superpowers:verification-before-completion`.

Se tocou testes: `npm run test` verde.

## Anti-padrões (PROIBIDO)

- ❌ "Acho que tá funcionando" sem rodar `npm run verify`
- ❌ Try/catch só pra esconder erro
- ❌ Comentar código pra "ver se resolve"
- ❌ Atualizar dependência random pra "ver"
- ❌ Deixar `console.log` no código depois de debugar
- ❌ Mudar 3 coisas pra debugar 1 bug
- ❌ Aplicar fix em produção sem testar em dev
- ❌ Push pra main sem permissão explícita do aluno

## Escalar pro aluno (parar e perguntar)

Pare e devolve a decisão pro aluno quando:
- Decisão de design com múltiplas opções válidas
- Mudança em tabela existente (risco de perder dado)
- Feature precisa de pacote npm grande (Stripe, integrações externas)
- Feature precisa de chave/config externa
- Você fez 3+ tentativas e não convergiu
- O pedido viola alguma regra absoluta acima

**Escalar não é falha — é disciplina.** Bad work > no work.

## Comandos npm

- `npm run dev` — server local em http://localhost:3000
- `npm run build` — build de produção
- `npm run check` — Biome lint + format (com fix)
- `npm run migrate` — cria/atualiza as tabelas do banco (o container também faz isso sozinho ao ligar)
- `npm run types` — regenera `types/supabase.ts` a partir do banco na nuvem
- `npm run types:local` — o mesmo, mas lendo do Supabase que roda em Docker na sua máquina (é o que funciona quando o `.env.local` aponta pra `127.0.0.1`)
- `npm run verify` — typecheck + lint + testes de uma vez
- `npm run test` — testes Vitest
- `npm run worker` — sobe o **segundo processo**, o que faz agendamento e webhook
  rodarem. No container ele já sobe sozinho; no `npm run dev` **não** — se você
  quer testar automação na sua máquina, rode isto num terminal separado, com o
  mesmo `.env.local`
- `npm run semear` — materializa (grava) em workspaces que **já existem** tudo
  que está declarado em `lib/seed/registro.ts`: agente, base de conhecimento,
  agendamento e webhook novos. Workspace novo já nasce com tudo isso sozinho
  (via `createOrganizationAction`); workspace que já existia recebe a
  declaração nova sozinho também, no **próximo deploy** — é o
  `docker-entrypoint.sh` que chama este mesmo comando depois que o site sobe
  (ver o arquivo). Este comando continua existindo pra rodar em dev
  (`npm run dev`) e pra quem quiser forçar agora, sem esperar o deploy.
  Precisa do site no ar — ele fala com `/api/internal/semear`
- `npm run gerar-chave` — sorteia uma `ENCRYPTION_KEY` nova (32 bytes em base64)

## Estrutura

```
app/                              # Rotas Next.js
  (marketing)/                    # Públicas (landing)
  (auth)/                         # Login, signup, reset
  (app)/                          # Autenticado
    onboarding/                   # Criar primeira org
    plataforma/                   # Área do dono do sistema (fora de workspace)
      configuracoes/              # Chaves de API que valem pra todos os workspaces
      gastos/                     # Quanto cada workspace gastou de IA (e o teto que você põe)
    app/[orgSlug]/                # Escopado por org
      dashboard/                # A tela de Início: o que falta configurar + o que aconteceu
      agentes/                    # Lista, ficha de leitura e playground (agente nasce de
                                  # arquivo — sem tela de criar/editar, ver lib/seed/)
        [slug]/conversar/         # A conversa com o agente (resposta ao vivo)
      conhecimento/               # Bases de documentos que o agente consulta
      automacoes/                 # Agendamentos + webhooks (só owner/admin)
      execucoes/                  # Histórico de execuções + rastro passo a passo
      settings/
        integracoes/              # Quem paga a conta da IA neste workspace
        limites/                  # Teto de gasto com IA (owner/admin)
  api/
    chat/                         # O stream da conversa (POST, texto puro no erro)
    webhooks/[endpointId]/        # O endereço secreto que um sistema de fora chama
    internal/run-job/             # SÓ o trabalhador chama, de dentro do container
    internal/semear/              # SÓ scripts/semear.mjs chama, de dentro do container —
                                  # via `npm run semear` na mão, ou sozinho pelo
                                  # docker-entrypoint.sh a cada deploy
    health/                       # Healthcheck do container (olha o batimento)
  auth/callback/                  # OAuth/email callback
lib/
  supabase/                       # Clients + middleware
  auth/                           # Guards + actions + schemas
  orgs/                           # Queries + actions de organizações
  profile/                        # Update profile
  invitations/, members/          # Domínios de convite e gestão de membros
  email/                          # Provider abstrato + adapters
  secrets/                        # Cofre de chaves de API (AES-256-GCM)
  platform/                       # Leituras do nível plataforma (donos do sistema)
  ai/                             # Catálogo de modelos + resolução de provedor
  agents/                         # Motor de agentes + ferramentas + painel
  threads/                        # A conversa: guardar balão e reler histórico
  automation/                     # Fila, agendamento, webhook e a ponte da impersonação
  knowledge/                      # Documento → pedaços → busca por significado
  limits/                         # Teto de gasto com IA (dinheiro, não token)
  seed/                           # O que este produto TEM DENTRO: registro.ts declara
                                  # (agente, base, agendamento, webhook), recurso.ts é o
                                  # MOLDE (o algoritmo, escrito uma vez — é o que faz o
                                  # template virar qualquer software), materializar.ts
                                  # lista os tipos que existem, semear.ts chama a rota
                                  # interna no nome do dono de cada workspace que já existe
  dashboard/                      # As leituras da tela de Início (não lança nunca)
  format.ts                       # Dinheiro/tempo/data em PT-BR (dono único)
components/
  ui/                             # shadcn primitives
  app/                            # Shell (Sidebar, Header, OrgSwitcher...)
  forms/                          # Helpers RHF (TextField)
  providers/                      # ThemeProvider
supabase/
  migrations/                     # Migrations SQL aplicadas em ordem (bootstrap + features novas)
  reset-dev.sql                   # Zera o banco em dev pra reaplicar tudo do zero
types/supabase.ts                 # Tipos gerados do banco
config/
  app.config.ts                   # Nome/branding do app (dono ÚNICO do nome)
  landing.config.ts               # TODO o texto da página de entrada — o aluno mexe só aqui
  nav.config.ts                   # Itens do sidebar
scripts/
  migrate.mjs                     # Aplica as migrations (roda sozinho no boot do container)
  gen-types.mjs                   # Regenera types/supabase.ts com segurança
  worker.mjs                      # O SEGUNDO PROCESSO: pega trabalho da fila e chama o
                                  # site. Só sabe de `pg` e `fetch` — nada de agente
  semear.mjs                      # `npm run semear`: chama /api/internal/semear pra
                                  # materializar workspaces que já existem. Node puro,
                                  # não importa `@/...` (a lógica mora em lib/seed/).
                                  # O docker-entrypoint.sh chama este mesmo arquivo
                                  # sozinho, a cada boot, depois que o site sobe
  gerar-chave.mjs                 # Sorteia uma ENCRYPTION_KEY nova
proxy.ts                          # Porteiro: sessão + rota pública/privada + rate limit
                                  # (era middleware.ts — Next 16 renomeou a convenção)
docs/                             # A documentação DO ALUNO (PT-BR, sem jargão)
  01-comecando/ … 05-resolvendo-problemas/
  06-agentes-de-ia/               # Agente, conversa, conhecimento, automações e teto de gasto
  superpowers/                    # FORA DO GIT (ver .gitignore): os planos e contratos
                                  # que o Claude Code escreve enquanto constrói. É
                                  # registro interno de decisão, não aula — e tudo que
                                  # fica rastreado chega na mão do aluno (ver regra 21)
lib/env.ts                        # ÚNICO lugar que lê variável de ambiente
lib/action-result.ts              # Formato de retorno de toda função do servidor
Dockerfile                        # Imagem de produção (porta 80)
docker-entrypoint.sh              # Quando o container liga: garante a ENCRYPTION_KEY
                                  # (gera uma temporária e imprime no log se faltar),
                                  # aplica as migrations e sobe DOIS processos — o site
                                  # e o trabalhador. Um dos dois morreu, o container cai.
                                  # Depois que o site responde, roda `npm run semear` em
                                  # segundo plano; se ele falhar, só avisa no log — não
                                  # derruba o container
.env.example                      # As 4 obrigatórias. Nenhuma opcional — chave de
                                  # provedor se cadastra pelas telas
```

## CLAUDE.md filhos (consulte conforme contexto)

- `lib/auth/CLAUDE.md` — guards, proteção de rota, regras de senha/redirect
- `lib/supabase/CLAUDE.md` — queries, migrations, padrão de tabela org-scoped, regras de helpers RLS
- `lib/email/CLAUDE.md` — envio de email (provider abstrato + adapters)
- `lib/secrets/CLAUDE.md` — cofre de chaves de API (regras do `grant` por coluna)
- `lib/ai/CLAUDE.md` — catálogo de modelos, custo e resolução de provedor
- `lib/agents/CLAUDE.md` — motor de agentes, ferramentas e isolamento por workspace
- `lib/threads/CLAUDE.md` — a conversa com o agente (histórico, balão, ficha de custo)
- `lib/automation/CLAUDE.md` — fila, agendamento, webhook e a impersonação (**leia antes de mexer**)
- `lib/knowledge/CLAUDE.md` — base de conhecimento (documento → pedaços → busca)
- `lib/seed/CLAUDE.md` — **o que este produto tem dentro**: como declarar um TIPO
  NOVO de coisa (o CRM, o catálogo, o que o aluno pedir) sem reescrever algoritmo
- `lib/limits/CLAUDE.md` — teto de gasto com IA (dinheiro, medidor, as frases do bloqueio)
- `lib/dashboard/` — a tela de Início (sem CLAUDE.md próprio; a regra está no topo de `queries.ts` e `passos.ts`)
- `components/CLAUDE.md` — onde criar componentes + padrões base-ui + estilo visual
- `app/(app)/app/[orgSlug]/CLAUDE.md` — padrão de páginas dentro do app

## Diretório de referência (modelos vivos)

Quando precisar de modelo concreto, leia:
- `supabase/migrations/_TEMPLATE_org_scoped_table.sql.example` — template SQL
- `lib/agents/tools/_TEMPLATE_ferramenta.ts` — molde de ferramenta de agente
- `lib/agents/_TEMPLATE_agente.ts` — agente descrito em código
- `lib/seed/CLAUDE.md` — a receita de um tipo novo de coisa declarada, com exemplo

## Quando estiver perdido

Pergunte ao aluno ANTES de adivinhar. O público é leigo — escolhas erradas viram débito técnico que ele não consegue diagnosticar.
