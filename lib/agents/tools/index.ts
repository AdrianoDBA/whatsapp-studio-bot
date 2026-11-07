/**
 * O REGISTRO DE FERRAMENTAS — a lista de tudo que um agente deste app pode
 * fazer além de conversar.
 *
 * A LISTA É ESCRITA À MÃO, DE PROPÓSITO. Nada de varrer a pasta com `glob` ou
 * `import()` dinâmico: o empacotamento standalone do Next não rastreia import
 * dinâmico, então a ferramenta funcionaria no `npm run dev` e sumiria em
 * produção — o pior tipo de bug pra diagnosticar.
 *
 * ➕ CRIOU UMA FERRAMENTA? Duas linhas:
 *    1. `import { minhaFerramenta } from "./minha-ferramenta";`
 *    2. acrescente ela no array `TOOL_REGISTRY`.
 *
 * Arquivo PURO: o catálogo é código, não tabela. A página do painel importa
 * daqui direto pra montar a lista de ferramentas do agente.
 */
import type { RegisteredTool } from "../define-tool";
import type { OrgRole } from "../types";
import { buscarNaBase } from "./buscar-na-base";
import { calcularOrcamento } from "./calcular-orcamento";
import { consultarDisponibilidade } from "./consultar-disponibilidade";
import { mandarEmail } from "./mandar-email";
import { reservarHorario } from "./reservar-horario";
import { solicitarHumano } from "./solicitar-humano";

/**
 * Todas as ferramentas que existem neste app.
 */
export const TOOL_REGISTRY: readonly RegisteredTool[] = [
  buscarNaBase,
  consultarDisponibilidade,
  reservarHorario,
  calcularOrcamento,
  solicitarHumano,
  mandarEmail,
];

/** A ficha de uma ferramenta, do jeito que a tela precisa mostrar. */
export type ToolCatalogEntry = {
  id: string;
  label: string;
  description: string;
  /** `null` = qualquer membro do workspace pode usar. */
  requiresRole: readonly OrgRole[] | null;
};

const POR_ID = new Map<string, RegisteredTool>(TOOL_REGISTRY.map((f) => [f.id, f]));

// Duas ferramentas com o mesmo nome fariam uma sumir sem aviso. Melhor não
// deixar o app subir.
if (POR_ID.size !== TOOL_REGISTRY.length) {
  throw new Error("TOOL_REGISTRY: existe mais de uma ferramenta com o mesmo id");
}

export function getTool(id: string): RegisteredTool | undefined {
  return POR_ID.get(id);
}

/**
 * A lista pra tela marcar/desmarcar ferramenta no agente.
 *
 * SÍNCRONA de propósito: o registro é código, não consulta ao banco. A página
 * (que é Server Component) chama direto, sem `await`.
 */
export function getToolCatalog(): ToolCatalogEntry[] {
  return TOOL_REGISTRY.map((f) => ({
    id: f.id,
    label: f.label,
    description: f.description,
    requiresRole: f.requiresRole,
  }));
}

/**
 * Converte a lista de ids gravada em `agents.tools` nas ferramentas de
 * verdade, separando as que não existem mais.
 *
 * Id desconhecido NÃO é erro: ele acontece toda vez que uma ferramenta é
 * removida do código e um agente antigo ainda tem ela marcada. Quem decide o
 * que fazer com isso é quem chamou — o motor vira aviso na tela, a função de
 * salvar do painel vira mensagem de recusa.
 */
export function resolveTools(ids: readonly string[]): {
  found: RegisteredTool[];
  unknownIds: string[];
} {
  const found: RegisteredTool[] = [];
  const unknownIds: string[] = [];
  const jaVistos = new Set<string>();

  for (const id of ids) {
    if (jaVistos.has(id)) continue;
    jaVistos.add(id);

    const ferramenta = POR_ID.get(id);
    if (ferramenta) found.push(ferramenta);
    else unknownIds.push(id);
  }

  return { found, unknownIds };
}
