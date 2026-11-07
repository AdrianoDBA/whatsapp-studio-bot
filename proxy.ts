import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { chamadaVeioDeFora } from "@/lib/automation/chamada-interna";
import { trustProxy } from "@/lib/env";
import { updateSession } from "@/lib/supabase/middleware";

/**
 * Porteiro do site: roda antes de toda página.
 *
 * Faz três coisas:
 *  1. Mantém a sessão de quem está logado válida.
 *  2. Manda pro login quem tentar abrir uma página privada sem estar logado
 *     (guardando pra onde a pessoa queria ir).
 *  3. Segura tentativa em excesso de login/cadastro.
 *
 * (Este arquivo se chamava `middleware.ts`. O Next 16 renomeou essa
 * funcionalidade pra `proxy` — é a mesma coisa, só mudou o nome.)
 */

/** Páginas que qualquer pessoa pode abrir sem estar logada. */
const PUBLIC_PATHS = [
  "/",
  "/login",
  "/signup",
  "/reset-password",
  "/verify-email",
  // Quem recebe convite por email ainda não tem conta. Esta página trata os
  // dois casos (com e sem conta) — ver app/(app)/aceitar-convite/page.tsx.
  "/aceitar-convite",
];

/** Extensões de arquivo que passam direto (imagem, fonte, css...). */
const STATIC_EXT_WHITELIST = new Set([
  "svg",
  "png",
  "jpg",
  "jpeg",
  "webp",
  "gif",
  "ico",
  "css",
  "js",
  "map",
  "woff",
  "woff2",
  "ttf",
  "otf",
  "txt",
  "xml",
  "json",
]);

function isStaticAsset(pathname: string): boolean {
  const lastDot = pathname.lastIndexOf(".");
  if (lastDot === -1) return false;
  const ext = pathname.slice(lastDot + 1).toLowerCase();
  return STATIC_EXT_WHITELIST.has(ext);
}

// ---------------------------------------------------------------------------
// Limite de tentativas
// ---------------------------------------------------------------------------
// Contagem guardada na memória do processo. Se você rodar várias cópias do app,
// cada uma conta a sua parte — é uma primeira barreira, não uma proteção
// completa contra ataque grande.

const rateLimitBuckets = new Map<string, { count: number; resetAt: number }>();
const RATE_WINDOW_MS = 60_000;
/** Tentativas por minuto pra quem não está logado (login, cadastro, reset). */
const RATE_MAX_ANONIMO = 20;
/** Tentativas por minuto pra quem já está logado — folgado de propósito. */
const RATE_MAX_LOGADO = 120;
const RATE_MAP_HARD_CAP = 10_000;
const AUTH_PATHS = ["/login", "/signup", "/reset-password"];
/**
 * Teto de chamadas de webhook por minuto, por endereço de origem.
 *
 * Folgado de propósito: um sistema legítimo (WhatsApp, formulário, n8n) pode
 * mandar rajada. O que isso corta é o chute de token em série.
 */
const RATE_MAX_WEBHOOK = 60;
/**
 * O MESMO teto NÃO serve pra quem só vem BUSCAR o resultado.
 *
 * ⚠️ SÃO DOIS BALDES SEPARADOS, E ISSO É A CORREÇÃO — NÃO UM DETALHE.
 * `GET /api/webhooks/<id>/j/<jobId>` é o endereço de "buscar depois" que o
 * modo síncrono devolve em `buscarEm` quando o agente passa dos 50 s. O
 * sistema do outro lado fica perguntando de tempos em tempos até a resposta
 * ficar pronta — é pra isso que esse endereço existe, e a doc do aluno manda
 * fazer isso.
 *
 * Com um balde só, quem seguia a doc gastava o mesmo teto de 60/min que o
 * POST de negócio compara: na 60ª pergunta do minuto o polling levava 429 E
 * o próximo evento de verdade do mesmo endereço de origem morria junto. Em
 * produção `trustProxy()` é `true`, então esse endereço de origem costuma ser
 * o do sistema inteiro do outro lado (um n8n, um Zapier) — um trabalho lento
 * derrubava os outros.
 *
 * O número: 300/min = 5 por segundo. Dá pra vários trabalhos serem buscados
 * ao mesmo tempo, de segundo em segundo, sem chegar perto do teto — e ainda
 * assim existe teto, porque este endereço fala com o banco a cada chamada.
 *
 * ⚠️ MEXEU AQUI, MEXA NA DOC. `docs/06-agentes-de-ia/06-o-agente-que-age.md`
 * descreve pro aluno o que este número permite. Doc que promete "chame à
 * vontade" com um teto escondido aqui é pior que teto nenhum.
 */
