# CLAUDE.md — lib/limits

## Responsabilidade

Responder **"esse workspace ainda pode gastar com IA?"** e escrever, em
português, o que acontece quando a resposta é não.

O que NÃO é trabalho desta pasta: somar o gasto (quem soma é o BANCO, na mesma
transação que fecha a execução), rodar o agente (é `lib/agents`), indexar
documento (é `lib/knowledge`) e desenhar tela (é `app/`).

> 📍 **Teto de gasto NÃO é cobrança.** Se um dia entrar cobrança de assinatura
> aqui dentro (Stripe e afins), ela é outra pasta: lá é cobrar do *cliente*,
> aqui é limitar o quanto o *app* gasta com IA. Misturar os dois deixaria o
> aluno procurando o teto de gasto dentro da tela de pagamento.

## O vocabulário, em uma tabela

| Palavra | O que é aqui |
|---|---|
| **teto** | quanto este workspace pode gastar (`org_ai_limits`) |
| **medidor** | quanto ele já gastou, acumulado por dia (`org_ai_spend`) |
| **micro-dólar** | a unidade de tudo. US$ 1,00 = 1.000.000 |
| **linha de parada** | o teto NÃO é trava: a última execução atravessa |
| **corte automático** | `hard_stop` — ligado, para; desligado, só avisa |
| **teto da plataforma** | o teto que quem cuida do SISTEMA põe por cima |

## Mapa dos arquivos

| Arquivo | O que é | Puro? |
|---|---|---|
| `types.ts` | os formatos (`BudgetStatus`, `MonthSpend`, `PlatformSpendRow`) | sim |
| `money.ts` | dólar ↔ micro-dólar + o dinheiro em texto curto | sim |
| `month.ts` | a virada do mês e do dia no fuso de Brasília | sim |
| `messages.ts` | **as frases que o aluno lê** quando o teto corta | sim |
| `schemas.ts` | os formatos (Zod) dos formulários | sim |
| `queries.ts` | lê `org_ai_budget_status` e o histórico | **não** |
| `actions.ts` | grava o teto (`"use server"`) | **não** |

"Puro" = não fala com banco, dá pra testar direto no Vitest.

⚠️ **Não existe barril `lib/limits/index.ts`, de propósito** — mesmo motivo de
`lib/agents` e `lib/automation`: importar um tipo numa tela puxaria o cliente do
Supabase junto. Importe o arquivo direto. De uma tela com `"use client"` só dá
pra importar `types.ts`, `money.ts`, `month.ts`, `messages.ts` e `schemas.ts`.

## Regras absolutas desta pasta

### 1. Dinheiro é INTEIRO, em micro-dólares — e "sem teto" é `null`

`bigint` no banco, `number` inteiro aqui. **`null` = sem teto** (nos limites) ou
**"não deu pra calcular"** (no gasto). Nunca `0` pra dizer "não sei": zero
significa "custou zero mesmo".

E a conta de dólar pra micro-dólar **passa por centavos**
(`Math.round(usd * 100) * 10_000`). `usd * 1_000_000` em ponto flutuante erra:
`2.01 * 1_000_000` dá `2009999.9999999998`. Um teto gravado com essa sobra vira
comparação errada no banco pra sempre. `tests/limits-money.test.ts` trava isso.

### 2. O medidor é INTOCÁVEL pelo TypeScript

Não existe (e não pode existir) função aqui que escreva em `org_ai_spend`.
Ninguém logado tem `grant` de escrita nessa tabela, nem policy — quem soma é
`org_ai_spend_add`, `security definer`, chamada de dentro de
`finish_agent_run` / `finish_agent_run_system` / `finish_document_indexing`, na
**mesma transação** que fecha a execução.

Consequências que valem escrever:

- **apagar execução NÃO devolve saldo.** O medidor é outra tabela e não é
  decrementado. Se fosse, "limpar o histórico" seria o botão de zerar a conta;
- a única coisa que mexe no acumulado é `recalcularGastoAction`, que
  **reconstrói** o período a partir de `agent_runs` e `documents` e exige dono
  do sistema.

### 3. O teto é LINHA DE PARADA, não trava

O custo real de uma execução só existe quando ela termina. Então a pergunta que
o teto faz não é "essa execução cabe?", é **"o medidor já passou da linha?"**.
Se passou, nada novo começa — mas **a última execução atravessa**. Isso é
assumido, está escrito na tela, e quem limita o estouro por cima é
`max_run_cost_micros` (o "momento B", em memória).

