# CLAUDE.md — lib/ai

> Esta pasta **substitui a antiga `lib/llm/`**, que foi apagada. Se você achar
> `getLanguageModel()` ou `hasLLMConfigured()` em algum lugar, é código velho:
> os substitutos são `resolveModel()` e `hasAnyAiCredential()`.

## Responsabilidade

Responder três perguntas, e só essas três:

1. **Que modelos existem?** — o catálogo (preço, tamanho de conversa, o que ele
   sabe fazer).
2. **Com qual chave eu falo com esse modelo?** — pergunta pro cofre
   (`lib/secrets`) e monta a instância.
3. **Quanto custou?** — conta em micro-dólares inteiros.

O que NÃO é trabalho desta pasta: guardar chave (é `lib/secrets`), montar
conversa e rodar ferramenta (é `lib/agents`), e formatar dinheiro pra tela
(é `lib/format.ts`).

## Mapa dos arquivos

| Arquivo | O que é | Puro? |
|---|---|---|
| `types.ts` | a casa dos tipos da pasta | sim |
| `errors.ts` | `AiConfigError` (mensagem leiga + detalhe técnico) | sim |
| `model-id.ts` | quebra e monta `"provedor:modelo"` | sim |
| `catalog.ts` | os 15 modelos, `getModel`, `DEFAULT_MODEL_ID` | sim |
| `cost.ts` | `calcCostMicros`, `extractProviderCostMicros` | sim |
| `providers.ts` | a fábrica — único arquivo que importa `@ai-sdk/*` | sim |
| `resolve.ts` | junta catálogo + cofre + fábrica | **não** (banco) |
| `index.ts` | a porta de entrada | não |

"Puro" = não fala com banco, não lê cookie, dá pra testar direto no Vitest.

**Numa tela com `"use client"`, importe o arquivo puro direto**
(`@/lib/ai/catalog`), nunca `@/lib/ai` — o barril arrasta `resolve.ts`, que
arrasta o cliente do Supabase, e o build quebra.

## Regras absolutas desta pasta

### 1. `@ai-sdk/*` só é importado em `providers.ts`

Um lugar só pra ajustar quando o SDK mudar de versão. Nenhuma ferramenta,
nenhuma tela e nenhuma função do servidor importa um adapter direto.

### 2. Quem quer um modelo passa por `resolveModel`

`buildLanguageModel` existe, é público dentro da pasta, mas **não é exportado
pelo `index.ts`**. Quem chamasse a fábrica direto teria que arranjar a chave
sozinho — e é exatamente aí que alguém acaba lendo `process.env` no lugar
errado, furando a ordem workspace → plataforma → variável de ambiente.

### 2b. `resolveModel` exige `supabase`, e isso não é frescura

`ResolveModelInput` tem três campos, e os três são obrigatórios: `modelId`,
`organizationId` (`string | null` — quem chama tem que DIGITAR `null`) e
**`supabase`**.

Antes o cofre chamava `createClient()` (o cliente de COOKIE) lá dentro. Numa
execução agendada não existe cookie: o cliente sai anônimo, `resolve_credential`
responde 42501 e **toda automação falha** com "Não deu pra buscar a chave desse
provedor agora" — sem nenhuma pista de por quê.

Deixar `supabase?` opcional só troca a falha barulhenta por uma silenciosa: quem
esquecesse cairia no cliente errado. Obrigatório = o `tsc` aponta todo mundo que
chama, e acabou.

Vale igual pra `listConfiguredAiProviders`, `hasAnyAiCredential`,
`resolveApiKey`, `requireApiKey`, `resolveEmailSender` e `getCredentialSources`.

### 3. O corte do `"provedor:modelo"` é no PRIMEIRO `:`

Nunca `split(":")`. O apelido de modelo do OpenRouter pode ter `:` dentro —
`z-ai/glm-5.2:free` e `anthropic/claude-opus-5:batch` existem de verdade. Com
`split(":")` o pedaço final some e o modelo vira outro, calado.

### 4. No OpenRouter é `.chat(id)`, nunca `or(id)`

