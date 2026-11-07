"use client";

/**
 * UM BALÃO da conversa: a pergunta da pessoa ou a resposta do agente.
 *
 * Apresentação pura: não busca nada, não decide nada, não fala com o banco.
 *
 * O que ele mostra, na ordem:
 *   1. o texto (e o raciocínio, quando o modelo manda);
 *   2. o rastro ao vivo embaixo — as ferramentas que o agente chamou, o custo
 *      e o link pro passo a passo completo;
 *   3. o aviso vermelho, quando aquela resposta falhou.
 *
 * ⚠️ AS FERRAMENTAS NÃO APARECEM DENTRO DO BALÃO, e sim no `<LiveTrace>`
 * embaixo dele. É de propósito: mostrar nos dois lugares dobraria o cartão na
 * tela toda vez que o agente usasse uma ferramenta.
 */
import { BotIcon } from "lucide-react";
import type { AgentUIMessage } from "@/lib/threads/types";
import { LiveTrace } from "./live-trace";
import { RespostaFormatada } from "./resposta-formatada";
import { ThinkingIndicator } from "./thinking-indicator";

/** O texto do balão, juntando os pedaços de texto na ordem em que chegaram. */
function textoDe(message: AgentUIMessage): string {
  return (message.parts ?? [])
    .map((p) => (p.type === "text" && typeof p.text === "string" ? p.text : ""))
    .join("");
}

/** O raciocínio do modelo, quando ele manda (nem todo modelo manda). */
function raciocinioDe(message: AgentUIMessage): string {
  return (message.parts ?? [])
    .map((p) => (p.type === "reasoning" && typeof p.text === "string" ? p.text : ""))
    .join("")
    .trim();
}

export function MessageBubble({
  message,
  agentName,
  orgSlug,
  streaming = false,
}: {
  message: AgentUIMessage;
  agentName: string;
  orgSlug: string;
  /** `true` enquanto ESTA resposta ainda está chegando. */
  streaming?: boolean;
}) {
  const daPessoa = message.role === "user";
  const texto = textoDe(message);
  const raciocinio = raciocinioDe(message);
  const meta = message.metadata;

  const falhou = meta?.status === "failed";
  const cancelada = meta?.status === "cancelled";

  // Resposta que ainda não escreveu nada: as bolinhas piscando, não um balão
  // vazio. Um balão vazio parece que travou.
  const aindaNaoEscreveu = !daPessoa && texto.trim().length === 0 && streaming;

  return (
    <div className={`flex gap-3 ${daPessoa ? "flex-row-reverse" : ""}`}>
      <div
        className={`grid h-7 w-7 shrink-0 place-items-center rounded-md font-medium text-[11px] ${
          daPessoa ? "bg-foreground text-background" : "bg-primary text-primary-foreground"
        }`}
        aria-hidden="true"
      >
        {daPessoa ? "VC" : <BotIcon className="h-3.5 w-3.5" />}
      </div>

      <div className={`min-w-0 max-w-[85%] ${daPessoa ? "text-right" : ""}`}>
        <span className="sr-only">{daPessoa ? "Você" : agentName} disse:</span>

        <div
          className={`inline-block max-w-full rounded-lg px-3.5 py-2.5 text-left text-sm ${
            daPessoa
              ? "bg-foreground text-background"
              : falhou
                ? "border border-destructive/40 bg-destructive/5"
                : "border border-border/60 bg-card/80"
          }`}
        >
          {aindaNaoEscreveu ? (
            <ThinkingIndicator />
          ) : (
            <>
              {raciocinio.length > 0 && (
                <p className="mb-2 border-border/60 border-l-2 pl-2 text-muted-foreground text-xs italic">
                  {raciocinio}
                </p>
              )}
              {daPessoa ? (
                // A pergunta sai como a pessoa digitou. Interpretar Markdown no
                // que ELA escreveu comeria um asterisco que ela quis mesmo.
                <div className="whitespace-pre-wrap break-words leading-relaxed">{texto}</div>
              ) : (
                <RespostaFormatada texto={texto} />
              )}
            </>
          )}
        </div>

        {!daPessoa && (
          <>
            {falhou && meta?.errorMessage && texto.trim() !== meta.errorMessage && (
              <p role="alert" className="mt-1.5 text-destructive text-xs">
                {meta.errorMessage}
              </p>
            )}
            {cancelada && (
              <p className="mt-1.5 text-muted-foreground text-xs">
                Essa resposta foi interrompida. O que o agente já tinha gastado está no rastro.
              </p>
            )}
            <LiveTrace
              message={message}
              orgSlug={orgSlug}
              runId={meta?.runId}
              defaultOpen={streaming}
            />
          </>
        )}
      </div>
    </div>
  );
}
