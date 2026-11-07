/**
 * Como a chave aparece na tela sem aparecer de verdade.
 *
 * Arquivo PURO (não fala com banco, não é "use server").
 *
 * REGRA QUE NÃO SE NEGOCIA: o mascaramento acontece NO SERVIDOR, antes de
 * qualquer coisa sair pra rede. Mascarar no navegador com JavaScript não
 * mascara nada — a chave inteira já teria viajado, e quem abrisse a aba de
 * rede do navegador leria ela inteira.
 *
 * O QUE PODE APARECER
 * -------------------
 * - o "sobrenome" da chave (`sk-ant-`, `sk-or-`, `re_`): não é segredo, é o
 *   mesmo pra todo mundo daquele provedor, e serve pro aluno reconhecer o que
 *   ele colou ali;
 * - os 4 últimos caracteres: é o que os provedores mostram nos painéis deles,
 *   e é o que deixa a pessoa conferir "é essa mesmo".
 *
 * O QUE NUNCA PODE APARECER
 * -------------------------
 * - o MIOLO da chave. É lá que mora a entropia. Por isso o "sobrenome" é
 *   procurado só dentro dos 8 primeiros caracteres: assim uma chave sem
 *   separador nenhum (a do Google, por exemplo) devolve prefixo VAZIO em vez
 *   de vazar os 8 primeiros caracteres do segredo.
 */

export type SecretFingerprint = { prefix: string; last4: string };

/** Só olhamos separador dentro desta janela. Ver o comentário do topo. */
const JANELA_DO_PREFIXO = 8;

/**
 * Pega os dois pedaços não-secretos da chave.
 *
 * prefix = até o último `-` ou `_` que aparecer dentro dos 8 primeiros
 * caracteres (incluindo o separador). Sem separador nessa janela, prefix = "".
 *
 *   "sk-ant-api03-Wq…4f2a"  → { prefix: "sk-ant-", last4: "4f2a" }
 *   "sk-or-v1-9f…c0d1"      → { prefix: "sk-or-",  last4: "c0d1" }
 *   "re_8Hd…7b1e"           → { prefix: "re_",     last4: "7b1e" }
 *   "AIzaSyD9…9Qk2"         → { prefix: "",        last4: "9Qk2" }
 */
export function fingerprintSecret(secret: string): SecretFingerprint {
  const limpo = secret.trim();
  if (limpo === "") return { prefix: "", last4: "" };

  const janela = limpo.slice(0, JANELA_DO_PREFIXO);
  const corte = Math.max(janela.lastIndexOf("-"), janela.lastIndexOf("_"));
  const prefix = corte >= 0 ? limpo.slice(0, corte + 1) : "";

  return { prefix, last4: limpo.slice(-4) };
}

/**
 * Monta o texto que a tela mostra: "sk-ant-…4f2a".
 *
 * Recebe o fingerprint (não a chave) de propósito: assim é impossível chamar
 * essa função com o segredo inteiro na mão sem perceber.
 */
export function maskCredential(fp: SecretFingerprint): string {
  return `${fp.prefix}…${fp.last4}`;
}
