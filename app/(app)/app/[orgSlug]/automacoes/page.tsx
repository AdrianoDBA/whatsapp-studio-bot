import Link from "next/link";
import { EmptyState } from "@/components/app/empty-state";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { listAgents } from "@/lib/agents/queries";
import { getAppUrl } from "@/lib/app-url";
import { requireOrgRole } from "@/lib/auth/guards";
import { trabalhadorEstaVivo } from "@/lib/automation/heartbeat";
import {
  listarAgendamentos,
  listarTrabalhosRecentes,
  listarWebhooks,
} from "@/lib/automation/queries";
import type { JobStatus } from "@/lib/automation/types";
import { databaseUrl, isDevelopment } from "@/lib/env";
import { formatDateTime } from "@/lib/format";
import { ehRecusaDeTeto } from "@/lib/limits/messages";
import { createClient } from "@/lib/supabase/server";
import { AgendamentosPanel } from "./agendamentos-panel";
import { WebhooksPanel } from "./webhooks-panel";

type Props = { params: Promise<{ orgSlug: string }> };

export const metadata = { title: "Automações" };

/**
 * A tela das automações: agendamento ("toda segunda às 9h") e webhook ("um
 * sistema de fora chamou").
 *
 * ⚠️ SÓ DONO E ADMINISTRADOR ENTRAM. Não é frescura: quem arma uma automação
 * está dizendo "esse agente roda sozinho, no meu nome, sem ninguém olhando" —
 * e a tela mostra o endereço secreto dos webhooks. Membro comum é levado de
 * volta pro painel pelo `requireOrgRole`.
 *
 * ⚠️ A LISTA DE DISPAROS VEM DA TABELA `jobs`, que só dá `select`. Entrar e
 * sair da fila é só por função do banco — não existe caminho de escrita nem
 * daqui, nem de uma função do servidor.
 */
export default async function AutomacoesPage({ params }: Props) {
  const { orgSlug } = await params;
  const { user, org } = await requireOrgRole({ orgSlug, roles: ["owner", "admin"] });

  const supabase = await createClient();
  const baseUrl = await getAppUrl();

  const [agentes, agendamentos, webhooks, trabalhos] = await Promise.all([
    listAgents(org.id),
    listarAgendamentos(supabase, org.id),
    listarWebhooks(supabase, org.id, baseUrl),
    listarTrabalhosRecentes(supabase, org.id),
  ]);

  const temEnderecoDeBanco = databaseUrl() !== undefined;
  const trabalhadorVivo = trabalhadorEstaVivo();

  return (
    <div className="space-y-8">
      <div className="space-y-1.5">
        <span className="label-mono">/ automações</span>
        <h1 className="font-semibold text-3xl tracking-tight">Automações</h1>
        <p className="text-muted-foreground text-sm">
          Faça um agente rodar sozinho: numa hora marcada, ou quando um sistema de fora chamar um
          endereço secreto.
        </p>
      </div>

      <AvisoDoTrabalhador
        temEnderecoDeBanco={temEnderecoDeBanco}
        trabalhadorVivo={trabalhadorVivo}
      />

      {agentes.length === 0 && (
        <Card className="border-dashed">
          <CardContent className="flex flex-wrap items-center justify-between gap-3 p-5">
            <p className="text-sm">
              Você ainda não tem nenhum agente — e é ele que a automação vai rodar. Peça pro Claude
              Code criar um.
            </p>
            <Button
              render={<Link href={`/app/${orgSlug}/agentes`} />}
              nativeButton={false}
              size="sm"
              variant="outline"
            >
              Ver agentes
            </Button>
          </CardContent>
        </Card>
      )}

      <AgendamentosPanel orgSlug={orgSlug} agendamentos={agendamentos} meuUserId={user.id} />

      <WebhooksPanel orgSlug={orgSlug} webhooks={webhooks} meuUserId={user.id} />

      <UltimosDisparos orgSlug={orgSlug} trabalhos={trabalhos} />
    </div>
  );
}

/**
 * O aviso mais importante da tela.
 *
 * Uma automação que está "Ligada" mas nunca roda é o pior resultado possível —
 * o aluno acha que o app está quebrado e não tem como descobrir por quê. As
 * duas causas reais têm texto próprio:
 *
 *  • sem `DATABASE_URL`, o trabalhador nem sobe (o site continua funcionando
 *    normal, e é por isso que o app não derruba o container por causa disso);
 *  • com `DATABASE_URL` mas sem batimento, ou o trabalhador caiu, ou você está
 *    rodando `npm run dev` — que não sobe o segundo processo.
 */
