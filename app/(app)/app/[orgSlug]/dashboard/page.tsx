import { ActivityIcon, BookOpenIcon, BotIcon, DollarSignIcon } from "lucide-react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { isPlatformAdmin, requireOrgMember } from "@/lib/auth/guards";
import { temPendencia } from "@/lib/dashboard/passos";
import { getDadosDoInicio } from "@/lib/dashboard/queries";
import { formatTetoUsd } from "@/lib/limits/money";
import { createClient } from "@/lib/supabase/server";
import { getWhatsAppInstance } from "@/lib/whatsapp/queries";
import { DashboardChart } from "./dashboard-chart";
import { GuiaAtivacaoCliente } from "./guia-ativacao";
import { KpiCard } from "./kpi-card";
import { ProximasAutomacoes } from "./proximas-automacoes";
import { ProximosPassos } from "./proximos-passos";
import { UltimasExecucoes } from "./ultimas-execucoes";

type Props = { params: Promise<{ orgSlug: string }> };

export const metadata = { title: "Início" };

/**
 * O INÍCIO — a primeira tela de dentro do workspace.
 *
 * ⚠️ ESTA TELA JÁ FOI UM DEMO, e o problema não era só o gráfico ser inventado.
 * Um aluno que acabava de subir o template caía aqui, via linha subindo, e ia
 * embora achando que estava tudo pronto — sem ninguém ter contado que faltava
 * cadastrar uma chave de IA. Ele descobria muito depois, na primeira conversa,
 * num erro do provedor em inglês. Por isso o primeiro bloco da tela é "o que
 * falta pra isso funcionar", e ele some sozinho quando não falta mais nada.
 *
 * Depois disso a tela responde "o que aconteceu?": os quatro números, o custo
 * dia a dia, as últimas execuções e o que vai rodar sozinho.
 *
 * Tudo aqui é leitura de verdade — `lib/dashboard/queries.ts`. Não existe mais
 * `lib/mock/`.
 */
