import type { NextConfig } from "next";

/**
 * Configuração do Next.
 *
 * REGRA IMPORTANTE: o que está neste arquivo é decidido na hora de CONSTRUIR a
 * imagem, e depois fica congelado. Por isso aqui não se lê endereço do
 * Supabase nem domínio do app — se lesse, trocar essas coisas no painel do
 * EasyPanel não teria efeito nenhum. Tudo isso é lido durante a execução, em
 * lib/env.ts.
 */

const IS_PROD = process.env.NODE_ENV === "production";

/**
 * Regras de segurança do navegador (CSP).
 *
 * `connect-src` precisa liberar o Supabase. Como o endereço do seu projeto só
 * é conhecido durante a execução, liberamos o domínio inteiro do Supabase
 * (*.supabase.co) em vez de um projeto específico — o que é seguro, porque a
 * chave de acesso continua sendo exigida.
 *
 * ➜ SE VOCÊ INTEGRAR ALGUM SERVIÇO EXTERNO (pagamento, mapa, analytics),
 *   acrescente o domínio dele em `connect-src` abaixo, senão o navegador
 *   bloqueia a chamada.
 */
const CSP_DIRECTIVES = [
  "default-src 'self'",
  // 'unsafe-inline' é exigido pelo Next pra hidratar a página. 'unsafe-eval'
  // só em desenvolvimento (o hot reload precisa).
  IS_PROD ? "script-src 'self' 'unsafe-inline'" : "script-src 'self' 'unsafe-inline' 'unsafe-eval'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob: https:",
  "font-src 'self' data:",
  [
    "connect-src 'self'",
    "https://*.supabase.co",
    "wss://*.supabase.co",
    // Supabase self-hosted / rodando na sua máquina:
    ...(IS_PROD ? [] : ["http://127.0.0.1:*", "http://localhost:*", "ws://127.0.0.1:*"]),
    "https://api.anthropic.com",
    "https://api.openai.com",
  ].join(" "),
  "frame-ancestors 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "object-src 'none'",
].join("; ");

const SECURITY_HEADERS = [
  { key: "X-Frame-Options", value: "DENY" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  {
    key: "Permissions-Policy",
    value: "camera=(), microphone=(), geolocation=(), interest-cohort=()",
  },
  // 6 meses. Não use `preload` sem ter certeza — é difícil de desfazer.
  { key: "Strict-Transport-Security", value: "max-age=15552000; includeSubDomains" },
  // Valendo de verdade (antes era só "Report-Only", que não bloqueava nada).
  { key: "Content-Security-Policy", value: CSP_DIRECTIVES },
];

const nextConfig: NextConfig = {
  output: "standalone",
  /**
   * Bibliotecas que o empacotador NÃO deve empacotar — elas são carregadas do
   * jeito normal do Node, quando o app está rodando.
   *
   * `pg` (a biblioteca de banco) precisa disso: ela carrega pedaços de si
   * mesma na hora, e empacotada ela quebra SÓ EM PRODUÇÃO — o pior lugar pra
   * descobrir. Quem usa: a automação (lib/automation/pg.ts).
   *
   * `unpdf` (o leitor de PDF) precisa pelo mesmo motivo, e ainda mais forte:
   * ele embute o pdf.js, que carrega pedaços de si mesmo com `require`
   * dinâmico. Empacotado, ele quebra SÓ no container. Quem usa:
   * lib/knowledge/extract/pdf.ts — e é o ÚNICO arquivo do projeto que importa
   * ele, justamente pra o plano B (tirar PDF da lista) ser barato.
   */
  serverExternalPackages: ["pg", "unpdf"],
  images: {
    remotePatterns: [
      { protocol: "https", hostname: "**.supabase.co" },
      { protocol: "http", hostname: "127.0.0.1" },
      { protocol: "http", hostname: "localhost" },
    ],
  },
  experimental: {
    serverActions: {
      // Formulários mandam arquivo. Este é o teto do CORPO INTEIRO do
      // formulário, e ele precisa ser MAIOR que o maior arquivo aceito.
      //
      // ⚠️ ESTE NÚMERO ANDA JUNTO COM OUTROS TRÊS. Mudou aqui, confira os quatro:
      //   1. `KNOWLEDGE_MAX_BYTES` = 5 MB (lib/knowledge/mime.ts) — o maior;
      //   2. `file_size_limit` do bucket `knowledge-docs` (migration
      //      20260821020000), que precisa bater com o de cima;
      //   3. o limite do logo da organização, 2 MB (lib/orgs/actions.ts);
      //   4. o texto das telas, que promete o número pro aluno.
      //
      // ⚠️ 6 MB vale pra TODAS as funções do servidor, não só pro envio de
      // documento (risco 17 do contrato). Quem segura o pior caso é o
      // limitador do proxy.ts; o teto de verdade do arquivo é conferido na
      // função, antes de qualquer trabalho.
      bodySizeLimit: "6mb",
    },
  },
  async headers() {
    return [{ source: "/:path*", headers: SECURITY_HEADERS }];
  },
};

export default nextConfig;
