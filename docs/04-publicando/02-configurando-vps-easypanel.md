# Configurando VPS + EasyPanel

**Tempo de leitura:** ~15 min
**Pré-requisitos:** [01-preparando-para-publicar](./01-preparando-para-publicar.md)
**O que você vai aprender:**
- Contratar VPS (recomendado: Hetzner ou Hostinger)
- Instalar EasyPanel
- Criar seu app no EasyPanel apontando pro repositório

---

## 1. Contratar VPS

### Hetzner (recomendado pra economia)

1. Cadastre em https://www.hetzner.com (cuidado: precisa de cartão internacional)
2. Vá em Cloud → Servers → New Server
3. Escolha:
   - **Location**: Helsinki ou Falkenstein (mais barato; Brasil não tem)
   - **Image**: Ubuntu 24.04 LTS
   - **Type**: CX22 (4GB RAM, ~€7/mês = R$ 38)
   - **SSH Key**: adicione sua chave pública (cria com `ssh-keygen` se não tem)
4. Cria

### Hostinger (mais fácil pra brasileiro, paga em real)

1. https://www.hostinger.com.br → VPS Hosting
2. Plano KVM 2 (4GB RAM, ~R$ 40/mês com promoção)
3. Sistema: Ubuntu 24.04

### Outras opções

- DigitalOcean ($24/mês 4GB)
- Vultr (~$24/mês 4GB)
- Linode (~$24/mês 4GB)

## 2. Conectar via SSH

Depois de criar a VPS, você recebe um IP (tipo `123.456.789.012`).

Mac/Linux:
```bash
ssh root@123.456.789.012
```

Windows: instale PuTTY ou use Windows Terminal:
```bash
ssh root@123.456.789.012
```

(Senha vem por email da Hetzner/Hostinger. Mude assim que entrar.)

## 3. Instalar EasyPanel

Já conectado via SSH:

```bash
curl -sSL https://get.easypanel.io | sh
```

Espera ~5 min. No fim mostra um link tipo `http://123.456.789.012:3000`. Acessa no navegador.

## 4. Cadastrar no EasyPanel

Primeira vez você cria conta admin. **Anote senha forte**.

## 5. Subir seu código pro GitHub

O EasyPanel puxa o código de um repositório do GitHub. Se você ainda não tem
um, é rapidinho:

1. Vá em [github.com/new](https://github.com/new), dê um nome ao repositório
   (ex: `meu-saas`), marque **Private** e clique em **Create repository**.
2. No terminal, **dentro da pasta do projeto**:

```bash
git init
git add .
git commit -m "primeira versao"
git branch -M main
git remote add origin https://github.com/SEU-USUARIO/meu-saas.git
git push -u origin main
```

> A branch precisa se chamar `main` — é o que você vai informar no EasyPanel.
>
> ⚠️ Confira que o arquivo `.env.local` **não** foi junto: rode `git status` e
> ele não pode aparecer. O `.gitignore` do template já protege.

## 6. Criar seu app no EasyPanel

### 6.1. Criar projeto

Painel → "+ Create project" → dê um nome (ex: `meu-saas`)

### 6.2. Adicionar app dentro do projeto

Dentro do projeto → "+ Add service" → "App"

### 6.3. Conectar com Git

Em "Source", escolha **Git** (não Image).

- **Owner & Repo**: `seu-usuario/meu-saas`
- **Branch**: `main`
- **Build Path**: `/`
- Se o repo é privado, conecte sua conta GitHub clicando em "Authenticate"

### 6.4. Build

Na aba **Build**, escolha **Dockerfile** na lista de métodos e deixe o caminho
como `Dockerfile`.

> Não confie em detecção automática: o EasyPanel oferece quatro métodos de
> construção diferentes e nem sempre acerta sozinho. Escolher na mão leva 5
> segundos e evita erro esquisito depois.

### 6.5. Environment Variables

Aba "Environment". Comece com **três**, todas do seu projeto Supabase de
**produção** (não use o mesmo de teste):

| Variável | Onde pegar no Supabase |
| --- | --- |
| `SUPABASE_URL` | Settings → API → **Project URL** |
| `SUPABASE_ANON_KEY` | Settings → API → chave **anon public** |
| `DATABASE_URL` | Settings → Database → **Connection string** → aba **URI** (troque `[YOUR-PASSWORD]` pela senha do banco) |

A quarta (`ENCRYPTION_KEY`) você **não precisa inventar agora** — o próprio app
gera e te entrega no primeiro deploy. Está no passo 6.5.1, logo abaixo.

Não existe variável opcional neste template. Chave de IA (OpenRouter,
Anthropic, OpenAI, Google) e chave de email (Resend) **não vão no painel**:
você cadastra pelas telas do app, com o site já no ar — menu **Plataforma →
Configurações**, ou **Configurações → Integrações** dentro de um workspace.

> **Você NÃO precisa** de `NEXT_PUBLIC_...`, `SUPABASE_SERVICE_ROLE_KEY`,
> `TRUST_PROXY`, `EMAIL_PROVIDER`, `LLM_PROVIDER` nem `APP_URL`. O template
> descobre tudo isso sozinho. Se você viu esses nomes num tutorial antigo,
> ignore. (Quem já tinha `ANTHROPIC_API_KEY`, `OPENAI_API_KEY`, `RESEND_API_KEY`
> ou `EMAIL_FROM` num deploy antigo não quebra: o app ainda lê elas como último
> recurso. Mas o caminho novo é a tela.)

> ⚠️ **Sobre email — não pule isto, e são DOIS passos.** O Supabase manda os
> emails de confirmação de conta e de recuperação de senha por conta própria, e
> o serviço embutido dele entrega só **2 por hora**. Passou disso, quem tentar
> criar conta leva erro e fica de fora — e você nem fica sabendo.
>
> 1. Crie uma conta grátis no [resend.com](https://resend.com) (cobre 3.000
>    emails/mês), pegue a chave e cadastre em **Plataforma → Configurações**, no
>    cartão do Resend. Isso resolve os emails que **este app** manda: convite e
>    resultado de automação.
> 2. **Isso sozinho NÃO resolve a confirmação de conta nem a recuperação de
>    senha** — esses dois quem manda é o Supabase. Depois de cadastrar a chave,
>    aquele mesmo cartão passa a mostrar exatamente o que colar no painel do
>    Supabase (Authentication → SMTP Settings), com link direto. Feito isso, o
>    limite sobe pra 30 por hora e dá pra pedir mais.

**As tabelas do banco são criadas sozinhas.** Assim que o app liga, ele confere
o que falta no banco e cria. Você não precisa copiar e colar SQL em lugar
nenhum — é pra isso que serve o `DATABASE_URL`.

### 6.5.1. A quarta variável: `ENCRYPTION_KEY` (o app te dá de presente)

É o cadeado que tranca as chaves de API que você cadastra pelas telas. Ela mora
fora do banco de propósito: quem tiver só o banco na mão não abre nada.

Você **não gera nada**. No primeiro deploy, o app percebe que ela falta, cria
uma na hora e imprime no registro (log) do container, assim:

```
================================================================
 FALTA UMA CONFIGURAÇÃO — LEVA 30 SEGUNDOS
================================================================
...
   ENCRYPTION_KEY=cG2bhmjC6YYzI3WgYPVtfVOUfFZefbGZtKHGfOFD924=
...
```

O que fazer, depois que o deploy terminar:

1. No EasyPanel, abra a aba **Logs** do seu app.
2. Procure esse quadro e copie a linha `ENCRYPTION_KEY=...` inteira.
3. Volte na aba **Environment**, cole numa linha nova e clique em **Deploy**.
4. Guarde essa chave junto com suas senhas.

> ⚠️ **Antes de colar, a tela de cadastrar chave de IA fica bloqueada.** Não é
> defeito: a chave que o app gerou sozinho some quando o container reinicia, e
> qualquer chave de API guardada com ela viraria lixo sem aviso. O app prefere
> travar a te deixar perder dado.

> ⚠️ **Perder a `ENCRYPTION_KEY` = perder todas as chaves de API cadastradas.**
> Não existe recuperação. O conserto é recadastrar uma por uma — rápido, mas
> chato. E **não troque** a chave depois, pelo mesmo motivo.

> Copie **só** a linha da `ENCRYPTION_KEY`. Não crie a variável
> `ENCRYPTION_KEY_EPHEMERAL` no painel: ela é uma marca interna que o container
> usa pra saber que a chave é temporária.

### 6.6. Domain

Aba "Domains". Por enquanto pode usar o subdomínio que o EasyPanel oferece
(tipo `meu-saas-123.easypanel.app`) — domínio próprio fica pro próximo guia.

**No campo de porta, digite `80`.** É a porta em que o app roda dentro do
container. Se deixar errado, o site abre com "Bad Gateway".

### 6.7. Resources

Aba "Resources": coloque **1024 MB (1 GB)** de memória.

> São dois programas dentro do mesmo container (site + trabalhador), e 1 GB dá
> conta dos dois com folga. O trabalhador roda **uma automação por vez**, de
> propósito: numa máquina pequena, duas ao mesmo tempo derrubariam o site junto.

O padrão de 256 MB não é suficiente: o app sobe, funciona uns minutos e o
sistema mata o container sozinho quando chega visita (nos logs aparece
`exit 137` ou `OOMKilled`).

### 6.8. Deploy

Botão **Deploy**. O EasyPanel vai:
1. Clonar o repositório
2. Construir a imagem (~3-5 min na primeira vez)
3. Gerar a `ENCRYPTION_KEY` e imprimir nos logs, se você ainda não colou ela no painel (passo 6.5.1)
4. Criar as tabelas do banco (aparece `[banco] aplicando ...` nos logs)
5. Subir **dois programas**: o site e o *trabalhador* (é ele que faz agendamento
   e webhook rodarem). Se um dos dois morrer, o container inteiro cai e o
   EasyPanel sobe de novo — de propósito: app com automação morta parece
   funcionando, e é pior que app fora do ar

Acompanhe na aba "Logs".

> **Primeiro deploy:** volte no passo 6.5.1 e copie a `ENCRYPTION_KEY` que
> apareceu nos logs pra dentro da aba Environment. É a última coisa que falta
> configurar — depois disso você não mexe mais em variável nenhuma.

## 7. Configurar o Supabase pra produção

No painel do **Supabase de produção**:

1. Authentication → URL Configuration
2. **Site URL**: seu endereço (ex: `https://meu-saas.easypanel.app`)
3. **Redirect URLs**: adicione `https://meu-saas.easypanel.app/**`

Sem isso o login funciona, mas os links de email levam pro lugar errado.

## 8. Validar

Abra seu endereço no navegador:
- Landing carrega? ✓
- Consegue criar conta? ✓
- Consegue criar um workspace e ver o painel? ✓
- Já colou a `ENCRYPTION_KEY` dos logs no painel (passo 6.5.1)? ✓ — sem isso a tela de cadastrar chave de IA continua bloqueada
- Email chega (se configurou o Resend)? ✓

## Auto-deploy quando faz git push

Em "Settings" do app no EasyPanel, ative **Auto-deploy on Git push**. Cada push
pra `main` reconstrói automaticamente.

## Próximo passo

[03-dominio-proprio-e-ssl](./03-dominio-proprio-e-ssl.md).

---

## ❓ Travou? Peça ajuda

| O que você vê | O que é | O que fazer |
| --- | --- | --- |
| Site abre com **Bad Gateway** | A porta no EasyPanel está errada | Domains → campo de porta → `80` → Deploy |
| Logs mostram `[banco] não consegui conectar no banco` | `DATABASE_URL` errada ou senha errada | Copie de novo em Supabase → Settings → Database → Connection string → URI, e troque `[YOUR-PASSWORD]` pela senha certa |
| Logs mostram `Faltou a variável SUPABASE_URL` | Faltou preencher no painel | Environment → preencha → Deploy |
| Container fica reiniciando sozinho, ou `exit 137` / `OOMKilled` | Falta memória | Resources → 1024 MB → Deploy |
| Link do email de convite/senha aponta pro endereço errado | Raro: só acontece se o proxy não repassa o domínio | Preencha `APP_URL` com seu endereço completo |
| Erro na tela com um **código** | É o identificador do erro | Procure esse mesmo código na aba **Logs** — a linha ao lado explica o motivo |
| Ninguém consegue criar conta; log diz `email rate limit exceeded` | Estourou o limite do email embutido do Supabase (2/hora) | Cadastre a chave do Resend em **Plataforma → Configurações** **e** faça o passo do SMTP que o cartão mostra depois — só a chave não resolve este erro. Veja o passo 6.5 |
| Automação "Ligada" e nada roda; logs mostram `sem DATABASE_URL` | O trabalhador não subiu | Environment → confira a `DATABASE_URL` → Deploy. Ver [06-agentes-de-ia/04-automacoes](../06-agentes-de-ia/04-automacoes.md) |
| Automação não roda e os logs mostram erro de autorização na chamada interna | Os dois programas nasceram com `ENCRYPTION_KEY` diferente (acontece quando você troca a variável e só um reinicia) | Faça um **Deploy** novo: os dois nascem juntos, do mesmo lugar |

Cole o erro exato pro Claude e descreve o que tava fazendo.
