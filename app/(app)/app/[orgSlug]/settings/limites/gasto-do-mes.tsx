import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { textoExecucoesSemPreco } from "@/lib/limits/messages";
import { formatTetoUsd } from "@/lib/limits/money";
import { rotuloDaProximaVirada, rotuloDoMes } from "@/lib/limits/month";
import type { BudgetStatus, MonthSpend } from "@/lib/limits/types";

/**
 * O TOPO DA TELA DE LIMITES: quanto já foi gasto neste mês, e quanto os meses
 * anteriores custaram.
 *
 * ⚠️ O HISTÓRICO É A PARTE MAIS IMPORTANTE DESTE ARQUIVO, por mais que ele
 * pareça enfeite. "US$ 20,00" não significa nada pra quem nunca viu a conta de
 * um provedor de IA — mas "nos últimos 3 meses vocês gastaram US$ 2,13,
 * US$ 1,04 e US$ 3,80" significa na hora. É essa régua que faz o aluno escolher
 * um teto que não seja nem inútil nem uma armadilha.
 *
 * ⚠️ AQUI O DINHEIRO TEM SEMPRE 2 CASAS (`formatTetoUsd`). As 4 casas de
 * `formatUsdFromMicros` ("US$ 0,0042") continuam existindo só na tela de
 * Execuções, execução por execução, que é onde elas fazem sentido. "US$ 16,4000
 * de US$ 20,0000" faria a pessoa parar de enxergar a barra.
 *
 * Componente de servidor: só desenho, o dado já chega pronto da página.
 */

type Props = {
  status: BudgetStatus;
  historico: MonthSpend[];
};

/** Quanto da barra pintar. Passou de 100? A barra enche, e o número conta o resto. */
function larguraDaBarra(percent: number | null): string {
  if (percent === null) return "0%";
  return `${Math.min(Math.max(percent, 0), 100)}%`;
}

export function GastoDoMes({ status, historico }: Props) {
  const temTeto = status.effectiveMonthlyMicros !== null;
  const semPreco = textoExecucoesSemPreco(status.unpricedRuns);

  // A barra fica vermelha quando já passou, amarela a partir do aviso e verde
  // no resto do tempo. É a mesma escada de cores da faixa do topo.
  const corDaBarra = status.overBudget
    ? "bg-destructive"
    : status.percentUsed !== null && status.percentUsed >= status.alertAtPercent
      ? "bg-chart-3"
      : "bg-primary";

  return (
    <Card>
      <CardHeader className="border-border/60 border-b bg-card/40 py-3">
        <CardTitle className="label-mono text-[10px]">/ gasto deste mês</CardTitle>
      </CardHeader>

      <CardContent className="space-y-6 p-6">
        <div className="space-y-2">
          <p className="font-semibold text-2xl tracking-tight">
            {formatTetoUsd(status.monthSpentMicros)}
            <span className="ml-1.5 font-normal text-base text-muted-foreground">
              {temTeto ? `de ${formatTetoUsd(status.effectiveMonthlyMicros)}` : "· sem teto"}
            </span>
          </p>

          {temTeto ? (
            <>
              {/* A barra não é interativa e o número ao lado dela já diz a mesma
                  coisa em texto — por isso ela é decoração pra leitor de tela. */}
              <div aria-hidden="true" className="h-2 w-full overflow-hidden rounded-full bg-muted">
                <div
                  className={`h-full rounded-full transition-all ${corDaBarra}`}
                  style={{ width: larguraDaBarra(status.percentUsed) }}
                />
              </div>
              <p className="text-muted-foreground text-sm">
                {status.percentUsed ?? 0}% do teto deste mês. Ele zera sozinho em{" "}
                {rotuloDaProximaVirada()}.
              </p>
            </>
          ) : (
            <p className="text-muted-foreground text-sm">
              {/* Dizer "não tem teto" quando existe teto do DIA configurado é
                  afirmar o contrário do que acontece: o agente vai parar, e a
                  pessoa não vai entender por quê. */}
              {status.dailyBudgetMicros !== null ? (
                <>
                  Este workspace não tem teto do mês, mas tem um teto de{" "}
                  {formatTetoUsd(status.dailyBudgetMicros)} por dia — e hoje já foram{" "}
                  {formatTetoUsd(status.daySpentMicros)}. Quando o dia estoura, os agentes param até
                  a meia-noite (horário de Brasília).
                </>
              ) : (
                <>
                  Este workspace não tem teto de gasto com IA. Os agentes rodam até a chave de API
                  parar de funcionar — quem escolhe o limite é você, aqui embaixo.
                </>
              )}
            </p>
          )}
        </div>

        <p className="text-muted-foreground text-sm">
          {formatTetoUsd(status.monthAgentMicros)} de agentes ·{" "}
          {formatTetoUsd(status.monthEmbeddingMicros)} de indexar documentos.
        </p>

        {semPreco && (
          <p className="rounded-lg border border-border/60 bg-muted/30 p-3 text-[13px] text-muted-foreground">
            {semPreco}
          </p>
        )}

        <Historico historico={historico} />
      </CardContent>
    </Card>
  );
}

/**
 * A ÂNCORA: os últimos meses do próprio workspace.
 *
 * Mês sem gasto nenhum aparece com zero de propósito (quem monta a lista é
 * `getMonthlySpendHistory`) — uma lista com buraco faria a pessoa achar que
 * faltou dado.
 */
function Historico({ historico }: { historico: MonthSpend[] }) {
  const maior = historico.reduce((maximo, m) => Math.max(maximo, m.spentMicros), 0);

  return (
    <div className="space-y-2">
      <p className="label-mono text-[10px]">/ meses anteriores</p>

      {maior === 0 ? (
        <p className="text-muted-foreground text-sm">
          Este workspace ainda não gastou nada com IA. Assim que os agentes começarem a rodar, os
          meses aparecem aqui — e aí fica fácil escolher um teto que faça sentido.
        </p>
      ) : (
        <ul className="space-y-1.5">
          {historico.map((mes) => (
            <li key={mes.month} className="flex items-center gap-3">
              <span className="w-32 shrink-0 text-muted-foreground text-sm">
                {rotuloDoMes(mes.month)}
              </span>
              <span
                aria-hidden="true"
                className="h-1.5 min-w-[2px] rounded-full bg-primary/40"
                style={{ width: `${Math.round((mes.spentMicros / maior) * 60)}%` }}
              />
              <span className="font-mono text-[11px] text-muted-foreground">
                {formatTetoUsd(mes.spentMicros)}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
