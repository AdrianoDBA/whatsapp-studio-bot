"use client";

/**
 * A TABELA DE "QUEM ESTÁ GASTANDO A MINHA CHAVE".
 *
 * ⚠️ ELA NÃO USA O `<DataTable>` de propósito. Aquele componente é pra listas
 * grandes, com busca e páginas; aqui a lista tem o tamanho do número de
 * workspaces do app, já vem ordenada do banco (do que mais gastou pro que menos
 * gastou) e cada linha carrega um FORMULÁRIO. Ordenar de novo no navegador só
 * embaralharia a ordem que importa.
 *
 * ⚠️ A coluna "chave própria" é a mais importante da tela. Um workspace que usa
 * chave própria gasta o dinheiro DELE — o limite da plataforma ali é só um
 * limite. Já um workspace sem chave própria está gastando a chave que o dono do
 * sistema cadastrou, e é esse que precisa de um teto.
 */

import { RefreshCwIcon } from "lucide-react";
import { useTransition } from "react";
import { toast } from "sonner";
import { EmptyState } from "@/components/app/empty-state";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { recalcularGastoAction } from "@/lib/limits/actions";
import { formatTetoUsd } from "@/lib/limits/money";
import type { PlatformSpendRow } from "@/lib/limits/types";
import { TetoDaPlataformaForm } from "./teto-da-plataforma-form";

export function GastosTable({ linhas }: { linhas: PlatformSpendRow[] }) {
  if (linhas.length === 0) {
    return (
      <Card>
        <CardContent className="p-0">
          <EmptyState
            title="Nenhum workspace ainda"
            description="Assim que alguém criar o primeiro workspace, o gasto dele aparece aqui."
          />
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardContent className="p-0">
        {/* A tabela é larga: em tela de celular ela rola sozinha, em vez de
            espremer as colunas até o número ficar ilegível. */}
        <div className="w-full overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Workspace</TableHead>
                <TableHead className="text-right">Gastou no mês</TableHead>
                <TableHead className="text-right">Teto do workspace</TableHead>
                <TableHead className="text-right">%</TableHead>
                <TableHead>Chave própria</TableHead>
                <TableHead>Limite da plataforma</TableHead>
              </TableRow>
            </TableHeader>

            <TableBody>
              {linhas.map((linha) => (
                <TableRow key={linha.organizationId}>
                  <TableCell>
                    <span className="font-medium text-sm">{linha.organizationName}</span>
                    <span className="block font-mono text-[11px] text-muted-foreground">
                      {linha.organizationSlug}
                    </span>
                  </TableCell>

                  <TableCell className="text-right font-mono text-sm">
                    {formatTetoUsd(linha.monthSpentMicros)}
                    {linha.unpricedRuns > 0 && (
                      <span className="block text-[11px] text-muted-foreground">
                        + {linha.unpricedRuns} sem preço
                      </span>
                    )}
                  </TableCell>

                  <TableCell className="text-right font-mono text-sm text-muted-foreground">
                    {formatTetoUsd(linha.monthlyBudgetMicros)}
                  </TableCell>

                  <TableCell className="text-right">
                    <Porcentagem percent={linha.percentUsed} />
                  </TableCell>

                  <TableCell>
                    {linha.usesOwnKey ? (
                      <Badge
                        variant="outline"
                        className="border-primary/40 bg-primary/10 text-primary"
                      >
                        Sim
                      </Badge>
                    ) : (
                      <Badge variant="outline" className="border-border/60 text-muted-foreground">
                        Usa a sua
                      </Badge>
                    )}
                  </TableCell>

                  <TableCell>
                    <div className="flex items-center gap-1">
                      <TetoDaPlataformaForm
                        organizationId={linha.organizationId}
                        organizationName={linha.organizationName}
                        platformCapMicros={linha.platformCapMicros}
                      />
                      <BotaoRecalcular
                        organizationId={linha.organizationId}
                        organizationName={linha.organizationName}
                      />
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      </CardContent>
    </Card>
  );
}

/**
 * O porcento do teto já usado.
 *
 * `null` quer dizer "não existe teto nenhum" — e aí o certo é escrever isso, e
 * não "0%". Zero por cento diria que ainda tem muito espaço, quando na verdade
 * não existe linha de chegada nenhuma.
 */
function Porcentagem({ percent }: { percent: number | null }) {
  if (percent === null) {
    return <span className="text-muted-foreground text-sm">sem teto</span>;
  }

  const cor =
    percent >= 100 ? "text-destructive" : percent >= 80 ? "text-chart-3" : "text-muted-foreground";

  return <span className={`font-mono text-sm ${cor}`}>{percent}%</span>;
}

/**
 * "Refazer a conta" deste workspace.
 *
 * POR QUE ESTE BOTÃO EXISTE
 * O medidor é um acumulado: cada execução soma no fechamento. Se alguma linha
 * não somou (versão antiga do código, conserto de dado na mão), o número fica
 * ATRASADO e o teto para de proteger — sem ninguém perceber, porque um número
 * menor não incomoda ninguém.
 *
 * A função que conserta isso já existia e não tinha botão nenhum: era uma
 * ferramenta de conserto que ninguém conseguia usar.
 *
 * ⚠️ Ela só AUMENTA o medidor, nunca diminui. Isso é de propósito: se
 * diminuísse, apagar as execuções e clicar aqui seria o botão de zerar a conta.
 */
function BotaoRecalcular({
  organizationId,
  organizationName,
}: {
  organizationId: string;
  organizationName: string;
}) {
  const [rodando, start] = useTransition();

  function recalcular() {
    const hoje = new Date();
    const inicioDoMes = new Date(hoje.getFullYear(), hoje.getMonth(), 1);
    const iso = (d: Date) => d.toISOString().slice(0, 10);

    start(async () => {
      const r = await recalcularGastoAction({
        organizationId,
        from: iso(inicioDoMes),
        to: iso(hoje),
      });
      if (!r.ok) {
        toast.error(r.error);
        return;
      }
      toast.success(
        `Conta de ${organizationName} refeita (${r.data?.dias ?? 0} dia(s) conferidos).`,
      );
    });
  }

  return (
    <Button
      type="button"
      size="sm"
      variant="ghost"
      disabled={rodando}
      onClick={recalcular}
      title="Refazer a conta deste mês a partir das execuções (só corrige pra mais)"
    >
      <RefreshCwIcon className="h-3.5 w-3.5" />
    </Button>
  );
}
