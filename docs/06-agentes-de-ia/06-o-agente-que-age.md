# O agente que age: ensaio, email e entrega do resultado

**Tempo de leitura:** ~10 min
**Pré-requisitos:** [um agente criado](./01-o-que-e-um-agente.md) e, pra parte do
final, [automações](./04-automacoes.md)
**O que você vai aprender:**
- Como o agente ganha a ferramenta de **mandar email**
- O que é o **modo de ensaio**, por que ele existe e onde ele já vem ligado
- Como ligar o **modo real** — e o que muda na hora em que você liga
- O que a **entrega do resultado** faz, e o que aparece na tela quando o email não sai
- Os **dois jeitos** de um webhook devolver a resposta do agente

---

## O que mudou

Até agora o agente **lia**: procurava nos seus documentos,
escrevia uma resposta. Ela ficava guardada em **Execuções** e alguém precisava ir
lá ver.

Agora ele também **age**: manda email. E a automação sabe **entregar** o que ele
escreveu, em vez de deixar o texto parado no histórico.

Isso é útil e é perigoso pelo mesmo motivo: um agente que manda email de verdade
manda email de verdade **na primeira tentativa**, às 3h da manhã, sem ninguém
olhando. Por isso existe o modo de ensaio.

---

# Parte 1 — A ferramenta "Mandar email"

## Ligar no agente

A ferramenta **Mandar email** é uma linha no arquivo do agente, igual a
qualquer outra ferramenta: peça pro Claude Code acrescentar `"mandar-email"`
na lista `tools` do seu agente (em `lib/agents/<seu-agente>.ts`) e rode `npm
run verify`. A mudança chega sozinha no próximo deploy — ou rode `npm run
semear` agora, se não quiser esperar.

Abra o agente pela tela (**Agentes** → clique nele) pra **conferir** que ela
está na lista — é leitura, sem campo pra marcar.

**Mandar email só funciona pra quem é dono ou administrador do workspace.**
Isso é literal — o mesmo agente, aberto por um membro comum, simplesmente não
enxerga essa ferramenta. Não dá erro, ele só não manda email.

> Mandar email gasta a reputação do seu domínio e chega na caixa de outra pessoa.
> Por isso essa não é uma decisão de membro comum.

## Precisa de uma chave de email cadastrada

O agente não tem como mandar email sozinho — quem manda é o **Resend**, e a
chave dele se cadastra em **Plataforma → Configurações**, no cartão do Resend.
(É a mesma chave que o app usa pra mandar **convite** de time; veja
[Instalando tudo](../01-comecando/02-instalando-tudo.md). O email de
**recuperação de senha** não passa por aqui — quem manda aquele é o próprio
Supabase, pelo servidor de email dele.)

Sem chave cadastrada, o agente responde que **não conseguiu** mandar — com todas
as letras. Ele nunca diz "mandei" quando não mandou.

---

# Parte 2 — O modo de ensaio

## O que é

**Ensaio = o agente roda inteiro e mostra o que faria, mas nada sai pra fora.**

Repare no "roda inteiro": ele pensa, usa as ferramentas de leitura de verdade,
escreve a resposta e **gasta IA normalmente** (aparece em Execuções, conta no
[teto de gasto](./05-teto-de-gasto.md)). A única coisa que não acontece é o ato
de agir: o email não é enviado, o sistema de fora não é chamado.

No lugar disso, o rastro da execução guarda um passo marcado com **o que ele
teria feito**:

> ✋ **Ensaio** — eu teria mandado um email para chefe@empresa.com com o assunto
> "3 pedidos atrasados".

Isso aparece na própria linha do passo, sem precisar abrir nada — dá pra bater o
olho no rastro e já saber pra onde ia.

**O texto do email não está nesse passo.** Abrindo o ✋ em *"ver o que entrou e o
que saiu"* vem só **pra quem** e o **assunto**. O corpo inteiro está no outro
passo, o da ferramenta **Mandar email** — é ele que guarda o que o agente
escreveu. Os dois passos aparecem no mesmo rastro, um coladinho no outro.

## Onde o ensaio já vem ligado (e onde ele não existe)

