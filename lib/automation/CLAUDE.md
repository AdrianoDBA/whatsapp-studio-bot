# CLAUDE.md — lib/automation

## Responsabilidade

Fazer o agente rodar **sem ninguém logado**: agendamento ("toda segunda às 9h")
e webhook ("um sistema de fora chamou").

O que NÃO é trabalho desta pasta: rodar o agente (é `lib/agents`), escolher
modelo (é `lib/ai`), guardar chave (é `lib/secrets`) e desenhar tela (é `app/`).

> 📍 **Procurando `lib/jobs/` ou `lib/schedules/`? É aqui.** Fila, agendamento e
> webhook moram na MESMA pasta de propósito: os três compartilham a fila, a
> ponte e a impersonação, e separá-los em três pastas espalharia a peça mais
> perigosa do template por três lugares. **Não crie essas pastas** — quem for
> mexer em automação precisa ler este arquivo inteiro, e um arquivo só é o que
> garante isso.

## O vocabulário, em uma tabela

| Palavra | O que é aqui |
|---|---|
| **fila** | a tabela `jobs`: uma linha por "trabalho pra fazer" |
| **trabalho** | uma linha da fila. Sempre "rodar tal agente, no nome de tal pessoa" |
| **trabalhador** | `scripts/worker.mjs`: o segundo processo do container |
| **agendamento** | uma linha em `schedules` |
| **webhook** | uma linha em `webhook_endpoints`: um endereço secreto que dispara um agente |
| **ponte** | `postgrest-bridge.ts`: o `fetch` que faz o cliente do Supabase falar SQL |
| **impersonação** | rodar "no nome de" alguém que não está logado |

## Como isso funciona, em cinco linhas

```
scripts/worker.mjs  (só `pg` e `fetch`; não sabe o que é agente)
   ├─ enqueue_due_schedules  a cada 20 s
   ├─ reclaim_stuck_*        a cada 60 s
   └─ claim_job → POST 127.0.0.1:PORT/api/internal/run-job  { jobId }
                                          │  + x-job-signature (HMAC), x-job-ts, x-worker-id
                                          ▼
app/api/internal/run-job  →  lib/automation/run-job.ts  →  lib/agents/engine.ts
                                          │
                             impersonate.ts + postgrest-bridge.ts
                             (cliente do Supabase com o `fetch` trocado)
```

**Por que o trabalhador é burro:** todo o código de agente, ferramenta e chave
fica num lugar só (o site). E como a chamada é dentro do container, ela não
passa pelo proxy do EasyPanel — o corte de 60 segundos dele não vale.

## Mapa dos arquivos

| Arquivo | O que é | Puro? |
|---|---|---|
| `types.ts` | apelidos dos tipos do banco + os formatos da fila | sim |
| `schemas.ts` | os formatos (Zod) | sim |
| `chamada-interna.ts` | "veio de dentro do container ou de fora?" | sim |
| `heartbeat.ts` | o arquivinho que o trabalhador encosta, e o `/api/health` lê | quase (mexe em arquivo) |
| `pg.ts` | os DOIS conjuntos de conexão direta com o banco | **não** |
| `postgrest-bridge.ts` | a ponte: pedido do Supabase → SQL | **não** |
| `impersonate.ts` | monta o cliente do Supabase que veste a identidade | **não** |
| `queue.ts` | a fila (o ÚNICO que usa `systemPool()`) | **não** |
| `run-job.ts` | rodar um trabalho, do começo ao fim | **não** |
| `entrega.ts` | o que fazer com o resultado (nada / email) | quase (só chama `Acoes`) |
| `schedules.ts` | a frase em português e a conta da próxima rodada | sim |
| `webhooks.ts` | sortear e conferir o token do endereço secreto | **não** |
| `queries.ts` | o que a tela de Automações lê | **não** |
| `actions.ts` | o que a tela de Automações grava (`"use server"`) | **não** |

"Puro" = não fala com banco, dá pra testar direto no Vitest.

