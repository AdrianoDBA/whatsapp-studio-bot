# CLAUDE.md — app/[orgSlug]

## Responsabilidade

Todas as rotas autenticadas e escopadas por organização. Toda página aqui dentro:

1. Recebe `params.orgSlug` na assinatura
2. Chama `requireOrgMember({ orgSlug })` (ou `requireOrgRole`) na primeira linha
3. Renderiza UI dentro do `AppLayout` (já aplicado automaticamente pelo `layout.tsx`)

## Estrutura padrão de uma página (listagem)

```tsx
import { requireOrgMember } from "@/lib/auth/guards";

type Props = { params: Promise<{ orgSlug: string }> };

export const metadata = { title: "Título em PT-BR" };

export default async function MyPage({ params }: Props) {
  const { orgSlug } = await params;
  const { user, org, role } = await requireOrgMember({ orgSlug });

  // Buscar dados (queries do domínio):
  // const things = await getMyThings(org.id);

  return (
    <div className="space-y-8">
      <div className="space-y-1.5">
        <span className="label-mono">/ meu-recurso</span>
        <h1 className="font-semibold text-3xl tracking-tight">Título</h1>
        <p className="text-muted-foreground text-sm">Descrição curta.</p>
      </div>
      {/* conteúdo */}
    </div>
  );
}
```

## Padrão de página de DETALHE (`[id]/page.tsx`)

Toda entidade (contato, produto, tarefa) que tem listagem normalmente tem detalhe.
Convenção: `/<entidade>/[id]/page.tsx`.

```tsx
import { ArrowLeftIcon } from "lucide-react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { requireOrgMember } from "@/lib/auth/guards";
import { getThing } from "@/lib/things/queries";

type Props = { params: Promise<{ orgSlug: string; id: string }> };

export default async function ThingDetailPage({ params }: Props) {
  const { orgSlug, id } = await params;
  const { org } = await requireOrgMember({ orgSlug });
  const thing = await getThing(org.id, id);
  if (!thing) notFound();

  return (
    <div className="max-w-3xl space-y-8">
      <Button
        render={<Link href={`/app/${orgSlug}/things`} />}
        nativeButton={false}
        variant="ghost"
        size="sm"
        className="gap-1.5 text-muted-foreground"
      >
        <ArrowLeftIcon className="h-3.5 w-3.5" />
        Voltar
      </Button>

      <div className="space-y-1.5">
        <span className="label-mono">/ thing #{thing.id.slice(0, 8)}</span>
        <h1 className="font-semibold text-3xl tracking-tight">{thing.name}</h1>
      </div>

      <Card>
        <CardHeader className="border-b border-border/60 bg-card/40 py-3">
          <CardTitle className="label-mono text-[10px]">/ detalhes</CardTitle>
        </CardHeader>
        <CardContent className="p-6">
          {/* form de edição em client component separado */}
        </CardContent>
      </Card>
    </div>
  );
}
```

## Padrão de DataTable (listagens)

Para listas com sort/filter/paginate, use `<DataTable>` de `@/components/app/data-table`. **Atenção:** colunas precisam ser definidas em **Client Component** porque usam `flexRender` e podem ter hooks.

Padrão: separa em 3 arquivos:
- `page.tsx` (Server Component) — busca dados, passa pra `<ThingsTable>`
- `things-table.tsx` (Client Component) — wrapper do `<DataTable>` com columns
- `thing-columns.tsx` (Client Component) — exporta `getThingColumns(orgSlug)`

```tsx
// things-table.tsx
"use client";
import { DataTable } from "@/components/app/data-table";
import { EmptyState } from "@/components/app/empty-state";
import { getThingColumns } from "./thing-columns";

export function ThingsTable({ orgSlug, things }: Props) {
  return (
    <DataTable
      columns={getThingColumns(orgSlug)}
      data={things}
      searchColumn="name"
      empty={<EmptyState title="Vazio" description="Adicione o primeiro." />}
    />
  );
}
```

## Padrão das telas de AGENTE (referência viva)