| Onde | Começa em | Por quê |
| --- | --- | --- |
| **Agendamento** (hora marcada) | **ensaio** | roda sozinho, sem ninguém olhando |
| **Webhook** (chamada de fora) | **ensaio** | idem, e o gatilho vem de fora |
| **Testar** (a tela de teste do agente) | **ensaio**, mas dá pra desligar num clique | é seu laboratório |
| **Conversar** (o chat) | **não tem ensaio** — age de verdade | você está na frente, vendo a resposta na hora |

Essa diferença é de propósito. No chat você lê o que o agente respondeu e decide
o que fazer com aquilo em seguida; não tem nada escondido de você. Uma automação
que roda de madrugada é o contrário: quem armou só vai **conferir depois** — e
"depois" é tarde demais pra um email que já saiu.

> ⚠️ **Automação criada antes desta atualização continua se comportando igual.**
> Ela nasce em ensaio, e como nenhuma ferramenta de ação estava marcada nela e a
> entrega começa em "Nada", o resultado é exatamente o de antes.

## Na tela de teste

**Agentes → o agente → Testar.** No topo tem um cartão:

> **Ensaio — ligado**
> Nada sai daqui pra fora: o email aparece como "eu teria mandado", em vez de
> ser enviado. O agente pode dizer que enviou — não enviou.
>
> [ Desligar ensaio ]

Clicando em **Desligar ensaio**, o texto vira *"A ferramenta de mandar email vai
mandar de verdade nesta execução."*

Esse botão **não fica guardado**: recarregou a página, ele volta pro ensaio. É de
propósito — o padrão seguro é o padrão.

## ⚠️ O agente às vezes diz que enviou. Ele não enviou.

Essa é a parte mais importante desta página inteira.

Em ensaio, o agente às vezes escreve na resposta *"Enviei o email com o relatório
para chefe@empresa.com"*. **É mentira dele, não do sistema.** Nada saiu. O agente
recebeu o aviso de que estava ensaiando e escreveu no passado assim mesmo — e
faz isso **de vez em quando**, não sempre, que é justamente o que mais confunde.

Por isso a tela não deixa você depender do que o agente escreveu. Toda execução
que rodou em ensaio aparece com um selo **`ensaio`** ao lado do "deu certo", e
em cima da resposta aparece:

> ✋ **Isto foi um ensaio.** Nada saiu daqui pra fora — nenhum email foi enviado.
> **Se o agente disser que enviou ou mandou alguma coisa, ele não mandou.**

Esse selo **não passa pelo agente**: ele vem do registro da execução no banco,
carimbado antes de o agente começar a escrever. Ele aparece nos três lugares — na
tela de teste, na lista de Execuções e no detalhe de cada execução.

**A regra pra ler:** selo presente = nada saiu, pode confiar. Selo ausente = a
tela não está afirmando nada. Execução antiga, de antes desta atualização, não
tem selo — não porque ela foi real, mas porque naquela época o registro não
guardava essa informação, e carimbar "não saiu nada" numa execução que talvez
tenha mandado email seria repetir o mesmo erro ao contrário.

## Na automação: ligar o modo real

**Automações.** Cada agendamento e cada webhook tem, na própria linha, um cartão:

> **Modo de ensaio — ligado**
> Essa automação roda de verdade e gasta IA normalmente, mas **nada sai daqui pra
> fora** — nem email que o agente mandaria sozinho, nem a entrega do resultado.
> Abra a última execução e leia a resposta do agente: é ela que sai de verdade
> quando você ligar o modo real.
>
> A entrega do resultado não deixa rastro nem em ensaio nem no modo real — ela é
> passo da automação, não do agente. Em ensaio ela simplesmente não sai.
>
> [ Ligar o modo real ]

O roteiro que a gente sugere:

1. peça pro Claude Code declarar a automação (ela nasce **desligada** e em
   **ensaio** — ver
   [Como nascem as coisas](./00-como-nascem-as-coisas.md));
2. clique em **Rodar agora**;
3. abra **Execuções** e leia **a resposta do agente** — é ela que vai sair;
4. só então clique em **Ligar o modo real**.

> **Não fique procurando o ✋ Ensaio no passo 3.** Ele só aparece quando o próprio
> agente usa uma ferramenta que age (a **Mandar email**, por exemplo). Se você só
> marcou a **entrega** por email, não vai ter ✋ nenhum no rastro — e está certo
> assim. O que o ensaio garante é isto: **nada saiu pra fora**, inclusive a
> entrega.