const RATE_MAX_WEBHOOK_BUSCA = 300;
/** `GET /api/webhooks/<endpointId>/j/<jobId>` — o endereço de "buscar depois". */
const CAMINHO_DE_BUSCAR_RESULTADO = /^\/api\/webhooks\/[^/]+\/j\/[^/]+\/?$/;
const IS_DEV = process.env.NODE_ENV !== "production";

/**
 * Descobre o endereço (IP) de quem está acessando.
 *
 * Atrás de um proxy (EasyPanel/Traefik/nginx), o endereço real vem no
 * cabeçalho X-Forwarded-For — mas só dá pra confiar nesse cabeçalho quando
 * existe mesmo um proxy na frente, senão qualquer um forja.
 *
 * Devolve null quando não dá pra saber. Nesse caso preferimos NÃO limitar a
 * jogar todo mundo no mesmo balde — senão uma pessoa sozinha trava o login do
 * site inteiro.
 */
function ipFromRequest(req: NextRequest): string | null {
  if (!trustProxy()) return null;

  const xff = req.headers.get("x-forwarded-for");
  if (xff) {
    // Último elemento = quem falou com o nosso proxy. Correto pra UM proxy na
    // frente (caso do EasyPanel). Com Cloudflare na frente também, todo mundo
    // cai no IP da borda.
    const parts = xff.split(",");
    const last = parts[parts.length - 1];
    if (last?.trim()) return last.trim();
  }
  const real = req.headers.get("x-real-ip");
  if (real?.trim()) return real.trim();

  return null;
}

function sweepExpired(now: number) {
  if (rateLimitBuckets.size < RATE_MAP_HARD_CAP) return;
  for (const [k, v] of rateLimitBuckets) {
    if (now > v.resetAt) rateLimitBuckets.delete(k);
  }
}

/** true = pode passar. false = estourou o limite. */
function rateLimit(key: string, max: number): boolean {
  const now = Date.now();
  sweepExpired(now);
  const entry = rateLimitBuckets.get(key);
  if (!entry || now > entry.resetAt) {
    rateLimitBuckets.set(key, { count: 1, resetAt: now + RATE_WINDOW_MS });
    return true;
  }
  if (entry.count >= max) return false;
  entry.count++;
  return true;
}

/**
 * Quais requisições entram na contagem.
 *
 * Cobre tanto o envio direto de formulário quanto a chamada de função do
 * servidor (que carrega o cabeçalho `next-action`) — senão dava pra chamar a
 * função de login por fora e escapar do limite.
 */
function shouldRateLimit(req: NextRequest): boolean {
  // Em desenvolvimento não limita: o recarregamento automático dispara muita
  // requisição e você tomaria bloqueio à toa.
  if (IS_DEV) return false;
  if (req.method !== "POST") return false;

  const { pathname } = req.nextUrl;
  if (AUTH_PATHS.some((p) => pathname === p || pathname.startsWith(`${p}/`))) return true;
  if (req.headers.get("next-action")) return true;

  return false;
}

