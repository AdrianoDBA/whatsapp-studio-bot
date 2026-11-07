# Como nascem as coisas: por que não tem botão de criar

**Tempo de leitura:** ~8 min
**Pré-requisitos:** nenhum — vale a pena ler antes de mexer em agente, base,
agendamento ou webhook
**O que você vai aprender:**
- Por que não existe botão "Novo agente", "Nova base" nem "Novo agendamento"
- O que é `lib/seed/registro.ts`, e o que pedir pro Claude Code
- Por que o apelido de cada coisa é pra sempre
- O que continua sendo botão de tela, e o que virou arquivo
- Como o que você declarou chega nos workspaces que já existem (sozinho, no
  deploy — ou na mão, com `npm run semear`)

---

## Em uma frase

Agente, base de conhecimento, agendamento e webhook **nascem de um arquivo**
que o Claude Code escreve a seu pedido — nunca de um formulário. A tela só
**opera** o que já existe: conversar, testar, ligar, desligar, trocar o modo,
girar um token.

## Por que não tem botão de criar

Nos outros produtos que você conhece, "criar" é uma tela com campos e um botão
Salvar. Aqui não é assim, e é escolha, não falta de tempo.

Um agente é, ao mesmo tempo, uma linha no banco de dados **e** uma decisão de
produto: qual modelo, quais instruções, quais ferramentas ele pode usar. Se
existisse um formulário de criação, ele viraria um **segundo dono da
verdade**, ao lado do arquivo — e os dois iriam divergir sem ninguém perceber.
Alguém cria um agente pela tela, o arquivo nunca fica sabendo dele, e o
próximo `npm run semear` simplesmente não enxerga aquela linha. Ela não é
apagada, não dá erro — ela só fica invisível pra quem só olha o repositório, o
que é o pior tipo de bug: silencioso.

Por isso o template resolve isso na raiz: **definição é arquivo, sempre.**

## `lib/seed/registro.ts` — o que este produto tem dentro

Abra `lib/seed/registro.ts`. Nele tem quatro listas:

```ts
export const AGENTES: readonly AgentBlueprint[] = [meuAgente];
export const BASES: readonly KnowledgeBaseBlueprint[] = [];
export const AGENDAMENTOS: readonly ScheduleBlueprint[] = [];
export const WEBHOOKS: readonly WebhookBlueprint[] = [];
```

Cada item de cada lista é a planta completa de uma coisa: o agente que já vem
com o produto está em `lib/agents/_TEMPLATE_agente.ts` e entra na lista
`AGENTES`. Quando você pede um agente novo, o Claude Code escreve um arquivo
parecido com esse, do lado, e acrescenta ele na lista.

Não precisa decorar esse arquivo nem editar ele na mão — é trabalho do Claude
Code. O que vale saber é que ele existe, e que é **ali** que a verdade mora.

## Como pedir

Você não escreve código. Você descreve o que quer, em português, pro Claude
Code:

> "Quero um agente que responde dúvida de cliente lendo o manual do produto."

> "Cria uma base de conhecimento chamada 'Contratos' pra eu subir os PDFs."

> "Cria um agendamento que roda esse agente toda segunda às 9h e manda o
> resultado por email pra mim."

> "Cria um webhook pra esse agente, que devolve a resposta na hora pra quem
> chamar."

O Claude Code copia o molde certo (`_TEMPLATE_agente.ts` pra agente, e assim
por diante — cada domínio tem o dele), preenche os campos com o que você
pediu e acrescenta na lista certa de `lib/seed/registro.ts`.

## `npm run verify` confere antes de chegar no banco

Depois de escrever a declaração, o Claude Code roda `npm run verify`. Ele
confere coisas como: o apelido está no formato certo, o modelo escolhido
existe de verdade no catálogo, a ferramenta marcada existe. Se algo estiver
errado, o comando falha com uma frase dizendo o que consertar — **antes** de
qualquer linha chegar no banco, não depois.

## Os dois momentos em que a coisa passa a existir de verdade