⚠️ **Não existe barril `lib/automation/index.ts`, de propósito** — importar um
tipo numa tela puxaria `pg` junto. Importe o arquivo direto. De uma tela com
`"use client"` só dá pra importar `types.ts` e `schemas.ts`.

## Regras absolutas desta pasta

### 1. `systemPool()` só em `queue.ts`, e só chamando função com nome

O conjunto de sistema entra no banco como `postgres`, que é **dono das
tabelas**. Como o template não usa `FORCE ROW LEVEL SECURITY` (regra 2 do
CLAUDE.md raiz), uma consulta solta por ali **pularia a regra de segurança do
banco inteira** — veria dado de todos os workspaces de uma vez.

Por isso: nenhuma string de SQL solta, nenhuma consulta em tabela de dado do
aluno. Só `claim_job`, `job_for_run`, `mark_job_started`, `finish_job`,
`release_job`, `reclaim_stuck_jobs`, `reclaim_stuck_agent_runs`,
`enqueue_due_schedules`, `enqueue_webhook_job`, `schedule_report_result`,
`webhook_endpoint_for_check`, `webhook_touch`, `automation_budget_left`,
`finish_agent_run_system`, `org_ai_budget_status`, `owner_memberships_for_seed`.

⚠️ **`org_ai_budget_status` é a única da lista que quem está logado também
alcança**, e isso é de propósito: é a mesma leitura que a tela de Limites faz.
Ela se defende sozinha — com sessão, exige pertencer ao workspace; sem sessão, só
chega ali o processo do container. **Não copie essa exceção pra função que
ESCREVE.**

⚠️ **`owner_memberships_for_seed` é a função por trás de `npm run semear`.**
Ela existe porque impersonar exige saber QUEM impersonar, e ler `memberships`
pela ponte já exigiria estar impersonando alguém — o mesmo ovo-e-a-galinha que
justifica a ponte inteira. Uma função nomeada, **só leitura**, na mesma lista
fechada de sempre, é o padrão que esta regra descreve, não uma exceção a ela:
ela devolve linha CRUA (nenhuma lógica, nenhuma escolha), e quem decide o que
fazer com 0 ou 2+ linhas é o TypeScript que chama — nunca adivinha identidade,
sempre pula e registra (mesmo padrão de `agendamentosPulados`).

Ler agente, conversa ou documento é trabalho da **ponte**.

### 2. `SET ROLE authenticated` é de SESSÃO, nunca `SET LOCAL ROLE`

O contrário do que a intuição diz:

- **SET ROLE de sessão** (o que está em `pg.ts`, no evento `connect`): uma
  consulta que escape da transação roda como `authenticated` **sem**
  `auth.uid()` → devolve ZERO linha. Falha **fechada**.
- **`SET LOCAL ROLE` dentro da transação**: a mesma consulta escapada rodaria
  como `postgres` → **pularia a RLS**. Falha **aberta**, ou seja: vazamento
  entre workspaces.

A ponte ainda repete a troca de papel dentro de cada transação
(`set_config('role', $n, true)`), como segunda camada, e **se recusa a usar uma
conexão que não seja `authenticated`**.

🚫 Trocar isso quebra `tests/automation-impersonation.test.ts`. Leia o teste
antes de mexer.

### 3. Toda consulta da ponte roda dentro de transação, com `is_local = true`

```
BEGIN
  set_config('statement_timeout',   '20000ms',      true)
  set_config('role',                'authenticated', true)
  set_config('request.jwt.claims',  {"sub": …},      true)
  set_config('app.automation_job',  <jobId>,         true)
  <a consulta, parametrizada>
COMMIT
```

Os quatro `true` são o que faz a identidade **não sobrar** pro próximo trabalho
na mesma conexão. E a conexão é **destruída** no fim do trabalho
(`release(true)`), não devolvida pro conjunto.

### 4. Valor nunca vira SQL

Nome de tabela sai de lista fechada (`TABELAS_DA_PONTE`); nome de coluna passa
por expressão regular **e** é conferido contra a lista de colunas daquela
tabela; **valor sempre vira `$n`**.

