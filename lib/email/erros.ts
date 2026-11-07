/**
 * O ERRO DO SERVIÇO DE EMAIL, TRADUZIDO PRO ALUNO.
 *
 * ⚠️ REGRA 6 DO PROJETO, no lugar mais fundo da cadeia. O que o Resend
 * devolve vem em INGLÊS e falando de conceito dele ("The recipient domain is
 * not allowed to receive emails from this account."). Essa frase não pode
 * chegar em tela nenhuma — e a cadeia toda passa por aqui:
 *
 *   `ResendAdapter.send`  →  `Acoes.email`  →  o rastro do agente, o chat,
 *                                              o playground e `jobs.last_error`
 *
 * Por isso a tradução mora no ADAPTADOR e não em quem chama: são quatro telas
 * consumindo o mesmo texto, e traduzir em uma só deixaria as outras três
 * mostrando inglês.
 *
 * ⚠️ O TEXTO TÉCNICO NUNCA SE PERDE. `erroDeEmailParaOAluno` escreve ele no
 * registro (log) do servidor com `logError()` ANTES de devolver a frase leiga.
 * Sem isso a gente trocaria um problema por outro: ninguém mais conseguiria
 * diagnosticar por que o email não saiu.
 *
 * Arquivo PURO de propósito (só depende de `lib/logger`): dá pra testar cada
 * família sem subir banco nem rede.
 */
import { logError } from "@/lib/logger";

/** As famílias de falha que o aluno encontra de verdade. */
export type FamiliaDeErroDeEmail = "destinatario" | "chave" | "limite" | "desconhecido";

/**
 * As pistas de cada família, em minúsculas.
 *
 * A ordem importa: a primeira família que casa vence. "chave" vem antes de
 * "destinatario" porque uma chave restrita a um domínio devolve as DUAS
 * palavras, e o conserto é mexer na chave.
 */
const PISTAS: Array<{ familia: Exclude<FamiliaDeErroDeEmail, "desconhecido">; termos: string[] }> =
  [
    {
      familia: "chave",
      termos: [
        "missing_api_key",
        "invalid_api_key",
        "restricted_api_key",
        "api key is invalid",
        "api key is missing",
        "missing api key",
        "invalid api key",
        "unauthorized",
        "forbidden",
        "authentication",
      ],
    },
    {
      familia: "limite",
      termos: [
        "rate_limit_exceeded",
        "rate limit",
        "too many requests",
        "daily_quota_exceeded",
        "quota",
        "429",
      ],
    },
    {
      familia: "destinatario",
      termos: [
        "recipient domain",
        "not allowed to receive",
        "invalid_to_address",
        "invalid_from_address",
        "invalid `to`",
        "invalid `from`",
        "domain is not verified",
        "is not verified",
        "testing emails to your own",
        "validation_error",
      ],
    },
  ];

/** As frases que o aluno lê. Uma por família, em PT-BR coloquial. */
const FRASES: Record<FamiliaDeErroDeEmail, string> = {
  destinatario:
    "O serviço de email recusou esse destinatário. Isso acontece quando o domínio do remetente " +
    "ainda não foi verificado no Resend — enquanto ele não estiver, só dá pra mandar pro seu " +
    "próprio email. Confira o cartão do Resend em Plataforma → Configurações.",
  chave:
    "A chave do Resend não foi aceita, ou ela não tem permissão pra mandar email. Cadastre uma " +
    "chave válida no cartão do Resend, em Plataforma → Configurações.",
  limite:
    "O serviço de email recusou porque a conta bateu no limite de envios do plano. Espere um " +
    "pouco e tente de novo, ou aumente o plano no Resend.",
  desconhecido:
    "Não deu pra mandar o email agora: o serviço de email recusou o envio. O motivo técnico " +
    "ficou guardado no registro (log) do servidor.",
};

/** Qual família é essa falha. Exportada porque o teste checa uma por caso. */
export function familiaDoErroDeEmail(tecnico: string): FamiliaDeErroDeEmail {
  const texto = tecnico.toLowerCase();
  for (const pista of PISTAS) {
    if (pista.termos.some((termo) => texto.includes(termo))) return pista.familia;
  }
  return "desconhecido";
}

/**
 * A frase leiga de uma falha de email. PURA — não loga nada.
 *
 * Use `erroDeEmailParaOAluno` no código de verdade: é ela que garante o
 * registro do motivo técnico.
 */
export function traduzirErroDeEmail(tecnico: string): string {
  return FRASES[familiaDoErroDeEmail(tecnico)];
}

/**
 * Loga o motivo técnico e devolve a frase leiga. É esta que o adaptador chama.
 *
 * ⚠️ O retorno NUNCA contém o texto do provedor — nem "colado no final", nem
 * entre parênteses. `jobs.last_error` vai cru pra tela de Automações.
 */
export function erroDeEmailParaOAluno(escopo: string, tecnico: unknown): string {
  const { codigo, mensagem } = lerFalha(tecnico);
  // `logError` só sabe ler `{ code, message }` — string crua sairia como
  // "unknown: " e o motivo técnico se perderia justamente no lugar que existe
  // pra guardar ele.
  logError(escopo, { code: codigo, message: mensagem });
  // O código do provedor (`validation_error`, `rate_limit_exceeded`) costuma
  // ser MAIS confiável que a frase pra dizer qual é a família — por isso os
  // dois entram na conta.
  return traduzirErroDeEmail(`${codigo} ${mensagem}`);
}

/** Aceita string, `Error` e o `{ name, message }` que o Resend devolve. */
function lerFalha(tecnico: unknown): { codigo: string; mensagem: string } {
  if (typeof tecnico === "string") return { codigo: "email", mensagem: tecnico };
  if (tecnico instanceof Error) return { codigo: tecnico.name, mensagem: tecnico.message };
  if (typeof tecnico === "object" && tecnico !== null) {
    const obj = tecnico as { name?: unknown; code?: unknown; message?: unknown };
    const codigo = obj.code ?? obj.name;
    return {
      codigo: typeof codigo === "string" ? codigo : "email",
      mensagem: typeof obj.message === "string" ? obj.message : "",
    };
  }
  return { codigo: "email", mensagem: "" };
}