Declarar no arquivo não é o bastante sozinho — falta **materializar**: gravar
a linha no banco de um workspace. Isso acontece em só dois momentos:

1. **Um workspace nasce.** Toda vez que alguém cria um workspace novo, ele já
   nasce com tudo que está declarado hoje em `lib/seed/registro.ts` — agente,
   base, agendamento, webhook. Ninguém precisa fazer nada.
2. **O deploy sobe.** Pros workspaces que **já existiam** antes de uma
   declaração nova entrar no arquivo: assim que o site termina de subir, o
   próprio container roda `npm run semear` sozinho, e leva a novidade pra todo
   mundo que já estava lá. Ninguém precisa fazer nada aqui também.

Quer que a novidade chegue **agora**, sem esperar o próximo deploy — por
exemplo enquanto você testa na sua máquina com `npm run dev`? Rode
`npm run semear` na mão (precisa do site no ar).

O materializador **nunca apaga nada**. Rodar de novo é o caso normal — ele só
grava o que ainda não existe e atualiza as partes de que o arquivo é dono
(prompt, modelo, ferramentas, nome, descrição...). O que uma pessoa decidiu
numa tela — ligado ou desligado, ensaio ou real, quem responde pela automação
— o materializador nunca mexe.

> ⚠️ **Webhook é a exceção da parte "atualiza".** Um webhook que já existe
> nunca é atualizado — só gravado, uma vez. Editar o arquivo dele e rodar
> `npm run semear` de novo não muda nada na linha que já existe (ver a FAQ,
> mais abaixo).

## ⚠️ O apelido é pra sempre

Todo agente, base, agendamento e webhook tem um **apelido** (o `slug`) —
é ele que aparece na URL, e é ele que o materializador usa pra saber "essa
linha já existe, ou é nova?".

Trocar o apelido de uma declaração no arquivo **não renomeia** a linha que já
existe — cria uma linha nova, e a antiga fica pra trás, órfã, intocada no
banco. Em base de conhecimento é ainda mais definitivo, porque o próprio banco
tranca o apelido (e o modelo de indexação) assim que a base nasce.

Por isso: escolha o apelido com calma, na primeira vez.

## Como se APOSENTA uma coisa (porque nada é apagado)

Você declarou um agente, uma base ou uma automação, e agora não quer mais.
E aí?

**Nada aqui apaga nada.** Nem o materializador, nem a tela. E isso é de
propósito: se apagar fosse fácil, um dia alguém renomeia um arquivo e some com
a base de documentos de um cliente inteiro.

O jeito certo é **aposentar** — pedir pro Claude Code marcar aquela declaração
como aposentada, em vez de tirar ela do arquivo:

> "Aposenta o agente `avisador-de-email`."
>
> "A base `politicas-antigas` não vale mais, aposenta ela."

O que acontece com cada uma:

| Coisa aposentada | O que muda |
| --- | --- |
| **Agente** | para de responder no chat, no playground e em qualquer automação |
| **Base de conhecimento** | some da busca do agente e não aceita documento novo |
| **Agendamento / webhook** | seguem o agente: aposentando o agente, tudo que é dele para |

Duas coisas que **não** mudam, e são o ponto:

- **nada é perdido.** As conversas, o histórico de execuções e os documentos já
  indexados continuam lá, do jeito que estavam;
- **dá pra voltar atrás.** Peça pra declarar como ativa de novo e tudo volta a
  funcionar — na base, sem precisar subir os arquivos outra vez.

⚠️ **Não peça só pra "tirar do arquivo".** Uma declaração que some do arquivo
não some do banco: a linha fica lá, órfã, e no caso de uma automação que alguém
já ligou, **ela continua rodando** — sem nada em lugar nenhum dizendo por quê.
Aposentar é um ato deliberado, e o arquivo continua contando a história.

## O que a tela ainda faz (e faz bem)

