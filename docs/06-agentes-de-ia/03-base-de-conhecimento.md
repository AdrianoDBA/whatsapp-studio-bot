# Base de conhecimento (o agente responde com os SEUS documentos)

**Tempo de leitura:** ~10 min
**Pré-requisitos:** [um agente criado](./01-o-que-e-um-agente.md)
**O que você vai aprender:**
- Como um PDF vira resposta de agente
- Qual chave serve pra ler documento (e por que a da Anthropic não serve)
- Criar base, subir documento, testar a busca
- Ligar isso num agente

---

## Em uma frase

Você sobe manual, contrato, política, tabela de preços — e o agente passa a
responder **com aquilo**, citando de onde tirou.

## Como funciona, sem enrolação

```
seu arquivo  →  vira texto  →  o texto é cortado em pedaços de ~1.000 letras
             →  cada pedaço vira uma lista de 1.536 números que representa o
                SIGNIFICADO dele
             →  na hora da pergunta, o banco acha os pedaços mais parecidos
                e entrega pro agente
```

A parte dos números tem nome (embedding) e **é ela que custa dinheiro** — bem
pouco, e só uma vez por documento. A busca em si é o banco procurando, e é
barata.

Repare no detalhe que muda tudo: a busca é por **significado**, não por palavra
exata. Perguntar "posso devolver depois de 40 dias?" acha o trecho que fala em
"prazo de devolução de 30 dias" mesmo sem repetir nenhuma palavra.

## ⚠️ Antes de tudo: você precisa da chave certa

Indexar documento exige um provedor que saiba fazer *embedding* — transformar
texto em números. Hoje são **três**:

| Provedor | Serve pra indexar? |
| --- | --- |
| **OpenRouter** | ✅ sim — e é o recomendado: uma chave só faz tudo |
| **OpenAI** | ✅ sim |
| **Google** | ✅ sim |
| **Anthropic** | ❌ não tem esse serviço |

Ou seja: com a chave do OpenRouter você conversa com o agente **e** indexa
documento, sem precisar de conta em mais lugar nenhum. Só a chave da Anthropic
(Claude) sozinha não dá conta de documento — ela serve pra conversar.

Se for o seu caso, a tela de Conhecimento já te avisa, antes de você subir 40
arquivos e falhar todos.

Cadastre a chave em **Configurações → Integrações** (ou em **Plataforma →
Configurações**, se você quiser que valha pra todos os workspaces).

## 1. Criar uma base

Base de conhecimento segue a mesma regra dos agentes: **não existe botão "Nova
base"**. Uma base nasce de um arquivo, e quem escreve esse arquivo é o Claude
Code, a seu pedido — a mecânica completa está em
[Como nascem as coisas](./00-como-nascem-as-coisas.md). Peça assim:

> "Cria uma base de conhecimento chamada 'Manual do produto' pra eu subir os
> PDFs do time de suporte."

O Claude Code declara ela em `lib/knowledge/blueprint.ts` (ou reaproveita o
molde) e acrescenta na lista `BASES`, em `lib/seed/registro.ts`. `npm run
verify` confere a declaração antes de qualquer coisa chegar no banco, e a base
aparece no seu workspace — sozinha, se ele for novo; depois de `npm run
semear`, se ele já existia.

Uma base é uma "pasta" de documentos que combinam entre si: *Manual do produto*,
*Contratos*, *Políticas de RH*. Você pode ter várias.

No arquivo você escolhe o **modelo de indexação** (se tiver mais de um
disponível). E aqui vai o aviso mais importante desta página:

> ⚠️ **O modelo de indexação é congelado na criação.** Não dá pra trocar depois.
> Se metade dos trechos fosse lida por um modelo e metade por outro, a busca
> passaria a devolver **trecho aleatório**, sem erro nenhum aparecendo —
> e não tem conserto sem refazer tudo. **Pra trocar de modelo:** peça pro Claude
> Code declarar **outra base no arquivo, com outro apelido**, rode `npm run
> semear` e suba os arquivos de novo nela.

## 2. Subir documento

Abra a base. Tem duas abas:

**Enviar arquivo** — `.pdf`, `.txt`, `.md` ou `.csv`, até **5 MB**.

**Colar texto** — você dá um título e cola o conteúdo. Serve pra qualquer coisa
que não é arquivo: um trecho de site, um email, uma anotação. E é o plano B do
PDF: se um PDF específico não for lido (PDF escaneado é imagem, não texto), abra
ele, copie o texto e cole aqui.

> O app confere **o conteúdo do arquivo**, não a extensão. Renomear um `.exe`
> pra `.txt` não engana ninguém.

Depois de enviar, o documento passa por três situações:

| Situação | O que quer dizer |
| --- | --- |
| **Na fila** | o arquivo chegou e está esperando a vez de ser lido |
| **Processando** | está lendo e indexando. Documento grande demora |
| **Pronto** | indexado. Mostra em quantos pedaços ficou e quanto custou |
| **Falhou** | tem o motivo escrito em português, e um botão **Tentar de novo** |

> **Pode fechar a página.** Quem lê o arquivo é o mesmo processo que roda as
> automações, e ele trabalha por fora da tela. Você envia, a linha aparece como
> **Na fila**, e ela vira **Pronto** sozinha — mesmo que você tenha fechado o
> navegador. Atualize a página pra ver como está.
>
> Texto colado é diferente: ele é lido na hora, porque já chega pronto.

> **Na sua máquina, o arquivo só é lido se o trabalhador estiver de pé.** O
> `npm run dev` sobe só o site. Abra outro terminal e rode `npm run worker`,
> senão o documento fica em **Na fila** pra sempre. No servidor de verdade os
> dois sobem juntos, sozinhos.

## 3. Testar a busca (antes de ligar num agente)

Na tela da base tem **Testar busca**. Escreva uma pergunta de verdade — do jeito
que um cliente escreveria — e veja quais trechos aparecem.

É o teste mais barato que existe: se o trecho certo não aparece aqui, o agente
também não vai achar. Nesse caso:

- o documento pode ter entrado como imagem (PDF escaneado) → use "Colar texto";
- o assunto pode não estar escrito em lugar nenhum → suba o documento que fala
  dele;
- pode estar em outra base → o agente busca em uma base por vez quando você diz
  qual.

## 4. Ligar num agente

A ferramenta **Buscar na base de conhecimento** também é uma linha no arquivo
do agente — peça pro Claude Code acrescentar `"buscar-na-base"` na lista
`tools` dele (em `lib/agents/<seu-agente>.ts`) e materializar de novo.

Depois, nas **instruções** do agente, diga **quando** usar. Sem isso ele às
vezes responde de cabeça:

> Antes de responder qualquer dúvida sobre o produto, use a ferramenta de buscar
> na base de conhecimento. Responda **só** com o que estiver nos trechos
> encontrados e cite o nome do documento. Se não achar nada, diga que não achou —
> nunca invente.

Pronto: pergunte no chat e ele passa a citar a origem.

## Quanto custa

Bem pouco, mas não é zero:

- **indexar** custa uma vez por documento — a tela mostra o valor de cada um, em
  dólar;
- **perguntar** custa uma fração de centavo tão pequena que nem aparece no
  rastro da execução;
- o preço grande continua sendo o **modelo da conversa**, não a busca.

Quando o app não consegue apurar o custo, ele escreve **"preço desconhecido"** —
nunca "US$ 0,00".

## Quem pode o quê

| Ação | Quem |
| --- | --- |
| Ver as bases, ver documentos, testar busca | qualquer membro do workspace |
| Subir e apagar documento | dono e administrador |

Criar base não é uma dessas linhas: ninguém faz isso pela tela — nem dono, nem
administrador. É sempre arquivo + Claude Code, como no passo 1.

E, como em todo o resto do app, **um workspace nunca enxerga a base do outro** —
isso é garantido pelo banco, não pela tela.

## Próximo passo

[Automações](./04-automacoes.md) — o agente rodando sozinho, na hora marcada.

---

## ❓ Travou? Peça ajuda

| O que você vê | O que é | O que fazer |
| --- | --- | --- |
| A tela de Conhecimento avisa que falta chave pra ler documento | nenhum provedor que saiba indexar | cadastre uma chave do OpenRouter, da OpenAI ou do Google em Configurações → Integrações |
| Documento "Falhou" com "não consegui ler o texto" | provavelmente PDF escaneado (é imagem) | abra o PDF, copie o texto, use a aba **Colar texto** |
| Documento parado em "Na fila" e não sai de lá | o trabalhador não está rodando | na sua máquina, rode `npm run worker` num terminal separado |
| Documento "Falhou" com "não achei mais o arquivo original" | o arquivo demorou demais na fila e o endereço dele expirou | clique em **Tentar de novo** — ele gera um endereço novo |
| A busca não acha o que você sabe que está lá | o trecho pode não ter entrado | use **Testar busca** com as palavras do próprio documento; se não achar, o problema é a indexação, não o agente |
| O agente responde sem consultar a base | as instruções não mandam consultar | escreva "use a ferramenta antes de responder" nas instruções |
| Quero trocar o modelo de indexação | não dá — é congelado | peça pro Claude Code declarar outra base no arquivo, com outro apelido, e suba os arquivos de novo nela |

Ou cole o erro pro Claude Code e descreva o que estava fazendo.