`agentes/` e `execucoes/` são o conjunto de referência da pasta pra esse
padrão. Agente é ARQUIVO, não formulário (regra 1 lá em cima): não tem
"criar", "editar" nem "apagar" aqui — só listar, ler como está montado e
rodar.

```
agentes/page.tsx                    lista (requireOrgMember; qualquer membro vê)
agentes/agents-table.tsx            DataTable
agentes/agent-columns.tsx           colunas ("use client")
agentes/[slug]/page.tsx             LEITURA: prompt, modelo, ferramentas, sem campo editável
agentes/[slug]/testar/playground.tsx  roda e mostra o rastro
execucoes/…                         histórico + detalhe, com <RunTrace>
```

### Três regras que vieram de bug de verdade

1. **Falha do agente NÃO é `{ ok: false }`.** `runAgentAction` devolve
   `{ ok: true, data: { run } }` mesmo quando o agente quebrou, com
   `run.status === "failed"` e `run.errorMessage` já em português. `{ ok:false }`
   é só pra quando a execução **nem começou** (texto vazio, sem permissão,
   limite de uso). Sem isso a tela engolia o rastro justamente na hora em que
   ele era mais necessário.

2. **O rastro é ordenado por `seq`, nunca por ordem de gravação.** O motor
   grava a ferramenta ANTES da fala do modelo que pediu ela. `getRunDetail` já
   faz `order("seq")`; o `<RunTrace>` não reordena.

3. **Componente `"use client"` importa `@/lib/ai/catalog`, `@/lib/ai/embeddings`
   e `@/lib/ai/types` DIRETO — nunca o barril `@/lib/ai`.** O barril puxa
   código que fala com o banco e quebra o build do lado do navegador
   (`agent-columns.tsx` e `base-columns.tsx` são o exemplo vivo).

## As três telas novas (conversa, automações, conhecimento)

```
agentes/[slug]/conversar/page.tsx          lista de conversas com AQUELE agente
agentes/[slug]/conversar/conversas-list.tsx
agentes/[slug]/conversar/[threadId]/page.tsx
agentes/[slug]/conversar/[threadId]/conversa.tsx   ← o chat, com useChat
conhecimento/page.tsx                      as bases (requireOrgMember)
conhecimento/[slug]/page.tsx               os documentos de uma base
conhecimento/[slug]/[documentId]/page.tsx  os pedaços de um documento
automacoes/page.tsx                        agendamentos + webhooks (owner/admin)
settings/limites/page.tsx                  o teto de gasto com IA (owner/admin)
settings/limites/gasto-do-mes.tsx          quanto já foi + os meses anteriores (Server)
settings/limites/limites-form.tsx          os três tetos + corte automático ("use client")
```

⚠️ **`settings/limites/` é a referência de tela de DINHEIRO.** Três coisas dela
valem pra qualquer tela parecida: (1) ela abre pelo **histórico do próprio
workspace**, porque "US$ 20,00" não tem escala pra quem nunca viu a conta de um
provedor — o formulário vem depois; (2) os valores prontos (US$ 5 · 20 · 50 ·
200 · sem teto) vêm antes do campo livre, que fica escondido atrás de "Outro
valor"; (3) o dinheiro aparece com **2 casas** (`formatTetoUsd`), nunca com as 4
de `formatUsdFromMicros` — aquelas continuam só em Execuções, execução por
execução.

### Quem entra em cada uma (e por quê)

| Tela | Guard | Motivo |
|---|---|---|
| `conversar/` | `requireOrgMember` | **a conversa é do workspace**: todo membro lê, só quem começou escreve. A tela DIZ isso, com essas palavras — é o tipo de coisa que um leigo não espera |
| `conhecimento/` | `requireOrgMember` | é o mesmo alcance da policy de SELECT. Os botões de subir/apagar documento só aparecem pra owner/admin, e **quem manda é a policy** — a tela só evita oferecer o que vai ser recusado. Criar base não é botão nenhum: nasce de arquivo |
| `automacoes/` | `requireOrgRole({ roles: ["owner", "admin"] })` | a tela mostra o **endereço secreto** dos webhooks, e armar automação é dizer "esse agente roda sozinho, no meu nome" |
| `settings/limites/` | `requireOrgRole({ roles: ["owner", "admin"] })` | mexer no teto é mexer no que o time inteiro consegue fazer. Membro comum não fica sem informação: a **faixa do topo** diz o número e manda pedir pra quem administra |

