# CLAUDE.md — lib/auth

## Responsabilidade

Camada de autenticação. Fornece:
- Server Actions de signup/signin/signout/reset password
- Guards usados em RSC e Server Actions pra proteger rotas

## Guards disponíveis

Definidos em `lib/auth/guards.ts`:

### `requireUser()`
Retorna `User` ou redireciona pra `/login`. Use em rotas que precisam de auth mas não dependem de org.

```typescript
import { requireUser } from "@/lib/auth/guards";

export default async function Page() {
  const user = await requireUser();
  return <div>Olá, {user.email}</div>;
}
```

### `getCurrentUser()`
Retorna `User | null` sem redirect. Use quando o comportamento muda baseado em estar logado ou não.

### `requireOrgMember({ orgSlug })`
Retorna `{ user, org, role }`. Redireciona se user não for membro da org indicada pelo slug.

**OBRIGATÓRIO em toda página dentro de `/app/[orgSlug]/`.**

```typescript
import { requireOrgMember } from "@/lib/auth/guards";

export default async function Page({ params }: { params: Promise<{ orgSlug: string }> }) {
  const { orgSlug } = await params;
  const { user, org, role } = await requireOrgMember({ orgSlug });
  // ...
}
```

### `requireOrgRole({ orgSlug, roles })`
Como `requireOrgMember`, mas valida que o role do user está na lista permitida. Redireciona pra `/dashboard` da org se não tiver permissão.

Use em páginas de settings que só admin/owner podem acessar.

```typescript
const { user, org } = await requireOrgRole({
  orgSlug,
  roles: ["owner", "admin"],
});
```

## Guards do DONO DA PLATAFORMA

Papel que existe **fora** de qualquer workspace: é quem cadastra as chaves de
API que valem pra todos os times (a tela `/plataforma/configuracoes`).
Normalmente é uma pessoa só — quem instalou o app. Quem é dono está na tabela
`platform_admins`, e a regra de segurança dela só deixa **dono** ler a lista.

### `isPlatformAdmin(userId)`
`Promise<boolean>`, sem redirect. Recebe o id em texto porque é `cache()`-ada
(uma ida ao banco por requisição), e `cache()` só funciona com argumento
simples. Use pra DECIDIR O QUE MOSTRAR (ex.: o grupo "plataforma" da barra
lateral) — nunca como única proteção.

### `requirePlatformAdmin()`
Pra `page.tsx` / `layout.tsx` de `/plataforma`. Devolve `User`, igual ao
`requireUser()`. Sem sessão → `/login`. Logado mas não é dono → volta pro
painel do primeiro workspace dele (ou `/onboarding`). **Nunca conta pra pessoa
que a página existe.**

```typescript
export default async function PlataformaLayout({ children }) {
  const user = await requirePlatformAdmin();
  // ...
}
```

### `assertPlatformAdmin()`
Pra Server Action: `Promise<boolean>`, **não redireciona**. Toda função
`"use server"` é um endereço HTTP público — chamável sem passar pela tela —,
então a checagem mora DENTRO da função e o retorno vira `{ ok: false, error }`
em PT-BR.

```typescript
if (!(await assertPlatformAdmin())) {
  return { ok: false, error: "Só o dono do sistema pode mexer nessas chaves." };
}
```

> **Trava conhecida:** se o único dono apagar a própria conta, ninguém mais
> cadastra chave de plataforma. A saída (`select add_platform_admin('email')`
> no SQL Editor) está comentada no topo de
> `supabase/migrations/20260820010000_platform_admins.sql`, e a própria tela
> avisa quando existe um dono só.

## Server Actions

Definidas em `lib/auth/actions.ts`. Todas seguem o padrão:

```typescript
type ActionResult<T = void> = { ok: true; data?: T } | { ok: false; error: string };
```

Sempre tratamos erros e traduzimos pra PT-BR (ver `traduzirErroSupabase` na própria action).

## Como criar uma nova action

1. Defina schema Zod em `lib/auth/schemas.ts` (ou pasta de domínio específica)
2. Marque o arquivo com `"use server";` no topo
3. Valide input com `schema.safeParse()`
4. Use `await createClient()` de `@/lib/supabase/server`
5. Retorne `ActionResult` — nunca exception não-tratada
6. Se modificar dados, chame `revalidatePath()` no final

## Onde NÃO usar guards

- Em Client Components (são server-only)
- Em rotas estáticas / API públicas
- No `proxy.ts` (use `updateSession` direto)

## Public paths

Rotas que NÃO requerem auth (definidas em `proxy.ts`, constante `PUBLIC_PATHS`):
`/`, `/login`, `/signup`, `/reset-password*`, `/verify-email`, `/auth/*`,
`/aceitar-convite`, `/api/health`

> `/aceitar-convite` é pública de propósito: quem recebe convite por email
> normalmente ainda não tem conta. A página trata os dois casos e só consulta o
> banco depois de saber se a pessoa está logada.

## Regras absolutas

### Troca de senha
- **`updatePasswordAction` valida o cookie `recovery_flow` dentro da própria
  função.** Não basta validar na página: toda função `"use server"` é um
  endereço HTTP público, chamável sem passar pela tela. Sem essa checagem,
  qualquer sessão roubada troca a senha da vítima sem saber a senha antiga.
  Se um dia existir "trocar senha nas configurações", crie uma **segunda**
  função exigindo a senha atual — não afrouxe esta.

### Senhas
- **Mínimo 10 caracteres** — definido em `lib/auth/schemas.ts`. Não relaxe sem aprovação.

### Signup
- **NUNCA confirme se um email já está cadastrado.** Mesmo retorno genérico pra email novo e email existente. Evita user enumeration (atacante descobrir quem é cliente da plataforma).

### Redirects pós-auth
- **Toda redirect baseado em `next` query param valida** contra `//evil.com`, `/\\evil.com`, encoded variants. Use o helper `safeNext` (já implementado). Sem isso, atacante envia link com `?next=//evil.com` e usuário logado é jogado pra fora.

### Mensagens de erro
- **Nunca devolva `error.message` cru do Supabase pro client.** Traduz pra mensagem leiga em PT-BR (ver `traduzirErroSupabase` na action). Loga server-side com `console.error` pra debug.