➕ Criou coluna nova numa tabela escopada por workspace? Acrescente em
`COLUNAS_DA_PONTE`. Esquecer vira **erro de compilação com o nome da coluna**,
não automação quebrando às 8h da manhã.

### 5. A ponte serve `/rest/v1/*` e mais nada

Storage, auth, realtime e functions levam `BridgeUnsupportedError` — erro com
nome, alto. Consequência declarada: **ingestão de documento não roda pela
fila**; ela roda na função do servidor, onde existe sessão de verdade.

### 6. Identidade NUNCA vem do pedido HTTP

O corpo de `/api/internal/run-job` carrega **um** campo: `jobId`. Organização,
agente e `run_as` saem da linha da tabela `jobs`, que foi gravada por uma função
`security definer` do banco.

🚫 Acrescentar `organizationId` ou `runAs` no `runJobRequestSchema` reabre a
ameaça mais grave do bloco. Tem teste em cima disso.

### 7. Trabalho que já começou NÃO é refeito

`mark_job_started` responde `true` uma vez só. Entrega repetida vira falha
**com explicação** ("não foi refeita pra não cobrar duas vezes").

O preço é o inverso: uma automação pode **perder** a rodada quando o deploy cai
no meio dela. Escolha explícita — perder uma rodada é melhor que cobrar duas
vezes.

### 8. Erro que vai pra `jobs.last_error` já é PT-BR leigo

A tela mostra cru. Traduzir é obrigação daqui, nunca da tela e nunca do
Postgres (regra 6 do CLAUDE.md raiz).

### 9. Ninguém arma automação no nome de outra pessoa

As policies de `schedules` e `webhook_endpoints` exigem, no INSERT,
`auth.uid() = created_by` **e** `auth.uid() = run_as`; no UPDATE, exigem
`auth.uid() = run_as` no `with check`.

A consequência prática, e é ela que morde: **um administrador NÃO consegue
ligar, desligar nem editar o agendamento de outra pessoa.** O banco recusa com
*"new row violates row-level security policy"* — em inglês, e sem explicar
nada. Por isso:

- toda função que dá `update` em `schedules` **confere `run_as` ANTES** e
  devolve uma frase que manda clicar em "Assumir";
- "Assumir" (`assumirAgendamentoAction`) aponta o `run_as` pra si mesmo, o que
  o `with check` permite. Ele **não liga** a automação de volta: assumir e
  ligar são duas decisões, e quem assume precisa olhar o que a automação faz
  antes de soltar ela no seu nome.

### 10. `select("*")` em `webhook_endpoints` NÃO funciona

A coluna `token_hash` está fora do `grant select` de `authenticated`, então
`select("*")` **compila e falha em execução com 42501**. Peça as colunas na
mão, como `lib/automation/queries.ts` faz. É a rede de segurança funcionando.

### 11. A conta da próxima rodada mora no BANCO

Quem grava `schedules.next_run_at` é o gatilho `schedules_set_next_run`, que
chama `public.next_schedule_run`. O `proximaRodada()` de `schedules.ts` é um
**espelho** em TypeScript, e existe por um motivo só: mostrar "vai rodar pela
primeira vez em ..." na tela antes de salvar.

Discordaram? O certo é o do banco, e o conserto é no TypeScript.
`tests/automation-schedules.test.ts` trava os dois no mesmo comportamento.

### 12. Automação e webhook nascem em ENSAIO (regra 10-L do CLAUDE.md raiz)

`schedules.modo` e `webhook_endpoints.modo` têm `default 'ensaio'` no banco, e
esse padrão é a trava — não o código. Em ensaio o trabalho roda inteiro (gasta
IA, grava execução, aparece em Execuções), mas o `ctx.acao` do motor não deixa
nada sair: nenhum email, nenhuma chamada pra fora.

**Quem não achar a linha cai em ensaio, nunca em real.** `run-job.ts` lê `modo`
de `schedules` (fonte `schedule`) ou de `webhook_endpoints` (fonte `webhook`)
pela **mesma sessão impersonada**, e só vira `"real"` quando a leitura deu certo
E diz isso. Trabalho `manual` não tem linha nenhuma pra ler — e por isso é
ensaio. 🚫 Não inverta esse padrão "pra facilitar o teste".

