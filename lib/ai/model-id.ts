/**
 * O identificador de modelo: `"provedor:modelo"`.
 *
 * É esse texto que fica gravado em `agents.model`, que aparece no seletor da
 * tela e que `resolveModel` recebe. Ex.:
 *
 *   openrouter:anthropic/claude-sonnet-5
 *   anthropic:claude-sonnet-5
 *   google:gemini-3.7-flash
 *
 * ⚠️ CORTE NO PRIMEIRO ':' — SEMPRE. NUNCA `split(":")`.
 * O apelido de modelo do OpenRouter pode ter ':' dentro:
 * `z-ai/glm-5.2:free` e `anthropic/claude-opus-5:batch` existem de verdade
 * (conferido na API do OpenRouter em 20/08/2026). Com `split(":")` o pedaço
 * depois do segundo ':' sumiria e o modelo viraria outro, calado.
 *
 * Arquivo PURO: não fala com banco, não lê chave, dá pra testar direto.
 */
import { z } from "zod";
import { AiConfigError } from "./errors";
import { AI_PROVIDERS, type AiProviderName, type ModelId, type ParsedModelId } from "./types";

export type { ParsedModelId } from "./types";

const SEPARADOR = ":";

function ehProvedorConhecido(valor: string): valor is AiProviderName {
  return (AI_PROVIDERS as readonly string[]).includes(valor);
}

/**
 * Quebra `"provedor:modelo"` nas duas partes.
 *
 * Lança `AiConfigError` quando o texto não tem ':', quando algum dos dois
 * lados está vazio, ou quando o provedor não é um dos quatro que o template
 * conhece. Quem não quiser exceção usa `tryParseModelId`.
 */
export function parseModelId(raw: string): ParsedModelId {
  const texto = typeof raw === "string" ? raw.trim() : "";

  const corte = texto.indexOf(SEPARADOR);
  if (corte <= 0 || corte === texto.length - 1) {
    throw new AiConfigError(
      "id-invalido",
      "Esse modelo está escrito num formato que o app não entende. " +
        "Escolha um modelo da lista em vez de digitar o nome na mão.",
      `identificador de modelo inválido: ${JSON.stringify(raw).slice(0, 120)}`,
    );
  }

  const provider = texto.slice(0, corte);
  const providerModelId = texto.slice(corte + 1);

  if (!ehProvedorConhecido(provider)) {
    throw new AiConfigError(
      "provedor-desconhecido",
      `O app não sabe conversar com o provedor "${provider}". ` +
        "Escolha um modelo da lista: ela só mostra provedores que o app conhece.",
      `provedor fora de AI_PROVIDERS: ${provider.slice(0, 60)}`,
    );
  }

  return { provider, providerModelId, id: `${provider}${SEPARADOR}${providerModelId}` };
}

/** Igual acima, mas devolve null em vez de lançar. */
export function tryParseModelId(raw: string): ParsedModelId | null {
  try {
    return parseModelId(raw);
  } catch {
    return null;
  }
}

/** Monta o identificador a partir das duas partes. O oposto do `parse`. */
export function formatModelId(provider: AiProviderName, providerModelId: string): ModelId {
  return `${provider}${SEPARADOR}${providerModelId}`;
}

/**
 * O Zod do campo de modelo (usado pelas funções do servidor e pelo editor).
 *
 * SEM `.default()` — regra 15 do CLAUDE.md: `.default()` quebra a tipagem do
 * `useForm`. O valor padrão de um formulário vai em `defaultValues`, e o do
 * banco vai no `DEFAULT_MODEL_ID` do catálogo.
 *
 * A checagem aqui é de FORMATO. Saber se o modelo existe no catálogo é
 * trabalho do `isKnownModelId()`, porque o catálogo muda com release e um
 * schema não deve carregar essa lista.
 */
const PROVEDORES_NA_REGEX = AI_PROVIDERS.join("|");
const FORMATO_DO_ID = new RegExp(`^(?:${PROVEDORES_NA_REGEX}):[^\\s]+$`);

export const modelIdSchema: z.ZodString = z
  .string()
  .trim()
  .min(3, "Escolha um modelo.")
  .max(200, "Esse nome de modelo é longo demais.")
  .regex(FORMATO_DO_ID, "Escolha um modelo da lista.");
