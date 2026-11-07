"use client";

/**
 * O CARTÃO DE FERRAMENTA que aparece no meio da conversa.
 *
 * É o que transforma "o agente sumiu por 4 segundos" em "ele foi buscar na
 * base de conhecimento". Sem isso, ferramenta é caixa-preta — e leigo não
 * depura caixa-preta.
 *
 * ⚠️ O RÓTULO EM PT-BR SAI DO REGISTRO (`getTool(id)?.label`), não do id
 * técnico. O modelo pede `buscar-na-base`; a pessoa lê "Buscar na base de
 * conhecimento".
 * `@/lib/agents/tools` é PURO (é um catálogo em código, não uma consulta), por
 * isso um componente com `"use client"` pode importar dele.
 *
 * Apresentação pura: não busca nada, não decide nada.
 */
import { AlertTriangleIcon, CheckIcon, ChevronDownIcon, WrenchIcon } from "lucide-react";
import { useState } from "react";
import { getTool } from "@/lib/agents/tools";

/** Os quatro estados que uma chamada de ferramenta atravessa. */
export type ToolCallState =
  | "input-streaming"
  | "input-available"
  | "output-available"
  | "output-error";

/** O texto que descreve o estado, em português de gente. */
function comoEstá(state: string, rotulo: string): { texto: string; vivo: boolean } {
  switch (state) {
    case "input-streaming":
      return { texto: `Preparando "${rotulo}"…`, vivo: true };
    case "input-available":
      return { texto: `Usando "${rotulo}"…`, vivo: true };
    case "output-available":
      return { texto: `Usou "${rotulo}"`, vivo: false };
    case "output-error":
      return { texto: `"${rotulo}" não conseguiu responder`, vivo: false };
    case "output-denied":
      return { texto: `"${rotulo}" não foi autorizada`, vivo: false };
    default:
      return { texto: `"${rotulo}"`, vivo: false };
  }
}

/** Qualquer valor vira um bloco de texto legível — e NUNCA derruba a tela. */
function comoTexto(valor: unknown): string {
  if (valor === undefined || valor === null) return "—";
  if (typeof valor === "string") return valor;
  try {
    return JSON.stringify(valor, null, 2) ?? "—";
  } catch {
    return "(não deu pra mostrar esse valor)";
  }
}

export function ToolCallCard({
  toolName,
  state,
  input,
  output,
  errorText,
}: {
  /** O id técnico. O rótulo em PT-BR sai de `getTool(id)?.label`. */
  toolName: string;
  state: ToolCallState | string;
  input: unknown;
  output: unknown;
  errorText?: string | null;
}) {
  const [aberto, setAberto] = useState(false);

  const ficha = getTool(toolName);
  const rotulo = ficha?.label ?? toolName;
  const { texto, vivo } = comoEstá(state, rotulo);
  const deuErro = state === "output-error";

  return (
    <div
      className={`overflow-hidden rounded-lg border text-sm ${
        deuErro ? "border-destructive/40 bg-destructive/5" : "border-border/60 bg-card/40"
      }`}
    >
      <button
        type="button"
        onClick={() => setAberto((v) => !v)}
        className="flex w-full items-center gap-2 px-3 py-2 text-left transition-colors hover:bg-card/80"
        aria-expanded={aberto}
      >
        {deuErro ? (
          <AlertTriangleIcon className="h-3.5 w-3.5 shrink-0 text-destructive" />
        ) : vivo ? (
          <WrenchIcon className="h-3.5 w-3.5 shrink-0 animate-pulse text-primary" />
        ) : (
          <CheckIcon className="h-3.5 w-3.5 shrink-0 text-primary" />
        )}

        <span className="flex-1 truncate">{texto}</span>

        <ChevronDownIcon
          className={`h-3.5 w-3.5 shrink-0 text-muted-foreground transition-transform ${
            aberto ? "rotate-180" : ""
          }`}
        />
      </button>

      {aberto && (
        <div className="space-y-3 border-border/60 border-t bg-background/40 px-3 py-3">
          {ficha?.description && (
            <p className="text-muted-foreground text-xs">{ficha.description}</p>
          )}

          <div className="space-y-1">
            <p className="label-mono text-[10px]">/ o que ele pediu</p>
            <pre className="max-h-48 overflow-auto whitespace-pre-wrap break-words rounded-md bg-muted/40 p-2 font-mono text-[11px] leading-relaxed">
              {comoTexto(input)}
            </pre>
          </div>

          {deuErro ? (
            <div className="space-y-1">
              <p className="label-mono text-[10px]">/ o que deu errado</p>
              <p className="text-destructive text-xs">
                {errorText ?? "A ferramenta não explicou o motivo."}
              </p>
            </div>
          ) : (
            <div className="space-y-1">
              <p className="label-mono text-[10px]">/ o que voltou</p>
              <pre className="max-h-64 overflow-auto whitespace-pre-wrap break-words rounded-md bg-muted/40 p-2 font-mono text-[11px] leading-relaxed">
                {comoTexto(output)}
              </pre>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