🚫 **Não escreva checagem de teto por passo do agente.** Ela iria ao banco 20
vezes por execução pra economizar centavos.

### 4. `getBudgetStatus` nunca lança, e quem chama decide

`null` quer dizer "não deu pra ler". Os três chamadores escolheram **deixar
passar** nesse caso, e a escolha está comentada em cada um: parar todos os
agentes de todos os workspaces porque uma leitura falhou seria muito pior que
uma execução a mais atravessando a linha — e quem soma o gasto de verdade é o
banco, ao fechar, que continua somando.

### 5. A frase muda por gatilho. Sempre.

Nenhuma frase desta pasta serve pros quatro gatilhos:

| Quem lê | Audiência | O que a frase precisa ter |
|---|---|---|
| pessoa que administra | `pessoa-admin` | o número do teto e o caminho do menu |
| pessoa que não administra | `pessoa-membro` | "peça pra quem administra", sem número |
| o registro da automação | `agendamento` | "rodada pulada" + "continua ligada" |
| um programa, por HTTP | `webhook` | quando volta — e nenhum caminho de menu |
| quem subiu um arquivo | `documento` | que indexar TAMBÉM gasta |

E todas seguem cinco regras: dizem por que parou, dizem que nada quebrou, dizem
quando volta sozinho, dão o caminho exato (ou mandam pedir), e **nunca** usam as
palavras "erro", "falha", "bloqueado" ou "limite excedido".

🚫 `tests/limits-messages.test.ts` trava o texto palavra por palavra. **Mudar a
frase é mudar o teste** — de propósito.

### 6. Tudo vira à meia-noite de BRASÍLIA

No mês e no dia. Quem decide isso é o banco (`public.ai_today()` /
`public.ai_month_start()`, com `at time zone 'America/Sao_Paulo'`).
`month.ts` é um **espelho** em TypeScript, e existe pra duas coisas: o
`Retry-After` do webhook e o "1º de setembro" das frases.

⚠️ Ele assume **UTC−3 fixo** (o Brasil não tem horário de verão desde 2019). Se
voltar a ter, o conserto é em `month.ts` — o SQL está certo por definição.

Discordaram? **Quem manda é o banco.**

### 7. Três camadas, e a de token NÃO morreu

| Camada | O quê | Unidade | Quem controla |
|---|---|---|---|
| 1 — freio de arrancada | `llm_usage` 50k/pessoa/dia · `automation_usage` 500k/workspace/dia | token | ninguém (número do sistema) |
| 2 — teto do dia | `daily_budget_micros` | dinheiro | dono/admin do workspace |
| 3 — teto do mês | `monthly_budget_micros` + `platform_cap_micros` | dinheiro | dono/admin · e o dono do sistema |

A camada 1 continua existindo porque ela é **a única que age sem saber o
custo** (ela estima e desconta ANTES) e **a única por PESSOA** — sem ela, um
membro sozinho come o teto do mês do time no primeiro dia. As duas passaram a
virar no fuso de Brasília, junto com o resto.

### 8. Duas funções pra gravar teto, nunca uma

`set_org_ai_limits` (dono/admin do workspace) e `set_org_platform_cap` (dono do
SISTEMA) são separadas de propósito: uma função só, com um `if` dentro, deixaria
a porta perto demais. **O teto da plataforma corta mesmo com o corte automático
do workspace desligado** — senão bastaria desligar o corte pra gastar a chave de
quem paga a conta.

## Onde o teto é aplicado (os três gatilhos)

```
chat / botão ─┐
agendamento ──┼─► prepareAgentRun (lib/agents/engine.ts), passo 2a
webhook ──────┘   └─ bloqueado → { ok:false, error, runId:null }, SEM abrir execução

agendamento ──► enqueue_due_schedules (SQL): pula a rodada, avança o relógio,
                escreve o motivo em schedules.last_error e CONTINUA LIGADA

webhook ──────► enqueue_webhook_job (SQL) devolve { motivo:"teto-de-gasto" }
                └─ a rota responde 429 + Retry-After + code:"teto_de_gasto"

documento ────► processarDocumento (lib/knowledge/ingest.ts), antes de indexar
```

