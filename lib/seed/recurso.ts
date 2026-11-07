/**
 * ┌───────────────────────────────────────────────────────────────────────────┐
 * │  O MOLDE DE TODA COISA QUE NASCE DE ARQUIVO.                              │
 * └───────────────────────────────────────────────────────────────────────────┘
 *
 * Este arquivo tem UM algoritmo, escrito UMA vez: "leia o que já existe neste
 * workspace, grave o que falta, atualize o que mudou, não encoste no resto".
 * Agente, base de conhecimento, agendamento e webhook usam todos ele — e o
 * quinto tipo que você inventar também vai.
 *
 * ⚠️ POR QUE ISTO EXISTE, E POR QUE NÃO É "abstração pela abstração".
 * Antes daqui, esse algoritmo estava COPIADO quatro vezes em
 * `materializar.ts`, uma cópia por tipo, ~120 linhas cada. As cópias eram
 * quase iguais — e "quase" é o problema: os dois defeitos que este mecanismo
 * já produziu foram os DOIS da mesma família, "uma cópia divergiu das
 * outras":
 *
 *   • a base de conhecimento não gravava `created_by`, e a policy de INSERT
 *     exigia — nenhuma base declarada em código conseguia nascer, em
 *     ambiente nenhum, e a suíte inteira ficava verde porque o dublê de
 *     teste não tem regra de segurança;
 *   • o agente quase não teve `status` na lista de colunas do arquivo, e a
 *     tela prometia `status: "archived"` como o único jeito de aposentar um
 *     agente — a promessa teria sido letra morta.
 *
 * Nenhum dos dois é erro de digitação: são erros de OMISSÃO, e omissão não
 * aparece em revisão de diff (o que não foi escrito não fica destacado em
 * verde). O jeito de matar essa família não é revisar melhor — é não ter
 * quatro lugares onde a omissão cabe.
 *
 * ⚠️ O QUE MORA AQUI É O QUE JÁ MORDEU. Cada guarda abaixo tem cicatriz:
 *   • `organization_id` em TODA leitura e TODA escrita (regra 1 do
 *     CLAUDE.md). Escrito uma vez, aqui — esquecer numa cópia era vazar dado
 *     de um workspace pro outro;
 *   • `.select("id")` depois de todo `update`, porque UPDATE sem SELECT
 *     MENTE: "atualizei 1 linha" e "nenhuma linha bateu no `using` da
 *     policy" chegam idênticos, sem erro nenhum;
 *   • a comparação antes de escrever, pra não disparar UPDATE por diferença
 *     que não existe (o gatilho `set_updated_at` carimba toda escrita, e as
 *     telas ordenam por `updated_at` — UPDATE à toa reordena a tela do
 *     aluno sozinho);
 *   • o `catch` que distingue "a regra de segurança recusou" de "deu ruim
 *     de verdade", porque um deles é pra pular e relatar, e o outro é pra
 *     parar.
 *
 * 🔴 ESTE ARQUIVO FALA COM O BANCO PELA PONTE. `npm run semear` chama esta
 * função com um cliente impersonado, cujo `fetch` é
 * `lib/automation/postgrest-bridge.ts` — não a API de verdade do Supabase. A
 * ponte só entende um SUBCONJUNTO do PostgREST (regra 10-G). Aqui a gente só
 * usa `.select()`, `.insert()`, `.update()`, `.eq()` e `.in()`, todos dentro
 * do que a ponte serve. O sintoma de errar: funciona ao criar o workspace
 * (sessão normal) e quebra no `npm run semear` (sessão pela ponte).
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { logError } from "@/lib/logger";
import type { Database, TablesInsert, TablesUpdate } from "@/types/supabase";

/**
 * As tabelas que nascem de arquivo. Acrescentar um tipo novo de coisa
 * declarada é acrescentar o nome dela aqui — e o TypeScript passa a exigir
 * que `colunas` e `paraInserir` do seu recurso batam com essa tabela.
 */
export type TabelaDeclarada = "agents" | "knowledge_bases" | "schedules" | "webhook_endpoints";

/** O mínimo que toda linha materializada tem: quem ela é, e por qual apelido. */
export type LinhaExistente = { id: string; slug: string | null } & Record<string, unknown>;

/**
 * A DECLARAÇÃO de um tipo de coisa que nasce de arquivo.
 *
 * `Bp` é a "planta" (o objeto que o aluno escreve em `registro.ts`); `T` é a
 * tabela. Os dois amarrados fazem o TypeScript conferir, no lugar onde você
 * declara o recurso, que:
 *   • toda coluna de `colunas` existe mesmo naquela tabela;
 *   • `paraInserir` devolve uma linha válida daquela tabela.
 * Errar qualquer um dos dois vira erro de compilação com o nome que falta —
 * não dado torto no banco.
 */