Depois de ligado, o cartão some e no lugar dele fica a frase:

> Essa automação **age de verdade**. Ela roda no seu nome — os emails saem com o
> seu remetente.

**"No seu nome" é literal.** A automação usa as suas permissões e o remetente de
email do workspace. Se alguém abrir o email e responder, a conversa é sua.

### Duas coisas que pegam de surpresa

- **Só quem responde pela automação liga o modo real.** Se ela roda no nome de
  outra pessoa, no lugar do botão aparece *"Clique em 'Assumir' pra poder ligar o
  modo real"*. Clique em **Assumir** primeiro — aí ela passa a rodar no seu nome
  e o botão aparece. (É a mesma regra de ligar e desligar, explicada em
  [Automações](./04-automacoes.md).)
- **Dá pra voltar pro ensaio.** Embaixo da frase "age de verdade" tem
  **Voltar pro ensaio**, sem confirmação nenhuma — voltar é a direção segura, não
  precisa de aviso. A automação continua rodando na hora marcada; ela só para de
  mandar coisa pra fora. (Vale a mesma regra do "Assumir": só quem responde pela
  automação troca o modo dela.)

---

# Parte 3 — O que fazer com o resultado

Ensaio resolve "o agente não vai fazer besteira". Falta o outro lado: **como o
resultado chega até você** sem precisar abrir o app todo dia.

## Escolher na hora de declarar o agendamento

Isso é campo do arquivo, junto com o resto do agendamento (ver
[Automações](./04-automacoes.md)). Ao pedir pro Claude Code, diga o que fazer
com o resultado:

> "... e manda o resultado por email para chefe@empresa.com."

Sem pedir nada, o agendamento nasce com a entrega em **"Nada" — fica só no
histórico de Execuções**. Declarando o email, toda vez que a automação rodar
você recebe uma mensagem com o texto que o agente escreveu **e um link pra
execução completa**, pra conferir o rastro se quiser.

## Isso NÃO é uma ferramenta do agente

Parece detalhe, mas muda tudo: a entrega é um **passo da automação**, não uma
coisa que o agente decide. Duas consequências boas:

1. **Ele não pode esquecer.** Não depende de o modelo lembrar de mandar.
2. **O destino é fixo.** Quem escreveu o email de destino foi você, na hora de
   criar. Um documento com texto malicioso lá dentro não muda pra onde o
   resultado vai.

E a entrega respeita o modo: **em ensaio, ela também não manda nada.**

## ⚠️ Errou o email? É só corrigir o arquivo

O destino do email é uma das colunas que o **arquivo** manda — diferente de
"ligado/desligado" e do modo, que só uma pessoa muda, na tela (ver
[Como nascem as coisas](./00-como-nascem-as-coisas.md)). Digitou
`chefe@empresa.con`? Peça pro Claude Code corrigir a declaração e rode `npm run
semear` de novo: ele **atualiza** a entrega do agendamento que já existe, sem
apagar nada e sem mexer em `is_active` nem no modo. Não existe "apagar
agendamento" nesta tela — o jeito de errar e consertar é sempre editar o
arquivo.

Enquanto isso não acontece, a linha da automação na lista **mostra** pra onde o
resultado vai, pra você conferir:

> resultado por email para: chefe@empresa.com

(ou *"resultado: fica só no histórico de Execuções"*, quando a entrega for
"Nada".)

> Vale a pena declarar o primeiro email pro seu próprio endereço, ver como
> chega, e só depois trocar pelo definitivo.

## Quando o email não sai

Aqui tem uma sutileza que confunde: **falha de entrega não é falha da
automação.** O agente fez o trabalho dele — quem falhou foi o email (chave não
cadastrada, endereço inexistente, provedor fora do ar).

Então o que você vê em **Automações → últimos disparos** é:

- o distintivo verde **"Deu certo"** (porque a execução deu certo mesmo);
- e, logo abaixo, uma **caixa vermelha** que começa explicando o que houve —
  *"A automação rodou certo, mas não deu pra mandar o email. O resultado está
  guardado em Execuções."* — e só então o motivo técnico, que é o que ajuda a
  consertar.

