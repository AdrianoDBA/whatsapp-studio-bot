"use client";

import { BotIcon, ChevronDownIcon, WrenchIcon } from "lucide-react";
import { useState } from "react";
import { Badge } from "@/components/ui/badge";
import type { RunTraceStep } from "@/lib/agents/runs-queries";
import { formatDuration, formatTokens, formatUsdFromMicros } from "@/lib/format";

/**
 * O RASTRO de uma execução: o passo a passo do que o agente fez.
 *
 * Mora em `components/app/` porque é o único componente usado por DUAS telas
 * (o playground e o detalhe da execução) — e as duas mostram exatamente a
 * mesma coisa. É apresentação pura: não busca nada, não decide nada.
 *
 * Cada linha é escrita pra quem não programa:
 *   "Passo 2 · usou a ferramenta buscar-na-base · levou 0,4 s · custou US$ 0,0000"
 *
 * ⚠️ A ORDEM VEM PRONTA DE QUEM CHAMOU (`order("seq")` no banco). Este
 * componente NÃO reordena: a ordem de gravação é diferente da ordem em que as
 * coisas aconteceram, e reordenar aqui só esconderia o problema.
 *
 * ⚠️ PEGADINHA A MAIS, ESPECÍFICA DE PASSO DE AÇÃO (`acao:email` /
 * `acao:http`): ele pode aparecer ANTES da ferramenta que o disparou — o
 * efeito antes da causa. Não é bug: `recordToolStep` só grava depois que a
 * ferramenta TERMINA de rodar, enquanto a ação grava no MEIO da execução
 * dela (é assim que `ctx.acao` funciona, em `lib/agents/acoes.ts`). O `seq`
 * reflete quando cada gravação foi CONCLUÍDA, não uma linha do tempo de
 * causa-e-efeito. Não mexa no contador pra "corrigir" isso — é o contador de
 * `recorder.ts`, compartilhado com passo de modelo e ferramenta comum.
 */
export function RunTrace({
  steps,
  failed = false,
  emptyLabel,
}: {
  steps: RunTraceStep[];
  /** Execução que terminou em erro. Muda o texto de "não teve passo nenhum". */
  failed?: boolean;
  emptyLabel?: string;
}) {
  if (steps.length === 0) {
    // Rastro vazio quer dizer duas coisas OPOSTAS, e o texto tem que separar:
    // ou o agente respondeu de primeira (bom), ou ele nem chegou a começar
    // (ruim). Dizer "respondeu direto" numa execução que falhou é contar o
    // contrário do que aconteceu.
    const texto =
      emptyLabel ??
      (failed
        ? "A execução nem chegou a dar um passo — ela falhou antes disso. O motivo está aí em cima."
        : "Esse agente respondeu direto, sem usar ferramenta.");
    return <p className="px-1 py-4 text-muted-foreground text-sm">{texto}</p>;
  }

  return (
    <ol className="space-y-2">
      {steps.map((passo) => (
        <Passo key={passo.seq} passo={passo} />
      ))}
    </ol>
  );
}

/**
 * Rótulo, em PT-BR leigo, de cada AÇÃO (`acao:email`, `acao:http`, ...).
 * `tool_name` de uma ação sempre chega no formato `acao:<nome>` (ver
 * `lib/agents/recorder.ts`, `recordAcaoStep`) — indexar pelo pedaço depois
 * dos dois-pontos, com fallback genérico, é o que evita precisar de um `if`
 * novo (e um vazamento novo) toda vez que nascer uma ação (ex.: `acao:sms`).
 */
const ROTULO_DA_ACAO: Record<string, { feito: string; tentativa: string; ensaio: string }> = {
  email: {
    feito: "mandou um email",
    tentativa: "tentou mandar um email",
    ensaio: "teria mandado um email",
  },
  http: {
    feito: "chamou um sistema de fora",
    tentativa: "tentou chamar um sistema de fora",
    ensaio: "teria chamado um sistema de fora",
  },
};

/**
 * `acao:X` → frase em português. Ação que este componente ainda não conhece cai
 * no fallback genérico — ainda em português, nunca o identificador cru.
 *
 * ⚠️ O TEMPO DO VERBO SEGUE O `simulado`, e isso é o conserto de um defeito
 * de verdade: o rastro escrevia "Passo 1 · **mandou** um email" na linha de
 * cima e "✋ Ensaio — eu **teria** mandado" logo embaixo, se contradizendo em
 * dois centímetros de tela. Quem lê o título do passo e não o avisinho fica
 * achando que o email saiu.
 *
 * O erro ganha do ensaio na ordem das perguntas de propósito: uma ação em
 * ensaio que ainda assim FALHOU (endereço barrado, destinatário inválido) não
 * "teria mandado" coisa nenhuma — nem no ensaio ela passou.
 */
function rotuloDaAcao(nomeDaAcao: string, deuErro: boolean, simulado: boolean): string {
  const rotulo = ROTULO_DA_ACAO[nomeDaAcao];
  if (rotulo) {
    if (deuErro) return rotulo.tentativa;
    return simulado ? rotulo.ensaio : rotulo.feito;
  }
  if (deuErro) return `tentou rodar uma ação (${nomeDaAcao})`;
  return simulado ? `teria rodado uma ação (${nomeDaAcao})` : `rodou uma ação (${nomeDaAcao})`;
}