O jeito padrão de chamar o adapter da OpenAI v3 usa a Responses API
(`POST /responses`), que o OpenRouter **não implementa**. Trocar `.chat(id)`
por `or(id)` faz TODA chamada voltar 404, com uma mensagem genérica de erro do
provedor — horrível de diagnosticar.

### 5. Dinheiro é INTEIRO, em micro-dólares, arredondado pra cima

`US$ 1,00 = 1_000_000`. `Math.ceil((tokens * microsPorMilhao) / 1_000_000)`,
cada lado separado. A estimativa nunca pode sair menor que a conta real.

**Custo desconhecido é `null`, NUNCA `0`.** Zero significa "custou zero mesmo".
Um modelo fora do catálogo grava `cost_micros = null`, e a tela lê isso como
"preço desconhecido". Gravar `0` faria a tela mostrar "US$ 0,0000" pra uma
execução que custou dinheiro.

### 6. Erro de configuração devolve `mensagemLeiga`, nunca `message`

`AiConfigError` carrega as duas coisas: `mensagemLeiga` (PT-BR coloquial, pode
ir pra tela) e `message` (técnico, só pro `logError()`). Quem monta resposta pra
tela usa `err.mensagemLeiga`.

### 7. A fábrica é SÍNCRONA e não lê requisição

`buildLanguageModel` não chama `getAppUrl()` nem `headers()` do Next. Na onda 4
o trabalhador da fila roda **fora** de uma requisição, e qualquer dependência de
requisição quebraria lá. Pro cabeçalho `HTTP-Referer` do OpenRouter é
`appUrlFromEnv()`.

### 8. Sem cache de instância de modelo

A chave é **por workspace**. Um cache global de modelo faria o workspace B
falar com o provedor usando a chave (e a fatura) do workspace A.

## Como o identificador de modelo funciona

```
openrouter:anthropic/claude-sonnet-5
└─ provedor ┘└──── apelido dentro do provedor ────┘
```

É esse texto inteiro que fica gravado em `agents.model`. O mesmo modelo
aparece duas vezes no catálogo quando dá pra chegar nele por dois caminhos
(`openrouter:anthropic/claude-sonnet-5` e `anthropic:claude-sonnet-5`) —
são linhas diferentes porque **o preço e a conta que chega são diferentes**.

## Como acrescentar um modelo no catálogo

1. Confira o preço na fonte (a página de preços do provedor, ou
   `GET https://openrouter.ai/api/v1/models`).
2. Acrescente a linha em `MODEL_CATALOG` respeitando a ordem do arquivo
   (recomendados primeiro, e dentro de cada bloco do mais barato pro mais
   caro). O teste `tests/ai-catalog.test.ts` cobra essa ordem.
3. Preço em **micro-dólares por 1 milhão de tokens**: US$ 3,00 → `3_000_000`.
4. Preencha `pricedAt` com a data de HOJE — ela aparece na tela.
5. Se o modelo cobra mais acima de um tamanho de prompt, preencha
   `longContextPricing` **e** um `pricingNote` em PT-BR explicando.
6. `npm run verify`.

Não existe (e não deve voltar a existir) um teste que quebre quando `pricedAt`
fica velho: um aluno que clonar o template daqui a sete meses não pode tomar
`npm run verify` vermelho por um motivo que ele não tem como consertar. O
`pricedAt` fica visível na tela justamente pra isso.

## Como acrescentar um provedor novo

1. `AI_PROVIDERS` em `types.ts`.
2. O valor no enum `credential_provider` do banco (migration nova) e o cartão
   em `lib/secrets/providers.ts` — o texto de provedor mora **lá**, num lugar
   só. Não crie um `PROVIDER_LABELS` aqui.
3. Um `case` novo em `buildLanguageModel`. O `switch` não tem `default`, então
   o TypeScript aponta sozinho o que falta.
4. O degrau de variável de ambiente em `lib/env.ts` e em
   `lib/secrets/resolve.ts`.
5. Os modelos dele em `MODEL_CATALOG`.

## Nota sobre a versão do `@ai-sdk/google`

O pacote está preso na faixa `^3.0.111`, que é a marca `ai-v6` do npm. A marca
`latest` dele hoje é a série `4.x`, feita pra uma versão do `ai` que este
template ainda não usa — instalar sem a faixa quebra o projeto.
