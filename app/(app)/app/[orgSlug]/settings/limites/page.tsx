import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { requireOrgRole } from "@/lib/auth/guards";
import {
  TEXTO_FREIOS_DO_SISTEMA,
  TEXTO_MEDIDOR_NAO_E_FATURA,
  TEXTO_POR_QUE_EM_DOLAR,
} from "@/lib/limits/messages";
import { formatTetoUsd } from "@/lib/limits/money";
import { getBudgetStatus, getMonthlySpendHistory } from "@/lib/limits/queries";
import { createClient } from "@/lib/supabase/server";
import { GastoDoMes } from "./gasto-do-mes";
import { LimitesForm } from "./limites-form";

type Props = { params: Promise<{ orgSlug: string }> };

export const metadata = { title: "Limites de IA" };

/**
 * A TELA DO TETO DE GASTO: quanto este workspace já gastou com IA neste mês e
 * quanto ele pode gastar.
 *
 * ⚠️ SÓ DONO E ADMINISTRADOR ENTRAM. É uma decisão de dinheiro, e quem mexe no
 * teto mexe no que o time inteiro consegue fazer. Membro comum vê a FAIXA no
 * topo das telas (que diz o número e manda pedir pra quem administra), mas não
 * esta página — o `requireOrgRole` leva ele de volta pro painel.
 *
 * ⚠️ A ORDEM DA TELA É DELIBERADA e vem do contrato da onda 6:
 * primeiro **quanto já foi** (com o histórico do próprio workspace, que é a
 * régua do leigo), só depois **quanto pode**. Começar pelo formulário seria
 * pedir um número pra quem ainda não tem escala nenhuma.
 */
export default async function LimitesPage({ params }: Props) {
  const { orgSlug } = await params;
  const { org } = await requireOrgRole({ orgSlug, roles: ["owner", "admin"] });

  const supabase = await createClient();
  const [status, historico] = await Promise.all([
    getBudgetStatus({ organizationId: org.id, supabase }),
    getMonthlySpendHistory({ organizationId: org.id, supabase }),
  ]);

  return (
    <div className="max-w-3xl space-y-8">
      <div className="space-y-1.5">
        <span className="label-mono">/ limites de ia</span>
        <h1 className="font-semibold text-3xl tracking-tight">Limites de IA</h1>
        <p className="text-muted-foreground text-sm">
          Quanto este workspace pode gastar com inteligência artificial — por mês, por dia e por
          execução.
        </p>
      </div>

      {status === null ? (
        <Card className="border-destructive/40 bg-destructive/5">
          <CardContent className="space-y-1.5 p-5">
            <p className="font-medium text-sm">Não deu pra ler o medidor agora.</p>
            <p className="text-muted-foreground text-sm">
              Atualize a página. Os agentes continuam rodando normalmente — o gasto é somado pelo
              banco de dados toda vez que uma execução termina, e isso não depende desta tela.
            </p>
          </CardContent>
        </Card>
      ) : (
        <>
          <GastoDoMes status={status} historico={historico} />

          <LimitesForm orgSlug={orgSlug} status={status} />

          {/* Item 8 do contrato: o teto da PLATAFORMA aparece aqui só pra
              leitura, e só quando existe. Ele é de quem cuida do sistema — um
              campo editável aqui prometeria um botão que o banco recusa. */}
          {status.platformCapMicros !== null && (
            <Card className="border-chart-3/40 bg-chart-3/5">
              <CardHeader className="border-border/60 border-b bg-transparent py-3">
                <CardTitle className="label-mono text-[10px]">/ limite da plataforma</CardTitle>
              </CardHeader>
              <CardContent className="space-y-1.5 p-6">
                <p className="font-medium text-sm">
                  Quem cuida do sistema definiu um limite de{" "}
                  {formatTetoUsd(status.platformCapMicros)} por mês pra este workspace.
                </p>
                <p className="text-muted-foreground text-sm">
                  Ele vale por cima do teto daqui e não muda nesta tela — nem com o corte automático
                  desligado. Se precisar de mais, fale com quem administra o sistema.
                </p>
              </CardContent>
            </Card>
          )}
        </>
      )}

      {/* Os textos fixos. Eles moram em `lib/limits/messages.ts` porque a
          mesma palavra precisa aparecer igual em todo lugar — e porque texto
          sem teste é texto que alguém reescreve numa sexta-feira. */}
      <Card>
        <CardHeader className="border-border/60 border-b bg-card/40 py-3">
          <CardTitle className="label-mono text-[10px]">/ o que mais você precisa saber</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4 p-6 text-muted-foreground text-sm">
          <p>{TEXTO_POR_QUE_EM_DOLAR}</p>
          <p>{TEXTO_FREIOS_DO_SISTEMA}</p>
          <p>{TEXTO_MEDIDOR_NAO_E_FATURA}</p>
        </CardContent>
      </Card>
    </div>
  );
}
