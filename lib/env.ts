/**
 * Leitura central das variáveis de ambiente.
 *
 * POR QUE ESSE ARQUIVO EXISTE
 * ---------------------------
 * Antes o app lia `process.env.NEXT_PUBLIC_*` direto. Variável com esse
 * prefixo é COLADA dentro do código no momento de construir a imagem — ou
 * seja, trocar a chave no painel do EasyPanel não tinha efeito nenhum, só
 * reconstruindo tudo de novo. Como nenhuma dessas variáveis precisa chegar no
 * navegador (o app inteiro fala com o Supabase pelo servidor), tiramos o
 * prefixo. Agora é só editar no painel e reiniciar.
 *
 * Os nomes antigos continuam funcionando como segunda opção, então quem já
 * tinha um deploy no ar não quebra ao atualizar.
 *
 * REGRA: leia env SEMPRE por aqui. Nada de `process.env` espalhado no código.
 */

import { derivarSegredoInterno } from "@/scripts/lib/segredo-interno.mjs";

/** Primeiro valor preenchido entre vários nomes possíveis. */
function read(...names: string[]): string | undefined {
  for (const name of names) {
    const value = process.env[name];
    if (value && value.trim() !== "") return value.trim();
  }
  return undefined;
}

function required(value: string | undefined, nome: string, ondePegar: string): string {
  if (!value) {
    throw new Error(
      `Faltou a variável ${nome}. ${ondePegar} ` +
        `Depois de preencher, reinicie o app (no EasyPanel: botão Deploy).`,
    );
  }
  return value;
}

/** Endereço do seu projeto Supabase (ex: https://abcdefgh.supabase.co). */
export function supabaseUrl(): string {
  return required(
    read("SUPABASE_URL", "NEXT_PUBLIC_SUPABASE_URL"),
    "SUPABASE_URL",
    "Pegue em supabase.com → seu projeto → Settings → API → Project URL.",
  );
}

/** Chave pública (anon) do Supabase. Pode aparecer no navegador sem problema. */
export function supabaseAnonKey(): string {
  return required(
    read("SUPABASE_ANON_KEY", "NEXT_PUBLIC_SUPABASE_ANON_KEY"),
    "SUPABASE_ANON_KEY",
    "Pegue em supabase.com → seu projeto → Settings → API → anon public.",
  );
}

/**
 * Endereço de conexão direta com o banco. Usado SÓ pelo script que aplica as
 * tabelas quando o app sobe (scripts/migrate.mjs) — o app em si nunca usa.
 */
export function databaseUrl(): string | undefined {
  return read("DATABASE_URL", "SUPABASE_DB_URL");
}

/**
 * Endereço público do app (ex: https://meusaas.com.br).
 *
 * Normalmente você NÃO precisa preencher: o app descobre sozinho pelo endereço
 * que o visitante usou (ver lib/app-url.ts). Preencha só se os links dos
 * emails saírem errados.
 */
export function appUrlFromEnv(): string | undefined {
  const raw = read("APP_URL", "NEXT_PUBLIC_APP_URL");
  return raw ? raw.replace(/\/+$/, "") : undefined;
}

// -----------------------------------------------------------------------------
// A chave mestra do cofre (ENCRYPTION_KEY)
// -----------------------------------------------------------------------------
// É com ela que o app tranca as chaves de API que você cadastra pelas telas
// (OpenRouter, Anthropic, OpenAI, Google, Resend). Ela mora FORA do banco de
// propósito: quem só tiver o banco na mão não abre nada.
//
// ⚠️ PERDER A ENCRYPTION_KEY = PERDER TODAS AS CHAVES CADASTRADAS. Não existe
// recuperação. O conserto é rápido (recadastrar as chaves nas telas), mas o
// aviso fica aqui porque é o pé no qual dá pra atirar.
//
// Quando ela falta, o container gera uma temporária no boot e imprime no
// registro (log) com a instrução de colar no painel — e marca a variável
// ENCRYPTION_KEY_EPHEMERAL pra que o app SAIBA que aquela chave some no
// próximo reinício e se recuse a guardar segredo com ela.

