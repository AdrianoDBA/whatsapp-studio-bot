"use client";

import { MessageSquareIcon, PlusIcon, Trash2Icon, UsersIcon } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useTransition } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { formatDateTime } from "@/lib/format";
import { deleteThreadAction, startThreadAction } from "@/lib/threads/actions";
import type { ThreadListItem } from "@/lib/threads/types";

/**
 * A lista de conversas com um agente, em dois blocos: as suas e as do time.
 *
 * ⚠️ O AVISO DE PRIVACIDADE NÃO É ENFEITE. A conversa é DO WORKSPACE: todo
 * membro lê. Isso é decisão de projeto, não descuido — `agent_runs` e
 * `agent_run_steps` já guardam a pergunta, a resposta e o que a ferramenta
 * devolveu, e qualquer membro consegue abrir aquilo em Execuções desde sempre.
 * Trancar a conversa deixando o rastro aberto prometeria uma privacidade que o
 * banco não entrega. A tela avisa, com essas palavras.
 */
export function ConversasList({
  orgSlug,
  agentSlug,
  agentName,
  podeConversar,
  minhas,
  doWorkspace,
}: {
  orgSlug: string;
  agentSlug: string;
  agentName: string;
  /** `false` quando o agente está aposentado. */
  podeConversar: boolean;
  minhas: ThreadListItem[];
  doWorkspace: ThreadListItem[];
}) {
  const router = useRouter();
  const [criando, startCriar] = useTransition();
  const [apagando, startApagar] = useTransition();

  const dosOutros = doWorkspace.filter((c) => !c.isMine);

  function novaConversa() {
    startCriar(async () => {
      const r = await startThreadAction({ orgSlug, agentSlug });
      if (!r.ok) {
        toast.error(r.error);
        return;
      }
      if (r.data) router.push(`/app/${orgSlug}/agentes/${agentSlug}/conversar/${r.data.threadId}`);
    });
  }

  function apagar(threadId: string) {
    const confirmado = confirm(
      "Apagar essa conversa? Os balões somem pra todo mundo do workspace. O histórico de " +
        "execuções (com a pergunta, a resposta e quanto custou) continua em Execuções.",
    );
    if (!confirmado) return;

    startApagar(async () => {
      const r = await deleteThreadAction({ orgSlug, threadId });
      if (!r.ok) {
        toast.error(r.error);
        return;
      }
      toast.success("Conversa apagada.");
      router.refresh();
    });
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-muted-foreground text-sm">
          {minhas.length === 0
            ? `Você ainda não conversou com ${agentName}.`
            : `${minhas.length} ${minhas.length === 1 ? "conversa sua" : "conversas suas"} com ${agentName}.`}
        </p>
        <Button onClick={novaConversa} disabled={!podeConversar || criando} className="gap-1.5">
          <PlusIcon className="h-3.5 w-3.5" />
          {criando ? "Abrindo…" : "Nova conversa"}
        </Button>
      </div>

      <Card className="overflow-hidden">
        <CardHeader className="border-b border-border/60 bg-card/40 py-3">
          <CardTitle className="label-mono text-[10px]">/ suas conversas</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          {minhas.length === 0 ? (
            <p className="p-6 text-muted-foreground text-sm">
              Nenhuma ainda. Clique em "Nova conversa" e mande a primeira mensagem.
            </p>
          ) : (
            <ul className="divide-y divide-border/60">
              {minhas.map((c) => (
                <li key={c.id} className="flex items-center gap-3 px-4 py-3">
                  <MessageSquareIcon className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                  <Link
                    href={`/app/${orgSlug}/agentes/${agentSlug}/conversar/${c.id}`}
                    className="min-w-0 flex-1"
                  >
                    <span className="block truncate font-medium text-sm">
                      {c.title ?? "Conversa sem título"}
                    </span>
                    <span className="block text-muted-foreground text-xs">
                      {c.messageCount} {c.messageCount === 1 ? "mensagem" : "mensagens"} ·{" "}
                      {formatDateTime(c.lastMessageAt ?? c.createdAt)}
                    </span>
                  </Link>
                  <Button
                    variant="ghost"
                    size="icon"
                    aria-label="Apagar conversa"
                    disabled={apagando}
                    onClick={() => apagar(c.id)}
                  >
                    <Trash2Icon className="h-3.5 w-3.5" />
                  </Button>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      <Card className="overflow-hidden">
        <CardHeader className="border-b border-border/60 bg-card/40 py-3">
          <CardTitle className="label-mono text-[10px]">/ conversas do time</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4 p-0">
          <p className="flex items-start gap-2 border-border/60 border-b bg-card/20 px-4 py-3 text-muted-foreground text-xs">
            <UsersIcon className="mt-0.5 h-3.5 w-3.5 shrink-0" />
            <span>
              Conversa com agente é <strong>do workspace</strong>: qualquer pessoa do time consegue
              ler. Escrever, só quem começou. Quem administra também pode apagar. (O histórico de
              Execuções já era assim desde sempre — aqui a gente só está sendo honesto sobre isso.)
            </span>
          </p>

          {dosOutros.length === 0 ? (
            <p className="px-4 pb-4 text-muted-foreground text-sm">
              Ninguém mais do time conversou com esse agente ainda.
            </p>
          ) : (
            <ul className="divide-y divide-border/60">
              {dosOutros.map((c) => (
                <li key={c.id} className="px-4 py-3">
                  <Link
                    href={`/app/${orgSlug}/agentes/${agentSlug}/conversar/${c.id}`}
                    className="block min-w-0"
                  >
                    <span className="block truncate font-medium text-sm">
                      {c.title ?? "Conversa sem título"}
                    </span>
                    <span className="block text-muted-foreground text-xs">
                      {c.authorName ?? "alguém do time"} · {c.messageCount}{" "}
                      {c.messageCount === 1 ? "mensagem" : "mensagens"} ·{" "}
                      {formatDateTime(c.lastMessageAt ?? c.createdAt)}
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
