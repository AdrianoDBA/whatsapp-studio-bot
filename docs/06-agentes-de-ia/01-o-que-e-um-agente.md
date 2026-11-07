# O que é um agente (e como pedir o primeiro)

**Tempo de leitura:** ~10 min
**Pré-requisitos:** app rodando ([03-rodando-pela-primeira-vez](../01-comecando/03-rodando-pela-primeira-vez.md)) e um workspace criado
**O que você vai aprender:**
- A diferença entre "usar uma IA" e "ter um agente"
- Cadastrar a chave de IA (sem ela nada roda)
- Pedir seu primeiro agente pro Claude Code, e testar
- Ler o rastro: o que ele pensou, o que ele fez e quanto custou

---

## Em uma frase

Um **agente** é uma IA com **instruções fixas**, um **modelo escolhido por
você** e uma **lista de coisas que ele pode fazer** no seu app.

A diferença pro ChatGPT é essa última parte. O ChatGPT conversa. O agente
conversa **e consulta os dados do seu workspace** — porque você deu a ele
ferramentas pra isso, uma por uma, sabendo o que cada uma faz.

## As quatro palavras que aparecem o tempo todo

| Palavra | O que significa aqui |
| --- | --- |
| **agente** | o conjunto "instruções + modelo + ferramentas". Nasce de um arquivo — você pede, o Claude Code escreve |
| **ferramenta** | uma ação que o agente pode pedir pra fazer (ex: "buscar na base de conhecimento") |
| **execução** | um "rodar" do começo ao fim. Toda vez que o agente trabalha, vira uma linha em **Execuções** |
| **rastro** | o passo a passo daquela execução: o que ele pediu, o que a ferramenta devolveu, quanto custou |

## 1. Antes de tudo: cadastrar a chave de IA

O template **não vem com chave de IA**, e nem podia — quem paga a conta do
modelo é você.

Você tem dois lugares pra cadastrar, e eles servem a propósitos diferentes:

| Onde | Quem usa | Quando escolher |
| --- | --- | --- |
| **Plataforma → Configurações** | **todos** os workspaces do seu app | você é o dono do produto e vai pagar a conta de todo mundo |
| **Configurações → Integrações** (dentro do workspace) | só aquele workspace | cada cliente seu leva a própria chave |

Se existirem as duas, a do workspace ganha.

