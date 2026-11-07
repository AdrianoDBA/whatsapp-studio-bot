"use server";

/**
 * As funções do servidor do teto de gasto.
 *
 * ⚠️ TODA FUNÇÃO AQUI CHAMA O GUARD DENTRO DELA MESMA.
 * Função marcada com "use server" é um endereço público da internet: dá pra
 * chamar sem passar pela tela. "A tela só mostra o botão pra quem pode" não
 * protege nada sozinho.
 *
 * ⚠️ A SEGUNDA CAMADA MORA NO BANCO, e ela é a que vale.
 * `set_org_ai_limits` confere `has_org_role(owner, admin)` e
 * `set_org_platform_cap` confere `is_platform_admin()`. São DUAS funções
 * separadas de propósito: o teto do workspace e o teto da plataforma têm donos
 * diferentes, e uma função só com um `if` deixaria a porta perto demais.
 *
 * ⚠️ O MEDIDOR (`org_ai_spend`) NÃO TEM FUNÇÃO DE ESCRITA AQUI, e isso é
 * decisão. Ninguém logado escreve nele — nem quem administra. Quem soma é
 * `org_ai_spend_add`, dentro da mesma transação que fecha a execução. A única
 * coisa que mexe no acumulado é `recalcularGastoAction`, que RECONSTRÓI o
 * período a partir de `agent_runs` e `documents` e exige dono do sistema.
 */
import { revalidatePath } from "next/cache";
import type { ActionResult } from "@/lib/action-result";
import { assertPlatformAdmin, requireOrgRole } from "@/lib/auth/guards";
import { logError } from "@/lib/logger";
import { createClient } from "@/lib/supabase/server";
import { usdToMicros } from "./money";
import { recalcularGastoSchema, tetoDaPlataformaSchema, tetoDoWorkspaceSchema } from "./schemas";

/** A frase padrão de "confira e tente de novo". */
function primeiroErro(issues: Array<{ message: string }>): string {
  return issues[0]?.message ?? "Confira os dados e tente de novo.";
}

/**
 * Dólar do formulário → micro-dólar inteiro. `null` continua `null` ("sem teto").
 *
 * ⚠️ O `as number` no fim é sobre o TIPO GERADO, não sobre o banco. O
 * `npm run types` marca TODO argumento de função como não-nulo (ele não tem
 * como saber quais aceitam nulo), e estes aceitam — `null` ali é exatamente o
 * que grava "sem teto". Mandar `undefined` no lugar NÃO resolve: esses
 * argumentos não têm valor padrão na função do banco, então a chamada sairia
 * sem eles e o Postgres responderia que a função não existe.
 */
function tetoEmMicros(usd: number | null): number {
  return (usd === null ? null : usdToMicros(usd)) as number;
}

/**
 * Grava o teto DESTE workspace.
 *
 * ⚠️ MUDAR O TETO DO MÊS REARMA O AVISO daquele mês (é o
 * `on conflict do update` da função do banco). Sem isso, quem sobe de US$ 20
 * pra US$ 100 depois de já ter recebido o aviso de 80% nunca mais seria
 * avisado naquele mês.
 */
export async function salvarTetoDoWorkspaceAction(input: unknown): Promise<ActionResult> {
  const parsed = tetoDoWorkspaceSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: primeiroErro(parsed.error.issues) };

  const { org } = await requireOrgRole({
    orgSlug: parsed.data.orgSlug,
    roles: ["owner", "admin"],
  });

  const supabase = await createClient();
  const { error } = await supabase.rpc("set_org_ai_limits", {
    _organization_id: org.id,
    _monthly_budget_micros: tetoEmMicros(parsed.data.monthlyBudgetUsd),
    _daily_budget_micros: tetoEmMicros(parsed.data.dailyBudgetUsd),
    _max_run_cost_micros: tetoEmMicros(parsed.data.maxRunCostUsd),
    _hard_stop: parsed.data.hardStop,
    _alert_at_percent: parsed.data.alertAtPercent,
  });

  if (error) {
    // Nunca devolvemos o texto do Postgres: ele vem em inglês e carrega o nome
    // das colunas do banco (regra 6 do CLAUDE.md raiz).
    logError("limits.salvarTetoDoWorkspace", error);
    return {
      ok: false,
      error:
        "Não deu pra salvar o teto agora. Tente de novo — se continuar, pode ser que você " +
        "não administre mais esse workspace.",
    };
  }

  // A faixa do topo aparece em TODA página dentro do workspace, então quem
  // precisa ser refeito é o layout inteiro, não só a tela de Limites.
  revalidatePath(`/app/${parsed.data.orgSlug}`, "layout");
  return { ok: true };
}

/**
 * Grava o teto que quem cuida do SISTEMA coloca por cima de um workspace.
 *
 * ⚠️ Este teto corta MESMO com o corte automático do workspace desligado. Se
 * não cortasse, bastaria o workspace desligar o corte pra gastar a chave de
 * quem paga a conta.
 */
export async function salvarTetoDaPlataformaAction(input: unknown): Promise<ActionResult> {
  const parsed = tetoDaPlataformaSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: primeiroErro(parsed.error.issues) };

  if (!(await assertPlatformAdmin())) {
    return {
      ok: false,
      error: "Só quem cuida do sistema pode mexer nesse limite.",
    };
  }

  const supabase = await createClient();
  const { error } = await supabase.rpc("set_org_platform_cap", {
    _organization_id: parsed.data.organizationId,
    _platform_cap_micros: tetoEmMicros(parsed.data.platformCapUsd),
  });

  if (error) {
    logError("limits.salvarTetoDaPlataforma", error);
    return {
      ok: false,
      error: "Não deu pra salvar esse limite agora. Atualize a página e tente de novo.",
    };
  }

  revalidatePath("/plataforma/gastos");
  return { ok: true };
}

/**
 * Reconstrói o medidor de um período a partir das tabelas de verdade.
 *
 * Existe porque acumulado pode ficar torto — linha gravada por uma versão
 * antiga do código, um `recompute` depois de conserto de dado na mão. Ela usa
 * o MESMO relógio do acumulador (`finished_at` da execução, `processed_at` do
 * documento, os dois no fuso de São Paulo); com outro relógio, o medidor e a
 * reconciliação discordariam pra sempre.
 *
 * Devolve quantos DIAS foram reescritos.
 */
export async function recalcularGastoAction(
  input: unknown,
): Promise<ActionResult<{ dias: number }>> {
  const parsed = recalcularGastoSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: primeiroErro(parsed.error.issues) };

  if (!(await assertPlatformAdmin())) {
    return { ok: false, error: "Só quem cuida do sistema pode refazer essa conta." };
  }

  const supabase = await createClient();
  const { data, error } = await supabase.rpc("recompute_org_ai_spend", {
    _organization_id: parsed.data.organizationId,
    _from: parsed.data.from,
    _to: parsed.data.to,
  });

  if (error) {
    logError("limits.recalcularGasto", error);
    return {
      ok: false,
      error:
        "Não deu pra refazer essa conta agora. Confira as datas (o período não pode passar " +
        "de 400 dias) e tente de novo.",
    };
  }

  revalidatePath("/plataforma/gastos");
  return { ok: true, data: { dias: typeof data === "number" ? data : 0 } };
}