function Passo({ passo }: { passo: RunTraceStep }) {
  const [aberto, setAberto] = useState(false);
  const deuErro = passo.errorMessage !== null;

  // `acao:*` é tratado à parte: é o único `tool_name` que carrega um
  // identificador técnico (não o rótulo pensado pra tela) — ver o comentário
  // de `ROTULO_DA_ACAO` acima.
  const nomeDaAcao = passo.toolName?.startsWith("acao:")
    ? passo.toolName.slice("acao:".length)
    : null;

  const oQueFez =
    passo.kind !== "tool"
      ? "pensou e escreveu"
      : nomeDaAcao !== null
        ? rotuloDaAcao(nomeDaAcao, deuErro, passo.simulado)
        : `usou a ferramenta ${passo.toolName ?? "(sem nome)"}`;

  return (
    <li
      className={`rounded-lg border ${
        deuErro ? "border-destructive/40 bg-destructive/5" : "border-border/60 bg-card/40"
      }`}
    >
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1 p-3 text-sm">
        <span
          className={`grid h-6 w-6 shrink-0 place-items-center rounded-md ${
            passo.kind === "tool" ? "bg-chart-3/15 text-chart-3" : "bg-primary/15 text-primary"
          }`}
        >
          {passo.kind === "tool" ? (
            <WrenchIcon className="h-3 w-3" />
          ) : (
            <BotIcon className="h-3 w-3" />
          )}
        </span>

        <span className="font-medium">Passo {passo.seq}</span>
        <span className="text-muted-foreground">·</span>
        <span className="text-muted-foreground">{oQueFez}</span>

        {passo.durationMs !== null && (
          <>
            <span className="text-muted-foreground">·</span>
            <span className="font-mono text-muted-foreground text-xs">
              levou {formatDuration(passo.durationMs)}
            </span>
          </>
        )}

        <span className="text-muted-foreground">·</span>
        <span className="font-mono text-muted-foreground text-xs">
          custou {formatUsdFromMicros(passo.costMicros)}
        </span>

        {deuErro && (
          <Badge
            variant="outline"
            className="border-destructive/40 bg-destructive/10 text-destructive"
          >
            deu erro
          </Badge>
        )}

        <button
          type="button"
          onClick={() => setAberto((v) => !v)}
          className="ml-auto inline-flex items-center gap-1 text-muted-foreground text-xs hover:text-foreground"
          aria-expanded={aberto}
        >
          {aberto ? "esconder" : "ver o que entrou e o que saiu"}
          <ChevronDownIcon
            className={`h-3 w-3 transition-transform ${aberto ? "rotate-180" : ""}`}
          />
        </button>
      </div>

      {deuErro && (
        <p className="border-destructive/20 border-t px-3 py-2 text-destructive text-sm">
          {passo.errorMessage}
        </p>
      )}

      {/* Fora do `aberto`, de propósito: o aviso de ensaio precisa aparecer
          MESMO com o passo fechado — senão quem só bate o olho no rastro acha
          que o email saiu de verdade, e o modo ensaio perde o sentido.

          ⚠️ E ele diz O QUÊ, não só "isso". Ensaio é o PADRÃO de automação e
          webhook (regra 10-L), então esta é a frase que o aluno mais lê no
          rastro: "eu teria feito isso" não informava nada. A frase pronta vem
          do `detalhe` do passo (montada em `lib/agents/acoes.ts`, já cortada
          no tamanho que cabe); a genérica ficou só de rede, pra passo antigo
          gravado antes disso e pra ação que ainda não escreva a dela. */}
      {passo.simulado && (
        <p className="mt-1 flex items-start gap-1.5 text-muted-foreground text-xs">
          <span aria-hidden="true">✋</span>
          <span>
            <strong className="text-foreground/80">Ensaio</strong> —{" "}
            {passo.detalhe ?? "eu teria feito isso, mas nada saiu pra fora."}
          </span>
        </p>
      )}

      {aberto && (
        <div className="space-y-3 border-border/60 border-t p-3">
          {(passo.tokensInput !== null || passo.tokensOutput !== null) && (
            <p className="font-mono text-muted-foreground text-xs">
              tokens — entrada {formatTokens(passo.tokensInput)} · saída{" "}
              {formatTokens(passo.tokensOutput)}
            </p>
          )}
          {/* O rótulo em PT-BR some com o `tool_name` técnico — mas quem
              estiver depurando ainda precisa achar `acao:email`/`acao:http`
              em algum lugar do detalhe do passo. */}
          {nomeDaAcao !== null && (
            <p className="font-mono text-muted-foreground text-xs">
              nome técnico: {passo.toolName}
            </p>
          )}
          <Bloco titulo="o que entrou" valor={passo.input} />
          {/* Em ensaio o `output` guardado é só o `{ detalhe }` que o aviso
              "✋ Ensaio" acima JÁ escreveu por extenso — repetir o JSON aqui
              embaixo só faria a mesma frase aparecer duas vezes. */}
          <Bloco titulo="o que saiu" valor={passo.simulado ? null : passo.output} />
        </div>
      )}
    </li>
  );
}

/** Uma caixa de texto com o conteúdo cru daquele pedaço do passo. */
function Bloco({ titulo, valor }: { titulo: string; valor: unknown }) {
  if (valor === null || valor === undefined) return null;

  let texto: string;
  if (typeof valor === "string") {
    texto = valor;
  } else {
    try {
      texto = JSON.stringify(valor, null, 2) ?? "";
    } catch {
      texto = "(não deu pra mostrar esse conteúdo)";
    }
  }
  if (texto.trim() === "") return null;

  return (
    <div className="space-y-1">
      <p className="label-mono text-[10px]">/ {titulo}</p>
      {/* overflow-x-auto: JSON largo rola dentro da caixa em vez de esticar a
          página inteira e quebrar o layout no celular. */}
      <pre className="max-h-64 overflow-auto rounded-md border border-border/60 bg-muted/30 p-2.5 text-xs">
        {texto}
      </pre>
    </div>
  );
}