export type Recurso<Bp, T extends TabelaDeclarada> = {
  /** A tabela onde as linhas moram. */
  tabela: T;
  /**
   * Como o aluno chama isso, no plural e com artigo: "os agentes", "as bases
   * de conhecimento". Entra nas mensagens de erro e no registro (log).
   */
  descricao: string;
  /**
   * O que o aluno lê quando dá errado. PT-BR, sem jargão, e quando houver uma
   * saída conhecida (o modelo de embedding congelado, por exemplo), diga a
   * saída aqui — é a única frase que ele vai ver.
   *
   * São DUAS porque nascer e atualizar falham por motivos diferentes, e a
   * frase que ajuda é diferente também. Podem ser iguais quando a saída for a
   * mesma nos dois casos (é o que a base de conhecimento faz).
   */
  mensagemAoGravar: string;
  mensagemAoAtualizar: string;
  /**
   * FONTE ÚNICA das colunas de que o ARQUIVO é dono. Monta o `select(...)` da
   * leitura E o `update(...)` da atualização, então uma coluna que entre aqui
   * passa a ser lida, comparada e reescrita — as três — sem chance de as três
   * discordarem.
   *
   * O que NÃO entra: coluna da PESSOA (`is_active`, `modo`, `run_as` — quem
   * decide é quem opera, na tela) e coluna do BANCO (`created_by`,
   * `organization_id`, `slug` — identidade, nunca reescrita).
   */
  colunas: readonly (keyof TablesUpdate<T> & string)[];
  /**
   * Colunas que a leitura precisa trazer mas que o arquivo NUNCA reescreve.
   * Serve pra decidir coisa antes de escrever — hoje só `run_as`, pra prever
   * que a regra de segurança vai recusar.
   */
  colunasSoDeLeitura?: readonly string[];
  /**
   * As colunas que o ARQUIVO declara e que são gravadas SÓ AO NASCER — nunca
   * reescritas. Hoje só o webhook tem (ele é `soInsere`): `label`, `agent_id`
   * e `esperar_resposta` vêm da declaração, mas mudar qualquer uma no arquivo
   * NÃO chega num webhook que já existe. Está aqui pra essa assimetria ficar
   * escrita onde alguém tropeça nela, não escondida no comportamento.
   */
  colunasSoAoNascer?: readonly string[];
  /**
   * As colunas que o INSERT escreve e o ARQUIVO NUNCA reescreve — identidade e
   * autoria: `organization_id`, `created_by`, `slug`, e o que for congelado
   * por gatilho (`embedding_model` na base, `token_hash` no webhook).
   */
  colunasDoBanco: readonly string[];
  /**
   * As colunas que o INSERT escreve e, DEPOIS DISSO, quem opera é dono:
   * `is_active`, `run_as`. Reescrever qualquer uma numa re-materialização
   * desfaria decisão de gente, calado.
   *
   * ⚠️ `modo` NÃO entra aqui, e a ausência é o desenho: o INSERT não escreve
   * essa coluna nenhuma vez. Automação nasce em `'ensaio'` por PADRÃO DO
   * BANCO (regra 10-L), e quem liga o modo real é uma pessoa, numa tela que
   * diz o que vai passar a acontecer. Estas listas classificam o que o INSERT
   * escreve — o que ele nunca escreve não precisa (nem pode) ser classificado.
   */
  colunasDaPessoa: readonly string[];
  /** O apelido da planta. É a chave da materialização, e é pra sempre. */
  apelido: (bp: Bp) => string;
  /** Monta a linha completa de INSERT a partir da planta. */
  paraInserir: (bp: Bp) => TablesInsert<T>;
  /**
   * `true` = nasce e nunca mais é reescrito. Só o webhook: o token é sorteado
   * a cada chamada, e reescrever trocaria o segredo de um endereço que
   * sistemas de fora já estão chamando — todo mundo tomaria 401 por causa de
   * um `npm run semear` de rotina.
   */
  soInsere?: boolean;
  /**
   * Olhando a linha que já está gravada: a regra de segurança do banco vai
   * recusar este UPDATE? Prever é melhor que tentar e classificar o erro pelo
   * texto. Hoje só o agendamento usa (quando ele roda no nome de outra
   * pessoa).
   */
  vaiSerRecusado?: (atual: LinhaExistente) => boolean;
  /**
   * A regra de segurança recusou: pular esta linha e relatar (`true`), ou
   * derrubar a materialização inteira (`false`, o padrão)?
   *
   * `true` é pra coisa que pode legitimamente pertencer a outra pessoa — o
   * agendamento que roda no nome dela. Pular é o certo ali: a linha continua
   * viva, só não em dia, e quem chamou recebe a lista pra avisar.
   */
  pularQuandoRecusado?: boolean;
};

