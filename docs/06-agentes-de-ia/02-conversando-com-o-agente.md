# Conversando com o agente

**Tempo de leitura:** ~6 min
**Pré-requisitos:** [um agente criado](./01-o-que-e-um-agente.md)
**O que você vai aprender:**
- Como a conversa funciona (e por que ela sobrevive ao F5)
- **Quem enxerga as suas conversas** — leia isso antes de usar com dado sensível
- O que aparece enquanto o agente trabalha
- Renomear e apagar conversa

---

## Onde fica

Menu lateral → **Agentes** → abra um agente → botão **Conversar**.

Não existe item "Chat" no menu, e isso é de propósito: conversa é sempre **com
um agente** — com as instruções, o modelo e as ferramentas que você escolheu. Um
chat "genérico" seria outro produto.

## O que muda em relação ao Testar

O botão **Testar** roda uma vez e mostra o rastro. A **conversa** lembra do que
já foi dito: você pergunta, ele responde, você diz "e o segundo?", e ele sabe do
que você está falando.

Ela também:

- **sobrevive ao F5** — o histórico fica no banco, não no navegador;
- mostra a resposta **chegando aos poucos**, em vez de a tela ficar parada;
- mostra **ao vivo** quando ele resolve usar uma ferramenta, e o que voltou;
- traz, embaixo de cada resposta, **quanto aquela resposta custou**.

## ⚠️ Quem enxerga a sua conversa

**Todo mundo do workspace lê todas as conversas daquele agente.** Escrever, só
na conversa que você começou. Quem administra também apaga.

A tela avisa isso com essas palavras, e vale repetir aqui porque não é o que a
maioria espera de um "chat".

**Por que é assim:** o histórico de **Execuções** já guarda a pergunta, a
resposta e o que cada ferramenta devolveu — e qualquer membro do workspace abre
aquilo desde antes de existir conversa. Trancar a conversa deixando o rastro
aberto prometeria uma privacidade que o app não entrega. Preferimos dizer a
verdade.

> Se o seu produto precisa de conversa privada de verdade, peça pro Claude
> Code: *"quero que conversa e execução só apareçam pra quem criou"*. Ele vai
> ter que mexer **nos dois lugares, na mesma migration** — está escrito no
> `lib/threads/CLAUDE.md`, e é a primeira coisa que ele vai ler.

## O que aparece enquanto ele trabalha

1. **"Pensando…"** — o pedido saiu, a resposta ainda não começou.
2. **Cartão de ferramenta** — quando ele decide usar uma. Mostra o nome em
   português ("Buscar na base de conhecimento"), o que ele pediu e o que voltou. Se a
   ferramenta falhar, o cartão fica vermelho **com o motivo em português**.
3. **A resposta**, letra por letra.
4. **A ficha**, embaixo: quantos tokens a resposta gastou e quanto custou. Quando o custo não pôde ser
   apurado, aparece **"preço no rastro"** com link pra execução — nunca
   "US$ 0,00".

## Se você fechar a aba no meio

Pode fechar. O agente **termina no servidor** de qualquer jeito, e a execução
fica gravada com o custo certo.

Quando você voltar, pode aparecer um aviso de que **a última resposta não chegou
a virar mensagem**, com um link pro rastro. É isso: o texto está lá, em
Execuções — só não virou balão na conversa.

> **Não existe botão "Parar", e isso é decisão.** Parar no navegador não pararia
> o servidor: o botão prometeria uma economia que não acontece.

## Renomear e apagar

- O **título nasce sozinho** da sua primeira frase. Dentro da conversa tem
  **Renomear conversa** — só pra quem começou ela.
- **Apagar leva os balões junto**, e eles somem pra todo mundo do workspace. O
  que **não** some é o gasto: as execuções continuam em Execuções, com o custo,
  o modelo e o rastro.
- **Não existe mais "apagar agente".** A única saída de fim de vida é
  aposentar (`status: "archived"`, ver
  [Como nascem as coisas](./00-como-nascem-as-coisas.md)), e aposentar **não**
  apaga as conversas — elas continuam abrindo, só pra leitura.

## Limites que você pode encontrar

| Mensagem | O que é |
| --- | --- |
| "Você já usou sua cota de IA de hoje" | limite diário por pessoa (50 mil tokens). Volta sozinho amanhã |
| "Espere um pouco" / limite de taxa | muitas mensagens em pouco tempo (10 por minuto) |
| "Falta cadastrar a chave do …" | nenhum provedor cadastrado ainda |
| Um aviso de que o agente está aposentado | a situação dele está **Aposentado** — peça pro Claude Code declarar `status: "active"` de novo; a mudança chega no próximo deploy, ou rode `npm run semear` agora pra não esperar |

## Próximo passo

[Base de conhecimento](./03-base-de-conhecimento.md) — pra ele responder com os
**seus** documentos.

---

## ❓ Travou? Peça ajuda

| O que você vê | O que fazer |
| --- | --- |
| A resposta não começa nunca | abra **Execuções**: se a execução está lá com erro, a mensagem em português está lá também |
| Ele "esqueceu" o começo da conversa | o histórico enviado ao modelo tem um teto de mensagens. Comece uma conversa nova pra assuntos novos — sai mais barato também |
| A conversa some depois do F5 | não deveria. Cole o erro do navegador pro Claude Code |
| Custo aparece como "preço no rastro" | é normal: o número certo está na execução, e o link te leva lá |

Ou cole o erro pro Claude Code e descreva o que estava fazendo.