Quem liga o modo real é **uma pessoa**, e a policy exige que ela seja o `run_as`
(mesma história da regra 9: quem não é dono da automação clica em "Assumir"
antes). O `ChaveDeModo` de `automacoes/agendamentos-panel.tsx` desenha os
**dois** sentidos — ligar o real e voltar pro ensaio — no agendamento e no webhook, com
a mesma permissão. Só o aviso é assimétrico: ligar o real avisa o que passa a
acontecer; voltar pro ensaio é a direção segura e não precisa de cerimônia.
Quem for mexer nisso mexe no `ChaveDeModo`, não numa função nova — as
`alternarModoDo*Action` já aceitam os dois valores.

⚠️ **Toda coluna nova de `webhook_endpoints`/`schedules` precisa entrar em
`COLUNAS_DA_PONTE` E nos `grant` por coluna** (regra 4 aqui + a armadilha do
`grant` em `20260821110000_agente_que_age.sql`). Foi assim que `modo` e
`esperar_resposta` viraram legíveis; sem isso, `42501` em qualquer `select`.

### 13. A entrega é passo do TRABALHO, nunca ferramenta (regra 10-M)

`schedules.entrega` é um jsonb: `{"tipo":"nenhuma"}` (o padrão) ou
`{"tipo":"email","para":[…]}`. O modelo **não decide** se entrega e **não pode
esquecer** — quem entrega é `run-job.ts`, depois que o agente terminou. O
destino é fixo, escrito por quem criou o agendamento: um documento envenenado
não muda pra onde o resultado vai.

Três coisas que mordem:

1. **`entregarResultado` NÃO grava passo no rastro do agente.** `runAgent` já
   fechou a execução (`finishRun`), e `record_agent_run_step` recusa gravar
   quando `agent_runs.status <> 'running'`. Por isso o `registrar` do `Acoes` da
   entrega é um no-op. Regra de repartição: `agent_runs`/`agent_run_steps`
   guardam o que o **agente** fez; `jobs.last_error` guarda o que a
   **automação** fez com o resultado.
2. **Falha de entrega NÃO transforma a execução em falha.** O trabalho fecha
   como `done`, a execução continua `succeeded`, e o erro vai só pra
   `jobs.last_error`. O agente fez o trabalho dele; quem falhou foi o email.
3. **Webhook não tem `entrega` nesta onda** — só `modo`. Quem chamou já recebe o
   resultado pela própria resposta (regra 14).

⚠️ **SÃO DOIS SCHEMAS, E ISSO NÃO É DUPLICAÇÃO.** `entrega.ts` exporta
`entregaSchema` (o que o BANCO pode devolver — conhece os três casos, inclusive
`{"tipo":"conexao"}`, guardado pra a onda das conexões) e
`entregaDeEntradaSchema` (o que uma porta de ESCRITA aceita gravar — só
`nenhuma` e `email`). A única porta de escrita, hoje, é `agendamentoParaInsert`
(`lib/automation/blueprint.ts`, chamada só por `materializarWorkspace`), e ela
usa o SEGUNDO.

Até a Task 9 a porta era a função do servidor `criarAgendamentoAction`, e o
schema dela embutia o de LEITURA inteiro: quem administrava qualquer workspace
chamava a action com
`{"tipo":"conexao","slug":"https://onde.eu.quiser","caminho":"/x"}` e ganhava um
canal de saída permanente — `entregarResultado` concatena os dois campos e faz
POST com o resultado do agente, de novo a cada rodada —, e os outros
administradores só liam aquilo como "uma entrega que esta tela ainda não sabe
mostrar". A Task 9 apagou a action inteira; hoje só o arquivo grava, e ele usa
`entregaDeEntradaSchema`. **Fechar a entrada sem fechar a leitura** continua de
propósito: o formato fica guardado pra a onda das conexões (o banco continua
sabendo LER `conexao`), mas nem tela nem arquivo conseguem declarar um hoje.

