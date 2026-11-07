# O que é esse template

**Tempo de leitura:** ~5 min
**Pré-requisitos:** nenhum
**O que você vai aprender:**
- Qual problema esse template resolve
- O que já vem pronto (e o que você precisa criar)
- Quando esse template é a escolha certa (e quando não é)

---

## Em uma frase

Esse é um **template completo de SaaS multi-tenant** em Next.js + Supabase, feito pra você criar seu produto online com a ajuda do Claude Code, mesmo sem ser programador experiente.

## Pra que serve

Toda vez que você quer criar um app web onde:
- Pessoas se cadastram
- Têm um workspace (ou empresa, ou conta)
- Convidam outras pessoas pra colaborar
- Veem dados num dashboard
- Fazem o que seu produto faz

…você precisa construir essas **mesmas peças básicas**. Isso leva semanas. Esse template já tem todas elas funcionando, pra você focar só no que torna seu produto **único**.

## O que vem pronto

### Autenticação completa
- Página de cadastro com email + senha
- Confirmação de email
- Login
- Esqueci minha senha (com recuperação por email)
- Logout

### Workspaces (organizações) com membros
- Você pode ter vários workspaces (ou um por usuário, depende do seu produto)
- Convide pessoas por email — elas recebem um link, clicam, viram membros
- 3 níveis de acesso por workspace: **Dono**, **Admin** (gerencia membros), **Membro** (só usa)
- Edite o nome, slug (que aparece na URL) e logo do workspace

### Tela de Início (o painel do workspace)
- Uma lista de **o que ainda falta configurar** — e ela some sozinha quando não falta mais nada
- 4 números do seu workspace de verdade: execuções da semana, gasto do mês, agentes ligados e trechos indexados
- Um gráfico de **quanto a IA custou por dia**, nos últimos 30 dias
- As últimas execuções e o que vai rodar sozinho daqui a pouco
- Nada aqui é inventado: é tudo consulta ao seu banco. Quando você criar suas
  próprias telas, dá pra pedir números seus nesse mesmo lugar

### Visual moderno
- Tema escuro com cor de destaque verde Kawasaki
- Funciona perfeito em celular e desktop
- Componentes prontos (botões, formulários, modais, sidebar) baseados em shadcn/ui

### Banco de dados seguro
- PostgreSQL no Supabase (escala automaticamente)
- **Row Level Security** ativa em todas as tabelas — ninguém vê o que não pode
- Migrations versionadas (você acompanha mudanças no schema)

### Email
- Sistema de envio com Resend (ou outro provedor)
- Template do email de convite já desenhado (o de boas-vindas está em `lib/email/templates/`, mas nada manda ele ainda — peça pro Claude Code ligar se quiser)

### Agentes de IA (a parte que mais gente vem buscar)
- **Agentes** que você cria pelo painel: instruções, modelo e ferramentas
- **Conversa** com cada agente, com a resposta chegando aos poucos e o custo de cada uma
- **Base de conhecimento**: suba PDF, texto ou planilha e o agente responde com os seus documentos
- **Automações**: o agente rodando na hora marcada, ou quando um sistema de fora chamar
- **Execuções**: o histórico de tudo que rodou, com o passo a passo e quanto custou
- A chave da IA é **sua** e se cadastra pelas telas — nada de chave no código

> Guia completo em [06-agentes-de-ia](../06-agentes-de-ia/01-o-que-e-um-agente.md).

### Deploy pronto
- Dockerfile pra subir em qualquer VPS
- Guia passo-a-passo pra usar EasyPanel
- SSL automático

### Documentação pro Claude Code te ajudar
- Cada pasta importante tem um arquivo `CLAUDE.md` que orienta o Claude nos padrões do template

## O que você vai construir

Esse template é a **fundação** — o que cobre 70% do que todo SaaS precisa. Os 30% restantes (o que torna seu produto **seu**) você cria com a ajuda do Claude Code, digitando em português o que quer:

> "Quero uma página onde meus clientes podem cadastrar contatos e ver quem cadastrou."

Ou:

> "Adiciona uma tela de agendamento, com calendário e horários."

## Quando esse template é a escolha certa

✅ Você quer criar um **SaaS B2B ou B2C** com workspaces
✅ Você não é programador profissional, mas quer ter controle do seu produto
✅ Você quer **hospedar você mesmo** (VPS, EasyPanel, sem ficar refém da Vercel)
✅ Seu público fala **português**
✅ Você usa Claude Code pra desenvolver

## Quando NÃO é a escolha certa

❌ Você quer uma **landing page estática** — esse template tem dashboard, é overkill
❌ Você precisa de um **e-commerce robusto** — use Shopify ou Loja Integrada
❌ Você quer um **blog** — use WordPress ou Astro
❌ Você precisa de **realtime intenso** (chat ao vivo com muitos usuários) — adiciona depois, mas não vem pronto

## Próximo passo

Bora instalar tudo? Vai pra [02-instalando-tudo](./02-instalando-tudo.md).

---

## ❓ Travou? Peça ajuda

Abra o Claude Code e digite:
> "Não entendi [coisa específica] no template. Me explica de outro jeito?"

Ou cole o erro pro Claude e descreve o que tava tentando fazer.
