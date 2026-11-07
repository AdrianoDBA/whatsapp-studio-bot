"use client";

/**
 * OS AGENDAMENTOS: a lista e ligar/desligar/trocar o modo/assumir/rodar agora.
 *
 * Não tem formulário de criar aqui — um agendamento nasce de arquivo
 * (`lib/automation/blueprint.ts`) e é gravado por `materializarWorkspace`.
 * Peça pro Claude Code declarar um na lista `AGENDAMENTOS` de
 * `lib/seed/registro.ts`; um workspace novo já nasce com ele, e um workspace
 * que já existe (o caso do aluno olhando esta tela) recebe no próximo
 * deploy — o comando `npm run semear` continua existindo pra quem quiser
 * forçar agora, sem esperar.
 *
 * ⚠️ `ChaveDeModo` é exportado DAQUI e importado por `webhooks-panel.tsx` — um
 * componente só, porque as duas tabelas têm a coluna `modo` com o mesmo
 * significado. Se mudar o texto, muda pros dois (ver
 * `app/(app)/app/[orgSlug]/CLAUDE.md`).
 */

import { AlertTriangleIcon, PlayIcon } from "lucide-react";
import { useRouter } from "next/navigation";
import { useTransition } from "react";
import { toast } from "sonner";
import { EmptyState } from "@/components/app/empty-state";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import type { ModoDeExecucao } from "@/lib/agents/acoes";
import {
  alternarModoDoAgendamentoAction,
  assumirAgendamentoAction,
  ligarDesligarAgendamentoAction,
  rodarAgoraAction,
} from "@/lib/automation/actions";
import type { Entrega } from "@/lib/automation/entrega";
import type { ScheduleSummary } from "@/lib/automation/types";
import { formatDateTimeInZone } from "@/lib/format";
import { ehRecusaDeTeto } from "@/lib/limits/messages";

// ---------------------------------------------------------------------------
// A chave do modo — compartilhada entre agendamento e webhook: as duas
// tabelas têm a coluna `modo`, com o mesmo significado e o mesmo texto.
// ---------------------------------------------------------------------------

/**
 * Em ensaio: o que o ensaio GARANTE + o botão de ligar o real (só quando a
 * automação roda no nome de quem está olhando — senão o banco recusa).
 * Em real: o aviso de que ela age de verdade + o caminho de volta.
 *
 * ⚠️ O TEXTO DO ENSAIO NÃO PROMETE PASSO NENHUM NO RASTRO.
 * Ele prometia ("confira o rastro da última execução"), e no caso mais comum
 * — agente SEM a ferramenta de mandar email, com entrega por email — não
 * existe passo nenhum pra conferir: a entrega roda depois que a execução já
 * fechou, e `record_agent_run_step` recusa gravar em execução fechada (o
 * porquê está em `lib/automation/entrega.ts`). O aluno lia "confira o
 * rastro", não achava nada, e ligava o modo real sem nunca ter visto o
 * ensaio. Agora a frase diz o que o ensaio GARANTE (nada sai pra fora) e
 * manda ler a RESPOSTA, que sempre existe.
 *
 * ⚠️ VOLTAR PRO ENSAIO É A DIREÇÃO SEGURA, e por isso não tem aviso pesado
 * nem confirmação. O caminho só de ida existia por descuido da tela: o
 * servidor sempre aceitou os dois sentidos, e como a entrega também não se
 * edita, quem clicava por engano tinha que apagar e recriar a automação.
 */