A mesma caixa vermelha aparece de novo na linha da automação, mais acima na
mesma tela — sem rótulo nenhum em cima dela, é só a caixa. O texto do agente
**não se perde**: ele está inteiro em **Execuções**.

E a automação **continua ligada** — ela tenta de novo na próxima rodada.

---

# Parte 4 — O webhook devolvendo a resposta

Isto é pra quem vai ligar o app em outro sistema (n8n, Zapier, um formulário, um
programa seu). Se você não vai fazer isso agora, pode pular.

O básico do webhook — criar, o token, os códigos de erro — está em
[Automações](./04-automacoes.md). Aqui é só uma coisa: **como a resposta do
agente volta pra quem chamou.**

## Jeito 1 — "entrou na fila" (é assim que todo endereço nasce)

Você chama, e a resposta vem **na hora**:

```json
202  { "ok": true, "jobId": "8f3c…" }
```

Quer dizer "aceitei, o agente vai rodar". A resposta dele **não vem aqui** — ela
aparece em **Execuções**. Se o sistema que chamou precisa do texto de volta,
o caminho é o jeito 2, logo abaixo.

> ⚠️ **Webhook não tem "O que fazer com o resultado".** Aquele campo de mandar
> o resultado por email é só do **agendamento**. Num webhook, quem recebe o
> resultado é quem chamou — por isso a escolha aqui é entre o comprovante e a
> resposta, não entre email e nada.

É o comportamento certo pra quase tudo: quem chama webhook desiste em poucos
segundos e repete a chamada, e o agente costuma levar mais que isso.

## Jeito 2 — "espera a resposta"

Nesse jeito, o endereço **segura a chamada** até o agente terminar, em vez de
responder na hora. O trabalho entra na mesma fila e é o mesmo trabalhador que
roda — a única diferença é que quem chamou fica esperando.

- **Terminou em até 50 segundos:**

  ```json
  200  { "ok": true, "resposta": "…o texto do agente…",
         "custoMicros": 4200, "ensaio": false }
  ```

- **Passou de 50 segundos:** volta um 202 com um endereço pra buscar depois:

  ```json
  202  { "ok": true, "jobId": "8f3c…",
         "buscarEm": "/api/webhooks/<id>/j/8f3c…" }
  ```

  Chame esse endereço com **GET** e o mesmo token. Enquanto o agente ainda está
  rodando ele responde **202 `{"status":"running"}`**; quando termina, **200**
  com a resposta.

  Essa leitura **não** gasta o limite de 60 chamadas por minuto do endereço —
  ela tem um teto próprio, bem mais folgado, e perguntar de novo enquanto o
  agente trabalha **não** derruba o próximo evento de verdade. Mas teto existe:
  pergunte **de dois em dois ou de três em três segundos**, não num laço
  apertado. Se algum dia vier um **429**, é só esperar o tempo que o cabeçalho
  `Retry-After` disser e perguntar de novo — o trabalho continua rodando do
  outro lado.

Repare no campo **`ensaio`** das respostas: quando ele vem `true`, o texto é
real, mas **nenhum email saiu** — é o aviso pro sistema do outro lado não tratar
aquilo como coisa feita.

Ele fala **daquela rodada**, não de como o endereço está agora. Se você ligar o
modo real depois que a rodada aconteceu, a resposta dela continua dizendo
`ensaio: true` — porque é isso que aconteceu de verdade.

## Onde você escolhe entre os dois

Isso também é campo do arquivo (`WebhookBlueprint.esperarResposta`), e se
escolhe ao pedir a declaração pro Claude Code:

- **Um comprovante na hora** — o jeito 1. É o certo pra quase tudo, e o que sai
  se você não pedir nada diferente.
- **A resposta do agente** — o jeito 2. Peça com essas palavras: "que devolve a
  resposta do agente pra quem chamou".

Depois de materializado, **isso não se edita**: quem chama o endereço já contou
com um formato de resposta, e trocar por baixo quebraria o outro lado. Pra
mudar, peça pro Claude Code declarar outro webhook, com outro apelido (e outro
token) — o antigo continua existindo, porque nada se apaga sozinho; se ele não
deve mais responder, gire o token dele e não distribua o novo.

