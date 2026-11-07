import { Card, CardContent } from "@/components/ui/card";
import { requirePlatformAdmin } from "@/lib/auth/guards";
import { formatDate } from "@/lib/format";
import { formatTetoUsd } from "@/lib/limits/money";
import { hojeEmSaoPaulo, inicioDoMesISO, rotuloDoMes } from "@/lib/limits/month";
import { getPlatformSpendOverview } from "@/lib/limits/queries";
import { GastosTable } from "./gastos-table";

export const metadata = { title: "Gastos por workspace" };

/**
 * A TELA QUE RESPONDE "QUEM ESTÁ QUEIMANDO A MINHA CHAVE".
 *
 * Quando o dono do sistema cadastra a chave da plataforma
 * (`/plataforma/configuracoes`), ela passa a valer pra TODO workspace que não
 * tenha chave própria. Sem esta tela, ele descobriria o problema pela fatura.
 *
 * ⚠️ O guard aparece de novo mesmo já estando no layout: página é endereço
 * público da internet, e conferir duas vezes é barato. A terceira camada é a
 * própria função do banco, que exige `is_platform_admin()` e recusa qualquer
 * outra pessoa — inclusive quem chamar por fora da tela.
 *
 * ⚠️ ESTE MEDIDOR NÃO É A FATURA. Ele soma o que o template calculou, com os
 * preços de `lib/ai/catalog.ts`, no horário de Brasília. A fatura do provedor
 * fecha noutro fuso e arredonda diferente.
 */
export default async function PlataformaGastosPage() {
  await requirePlatformAdmin();

  const linhas = await getPlatformSpendOverview();

  const total = linhas.reduce((soma, l) => soma + l.monthSpentMicros, 0);
  const semPreco = linhas.reduce((soma, l) => soma + l.unpricedRuns, 0);
  const mes = rotuloDoMes(inicioDoMesISO());

  return (
    <div className="space-y-8">
      <div className="space-y-1.5">
        <span className="label-mono">/ gastos por workspace</span>
        <h1 className="font-semibold text-3xl tracking-tight">Gastos por workspace</h1>
        <p className="text-muted-foreground text-sm">
          Quanto cada workspace gastou com IA em {mes}, e quanto você deixa cada um gastar.
        </p>
      </div>

      <Card>
        <CardContent className="flex flex-wrap items-baseline gap-x-6 gap-y-1 p-5">
          <p className="font-semibold text-2xl tracking-tight">{formatTetoUsd(total)}</p>
          <p className="text-muted-foreground text-sm">
            somados {linhas.length} workspace{linhas.length === 1 ? "" : "s"} em {mes} (até{" "}
            {formatDate(hojeEmSaoPaulo())}).
            {semPreco > 0 &&
              (semPreco === 1
                ? " 1 execução usou um modelo fora da tabela de preços do template e não entra nessa conta."
                : ` ${semPreco} execuções usaram um modelo fora da tabela de preços do template e não entram nessa conta.`)}
          </p>
        </CardContent>
      </Card>

      <GastosTable linhas={linhas} />

      <p className="text-muted-foreground text-sm">
        Este número é o medidor do seu app, não a fatura do provedor: ele soma o que o template
        calculou, execução por execução, no horário de Brasília. A fatura da Anthropic, da OpenAI ou
        do OpenRouter fecha noutro fuso e arredonda de outro jeito. Os dois são parecidos, nunca
        iguais.
      </p>
    </div>
  );
}