export async function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;

  // A checagem de saúde precisa responder mesmo se o Supabase estiver fora do
  // ar — senão o EasyPanel acha que o app morreu e fica reiniciando pra sempre.
  if (pathname === "/api/health") return NextResponse.next();

  // ---------------------------------------------------------------------
  // A porta de dentro: /api/internal
  // ---------------------------------------------------------------------
  // É por onde o trabalhador da automação (o outro processo deste mesmo
  // container) pede pro site rodar um agente.
  //
  // ⚠️ SEM ESTE DESVIO A AUTOMAÇÃO NÃO RODARIA, e sem erro nenhum no
  // registro (log): o trabalhador não tem sessão, então o porteiro mandaria
  // ele pro /login e o sintoma seria "a automação simplesmente não roda".
  //
  // Como saber se veio de fora: o endereço de quem chamou aparece na cadeia de
  // proxy (`x-forwarded-for`). De dentro do container ele é 127.0.0.1; de fora
  // é o endereço da pessoa. Ver `lib/automation/chamada-interna.ts` — lá está
  // explicada a pegadinha (o próprio Next carimba esses cabeçalhos SEMPRE).
  // (A rota confere isso de novo, e a assinatura por cima. Duas camadas.)
  if (pathname.startsWith("/api/internal")) {
    if (chamadaVeioDeFora(request.headers)) {
      return new NextResponse("Não encontrado.", { status: 404 });
    }
    return NextResponse.next();
  }

  // ---------------------------------------------------------------------
  // A porta de fora: /api/webhooks
  // ---------------------------------------------------------------------
  // Um sistema de fora (WhatsApp, formulário, o que for) chama esse endereço
  // com o token secreto do endpoint. Não existe pessoa logada nessa chamada,
  // então ela não pode passar pelo porteiro de sessão. Quem confere o token e
  // o limite de chamadas é a própria rota.
  if (pathname.startsWith("/api/webhooks")) {
    // Passa direto pela conferência de SESSÃO, mas não pelo limite de chamadas.
    //
    // O contador que existe dentro da rota (`webhook_touch`) só roda DEPOIS do
    // token bater. Ou seja: quem chuta token errado não era contado por
    // ninguém, e cada tentativa ainda gastava leitura de corpo e ida ao banco.
    // Dava pra martelar o endereço à vontade.
    //
    // Aqui o freio é pelo endereço de origem, antes de qualquer trabalho.
    //
    // ⚠️ DOIS BALDES, COM CHAVES DIFERENTES. Disparar um evento de negócio
    // (POST) e vir buscar o resultado de um trabalho que já entrou na fila
    // (GET .../j/<jobId>) são usos com ritmos completamente diferentes, e
    // misturar os dois no mesmo contador fazia o polling legítimo derrubar o
    // evento seguinte. Ver `RATE_MAX_WEBHOOK_BUSCA`.
    const buscandoResultado = CAMINHO_DE_BUSCAR_RESULTADO.test(pathname);
    const origem = ipFromRequest(request);
    // ⚠️ AS DUAS ETIQUETAS TÊM O MESMO TAMANHO, e isso não é estética. Com
    // `hook:` e `hook:busca:`, a primeira etiqueta mais um `origem` começando
    // em `busca:` produz exatamente a segunda chave — quem forjasse
    // `x-forwarded-for: busca:<ip-da-vítima>` gastaria o balde de busca dela.
    // Atrás de um proxy que carimba o último elemento do XFF isso não passa,
    // mas depender disso é depender da configuração de outra pessoa.
    const chave = buscandoResultado ? `hookGET:${origem}` : `hookPOST:${origem}`;
    const teto = buscandoResultado ? RATE_MAX_WEBHOOK_BUSCA : RATE_MAX_WEBHOOK;

    if (origem && !rateLimit(chave, teto)) {
      // JSON com `code`, e não texto puro: quem programa do outro lado já
      // separa `limite_de_chamadas` de `teto_de_gasto` pelas respostas das
      // rotas (ver o cabeçalho de `app/api/webhooks/[endpointId]/route.ts`).
      // Um 429 em texto puro aqui em cima quebrava esse contrato justamente
      // no caso em que o cliente MAIS precisa saber que é só esperar.
      return new NextResponse(
        JSON.stringify({
          ok: false,
          error: "Muitas chamadas seguidas desse endereço de origem. Espere um minuto.",
          code: "limite_de_chamadas",
        }),
        {
          status: 429,
          headers: {
            "content-type": "application/json; charset=utf-8",
            "cache-control": "no-store",
            "retry-after": "60",
          },
        },
      );
    }
    return NextResponse.next();
  }

  const { supabaseResponse, user } = await updateSession(request);

  if (shouldRateLimit(request)) {
    const key = user ? `u:${user.id}` : `ip:${ipFromRequest(request)}`;
    const limitavel = user !== null || ipFromRequest(request) !== null;
    if (limitavel && !rateLimit(key, user ? RATE_MAX_LOGADO : RATE_MAX_ANONIMO)) {
      return new NextResponse("Muitas tentativas seguidas. Espere 1 minuto e tente de novo.", {
        status: 429,
        headers: { "retry-after": "60" },
      });
    }
  }

  const isPublic =
    PUBLIC_PATHS.includes(pathname) ||
    pathname.startsWith("/reset-password") ||
    pathname.startsWith("/auth/") ||
    pathname.startsWith("/_next") ||
    isStaticAsset(pathname);

  if (!user && !isPublic) {
    const url = request.nextUrl.clone();
    url.pathname = "/login";
    url.search = "";
    // Guarda pra onde a pessoa queria ir, pra mandar ela de volta depois do
    // login em vez de largar no lugar errado.
    url.searchParams.set("next", pathname + request.nextUrl.search);
    return NextResponse.redirect(url);
  }

  return supabaseResponse;
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|api/health|.*\\.svg).*)"],
};
