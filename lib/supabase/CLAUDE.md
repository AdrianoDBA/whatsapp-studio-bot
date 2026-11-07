# CLAUDE.md — lib/supabase

## Responsabilidade

Wrappers de Supabase client e padrões de acesso ao banco.

## Clients

- `client.ts` — `createClient()` browser-side (use em Client Components)
- `server.ts` — `createClient()` server-side (use em RSC, Server Actions, route handlers)
- `middleware.ts` — `updateSession()` refresca cookies (chamado pelo `proxy.ts` da raiz)

**NUNCA** importe `server.ts` em Client Components — quebra build.

## Padrão de query

Queries server-side ficam em pastas de domínio com sufixo `queries.ts` (ex: `lib/orgs/queries.ts`). Padrão:

```typescript
import { createClient } from "@/lib/supabase/server";

export async function getMyThings(orgId: string) {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("my_things")
    .select("id, name, created_at")
    .eq("organization_id", orgId);
  if (error) throw error;
  return data ?? [];
}
```

- Selecione colunas explicitamente quando a tabela tiver colunas grandes ou
  sensíveis que a tela não usa. Para tabelas estreitas cujo tipo é a `Row`
  inteira (ex: `lib/agents/queries.ts`), `select("*")` é aceitável — lista
  explícita ali faz toda coluna nova voltar `undefined` em silêncio até
  alguém lembrar de editar a query.
- **Nunca use `as unknown as` pra tipar relação embutida.** O supabase-js já
  infere o tipo a partir de `types/supabase.ts`. Se não bater, o certo é rodar
  `npm run types`, não desligar a checagem.
- Sempre verifique `error` antes de retornar `data`
- Use `.maybeSingle()` quando esperar 0 ou 1 resultado; `.single()` quando deve ter exatamente 1

## Como criar uma nova tabela escopada por org

1. Crie `supabase/migrations/YYYYMMDDHHmmss_<feature>.sql` (timestamp atual)
2. Use `_TEMPLATE_org_scoped_table.sql.example` como referência — ele já traz
   o `grant`, o índice composto e as policies certas
3. Aplique com `npm run migrate` (em produção o container aplica sozinho ao ligar)
4. Rode `npm run types` pra atualizar `types/supabase.ts`

**A migration precisa poder rodar duas vezes.** O container aplica migrations
toda vez que liga; uma que quebra na segunda execução trava o deploy. Use
`if exists` / `if not exists`. Postgres não tem `create policy if not exists` —
faça `drop policy if exists` antes.
3. Substitua `MY_TABLE` pelo nome da sua tabela (snake_case, plural)
4. Adicione suas colunas
5. Aplique a migration: cole no Supabase SQL Editor → Run
6. Rode `npm run types` pra regenerar `types/supabase.ts`
7. Commit a migration **junto** com `types/supabase.ts`

> Nota: o banco é montado por migrations sequenciais em `supabase/migrations/`. Não existe `schema.sql` consolidado — cada feature/fix é uma migration nova com timestamp maior que a última.

## Regras absolutas

### RLS

- **Toda tabela de domínio TEM `organization_id`** + `enable row level security` + 4 policies usando `is_org_member` / `has_org_role`
- **NÃO use `FORCE ROW LEVEL SECURITY`** — `ENABLE` é suficiente. `FORCE` causa recursão infinita com helpers `SECURITY DEFINER` que consultam a mesma tabela protegida

#### As DUAS exceções (lista fechada — não aumente)

| Tabela | O que foge | Por quê | O que protege |
|---|---|---|---|
| `platform_admins` | não tem `organization_id` | é o nível ACIMA de workspace: quem é dono do sistema inteiro | RLS com uma policy de SELECT via `is_platform_admin()`; nenhuma policy de escrita — entrar e sair da lista é pelas funções `add_platform_admin` / `remove_platform_admin` no SQL Editor |
| `credentials` | `organization_id` é **nullable** | nulo = "chave da plataforma, vale pra todos os workspaces" | RLS + `can_manage_credential()` + dois índices únicos parciais (um por escopo) + `grant select` **coluna a coluna**, deixando `ciphertext` de fora |

**Não copie esse padrão numa tabela sua.** Se a tabela guarda dado de um time,
ela precisa de `organization_id uuid not null`. As duas linhas acima são
decisões de arquitetura conferidas uma a uma; copiar a forma sem o resto do
aparato é como o isolamento entre workspaces vaza.

### Tabela nova escopada por org: o passo que todo mundo esquece

Depois de criar a tabela e rodar `npm run types`, acrescente um bloco pra ela
em **`lib/agents/tool-context.ts`**. É o mapa que diz quais tabelas uma
ferramenta de agente pode tocar (sempre já filtradas pelo workspace). Sem o
bloco, nenhuma ferramenta enxerga a tabela — e o esquecimento aparece como erro
de compilação com o nome que falta, não como dado vazando.

### `TRUNCATE` vem liberado por padrão (armadilha)

O Supabase concede `TRUNCATE` a `anon` e `authenticated` em toda tabela nova,
e **TRUNCATE ignora a RLS**. As migrations de agentes e do cofre fazem
`revoke all` antes de conceder o que precisa. Faça o mesmo nas suas:
`revoke all on public.MINHA_TABELA from anon, authenticated;` antes dos
`grant select, insert, update, delete`.
- **Nunca remova RLS de uma tabela existente** sem aprovação
- **Nunca bypassa RLS com `service_role_key`** pra "fazer funcionar"

### Helpers RLS (is_org_member, has_org_role)

Toda função SQL usada em policy DEVE ter:
- `security definer` — roda como dono da função
- `set search_path = public` — evita escalation via search_path mutation
- **`set row_security = off`** — OBRIGATÓRIO se a função consulta uma tabela com RLS habilitada que tem policy chamando essa MESMA função (recursão infinita: policy → função → tabela → policy → função → ...)

Modelo correto:

```sql
create or replace function public.is_org_member(_org_id uuid)
returns boolean
language sql
security definer
stable
set search_path = public
set row_security = off    -- crítico, não remover
as $$
  select exists (
    select 1 from public.memberships
    where organization_id = _org_id
      and user_id = auth.uid()
  );
$$;

revoke execute on function public.is_org_member(uuid) from public, anon;
grant execute on function public.is_org_member(uuid) to authenticated;
```

### Triggers obrigatórios

- **`set_updated_at`** — toda tabela com coluna `updated_at`
- **`freeze_org_and_creator`** — toda tabela escopada por org (impede que membro malicioso mude `organization_id` ou `created_by` da própria linha)

### Service role key

**NUNCA** importe `SUPABASE_SERVICE_ROLE_KEY` em código que roda no browser. Só em Server Action quando há necessidade real (ex: criar user via Admin API). Bypass de RLS é último recurso.

## Convenções de naming SQL

- Tabelas: `snake_case`, plural (`organizations`, `memberships`, `invitations`)
- Colunas: `snake_case`, singular (`organization_id`, `created_at`)
- Foreign keys: `<tabela_singular>_id`
- Indexes: `<tabela>_<coluna>_idx`
- Policies: nome descritivo em inglês, lower-case, sem prefixo (ex: `"members read their orgs"`)

## Onde NÃO criar queries

- Em Client Components (use Server Action que internamente faz query)
- Em utilitários puros (sem `"use server"`) que rodam no client
