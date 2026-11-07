/**
 * O QUE VAI PARAR NA MÃO DO ALUNO.
 *
 * POR QUE ESTE ARQUIVO EXISTE
 * --------------------------
 * O aluno não clona este repositório: ele baixa um zip da área de membros, e
 * esse zip é o **tarball da tag, sem filtro nenhum**. Não existe pipeline
 * apagando nada no meio do caminho — o que estiver rastreado no git na hora da
 * tag chega inteiro na máquina dele.
 *
 * Isso é de propósito (`CLAUDE.md`, `docs/`, `tests/` e os comentários SÃO o
 * material do curso), e é justamente por isso que precisa de guarda: qualquer
 * arquivo que alguém commitar sem pensar viaja junto, e ninguém descobre —
 * `tsc` não reclama, o site sobe igual, os outros testes ficam verdes.
 *
 * As três coisas que este arquivo trava:
 *
 * 1. **rascunho interno não viaja.** Os planos e contratos que o Claude Code
 *    escreve enquanto constrói (`docs/superpowers/`) são registro de decisão
 *    nosso, não aula. Ficam no disco, fora do git.
 * 2. **chave de verdade não viaja.** Um `sk-ant-…` colado num arquivo e
 *    commitado vira uma chave publicada pra turma inteira.
 * 3. **CLAUDE.md não descreve pasta que não existe.** Já aconteceu duas vezes
 *    (`lib/billing/` prometendo Stripe, `lib/messaging/` prometendo WhatsApp):
 *    pastas com um CLAUDE.md dentro e nenhum código. O Claude Code do aluno lê
 *    aquilo como verdade e passa a responder sobre uma função que não está lá.
 */
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/** Os arquivos que o `git` de fato rastreia — é exatamente o que vai no zip. */
function arquivosRastreados(): string[] {
  return execFileSync("git", ["ls-files"], { cwd: process.cwd(), encoding: "utf8" })
    .split("\n")
    .map((linha) => linha.trim())
    .filter((linha) => linha !== "");
}

const rastreados = arquivosRastreados();

describe("rascunho interno não viaja junto", () => {
  it("nenhum plano ou contrato de `docs/superpowers/` está rastreado", () => {
    // Eles continuam no disco (o `.gitignore` só tira do git) — são registro
    // histórico de como cada onda foi decidida, e servem pra nós, não pro aluno.
    const vazados = rastreados.filter((f) => f.startsWith("docs/superpowers/"));
    expect(vazados, `estes iriam no download do aluno:\n${vazados.join("\n")}`).toEqual([]);
  });

  it("nenhum arquivo de ambiente além do `.env.example`", () => {
    // `.env.local` tem a senha do banco da máquina de quem escreveu.
    const env = rastreados.filter((f) => f.split("/").pop()?.startsWith(".env"));
    expect(env).toEqual([".env.example"]);
  });

  it("as preferências pessoais do Claude Code não viajam", () => {
    // `.claude/settings.json` (as permissões do projeto) VAI de propósito — é o
    // que faz o Claude Code do aluno rodar `npm run verify` sem pedir licença a
    // cada vez. O `.local.json` é da máquina de quem escreveu.
    expect(rastreados).not.toContain(".claude/settings.local.json");
  });
});