/**
 * 🔴 A GUARDA CONTRA A CLASSE DE DEFEITO QUE JÁ MORDEU DUAS VEZES.
 *
 * Toda coluna que o INSERT escreve tem que estar classificada em UMA das três
 * listas — do arquivo, do banco, ou da pessoa. Não existe quarta gaveta, e não
 * existe "esqueci de classificar": esta função devolve o que sobrou, e o teste
 * (`tests/seed-recurso.test.ts`) reprova com o NOME da coluna solta.
 *
 * Por que isso importa mais do que parece: os dois defeitos conhecidos deste
 * mecanismo foram OMISSÕES — uma coluna que ninguém lembrou de pôr numa lista.
 * Omissão não aparece em revisão de diff, porque o que não foi escrito não fica
 * destacado em verde. Aqui ela vira erro com nome próprio, no `npm run verify`,
 * antes de qualquer coisa chegar no banco.
 *
 * Devolve duas listas: o que o INSERT escreve e ninguém classificou, e o que
 * foi classificado mas o INSERT não escreve (classificação que envelheceu).
 */
export function colunasNaoClassificadas<Bp, T extends TabelaDeclarada>(
  recurso: Recurso<Bp, T>,
  exemplo: Bp,
): { soltas: string[]; classificadasAtoa: string[] } {
  const escritas = new Set(Object.keys(recurso.paraInserir(exemplo) as Record<string, unknown>));
  const classificadas = new Set<string>([
    ...recurso.colunas,
    ...(recurso.colunasSoAoNascer ?? []),
    ...recurso.colunasDoBanco,
    ...recurso.colunasDaPessoa,
  ]);
  return {
    soltas: [...escritas].filter((c) => !classificadas.has(c)).sort(),
    classificadasAtoa: [...classificadas].filter((c) => !escritas.has(c)).sort(),
  };
}

/** O que uma materialização de um tipo devolve. */
export type ResultadoDoRecurso = {
  /**
   * Quantas coisas declaradas estão presentes e em dia neste workspace —
   * as que nasceram agora mais as que já estavam lá. NÃO é "quantas linhas o
   * banco escreveu": uma coisa que não mudou conta, porque ela está lá e está
   * em dia. Pulada não conta.
   */
  tocados: number;
  /** Apelidos que existiam, mudaram no arquivo, e o UPDATE não foi confirmado. */
  pulados: string[];
  /** `id` de cada apelido presente — quem depende de outro recurso usa isto. */
  idPorApelido: Map<string, string>;
};

/**
 * `JSON.stringify` com as chaves de objeto (não de array) ORDENADAS, só pra
 * comparar. Sem isso, duas representações da MESMA `input` de agendamento
 * (uma vinda do arquivo, outra devolvida pelo banco) podiam bater diferente
 * só por causa da ordem das chaves — e a gente dispararia um UPDATE por um
 * "erro" que não existe. Ordem de ARRAY continua importando (é diferença de
 * verdade, não artefato de serialização).
 *
 * ⚠️ `JSON.stringify(undefined)` devolve o valor `undefined` (não a string
 * `"undefined"`), enquanto `JSON.stringify(null)` devolve `"null"` — os dois
 * NUNCA batem. `algoMudou` normaliza os dois lados pra `null` antes de
 * comparar, então esta função não precisa (ela só serializa o que recebe).
 */
export function jsonCanonico(valor: unknown): string {
  return JSON.stringify(valor, (_chave, v) => {
    if (v !== null && typeof v === "object" && !Array.isArray(v)) {
      const entradas = Object.entries(v as Record<string, unknown>).sort(([a], [b]) =>
        a < b ? -1 : a > b ? 1 : 0,
      );
      return Object.fromEntries(entradas);
    }
    return v;
  });
}

