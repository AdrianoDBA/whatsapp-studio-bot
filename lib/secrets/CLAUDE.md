# CLAUDE.md — lib/secrets

## Responsabilidade

O **cofre de chaves de API**. É aqui que a chave do OpenRouter / Anthropic /
OpenAI / Google / Resend é trancada, guardada, achada e mostrada mascarada.

A chave mora em **dois níveis**:

| Nível | `organization_id` | Quem cadastra |
|---|---|---|
| Plataforma | nulo | dono da plataforma |
| Workspace | preenchido | owner/admin daquele time |

E a ordem de busca é **sempre** essa, nunca outra:

```
chave do workspace  →  chave da plataforma  →  variável de ambiente
```

## Mapa dos arquivos

| Arquivo | O que é | Puro? |
|---|---|---|
| `types.ts` | tipos, `VaultError`, mensagens em PT-BR | sim |
| `crypto.ts` | AES-256-GCM + HKDF-SHA256, estado da chave mestra | sim |
| `mask.ts` | `fingerprintSecret` / `maskCredential` | sim |
| `providers.ts` | catálogo de texto dos 5 provedores | sim |
| `vault.ts` | `saveCredential` / `deleteCredential` | não (banco) |
| `queries.ts` | `listCredentials` / `getCredential` / `getCredentialSources` | não (banco) |
| `resolve.ts` | `resolveApiKey` / `requireApiKey` / `resolveEmailSender` | não (banco) |
| `index.ts` | a porta de entrada | não |
| `schemas.ts` | Zod das 4 funções do servidor (sem `.default()`) | sim |
| `actions.ts` | as 4 funções do servidor das telas de chave | não |

"Puro" = não fala com banco, não lê cookie, dá pra testar direto no Vitest.

## Regras absolutas desta pasta

### 1. NUNCA `select("*")` em `credentials`

A permissão de leitura foi dada **coluna a coluna** na migration, e
`ciphertext` ficou de fora de propósito. `select("*")` pede tudo e o banco
responde `permission denied for column ciphertext` (código 42501).

Isso é rede de segurança, não bug: impede que alguém, sem querer, mande o
embrulho da chave pra tela.

**Armadilha:** toda **coluna nova** em `credentials` nasce invisível. Pra ela
aparecer você precisa de duas coisas, não uma:
1. acrescentar o nome dela no `grant select (...)` de uma migration nova;
2. acrescentar o nome dela na constante `COLUNAS` de `queries.ts`.

### 2. A chave só é mascarada NO SERVIDOR

Mascarar no navegador não mascara nada — a chave inteira já teria viajado, e
quem abrisse a aba de rede do navegador leria ela inteira. `maskCredential`
recebe o *fingerprint*, nunca o segredo, exatamente pra tornar difícil errar.

Nenhum tipo que vai pra tela (`CredentialSummary`) tem campo com a chave.
`ResolvedCredential` **tem** — e por isso ele nunca sai de uma função do
servidor pra tela, nem entra num `console.log`.

### 2b. Quem procura chave PASSA O `supabase`, sempre

`resolveApiKey`, `requireApiKey`, `resolveEmailSender` e `getCredentialSources`
recebem o cliente do Supabase de quem chamou. **Não é opcional, e não existe
`createClient()` escondido lá dentro.**

Por quê: numa execução agendada não existe cookie. Um `createClient()` interno
sairia anônimo, `resolve_credential` responderia 42501 e toda automação falharia
com "Não deu pra buscar a chave desse provedor agora" — sem pista do motivo. Com
o parâmetro obrigatório, o `tsc` aponta quem esqueceu.

🚫 Não "simplifique" isso de volta pra opcional.

### 3. Gravar passa OBRIGATORIAMENTE pela função `save_credential` do banco

O app não tem permissão de `insert` nem de `update` nessa tabela. Isso é de
propósito: a única porta de escrita confere quem está pedindo antes.
`vault.ts` é o único arquivo que chama essa função.

### 4. `sealSecret` / `openSecret` não são exportados pelo `index.ts`

Quem cifra é o cofre. Se uma tela precisar embrulhar alguma coisa sozinha, a
regra de negócio está no lugar errado.

