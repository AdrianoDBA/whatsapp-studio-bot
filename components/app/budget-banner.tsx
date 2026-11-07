import { AlertTriangleIcon, OctagonAlertIcon, TrendingUpIcon } from "lucide-react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import type { OrgRole } from "@/lib/agents/types";
import { type BudgetBannerTone, budgetBanner } from "@/lib/limits/messages";
import type { BudgetStatus } from "@/lib/limits/types";

/**
 * A FAIXA DO TETO DE GASTO — ela aparece em TODA página dentro do workspace.
 *
 * Fica no `layout.tsx` de propósito, e não só na tela de Limites: quando os
 * agentes param, a pessoa está no chat ou em Automações, não em Configurações.
 * Uma faixa que só aparece na tela de configuração avisaria exatamente quem já
 * foi procurar o problema.
 *
 * ⚠️ ELA SÓ APARECE QUANDO HÁ O QUE DIZER. `budgetBanner` devolve `null` na
 * imensa maioria das vezes (sem teto, ou longe dele) e aí esta função não
 * desenha nada. Faixa que aparece todo dia vira enfeite, e enfeite ninguém lê
 * no dia em que ele importa.
 *
 * ⚠️ QUEM ESCREVE O TEXTO É `lib/limits/messages.ts`, num lugar só, com teste
 * palavra por palavra. Aqui é só desenho: escolher a cor, o ícone e se cabe o
 * botão. Nenhuma frase nasce neste arquivo.
 *
 * Componente de servidor: ele não tem estado, não tem clique e o dado já chega
 * pronto do layout.
 */

type Props = {
  /** `null` = não deu pra ler o medidor. Aí a faixa não aparece (ver abaixo). */
  status: BudgetStatus | null;
  /** O papel de quem está lendo. É ele que decide "aumente" vs "peça pra quem administra". */
  role: OrgRole;
  orgSlug: string;
};

/** Cor, fundo e ícone de cada tom. Três situações, três desenhos diferentes. */
const ESTILO: Record<BudgetBannerTone, { caixa: string; texto: string }> = {
  // Ainda dá tempo: amarelo, sem drama.
  aviso: { caixa: "border-chart-3/40 bg-chart-3/5", texto: "text-chart-3" },
  // Passou do teto e os agentes CONTINUAM rodando (corte desligado): a conta
  // está subindo agora, o que é mais urgente que o aviso e menos que "parou".
  passou: { caixa: "border-destructive/40 bg-destructive/5", texto: "text-destructive" },
  // Parou. É o vermelho mais forte da tela.
  parado: { caixa: "border-destructive/50 bg-destructive/10", texto: "text-destructive" },
};

const ICONE = {
  aviso: AlertTriangleIcon,
  passou: TrendingUpIcon,
  parado: OctagonAlertIcon,
} as const;

export function BudgetBanner({ status, role, orgSlug }: Props) {
  // Sem leitura do medidor, NÃO inventamos faixa. O motor já escolheu deixar a
  // execução passar nesse caso (está comentado lá); mostrar "os agentes estão
  // parados" quando eles não estão seria pior que ficar calado.
  if (!status) return null;

  const faixa = budgetBanner(status, role);
  if (!faixa) return null;

  const estilo = ESTILO[faixa.tom];
  const Icone = ICONE[faixa.tom];

  return (
    <div
      className={`mb-6 flex flex-wrap items-start gap-3 rounded-lg border px-4 py-3 text-sm ${estilo.caixa}`}
    >
      <Icone className={`mt-0.5 h-4 w-4 shrink-0 ${estilo.texto}`} />

      <div className="min-w-0 flex-1 space-y-0.5">
        <p className={`font-medium ${estilo.texto}`}>{faixa.titulo}</p>
        <p className="text-muted-foreground">{faixa.texto}</p>
      </div>

      {/* O botão só existe pra quem consegue resolver. Pra membro comum ele
          seria um caminho até uma tela que o `requireOrgRole` recusa — e a
          frase dele já manda pedir pra quem administra. */}
      {faixa.podeMudar && (
        <Button
          render={<Link href={`/app/${orgSlug}/settings/limites`} />}
          nativeButton={false}
          size="sm"
          variant="outline"
        >
          Ver os limites
        </Button>
      )}
    </div>
  );
}