### Quatro regras que vieram de bug de verdade

1. **Rota de API NÃO usa `requireOrgMember`.** Ele chama `redirect()`, e num
   `fetch` isso vira um 307 pro `/login` no meio da conversa — a tela mostra
   HTML de login como se fosse resposta do agente. Em `app/api/*`, use
   `getOrgBySlug(orgSlug, user.id)` e responda **403**. O corpo de erro do
   `/api/chat` é **texto puro em PT-BR**, porque a tela mostra cru.

2. **A tela de automações precisa avisar quando o trabalhador não está de pé.**
   Uma automação "Ligada" que nunca roda é o pior resultado possível: o aluno
   acha que o app quebrou e não tem como descobrir por quê. As duas causas reais
   (sem `DATABASE_URL`, ou `npm run dev` — que **não** sobe o segundo processo)
   têm texto próprio na tela.

3. **Administrador NÃO liga/desliga o agendamento de outra pessoa.** A policy
   exige `auth.uid() = run_as` no `with check`, e o banco recusa em inglês, sem
   explicar nada. Por isso a função do servidor confere ANTES e devolve a frase
   que manda clicar em **"Assumir"**.

4. **O token do webhook aparece uma vez só.** O banco guarda só o sha256. O
   cartão que mostra o token não some sozinho — some no clique, depois de a
   pessoa copiar. **"Girar o token" substituiu "revogar"** (que apagava a
   linha): a URL vem do `id`, nunca do token, então girar sorteia um segredo
   novo SEM trocar o endereço — quem chamava com o token antigo só precisa
   atualizar ele. Ver `lib/automation/CLAUDE.md`, regra 15.

### A chave do modo de ensaio (onda 7)

`<ChaveDeModo>` é **exportado de `automacoes/agendamentos-panel.tsx` e
importado pelo `webhooks-panel.tsx`** — um componente só, porque as duas
tabelas têm a coluna `modo` com o mesmo significado. Duas cópias divergiriam no
dia em que alguém melhorasse uma frase, e aí o aluno leria uma promessa em
Agendamentos e outra em Webhooks sobre a mesma coisa. **Se mudar o texto, muda
pros dois.**

Três decisões dele que parecem descuido e não são:

1. **Os dois sentidos têm botão, mas não o mesmo peso.** Em ensaio, "Ligar o
   modo real" avisa o que vai passar a sair pra fora. Em real, "Voltar pro
   ensaio" não tem aviso pesado nem confirmação — é a direção SEGURA, e o
   caminho só de ida existia por descuido da tela (o banco sempre aceitou os
   dois sentidos, ver `lib/automation/CLAUDE.md`, regra 12).
2. **`podeLigar` é "essa automação roda no MEU nome?", e vale pros DOIS
   sentidos.** Quem não é o `run_as` lê *"Clique em 'Assumir' pra poder ligar
   o modo real"* (ou, em real, *"… pra poder voltar pro ensaio"*) em vez de um
   botão que o banco recusaria — mesma disciplina da regra 3 aqui de cima.
3. **O ensaio do playground é estado da TELA, não do banco.** `useState(true)`
   em `agentes/[slug]/testar/playground.tsx`: recarregar a página volta pro
   padrão seguro. É ele que vira `modo` no `runAgentAction`. O **chat**
   (`/api/chat` → `streamAgentRun`) não tem ensaio nenhum e roda em real — é o
   produto na frente de alguém, que vê o resultado na hora.

⚠️ **A linha da lista MOSTRA o destino do resultado** (`paraOndeVaiOResultado`,
em `agendamentos-panel.tsx`) — é justamente porque não dá pra editar que
mostrar importa: sem isso, ninguém teria como CONFERIR pra onde a automação
manda.