⚠️ **O teto de destinatários da entrega é o MESMO da ferramenta `mandar-email`**
(`MAX_DESTINATARIOS_DA_ENTREGA` = 5 = o `.max(5)` de
`lib/agents/tools/mandar-email.ts`). Os dois caminhos terminam na mesma porta
(`ctx.acao.email`, um `fetch` por destinatário em `Promise.all`) com o remetente
que `resolveEmailSender` achar — e ele cai workspace → **plataforma**. Teto num
lado só não protege nada. `tests/entrega-do-resultado.test.ts` cobra os dois.

### 14. O webhook responde de dois jeitos, e o padrão é o de sempre

`webhook_endpoints.esperar_resposta` tem `default false`:

| `esperar_resposta` | O que a rota faz |
|---|---|
| `false` (padrão) | põe na fila e responde **202 `{ jobId }`** na hora |
| `true` | põe na fila **igual** e fica perguntando pro banco a cada 500 ms até `PRAZO_DO_WEBHOOK_MS` (50 s). Terminou: **200** com `resposta`, `custoMicros` e `ensaio`. Estourou: **202** com `buscarEm` |

⚠️ **O campo `ensaio` da resposta sai de `agent_runs.modo`, NUNCA de
`webhook_endpoints.modo`.** Um é REGISTRO (imutável, `freeze_agent_run_keys`;
descreve a rodada que aconteceu), o outro é CONFIGURAÇÃO (alguém vira a
chavinha na tela e ele muda). Enquanto a resposta lia o segundo — que vem de
graça junto com o token, e por isso era o caminho fácil — bastava alguém ligar
o modo real entre o disparo e a leitura pra ela afirmar `ensaio: true` numa
rodada em que o email SAIU. Quem carrega o dado certo é `webhook_job_result`
(coluna `run_modo`), e `null` ali vira `ensaio: false`: silêncio, nunca a
promessa de que nada saiu.

⚠️ **Síncrono NÃO é um segundo jeito de rodar o agente.** É o MESMO trabalho na
MESMA fila; quem roda continua sendo o trabalhador. A rota só espera.

`buscarEm` aponta pra `GET /api/webhooks/<endpointId>/j/<jobId>`, que faz **uma**
leitura (nunca espera): **202 `{"status":"running"}`** enquanto roda, **200**
quando termina.

⚠️ **O POLLING TEM DOIS BALDES PRA NÃO GASTAR, E OS DOIS PRECISAM ESTAR
SEPARADOS.** São dois andares diferentes, e a primeira versão desta onda só
tratou o de baixo:

| Andar | Onde conta | Como o polling escapa |
|---|---|---|
| endereço (`webhook_endpoints.window_count`) | `verificarWebhook` → `webhook_touch` | a rota chama com `contar: false` |
| endereço de ORIGEM (memória do processo) | `proxy.ts` | chave própria (`hook:busca:<ip>`) com `RATE_MAX_WEBHOOK_BUSCA` |

Com um andar só resolvido, o cliente que seguia a doc ainda tomava **429 do
proxy** na 60ª pergunta do minuto — e levava junto o próximo POST de negócio do
mesmo endereço de origem, porque o balde era compartilhado. Em produção
`trustProxy()` é `true`, então "endereço de origem" costuma ser o sistema
inteiro do outro lado (um n8n), não uma chamada só.

⚠️ **O teto do polling e a frase da doc do aluno andam juntos.**
`docs/06-agentes-de-ia/06-o-agente-que-age.md` diz de quanto em quanto tempo
perguntar. Mexeu em `RATE_MAX_WEBHOOK_BUSCA`, releia aquela frase — doc que
promete "chame quantas vezes precisar" com teto escondido no proxy é pior que
teto nenhum.

⚠️ **`maxDuration = 60` na rota do POST não é enfeite** — sem ele o próprio Next
cortaria a requisição antes dos 50 s de espera.