Nada disso quer dizer que a tela virou decoração. Um monte de coisa continua
sendo, e devendo ser, clique — porque é decisão de **uso**, não de
**construção**:

| Ação | Onde |
| --- | --- |
| Conversar, testar, ler o rastro de uma execução | dentro do agente |
| Subir documento, apagar documento, testar a busca | dentro da base |
| Ligar/desligar um agendamento, assumir uma automação | Automações |
| Trocar entre modo de ensaio e modo real | Automações |
| Gerar (girar) o token de um webhook | Automações |
| Renomear ou apagar uma conversa | dentro da conversa |
| Ajustar o teto de gasto com IA | Configurações → Limites |

A pergunta que separa arquivo de tela é sempre a mesma: **quem faz isso?** Se
for você, construindo o produto, é arquivo. Se for alguém usando o produto
pronto — inclusive você, no dia a dia — é tela.

## A única exceção: o segredo do webhook

Tem uma coisa que o arquivo **nunca** carrega: o token de um webhook. Ele
nasce **sorteado**, e nesse momento nem o Claude Code nem ninguém viu ele —
o webhook nasce ligado, mas **inutilizável**, porque não existe token nenhum
pra usar. Uma pessoa precisa abrir **Automações** e clicar em **Gerar token**:
aí, sim, o segredo aparece na tela, **uma vez só**, pra copiar. O endereço
(a URL) não depende do token e já existe desde que o webhook nasceu — só o
segredo é que precisa desse passo humano.

## Resumindo

- Agente, base, agendamento e webhook nascem de `lib/seed/registro.ts`, escrito
  pelo Claude Code a seu pedido.
- `npm run verify` confere a declaração antes de ela virar linha no banco.
- Ela vira linha de verdade em dois momentos: workspace novo nasce com ela, e
  workspace que já existia recebe ela sozinho no próximo deploy (ou na mão,
  agora, com `npm run semear`).
- O apelido é pra sempre — escolha com calma.
- Agendamento nasce **desligado** e em **modo de ensaio**; webhook nasce
  **ligado mas sem token nenhum que funcione**, também em modo de ensaio.
  Ligar de verdade — desligado→ligado, ensaio→real, gerar o primeiro token —
  é sempre decisão de gente, numa tela que avisa o que vai passar a acontecer.
- O materializador nunca apaga nada, e nunca sobrescreve o que uma pessoa
  decidiu na tela.

## Próximo passo

[O que é um agente (e como pedir o primeiro)](./01-o-que-e-um-agente.md) —
agora com o porquê explicado, veja como isso fica na prática.

---

## ❓ Travou? Peça ajuda

| O que você vê | O que é | O que fazer |
| --- | --- | --- |
| Pedi um agente novo e ele não aparece no workspace | falta materializar | espere o próximo deploy (ele roda sozinho), ou rode `npm run semear` agora pra não esperar; workspace novo já nasce com ele |
| Editei o arquivo e a mudança não chegou ainda | falta o deploy rodar (ou rodar de novo na mão) | `npm run verify`, publique — o deploy semeia sozinho — ou rode `npm run semear` na hora se não quiser esperar |
| Editei um **webhook** que já existia (mudei se ele espera a resposta, ou pra qual agente ele aponta) e nada mudou, nem depois do deploy | webhook é diferente dos outros três: o semear só grava webhook novo, nunca atualiza um que já existe | isso é de propósito, não bug — declare outro webhook, com outro apelido. Veja [O agente que age](./06-o-agente-que-age.md) |
| Errei o apelido e já materializei | apelido é pra sempre | declare outro, com apelido novo — o antigo fica órfão no banco, sem sumir e sem atrapalhar |
| Não acho onde clicar pra criar | é assim mesmo | peça pro Claude Code, do jeito que os exemplos desta página mostram |
| `npm run semear` disse que não conseguiu falar com o site | o site precisa estar no ar | rode `npm run dev` (ou tenha o container ligado) antes de chamar o comando na mão |

Ou cole a dúvida pro Claude Code e descreva o que você queria fazer.