describe("nenhuma chave de verdade vai no download", () => {
  /**
   * Os formatos que as chaves dos provedores realmente têm. O tamanho mínimo é
   * o que separa uma chave de uma menção em texto ("uma chave `sk-ant-…`").
   */
  const FORMATOS_DE_CHAVE = [
    /sk-ant-[A-Za-z0-9_-]{16}/,
    /sk-or-v1-[A-Za-z0-9]{16}/,
    /sk-proj-[A-Za-z0-9_-]{16}/,
    /AIza[0-9A-Za-z_-]{30}/,
    /re_[A-Za-z0-9_-]{16}/,
    /ghp_[A-Za-z0-9]{30}/,
    /github_pat_[A-Za-z0-9_]{30}/,
    /eyJhbGciOi[A-Za-z0-9_-]{20}/,
  ];

  /**
   * Os únicos arquivos onde uma sequência com cara de chave é ESPERADA: são
   * chaves inventadas, existem pra provar que o mascaramento e o cofre
   * funcionam, e nenhuma delas abre nada.
   *
   * ⚠️ NÃO ACRESCENTE NADA AQUI SEM OLHAR O ARQUIVO. Esta lista é curta de
   * propósito: se um arquivo novo aparecer no relatório da falha, a pergunta
   * certa é "por que tem uma chave nele?", não "como faço o teste passar?".
   */
  const CHAVES_INVENTADAS_DE_TESTE = new Set([
    "tests/secrets-crypto.test.ts",
    "tests/secrets-mask.test.ts",
    "tests/secrets-prefixo-da-chave.test.ts",
  ]);

  /** Binário não é texto — ler como texto só geraria ruído. */
  const BINARIOS = /\.(png|jpg|jpeg|gif|webp|ico|woff2?|ttf|otf|pdf|zip|crt|pem)$/i;

  it("nenhum arquivo rastreado carrega algo com formato de chave", () => {
    const suspeitos: string[] = [];

    for (const arquivo of rastreados) {
      if (CHAVES_INVENTADAS_DE_TESTE.has(arquivo)) continue;
      if (BINARIOS.test(arquivo)) continue;

      let conteudo: string;
      try {
        conteudo = readFileSync(join(process.cwd(), arquivo), "utf8");
      } catch {
        continue; // arquivo removido no working tree; o commit resolve
      }

      for (const formato of FORMATOS_DE_CHAVE) {
        if (formato.test(conteudo)) {
          suspeitos.push(`${arquivo} (bate em ${formato})`);
          break;
        }
      }
    }

    expect(suspeitos, `chave com cara de real em:\n${suspeitos.join("\n")}`).toEqual([]);
  });
});

describe("nenhum CLAUDE.md descreve pasta que não existe", () => {
  it("toda pasta com CLAUDE.md tem código dentro", () => {
    // `lib/billing/CLAUDE.md` dizia "integração Stripe, planejada pra v1.2" e
    // `lib/messaging/CLAUDE.md` descrevia adaptadores de WhatsApp. Nenhum dos
    // dois tinha uma linha de código do lado — e o Claude Code do aluno lia
    // aquilo como se o template já tivesse as duas coisas.
    const orfaos: string[] = [];

    for (const arquivo of rastreados) {
      if (!arquivo.endsWith("CLAUDE.md")) continue;

      const pasta = arquivo.slice(0, arquivo.length - "CLAUDE.md".length);
      if (pasta === "") continue; // o da raiz descreve o projeto inteiro

      const temCodigo = rastreados.some(
        (outro) =>
          outro !== arquivo && outro.startsWith(pasta) && /\.(ts|tsx|sql|mjs|js)$/.test(outro),
      );
      if (!temCodigo) orfaos.push(arquivo);
    }

    expect(orfaos, `CLAUDE.md sem código do lado:\n${orfaos.join("\n")}`).toEqual([]);
  });
});

/**
 * O README — o PRIMEIRO arquivo que o aluno abre.
 *
 * Ele apanhou das mesmas três mentiras que a landing já tinha levado, e passou
 * batido porque ninguém olhava pra ele:
 *
 *   1. dizia "## Licença — MIT" sem existir arquivo `LICENSE` no projeto. MIT
 *      é uma afirmação jurídica: quer dizer que quem recebeu pode revender e
 *      redistribuir. Escrita por engano, num template pago;
 *   2. anunciava "Dashboard com KPIs e gráficos de exemplo" — a tela deixou de
 *      ser demo há muito tempo, os números são consultas de verdade;
 *   3. mandava o aluno "anotar a service_role key". Este template NÃO usa
 *      nenhuma — e uma `service_role` na mão de quem está aprendendo abre o
 *      banco inteiro, passando por cima de toda regra de segurança.
 *
 * E carregava um bilhete interno (`<!-- TODO: tirar um screenshot... -->`)
 * que viajava dentro do zip.
 */