function AvisoDoTrabalhador({
  temEnderecoDeBanco,
  trabalhadorVivo,
}: {
  temEnderecoDeBanco: boolean;
  trabalhadorVivo: boolean;
}) {
  if (temEnderecoDeBanco && trabalhadorVivo) return null;

  if (!temEnderecoDeBanco) {
    return (
      <Card className="border-destructive/40 bg-destructive/5">
        <CardContent className="space-y-1.5 p-5">
          <p className="font-medium text-sm">As automações não vão rodar neste app.</p>
          <p className="text-muted-foreground text-sm">
            Falta a variável <code className="font-mono">DATABASE_URL</code>. Ela é o endereço de
            conexão direta com o banco, e é por ele que a fila funciona. Pegue em supabase.com → seu
            projeto → Settings → Database → Connection string (URI), cole no painel do EasyPanel e
            clique em Deploy.
          </p>
          <p className="text-muted-foreground text-sm">
            Você ainda consegue criar as automações aqui — elas só ficam esperando.
          </p>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="border-chart-3/40 bg-chart-3/5">
      <CardContent className="space-y-1.5 p-5">
        <p className="font-medium text-sm">Ninguém está tirando trabalho da fila agora.</p>
        <p className="text-muted-foreground text-sm">
          {isDevelopment()
            ? "Na sua máquina o npm run dev sobe só o site. Pra as automações rodarem, abra outro terminal e rode: npm run worker (com o mesmo .env.local)."
            : "O processo que roda as automações não está batendo ponto. Ele sobe junto com o app dentro do container — olhe o registro (log) do app pra ver o que aconteceu."}
        </p>
        <p className="text-muted-foreground text-sm">
          As automações continuam sendo gravadas e entram na fila normalmente; elas só rodam quando
          esse processo voltar.
        </p>
      </CardContent>
    </Card>
  );
}

const rotuloDaSituacao: Record<JobStatus, string> = {
  pending: "Esperando",
  running: "Rodando",
  done: "Deu certo",
  failed: "Deu errado",
  cancelled: "Cancelada",
};

const estiloDaSituacao: Record<JobStatus, string> = {
  pending: "border-border text-muted-foreground",
  running: "border-chart-3/40 bg-chart-3/10 text-chart-3",
  done: "border-primary/40 bg-primary/10 text-primary",
  failed: "border-destructive/40 bg-destructive/10 text-destructive",
  cancelled: "border-border/60 text-muted-foreground",
};

const rotuloDaFonte = {
  schedule: "Hora marcada",
  webhook: "Chamada de fora",
  manual: "Alguém clicou",
} as const;

/**
 * Os últimos disparos, pra pessoa ver que a automação está mesmo acontecendo.
 *
 * O detalhe do que o agente fez (o rastro passo a passo, quanto custou) mora
 * em Execuções — aqui é só "entrou na fila, virou isso".
 */
function UltimosDisparos({
  orgSlug,
  trabalhos,
}: {
  orgSlug: string;
  trabalhos: Awaited<ReturnType<typeof listarTrabalhosRecentes>>;
}) {
  return (
    <Card>
      <CardHeader className="border-border/60 border-b bg-card/40 py-3">
        <CardTitle className="label-mono text-[10px]">/ últimos disparos</CardTitle>
      </CardHeader>
      <CardContent className="p-0">
        {trabalhos.length === 0 ? (
          <EmptyState
            title="Nada disparou ainda"
            description="Assim que uma automação rodar, ela aparece aqui."
          />
        ) : (
          <ul className="divide-y divide-border/60">
            {trabalhos.map((t) => {
              // ⚠️ "Pulada pelo teto" NÃO é "deu errado". A automação continua
              // ligada, o relógio dela andou e ela volta sozinha na virada do
              // mês — mostrar o mesmo vermelho de falha faria a pessoa procurar
              // defeito onde só existe uma decisão de gasto.
              const puladaPorTeto = ehRecusaDeTeto(t.lastError);

              return (
                <li key={t.id} className="flex flex-wrap items-start justify-between gap-3 p-4">
                  <div className="min-w-0 flex-1 space-y-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <Badge
                        variant="outline"
                        className={
                          puladaPorTeto
                            ? "border-chart-3/40 bg-chart-3/10 text-chart-3"
                            : estiloDaSituacao[t.status]
                        }
                      >
                        {puladaPorTeto ? "Rodada pulada" : rotuloDaSituacao[t.status]}
                      </Badge>
                      <span className="text-sm">{rotuloDaFonte[t.sourceKind]}</span>
                    </div>
                    <p className="font-mono text-[11px] text-muted-foreground">
                      {formatDateTime(t.createdAt)}
                      {t.finishedAt && ` → ${formatDateTime(t.finishedAt)}`}
                    </p>
                    {t.lastError && (
                      <p
                        className={
                          puladaPorTeto
                            ? "rounded-lg border border-chart-3/40 bg-chart-3/10 p-2 text-[11px] text-chart-3"
                            : "rounded-lg border border-destructive/40 bg-destructive/10 p-2 text-[11px] text-destructive"
                        }
                      >
                        {t.lastError}
                      </p>
                    )}
                  </div>

                  {t.runId && (
                    <Button
                      render={<Link href={`/app/${orgSlug}/execucoes/${t.runId}`} />}
                      nativeButton={false}
                      size="sm"
                      variant="ghost"
                    >
                      Ver o rastro
                    </Button>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}
