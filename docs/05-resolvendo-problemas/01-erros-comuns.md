# Erros comuns

**Tempo de leitura:** ~10 min
**Pré-requisitos:** nenhum
**O que você vai aprender:**
- Os erros mais comuns + soluções (inclusive os da parte de IA)
- Como ler stack trace
- Quando reiniciar dev server

---

## 1. "relation does not exist" (Supabase)

**Mensagem:** `relation "public.<tabela>" does not exist`

**Causa:** você está consultando uma tabela que não existe no Supabase. Geralmente porque migrations não foram aplicadas (ou faltou alguma).

**Solução:**
1. Vá em https://supabase.com → seu projeto → Database → Tables
2. Veja quais tabelas tem
3. Compare com `supabase/migrations/` no projeto
4. Aplique as migrations que faltam, em ordem, no SQL Editor

## 2. "Failed to fetch" no signup/login

**Causa:** keys do Supabase no `.env.local` estão erradas ou faltando.

**Solução:**
1. Confere `.env.local` — tem as 3 variáveis Supabase?
2. As keys batem com o que está em Supabase → Settings → API?
3. Reinicia `npm run dev`

## 3. Typecheck falhou após mudar schema

**Mensagem:** `Property 'X' does not exist on type 'Y'`

**Causa:** você adicionou/removeu colunas no banco mas não regenerou os tipos.

**Solução:**
```bash
npm run types
```

## 4. "Email rate limit exceeded"

**Causa:** Supabase Free tem limite de ~30 emails/hora por projeto. Você atingiu.

**Solução:**
- Espera 1 hora
- Ou configura SMTP próprio em Supabase → Authentication → Email Templates → SMTP Settings
- Ou usa Resend (mais flexível)

## 5. Build local funciona, deploy falha

**Causa:** geralmente diferenças de env entre local e produção (Linux vs Mac), ou variável faltando no EasyPanel.

**Solução:**
1. Veja logs do deploy no EasyPanel
2. Compare env vars do `.env.local` com as do painel EasyPanel
3. Procure por TypeScript ou node version mismatch

## 6. Login funciona mas redirect quebra

**Mensagem:** redireciona pra URL errada (localhost em produção, ou erro 404)

**Causa:** o endereço configurado no Supabase (URL Configuration) não bate com o endereço real do site.

**Solução:**
1. Supabase → Authentication → URL Configuration → **Site URL** tem que ser o endereço HTTPS real do seu site
2. Supabase prod → Authentication → URL Configuration → Site URL e Redirect URLs com o domínio real

## 7. CSS quebrado / sem estilo

**Causa:** geralmente é cache do navegador OU build do Tailwind quebrou.

**Solução:**
1. Hard refresh no navegador (Cmd+Shift+R no Mac, Ctrl+Shift+R no Win/Linux)
2. Se persistir: `rm -rf .next` e `npm run dev` de novo

## 8. "Cannot find module '@/...'"

**Causa:** path alias quebrou OU você usou import errado.

**Solução:**
1. Verifica `tsconfig.json` tem `"paths": { "@/*": ["./*"] }`
2. Restart TypeScript no editor (VSCode: Cmd+Shift+P → "Restart TS Server")

## 9. Hydration mismatch

**Mensagem:** `Hydration failed because the initial UI does not match what was rendered on the server`

**Causa:** algo no Client Component depende de `window`, `localStorage`, ou randomização — coisas que não existem no servidor.

**Solução:**
1. Use `useEffect` pra coisas que só rodam no cliente
2. Use `suppressHydrationWarning` em casos específicos (ex: tema)
3. Pergunta pro Claude — esse tipo de bug exige análise

## 10. RLS bloqueando query

**Mensagem:** consulta retorna `[]` (vazio) mas você tem dados, OU `permission denied for table X`

**Causa:** duas coisas diferentes causam essa mensagem:

1. **Falta permissão de mesa** (`permission denied for table X`): a tabela foi
   criada sem o `grant`. Acontece quando você cria tabela na mão em vez de
   copiar `supabase/migrations/_TEMPLATE_org_scoped_table.sql.example`.