export function ChaveDeModo({
  qual,
  modo,
  podeLigar,
  ligando,
  onLigar,
  onVoltarProEnsaio,
}: {
  /** Muda só uma frase: webhook não tem entrega de resultado. */
  qual: "agendamento" | "webhook";
  modo: ModoDeExecucao;
  /** A automação roda no MEU nome? Só assim dá pra trocar (a policy exige). */
  podeLigar: boolean;
  ligando: boolean;
  onLigar: () => void;
  onVoltarProEnsaio: () => void;
}) {
  const ela = qual === "agendamento" ? "Essa automação" : "Esse endereço";

  if (modo === "real") {
    return (
      <div className="space-y-2">
        <p className="text-muted-foreground text-sm">
          {ela} <strong className="text-foreground/80">age de verdade</strong>. Ela roda no seu nome
          — os emails saem com o seu remetente.
        </p>
        {podeLigar ? (
          <Button size="sm" variant="ghost" disabled={ligando} onClick={onVoltarProEnsaio}>
            Voltar pro ensaio
          </Button>
        ) : (
          <p className="text-[11px] text-muted-foreground">
            Clique em “Assumir” pra poder voltar pro ensaio.
          </p>
        )}
      </div>
    );
  }

  return (
    <div className="rounded-lg border border-primary/25 bg-primary/[0.04] p-4">
      <p className="font-medium text-sm">Modo de ensaio — ligado</p>
      <p className="mt-1 text-muted-foreground text-sm leading-relaxed">
        {ela} roda de verdade e gasta IA normalmente, mas <strong>nada sai daqui pra fora</strong>
        {qual === "agendamento"
          ? " — nem email que o agente mandaria sozinho, nem a entrega do resultado."
          : " — nenhum email é mandado e nenhum sistema de fora é chamado."}{" "}
        Abra a última execução e leia a resposta do agente: é ela que sai de verdade quando você
        ligar o modo real.
      </p>
      {qual === "agendamento" && (
        <p className="mt-2 text-[11px] text-muted-foreground leading-relaxed">
          A entrega do resultado não deixa rastro nem em ensaio nem no modo real — ela é passo da
          automação, não do agente. Em ensaio ela simplesmente não sai.
        </p>
      )}
      {podeLigar ? (
        <Button size="sm" variant="outline" className="mt-3" disabled={ligando} onClick={onLigar}>
          Ligar o modo real
        </Button>
      ) : (
        <p className="mt-3 text-[11px] text-muted-foreground">
          Clique em “Assumir” pra poder ligar o modo real.
        </p>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// O painel inteiro
// ---------------------------------------------------------------------------

export function AgendamentosPanel({
  orgSlug,
  agendamentos,
  meuUserId,
}: {
  orgSlug: string;
  agendamentos: ScheduleSummary[];
  /** Pra saber se o agendamento roda no MEU nome (só aí dá pra ligar/desligar). */
  meuUserId: string;
}) {
  return (
    <Card>
      <CardHeader className="border-border/60 border-b bg-card/40 py-3">
        <CardTitle className="label-mono text-[10px]">/ agendamentos</CardTitle>
      </CardHeader>
      <CardContent className="p-0">
        {agendamentos.length === 0 ? (
          <EmptyState
            title="Nenhuma automação por horário"
            description="Nenhuma automação por horário configurada para este workspace no momento."
          />
        ) : (
          <ul className="divide-y divide-border/60">
            {agendamentos.map((a) => (
              <li key={a.id}>
                <LinhaDoAgendamento orgSlug={orgSlug} agendamento={a} meuUserId={meuUserId} />
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Uma linha da lista
// ---------------------------------------------------------------------------

/**
 * PRA ONDE VAI O RESULTADO, em uma linha.
 *
 * Isto aparece na lista porque a entrega é gravada quando o agendamento nasce
 * (de arquivo) e não tem tela de editar depois. Sem mostrar aqui, quem
 * precisasse conferir pra onde a automação manda o resultado não teria como.
 *
 * ⚠️ `conexao` existe no formato que o banco sabe LER, mas nenhum caminho de
 * escrita o conhece (ver `lib/automation/entrega.ts`). Esta linha é a rede
 * pra uma linha antiga: ela não pode quebrar a lista nem virar promessa de um
 * botão que não existe — então sai como o que de fato é.
 */
function paraOndeVaiOResultado(entrega: Entrega): string {
  if (entrega.tipo === "email") {
    return `resultado por email para: ${entrega.para.join(", ")}`;
  }
  if (entrega.tipo === "nenhuma") {
    return "resultado: fica só no histórico de Execuções";
  }
  return "resultado: uma entrega que esta tela ainda não sabe mostrar";
}

function LinhaDoAgendamento({
  orgSlug,
  agendamento,
  meuUserId,
}: {
  orgSlug: string;
  agendamento: ScheduleSummary;
  meuUserId: string;
}) {
  const router = useRouter();
  const [ocupado, executar] = useTransition();

  const meu = agendamento.runAsUserId === meuUserId;

  /**
   * A ÚLTIMA RODADA FOI PULADA PELO TETO DE GASTO — não é falha.
   *
   * A diferença importa: quando o teto corta, o banco pula a rodada, ADIANTA o
   * relógio e deixa a automação LIGADA (ela volta sozinha na virada do mês).
   * Pintar isso de vermelho como "deu errado" mandaria a pessoa procurar
   * defeito onde só existe uma decisão de gasto que ela mesma tomou.
   */
  const puladaPorTeto = ehRecusaDeTeto(agendamento.lastError);

  function chamar(acao: () => Promise<{ ok: boolean; error?: string }>, sucesso: string) {
    executar(async () => {
      const resultado = await acao();
      if (!resultado.ok) {
        toast.error(resultado.error ?? "Não deu certo. Tente de novo.");
        return;
      }
      toast.success(sucesso);
      router.refresh();
    });
  }

  return (
    <div className="flex flex-wrap items-start justify-between gap-4 p-4">
      <div className="min-w-0 flex-1 space-y-1.5">
        <div className="flex flex-wrap items-center gap-2">
          <span className="font-medium text-sm">{agendamento.name}</span>
          {agendamento.isActive ? (
            <Badge variant="outline" className="border-primary/40 bg-primary/10 text-primary">
              Ligada
            </Badge>
          ) : (
            <Badge variant="outline" className="border-border/60 text-muted-foreground">
              Desligada
            </Badge>
          )}
          {puladaPorTeto && (
            <Badge variant="outline" className="border-chart-3/40 bg-chart-3/10 text-chart-3">
              Rodada pulada
            </Badge>
          )}
        </div>

        <p className="text-muted-foreground text-sm">
          {agendamento.agentName} · {agendamento.descricao}
        </p>

        <p className="font-mono text-[11px] text-muted-foreground">
          {/* No fuso DA AUTOMAÇÃO, não no de Brasília: quem marcou "9h em
              Lisboa" precisa ler 9h aqui, senão vai achar que está errado. */}
          {agendamento.isActive && agendamento.nextRunAt
            ? `próxima: ${formatDateTimeInZone(agendamento.nextRunAt, agendamento.timezone)}`
            : "próxima: — (desligada)"}
          {agendamento.lastRunAt &&
            ` · última: ${formatDateTimeInZone(agendamento.lastRunAt, agendamento.timezone)}`}
        </p>

        <p className="text-[11px] text-muted-foreground">
          {/* Quem a automação REPRESENTA. É a permissão dessa pessoa que vale
              quando o agente roda sozinho — por isso o nome fica visível. */}
          roda no nome de: {agendamento.runAsName ?? "ninguém"}
          {meu && " (você)"}
        </p>

        <p className="text-[11px] text-muted-foreground">
          {paraOndeVaiOResultado(agendamento.entrega)}
        </p>

        {agendamento.orfa && (
          <p className="flex items-start gap-1.5 rounded-lg border border-chart-3/40 bg-chart-3/10 p-2 text-[11px] text-chart-3">
            <AlertTriangleIcon className="mt-px h-3 w-3 shrink-0" />
            <span>
              Quem armou essa automação não está mais no workspace. Clique em “Assumir” pra ela
              passar a rodar no seu nome.
            </span>
          </p>
        )}

        {agendamento.lastError && (
          <p
            className={
              puladaPorTeto
                ? "rounded-lg border border-chart-3/40 bg-chart-3/10 p-2 text-[11px] text-chart-3"
                : "rounded-lg border border-destructive/40 bg-destructive/10 p-2 text-[11px] text-destructive"
            }
          >
            {agendamento.lastError}
          </p>
        )}

        <ChaveDeModo
          qual="agendamento"
          modo={agendamento.modo}
          podeLigar={meu}
          ligando={ocupado}
          onLigar={() =>
            chamar(
              () =>
                alternarModoDoAgendamentoAction({
                  orgSlug,
                  scheduleId: agendamento.id,
                  modo: "real",
                }),
              "Modo real ligado. A partir de agora essa automação age de verdade.",
            )
          }
          onVoltarProEnsaio={() =>
            chamar(
              () =>
                alternarModoDoAgendamentoAction({
                  orgSlug,
                  scheduleId: agendamento.id,
                  modo: "ensaio",
                }),
              "Voltou pro ensaio. Ela continua rodando, mas nada sai mais pra fora.",
            )
          }
        />
      </div>

      <div className="flex flex-wrap items-center gap-1.5">
        <Button
          size="sm"
          variant="outline"
          disabled={ocupado}
          onClick={() =>
            chamar(
              () => rodarAgoraAction({ orgSlug, scheduleId: agendamento.id }),
              "Entrou na fila. A execução aparece em Execuções assim que terminar.",
            )
          }
        >
          <PlayIcon className="h-3 w-3" />
          Rodar agora
        </Button>

        {meu ? (
          <Button
            size="sm"
            variant="outline"
            disabled={ocupado}
            onClick={() =>
              chamar(
                () =>
                  ligarDesligarAgendamentoAction({
                    orgSlug,
                    id: agendamento.id,
                    ativo: !agendamento.isActive,
                  }),
                agendamento.isActive ? "Automação desligada." : "Automação ligada.",
              )
            }
          >
            {agendamento.isActive ? "Desligar" : "Ligar"}
          </Button>
        ) : (
          <Button
            size="sm"
            variant="outline"
            disabled={ocupado}
            onClick={() =>
              chamar(
                () => assumirAgendamentoAction({ orgSlug, id: agendamento.id }),
                "Agora essa automação roda no seu nome. Ligue ela quando quiser.",
              )
            }
          >
            Assumir
          </Button>
        )}
      </div>
    </div>
  );
}