⚠️ **`esperarResposta` SE ESCOLHE NO ARQUIVO, E SÓ ALI.** O campo mora em
`WebhookBlueprint.esperarResposta` (`lib/automation/blueprint.ts`), e
`webhookParaInsert` grava ele no `insert` — sem tela nem função do servidor que
escolha isso depois. A lista de endereços (`webhooks-panel.tsx`) só MOSTRA qual
dos dois ficou valendo em cada linha. **Não existe caminho que troque isso num
webhook já materializado**, de propósito: quem já chama o endereço contou com um
formato de resposta, e virar a chave por baixo quebraria o outro lado. Pra
mudar, declare outro webhook no arquivo, com outro apelido — o antigo continua
existindo (o materializador nunca apaga); se ele não deve mais responder, gire
o token dele e não distribua o novo.

⚠️ **O prazo na tela não é digitado na mão.** `PRAZO_DO_WEBHOOK_MS` mora aqui em
`queue.ts`, que fala com o banco — o painel é `"use client"` e não pode importar
daqui. Ele desce como prop (`prazoDeEsperaSegundos`) a partir de
`automacoes/page.tsx`. Escrever "50" no JSX faria a tela mentir no dia em que o
número mudasse.

### 15. Girar o token, não revogar

`girarTokenDoWebhookAction` substituiu `revogarWebhookAction` (que apagava a
linha). A URL vem do `id` (`montarUrlDoWebhook`), nunca do token — então girar
sorteia um segredo novo e grava só `token_hash`/`token_prefix`, sem tocar
`slug` nem o resto da linha. Quem chamava com o token antigo recebe 401 até
atualizar.

⚠️ **`grant update (token_hash, token_prefix)` existe só pra isso**
(`supabase/migrations/20260823020000_grant_update_token_webhook.sql`). Não
alarga QUEM gira — a policy de UPDATE já restringe a owner/admin — só alarga
QUAIS COLUNAS. `token_hash` continua FORA do `grant select`: ninguém consegue
ler o hash pra espalhar ele de volta num update.

⚠️ **`grant update (slug)` não existe, de propósito, e não deve entrar aqui.**
`slug` é a identidade que o materializador usa; se a action um dia crescer e
alguém espalhar a linha inteira no update, o banco recusa `slug` com 42501 — é
a rede de segurança funcionando, não um bug pra "consertar" com mais grant.

⚠️ **Desligar de vez (`is_active = false`) continua SEM botão nesta tela pra
webhook** — só `schedules` tem `ligarDesligarAgendamentoAction`. A coluna já
está no `grant update` (`is_active`, `20260821030000_correcoes_revisao_bloco_2.sql`),
falta só a action/UI. Enquanto isso não existir: um endereço que se desligou
sozinho (`run_as` saiu do workspace) fica sem jeito de reativar pela tela — só
"Assumir" (que troca `run_as`, nunca `is_active`).

## As cinco camadas que protegem a chamada interna

1. o `proxy.ts` devolve **404** quando o pedido veio de fora;
2. **HMAC-SHA256** derivado da `ENCRYPTION_KEY`, comparado em tempo constante,
   com janela de 60 segundos;
3. o corpo tem **um** campo (`jobId`);
4. `job_for_run` exige `status = 'running'` **e** `locked_by = <este
   trabalhador>`;
5. `mark_job_started` recusa a segunda entrega.

⚠️ **Resíduo:** com o container exposto direto na internet (`TRUST_PROXY=0`)
não existe proxy carimbando endereço, e a camada 1 perde o valor. Sobram as
outras quatro. Continua sólido, mas é uma camada a menos.

## Pegadinhas conhecidas

- **O próprio Next carimba `x-forwarded-*` em TODO pedido**, inclusive num
  pedido feito de dentro do container pra `127.0.0.1`. Por isso
  `chamadaVeioDeFora()` olha o **valor** (é loopback?), não a presença do
  cabeçalho. A versão ingênua fazia a rota interna responder 404 pro
  trabalhador — e **nenhuma automação rodava**.
