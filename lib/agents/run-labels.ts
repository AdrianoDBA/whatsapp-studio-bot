/**
 * COMO UMA EXECUÇÃO SE CHAMA NA TELA — os rótulos e as cores.
 *
 * ESTE É O ÚNICO LUGAR onde `"succeeded"` vira "Deu certo" e ganha borda
 * verde. Dois lugares mostram execução (a tabela de Execuções e a lista curta
 * do Início), e um mapa de rótulos copiado é do tipo de duplicação que só
 * aparece quando alguém troca uma palavra num lugar e não no outro — mesma
 * disciplina do catálogo de provedores em `lib/secrets/providers.ts`.
 *
 * Arquivo PURO: pode ser importado por componente com "use client", por
 * componente de servidor e por teste. NÃO fala com o banco (os TIPOS vêm de
 * `./types`, que também é puro).
 */
import type { AgentRunStatus, AgentTriggerKind } from "./types";

/** O que aconteceu com a execução, em português. */
export const RUN_STATUS_LABEL: Record<AgentRunStatus, string> = {
  queued: "Na fila",
  running: "Rodando",
  succeeded: "Deu certo",
  failed: "Deu errado",
  cancelled: "Cancelada",
};

/** As classes do selo. Só cor e borda — o texto vem do mapa de cima. */
export const RUN_STATUS_STYLE: Record<AgentRunStatus, string> = {
  queued: "border-border text-muted-foreground",
  running: "border-chart-3/40 bg-chart-3/10 text-chart-3",
  succeeded: "border-primary/40 bg-primary/10 text-primary",
  failed: "border-destructive/40 bg-destructive/10 text-destructive",
  cancelled: "border-border/60 text-muted-foreground",
};

/** Quem mandou a execução rodar. */
export const RUN_TRIGGER_LABEL: Record<AgentTriggerKind, string> = {
  manual: "Alguém clicou",
  chat: "Pelo chat",
  schedule: "Agendado",
  webhook: "Chamada externa",
};