Na lista de endereços, a linha de cada um mostra qual dos dois ele usa — assim dá
pra conferir sem precisar chamar.

---

## Um roteiro de 10 minutos pra ver tudo funcionando

1. **Plataforma → Configurações** — cadastre a chave do Resend, se ainda não tem.
2. Peça pro Claude Code acrescentar `"mandar-email"` na lista `tools` do seu
   agente, rode `npm run verify` e depois `npm run semear`. Abra **Agentes → o
   agente** pra conferir que ela apareceu na lista — é leitura, sem campo pra
   marcar.
3. **Testar** — deixe o **Ensaio ligado** e peça: *"mande um email pro
   fulano@exemplo.com dizendo oi"*. Leia o rastro: tem que aparecer o ✋ **Ensaio**.
4. Peça pro Claude Code: *"cria um agendamento que roda esse agente todo dia
   e manda o resultado por email pro meu endereço"*, rode `npm run verify` e
   depois `npm run semear` — o agendamento chega **desligado**, em
   **Automações**.
5. **Rodar agora** → **Execuções** → leia a resposta do agente. Nenhum email
   chegou, nem o que ele mandaria sozinho nem a entrega: ela está em ensaio.
6. **Ligar o modo real** → **Rodar agora** de novo. Agora o email chega.
7. Deu vontade de conferir mais um pouco antes de soltar? **Voltar pro ensaio**,
   no mesmo lugar. O caminho vai e volta.

> Na sua máquina, os passos 5 e 6 só funcionam com o **trabalhador** de pé:
> `npm run worker` num segundo terminal. Veja
> [Automações](./04-automacoes.md#testando-tudo-na-sua-máquina).

## Próximo passo

Voltar pro [índice da documentação](../README.md), ou publicar o app em
[04-publicando](../04-publicando/01-preparando-para-publicar.md).

---

## ❓ Travou? Peça ajuda

| O que você vê | O que é | O que fazer |
| --- | --- | --- |
| O agente diz que não pode mandar email | você não é dono nem administrador deste workspace | a ferramenta é só de owner/admin — peça pra quem administra |
| "O envio de email ainda não está ligado" | falta a chave do Resend | quem cadastra é **quem cuida do sistema**, em **Plataforma → Configurações**, no cartão do Resend — essa tela não aparece pra quem só administra o workspace |
| ✋ **Ensaio** no rastro e nenhum email chegou | é assim mesmo | confira o que ele ia mandar e clique em **Ligar o modo real** |
| Liguei o modo real e ainda não chega email | a execução pode ter sido antes de você ligar | rode de novo com **Rodar agora** e olhe o rastro da execução NOVA |
| No lugar do botão aparece "Clique em 'Assumir'…" | a automação roda no nome de outra pessoa | clique em **Assumir** primeiro |
| Liguei o modo real sem querer | dá pra voltar | clique em **Voltar pro ensaio**, embaixo do aviso "age de verdade". Nada sai mais pra fora |
| Automação com **"Deu certo"** e uma caixa vermelha embaixo | o agente rodou, quem falhou foi o email | leia o motivo na caixa. O texto do agente está inteiro em **Execuções** |
| Errei o email de destino | o destino é campo do arquivo | peça pro Claude Code corrigir a declaração e rode `npm run semear` de novo — atualiza sem apagar nada |
| Meu webhook responde 202 e eu queria a resposta do agente | ele foi declarado no jeito "um comprovante na hora" | isso não se edita: peça pro Claude Code declarar outro webhook, com outro apelido, marcando **A resposta do agente**, e rode `npm run semear`. Leia a Parte 4 |
| Procuro "O que fazer com o resultado" na tela do webhook e não acho | esse campo é só do **agendamento** | num webhook, quem recebe o resultado é quem chamou — escolha isso ao declarar o endereço |
| Ensaio ligado e o rastro não mostra nenhum ✋ | o agente não chegou a usar nenhuma ferramenta de ação | é normal. A **entrega** por email nunca vira passo no rastro — ela é passo da automação, não do agente. Leia a resposta em **Execuções** |
| A resposta do webhook veio com `"ensaio": true` | o endereço ainda está em ensaio | abra **Automações**, ache o endereço e clique em **Ligar o modo real** |

Ou cole a mensagem pro Claude Code e descreva o que estava fazendo.