- **401 na chamada interna quase sempre é `.env` diferente.** O segredo deriva
  da `ENCRYPTION_KEY`; dentro do container os dois processos nascem do mesmo
  `docker-entrypoint.sh` e sempre concordam. Na sua máquina, rode os dois com
  o mesmo `.env.local`.
- **"Funciona no painel, falha às 8h da manhã."** Uma ferramenta que use um
  filtro fora do subconjunto da ponte roda no playground (API de verdade) e
  quebra na automação. Quando isso acontece, o trabalho falha com uma frase
  específica e o agendamento é **pausado** em vez de falhar todo dia calado.
- **A automação tem cota de IA própria** (`automation_usage`), separada da cota
  pessoal. É a marca `app.automation_job` que faz isso — sem ela, o agendamento
  queimaria a cota de quem o armou, que chegaria de manhã sem conseguir usar o
  chat, sem entender por quê.
- **O trabalhador roda UM trabalho por vez**, de propósito (container pequeno).
  Uma automação de 5 minutos atrasa as outras. O número está numa constante
  comentada no topo do `worker.mjs`.
- **Sem `DATABASE_URL` o trabalhador não morre** — imprime um aviso e fica
  parado. Derrubar o container por causa disso transformaria um app que hoje
  funciona num app que reinicia pra sempre. Pelo mesmo motivo, o `/api/health`
  só cobra o batimento quando existe `DATABASE_URL`.
- **O token do webhook aparece UMA VEZ SÓ.** O banco guarda só o sha256 dele.
  Não existe "mostrar de novo" — nem pra quem administra, nem pra quem tem o
  banco na mão. Perdeu ou vazou? "Gerar token" (`girarTokenDoWebhookAction`,
  regra 15) sorteia outro sem trocar o endereço — não precisa mais apagar a
  linha e recriar.
- **O corpo do webhook é embrulhado em `{"data": …}` PELO BANCO**
  (`enqueue_webhook_job`), de propósito: é a última camada que ninguém
  contorna. Embrulhar de novo no TypeScript produziria `data.data`.
- **O limite de chamadas do webhook só conta quem PROVOU o token.** O inimigo
  real não é força bruta (são 256 bits sorteados), é uma integração maluca do
  outro lado chamando mil vezes por minuto e enchendo a fila do workspace.
- **`organizations` está na ponte, e não é tabela escopada por workspace.**
  `runAgent` precisa do apelido e do nome do workspace, e eles só existem lá. A
  regra de segurança do banco continua valendo ("members read their orgs").
- **Rodada pulada por TETO DE GASTO não é falha, e NÃO desliga a automação.**
  `enqueue_due_schedules` confere o teto, escreve o motivo em
  `schedules.last_error`, **avança `next_run_at`** e segue — a automação continua
  ligada, porque o teto zera sozinho na virada do mês (desligar deixaria ela
  morta em setembro esperando alguém lembrar de religar). Por isso o
  `run-job.ts` chama `contarProAgendamento(..., pausar: false)` nesse caminho, e
  a tela de Automações mostra um distintivo amarelo **"Rodada pulada"** em vez do
  vermelho de "Deu errado" (`ehRecusaDeTeto`, em `lib/limits/messages.ts`).
- **`enqueue_webhook_job` devolve MOTIVO COM NOME, não um uuid.** O retorno é
  `{ job_id, motivo, escopo? }`, e `motivo` é um de `desligado`,
  `sem-responsavel`, `teto-de-gasto`, `fila-cheia` ou `repetida`. Com
  `teto-de-gasto` a rota responde **429 + `Retry-After` + `code:
  "teto_de_gasto"`** — nunca 202: dizer "aceitei" pra um trabalho que nunca vai
  rodar é mentir pro sistema do outro lado. Ver `lib/limits/CLAUDE.md`.

## Como testar isso na sua máquina

```bash
npm run build && npx next start -p 3010     # o site
PORT=3010 npm run worker                    # o trabalhador, noutro terminal
```

Os dois precisam enxergar o **mesmo** `.env.local`. Depois, com um agendamento
já declarado (ver `lib/seed/registro.ts`) e materializado, use "Rodar agora"
na tela de Automações.
