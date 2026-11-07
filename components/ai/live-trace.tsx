"use client";

/**
 * O RASTRO AO VIVO de uma resposta: o que o agente fez pra chegar nela.
 *
 * Mora embaixo da bolha do agente e mostra, na hora em que acontece, cada
 * ferramenta que ele chamou. Enquanto a resposta está chegando ele abre
 * sozinho (`defaultOpen`), porque é exatamente aí que a pessoa quer saber por
 * que o agente ficou quieto.
 *
 * NÃO CONFUNDIR com o `<RunTrace>` de `components/app/`: aquele lê
 * `agent_run_steps` do banco e mostra o passo a passo NUMERADO, com duração e
 * custo por passo. Este aqui mostra só o que já chegou pelo stream — o rastro
 * completo está a um clique de distância, em `/execucoes/[runId]`.
 *
 * Apresentação pura: não busca nada, não decide nada.
 */
import { ChevronDownIcon, ExternalLinkIcon } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { getTool } from "@/lib/agents/tools";
import { formatTokens, formatUsdFromMicros } from "@/lib/format";
import type { AgentUIMessage } from "@/lib/threads/types";
import { ToolCallCard } from "./tool-call-card";

type ParteDeFerramenta = {
  type: string;
  toolCallId?: string;
  toolName?: string;
  state?: string;
  input?: unknown;
  output?: unknown;
  errorText?: string;
};

/** Só as partes que são chamada de ferramenta, com o nome já resolvido. */
function ferramentasDa(message: AgentUIMessage) {
  const saida: Array<{ chave: string; nome: string; parte: ParteDeFerramenta }> = [];

  (message.parts ?? []).forEach((p, indice) => {
    const parte = p as ParteDeFerramenta;
    if (parte.type === "dynamic-tool") {
      saida.push({
        chave: parte.toolCallId ?? `dyn-${indice}`,
        nome: parte.toolName ?? "ferramenta",
        parte,
      });
      return;
    }
    if (parte.type.startsWith("tool-")) {
      saida.push({
        chave: parte.toolCallId ?? `tool-${indice}`,
        // `tool-buscar-na-base` → `buscar-na-base` (o id pode ter hífen,
        // então é `slice(1).join("-")`, nunca `split("-")[1]`).
        nome: parte.type.split("-").slice(1).join("-"),
        parte,
      });
    }
  });

  return saida;
}

export function LiveTrace({
  message,
  orgSlug,
  runId,
  defaultOpen = false,
}: {
  message: AgentUIMessage;
  orgSlug: string;
  /** A execução dona desta resposta. Sem ela não tem link pro rastro completo. */
  runId?: string;
  defaultOpen?: boolean;
}) {
  const [aberto, setAberto] = useState(defaultOpen);

  const ferramentas = ferramentasDa(message);
  const meta = message.metadata;
  const execucao = runId ?? meta?.runId;

  const tokens = (meta?.tokensInput ?? 0) + (meta?.tokensOutput ?? 0);

  // ⚠️ CUSTO `null` NUNCA VIRA "US$ 0,00". Zero quer dizer "não custou nada";
  // `null` quer dizer "não deu pra calcular" (o número certo está no rastro).
  // Mostrar zero pros dois seria mentir sobre a conta.
  const temCusto = meta?.costMicros !== null && meta?.costMicros !== undefined;

  // Nada pra contar e nenhuma ferramenta: não polui a conversa com uma linha
  // vazia.
  if (ferramentas.length === 0 && !execucao && tokens === 0) return null;

  const resumo =
    ferramentas.length === 0
      ? "Respondeu direto, sem usar ferramenta"
      : ferramentas.length === 1
        ? `Usou ${getTool(ferramentas[0]!.nome)?.label ?? ferramentas[0]!.nome}`
        : `Usou ${ferramentas.length} ferramentas`;

  return (
    <div className="mt-1.5 space-y-2">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-muted-foreground">
        <button
          type="button"
          onClick={() => setAberto((v) => !v)}
          className="inline-flex items-center gap-1 transition-colors hover:text-foreground"
          aria-expanded={aberto}
        >
          <ChevronDownIcon
            className={`h-3 w-3 transition-transform ${aberto ? "rotate-180" : ""}`}
          />
          {resumo}
        </button>

        {tokens > 0 && <span>{formatTokens(tokens)} tokens</span>}

        {temCusto ? (
          <span>{formatUsdFromMicros(meta?.costMicros)}</span>
        ) : (
          execucao && <span>preço no rastro</span>
        )}

        {execucao && (
          <Link
            href={`/app/${orgSlug}/execucoes/${execucao}`}
            className="inline-flex items-center gap-1 transition-colors hover:text-foreground"
          >
            ver o rastro completo
            <ExternalLinkIcon className="h-3 w-3" />
          </Link>
        )}
      </div>

      {aberto && ferramentas.length > 0 && (
        <div className="space-y-2">
          {ferramentas.map(({ chave, nome, parte }) => (
            <ToolCallCard
              key={chave}
              toolName={nome}
              state={parte.state ?? "output-available"}
              input={parte.input}
              output={parte.output}
              errorText={parte.errorText ?? null}
            />
          ))}
        </div>
      )}
    </div>
  );
}
