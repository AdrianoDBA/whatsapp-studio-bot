# CLAUDE.md — lib/seed

## O que essa pasta faz

Responde a pergunta **"o que este produto tem dentro?"** — e leva essa resposta
pra dentro de cada workspace.

```
registro.ts      A LISTA. É aqui que o aluno (via Claude Code) declara.
recurso.ts       O MOLDE. O algoritmo de materialização, escrito UMA vez.
materializar.ts  Os tipos que existem hoje, cada um como uma declaração.
semear.ts        Leva pros workspaces que JÁ existem, no nome do dono de cada.
```

Roda em três momentos, e os três são o mesmo caminho:

| Quando | Quem chama |
|---|---|
| workspace novo nasce | `createOrganizationAction` |
| todo deploy | `docker-entrypoint.sh` → `scripts/semear.mjs` |
| na mão, em dev | `npm run semear` |

## A regra que manda aqui (10-N)

**Definição nasce em arquivo; a tela só opera.**

Não crie formulário de criação. Ele vira um segundo dono da verdade: o banco
passa a divergir do repositório e nada acusa — o `npm run semear` seguinte
simplesmente não enxerga a linha que o formulário criou.

Tela nova responde "quem faz isso?":

- **o aluno construindo o produto** → é arquivo (`registro.ts`)
- **alguém usando o produto pronto** → é tela

`tests/sem-telas-de-montagem.test.ts` monta guarda.

---

## Como acrescentar UM TIPO NOVO de coisa declarada

É aqui que o template deixa de ser "plataforma de agentes" e vira o que o aluno
quiser: um CRM declara `PIPELINES`, uma loja declara `CATEGORIAS`, um ERP
declara `CENTROS_DE_CUSTO`. O caminho é sempre o mesmo, e **você não reescreve
o algoritmo** — se estiver copiando lógica de leitura/escrita, parou no lugar
errado.

### 1. A tabela (migration)

Tabela de domínio nova segue a regra 1 do CLAUDE.md raiz: `organization_id not
null`, RLS habilitada, policies com `is_org_member` / `has_org_role`. Use
`supabase/migrations/_TEMPLATE_org_scoped_table.sql.example`.

Além disso, o materializador precisa de duas colunas:

```sql
-- A identidade que o arquivo usa pra achar a linha. NULLABLE de propósito:
-- linha criada à mão, antes deste caminho existir, tem slug nulo e nunca conta
-- como duplicata.
slug text,
-- Como se aposenta. Toda coisa declarada precisa de um jeito de sair de
-- circulação sem ser apagada — ver "Aposentar", mais abaixo.
status text not null default 'active',

-- Índice PARCIAL, e o `where` não é enfeite (ver "Nunca use upsert").
create unique index if not exists minha_tabela_org_slug_uidx
  on public.minha_tabela (organization_id, slug) where slug is not null;
```

### 2. A planta (arquivo puro, com validação)

Um tipo mais uma função que vira linha. Sem banco, sem `async` — dá pra testar
no Vitest direto. Espelhe `lib/knowledge/blueprint.ts`, que é o menor dos
quatro.

```ts
export type PipelineBlueprint = {
  slug: string;
  name: string;
  status?: "active" | "archived";
};

export function pipelineParaInsert(
  bp: PipelineBlueprint,
  organizationId: string,
  ownerId: string,
): TablesInsert<"pipelines"> {
  exigir(SLUG_RE.test(bp.slug), `apelido "${bp.slug}" fora do formato`);
  return {
    organization_id: organizationId,
    created_by: ownerId,   // 🔴 a policy de INSERT quase sempre exige isto
    slug: bp.slug,
    name: bp.name.trim(),
    status: bp.status ?? "active",
  };
}
```

⚠️ **`created_by` já foi esquecido uma vez**, na base de conhecimento, e o
resultado foi que NENHUMA base declarada em código conseguia nascer — em
ambiente nenhum — enquanto a suíte inteira ficava verde (o dublê de teste não
tem regra de segurança). Confira a policy de INSERT da sua tabela antes.

### 3. A tabela entra em `TabelaDeclarada` (`recurso.ts`)

Uma linha. É ela que faz o TypeScript conferir o resto.

### 4. A declaração (`materializar.ts`)

```ts
function recursoDosPipelines(
  organizationId: string,
  ownerId: string,
): Recurso<PipelineBlueprint, "pipelines"> {
  return {
    tabela: "pipelines",
    descricao: "os funis",
    mensagemAoGravar: "não deu pra gravar os funis deste workspace",
    mensagemAoAtualizar: "não deu pra atualizar os funis deste workspace",
    colunas: ["name", "status"],
    colunasDoBanco: ["organization_id", "created_by", "slug"],
    colunasDaPessoa: [],
    apelido: (bp) => bp.slug,
    paraInserir: (bp) => pipelineParaInsert(bp, organizationId, ownerId),
  };
}
```

E chame em `materializarWorkspace`:

```ts
const pipelines = await materializarRecurso(
  db, organizationId, recursoDosPipelines(organizationId, ownerId), PIPELINES,
);
```

### 5. A lista, em `registro.ts`

```ts
export const PIPELINES: readonly PipelineBlueprint[] = [];
```

### 6. Se a automação for tocar na tabela: a ponte

