/**
 * GUARDA ESTÁTICA DO SEGUNDO PROCESSO.
 *
 * A partir da automação o container roda DOIS programas: o site e o
 * trabalhador. Nada disso aparece no `tsc --noEmit`, e tudo isso só quebra
 * depois do deploy — que é o pior lugar pra descobrir.
 *
 * O que este arquivo trava:
 *
 * 1. o `docker-entrypoint.sh` liga os dois, na ordem certa, e derruba o
 *    container inteiro se qualquer um deles morrer;
 * 2. o trabalhador é copiado pra dentro da imagem (com a pasta `scripts/lib`);
 * 3. o nome do arquivo de batimento é o MESMO nos dois lados (ele está escrito
 *    duas vezes de propósito: o trabalhador é Node puro e não consegue
 *    importar do TypeScript do site);
 * 4. a checagem de saúde só cobra o trabalhador quando existe `DATABASE_URL` —
 *    sem essa condição, um app sem banco entraria em laço de reinício.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, test } from "vitest";
import {
  caminhoDoBatimento,
  IDADE_MAXIMA_DO_BATIMENTO_MS,
  NOME_DO_ARQUIVO_DE_BATIMENTO,
  trabalhadorEstaVivo,
} from "@/lib/automation/heartbeat";

function ler(...pedacos: string[]): string {
  return readFileSync(join(process.cwd(), ...pedacos), "utf8");
}

const entrypoint = ler("docker-entrypoint.sh");
const dockerfile = ler("Dockerfile");
const worker = ler("scripts", "worker.mjs");
const health = ler("app", "api", "health", "route.ts");
const pkg = JSON.parse(ler("package.json")) as { scripts: Record<string, string> };

describe("docker-entrypoint.sh — os dois processos", () => {
  test("não tem fim de linha do Windows (CRLF mata o container no boot)", () => {
    expect(entrypoint.includes("\r")).toBe(false);
  });

  test("a ordem é: chave → tabelas do banco → trabalhador → site", () => {
    const chave = entrypoint.indexOf("randomBytes(32)");
    const migrate = entrypoint.indexOf("scripts/migrate.mjs");
    const trabalhador = entrypoint.indexOf("scripts/worker.mjs");
    const site = entrypoint.indexOf("node /app/server.js");

    expect(chave).toBeGreaterThan(-1);
    expect(migrate).toBeGreaterThan(chave);
    expect(trabalhador).toBeGreaterThan(migrate);
    expect(site).toBeGreaterThan(trabalhador);
  });

  test("o site NÃO é mais o processo principal (nada de `exec`)", () => {
    // Com dois filhos, o entrypoint precisa ficar vivo pra tomar conta dos
    // dois. Um `exec` aqui faria o trabalhador virar órfão.
    expect(entrypoint).not.toContain("exec node /app/server.js");
    expect(entrypoint).toContain("node /app/server.js &");
    expect(entrypoint).toContain("node /app/scripts/worker.mjs &");
  });

  test("guarda o número dos dois processos e repassa o pedido de parada", () => {
    expect(entrypoint).toContain("WORKER_PID=$!");
    expect(entrypoint).toContain("SITE_PID=$!");
    expect(entrypoint).toMatch(/trap .*kill -TERM .*WORKER_PID.*SITE_PID/);
  });

  test("se um morrer, derruba o outro e o container cai", () => {
    expect(entrypoint).toContain('kill -0 "$WORKER_PID"');
    expect(entrypoint).toContain('kill -0 "$SITE_PID"');
    expect(entrypoint).toContain("exit 1");
  });
});

describe("docker-entrypoint.sh — semeando os workspaces que já existem", () => {
  test("o semear roda DEPOIS do site (ele fala com a própria rota HTTP — rodar antes é ovo-e-galinha)", () => {
    const site = entrypoint.indexOf("node /app/server.js");
    const semear = entrypoint.indexOf("scripts/semear.mjs");

    expect(site).toBeGreaterThan(-1);
    expect(semear).toBeGreaterThan(site);
  });

  test("roda em segundo plano — o bloco fecha com `) &`, antes do laço que monitora os dois processos", () => {
    const fechoDoBloco = entrypoint.indexOf(") &");
    const semear = entrypoint.indexOf("scripts/semear.mjs");
    const loopDeMonitoramento = entrypoint.indexOf("while true");

    expect(fechoDoBloco).toBeGreaterThan(semear);
    expect(loopDeMonitoramento).toBeGreaterThan(fechoDoBloco);
  });

  test("espera o site responder com um teto de tentativas — nunca um `sleep` fixo torcendo pra dar certo", () => {
    expect(entrypoint).toContain("/api/health");
    expect(entrypoint).toContain("until wget");
    expect(entrypoint).toMatch(/TENTATIVAS.*-ge.*TETO_DE_TENTATIVAS/);
  });

  test("falhar no semear NUNCA derruba o container: a chamada mora dentro de um `if`, não solta contra o `set -e`", () => {
    expect(entrypoint).toContain("if node /app/scripts/semear.mjs; then");
  });

  test("o semear não usa `exit 1` (isso mataria só o subshell dele, mas não é essa a intenção — é seguir e avisar)", () => {
    const inicioDoBloco = entrypoint.indexOf("# 6. Semeando os workspaces que já existem");
    const fimDoBloco = entrypoint.indexOf(") &", inicioDoBloco);
    const trechoDoSemear = entrypoint.slice(inicioDoBloco, fimDoBloco);

    expect(inicioDoBloco).toBeGreaterThan(-1);
    expect(trechoDoSemear).not.toContain("exit 1");
  });
});

describe("Dockerfile — o trabalhador entra na imagem", () => {
  test("a pasta scripts inteira é copiada (o worker mora lá, com scripts/lib)", () => {
    expect(dockerfile).toContain("/app/scripts ./scripts");
  });

  test("a biblioteca de banco vem junto (o worker usa `pg` fora do site)", () => {
    expect(dockerfile).toContain("npm install pg");
    expect(dockerfile).toContain("/pg/node_modules ./node_modules");
  });

  test("o certificado do Supabase vem junto (o worker confere ele também)", () => {
    expect(dockerfile).toContain("/app/supabase/certs ./supabase/certs");
  });
});

describe("package.json", () => {
  test('tem o comando "worker" pra rodar o trabalhador na máquina do aluno', () => {
    expect(pkg.scripts.worker).toBe("node scripts/worker.mjs");
  });
});

describe("o batimento é o mesmo arquivo nos dois lados", () => {
  test("o nome escrito no worker.mjs bate com o do heartbeat.ts", () => {
    // Ele está escrito duas vezes de propósito (o worker é Node puro e não
    // passa pelo empacotador do Next). Se um mudar sozinho, o healthcheck
    // passa a olhar um arquivo que ninguém escreve — e o container reinicia
    // pra sempre.
    expect(worker).toContain(
      `const NOME_DO_ARQUIVO_DE_BATIMENTO = "${NOME_DO_ARQUIVO_DE_BATIMENTO}"`,
    );
  });

  test("o caminho sai de os.tmpdir(), nunca de um /tmp fixo", () => {
    // `/tmp` fixo quebraria o `npm run dev` no Windows.
    expect(caminhoDoBatimento()).toContain(NOME_DO_ARQUIVO_DE_BATIMENTO);
    expect(worker).toContain("tmpdir()");
    const fonte = ler("lib", "automation", "heartbeat.ts");
    expect(fonte).not.toContain('"/tmp/');
  });

  test("sem arquivo nenhum, o trabalhador conta como morto", () => {
    // Idade zero: nem um arquivo recém-escrito passaria. Serve pra provar que
    // a resposta padrão é "não está vivo", e não "está".
    expect(trabalhadorEstaVivo(-1)).toBe(false);
  });

  test("a idade máxima é de minutos, não de horas", () => {
    expect(IDADE_MAXIMA_DO_BATIMENTO_MS).toBeGreaterThanOrEqual(30_000);
    expect(IDADE_MAXIMA_DO_BATIMENTO_MS).toBeLessThanOrEqual(300_000);
  });
});

describe("a checagem de saúde", () => {
  test("só cobra o trabalhador quando existe DATABASE_URL", () => {
    // ⚠️ SEM ESTA CONDIÇÃO, um app sem banco (cenário suportado) passaria a
    // responder 503 pra sempre e o container entraria em laço de reinício.
    expect(health).toContain("databaseUrl()");
    expect(health).toContain("temBanco && !trabalhadorEstaVivo()");
    expect(health).toContain("503");
  });

  test("continua respondendo sem tocar no banco", () => {
    expect(health).not.toContain("createClient");
  });
});

describe("o trabalhador em si", () => {
  test("não morre quando falta DATABASE_URL (senão vira laço de reinício)", () => {
    expect(worker).toContain("DATABASE_URL");
    expect(worker).toMatch(/if \(!dbUrl\)/);
  });

  test("chama o site em 127.0.0.1, e não por um endereço público", () => {
    // A chamada é DENTRO do container: assim ela não passa pelo proxy do
    // EasyPanel, e o corte de 60 segundos dele não vale.
    expect(worker).toContain("http://127.0.0.1:");
    expect(worker).toContain("/api/internal/run-job");
  });

  test("assina toda chamada e manda os três cabeçalhos", () => {
    expect(worker).toContain("x-job-signature");
    expect(worker).toContain("x-job-ts");
    expect(worker).toContain("x-worker-id");
  });

  test("o corpo do pedido carrega SÓ o número do trabalho", () => {
    // Se um dia entrar organização ou identidade aqui, a ameaça T5 do
    // contrato volta a existir.
    expect(worker).toContain("body: JSON.stringify({ jobId })");
  });

  test("põe os agendamentos na fila e faz faxina", () => {
    expect(worker).toContain("enqueue_due_schedules");
    expect(worker).toContain("reclaim_stuck_jobs");
    expect(worker).toContain("reclaim_stuck_agent_runs");
  });

  test("devolve o trabalho pra fila quando o site não responde", () => {
    expect(worker).toContain("release_job");
  });
});