2. **A regra de linha bloqueou** (consulta volta vazia): você está logado, mas
   não é membro daquela organização.

**Solução:**
1. Rode `npm run migrate` — se for o caso 1, resolve.
2. Confira que você está logado E é membro da organização.
3. Se ainda assim não fizer sentido, peça pro Claude Code revisar a regra de
   segurança. **Não desabilite a segurança do banco** — corrija a regra.

## 11. "Falta cadastrar a chave do …" (ou a tela de chaves está bloqueada)

**Mensagem:** o agente responde *"Falta cadastrar a chave do OpenRouter. Abra
Configurações → Integrações"*, ou o botão de cadastrar chave aparece desligado.

**Causa:** são dois problemas diferentes, com o mesmo sintoma na tela:

1. **Nenhum provedor cadastrado.** O template não vem com chave de IA — quem
   paga a conta do modelo é você.
2. **A `ENCRYPTION_KEY` não está no lugar.** É o cadeado que tranca as chaves.
   Sem ela o app **se recusa a guardar** a chave, porque ela viraria lixo no
   próximo reinício.

**Solução:**
1. Confira a `ENCRYPTION_KEY` no `.env.local` (ou no painel do EasyPanel).
2. Cadastre a chave em **Configurações → Integrações** (vale pra um workspace)
   ou em **Plataforma → Configurações** (vale pra todos).

## 12. A automação está "Ligada" e nunca roda

**Causa:** as automações precisam de um **segundo programa** — o trabalhador — e
ele não está de pé. Três motivos, em ordem de frequência:

1. você está no `npm run dev`, que sobe **só o site**;
2. falta a `DATABASE_URL` (sem ela o trabalhador nem tenta subir — e o site
   continua funcionando normal, de propósito);
3. site e trabalhador estão com `.env` diferentes, e o log mostra erro de
   autorização na chamada interna.

**Solução:** a tela de **Automações** tem um cartão amarelo que diz **qual** dos
casos é o seu. Na sua máquina, rode `npm run worker` num segundo terminal, com o
mesmo `.env.local`. Detalhes em
[06-agentes-de-ia/04-automacoes](../06-agentes-de-ia/04-automacoes.md).

## 13. Documento da base de conhecimento ficou em "Falhou"

**Causa:** o motivo está escrito **em português, na própria linha do documento**.
Os três mais comuns:

1. **PDF escaneado** — é imagem, não texto. Não tem o que extrair.
2. **Nenhum provedor que saiba indexar** — Anthropic e OpenRouter não fazem esse
   serviço. Precisa de chave da **OpenAI** ou do **Google**.
3. **Arquivo grande demais pro tempo do servidor** — a indexação roda na hora do
   envio.

**Solução:** para (1), abra o PDF, copie o texto e use a aba **Colar texto**;
para (2), cadastre a chave certa; para (3), divida o arquivo em partes. Depois,
o botão **Tentar de novo** refaz sem precisar subir tudo outra vez.

## Como ler stack trace

Quando aparece erro grande tipo:

```
Error: Cannot read property 'name' of undefined
    at MyPage (/app/(app)/app/[orgSlug]/page.tsx:24:18)
    at ... (mil linhas)
```

Foca na **primeira linha do seu código** (não de `node_modules`). Aqui é `app/(app)/app/[orgSlug]/page.tsx:24`. Abre esse arquivo na linha 24 — algo lá está `undefined` quando você acessa `.name`.

## Quando reiniciar dev server

Reinicie (`Ctrl+C` no terminal e `npm run dev` de novo) quando:
- Mudou `.env.local`
- Mudou `next.config.ts`
- Mudou `package.json` (após `npm install`)
- Tudo parece confuso e não faz sentido

## Próximo passo

[02-quando-pedir-ajuda](./02-quando-pedir-ajuda.md).

---

## ❓ Travou? Peça ajuda

Cole a mensagem completa pro Claude e descreve o que tava fazendo.