Acrescente as colunas em `COLUNAS_DA_PONTE`
(`lib/automation/postgrest-bridge.ts`). **A compilação já cobra isso de você**,
nomeando a coluna que falta — é uma guarda de tipo, não um checklist. Sem ela o
sintoma é o pior do template: *funciona no painel, falha às 8h da manhã.*

### 7. O teste que você ganha de graça

`tests/seed-recurso.test.ts` tem um bloco que exige que **toda coluna que o seu
INSERT escreve esteja classificada** numa das quatro listas. Acrescente seu
recurso lá: uma coluna nova que ninguém classificou reprova no `npm run verify`
**com o nome dela**.

---

## A matriz de posse: de quem é cada coluna

Toda coluna que o INSERT escreve cai em UMA destas gavetas. Não existe quinta,
e "esqueci de classificar" reprova no `npm run verify`.

| Gaveta | Quem manda | Exemplos | O que acontece na re-materialização |
|---|---|---|---|
| `colunas` | **o arquivo** | nome, prompt, modelo, horário | é reescrita toda vez |
| `colunasSoAoNascer` | o arquivo, uma vez | `label`, `esperar_resposta` do webhook | gravada ao nascer, nunca mais |
| `colunasDoBanco` | o banco | `organization_id`, `created_by`, `slug`, `embedding_model`, `token_hash` | nunca tocada (algumas são imutáveis por gatilho) |
| `colunasDaPessoa` | quem opera | `is_active`, `run_as` | nunca tocada — reescrever desfaria decisão de gente |

⚠️ **`modo` não está em gaveta nenhuma, e é de propósito**: o INSERT não escreve
essa coluna. Automação nasce em `'ensaio'` por PADRÃO DO BANCO (regra 10-L), e
quem liga o modo real é uma pessoa, numa tela que diz o que vai passar a
acontecer.

## Aposentar: como uma coisa declarada sai de circulação

**Nunca apagando.** O materializador não tem `delete`, e o dublê de teste
**lança** se alguém chamar um — o ganho (arrumação) não paga sumir com a base de
conhecimento de um cliente porque alguém renomeou um arquivo.

A saída é o **túmulo**: a declaração fica no arquivo, marcada como aposentada.

```ts
export const BASES = [
  { slug: "politicas-velhas", name: "Políticas (2024)", status: "archived", ... },
];
```

Por que túmulo e não "sumiu do arquivo = morreu": apagar uma linha é fácil
demais, e a consequência seria invisível. Marcar é um ato deliberado, e o
arquivo continua contando a história.

Cada tipo aplica `archived` no lugar certo, e **aplicar é obrigação sua**:

| Tipo | Aposentado quer dizer |
|---|---|
| agente | motor recusa, chat recusa, automação recusa (5 lugares) |
| base de conhecimento | some da busca do agente, não aceita documento novo |
| agendamento / webhook | herdam do agente: `archived` no agente para tudo que é dele |

⚠️ **Coluna `status` sem ninguém conferindo ela é pior que não ter**: a tela
promete que aposentar faz algo, e não faz. Se acrescentar um tipo, escreva o
teste que prova que aposentado realmente para.

## Nunca use `upsert` aqui

Não é cautela — é o único jeito que FUNCIONA, e os três motivos foram
descobertos rodando contra Postgres de verdade:

1. **Índice parcial.** `.upsert({onConflict})` não sabe emitir o `WHERE` que a
   inferência de `ON CONFLICT` exige pra usar um índice parcial como árbitro. O
   Postgres recusa com `42P10` na PRIMEIRA execução, sem conflito nenhum.
2. **`created_by` é imutável** por gatilho. O ramo de UPDATE do upsert tenta
   reescrever, e o gatilho recusa — e nenhuma tela conserta essa coluna.
3. **Upsert cego desliga automação que uma pessoa ligou.** O insert grava
   `is_active: false` (certo na criação); o ramo de UPDATE carregaria esse
   `false` junto, calado.

## Onde tem teste, e o que ele prova

| Arquivo | O que prova |
|---|---|
| `tests/seed-recurso.test.ts` | o MOLDE, pra qualquer tipo: escopo por workspace, idempotência, pular, nunca apagar, e a classificação total das colunas |
| `tests/seed-materializar.test.ts` | os quatro tipos de hoje, ponta a ponta, contra um dublê que filtra de verdade |
| `tests/seed-registro.test.ts` | as declarações são válidas ANTES de qualquer coisa chegar no banco |
| `tests/seed-semear.test.ts` | a impersonação e o "pulado" |
| `tests/sem-telas-de-montagem.test.ts` | ninguém recriou formulário de criação |

⚠️ **O dublê já encenou garantia duas vezes neste código.** Quando ele
implementava `upsert` como merge de Map, ele *estagionava* idempotência em vez
de prová-la — e quatro defeitos graves passaram por revisão verde. Teste com
dublê prova formato e fluxo; **idempotência e regra de segurança só se provam
contra Postgres de verdade**. Antes de dizer que um tipo novo funciona: popule a
lista, rode `npm run semear` duas vezes contra o banco de dev, e confira que a
segunda não escreveu nada.

## Quando estiver perdido

Leia `recurso.ts` de cima a baixo — são ~200 linhas de algoritmo e o resto é o
porquê de cada guarda. Depois olhe um dos quatro recursos em `materializar.ts`
como exemplo. `registro.ts` é onde você mexe no dia a dia.