⚠️ **O agendamento não é DESLIGADO por teto.** O teto zera sozinho na virada do
mês; desligar deixaria a automação morta em setembro esperando alguém lembrar de
religar. Por isso o `run-job.ts` chama `contarProAgendamento(..., pausar: false)`.

## As telas que essa pasta alimenta

```
app/(app)/app/[orgSlug]/settings/limites/page.tsx           Server  (owner/admin)
                                        gasto-do-mes.tsx    Server  quanto já foi + histórico
                                        limites-form.tsx    client  os três tetos + corte
components/app/budget-banner.tsx                            Server  a FAIXA, no layout
app/(app)/plataforma/gastos/page.tsx                        Server  (dono do sistema)
                           gastos-table.tsx                 client  a tabela
                           teto-da-plataforma-form.tsx      client  o campo do teto da plataforma
```

Três decisões de tela que vieram do contrato, e não de gosto:

1. **A faixa mora no `layout.tsx` do workspace**, não na tela de Limites. Quando
   os agentes param, a pessoa está no chat ou em Automações — avisar só em
   Configurações seria avisar justamente quem já foi procurar o problema. Ela
   aparece só quando há o que dizer (`budgetBanner` devolve `null` no resto do
   tempo): faixa que aparece sempre vira enfeite.
2. **A tela abre pelo HISTÓRICO, e o formulário vem depois.** "US$ 20,00" não
   significa nada pra quem nunca viu a conta de um provedor de IA; "vocês
   gastaram US$ 2,13, US$ 1,04 e US$ 3,80 nos últimos meses" significa na hora.
3. **Nenhuma frase nasce numa tela.** Todo texto de bloqueio, aviso e rodapé sai
   de `messages.ts`, que tem teste palavra por palavra. Uma tela que escreva a
   própria versão da frase é uma tela que vai divergir na primeira revisão.

E uma da tela de Automações: o distintivo **"Rodada pulada"** (amarelo, diferente
do vermelho de "Deu errado") sai de `ehRecusaDeTeto(last_error)`. É comparação de
TEXTO de propósito — a alternativa seria uma coluna nova em `schedules`/`jobs`
guardando um motivo que já está escrito na frase. O teste trava as duas pontas:
as frases daqui e as três que o SQL escreve.

## Pegadinhas conhecidas

- **`bigint` chega de dois jeitos.** Pela API do Supabase ele vira NÚMERO no
  JSON; pela conexão direta do trabalhador (`pg`), vira TEXTO — o driver não
  converte `int8` sozinho. Por isso o mapeamento mora num lugar só
  (`budgetStatusDaLinha`, em `queries.ts`) e os dois caminhos usam ele. Sem
  isso, `"20000000" >= 20000000` compararia texto com número.
- **Os tipos gerados marcam todo argumento de função como não-nulo.** O
  `npm run types` não tem como saber quais aceitam `null`. `set_org_ai_limits`
  aceita — e `null` ali é exatamente o que grava "sem teto". Mandar `undefined`
  no lugar não resolve: esses argumentos não têm valor padrão, e a chamada sairia
  sem eles.
- **`org_ai_limits` e `org_ai_spend` entram sozinhas em `OrgScopedTable`**
  (elas têm `organization_id`), então uma FERRAMENTA de agente alcança as duas
  pelo `ctx.db`. Ler tudo bem; gravar falha com 42501, e isso é intencional.
- **O teto por execução não para com custo desconhecido.** Modelo fora do
  catálogo devolve `null` na soma em memória, e parar por um número que não
  existe seria chute. Nesse caso quem limita continua sendo `max_steps`.
- **A tela nunca mostra o gasto do mês com 4 casas.** `formatTetoUsd` (2 casas)
  é do teto; `formatUsdFromMicros` (4 casas abaixo de US$ 1) continua sendo da
  tela de Execuções, execução por execução.
- **Este medidor não é a fatura do provedor.** Ele soma o que o template
  calculou, com os preços de `lib/ai/catalog.ts`, no horário de Brasília. A
  fatura fecha noutro fuso e arredonda diferente. A frase que diz isso pro aluno
  é `TEXTO_MEDIDOR_NAO_E_FATURA`, e ela é obrigatória na tela.
- **Padrão de fábrica é SEM TETO**, e é decisão. Teto padrão faria agentes
  pararem calados pra quem nunca configurou nada — o pior primeiro contato
  possível. Quem protege a conta nova são os dois freios de token (camada 1) e o
  `platform_cap_micros`.
