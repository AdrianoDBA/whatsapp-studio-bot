# CLAUDE.md — lib/email

## Responsabilidade

Abstração de envio de emails transacionais. Permite trocar de provider sem refactor de código de domínio.

## Interface

```typescript
import { getEmailProvider } from "@/lib/email";

// ⚠️ É `async`, e o workspace é OBRIGATÓRIO (use `null` quando não houver um).
const provider = await getEmailProvider({ organizationId: org.id });
const result = await provider.send({
  to: "user@example.com",
  subject: "Olá",
  react: <MeuTemplate />,
});
```

`result.ok === true` → enviado. `result.ok === false` → ver `result.error`.

## De onde sai a chave do Resend

Do **cofre** (`lib/secrets`), na mesma escada do resto do app:

```
chave do workspace  →  chave da plataforma  →  variável de ambiente
```

Quem cadastra é **uma tela só**: `/plataforma/configuracoes`, que só o dono do
sistema abre. ⚠️ **`/app/[orgSlug]/settings/integracoes` NÃO oferece Resend, de
propósito** — email é coisa do app inteiro, não de um workspace, e está escrito
no cabeçalho daquela página. Esta frase já reintroduziu o defeito uma vez: quem
lesse "ou settings/integracoes" ia procurar um cartão que não existe lá.

O cartão do Resend guarda **duas** coisas: a chave e o remetente
(`metadata.from`) — o remetente NÃO mora no `label`. A variável `RESEND_API_KEY`
continua sendo lida como último recurso, pra não quebrar quem já tinha deploy no
ar.

## Providers disponíveis

- **`resend`** (produção): entra sozinho quando o cofre acha uma chave.
- **`console` (padrão sem chave)**: escreve o email no registro (log) do
  servidor em vez de enviar. Ótimo em desenvolvimento, **inútil em produção** —
  o email não chega em ninguém.

Não existe variável `EMAIL_PROVIDER`. Quem escolhe é a presença da chave.

⚠️ **`getEmailProvider()` não pode voltar a ter cache de módulo.** Ele tinha, e
foi removido: com a chave variando por workspace, um cache global mandaria o
email de um time com a chave (e o remetente) de outro.

## Como criar um novo template

1. Crie `lib/email/templates/<nome>.tsx`
2. Use componentes do `@react-email/components` (Html, Head, Body, Container, Heading, Text, Button, Section, Link, Preview)
3. Estilo do tema (verde Kawasaki em fundo escuro):
   - Background: `#0a0a0a`, texto: `#d4d4d4`, accent: `#52d12f`
4. Exporte como default
5. Use no chamador:
   ```typescript
   import { MeuTemplate } from "@/lib/email/templates/meu-template";
   await provider.send({ to, subject, react: <MeuTemplate {...props} /> });
   ```

## Como adicionar um adapter novo (ex: SendGrid)

1. Crie `lib/email/adapters/<provider>.ts` exportando classe que implementa `EmailProvider`
2. Acrescente o provedor no enum `credential_provider` (migration nova) e o cartão dele em `lib/secrets/providers.ts` — é de lá que sai o texto da tela
3. Adicione o branch em `getEmailProvider()` de `lib/email/index.ts`, lendo a chave pelo cofre (nunca `process.env` direto)

## O `error` que sai daqui JÁ ESTÁ EM PT-BR LEIGO

⚠️ **Nunca devolva `error.message` do provedor em `SendEmailResult.error`.** Foi
o que o `ResendAdapter` fazia, e o aluno leu na tela de Automações: *"The
recipient domain is not allowed to receive emails from this account."*

A tradução mora em `lib/email/erros.ts` e é chamada **no adaptador**, que é o
fundo da cadeia — o mesmo texto abastece o rastro do agente, o chat, o
playground e `jobs.last_error` (que a tela de Automações mostra CRU). Traduzir
em quem chama consertaria uma tela e deixaria três em inglês.

- `traduzirErroDeEmail(tecnico)` — puro, uma frase por família
  (destinatário/domínio, chave, limite de envio, genérica).
- `erroDeEmailParaOAluno(escopo, tecnico)` — **é esta que o adaptador usa**:
  grava o motivo técnico com `logError()` e devolve a frase leiga.

Adapter novo segue a mesma regra. A guarda é `tests/email-erros.test.ts`.

## Regras

- **Toda chamada de `.send()` DEVE checar `result.ok`** — emails podem falhar silenciosamente
- **Não bloqueie a Server Action** se email falhar (loga, retorna sucesso da operação principal)
- **Não inclua dados sensíveis (tokens) no Subject** — só no body
