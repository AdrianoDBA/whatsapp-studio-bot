# Rodando pela primeira vez

**Tempo de leitura:** ~15 min
**Pré-requisitos:** [Instalando tudo](./02-instalando-tudo.md) completo (Node.js + Supabase)
**O que você vai aprender:**
- Baixar o template
- Configurar o `.env.local` na mão
- Mudar o nome do app
- Aplicar o esquema do banco no Supabase
- Rodar o app localmente e fazer seu primeiro cadastro

---

## 1. Extrair o template e instalar dependências

Você recebeu um arquivo **`.zip`** do template. Vamos abrir ele e preparar o terreno.

### 1.1. Extrair o .zip

1. Localize o `.zip` que você baixou (geralmente vai pra pasta **Downloads**).
2. Clique direito → **Extrair tudo** (Windows) ou **abrir** (Mac — extrai sozinho).
3. Mova a pasta extraída pra um lugar fácil de achar (ex: **Desktop**) e renomeie pro nome do seu projeto (ex: `meu-saas`).

### 1.2. Abrir no editor

Recomendo o **VS Code** ([code.visualstudio.com](https://code.visualstudio.com)):

1. Abra o VS Code
2. **File → Open Folder** → selecione a pasta `meu-saas` que você acabou de criar
3. Abra o terminal integrado: **Terminal → New Terminal** (ou `Ctrl+\`` no Windows / `Cmd+\`` no Mac)

O terminal já abre **dentro da pasta certa** — você não precisa navegar pra lugar nenhum.

### 1.3. Instalar dependências

No terminal que você acabou de abrir, rode:

```bash
npm install
```

(Demora 1-3 minutos. Vai baixar todas as bibliotecas que o template usa.)

### 1.4. (Recomendado) Iniciar controle de versão com Git

Pra você poder voltar atrás se quebrar algo, e pra subir pro GitHub depois:

```bash
git init
git add .
git commit -m "primeiro commit"
```

Pronto — seu projeto agora tem histórico próprio.

## 2. Criar o `.env.local`

O `.env.local` é onde ficam as configurações secretas do seu app (chaves do Supabase, etc.). Ele **não vai pro GitHub** (o `.gitignore` já bloqueia).

Comece copiando o template que já vem no projeto:

**Mac/Linux:**
```bash
cp .env.example .env.local
```

**Windows (PowerShell):**
```powershell
Copy-Item .env.example .env.local
```

**Windows (Explorador de arquivos):** clique direito em `.env.example` → Copiar → Colar → renomeie a cópia pra `.env.local`.

Agora abra o `.env.local` no seu editor (VS Code, Notepad, qualquer um).

## 3. Preencher as chaves do Supabase

No [passo 2 do guia anterior](./02-instalando-tudo.md) você anotou 3 coisas do Supabase. Cole elas nas linhas correspondentes do `.env.local`:

```env
SUPABASE_URL=https://xxxxx.supabase.co
SUPABASE_ANON_KEY=eyJ...
DATABASE_URL=postgresql://postgres:SUA-SENHA@db.xxxxx.supabase.co:5432/postgres
```

> Mantenha as **aspas duplas** em volta de cada valor. Se você quiser tirar, tudo bem, mas é mais seguro com aspas (evita problema se a chave tiver caracteres especiais).

### 3.1. A quarta variável: a chave de segurança do app

Falta uma quarta variável, e essa você mesmo gera: a `ENCRYPTION_KEY`. É o cadeado que tranca as chaves de API que você vai cadastrar depois pelas telas do app (OpenRouter, Anthropic, OpenAI, Google, Resend).

No terminal, dentro da pasta do projeto:

```bash
npm run gerar-chave
```

Vai aparecer uma linha embaralhada, tipo `cG2bhmjC6YYz...=`. Copie e cole no `.env.local`:

```env
ENCRYPTION_KEY=cG2bhmjC6YYz...=
```

> ⚠️ **Guarde essa chave junto com suas outras senhas.** Perder a `ENCRYPTION_KEY` = perder todas as chaves de API cadastradas no app. Não existe recuperação — o conserto é recadastrar uma por uma.

Se você pular esse passo, o app sobe do mesmo jeito, mas duas coisas param: a tela de cadastrar chave de IA fica bloqueada (e sem chave de IA nenhum agente roda), e o "esqueci minha senha" dá erro.

### E as outras variáveis?

Não tem outras. São **quatro, e todas obrigatórias** — este template não tem variável opcional.

Chave de IA e chave de email não moram mais no `.env`: você cadastra pelas telas do app, com ele já rodando (menu **Plataforma → Configurações**, ou **Configurações → Integrações** dentro de um workspace). Enquanto não cadastrar, os emails aparecem no terminal e as telas de IA avisam, em português, que falta configurar.

Salve o arquivo.

## 4. (Opcional) Mudar o nome do app

Por padrão o app se chama "Elite da IA - Template". Pra trocar, abra `config/app.config.ts` e edite:

```ts
export const appConfig = {
  /** Nome do seu app (aparece em metadata, header, footer, emails). */
  name: "Meu SaaS",   // ← aqui

  /** Descrição curta usada em metadata HTML e emails. */
  description: "Descrição curta do que seu app faz",
  // ...
}
```

Esse nome aparece no título da aba do navegador, no topo da página de entrada, no rodapé e nos emails que o app envia — **em um lugar só**. Não escreva ele de novo em nenhum outro arquivo: se escrever, no dia em que você renomear o app vai sobrar o nome velho perdido em algum canto.

## 4b. (Opcional) Trocar o texto da página de entrada

A **página de entrada** é o que aparece no seu endereço pra quem ainda não criou conta. É a porta do seu produto — e o texto que vem de fábrica fala do que este app faz (agente de IA que responde pelos seus documentos), não do seu negócio.

Todo o texto dela mora em **um arquivo só**: `config/landing.config.ts`. Abra e troque as frases:

```ts
hero: {
  selo: "Atendimento com IA",          // a pilulinha de cima
  titulo: "Seu atendimento",           // primeira linha do título
  destaque: "responde sozinho.",       // segunda linha, em verde
  subtitulo: "Suba os seus documentos, ...",
  botaoPrincipal: "Começar agora",
  botaoSecundario: "Já tenho conta",
},
```

Tem comentário explicando cada pedaço lá dentro. Você não precisa abrir mais nenhum arquivo.

> ⚠️ **Duas frases que valem dinheiro.** Não escreva promessa de preço ("de
> graça", "grátis pra sempre") e não anuncie coisa que o app não faz ("integra
> com WhatsApp"). Parece óbvio, mas é o erro mais fácil de cometer numa página
> dessas — e quando você publicar, essa frase passa a ser **sua**, não do
> template. Tem um teste no projeto que reclama se essas palavras aparecerem.

## 5. Aplicar as migrations do banco no Supabase

O template traz o esquema completo dividido em migrations sequenciais em `supabase/migrations/` (mais de 30 arquivos `.sql`, numerados na ordem em que devem ser aplicados). Cada um cria um pedaço do banco — tabelas, policies de segurança (RLS), triggers e funções.

Você tem **dois caminhos**, escolhe o que for mais confortável:

### Caminho A — Supabase CLI (recomendado, 1 comando)

Se você já tem o Supabase CLI instalado:

```bash
# Liga este projeto ao seu projeto Supabase (só na primeira vez)
supabase link --project-ref SEU_PROJECT_ID

# Aplica todas as migrations de uma vez
supabase db push
```

> O `--project-ref` é o ID do seu projeto Supabase (aparece na URL do painel: `https://supabase.com/dashboard/project/SEU_PROJECT_ID`).
>
> A ferramenta do Supabase já vem instalada no projeto — use `npx supabase ...` (sem instalar nada). Antes do primeiro uso, rode `npx supabase login`.

### Caminho B — SQL Editor (manual, sem instalar nada)

1. No seu projeto Supabase, vá em **SQL Editor** (ícone de banco de dados na lateral)
2. Pra cada arquivo em `supabase/migrations/` na ordem (do menor número pro maior):
   - Abra o `.sql` no seu editor (VS Code, Notepad, qualquer um)
   - Selecione tudo (`Ctrl+A`) e copie (`Ctrl+C`)
   - No SQL Editor, clique em **New query**, cole, e clique em **Run**
   - Espere ver "Success" embaixo, depois passe pro próximo arquivo

> 💡 **De agora em diante**, qualquer mudança no banco (criar tabela, adicionar coluna) vira um **arquivo novo** em `supabase/migrations/`. O Claude Code escreve o arquivo, e você roda `npm run migrate` pra aplicar.
>
> Tem um arquivo `_TEMPLATE_org_scoped_table.sql.example` nessa pasta como referência do padrão de tabela escopada por org.
>
> Precisa **zerar o banco** pra recomeçar? Cole `supabase/reset-dev.sql` no SQL Editor → Run → depois `npm run migrate`.

## 6. Rodar o app

```bash
npm run dev
```

Vai aparecer:

```
▲ Next.js 16.x.x
- Local: http://localhost:3000
✓ Ready in 138ms
```

Abra http://localhost:3000 no seu navegador.

## 7. Fazer seu primeiro cadastro

1. Na landing, clica em **Começar agora**
2. Preenche nome, email **real seu** e senha (mínimo **10** caracteres)
3. Clica em **Criar conta**
4. Vai aparecer "Confira seu email"
5. Abre seu email e clica no link de confirmação
6. Volta pro app — vai redirecionar pra **Criar workspace**
7. Digite o nome do seu primeiro workspace (ex: "Minha Empresa") → **Criar workspace**
8. Voilà! Tá na tela de **Início**.

## O que você acabou de fazer

- ✅ Tem um app web rodando no seu computador
- ✅ Conta criada no Supabase
- ✅ Workspace criado
- ✅ Uma tela de Início dizendo o que ainda falta configurar pro seu agente funcionar

Agora você pode começar a customizar.

## Próximo passo

Entenda o que a tela de Início está te dizendo em
[05-a-tela-de-inicio](./05-a-tela-de-inicio.md) — é ela que lista o que ainda
falta configurar. Depois, aprenda a usar o Claude Code pra construir suas
funcionalidades em [04-conhecendo-claude-code](./04-conhecendo-claude-code.md).

> 💡 **Quer ver a parte de IA funcionando logo?** Vá pra
> [06-agentes-de-ia](../06-agentes-de-ia/01-o-que-e-um-agente.md): criar um
> agente, conversar com ele, subir documentos e deixar ele rodando sozinho.
>
> Uma diferença importante do `npm run dev`: ele sobe **só o site**. As
> automações (hora marcada e webhook) precisam de um segundo programa, o
> trabalhador — `npm run worker`, noutro terminal. No servidor de verdade os
> dois sobem sozinhos.

---

## ❓ Travou? Peça ajuda

Erros comuns:
- **"Failed to fetch" / "Invalid API key"**: as chaves no `.env.local` estão erradas. Confere a `SUPABASE_URL` e a `SUPABASE_ANON_KEY` (Settings → API) e reinicia o `npm run dev` depois de editar o `.env.local`.
- **"relation does not exist" / "table not found"**: as tabelas ainda não foram criadas. Rode `npm run migrate` — ele cria o que falta, na ordem certa. Você não precisa colar SQL no painel do Supabase.
- **Email não chegou**: cheque spam. Ou desabilite confirmação em Supabase → Authentication → Email Auth → "Confirm email" → desabilita.
- **`.env.local` não tá sendo lido**: o Next.js só lê o `.env.local` quando o `npm run dev` **inicia**. Se você editou com o servidor rodando, derruba (Ctrl+C) e roda `npm run dev` de novo.

Cole o erro exato pro Claude Code e descreve o que estava tentando fazer.