/**
 * Alguma coluna de que o arquivo é dono, no `patch`, diverge do que já está
 * gravado (`atual`)? `?? null` nos dois lados normaliza `undefined`.
 *
 * Nota de rodapé: `agents.temperature` é `real` (float4) no banco, e a planta
 * carrega um `double` do JS. Valor com 1-2 casas decimais (o caso normal:
 * `0.7`, `1.2`) volta do banco idêntico ao que o arquivo mandou, então a
 * comparação bate. Um valor de precisão maior (`0.123456789`) poderia
 * arredondar na volta e nunca convergir, virando UPDATE eterno só nesse
 * campo. Não é um problema conhecido — é só o tipo de coisa que `float4` pode
 * fazer, registrado aqui pra quem for mexer não precisar redescobrir.
 */
export function algoMudou(atual: Record<string, unknown>, patch: Record<string, unknown>): boolean {
  return Object.entries(patch).some(
    ([chave, valor]) => jsonCanonico(atual[chave] ?? null) !== jsonCanonico(valor ?? null),
  );
}

/**
 * Cinto-e-suspensórios, NÃO o mecanismo principal (quem previne de verdade é
 * `vaiSerRecusado`). Exige `code === "42501"` E o texto de RLS: o SQLSTATE
 * sozinho não distingue "a regra de segurança recusou" de "permissão de
 * coluna negada" (os dois são `42501`), e o texto sozinho classificava
 * condições diferentes como uma coisa só.
 */
export function ehViolacaoDeRls(
  error: { message?: string; code?: string } | null | undefined,
): boolean {
  if (!error) return false;
  return (
    error.code === "42501" &&
    typeof error.message === "string" &&
    error.message.includes("row-level security policy")
  );
}

/**
 * Recorta, da linha completa de INSERT, só as colunas de que o arquivo é
 * dono — e devolve o `patch` do UPDATE.
 *
 * 🔴 ESTA FUNÇÃO SUBSTITUI QUATRO RECORTES ESCRITOS NA MÃO, e é por isso que
 * ela existe. Antes, cada tipo tinha um `paraAtualizarX` que listava os
 * campos de novo, um por um, num literal — uma SEGUNDA lista, que precisava
 * concordar com `colunas` e com o `select` e com o banco, sem nada conferindo
 * que concordava. Esquecer um campo ali não quebrava o `tsc` nem a suíte:
 * o campo simplesmente parava de ser atualizado, em silêncio, pra sempre.
 * Agora existe uma lista só, e o recorte sai dela.
 */
export function patchDaLinha<T extends TabelaDeclarada, C extends keyof TablesUpdate<T> & string>(
  linha: TablesInsert<T>,
  colunas: readonly C[],
): Pick<TablesUpdate<T>, C> {
  const patch: Record<string, unknown> = {};
  const origem = linha as Record<string, unknown>;
  for (const coluna of colunas) patch[coluna] = origem[coluna];
  return patch as Pick<TablesUpdate<T>, C>;
}

/**
 * O cliente do banco, visto pelo que ESTE arquivo usa dele.
 *
 * `db.from()` tipado com uma tabela variável (`T extends TabelaDeclarada`, não
 * um literal) faz o supabase-js devolver uma UNIÃO de construtores de
 * consulta, e aí `.insert()` passa a exigir a interseção dos tipos de linha
 * das quatro tabelas — que é vazia. Este apelido de tipo é a única conversão
 * do arquivo, e ela é estreita de propósito: descreve só os cinco métodos que
 * a ponte serve, com a linha já no formato que o recurso declarou.
 *
 * O que a conversão NÃO enfraquece: `colunas` e `paraInserir` continuam
 * conferidos contra a tabela de verdade, no lugar onde o recurso é declarado
 * (é pra isso que `Recurso<Bp, T>` é genérico). O que pode escapar daqui é um
 * erro de digitação no nome de uma coluna dentro DESTE arquivo — e as colunas
 * que este arquivo escreve na mão são duas, `organization_id` e `slug`,
 * ambas cobertas por teste.
 */
type ConsultaDoRecurso = {
  select: (colunas: string) => ConsultaDoRecurso;
  insert: (linhas: Record<string, unknown>[]) => ConsultaDoRecurso;
  update: (patch: Record<string, unknown>) => ConsultaDoRecurso;
  eq: (coluna: string, valor: string) => ConsultaDoRecurso;
  in: (coluna: string, valores: string[]) => ConsultaDoRecurso;
  then: Promise<{
    data: LinhaExistente[] | null;
    error: { message?: string; code?: string } | null;
  }>["then"];
};

type ClienteDoRecurso = { from: (tabela: TabelaDeclarada) => ConsultaDoRecurso };

