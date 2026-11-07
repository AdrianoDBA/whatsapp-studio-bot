"use client";

import { useRouter } from "next/navigation";
import type { RunStatus } from "@/lib/agents/runs-queries";

type Periodo = "24h" | "7d" | "30d" | "tudo";

const statusOpcoes: Array<{ value: RunStatus | ""; label: string }> = [
  { value: "", label: "Todas" },
  { value: "succeeded", label: "Deram certo" },
  { value: "failed", label: "Deram errado" },
  { value: "running", label: "Rodando agora" },
  { value: "queued", label: "Na fila" },
  { value: "cancelled", label: "Canceladas" },
];

const periodoOpcoes: Array<{ value: Periodo; label: string }> = [
  { value: "24h", label: "24 horas" },
  { value: "7d", label: "7 dias" },
  { value: "30d", label: "30 dias" },
  { value: "tudo", label: "Tudo" },
];

/**
 * Os filtros da lista de execuções.
 *
 * Eles moram na URL (`?agente=&status=&periodo=`), não em estado da tela: assim
 * o aluno consegue copiar o endereço e mandar pra alguém, e o botão "voltar"
 * do navegador funciona como ele espera.
 */
export function RunsFilters({
  orgSlug,
  agents,
  current,
}: {
  orgSlug: string;
  agents: Array<{ slug: string; name: string }>;
  current: { agente?: string; status?: RunStatus; periodo?: Periodo };
}) {
  const router = useRouter();

  function aplicar(mudanca: Partial<{ agente: string; status: string; periodo: string }>) {
    const params = new URLSearchParams();
    const proximo = {
      agente: current.agente ?? "",
      status: current.status ?? "",
      periodo: current.periodo ?? "7d",
      ...mudanca,
    };

    if (proximo.agente) params.set("agente", proximo.agente);
    if (proximo.status) params.set("status", proximo.status);
    if (proximo.periodo && proximo.periodo !== "7d") params.set("periodo", proximo.periodo);

    const query = params.toString();
    router.push(`/app/${orgSlug}/execucoes${query ? `?${query}` : ""}`);
  }

  return (
    <div className="flex flex-wrap items-end gap-4">
      <Campo label="Agente" id="filtro-agente">
        <select
          id="filtro-agente"
          value={current.agente ?? ""}
          onChange={(e) => aplicar({ agente: e.target.value })}
          className="h-8 rounded-lg border border-input bg-transparent px-2 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 dark:bg-input/30"
        >
          <option value="">Todos</option>
          {agents.map((a) => (
            <option key={a.slug} value={a.slug}>
              {a.name}
            </option>
          ))}
        </select>
      </Campo>

      <Campo label="Resultado" id="filtro-status">
        <select
          id="filtro-status"
          value={current.status ?? ""}
          onChange={(e) => aplicar({ status: e.target.value })}
          className="h-8 rounded-lg border border-input bg-transparent px-2 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 dark:bg-input/30"
        >
          {statusOpcoes.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
      </Campo>

      <Campo label="Período" id="filtro-periodo">
        <select
          id="filtro-periodo"
          value={current.periodo ?? "7d"}
          onChange={(e) => aplicar({ periodo: e.target.value })}
          className="h-8 rounded-lg border border-input bg-transparent px-2 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 dark:bg-input/30"
        >
          {periodoOpcoes.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
      </Campo>
    </div>
  );
}

function Campo({ label, id, children }: { label: string; id: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1.5">
      <label htmlFor={id} className="label-mono block text-[10px]">
        {label}
      </label>
      {children}
    </div>
  );
}