⚠️ **`schedules.entrega` É coluna de ARQUIVO** — entra em
`COLUNAS_DO_AGENDAMENTO`, em `lib/seed/materializar.ts`, junto com nome, tipo,
horário etc. Nem sempre foi assim: quando o formulário de criação saiu (Task
9), `entrega` ainda estava classificada como "coluna da PESSOA" (protegida
daquela constante) — resíduo de quando só a tela sabia setá-la — e ficou
inalcançável: nem arquivo, nem tela criava agendamento com entrega por email.
Reclassificada na rodada de conserto seguinte porque `entrega` é
CONFIGURAÇÃO (o que o trabalho FAZ), não decisão operacional como
`is_active`/`modo`.

Declarar `entrega: { tipo: "email", para: [...] }` em `ScheduleBlueprint`
(`lib/automation/blueprint.ts`) **não faz nenhum email sair sozinho** — as
duas travas humanas continuam de pé: o agendamento nasce `is_active: false`
(só uma PESSOA liga, numa tela que diz o que vai passar a acontecer — regra
10-L) e `modo` nasce `'ensaio'` (nesse modo `ctx.acao` não age de verdade —
regra 10-K). `agendamentoParaInsert` valida com `entregaDeEntradaSchema` (o
MESMO schema que a extinta tela de criação usava): aceita `nenhuma` e
`email`, nunca `conexao` — não existe catálogo de conexão pra validar o
`slug` contra (guardado pra "a onda das conexões").

⚠️ **O rastro avisa o ensaio FORA do bloco que abre/fecha — e diz O QUÊ.** Em
`components/app/run-trace.tsx`, o "✋ Ensaio — eu teria mandado um email para
chefe@empresa.com com o assunto …" fica fora do `{aberto && …}` de propósito:
quem só bate o olho no rastro acharia que o email saiu, e o modo ensaio
perderia o sentido. A frase pronta vem do `detalhe` do passo (montada em
`lib/agents/acoes.ts`); a genérica "eu teria feito isso, mas nada saiu pra
fora" ficou só de rede, pra passo gravado antes desta revisão.

## A tela de Início (`dashboard/`)

```
dashboard/page.tsx              monta a tela (requireOrgMember; passa `administra`)
dashboard/proximos-passos.tsx   "o que falta configurar" (Server)
dashboard/kpi-card.tsx          um número (Server)
dashboard/dashboard-chart.tsx   custo por dia ("use client" — Recharts mede a tela)
dashboard/ultimas-execucoes.tsx as 5 últimas (Server)
dashboard/proximas-automacoes.tsx  o que roda sozinho (Server, só owner/admin)
```

⚠️ **Ela já foi um demo com `lib/mock/`, e `lib/mock/` NÃO EXISTE MAIS.** O
problema não era o gráfico ser inventado: era a tela deixar o aluno ir embora
achando que estava tudo pronto **sem avisar que faltava cadastrar uma chave de
IA**. Se você for mexer aqui, quatro regras vieram de defeito medido:

1. **`lib/dashboard/queries.ts` NUNCA LANÇA.** É a tela pra onde todo caminho
   leva de volta (o guard redireciona pra cá, o "voltar" cai aqui). Um bloco
   que não carregou aparece zerado; a tela continua de pé. Mesma disciplina de
   `getBudgetStatus`.
2. **Degrau que a pessoa não pode cumprir NÃO vira botão.** Chave, agente, teto
   e subir documento são de owner/admin. Membro comum lê o degrau (é ele que
   explica por que o agente não responde) com um recado no lugar do botão — e o
   degrau do teto some de vez. Um botão que leva pra tela onde a pessoa é
   chutada é pior que botão nenhum. Quem decide é `lib/dashboard/passos.ts`,
   que é puro e tem teste.
3. **Contagem de execução é `count: "exact"`, não `listRuns(...).length`.** A
   listagem tem teto de 200 linhas; num workspace movimentado o cartão diria
   "200" pra sempre.
4. **`formatRelativeTime` ("há 4 min") só em componente de servidor.** Num
   `"use client"` o servidor escreve um texto e o navegador recalcula outro
   poucos segundos depois.

E a escala do dinheiro muda dentro da mesma tela, de propósito: o cartão "gasto
do mês" usa `formatTetoUsd` (2 casas, escala de mês); o gráfico e a lista de
execuções usam `formatUsdFromMicros` (4 casas), porque um dia de uso custa
frações de centavo e 2 casas viraria "US$ 0,00" repetido.

