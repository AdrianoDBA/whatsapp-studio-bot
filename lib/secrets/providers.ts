/**
 * O catálogo de provedores — TEXTO, não segredo.
 *
 * ESTE É O ÚNICO LUGAR DO PROJETO onde mora o nome bonito de um provedor, a
 * explicação em PT-BR e o link de onde pegar a chave. `lib/ai` importa daqui;
 * não existe (e não pode voltar a existir) um `PROVIDER_LABELS` duplicado lá.
 *
 * Por que aqui e não em `lib/ai`: este catálogo cobre o `resend`, que é envio
 * de email, não IA. `lib/ai` não pode conhecer o Resend.
 *
 * Arquivo PURO: pode ser importado por página, por função do servidor e por
 * teste sem problema nenhum.
 */
import type { CredentialProvider, CredentialProviderInfo } from "./types";

export type { CredentialProviderInfo } from "./types";

export const CREDENTIAL_PROVIDERS: readonly CredentialProviderInfo[] = [
  {
    id: "openrouter",
    label: "OpenRouter",
    description:
      "Uma chave só pra usar os modelos de várias empresas (Google, OpenAI, Anthropic e outras). " +
      "É o caminho mais fácil pra começar: você põe crédito num lugar só.",
    helpUrl: "https://openrouter.ai/settings/keys",
    keyHint: "Começa com sk-or-",
    keyPrefix: "sk-or-",
    hasSenderField: false,
    isAiProvider: true,
  },
  {
    id: "anthropic",
    label: "Anthropic (Claude)",
    description:
      "Chave direto com a Anthropic, a empresa do Claude. Use se você já tem conta lá e " +
      "prefere pagar direto pra ela.",
    helpUrl: "https://console.anthropic.com/settings/keys",
    keyHint: "Começa com sk-ant-",
    keyPrefix: "sk-ant-",
    hasSenderField: false,
    isAiProvider: true,
  },
  {
    id: "openai",
    label: "OpenAI (ChatGPT)",
    description:
      "Chave direto com a OpenAI, a empresa do ChatGPT. Use se você já tem conta lá e " +
      "prefere pagar direto pra ela.",
    helpUrl: "https://platform.openai.com/api-keys",
    keyHint: "Começa com sk-",
    keyPrefix: "sk-",
    hasSenderField: false,
    isAiProvider: true,
  },
  {
    id: "google",
    label: "Google (Gemini)",
    description:
      "Chave direto com o Google, a empresa do Gemini. Pegue no Google AI Studio — " +
      "tem uma faixa gratuita generosa pra testar.",
    helpUrl: "https://aistudio.google.com/apikey",
    keyHint: "Começa com AIza ou AQ.",
    keyPrefix: "AIza",
    hasSenderField: false,
    isAiProvider: true,
  },
  {
    id: "resend",
    label: "Resend (envio de email)",
    description:
      "Serviço que entrega os emails que ESTE app manda: convite e resultado de " +
      "automação. Sem ele, esses emails só aparecem no registro (log) do servidor pra você " +
      "copiar o link na mão. ⚠️ Confirmação de conta e recuperação de senha NÃO passam por " +
      "aqui — quem manda é o Supabase, e trocar aquilo é um passo no painel dele (a tela " +
      "explica depois que você cadastra).",
    helpUrl: "https://resend.com/api-keys",
    keyHint: "Começa com re_",
    keyPrefix: "re_",
    hasSenderField: true,
    isAiProvider: false,
  },
];

/**
 * Descrição de um provedor. Nunca devolve indefinido: o argumento já é um dos
 * cinco valores aceitos pelo banco.
 */
export function getProviderInfo(id: CredentialProvider): CredentialProviderInfo {
  const info = CREDENTIAL_PROVIDERS.find((p) => p.id === id);
  if (!info) {
    // Só chega aqui se alguém acrescentar um valor no enum do banco e esquecer
    // de acrescentar aqui. Falha cedo e com o motivo escrito.
    throw new Error(`Provedor "${id}" não está em CREDENTIAL_PROVIDERS (lib/secrets/providers.ts)`);
  }
  return info;
}

/** Só os provedores de IA — é o que a tela do workspace mostra. */
export function listAiProviders(): readonly CredentialProviderInfo[] {
  return CREDENTIAL_PROVIDERS.filter((p) => p.isAiProvider);
}

/**
 * "Essa chave é mesmo desse provedor?"
 *
 * Devolve `null` quando está tudo certo, ou a frase em PT-BR pra mostrar.
 *
 * ⚠️ ISTO EXISTE POR CAUSA DE UM DEFEITO MEDIDO. A tela sempre disse "Começa
 * com sk-or-", mas nada conferia: colar `chave-errada-123` salvava e mostrava o
 * selo verde "cadastrada". O aluno seguia achando que estava configurado, e o
 * erro só aparecia na primeira conversa, vindo do provedor, em inglês.
 *
 * ⚠️ QUEM DECIDE É O PREFIXO MAIS LONGO QUE CASA, não o do campo. Chave da
 * OpenAI (`sk-`), da Anthropic (`sk-ant-`) e do OpenRouter (`sk-or-`) começam
 * TODAS com `sk-`. Perguntar só "começa com o prefixo deste campo?" erra dos
 * dois lados: deixa uma chave do OpenRouter passar no campo da OpenAI, e no
 * campo da Anthropic recusa sem saber dizer de quem a chave é.
 *
 * Achando o prefixo mais longo, cada chave tem UM dono só — e quando o dono não
 * é o campo, a frase já diz onde colar.
 */
export function conferirPrefixoDaChave(id: CredentialProvider, chave: string): string | null {
  const meu = getProviderInfo(id);
  const limpa = chave.trim();

  // O Google gera tanto chaves com prefixo clássico AIza... quanto com o formato recente AQ....
  if (limpa.startsWith("AQ.")) {
    if (id === "google") return null;
    return `Essa chave parece ser de outro provedor: "Google (Gemini)". Cole ela no campo "Google (Gemini)".`;
  }

  // De quem é essa chave, afinal? O prefixo mais longo que casa ganha.
  const dono = CREDENTIAL_PROVIDERS.filter((p) => limpa.startsWith(p.keyPrefix)).sort(
    (a, b) => b.keyPrefix.length - a.keyPrefix.length,
  )[0];

  // ⚠️ AS DUAS FRASES CITAM O RÓTULO ENTRE ASPAS, como NOME DE CAMPO, e não
  // "a chave da Anthropic". É de propósito: os rótulos têm gêneros diferentes
  // ("a Anthropic", "o OpenRouter", "o Google"), e montar a frase com artigo
  // produzia "não do Anthropic (Claude)" na tela. Citando o campo, a mesma
  // frase serve pros cinco provedores e continua certa se entrar um sexto.
  if (dono && dono.id !== id) {
    return `Essa chave parece ser de outro provedor: "${dono.label}". Cole ela no campo "${dono.label}".`;
  }

  if (!dono) {
    return `A chave do campo "${meu.label}" começa com "${meu.keyPrefix}", e essa não começa. Confira se você copiou a chave inteira, do lugar certo.`;
  }

  return null;
}
