# A tela de Início: o painel do seu workspace

**Tempo de leitura:** ~5 min
**Pré-requisitos:** [o app rodando na sua máquina](./03-rodando-pela-primeira-vez.md)
**O que você vai aprender:**
- O que cada pedaço da primeira tela está te dizendo
- Por que a lista "falta configurar" some sozinha (e quando ela volta)
- De onde vem cada número — e como pedir um número seu no lugar

---

## Por que essa tela existe

Quando você entra num workspace, o app te joga aqui. É a primeira coisa que
você vê de manhã e o lugar pra onde o botão "voltar" te traz.

Antes, essa tela era **enfeite**: quatro números inventados e um gráfico
desenhado a partir de uma lista fixa dentro do código. Ficava bonito e não
servia pra nada — pior, dava a impressão de que estava tudo funcionando. Dava
pra abrir o app pela primeira vez, ver a linha do gráfico subindo e ir embora
**sem ninguém ter contado que faltava cadastrar uma chave de IA**. Você só
descobria muito depois, na primeira conversa com o agente, num erro em inglês
vindo do provedor.

Agora ela responde duas perguntas, nessa ordem:

1. **"O que ainda falta pra isso funcionar?"**
2. **"O que aconteceu por aqui?"**

---

## 1. Falta configurar

O bloco verde do topo. Ele lista os degraus que faltam pro seu agente
funcionar, com um botão em cada um levando direto pro lugar certo:

```
/ FALTA CONFIGURAR                            2 coisas pendentes

 ✓  Cadastrar uma chave de IA
 ○  Criar seu primeiro agente                        [ Ver agentes ]
    Ele nasce do código: peça pro Claude Code criar um agente pra você.
 ○  Definir um teto de gasto                        [ Definir teto ]
    É quanto o workspace pode gastar de IA por mês.
```

Três coisas que valem saber:

- **O bloco inteiro some** quando não falta mais nada. Ele não fica ocupando o
  topo da tela pra sempre repetindo que está tudo certo.
- **Ele volta sozinho** se alguma coisa deixar de estar pronta — por exemplo,
  se você criar uma base de conhecimento e não subir nenhum documento nela.
- **Degrau que você não pode cumprir não vira botão.** Se você é membro comum
  do workspace, cadastrar chave não é sua atribuição. O degrau continua
  aparecendo (é ele que explica por que o agente não responde), mas em vez do
  botão você lê *"Peça pra quem é dono ou administrador do workspace"* — é
  mais honesto do que um botão que te levaria pra uma tela onde você seria
  barrado. **"Criar seu primeiro agente" é diferente:** o botão aparece pra
  todo mundo, porque criar agente não é botão de tela nenhuma — nem pra dono,
  nem pra administrador. Ele nasce do código, e o botão só te leva pra ver a
  lista, onde a própria tela explica isso.

O degrau **"Definir um teto de gasto"** nem aparece pra membro comum: teto
faltando não te impede de nada, e seria uma pendência eterna que você não tem
como resolver.

### O degrau que não é do workspace: **"Configurar o envio de email"**

Esse é o único da lista que não fala do seu workspace, e sim do **app inteiro**.
Por isso ele só aparece pra quem é **dono do sistema** — a chave de email é uma
só, pra todo mundo, e mora numa tela que só o dono abre.

Ele está aí porque o problema que ele evita é invisível até doer: enquanto você
não configurar, quem manda os emails de **criar conta** e **recuperar senha** é
o Supabase, e ele entrega só **2 por hora**. Passou disso, quem tentar criar
conta recebe um erro e fica de fora — e **nada te avisa**. Você só descobre
quando alguém reclama.

O botão te leva pra **Plataforma → Configurações**. Lá são dois passos, e a
própria tela te guia no segundo: cadastrar a chave da Resend resolve os emails
que *este app* manda (o convite e o resultado de automação), e depois disso o
cartão da Resend mostra exatamente o que colar no painel do Supabase pra que a
criação de conta e a recuperação de senha também saiam por lá.