## Filtros na URL (padrão de `execucoes/`)

Filtro de listagem mora na URL, não em estado da tela — assim o aluno copia o
endereço e manda pra alguém, e o botão "voltar" funciona.

- **Nomes em PT-BR** (`?agente=&status=&periodo=`): a URL é visível pro aluno.
- **Valores de enum em inglês** (`status=failed`): são exatamente os valores do
  banco; traduzir ali criaria uma tabela de conversão pra manter.
- **Tudo que vem da URL é conferido contra uma lista de valores aceitos** antes
  de entrar na consulta. `searchParams` é digitado por qualquer um.

## Como criar uma nova página (checklist)

1. Crie pasta dentro de `app/(app)/app/[orgSlug]/` (ex: `clientes/`)
2. Crie `page.tsx` Server Component que chama `requireOrgMember` + queries
3. Se for listagem: crie `<feature>-table.tsx` Client Component + `<feature>-columns.tsx`
4. Se tem detalhe: crie `[id]/page.tsx` e `[id]/<feature>-detail-form.tsx`
5. Para criar/editar: dialog (`<NewFeatureDialog>`) ou rota separada (`/new/page.tsx`)
6. Adicione item em `config/nav.config.ts` se a feature precisa de link (com
   `roles: ["owner", "admin"]` quando a página é `requireOrgRole` — item de menu
   que leva pra tela onde a pessoa é chutada é pior que item nenhum)
7. Se for página admin only, use `requireOrgRole({ orgSlug, roles: ['owner', 'admin'] })`

## Padrão de Server Action consumido pela página

- Action fica em `lib/<dominio>/actions.ts` com `"use server"` no topo
- Form Client chama via `useTransition` + toast pra erro
- Action retorna `{ ok: true; data?: T } | { ok: false; error: string }`

## Layout

O `layout.tsx` desta pasta já fornece:
- `SidebarProvider` (com toggle)
- `AppSidebar` (com OrgSwitcher + nav)
- `AppHeader` (com theme toggle + user dropdown)
- `<BudgetBanner>` — a faixa do **teto de gasto com IA**, no topo do conteúdo
- `<main className="flex-1 p-6">` envolvendo `{children}`

Você **não precisa** adicionar header/sidebar em páginas filhas. Só foca no conteúdo.

⚠️ **A faixa do teto mora no layout de propósito**, e não na tela de Limites:
quando os agentes param, a pessoa está no chat ou em Automações — uma faixa que
só aparece em Configurações avisaria justamente quem já foi procurar o problema.
Ela some sozinha quando não há o que dizer (`budgetBanner` devolve `null`), e a
leitura que a alimenta (`getBudgetStatus`) **nunca lança**: sem isso, uma
consulta que piscou derrubaria todas as telas do workspace de uma vez.

## Convenções de UI

- Página começa com `<div className="space-y-8">` (listagem) ou `<div className="max-w-2xl space-y-8">` (form-focused)
- Header da página: bloco com `<span className="label-mono">/ recurso</span>` + `<h1 className="font-semibold text-3xl tracking-tight">`
- Cards: `<Card>` com `<CardHeader className="border-b border-border/60 bg-card/40 py-3">` e `<CardTitle className="label-mono text-[10px]">/ secao</CardTitle>`
- Botões: variantes default/outline/ghost/destructive — `Button` do shadcn
- Toasts: `import { toast } from "sonner"` (success e error)
- Empty state: `<EmptyState>` de `@/components/app/empty-state`
- **Link dentro de Button:** `<Button render={<Link href="..." />} nativeButton={false}>Texto</Button>` (base-ui pattern; `nativeButton={false}` necessário pq Link renderiza `<a>`)

## Quando precisar criar UM novo componente reutilizável

Decisão simples:
- **Reutilizável globalmente?** → `components/app/<nome>.tsx`
- **Usado só nessa página?** → mesmo diretório da `page.tsx`, com sufixo descritivo (ex: `client-table.tsx`)
- **Primitive shadcn que falta?** → `npx shadcn@latest add <componente>`
