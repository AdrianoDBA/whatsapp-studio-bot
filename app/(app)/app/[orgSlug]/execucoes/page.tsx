import { Card, CardContent } from "@/components/ui/card";
import { listAgents } from "@/lib/agents/queries";
import {
  listRuns,
  RUNS_LIMIT_PADRAO,
  type RunFilters,
  type RunStatus,
} from "@/lib/agents/runs-queries";
import { requireOrgMember } from "@/lib/auth/guards";
import { RunsFilters } from "./runs-filters";
import { RunsTable } from "./runs-table";

/**
 * O histórico de execuções do workspace.
 *
 * OS NOMES DOS FILTROS NA URL ESTÃO EM PORTUGUÊS (`?agente=`, `?status=`,
 * `?periodo=`) porque a URL é visível pro aluno e ele copia e cola link. Já os
 * VALORES de status ficam em inglês: eles são exatamente os valores gravados
 * no banco, e traduzir ali criaria uma tabela de conversão pra manter.
 */
type Props = {
  params: Promise<{ orgSlug: string }>;
  searchParams: Promise<{ agente?: string; status?: string; periodo?: string }>;
};

export const metadata = { title: "Execuções" };

const STATUS_VALIDOS: RunStatus[] = ["queued", "running", "succeeded", "failed", "cancelled"];
const PERIODOS_VALIDOS = ["24h", "7d", "30d", "tudo"] as const;

export default async function ExecucoesPage({ params, searchParams }: Props) {
  const { orgSlug } = await params;
  const { agente, status, periodo } = await searchParams;
  const { org } = await requireOrgMember({ orgSlug });

  // O que vem da URL é digitado por qualquer um: nada entra na consulta sem
  // ser conferido contra a lista de valores aceitos.
  const statusFiltro = STATUS_VALIDOS.find((s) => s === status);
  const periodoFiltro = PERIODOS_VALIDOS.find((p) => p === periodo) ?? "7d";

  const filtros: RunFilters = {
    agentSlug: agente || undefined,
    status: statusFiltro,
    period: periodoFiltro,
  };

  const [runs, agents] = await Promise.all([listRuns(org.id, filtros), listAgents(org.id)]);

  return (
    <div className="space-y-8">
      <div className="space-y-1.5">
        <span className="label-mono">/ execuções</span>
        <h1 className="font-semibold text-3xl tracking-tight">Execuções</h1>
        <p className="text-muted-foreground text-sm">
          Tudo o que os agentes deste workspace já fizeram — com quanto custou e o passo a passo de
          cada uma.
        </p>
      </div>

      <RunsFilters
        orgSlug={orgSlug}
        agents={agents.map((a) => ({ slug: a.slug, name: a.name }))}
        current={{ agente, status: statusFiltro, periodo: periodoFiltro }}
      />

      {runs.length >= RUNS_LIMIT_PADRAO && (
        <Card className="border-dashed">
          <CardContent className="p-4 text-sm">
            Estamos mostrando as {RUNS_LIMIT_PADRAO} execuções mais recentes desse filtro. Tem mais
            coisa antes disso — use o filtro de período ou de agente pra chegar nela.
          </CardContent>
        </Card>
      )}

      <RunsTable orgSlug={orgSlug} runs={runs} />
    </div>
  );
}