> O degrau some quando você cadastra a chave. O segundo passo (o do painel do
> Supabase) o app **não tem como conferir** — quem conta aquilo é o cartão da
> Resend, onde você já vai estar. Um degrau que nunca sumisse viraria enfeite, e
> enfeite ensina a ignorar a lista inteira.

---

## 2. Os quatro números

| Número | O que é | Clicando, você vai pra |
|---|---|---|
| **Execuções · 7 dias** | quantas vezes um agente rodou na última semana. Se alguma deu errado, aparece em vermelho embaixo | Execuções |
| **Gasto do mês** | quanto de IA você já gastou neste mês, e quantos % do seu teto isso representa | Limites de IA |
| **Agentes ligados** | quantos agentes estão ativos. Se você tem rascunhos, o total aparece embaixo | Agentes |
| **Trechos indexados** | quantos pedaços de documento o agente pode consultar | Conhecimento |

> **"Execuções" conta tudo, não só o chat.** Toda vez que um agente roda —
> você conversando, uma automação disparando na hora marcada, ou um sistema de
> fora chamando o seu webhook — vira uma execução. Por isso esse número às
> vezes sobe sozinho de madrugada: é a automação trabalhando.

---

## 3. Custo por dia

O gráfico mostra quanto a IA custou **em cada um dos últimos 30 dias**.

Ele sai da mesma tabela que segura o seu teto de gasto — ou seja, o que aparece
aqui é literalmente o que o freio está contando. Se o número te assustar, o
lugar de agir é [Limites de IA](../06-agentes-de-ia/05-teto-de-gasto.md).

Duas coisas que confundem à primeira vista:

- **Os valores têm 4 casas depois da vírgula** ("US$ 0,0042"). É de propósito:
  um dia de uso normal custa frações de centavo, e com 2 casas o gráfico
  inteiro viraria "US$ 0,00" repetido. O cartão "gasto do mês", logo acima, usa
  2 casas — lá a escala é de mês, e aí faz sentido.
- **Workspace novo mostra uma frase, não um gráfico.** Trinta dias de zero
  desenham uma linha reta colada no chão, que dá trabalho de ler e não diz
  nada.

---

## 4. Últimas execuções

As cinco últimas vezes que um agente rodou, com o resultado, quem mandou, há
quanto tempo foi e quanto custou. Clicando em qualquer linha você abre o
**passo a passo** daquela execução — o que o agente pensou, quais ferramentas
usou e o que cada uma respondeu.

A lista completa, com filtro por agente, resultado e período, fica em
**Execuções**.

---

## 5. Próximas automações

Só aparece se você tiver alguma automação ligada, e só pra quem administra o
workspace. Diz o nome dela, qual agente ela roda e **daqui a quanto tempo**.

> Se você criou uma automação e ela aparece aqui como "roda em 3 h" mas nunca
> roda, o problema quase sempre é o mesmo: o `npm run dev` sobe **só o site**.
> Quem faz automação acontecer é um segundo programa, o `npm run worker`. Isso
> está explicado em [Automações](../06-agentes-de-ia/04-automacoes.md).

---

## Como colocar um número seu aqui

Todos os números dessa tela saem de consultas ao banco, escritas em
`lib/dashboard/queries.ts`. Nada ali é inventado, e nada ali é intocável.

Quando você criar as suas próprias funcionalidades, provavelmente vai querer
que a primeira tela mostre **os seus** números, não os da IA. Abra o Claude
Code e peça em português. Por exemplo:

> "No Início, troca o card 'trechos indexados' por 'clientes cadastrados' — é
> pra contar as linhas da tabela de clientes deste workspace."

ou

> "No Início, põe embaixo do gráfico uma lista dos 5 últimos pedidos, com o
> nome do cliente e o valor."

Ele sabe onde mexer: a tela é `app/(app)/app/[orgSlug]/dashboard/`, as
consultas são `lib/dashboard/queries.ts` e a lista do "falta configurar" é
`lib/dashboard/passos.ts`.

---

## Próximo passo

Aprenda a pedir funcionalidades novas em
[04-conhecendo-claude-code](./04-conhecendo-claude-code.md), ou pule direto pra
[06-agentes-de-ia](../06-agentes-de-ia/01-o-que-e-um-agente.md) e crie o agente
que a tela está te pedindo.