/**
 * Leva as plantas de UM tipo pra dentro de UM workspace.
 *
 * O contrato, em quatro frases: o que falta nasce; o que existe e mudou é
 * atualizado; o que existe e não mudou não é tocado; e nada que não esteja
 * declarado no arquivo é encostado, nunca — inclusive linha órfã (apelido que
 * saiu do arquivo) e linha que alguém criou por fora.
 *
 * ⚠️ RODAR DUAS VEZES É O CASO NORMAL, não a exceção: um workspace novo
 * materializa ao nascer, e todo deploy roda `npm run semear` por cima de todo
 * workspace que já existe.
 */
export async function materializarRecurso<Bp, T extends TabelaDeclarada>(
  db: SupabaseClient<Database>,
  organizationId: string,
  recurso: Recurso<Bp, T>,
  plantas: readonly Bp[],
): Promise<ResultadoDoRecurso> {
  const idPorApelido = new Map<string, string>();
  if (plantas.length === 0) return { tocados: 0, pulados: [], idPorApelido };

  const cliente = db as unknown as ClienteDoRecurso;
  const { tabela, colunas } = recurso;
  const apelidos = plantas.map((bp) => recurso.apelido(bp));

  // ---- 1. o que já existe neste workspace ---------------------------------
  const colunasDaLeitura = ["id", "slug", ...colunas, ...(recurso.colunasSoDeLeitura ?? [])];
  const leitura = await cliente
    .from(tabela)
    .select(colunasDaLeitura.join(", "))
    .eq("organization_id", organizationId)
    .in("slug", apelidos);

  if (leitura.error) {
    logError(`seed.${tabela}.leitura`, leitura.error);
    throw new Error(`não deu pra conferir ${recurso.descricao} já existentes deste workspace`);
  }

  const existentes = new Map<string, LinhaExistente>();
  for (const linha of leitura.data ?? []) {
    if (linha.slug !== null) {
      existentes.set(linha.slug, linha);
      idPorApelido.set(linha.slug, linha.id);
    }
  }

  const faltando = plantas.filter((bp) => !existentes.has(recurso.apelido(bp)));
  const presentes = plantas.filter((bp) => existentes.has(recurso.apelido(bp)));

  // ---- 2. o que falta nasce -----------------------------------------------
  if (faltando.length > 0) {
    const gravacao = await cliente
      .from(tabela)
      .insert(faltando.map((bp) => recurso.paraInserir(bp) as Record<string, unknown>))
      .select("id, slug");

    if (gravacao.error) {
      logError(`seed.${tabela}`, gravacao.error);
      throw new Error(recurso.mensagemAoGravar);
    }
    for (const linha of gravacao.data ?? []) {
      if (linha.slug !== null) idPorApelido.set(linha.slug, linha.id);
    }
  }

  // ---- 3. o que existe e mudou é atualizado -------------------------------
  const pulados: string[] = [];

  if (!recurso.soInsere) {
    for (const bp of presentes) {
      const apelido = recurso.apelido(bp);
      const atual = existentes.get(apelido);
      if (!atual) continue;

      const patch = patchDaLinha<T, (typeof colunas)[number]>(recurso.paraInserir(bp), colunas);
      if (!algoMudou(atual, patch)) continue;

      // Prever é melhor que tentar: se a regra de segurança do banco já vai
      // recusar (o agendamento roda no nome de outra pessoa), nem tenta.
      if (recurso.vaiSerRecusado?.(atual)) {
        pulados.push(apelido);
        continue;
      }

      // `.select("id")` NÃO é enfeite: sem pedir de volta, "atualizei 1
      // linha" e "nenhuma linha bateu no `using` da policy" são
      // indistinguíveis — os dois chegam sem erro nenhum.
      const escrita = await cliente
        .from(tabela)
        .update(patch as Record<string, unknown>)
        .eq("organization_id", organizationId)
        .eq("slug", apelido)
        .select("id");

      if (escrita.error) {
        if (recurso.pularQuandoRecusado && ehViolacaoDeRls(escrita.error)) {
          pulados.push(apelido);
          continue;
        }
        logError(`seed.${tabela}`, escrita.error);
        throw new Error(recurso.mensagemAoAtualizar);
      }

      if (escrita.data?.length !== 1) {
        // A regra de segurança bloqueou sem devolver erro: zero linhas
        // bateram no `using` da policy.
        if (recurso.pularQuandoRecusado) {
          pulados.push(apelido);
          continue;
        }
        logError(
          `seed.${tabela}`,
          new Error(`update não bateu em nenhuma linha para o apelido "${apelido}"`),
        );
        throw new Error(recurso.mensagemAoAtualizar);
      }
    }
  }

  return {
    tocados: faltando.length + presentes.length - pulados.length,
    pulados,
    idPorApelido,
  };
}