### 5. Falha de decifragem é BARULHENTA

Quando existe cifra no banco e ela não abre, `resolveApiKey` **lança**
`VaultError`. Não cai calado na variável de ambiente. Se caísse, "alguém
trocou a ENCRYPTION_KEY e as chaves guardadas viraram lixo" apareceria pro
aluno como "a IA respondeu usando a conta errada" — impossível de diagnosticar.

### 6. Mensagem técnica não vai pra tela

`VaultError.message` é técnico e só serve pro `logError()`. O texto que a
pessoa lê sai de `vaultErrorMessage(err.code)`. As funções do servidor usam
`isVaultKeyMissing(err)` pra separar "falta configurar" de "deu ruim".

## A chave mestra (ENCRYPTION_KEY)

- Mora **fora** do banco (variável de ambiente, lida só por `lib/env.ts`).
- É moída por HKDF-SHA256 com sal `credentials-v1` antes de virar chave AES.
  Trocar esse sal invalida tudo que já foi guardado.
- Precisa de pelo menos **32 bytes** de material. Menos que isso e o cofre
  recusa com `vault_bad_key`.
- Quando falta, o container gera uma temporária no boot, imprime no registro
  (log) e marca `ENCRYPTION_KEY_EPHEMERAL`. Com essa marca o cofre **se recusa
  a guardar segredo** (`vault_ephemeral_key`) — senão o aluno cadastraria a
  chave e ela sumiria no próximo reinício, sem aviso.

De onde ela sai, por ambiente:

| Onde | Quem coloca |
|---|---|
| Produção (EasyPanel) | o `docker-entrypoint.sh` gera e imprime no log; o aluno cola na aba Environment e faz Deploy |
| Máquina do aluno | ele mesmo, no `.env.local` — a receita está no `.env.example`: `node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"` |

⚠️ **Mexeu no `docker-entrypoint.sh` ou no `.env.example`?** Rode
`npm run verify`: `tests/env-contract.test.ts` guarda a ordem das linhas do
entrypoint (a chave nasce ANTES das migrations), a marca de temporária, o fim
de linha do arquivo (CRLF mata o container no boot) e a regra das quatro
variáveis obrigatórias.

⚠️ **Perder a ENCRYPTION_KEY = perder todas as chaves guardadas.** Não existe
recuperação. O conserto é recadastrar (leva 30 segundos por chave), mas não dá
pra "descobrir" as antigas.

## Como o embrulho é montado

```
base64 de   iv(12 bytes)  ||  tag(16 bytes)  ||  dados cifrados
```

- `iv` sorteado a cada gravação → guardar a MESMA chave duas vezes gera dois
  embrulhos diferentes. Sem isso, dava pra descobrir que dois workspaces usam a
  mesma chave só olhando o banco.
- `tag` é o lacre do AES-GCM: mexeu num caractere, não abre. Falha, não devolve
  lixo.
- O escopo (`organizationId`) e o `provider` entram como **dado autenticado**
  (AAD). Eles não são secretos, mas ficam amarrados ao embrulho: copiar a cifra
  da plataforma pra dentro da linha de um workspace **não abre**.
- `key_version` está gravado desde o dia 1. É o que vai permitir trocar a
  receita no futuro sem migration: a versão 2 deriva uma chave diferente, e os
  embrulhos antigos continuam abrindo com a versão gravada na linha deles.

## Dívida conhecida (RESÍDUO-1 do contrato do bloco 1)

O servidor do app conecta no Supabase como `authenticated` — o template tirou a
service role de propósito. Ou seja: **toda função que o servidor chama, a
pessoa logada também consegue chamar**, inclusive `resolve_credential`, que
devolve o embrulho cifrado da plataforma.

- O que protege hoje: o embrulho sozinho não abre sem a ENCRYPTION_KEY, e o
  AAD amarra a cifra ao escopo + provedor.
- O que não protege: nada impede a pessoa de guardar esse embrulho.
- O conserto, quando o trabalhador em fila abrir conexão direta com o banco:
  `revoke execute on function public.resolve_credential(uuid, public.credential_provider) from authenticated`.

Está registrado também no topo da migration `20260820011000_credentials_vault.sql`.
