/**
 * Os formatos (Zod) da automação.
 *
 * Arquivo PURO: só Zod, nada de banco. Dá pra importar de qualquer lugar.
 *
 * Não tem formato de CRIAR agendamento nem webhook — os dois nascem de
 * arquivo (`lib/automation/blueprint.ts`) e são gravados por
 * `materializarWorkspace`. O que sobra aqui são os formatos de OPERAR o que
 * já existe: ligar/desligar, trocar o modo, assumir, rodar agora e girar o
 * token do webhook.
 *
 * ⚠️ REGRA 15 DO CLAUDE.md: nada de `.default()` nos formatos que alimentam
 * `useForm`. Aqui não tem nenhum, e é pra continuar assim.
 */
import { z } from "zod";

/**
 * O tamanho máximo do apelido do trabalhador.
 *
 * É o mesmo teto do `jobs_locked_by_len` no banco. Ele existe porque o apelido
 * vira parte da comparação de "esse trabalho é meu mesmo?" — e um valor
 * gigante ali seria só desperdício de banco.
 */
export const MAX_WORKER_ID_CHARS = 80;

/**
 * O que a rota `/api/internal/run-job` aceita.
 *
 * ⚠️ REPARE NO QUE NÃO ESTÁ AQUI: organização, agente e identidade. Nada disso
 * viaja pelo pedido — TUDO sai da linha da tabela `jobs`, que foi gravada por
 * uma função `security definer` do banco. Se um dia alguém acrescentar um
 * campo `organizationId` ou `runAs` neste formato, a ameaça T5 do contrato
 * volta a existir: dava pra pedir "rode no nome de outra pessoa".
 *
 * `jobId` vem do CORPO; `workerId` e `ts` vêm dos CABEÇALHOS, porque são eles
 * que entram na assinatura da chamada.
 */
export const runJobRequestSchema = z.object({
  jobId: z.string().uuid("Número de trabalho inválido."),
  workerId: z
    .string()
    .min(1, "Falta dizer qual trabalhador está pedindo.")
    .max(MAX_WORKER_ID_CHARS, "Apelido de trabalhador longo demais."),
  /** O momento em que a chamada foi assinada, em milissegundos. */
  ts: z.number().int("Momento da chamada inválido.").positive("Momento da chamada inválido."),
});

export type RunJobRequest = z.infer<typeof runJobRequestSchema>;

/**
 * O que a rota `/api/internal/semear` aceita.
 *
 * Sem `organizationId`, materializa TODOS os workspaces. `ts` vem do
 * CABEÇALHO (`x-semear-ts`), porque entra na assinatura da chamada — a mesma
 * disciplina de `runJobRequestSchema`.
 */
export const semearRequestSchema = z.object({
  organizationId: z.string().uuid("Workspace inválido.").optional(),
  ts: z.number().int("Momento da chamada inválido.").positive("Momento da chamada inválido."),
});

export type SemearRequest = z.infer<typeof semearRequestSchema>;

// ---------------------------------------------------------------------------
// ▼▼▼ OS FORMATOS DE OPERAR AGENDAMENTO E WEBHOOK ▼▼▼
//
// Não tem formato de CRIAR aqui: os dois nascem de arquivo. Ver o aviso no
// topo do arquivo.
// ---------------------------------------------------------------------------

/** O apelido do workspace na URL. */
const orgSlugSchema = z.string().min(1).max(80);

/** O número de um agente, de um agendamento ou de um webhook. */
const idSchema = z.string().uuid("Escolha um item válido da lista.");

/** Ligar/desligar, assumir, apagar: todos pedem só o workspace e o número. */
export const acaoEmAgendamentoSchema = z.object({
  orgSlug: orgSlugSchema,
  id: idSchema,
});

export type AcaoEmAgendamentoInput = z.infer<typeof acaoEmAgendamentoSchema>;

export const ligarDesligarAgendamentoSchema = z.object({
  orgSlug: orgSlugSchema,
  id: idSchema,
  ativo: z.boolean(),
});

export type LigarDesligarAgendamentoInput = z.infer<typeof ligarDesligarAgendamentoSchema>;

export const rodarAgoraSchema = z.object({
  orgSlug: orgSlugSchema,
  scheduleId: idSchema,
});

export type RodarAgoraInput = z.infer<typeof rodarAgoraSchema>;

/**
 * O token NUNCA vem do navegador: ele é sorteado no servidor
 * (`gerarTokenDeWebhook`) e mostrado uma vez só. Por isso este schema tem só o
 * endereço da linha.
 */
export const girarTokenSchema = z.object({
  orgSlug: orgSlugSchema,
  endpointId: idSchema,
});
export type GirarTokenInput = z.infer<typeof girarTokenSchema>;

/** "Assumir" um webhook: mesmo pedido de girar o token (workspace + número). */
export const acaoEmWebhookSchema = z.object({
  orgSlug: orgSlugSchema,
  id: idSchema,
});

export type AcaoEmWebhookInput = z.infer<typeof acaoEmWebhookSchema>;

/**
 * Ligar/desligar o modo real. Mesmo formato pro agendamento e pro webhook —
 * as duas tabelas têm a coluna `modo`, com o mesmo significado.
 */
const modoDeExecucaoSchema = z.enum(["ensaio", "real"]);

export const alternarModoDoAgendamentoSchema = z.object({
  orgSlug: orgSlugSchema,
  scheduleId: idSchema,
  modo: modoDeExecucaoSchema,
});

export type AlternarModoDoAgendamentoInput = z.infer<typeof alternarModoDoAgendamentoSchema>;

export const alternarModoDoWebhookSchema = z.object({
  orgSlug: orgSlugSchema,
  id: idSchema,
  modo: modoDeExecucaoSchema,
});

export type AlternarModoDoWebhookInput = z.infer<typeof alternarModoDoWebhookSchema>;
