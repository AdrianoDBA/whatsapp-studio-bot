/**
 * Os formatos (Zod) do teto de gasto.
 *
 * Toda função do servidor desta pasta valida a entrada aqui ANTES de tocar o
 * banco (regra 5 do CLAUDE.md raiz). As mensagens são em PT-BR coloquial
 * porque elas aparecem embaixo do campo, na tela.
 *
 * ⚠️ OS LIMITES AQUI SÃO OS MESMOS DAS RESTRIÇÕES DO BANCO
 * (`org_ai_limits_monthly_range` e companhia, na migration
 * `20260821040000_teto_de_gasto.sql`), só que em DÓLAR em vez de micro-dólar.
 * Quem manda é o banco: se os dois discordarem, o banco recusa a gravação com
 * uma mensagem em inglês que o aluno não entende — e é justamente isso que
 * estas mensagens existem pra evitar.
 *
 * ⚠️ SEM `.default()` EM LUGAR NENHUM (regra 15 do CLAUDE.md raiz):
 * `.default()` quebra a tipagem do `useForm`. Valor padrão de formulário vai em
 * `defaultValues`.
 *
 * Arquivo PURO: pode ser importado por componente com "use client".
 */
import { z } from "zod";

const orgSlug = z.string().trim().min(1, "Workspace não informado.");
const uuid = z.string().uuid("Esse workspace não existe mais.");

/**
 * Um dia no formato "2026-08-01". É o mesmo formato que `public.ai_today()`
 * devolve, e o que a coluna `org_ai_spend.day` guarda.
 */
const dia = z
  .string()
  .trim()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "Escolha uma data válida.");

/**
 * O teto do MÊS, em dólar. `null` = sem teto.
 *
 * O mínimo de US$ 1 não é capricho: um teto de US$ 0,10 no mês pararia os
 * agentes na primeira conversa, e quem configurou acharia que o app quebrou.
 * Pra apertar de verdade existe o teto do DIA e o teto POR EXECUÇÃO.
 */
const tetoDoMes = z
  .number()
  .min(1, "O teto do mês precisa ser de pelo menos US$ 1,00.")
  .max(100_000, "O teto do mês passou do máximo (US$ 100.000,00).")
  .nullable();

/** O teto do DIA, em dólar. `null` = sem teto do dia. */
const tetoDoDia = z
  .number()
  .min(0.1, "O teto do dia precisa ser de pelo menos US$ 0,10.")
  .max(100_000, "O teto do dia passou do máximo (US$ 100.000,00).")
  .nullable();

/**
 * O teto POR EXECUÇÃO, em dólar. `null` = só os tokens limitam.
 *
 * É o único que age DURANTE a execução: ele para o laço do agente quando o
 * custo dos passos já rodados passa desse valor.
 */
const tetoPorExecucao = z
  .number()
  .min(0.01, "O teto por execução precisa ser de pelo menos US$ 0,01.")
  .max(1_000, "O teto por execução passou do máximo (US$ 1.000,00).")
  .nullable();

export const tetoDoWorkspaceSchema = z.object({
  /**
   * DIFERENÇA EM RELAÇÃO AO CONTRATO: ele escrevia `organizationId`. Aqui é o
   * APELIDO do workspace, porque é ele que o guard (`requireOrgRole`) e o
   * `revalidatePath` precisam — e o identificador sai do próprio guard, que é
   * a única fonte que não dá pra forjar do lado de fora.
   */
  orgSlug,
  monthlyBudgetUsd: tetoDoMes,
  dailyBudgetUsd: tetoDoDia,
  maxRunCostUsd: tetoPorExecucao,
  /** Ligado: passou do teto, para. Desligado: passou, só avisa. */
  hardStop: z.boolean(),
  alertAtPercent: z
    .number()
    .int("O aviso precisa ser um número inteiro de porcento.")
    .min(50, "O aviso precisa ser de pelo menos 50%.")
    .max(99, "O aviso precisa ser de no máximo 99%."),
});
export type TetoDoWorkspaceInput = z.infer<typeof tetoDoWorkspaceSchema>;

/**
 * O teto da PLATAFORMA — só quem cuida do sistema mexe.
 *
 * Aqui é `organizationId` mesmo (e não apelido): a tela de
 * `/plataforma/gastos` lista workspaces dos quais quem está olhando não é
 * membro, então não existe apelido de rota pra usar como guard.
 */
export const tetoDaPlataformaSchema = z.object({
  organizationId: uuid,
  platformCapUsd: z
    .number()
    .min(1, "O teto da plataforma precisa ser de pelo menos US$ 1,00.")
    .max(100_000, "O teto da plataforma passou do máximo (US$ 100.000,00).")
    .nullable(),
});
export type TetoDaPlataformaInput = z.infer<typeof tetoDaPlataformaSchema>;

/**
 * Reconstruir o medidor de um período a partir das tabelas de verdade
 * (`agent_runs` e `documents`). Só quem cuida do sistema.
 */
export const recalcularGastoSchema = z
  .object({
    organizationId: uuid,
    from: dia,
    to: dia,
  })
  .refine((v) => v.from <= v.to, {
    message: "A data de início precisa vir antes da data de fim.",
    path: ["from"],
  });
export type RecalcularGastoInput = z.infer<typeof recalcularGastoSchema>;