> 💡 **Não sabe qual provedor escolher?** Comece pelo
> **[OpenRouter](https://openrouter.ai)**: uma chave só destrava modelos da
> Anthropic, da OpenAI, do Google e de mais um monte, e ele te diz o preço de
> cada um. Depois, se quiser, você troca por uma chave direta.

> ⚠️ A tela de cadastrar chave fica **bloqueada** enquanto a `ENCRYPTION_KEY`
> não estiver no lugar. É de propósito: sem ela, a chave que você cadastrasse
> viraria lixo no próximo reinício. Veja o passo 3.1 do
> [guia de instalação](../01-comecando/03-rodando-pela-primeira-vez.md).

## 2. Criar o agente

Aqui o fluxo foge do resto do app: **não existe botão "Novo agente"**. Um
agente nasce de um arquivo, e quem escreve esse arquivo é o Claude Code, a seu
pedido — o porquê disso, e como pedir direito, está em
[Como nascem as coisas](./00-como-nascem-as-coisas.md). O resumo, pra seguir
lendo esta página:

1. Você pede, em português: *"quero um agente que responde dúvida de cliente
   sobre o produto"*.
2. O Claude Code copia o molde (`lib/agents/_TEMPLATE_agente.ts`), preenche os
   campos e acrescenta o agente na lista `AGENTES`, em `lib/seed/registro.ts`.
3. `npm run verify` confere que a declaração está certa antes de qualquer coisa
   chegar no banco.
4. O agente aparece no seu workspace — sozinho, se o workspace for novo;
   sozinho também no próximo deploy, se o workspace já existia (ou na hora,
   com `npm run semear`, se você não quiser esperar).

O arquivo tem estes campos:

- **Instruções** — o campo mais importante. É onde se escreve, em português, o
  que ele deve fazer, como deve responder e o que ele **não** deve fazer.
- **Modelo** — qualquer um da lista de `lib/ai/catalog.ts`, que mostra o preço
  de cada um. Comece por um modelo barato; troque quando sentir falta.
- **Ferramentas** — a lista de ferramentas que ele pode usar. Vazia, ele só
  conversa.
- **Passos** — quantas vezes ele pode "pensar e agir" numa mesma resposta.
  Padrão é o suficiente pra maioria.
- **Situação** — nasce **No ar**. Não existe "apagar agente": pra aposentar um
  sem perder o histórico de execuções, o Claude Code declara
  `status: "archived"` nele e materializa de novo.

Abra o agente pela tela (**Agentes** → clique nele) pra **conferir** como ele
está montado — prompt, modelo, ferramentas, tudo em modo leitura, sem campo
editável. Pra mudar qualquer coisa é sempre a mesma receita: peça pro Claude
Code editar o arquivo, rode `npm run verify` e publique — o deploy leva a
mudança pro workspace que já existe sozinho, sem mais nada. Quer que ela
chegue **agora**, sem esperar o deploy? Rode `npm run semear` na mão.

### Como escrever boas instruções

Ruim:

> Você é um assistente útil.

Bom:

> Você atende o time comercial da Acme. Quando perguntarem sobre preço ou
> política de vendas, use a ferramenta de buscar na base de conhecimento antes
> de responder — nunca chute. Responda em no máximo 5 linhas, em português, e
> sempre diga de qual documento veio a informação. Se não encontrar nada, diga
> "não achei nada sobre isso nos documentos" em vez de inventar.

A diferença é: **o que ele atende**, **quando usar a ferramenta**, **o formato
da resposta** e **o que fazer quando não sabe**.

## 3. Testar

Dentro do agente tem o botão **Testar**. Você escreve um pedido, ele roda até o
fim e a tela mostra:

- a resposta;
- o **rastro**: cada passo, cada ferramenta chamada, o que ela devolveu;
- **quanto custou**, em dólar.

Se der errado, a mensagem vem **em português** e explicando ("Falta cadastrar a
chave do OpenRouter…"), não um erro técnico em inglês.

## 3.1. Duas cotas, pra a conta não fugir do controle

O template já vem com dois limites diários de token, pra você não descobrir o
problema pela fatura:

| Cota | Quanto | De quem |
| --- | --- | --- |
| **pessoal** | 50 mil tokens por dia | cada pessoa, contando teste e conversa |
| **da automação** | 500 mil tokens por dia | o workspace inteiro, contando agendamento e webhook |

Elas são **separadas de propósito**: sem isso, um agendamento de 15 em 15
minutos queimaria a cota pessoal de quem o armou, e essa pessoa chegaria de
manhã sem conseguir usar o chat, sem entender por quê.

Os dois números moram no banco (nas funções `consume_llm_tokens` e
`automation_daily_cap`) — não tem tela pra mudar. Precisou? Peça pro Claude
Code.

## 4. Execuções: o histórico de tudo

Menu lateral → **Execuções**. Toda vez que um agente roda — pelo teste, pela
conversa, por um agendamento ou por um webhook — cai aqui.

A lista mostra quem disparou, qual agente, se deu certo, quanto tempo levou e
quanto custou. Clicando, você vê o rastro completo.

É a primeira tela pra abrir quando alguém disser "o agente tá estranho".

> **Preço desconhecido não é zero.** Quando o app não sabe o preço de um modelo
> (porque você usou um que não está no catálogo), ele escreve **"preço
> desconhecido"** — nunca "US$ 0,00". Mentir o número seria pior que não ter
> número.

## 5. As quatro maneiras de um agente rodar

| Como | Onde fica | Guia |
| --- | --- | --- |
| **Testar** | dentro do agente | aqui mesmo |
| **Conversar** | dentro do agente, botão "Conversar" | [02-conversando-com-o-agente](./02-conversando-com-o-agente.md) |
| **Hora marcada** | menu Automações → Agendamentos | [04-automacoes](./04-automacoes.md) |
| **Um sistema de fora chamou** | menu Automações → Webhooks | [04-automacoes](./04-automacoes.md) |

E, pra ele responder com **os seus documentos**, tem a
[base de conhecimento](./03-base-de-conhecimento.md).

## 6. Criar uma ferramenta nova (aí sim vira produto)

As ferramentas que vêm prontas são exemplos. O agente fica interessante quando
ele mexe **nos seus dados**.

Abra o Claude Code e peça em português:

> "Cria uma ferramenta de agente que busca clientes pelo nome na tabela
> `clients` e devolve nome, email e telefone. Só quem é admin pode usar."

O Claude sabe o padrão da casa (tem um molde em
`lib/agents/tools/_TEMPLATE_ferramenta.ts` e as regras em
`lib/agents/CLAUDE.md`). Duas coisas ele vai respeitar sozinho, e é bom você
saber por quê:

1. **A ferramenta nunca enxerga dado de outro workspace.** Ela não recebe um
   acesso solto ao banco: recebe um acesso que já vem grudado no workspace da
   execução. Não existe como esquecer o filtro.
2. **Ela precisa caber no que a automação sabe fazer.** Existe um teste que
   reprova ferramenta que só funcionaria com você logado — senão ela rodaria no
   painel e quebraria às 8h da manhã, dentro de um agendamento, sem ninguém pra
   ver.

## Próximo passo

[Conversando com o agente](./02-conversando-com-o-agente.md) — o chat que
lembra do que vocês falaram.

---

## ❓ Travou? Peça ajuda

| O que você vê | O que é | O que fazer |
| --- | --- | --- |
| "Falta cadastrar a chave do …" | nenhum provedor cadastrado | Plataforma → Configurações, ou Configurações → Integrações |
| A tela de chave está bloqueada | falta a `ENCRYPTION_KEY` | veja o passo 3.1 do guia de instalação |
| "Você já usou sua cota de IA de hoje" | limite diário **por pessoa** (50 mil tokens), pra ninguém torrar a sua conta sem querer | volta sozinho amanhã. Pra mudar o número, peça pro Claude Code: *"aumenta a cota diária de IA"* — ele mexe na função `consume_llm_tokens` do banco |
| O agente responde sem usar a ferramenta | as instruções não mandam usar | escreva **quando** usar cada ferramenta, com essas palavras |
| O agente "não achou nada" e você sabe que tem | ele filtrou diferente do que você esperava | abra Execuções → rastro: lá aparece exatamente o que ele pediu |

Ou cole o erro pro Claude Code e descreva o que estava tentando fazer.