describe("o README não pode mentir pro aluno", () => {
  const readme = readFileSync(join(process.cwd(), "README.md"), "utf8");

  it("não anuncia licença sem existir o arquivo dela", () => {
    const temArquivoDeLicenca = rastreados.some((f) => /^LICEN[CS][EA]/i.test(f));
    if (temArquivoDeLicenca) return; // tem licença de verdade: pode falar dela

    expect(
      readme,
      "o README anuncia uma licença, mas não existe arquivo LICENSE no projeto",
    ).not.toMatch(/\b(MIT|Apache|GPL|BSD|ISC)\b/);
  });

  it("todo `npm run` que ele manda rodar existe de verdade", () => {
    const pkg = JSON.parse(readFileSync(join(process.cwd(), "package.json"), "utf8")) as {
      scripts: Record<string, string>;
    };
    const inexistentes = [...readme.matchAll(/npm run ([\w:-]+)/g)]
      .map((m) => m[1])
      .filter((nome) => nome !== undefined && pkg.scripts[nome] === undefined);

    expect(inexistentes, `o README manda rodar: ${inexistentes.join(", ")}`).toEqual([]);
  });

  it("todo caminho de arquivo que ele linka existe", () => {
    // Link quebrado no primeiro arquivo que a pessoa abre é o pior lugar
    // possível pra ter um — ela conclui que o download veio incompleto.
    const quebrados = [...readme.matchAll(/\]\(\.\/([^)#]+)\)/g)]
      .map((m) => m[1]?.replace(/\/$/, ""))
      .filter((caminho): caminho is string => caminho !== undefined)
      .filter((caminho) => !rastreados.some((f) => f === caminho || f.startsWith(`${caminho}/`)));

    expect(quebrados, `links quebrados no README: ${quebrados.join(", ")}`).toEqual([]);
  });

  it("não manda o aluno pegar a service_role key", () => {
    // O template inteiro fala com o banco pela chave `anon`, que é quem passa
    // pelas regras de segurança. A `service_role` pula todas elas.
    // O README FALA da service_role de propósito — pra mandar não copiar. O que
    // não pode voltar é a linha que PEDE, então a frase negada fica de fora.
    const linhasQuePedem = readme
      .split("\n")
      .filter((l) => /service_role/i.test(l))
      .filter((l) => /anote|copie|pegue|preencha|cole/i.test(l))
      .filter((l) => !/\bn[ãa]o\s+(copie|use|precisa|coloque|pegue)/i.test(l));

    expect(linhasQuePedem, `o README pede a service_role:\n${linhasQuePedem.join("\n")}`).toEqual(
      [],
    );
  });

  it("não carrega bilhete interno dentro de comentário", () => {
    // `<!-- TODO: tirar um screenshot ... -->` viajava no zip.
    expect(readme).not.toMatch(/<!--[\s\S]*?\b(TODO|FIXME|XXX|HACK)\b[\s\S]*?-->/);
  });
});

/**
 * A DOCUMENTAÇÃO DO ALUNO — as mesmas regras do README, nos 24 arquivos.
 *
 * O README apanhou de três mentiras, e duas delas estavam TAMBÉM espalhadas
 * pelo `docs/`, em guias diferentes:
 *
 *   - três lugares mandavam "anote a service_role key". Ela nunca foi usada
 *     por este template;
 *   - dois mandavam aplicar as migrations na mão no SQL Editor do Supabase —
 *     justamente o que o `npm run migrate` e o container fazem sozinhos. Guia
 *     que manda fazer na mão o que já é automático ensina o aluno errado e
 *     ainda o faz duvidar de que o automático funciona.
 */
describe("a documentação do aluno segue as mesmas regras", () => {
  const guias = rastreados.filter((f) => f.startsWith("docs/") && f.endsWith(".md"));

  it("existe documentação pra ler (o filtro não pode ter esvaziado sozinho)", () => {
    expect(guias.length).toBeGreaterThan(15);
  });

  it("nenhum guia manda rodar `npm run` que não existe", () => {
    const pkg = JSON.parse(readFileSync(join(process.cwd(), "package.json"), "utf8")) as {
      scripts: Record<string, string>;
    };
    const problemas: string[] = [];

    for (const guia of guias) {
      const texto = readFileSync(join(process.cwd(), guia), "utf8");
      for (const m of texto.matchAll(/npm run ([\w:-]+)/g)) {
        const nome = m[1];
        if (nome && pkg.scripts[nome] === undefined) problemas.push(`${guia}: npm run ${nome}`);
      }
    }

    expect(problemas, `comando inexistente em:\n${problemas.join("\n")}`).toEqual([]);
  });

  it("nenhum guia pede a service_role key", () => {
    const problemas: string[] = [];

    for (const guia of guias) {
      const linhas = readFileSync(join(process.cwd(), guia), "utf8")
        .split("\n")
        .filter((l) => /service_role/i.test(l))
        .filter((l) => /anote|copie|pegue|preencha|cole/i.test(l))
        .filter((l) => !/\bn[ãa]o\s+(copie|usa|use|precisa|coloque|pegue|usando)/i.test(l));
      for (const l of linhas) problemas.push(`${guia}: ${l.trim()}`);
    }

    expect(problemas, `pedido de service_role em:\n${problemas.join("\n")}`).toEqual([]);
  });
});
