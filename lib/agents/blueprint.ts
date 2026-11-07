/**
 * "Planta" de agente: um agente descrito em CÓDIGO — a FONTE da verdade, não
 * um ponto de partida pra editar depois em outro lugar.
 *
 * Pra que serve um agente em arquivo, e não só uma linha na tabela `agents`?
 * Por três coisas:
 *   • dar um ponto de partida versionado (`_TEMPLATE_agente.ts`);
 *   • deixar o Claude Code criar um agente inteiro num arquivo só, quando o
 *     aluno pede "quero um agente que faz X";
 *   • semear agente em ambiente novo sem ninguém clicar em nada.
 *
 * Depois que a linha existe no banco, quem manda continua sendo O ARQUIVO:
 * mudar prompt, modelo ou ferramentas é editar aqui e materializar de novo —
 * não existe mais tela que edite agente.
 *
 * Arquivo PURO: dá pra testar direto no Vitest.
 */
import { isKnownModelId } from "@/lib/ai/catalog";
import type { TablesInsert } from "@/types/supabase";
import { resolveTools } from "./tools";

const SLUG_RE = /^[a-z0-9]+(-[a-z0-9]+)*$/;

export type AgentBlueprint = {
  /** Apelido na URL: minúsculas, números e hífen. 2 a 60 caracteres. */
  slug: string;
  /** Nome que aparece na tela. 2 a 80 caracteres. */
  name: string;
  /** Uma linha explicando pra que serve. Até 300 caracteres. */
  description: string;
  /** As instruções do agente. O rodapé de segurança é colado pelo motor. */
  systemPrompt: string;
  /** `"provedor:modelo"`, como em `lib/ai/catalog.ts`. */
  model: string;
  /** 0 = sempre a resposta mais provável; 2 = bem criativo. */
  temperature: number;
  /** Quantas vezes o modelo pode falar num pedido só. 1 a 20. */
  maxSteps: number;
  /** Teto de tamanho de UMA resposta. 64 a 32000. */
  maxOutputTokens: number;
  /** Ids do `TOOL_REGISTRY`. */
  tools: readonly string[];
  /**
   * O estado do agente. Opcional — sem declarar, ele nasce publicado (`active`).
   *
   * `"archived"` é como se APOSENTA um agente sem perder o histórico: o motor
   * recusa rodar agente arquivado (`engine.ts`), mas as execuções antigas
   * continuam abrindo em Execuções. É a ÚNICA saída pra aposentar um agente —
   * não existe mais tela que apague agente.
   *
   * `"draft"` existe no banco e você pode declarar, mas hoje ele não esconde
   * nada de ninguém: quem gateia de verdade é `archived`.
   */
  status?: "draft" | "active" | "archived";
};

function exigir(condicao: boolean, mensagem: string): void {
  if (!condicao) throw new Error(`blueprintToInsert: ${mensagem}`);
}

/**
 * Confere a planta e devolve a linha pronta pra `insert` em `agents`.
 *
 * As checagens repetem as restrições do banco de propósito: elas quebram no
 * `npm run verify` com uma mensagem que diz o que consertar, em vez de voltar
 * um `violates check constraint "agents_max_steps_range"` na cara de quem não
 * lê SQL.
 *
 * O agente nasce PUBLICADO (`active`) por padrão — quem quiser outro estado
 * declara `status` na planta (ver `AgentBlueprint.status`).
 *
 * Era `draft` fixo, e a justificativa era "publicar é decisão de quem abre o
 * painel, nunca efeito colateral de um seed". Sem painel, todo agente
 * nasceria invisível pra sempre: o arquivo passou a ser o ato deliberado — e
 * também o único jeito de aposentar um agente, já que não existe tela que
 * apague um.
 *
 * `archived` continua significando o mesmo: é o único valor que o motor de
 * fato checa (`engine.ts` recusa rodar arquivado), e é como se aposenta um
 * agente sem perder o histórico de execuções.
 */
export function blueprintToInsert(
  bp: AgentBlueprint,
  organizationId: string,
  userId: string,
): TablesInsert<"agents"> {
  exigir(
    SLUG_RE.test(bp.slug) && bp.slug.length >= 2 && bp.slug.length <= 60,
    `apelido "${bp.slug}" fora do formato (minúsculas, números e hífen, de 2 a 60 caracteres)`,
  );
  // Medido APARADO: é o valor aparado (`name: bp.name.trim()`, no `return`
  // abaixo) que vai pro banco. Sem isso, um nome de 80 caracteres com espaço
  // em volta era recusado aqui mesmo que o banco fosse aceitar ele depois do
  // trim.
  exigir(
    bp.name.trim().length >= 2 && bp.name.trim().length <= 80,
    `nome "${bp.name}" precisa ter de 2 a 80 caracteres`,
  );
  exigir(bp.description.trim().length <= 300, "a descrição passa de 300 caracteres");
  exigir(bp.systemPrompt.length <= 20_000, "as instruções passam de 20.000 caracteres");
  exigir(
    isKnownModelId(bp.model),
    `o modelo "${bp.model}" não está no catálogo de lib/ai/catalog.ts`,
  );
  exigir(
    bp.temperature >= 0 && bp.temperature <= 2,
    `temperatura ${bp.temperature} fora da faixa 0 a 2`,
  );
  exigir(
    Number.isInteger(bp.maxSteps) && bp.maxSteps >= 1 && bp.maxSteps <= 20,
    `maxSteps ${bp.maxSteps} fora da faixa 1 a 20`,
  );
  exigir(
    Number.isInteger(bp.maxOutputTokens) &&
      bp.maxOutputTokens >= 64 &&
      bp.maxOutputTokens <= 32_000,
    `maxOutputTokens ${bp.maxOutputTokens} fora da faixa 64 a 32000`,
  );
  exigir(bp.tools.length <= 20, "um agente pode ter no máximo 20 ferramentas");

  const { unknownIds } = resolveTools(bp.tools);
  exigir(
    unknownIds.length === 0,
    `a(s) ferramenta(s) ${unknownIds.join(", ")} não existe(m) no TOOL_REGISTRY`,
  );

  return {
    organization_id: organizationId,
    created_by: userId,
    slug: bp.slug,
    name: bp.name.trim(),
    description: bp.description.trim() || null,
    system_prompt: bp.systemPrompt,
    model: bp.model,
    temperature: bp.temperature,
    max_steps: bp.maxSteps,
    max_output_tokens: bp.maxOutputTokens,
    tools: [...bp.tools],
    status: bp.status ?? "active",
  };
}
