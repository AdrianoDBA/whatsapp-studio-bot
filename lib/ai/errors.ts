/**
 * O erro de CONFIGURAÇÃO da camada de IA.
 *
 * "Configuração" aqui é tudo que está errado ANTES de falar com o provedor:
 * o identificador do modelo veio torto, o modelo não está no catálogo, não
 * existe chave cadastrada. Erro de rede, de cota do provedor ou de resposta
 * ruim NÃO é isso — esses só aparecem quando o motor chama de verdade o
 * `generateText` / `streamText`.
 *
 * POR QUE DUAS MENSAGENS
 * ----------------------
 * `mensagemLeiga` já está em PT-BR coloquial e é seguro devolver na tela.
 * `message` (o herdado do Error) é técnico e só vai pro `logError()`.
 *
 * Assim a regra 6 do CLAUDE.md ("função do servidor nunca devolve mensagem
 * técnica") fica difícil de violar por descuido: quem monta a resposta pra
 * tela tem que digitar `.mensagemLeiga`, e quem digita `.message` está
 * visivelmente pegando o campo técnico.
 */
import type { AiConfigErrorCode, AiProviderName } from "./types";

export type { AiConfigErrorCode } from "./types";

export class AiConfigError extends Error {
  readonly code: AiConfigErrorCode;
  readonly mensagemLeiga: string;
  readonly provider: AiProviderName | null;

  constructor(
    code: AiConfigErrorCode,
    mensagemLeiga: string,
    detalheTecnico: string,
    provider: AiProviderName | null = null,
  ) {
    super(detalheTecnico);
    this.name = "AiConfigError";
    this.code = code;
    this.mensagemLeiga = mensagemLeiga;
    this.provider = provider;
  }
}

export function isAiConfigError(err: unknown): err is AiConfigError {
  return err instanceof AiConfigError;
}

/**
 * true só quando o problema é "não tem chave cadastrada pra esse provedor".
 *
 * O motor usa isso pra diferenciar "o aluno ainda não configurou nada"
 * (mostra o caminho pra tela de Integrações) de "deu ruim de verdade".
 */
export function isMissingCredentialError(err: unknown): boolean {
  return isAiConfigError(err) && err.code === "credencial-ausente";
}