export default async function DashboardPage({ params }: Props) {
  const { orgSlug } = await params;
  const { user, org, role } = await requireOrgMember({ orgSlug });
  const administra = role === "owner" || role === "admin";

  // Dono do SISTEMA é outro nível: quem é dono aqui vê o degrau do email, que
  // é a única pendência desta tela que não é do workspace, e sim do app
  // inteiro. `isPlatformAdmin` é `cache()`ado, então não custa uma consulta a
  // mais por render.
  const ehDonoDaPlataforma = await isPlatformAdmin(user.id);

  const supabase = await createClient();
  const [{ data: profile }, dados, whatsappInstance, { data: agentAtendimento }] =
    await Promise.all([
      supabase.from("profiles").select("full_name").eq("id", user.id).maybeSingle(),
      getDadosDoInicio({ orgId: org.id, orgSlug, administra, ehDonoDaPlataforma }),
      getWhatsAppInstance(org.id),
      supabase
        .from("agents")
        .select("id, name, slug, config")
        .eq("organization_id", org.id)
        .eq("slug", "atendimento")
        .maybeSingle(),
    ]);
  const displayName = profile?.full_name ?? user.email ?? "";

  const base = `/app/${orgSlug}`;
  const teveGasto = dados.gastoPorDia.some((d) => d.spentMicros > 0);

  return (
    <div className="space-y-8">
      {/* Header */}
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div className="space-y-1.5">
          <div className="label-mono">/ início</div>
          <h1 className="font-semibold text-3xl tracking-tight">Bem-vindo, {displayName}</h1>
          <p className="text-muted-foreground text-sm">
            Workspace <span className="text-foreground/80">{org.name}</span>
          </p>
        </div>
        <div className="flex items-center gap-2 rounded-full border border-border/60 bg-card/60 px-3 py-1.5">
          <span className="relative flex h-1.5 w-1.5">
            <span className="absolute inline-flex h-full w-full rounded-full bg-primary opacity-75 pulse-soft" />
            <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-primary" />
          </span>
          <span className="font-mono text-[10px] text-muted-foreground uppercase tracking-wider">
            últimos 30 dias
          </span>
        </div>
      </div>

      {/* Guia de Ativação do Cliente (Onboarding em 2 passos: WhatsApp + Secretária) */}
      <GuiaAtivacaoCliente
        orgSlug={orgSlug}
        whatsappStatus={whatsappInstance?.status ?? "disconnected"}
        whatsappPhone={whatsappInstance?.phone_number ?? null}
        agentConfig={(agentAtendimento?.config as any) ?? null}
      />

      {/* O que falta configurar — some sozinho quando não falta nada. */}
      {temPendencia(dados.passos) && <ProximosPassos passos={dados.passos} />}

      {/* Os quatro números */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <KpiCard
          label="execuções · 7 dias"
          value={dados.execucoes7d.total.toLocaleString("pt-BR")}
          rodape={
            dados.execucoes7d.falhas > 0
              ? `${dados.execucoes7d.falhas.toLocaleString("pt-BR")} ${dados.execucoes7d.falhas === 1 ? "deu errado" : "deram errado"}`
              : null
          }
          tom={dados.execucoes7d.falhas > 0 ? "alerta" : "normal"}
          icon={ActivityIcon}
          href={`${base}/execucoes`}
        />

        <KpiCard
          label="gasto do mês"
          // 2 casas aqui de propósito: é escala de MÊS. As 4 casas de
          // `formatUsdFromMicros` ficam na lista de execuções e no gráfico,
          // que são escala de execução e de dia.
          value={dados.budget ? formatTetoUsd(dados.budget.monthSpentMicros) : "—"}
          rodape={rodapeDoGasto(dados.budget)}
          tom={dados.budget?.overBudget ? "alerta" : "normal"}
          icon={DollarSignIcon}
          // Membro comum não entra em Limites; sem link, o cartão continua
          // informando e não vira porta fechada.
          href={administra ? `${base}/settings/limites` : null}
        />

        <KpiCard
          label="agentes ligados"
          value={dados.agentesAtivos.toLocaleString("pt-BR")}
          rodape={
            dados.agentesTotal > dados.agentesAtivos
              ? `${dados.agentesTotal.toLocaleString("pt-BR")} no total, com rascunho`
              : null
          }
          icon={BotIcon}
          href={`${base}/agentes`}
        />

        <KpiCard
          label="trechos indexados"
          value={dados.trechosIndexados.toLocaleString("pt-BR")}
          rodape={dados.trechosIndexados > 0 ? "o que o agente pode consultar" : null}
          icon={BookOpenIcon}
          href={`${base}/conhecimento`}
        />
      </div>

      {/* Quanto custou, dia a dia */}
      <Card className="overflow-hidden">
        <CardHeader className="flex flex-row items-center justify-between border-b border-border/60 bg-card/40 py-3">
          <CardTitle className="flex items-center gap-2 font-medium text-sm">
            <span className="label-mono">/ custo por dia</span>
          </CardTitle>
          <div className="font-mono text-[10px] text-muted-foreground">últimos 30 dias</div>
        </CardHeader>
        <CardContent className="p-5">
          {teveGasto ? (
            <DashboardChart data={dados.gastoPorDia} />
          ) : (
            // Um gráfico de trinta zeros é uma linha reta colada no chão: dá
            // trabalho de ler e não diz nada. A frase diz.
            <p className="py-10 text-center text-muted-foreground text-sm">
              Nenhum gasto com IA nos últimos 30 dias. Assim que você conversar com um agente, o
              custo de cada dia aparece aqui.
            </p>
          )}
        </CardContent>
      </Card>

      {/* Últimas execuções */}
      <Card className="overflow-hidden">
        <CardHeader className="flex flex-row items-center justify-between border-b border-border/60 bg-card/40 py-3">
          <CardTitle className="flex items-center gap-2 font-medium text-sm">
            <span className="label-mono">/ últimas execuções</span>
          </CardTitle>
          <Button
            render={<Link href={`${base}/execucoes`} />}
            nativeButton={false}
            variant="ghost"
            size="sm"
            className="text-muted-foreground text-xs"
          >
            Ver todas
          </Button>
        </CardHeader>
        <CardContent className="p-0">
          <UltimasExecucoes runs={dados.ultimasExecucoes} orgSlug={orgSlug} />
        </CardContent>
      </Card>

      {/* O que roda sozinho — só pra quem administra, e só se existir. */}
      {dados.proximasAutomacoes.length > 0 && (
        <Card className="overflow-hidden">
          <CardHeader className="flex flex-row items-center justify-between border-b border-border/60 bg-card/40 py-3">
            <CardTitle className="flex items-center gap-2 font-medium text-sm">
              <span className="label-mono">/ próximas automações</span>
            </CardTitle>
            <Button
              render={<Link href={`${base}/automacoes`} />}
              nativeButton={false}
              variant="ghost"
              size="sm"
              className="text-muted-foreground text-xs"
            >
              Ver todas
            </Button>
          </CardHeader>
          <CardContent className="p-0">
            <ProximasAutomacoes automacoes={dados.proximasAutomacoes} />
          </CardContent>
        </Card>
      )}

      {/* O empurrão pro aluno. Antes ele dizia "troque estes mocks por dados
          reais"; agora que os dados são reais, ele aponta pro arquivo certo. */}
      <div className="rounded-xl border border-border border-dashed bg-card/30 p-5">
        <div className="flex items-start gap-3">
          <span className="grid h-8 w-8 shrink-0 place-items-center rounded-md bg-primary/10 font-mono text-primary text-xs">
            $
          </span>
          <div className="space-y-1.5">
            <p className="font-mono text-[11px] text-muted-foreground uppercase tracking-wider">
              esta tela é sua
            </p>
            <p className="text-sm leading-relaxed">
              Os números acima refletem a atividade real da sua empresa no WhatsApp, detalhando atendimentos
              e métricas do seu assistente de inteligência artificial.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}

/**
 * A linha de baixo do cartão de gasto.
 *
 * Três situações e três frases: sem leitura, sem teto, e com teto. "0% do teto"
 * pra quem não tem teto nenhum seria inventar um denominador.
 */
function rodapeDoGasto(budget: { percentUsed: number | null } | null): string | null {
  if (!budget) return "não deu pra ler agora";
  if (budget.percentUsed === null) return "sem teto definido";
  return `${Math.round(budget.percentUsed)}% do teto`;
}
