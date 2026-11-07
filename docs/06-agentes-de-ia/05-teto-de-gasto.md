# Teto de gasto: quanto a IA pode custar por mês

**Tempo de leitura:** ~9 min
**Pré-requisitos:** [um agente criado](./01-o-que-e-um-agente.md)
**O que você vai aprender:**
- Onde ver quanto o seu app já gastou com IA neste mês
- Como colocar um teto (por mês, por dia e por execução)
- O que exatamente acontece quando o teto é atingido — no chat, na automação e
  no webhook
- Por que o valor é em dólar e não em real
- Como ver, num lugar só, **quais workspaces estão gastando a sua chave**

---

## Por que isso existe

Agente de IA gasta dinheiro de verdade, e o gasto não avisa: ele acontece em
centavos, várias vezes por hora, na conta de um provedor que só te manda a
fatura no mês seguinte. Uma automação mal configurada rodando a cada 5 minutos
pode custar mais num fim de semana do que o app inteiro custou no mês.

O teto de gasto é o freio. Você diz "este workspace pode gastar até US$ 20 por
mês com IA", e o app para sozinho quando chega lá.

---

## Onde fica

**Menu lateral → Limites de IA.** Só **dono e administrador** entram — mexer no
teto é mexer no que o time inteiro consegue fazer.

Quem não administra o workspace não fica sem informação: quando o teto é
atingido, aparece uma faixa no topo de todas as telas dizendo o que aconteceu e
mandando pedir pra quem administra.

---

## A tela, de cima pra baixo

### 1. Quanto já foi gasto neste mês

```
US$ 3,47 de US$ 20,00
▓▓▓▓░░░░░░░░░░░░░░░░  17% do teto deste mês
US$ 2,90 de agentes · US$ 0,57 de indexar documentos
```

Repare na segunda linha: **indexar documento também gasta**. Quem lê o PDF pra
deixar ele pesquisável é a IA, e ela cobra por isso. É o gasto que mais pega
gente de surpresa.

### 2. Os meses anteriores

Essa é a parte mais útil da tela, mesmo parecendo enfeite:

```
agosto de 2026    ▓▓▓▓▓▓  US$ 3,47
julho de 2026     ▓▓      US$ 1,04
junho de 2026     ▓▓▓▓▓▓▓ US$ 3,80
```

"US$ 20,00" não significa nada pra quem nunca viu a conta de um provedor de IA.
Mas "nos últimos 3 meses vocês gastaram US$ 3,47, US$ 1,04 e US$ 3,80" significa
na hora — é essa a régua pra escolher um teto que não seja nem inútil nem uma
armadilha.

### 3. Os três tetos

| Teto | Pra que serve | Quando zera |
| --- | --- | --- |
| **Do mês** | o principal. Chegou nele, nenhuma execução nova começa | dia 1º, à meia-noite de Brasília |
| **Do dia** (opcional) | pra um dia ruim não comer o mês inteiro | toda meia-noite de Brasília |
| **Por execução** (opcional) | o único que age **durante**: o agente para de dar passos quando o que ele já gastou naquela execução passa do valor | não se aplica — é por execução |

Você não precisa digitar nada: os botões prontos (**US$ 5 · US$ 20 · US$ 50 ·
US$ 200 · Sem teto**) resolvem quase sempre. O campo livre fica escondido atrás
de **Outro valor**.

**O padrão de fábrica é sem teto**, e isso é de propósito: um app novo que
parasse calado antes de a pessoa configurar qualquer coisa seria o pior primeiro
contato possível. Quem protege a conta desde o primeiro dia são os freios de
token (abaixo) e o limite da plataforma.

### 4. Corte automático

| Escolha | O que acontece no teto |
| --- | --- |
| **Parar os agentes** (padrão) | nada novo começa até o teto zerar ou você aumentar |
| **Só avisar** | os agentes continuam rodando e a conta continua subindo — a faixa vermelha no topo avisa |

### 5. Avisar quando passar de X%

Padrão: **80%**. O aviso aparece numa faixa no topo de todas as telas do
workspace e **fica lá enquanto o gasto estiver acima dessa marca** — some
sozinho quando o mês virar, ou quando você aumentar o teto e o gasto voltar a
ficar abaixo da marca.

---

## ⚠️ O teto é uma linha de parada, não uma trava

Isso é importante e é a única coisa "estranha" do teto:

> **A última execução atravessa a linha.**

O motivo é simples: **o custo de uma execução só existe depois que ela termina**.
Antes de rodar, ninguém sabe quanto ela vai custar — nem o provedor. Então a
pergunta que o app faz não é "essa execução cabe no teto?", e sim "**o medidor já
passou da linha?**". Se passou, nada novo começa.

Na prática o estouro é de centavos. Se você quiser limitar isso também, é pra
isso que existe o **teto por execução**.

---

## O que acontece quando o teto é atingido

Depende de quem está do outro lado:

### No chat ou no botão "Rodar agora" (tem uma pessoa olhando)

> Os agentes deste workspace estão parados: vocês chegaram no teto de gasto com
> IA deste mês (US$ 20,00 de US$ 20,00). Nada quebrou e nada foi perdido. O teto
> zera sozinho em 1º de setembro — ou você pode aumentar agora em Configurações
> → Limites de IA.

Nada é gravado, nada entra em fila. É só aumentar o teto e mandar de novo.

### Numa automação por horário (não tem ninguém olhando)

A rodada é **pulada** — e a automação **continua ligada**. Na tela de Automações
ela aparece com o distintivo amarelo **"Rodada pulada"** (diferente do vermelho
de "Deu errado") e a frase:

> A rodada de hoje foi pulada: o workspace chegou no teto de gasto com IA deste
> mês. A automação continua ligada e volta sozinha na virada do mês.

Ela não é desligada de propósito — o teto zera sozinho na virada do mês, e
desligar deixaria a automação morta em setembro esperando alguém lembrar de
religar.

### Num webhook (tem um sistema esperando resposta)

O endereço responde **HTTP 429** com o cabeçalho `Retry-After` e este corpo:

```json
{
  "ok": false,
  "error": "Este workspace chegou no teto de gasto com IA deste mês. As chamadas voltam a ser aceitas em 1º de setembro.",
  "code": "teto_de_gasto"
}
```

429 e não 402 ("pagamento necessário") porque ninguém deve nada — é um limite que
vocês mesmos escolheram. O `code` é estável, então quem programa do outro lado
consegue distinguir isso de "chamou demais" (`limite_de_chamadas`).

### Ao subir um arquivo na base de conhecimento

> Não dá pra indexar este arquivo agora: o workspace chegou no teto de gasto com
> IA deste mês. Indexar também gasta — é a IA que lê o arquivo pra deixar ele
> pesquisável. O arquivo fica guardado; assim que o teto zerar (1º de setembro)
> ou for aumentado, é só clicar em "Tentar de novo".

---

## Os dois freios que existem mesmo sem teto

Além do teto, o template tem dois freios que **não mudam por workspace**:

- cada **pessoa** pode usar 50 mil tokens de IA por dia;
- a **automação** do workspace pode usar 500 mil tokens por dia.

Os dois zeram à meia-noite (horário de Brasília). Eles existem porque agem
**antes** de saber o custo — numa conta nova, sem histórico e sem teto
configurado, são eles que seguram a primeira rodada.

---

## ⚠️ Isto é um medidor, não a fatura

> Esta conta é o **medidor do seu app**, não a fatura do provedor. Ela soma o que
> o template calculou, execução por execução, com a tabela de preços que vem no
> código, no horário de Brasília. A fatura da Anthropic, da OpenAI ou do
> OpenRouter fecha noutro fuso e arredonda de outro jeito. Os dois números são
> **parecidos, nunca iguais** — na dúvida, o que vale é o do provedor.

E se você usar um modelo que **não está na tabela de preços do template**, a
execução roda normalmente mas não entra na conta: a tela mostra ela à parte
("3 execuções usaram um modelo que não está na tabela de preços"). Somar zero
seria mentir; chutar um número seria pior.

---

## Por que em dólar, e não em real

> **Porque é em dólar que a conta chega.** Converter pra real exigiria guardar
> uma cotação, e cotação parada faz o teto mentir quando o dólar mexe — você
> digitaria "R$ 100" em agosto e, em novembro, esse mesmo teto estaria cortando
> num valor bem diferente, com a tela continuando a dizer R$ 100. Um teto que
> mente é pior que teto nenhum.

Aqui o número é exatamente o mesmo que o provedor cobra.

---

## Se você é o dono do sistema: "quem está gastando a minha chave?"

Quando você cadastra uma chave de API em **Plataforma → Configurações da
plataforma**, ela passa a valer pra **todo workspace que não tenha chave
própria**. Ou seja: gente que você nem conhece pode estar gastando o seu saldo.

A tela **Plataforma → Gastos por workspace** responde isso numa tabela:

| Coluna | O que é |
| --- | --- |
| Workspace | nome e apelido |
| Gastou no mês | quanto aquele time gastou com IA neste mês |
| Teto do workspace | o que **eles** escolheram |
| % | quanto do teto já foi |
| **Chave própria** | "Sim" = gastam o dinheiro deles. "Usa a sua" = gastam o seu |
| **Limite da plataforma** | o teto que **você** põe por cima, workspace por workspace |

O **limite da plataforma** é o único teto que o dono do workspace não consegue
mexer — e ele corta **mesmo com o corte automático de lá desligado**. Sem isso,
bastaria alguém desligar o corte no workspace dele pra gastar a sua chave sem
limite.

Deixe o campo vazio pra tirar o limite.

## Próximo passo

[O agente que age](./06-o-agente-que-age.md) — como ele manda email, por que ele
nasce em modo de ensaio, e como a automação te entrega o resultado.

---

## ❓ Travou? Peça ajuda

| O que você vê | O que é | O que fazer |
| --- | --- | --- |
| "Os agentes deste workspace estão parados" no chat | o teto do mês (ou do dia) chegou | aumente em **Limites de IA**, ou espere a virada |
| A mesma frase, mas você não é admin | idem | peça pra quem administra o workspace aumentar |
| "foi atingido o limite... que quem cuida do sistema definiu" | é o limite da **plataforma** | ele não muda dentro do workspace — fale com quem administra o sistema |
| Automação com o distintivo **"Rodada pulada"** | teto, não defeito | a automação continua ligada e volta na virada. Pra voltar antes, aumente o teto |
| Webhook responde **429** com `code: "teto_de_gasto"` | teto de gasto | aumente o teto ou espere o `Retry-After` |
| Documento não indexa e fala em teto | indexar também gasta | aumente o teto e clique em **Tentar de novo** |
| O gasto da tela não bate com a fatura do provedor | é esperado | leia "Isto é um medidor, não a fatura" aqui em cima |
| O gasto está US$ 0,00 mas os agentes rodaram | provavelmente o modelo não está na tabela de preços | a tela mostra "N execuções sem preço"; troque de modelo se quiser a conta certa |
| Apaguei execuções e o gasto não baixou | é de propósito | apagar histórico não devolve saldo, senão "limpar o histórico" seria o botão de zerar a conta |

Ou cole a mensagem pro Claude Code e descreva o que estava fazendo.
