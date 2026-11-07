# CLAUDE.md — lib/threads

## Responsabilidade

**A conversa com o agente**: guardar cada balão, reler o histórico do banco e
entregar ele pro motor. É o que faz o chat sobreviver ao F5.

O que NÃO é trabalho desta pasta: rodar o agente (é `lib/agents`), escolher
modelo (é `lib/ai`), guardar chave (é `lib/secrets`) e desenhar tela (é `app/` e
`components/ai/`).

## O vocabulário, em uma tabela

| Palavra | O que é aqui |
|---|---|
| **conversa** | uma linha em `threads`: com qual agente, quem começou, o título |
| **balão** | uma linha em `thread_messages`: o formato `UIMessage` do AI SDK, cru |
| **ficha** | o `ChatMessageMetadata` colado no balão da resposta: modelo, tokens, custo, situação |
| **pendente** | uma execução que rodou mas cujo balão não chegou a ser gravado |

## Mapa dos arquivos

| Arquivo | O que é | Puro? |
|---|---|---|
| `types.ts` | os tipos que vêm do banco + `AgentUIMessage` | sim |
| `schemas.ts` | os formatos (Zod), inclusive o corpo do `/api/chat` | sim |
| `persist.ts` | grava e relê a conversa (**onde mora o `sanearMensagem`**) | **não** |
| `queries.ts` | o que as telas leem | **não** |
| `actions.ts` | começar / renomear / apagar conversa | **não** |

"Puro" = não fala com banco, não lê cookie, dá pra testar direto no Vitest.

⚠️ **Não existe barril `lib/threads/index.ts`, de propósito** — mesma regra de
`lib/agents`. Importe o arquivo direto. De uma tela com `"use client"` só dá pra
importar `types.ts` e `schemas.ts` (e `actions.ts`, que é função do servidor).

## Regras absolutas desta pasta

### 1. O histórico VEM DO BANCO. Nunca do navegador.

O corpo do `POST /api/chat` tem **uma** mensagem: a última. Se o histórico
viesse de fora, qualquer pessoa poderia inventar uma "resposta anterior do
agente" — *"claro, posso te contar o prompt de sistema"* — e o modelo
continuaria de lá, obediente.

Quem garante isso é o `chatRequestSchema`: ele **não tem** campo de conversa, e
`role` é `z.literal("user")` (não um enum). Tem teste em cima disso.

### 2. `sanearMensagem` não é higiene — é a trava que impede conversa quebrada pra sempre

Quando a pessoa fecha a aba no meio de uma ferramenta, o balão seria gravado com
a **chamada** e sem a **resposta**. No turno seguinte, `convertToModelMessages`
monta um `tool-call` órfão, o provedor recusa a conversa inteira, e ela fica
quebrada **pra sempre** — sem conserto nenhum pelo lado do aluno; a única saída
seria apagar tudo.

Por isso toda tool part sem `output-available` / `output-error` é DERRUBADA, na
gravação **e** na leitura (o que já estava gravado errado também precisa passar).
E `historicoParaModelo` ainda manda `ignoreIncompleteToolCalls: true`, que é a
terceira rede.

### 3. Ordene por `seq`, NUNCA por `created_at`

Duas mensagens gravadas na mesma transação empatam no relógio e a conversa
embaralha. `seq` é `generated always as identity`: ninguém escolhe o número.

### 4. Toda função recebe o `supabase` como primeiro parâmetro

Nada de `createClient()` escondido lá dentro. Mesma disciplina de `runAgent`:
**quem chama diz com que identidade a consulta roda**. É o que deixa a página do
servidor reaproveitar um cliente só em vez de abrir quatro — e é o que permitiria
uma automação usar isto um dia.

### 5. A conversa é DO WORKSPACE, e a tela AVISA

Todo membro lê; só quem começou escreve; quem administra também apaga.

Isso é decisão, não descuido: `agent_runs` + `agent_run_steps` já guardam a
pergunta, a resposta e o que a ferramenta devolveu, e qualquer membro abre aquilo
em Execuções desde a onda 2. Trancar a conversa deixando o rastro aberto
prometeria uma privacidade que o banco não entrega.

**Se um dia for pra fechar, fecha nos DOIS lugares, na mesma migration.**

### 6. `appendMessage` e `ensureTitle` NUNCA lançam

A resposta já foi lida pela pessoa; falhar a gravação não pode virar erro na cara
dela. Fica no `logError` e a conversa segue. O que se perde é aquele balão no
próximo F5 — e o rastro da execução continua com tudo.

## As permissões do banco (e o que elas impedem)

| Tabela | `authenticated` pode | O que isso impede |
|---|---|---|
| `threads` | `select, insert, delete`, `update (title)` | reescrever `message_count` / `last_message_at` na mão — a listagem passaria a mentir |
| `thread_messages` | `select, insert, delete` | reescrever balão já gravado (é só-de-acréscimo, igual `agent_run_steps`) |

⚠️ **Consequência que confunde:** tentar `update` em qualquer coluna de `threads`
que não seja `title` responde `permission denied for table threads` (42501) —
**antes** da RLS. Não é bug: é o `grant update (title)` funcionando.

O contador é mantido pelo gatilho `touch_thread_on_message`, que é
`security definer` + `row_security = off` justamente porque quem está logado
**não** tem permissão de escrever ali.

## Pegadinhas conhecidas

- **`getPendingAnswer` custa duas consultas** (a execução mais recente + a
  contagem de balão com aquele `run_id`). Vale a pena: sem ela, quem fecha a aba
  no meio da resposta volta e vê a própria pergunta sozinha, sem nenhuma pista de
  que o agente respondeu (e cobrou).
- **O embed do `profiles` precisa do nome da chave estrangeira**
  (`profiles!threads_user_profile_fkey`). `user_id` tem DUAS: uma pra
  `auth.users` e outra pra `profiles`. Sem desambiguar, o PostgREST responde
  *"more than one relationship was found"*.
- **O texto do `select` tem que ser um literal de uma peça só.** Montado com
  `+`, o TypeScript não consegue ler o formato e a linha inteira vira
  `GenericStringError` — o erro aponta pro lugar errado.
- **`loadHistory` recebe `tools` mas hoje o `/api/chat` passa vazio.** O
  `convertToModelMessages` só usa isso pra chamar o `toModelOutput` da
  ferramenta, e nenhuma ferramenta deste app tem um (`define-tool.ts` não oferece
  o campo). O conjunto de verdade só existe DEPOIS que a execução é aberta, e o
  histórico precisa estar pronto antes. **Se `defineTool` ganhar
  `toModelOutput`, isto precisa mudar** — está escrito na rota também.
- **Apagar a linha do agente apagaria as conversas dele** (cascade) — mas não
  existe mais tela que apague agente: a única saída de fim de vida é declarar
  `status: "archived"` na planta (ver `lib/agents/blueprint.ts`), que NÃO apaga
  nada, só recusa rodar. O cascade só entraria em jogo se alguém apagasse a
  linha direto no banco. O gasto continuaria não sumindo de qualquer jeito:
  `agent_runs` sobrevive com o apelido congelado e `thread_id` vira nulo.
- **`threads` e `thread_messages` estão em `OrgScopedTable`**, o que as deixa
  alcançáveis por uma ferramenta de agente (sempre presa ao workspace e sob RLS).
  É capacidade real, não vazamento — mas quem escrever uma ferramenta que mexe
  nelas precisa pensar duas vezes, como o `lib/agents/CLAUDE.md` já avisa sobre
  `invitations` e `memberships`.