/** Chave mestra do cofre, ou indefinido quando ainda não foi configurada. */
export function encryptionKeyOrNull(): string | undefined {
  return read("ENCRYPTION_KEY");
}

/** Chave mestra do cofre. Explica o que fazer quando falta. */
export function encryptionKey(): string {
  return required(
    encryptionKeyOrNull(),
    "ENCRYPTION_KEY",
    "É a chave que tranca as chaves de API que você cadastra pelas telas do app. " +
      "Abra o registro (log) do app: ele já imprimiu uma chave pronta pra copiar. " +
      "Se estiver na sua máquina, rode: npm run gerar-chave",
  );
}

/**
 * true quando o app está rodando na máquina do aluno (`npm run dev`).
 *
 * Serve pra instrução na tela não mandar ele "abrir o log e clicar em Deploy"
 * quando não existe nem log nem botão de Deploy — lá o arquivo é o .env.local.
 */
export function isDevelopment(): boolean {
  return process.env.NODE_ENV !== "production";
}

/**
 * true quando a chave que está valendo foi gerada pelo container no boot
 * (ou seja: some no próximo reinício e ainda precisa ser colada no painel).
 *
 * Quem escreve essa marca é o `docker-entrypoint.sh`, junto com a chave
 * temporária que ele gera. Fora do container ela nunca existe.
 */
export function encryptionKeyIsEphemeral(): boolean {
  if (!encryptionKeyOrNull()) return false;
  const marca = read("ENCRYPTION_KEY_EPHEMERAL");
  if (!marca) return false;
  return marca !== "0" && marca.toLowerCase() !== "false";
}

/**
 * Segredo usado pra assinar o cookie de "esqueci minha senha".
 *
 * Ordem: AUTH_SECRET → ENCRYPTION_KEY → erro.
 *
 * POR QUE NÃO DERIVA MAIS DO DATABASE_URL
 * Antes, quando ninguém preenchia AUTH_SECRET, esse segredo saía do endereço
 * do banco. Não dá mais: a mesma ideia aplicada ao cofre significaria que
 * trocar a senha do banco APAGA em silêncio todas as chaves de API guardadas.
 * Como o cofre já obriga a ter uma ENCRYPTION_KEY, ela vira a origem única de
 * segredo derivado do projeto.
 *
 * Efeito colateral aceito: os links de recuperação de senha que estavam em
 * trânsito na hora da atualização param de valer. Eles duram 10 minutos.
 */
/** 32 bytes é o mínimo pra um segredo de assinatura valer alguma coisa. */
const MIN_SEGREDO_BYTES = 32;

function segredoForte(valor: string): boolean {
  return Buffer.byteLength(valor, "utf8") >= MIN_SEGREDO_BYTES;
}

export function authSecret(): string {
  const explicito = read("AUTH_SECRET");
  if (explicito) {
    if (!segredoForte(explicito)) {
      throw new Error(
        `A variável AUTH_SECRET é curta demais (mínimo ${MIN_SEGREDO_BYTES} caracteres). ` +
          "Gere uma boa com: npm run gerar-chave",
      );
    }
    return explicito;
  }

  // Só deriva de uma chave mestra que preste. Uma ENCRYPTION_KEY fraca é
  // recusada pelo cofre (a tela fica bloqueada), mas o cookie de recuperação
  // de senha era assinado com ela do mesmo jeito — e em silêncio, que é o pior
  // jeito de ficar inseguro.
  const doCofre = encryptionKeyOrNull();
  if (doCofre && segredoForte(doCofre)) return `derived-from-vault:${doCofre}`;

  throw new Error(
    "Não foi possível assinar o cookie de recuperação de senha: falta a variável " +
      "ENCRYPTION_KEY. Abra o registro (log) do app: ele já imprimiu uma chave pronta " +
      "pra você colar no painel. Depois de colar, clique em Deploy.",
  );
}

