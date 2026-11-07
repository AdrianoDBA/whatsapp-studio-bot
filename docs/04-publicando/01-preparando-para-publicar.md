# Preparando para publicar

**Tempo de leitura:** ~7 min
**Pré-requisitos:** app rodando bem localmente
**O que você vai aprender:**
- Quando você está pronto pra ir pro ar
- Por que criar um Supabase separado pra produção
- Como pedir o checklist pré-deploy pro Claude

---

## Sinais de que está pronto

✅ Você consegue fazer signup, login e usar todas as suas funcionalidades sem erros
✅ Você testou em mobile (chrome devtools simula)
✅ Você tem um domínio comprado (ou pelo menos um subdomínio)
✅ Você tem uma VPS contratada com EasyPanel instalado
✅ Você tem alguém pra usar o app (pode ser você mesmo testando — mas pelo menos UMA pessoa real)
✅ Se você usa a parte de IA: cadastrou a chave, rodou um agente e viu a execução aparecer em **Execuções**

Se faltou algo, **não vá pra produção ainda**. Termine.

## Por que 2 ambientes Supabase

Hoje você usa **1 projeto Supabase** pra desenvolver. Em produção, você quer **outro projeto** separado. Motivos:

1. **Você pode quebrar coisas em dev sem afetar seus usuários reais**
2. **Backups separados** — restaurar prod não toca em dev
3. **Estatísticas reais** — você vê quantos usuários reais usam
4. **Plano gratuito permite 2 projetos** — não custa nada

### Criar o segundo

1. Vá em https://supabase.com → New Project
2. Mesmo passo a passo da primeira vez (anota a **Project URL** e a **anon key** — a `service_role` você continua não usando)
3. As tabelas você **não precisa criar**: o app aplica as migrations sozinho toda vez que liga no servidor. Se quiser adiantar da sua máquina, aponte o `DATABASE_URL` pro projeto novo e rode `npm run migrate`

Esse novo projeto vai virar suas variáveis de ambiente **em produção** (no EasyPanel), enquanto o `.env.local` continua apontando pro dev.

## Checklist pré-deploy com Claude

Antes de fazer deploy de verdade, abre Claude Code e fala:

> "Roda o checklist pra eu publicar o app."

Claude vai checar:
1. Variáveis de ambiente OK?
2. Migrations aplicadas no Supabase de prod?
3. `npm run build` passa?
4. `npx tsc --noEmit` sem erros?
5. `config/app.config.ts` com nome correto?
5b. `config/landing.config.ts` com o texto do **seu** produto (e não o que veio de fábrica)?
6. Auth → URL Configuration no Supabase de prod aponta pro domínio real?
7. Dockerfile existe?
8. `npm run verify` passa (tipos + lint + testes)?

Pra cada item, ele pergunta ou valida. Se algo falhar, te orienta.

## Custos esperados

Pra um app pequeno (~ 100 usuários):

| Coisa | Custo/mês |
|---|---|
| VPS 4GB RAM (Hetzner) | ~R$ 30 |
| Domínio (.com.br) | ~R$ 50/ano = R$ 4/mês |
| Supabase Pro (quando precisar) | $25 |
| Resend (até 3.000 emails/mês) | grátis |
| **Total inicial** | **~R$ 35/mês** |
| **Total Pro** | **~R$ 165/mês** |

> ⚠️ **A conta da IA não está nessa tabela, e ela é por uso.** Você paga o
> provedor (OpenRouter, Anthropic, OpenAI, Google) por token gasto — cada
> execução em **Execuções** mostra quanto custou. Duas coisas seguram o susto:
> a **cota diária por pessoa** e a **cota separada das automações**. Antes de
> ligar um agendamento "a cada 15 minutos", faça a conta: são 96 execuções por
> dia, todo dia.

## Próximo passo

Vai pra [02-configurando-vps-easypanel](./02-configurando-vps-easypanel.md).

---

## ❓ Travou? Peça ajuda

Pede o checklist pré-deploy pro Claude — ele te guia passo-a-passo.
