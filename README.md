# Elite da IA — Template

Template **SaaS multi-tenant** em Next.js 16 + Supabase, feito pra você construir seu produto conversando com o **Claude Code** em português.

> Pensado pra leigos. Você descreve o que quer ("quero uma página de pedidos"), o Claude Code constrói seguindo os padrões do template.

## Stack

Next.js 16 (App Router) · TypeScript · Tailwind CSS 4 · shadcn/ui · Supabase (Postgres + Auth + Storage + RLS) · React Hook Form + Zod · Recharts · Vercel AI SDK · Biome

## O que vem pronto

**Autenticação & multi-tenant**
- Signup, login, recuperação de senha
- Workspaces (organizações) isolados via Row Level Security do Postgres
- Convites por email, roles (owner / admin / member)

**Agentes de IA**
- Agentes nascem de um arquivo que o Claude Code escreve a seu pedido: instruções, modelo e ferramentas (nada de chave no código)
- Conversa com cada agente, com a resposta chegando aos poucos e o custo de cada uma
- Base de conhecimento: sobe PDF/texto/planilha e o agente responde com os seus documentos
- Automações: o agente roda na hora marcada ou quando um sistema de fora chama um webhook
- Execuções: histórico com o passo a passo de cada rodada e quanto custou
- Chave de API guardada com AES-256-GCM, cadastrada pelas telas (OpenRouter, Anthropic, OpenAI, Google)

**Interface**
- Tema escuro com identidade visual já configurada
- Tela de Início com o que ainda falta configurar e os números de verdade do seu workspace (execuções, gasto do mês, agentes no ar)
- Configurações de perfil e do workspace (com upload de logo)

**Tooling de desenvolvimento**
- Padrões do template explicados pro Claude Code em arquivos `CLAUDE.md` espalhados pelo projeto
- Dockerfile + docker-compose prontos pra deploy em VPS (EasyPanel)
- Biome (lint + format) e Vitest configurados
- Documentação detalhada em `docs/` (6 capítulos pra leigos)

---

## Antes de começar

Você precisa ter instalado:

- [ ] **Node.js 22+** ([nodejs.org](https://nodejs.org/) — escolha a versão LTS)
- [ ] **Git** ([git-scm.com](https://git-scm.com/downloads))
- [ ] **Claude Code** ([claude.com/claude-code](https://claude.com/claude-code))
- [ ] Conta gratuita no **Supabase** ([supabase.com](https://supabase.com))

Cheque que está tudo no lugar:

```bash
node --version    # v22.x.x ou maior
npm --version     # 10.x.x ou maior
git --version     # git version 2.x.x
```

Travou em algum passo? O guia completo de instalação está em [`docs/01-comecando/02-instalando-tudo.md`](./docs/01-comecando/02-instalando-tudo.md).

---

## Como começar (~20 minutos)

> Tempo realista incluindo criar projeto Supabase (~2 min de provisionamento) e aplicar o schema. Não é "5 min" — é um SaaS completo.

### 1. Extraia o template e instale dependências

1. Baixe o `.zip` do template e extraia numa pasta — pode renomear pra qualquer nome (ex: `meu-saas`).
2. Abra o terminal **dentro dessa pasta** (no VS Code: `Ctrl+\`` ou **Terminal → New Terminal**; o terminal já abre no diretório certo).
3. Instale as dependências:

```bash
npm install
```

4. (Recomendado) Inicialize um repositório Git novo pra você poder versionar seu próprio projeto:

```bash
git init
git add .
git commit -m "primeiro commit"
```

> Mais tarde, pra publicar, você cria um repositório no GitHub e dá `git push` — mas isso fica pro guia de [publicação](./docs/04-publicando/).

### 2. Crie um projeto no Supabase

Vá em [supabase.com](https://supabase.com) → **New Project**. Espere ~2 min até ficar pronto. Em **Settings → API**, anote:

- **Project URL** (tipo `https://xxxxx.supabase.co`)
- **anon (public) key** (começa com `eyJ...`)
- **Project ID** (a parte `xxxxx` da URL — só precisa pro `npm run types`)

> Você vai ver uma **service_role key** nessa mesma tela. **Não copie.** Este
> template não usa nenhuma: tudo passa pelas regras de segurança do banco, com
> a chave `anon`. Uma `service_role` solta num arquivo abre o banco inteiro.

### 3. Configure o `.env.local`

Copie o template de variáveis:

```bash
# Mac/Linux
cp .env.example .env.local

# Windows (PowerShell)
Copy-Item .env.example .env.local
```

Abra o `.env.local` no seu editor e preencha **as quatro** (são só essas — não existe variável opcional neste template):

```env
SUPABASE_URL=https://xxxxx.supabase.co
SUPABASE_ANON_KEY=eyJ...
DATABASE_URL=postgresql://postgres:SUA-SENHA@db.xxxxx.supabase.co:5432/postgres
ENCRYPTION_KEY=cole-aqui-a-chave-que-voce-gerar
```

| Variável | Onde pegar |
| --- | --- |
| `SUPABASE_URL` | Settings → API → **Project URL** |
| `SUPABASE_ANON_KEY` | Settings → API → chave **anon public** |
| `DATABASE_URL` | Settings → Database → **Connection string** → aba **URI** (troque `[YOUR-PASSWORD]` pela senha do banco) |
| `ENCRYPTION_KEY` | Você mesmo gera, com o comando abaixo |

A `ENCRYPTION_KEY` é o cadeado que tranca as chaves de API que você cadastra depois pelas telas do app. Gere a sua assim:

```bash
npm run gerar-chave
```

> ⚠️ **Guarde essa chave.** Perder a `ENCRYPTION_KEY` = perder todas as chaves de API cadastradas no app. Não existe recuperação — o conserto é recadastrar uma por uma.

Chave de IA (OpenRouter, Anthropic, OpenAI, Google) e chave de email (Resend) **não ficam no `.env`**: você cadastra pelas telas, com o site já rodando. Enquanto não cadastrar, os emails do app aparecem no log do terminal e as telas de IA avisam que falta configurar.

> ⚠️ Nunca commite o `.env.local`. O `.gitignore` já protege.

### 4. (Opcional) Mude o nome do app

Abra `config/app.config.ts` e edite o campo `name`:

```ts
export const appConfig = {
  name: "Meu SaaS",   // ← seu nome aqui
  // ...
}
```

Esse nome aparece no `<title>` da aba, no header, no footer e nos emails.

### 5. Crie as tabelas do banco

```bash
npm run migrate
```

Pronto. Ele olha a pasta `supabase/migrations/`, vê o que ainda não existe no
seu banco e cria — na ordem certa, pulando o que já está lá.

> Em produção você nem precisa rodar isso: **o app faz sozinho toda vez que
> liga**. É pra isso que serve o `DATABASE_URL`.
>
> Daqui pra frente, toda mudança no banco (criar tabela, adicionar coluna) vira
> um arquivo novo em `supabase/migrations/`. O Claude Code escreve o arquivo, e
> `npm run migrate` (ou o próximo deploy) aplica.
>
> Precisa **zerar o banco** e começar do zero? Cole `supabase/reset-dev.sql` no
> SQL Editor do Supabase → Run. Depois rode `npm run migrate` de novo.

### 6. Rode o app

```bash
npm run dev
```

Abra [http://localhost:3000](http://localhost:3000), clique em **Começar agora**, crie sua conta e seu primeiro workspace.

> Quer ver a parte de IA funcionando? Cadastre uma chave em **Configurações →
> Integrações** e siga [`docs/06-agentes-de-ia/`](./docs/06-agentes-de-ia/01-o-que-e-um-agente.md).
> Pra testar **automação** na sua máquina, rode `npm run worker` num segundo
> terminal — o `npm run dev` sobe só o site.

---

## Travou? Erros comuns

| Sintoma | Causa provável | Solução |
| --- | --- | --- |
| `Failed to fetch` / `Invalid API key` | Chaves erradas no `.env.local` | Confira `SUPABASE_URL` e `SUPABASE_ANON_KEY` e **reinicie** o `npm run dev` |
| `relation "X" does not exist` | As tabelas não foram criadas | Rode `npm run migrate` |
| Email de confirmação não chega | Provedor SMTP do Supabase é lento/cai em spam | Cheque spam. Ou desabilite em **Authentication → Email Auth → Confirm email** durante dev |
| `.env.local` parece ser ignorado | Next.js só carrega o `.env.local` quando o `dev` **inicia** | Derrube com `Ctrl+C` e rode `npm run dev` de novo |

Mais erros e diagnóstico em [`docs/05-resolvendo-problemas/`](./docs/05-resolvendo-problemas/). Ou cole o erro pro Claude e peça pra debugar.

---

## Como pedir ajuda ao Claude Code

Abra o Claude Code dentro do projeto (`claude` no terminal) e **fale em PT-BR coloquial** — sem comando especial. Exemplos:

> "Quero adicionar uma página onde meus clientes podem ver pedidos deles."
>
> "Esse botão de salvar não tá funcionando, dá esse erro: ..."
>
> "Revisa o que eu mudei antes de eu commitar."
>
> "Prepara o app pra eu publicar em produção."

O Claude lê os arquivos `CLAUDE.md` espalhados pelo projeto (raiz + `lib/` + `app/` + `components/`) e segue os padrões automaticamente — RLS, multi-tenant, padrão de Server Action, vocabulário leigo nas respostas, etc.

Internamente o Claude usa as **skills do [superpowers](https://github.com/obra/superpowers)** (que vem instalado com o Claude Code) pra disciplina de brainstorm, plano, debug sistemático, code review e verificação de evidência. Você não precisa saber disso — só conversa em português.

---

## Documentação completa

Tudo em [`docs/`](./docs/), em ordem:

- [`01-comecando/`](./docs/01-comecando/) — o que é o template, instalação, primeira rodada
- [`02-criando-funcionalidades/`](./docs/02-criando-funcionalidades/) — como pedir features pro Claude
- [`03-banco-de-dados/`](./docs/03-banco-de-dados/) — Supabase, multi-tenant, customizar tabelas
- [`04-publicando/`](./docs/04-publicando/) — preparar pra produção, EasyPanel, domínio + SSL
- [`05-resolvendo-problemas/`](./docs/05-resolvendo-problemas/) — erros comuns e quando pedir ajuda
- [`06-agentes-de-ia/`](./docs/06-agentes-de-ia/) — agente, conversa, base de conhecimento e automações

## Scripts disponíveis

| Comando | O que faz |
| --- | --- |
| `npm run dev` | Sobe o servidor em `http://localhost:3000` |
| `npm run build` | Build de produção |
| `npm run check` | Lint + format (Biome, com fix automático) |
| `npm run test` | Roda os testes (Vitest) |
| `npm run migrate` | Cria/atualiza as tabelas do banco |
| `npm run types` | Regenera `types/supabase.ts` depois de mudar o banco |
| `npm run verify` | Confere tudo de uma vez: tipos + lint + testes |
| `npm run worker` | Sobe o segundo programa, o que faz as **automações** rodarem (o `dev` não sobe ele; no servidor ele sobe sozinho) |
| `npm run gerar-chave` | Sorteia uma `ENCRYPTION_KEY` nova |
| `npm run semear` | Grava nos workspaces que já existem o agente / base / automação que o Claude Code declarou depois (workspace novo já nasce com tudo; no servidor isso roda sozinho a cada deploy) |
| `npm run types:local` | O mesmo que `npm run types`, mas lendo do Supabase que roda em Docker na sua máquina |