/**
 * Confia nos cabeçalhos de proxy (X-Forwarded-For) pra descobrir o IP real.
 *
 * Ligado por padrão porque a imagem Docker desse template foi feita pra rodar
 * atrás do proxy do EasyPanel. Se você expuser o container direto na internet,
 * defina TRUST_PROXY=0.
 */
export function trustProxy(): boolean {
  const raw = read("TRUST_PROXY");
  if (raw === undefined) return process.env.NODE_ENV === "production";
  return raw !== "0" && raw.toLowerCase() !== "false";
}

// -----------------------------------------------------------------------------
// Chaves de provedor — ÚLTIMO RECURSO
// -----------------------------------------------------------------------------
// A partir do cofre (lib/secrets), a ordem de busca de chave é sempre:
//
//     chave do workspace  →  chave da plataforma  →  variável de ambiente
//
// Essas funções são o terceiro degrau. Elas continuam existindo pra não quebrar
// quem já tinha um deploy no ar antes das telas de chave — não são o caminho
// recomendado, e o `.env.example` não fala mais delas. Cadastre pelas telas.

/** Chave do Resend. Sem ela, os emails só aparecem no log do servidor. */
export function resendApiKey(): string | undefined {
  return read("RESEND_API_KEY");
}

/** Remetente dos emails. Só é usado quando o Resend está configurado. */
export function emailFrom(): string {
  return read("EMAIL_FROM") ?? "Template <noreply@example.com>";
}

export function anthropicApiKey(): string | undefined {
  return read("ANTHROPIC_API_KEY");
}

export function openaiApiKey(): string | undefined {
  return read("OPENAI_API_KEY");
}

export function openrouterApiKey(): string | undefined {
  return read("OPENROUTER_API_KEY");
}

/**
 * Chave do Google (Gemini). O nome longo é o que o SDK oficial usa; o curto
 * fica aceito porque é o que muita gente digita.
 */
export function googleApiKey(): string | undefined {
  return read("GOOGLE_GENERATIVE_AI_API_KEY", "GOOGLE_API_KEY");
}

// -----------------------------------------------------------------------------
// A automação (fila + trabalhador)
// -----------------------------------------------------------------------------

/**
 * O endereço de conexão direta com o banco, EXIGIDO.
 *
 * Quem chama isto: só o trabalhador (`scripts/worker.mjs`) e os dois conjuntos
 * de conexão de `lib/automation/pg.ts`. O site em si continua falando com o
 * Supabase pela API (PostgREST) — é ela que aplica as regras de segurança do
 * banco pra quem está logado.
 *
 * Diferente de `databaseUrl()`, aqui a falta é ERRO: sem endereço do banco não
 * existe fila, e uma automação que não roda calada é o pior resultado
 * possível.
 */
export function requireDatabaseUrl(): string {
  return required(
    databaseUrl(),
    "DATABASE_URL",
    "Pegue em supabase.com → seu projeto → Settings → Database → Connection string (URI).",
  );
}

/**
 * O segredo da chamada interna trabalhador → /api/internal/run-job.
 *
 * NÃO é variável de ambiente nova: sai da ENCRYPTION_KEY por HKDF-SHA256
 * (ver `scripts/lib/segredo-interno.mjs`, que é a MESMA conta usada pelo
 * trabalhador — de propósito, pra não existir duas versões que possam
 * discordar).
 *
 * ⚠️ Como ele deriva da chave mestra, ele MUDA quando a chave muda. Os dois
 * processos nascem do mesmo `docker-entrypoint.sh`, então dentro do container
 * eles sempre concordam. O que quebra é rodar o site e o trabalhador com
 * `.env` diferentes na sua máquina — e aí o sintoma é 401 na chamada interna.
 */
export function internalJobSecret(): string {
  return derivarSegredoInterno(encryptionKey());
}
