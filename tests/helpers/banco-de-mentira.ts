/**
 * UM POSTGRES DE MENTIRA, só o suficiente pra provar que a ponte não vaza.
 *
 * POR QUE ISSO EXISTE
 * -------------------
 * Os testes de segurança da impersonação precisam responder a uma pergunta que
 * nenhum teste de unidade comum responde: **um trabalho do workspace A
 * consegue ler ou escrever dado do workspace B?**
 *
 * Um banco de verdade responderia — mas aí o teste dependeria de ter Supabase
 * ligado, e um teste que às vezes não roda é um teste que ninguém confia.
 *
 * Então este arquivo imita as três coisas do Postgres de que a resposta
 * depende:
 *
 *  1. **o papel da sessão** (`set role authenticated`). Consulta feita como
 *     `postgres` PULARIA a regra de segurança do banco, porque `postgres` é
 *     dono das tabelas e o template não usa `FORCE ROW LEVEL SECURITY`. Aqui,
 *     consulta fora do papel `authenticated` ESTOURA — assim o teste consegue
 *     ver a diferença.
 *  2. **as configurações locais da transação** (`set_config(..., true)`). Sem
 *     `BEGIN`, nada de `request.jwt.claims`; sem `request.jwt.claims`, não
 *     existe `auth.uid()` e a resposta é ZERO linha.
 *  3. **a regra de segurança em si**: só enxerga (e só grava) linha de
 *     workspace do qual o `sub` da vez é membro.
 *
 * ⚠️ Isto NÃO substitui a regra de segurança de verdade — ela está no banco e
 * é testada em SQL. O que este arquivo prova é o pedaço que é NOSSO: que a
 * ponte sempre entra com o papel certo, sempre dentro de transação, sempre com
 * a identidade que veio da FILA, e que essa identidade nunca sobra pro próximo
 * trabalho.
 */

export type LinhaDeMentira = Record<string, unknown>;

export type TabelasDeMentira = {
  memberships: LinhaDeMentira[];
  organizations: LinhaDeMentira[];
  documents: LinhaDeMentira[];
};

/** Uma consulta como o `pg` recebe. */
export type ConsultaGravada = {
  text: string;
  values: unknown[];
  /** O papel da sessão no momento em que ela rodou. */
  papel: string;
  /** Estava dentro de uma transação aberta? */
  dentroDeTransacao: boolean;
  /** O `sub` que valia naquele instante, ou null. */
  sub: string | null;
  /** Qual conexão rodou. Serve pra provar que duas não se misturam. */
  clienteId: number;
};

/** Erro no formato que o `pg` entrega (com `code`). */
class ErroDeMentira extends Error {
  readonly code: string;
  constructor(code: string, message: string) {
    super(message);
    this.code = code;
  }
}

const RE_SELECT = /from public\."([a-z_]+)"/;
const RE_INSERT = /insert into public\."([a-z_]+)" \(([^)]*)\) values/;
const RE_FILTRO_EQ = /"([a-z_]+)" = \$(\d+)/g;

export class ClienteDeMentira {
  papel = "postgres";
  emTransacao = false;
  /** As configurações com `is_local = true` da transação da vez. */
  local: Record<string, string> = {};
  destruido = false;
  devolvido = false;

  constructor(
    readonly id: number,
    private readonly tabelas: TabelasDeMentira,
    private readonly gravadas: ConsultaGravada[],
  ) {}

  private get sub(): string | null {
    const bruto = this.local["request.jwt.claims"];
    if (!bruto) return null;
    try {
      const claims = JSON.parse(bruto) as { sub?: unknown };
      return typeof claims.sub === "string" ? claims.sub : null;
    } catch {
      return null;
    }
  }

  /**
   * O papel que VALE agora.
   *
   * `set_config('role', ..., true)` dentro da transação ganha do papel da
   * sessão — é assim no Postgres de verdade, e é a segunda camada da ponte.
   */
  private papelEfetivo(): string {
    return this.local.role ?? this.papel;
  }

  /** Os workspaces de que o `sub` da vez é membro. É a "regra de segurança". */
  private workspacesPermitidos(): string[] {
    const sub = this.sub;
    if (!sub) return [];
    return this.tabelas.memberships
      .filter((m) => m.user_id === sub)
      .map((m) => String(m.organization_id));
  }

  async query<T = LinhaDeMentira>(
    arg: string | { text: string; values?: unknown[] },
  ): Promise<{ rows: T[] }> {
    const text = typeof arg === "string" ? arg : arg.text;
    const values = (typeof arg === "string" ? [] : (arg.values ?? [])) as unknown[];

    this.gravadas.push({
      text,
      values,
      papel: this.papelEfetivo(),
      dentroDeTransacao: this.emTransacao,
      sub: this.sub,
      clienteId: this.id,
    });

    const normal = text.trim().toLowerCase();

    if (normal === "set role authenticated") {
      this.papel = "authenticated";
      return { rows: [] as T[] };
    }

    if (normal === "begin") {
      this.emTransacao = true;
      this.local = {};
      return { rows: [] as T[] };
    }

    if (normal === "commit" || normal === "rollback") {
      this.emTransacao = false;
      // ⚠️ ESTA LINHA É O PONTO. `set_config(..., true)` é LOCAL: no fim da
      // transação ele some. Se algum dia a ponte passar `false`, o teste de
      // "a identidade não sobra pro próximo trabalho" quebra aqui.
      this.local = {};
      return { rows: [] as T[] };
    }

    if (normal === "select current_user as quem") {
      return { rows: [{ quem: this.papel } as unknown as T] };
    }

    if (text.includes("set_config(")) {
      if (!this.emTransacao) {
        throw new ErroDeMentira("25P01", "set_config local fora de transação");
      }
      const nomes = [...text.matchAll(/set_config\('([a-z_.]+)', \$(\d+), (true|false)\)/g)];
      for (const achado of nomes) {
        const chave = achado[1];
        const indice = Number(achado[2]);
        const local = achado[3];
        if (local !== "true") {
          throw new ErroDeMentira(
            "PONTE01",
            `set_config('${chave}') com is_local = ${local}: a identidade vazaria pro próximo trabalho`,
          );
        }
        if (chave) this.local[chave] = String(values[indice - 1] ?? "");
      }
      return { rows: [] as T[] };
    }

    return { rows: this.rodarConsultaDeDados(text, values) as T[] };
  }

  private rodarConsultaDeDados(text: string, values: unknown[]): LinhaDeMentira[] {
    // 1) Papel errado = consulta que pularia a regra de segurança.
    if (this.papelEfetivo() !== "authenticated") {
      throw new ErroDeMentira(
        "PONTE02",
        `consulta rodando como "${this.papelEfetivo()}": a regra de segurança do banco não valeria`,
      );
    }
    // 2) Fora de transação não existe identidade, e sem identidade não existe
    //    `auth.uid()`. Falha FECHADA: zero linha, nunca "tudo".
    if (!this.emTransacao) {
      throw new ErroDeMentira("25P01", "consulta fora de transação");
    }

    const permitidos = this.workspacesPermitidos();

    const insercao = text.match(RE_INSERT);
    if (insercao) {
      const tabela = insercao[1] as keyof TabelasDeMentira;
      const colunas = (insercao[2] ?? "").split(",").map((c) => c.trim().replace(/"/g, ""));
      const linha: LinhaDeMentira = {};
      colunas.forEach((coluna, i) => {
        linha[coluna] = values[i];
      });
      if (!permitidos.includes(String(linha.organization_id))) {
        // É EXATAMENTE o que o Postgres devolve quando a regra de segurança
        // recusa a gravação.
        throw new ErroDeMentira(
          "42501",
          `new row violates row-level security policy for table "${String(tabela)}"`,
        );
      }
      const destino = this.tabelas[tabela];
      if (!destino) throw new ErroDeMentira("42P01", `tabela ${String(tabela)} não existe`);
      destino.push(linha);
      return [{ corpo: JSON.stringify([linha]) }];
    }

    const leitura = text.match(RE_SELECT);
    if (!leitura) return [];
    const tabela = leitura[1] as keyof TabelasDeMentira;
    const origem = this.tabelas[tabela];
    if (!origem) throw new ErroDeMentira("42P01", `tabela ${String(tabela)} não existe`);

    // A regra de segurança primeiro, os filtros da consulta depois. É a ordem
    // do banco de verdade, e é a que importa: um filtro esperto não consegue
    // ver o que a regra já tirou da mesa.
    let linhas = origem.filter((l) => permitidos.includes(String(l.organization_id)));

    for (const filtro of text.matchAll(RE_FILTRO_EQ)) {
      const coluna = filtro[1];
      const indice = Number(filtro[2]);
      const esperado = values[indice - 1];
      if (coluna) linhas = linhas.filter((l) => String(l[coluna]) === String(esperado));
    }

    if (text.includes("count(*)")) {
      return [{ total: String(linhas.length) }];
    }
    return [{ corpo: JSON.stringify(linhas) }];
  }

  release(destruir?: boolean): void {
    this.devolvido = true;
    this.destruido = destruir === true;
  }
}

/**
 * O conjunto de conexões de mentira.
 *
 * `trocaDePapelLigada: false` imita o caso em que o `set role authenticated`
 * do `connect` FALHOU — é assim que o teste prova que a ponte se recusa a usar
 * uma conexão que ainda seria `postgres`.
 */
export class PoolDeMentira {
  readonly consultas: ConsultaGravada[] = [];
  readonly clientes: ClienteDeMentira[] = [];

  constructor(
    readonly tabelas: TabelasDeMentira,
    private readonly trocaDePapelLigada = true,
  ) {}

  async connect(): Promise<ClienteDeMentira> {
    const cliente = new ClienteDeMentira(this.clientes.length, this.tabelas, this.consultas);
    this.clientes.push(cliente);
    if (this.trocaDePapelLigada) await cliente.query("set role authenticated");
    return cliente;
  }

  /** Só as consultas de dado (sem `begin`, `commit` e afins). */
  consultasDeDados(): ConsultaGravada[] {
    return this.consultas.filter(
      (c) =>
        !["begin", "commit", "rollback", "set role authenticated"].includes(
          c.text.trim().toLowerCase(),
        ) &&
        !c.text.includes("set_config(") &&
        !c.text.includes("current_user"),
    );
  }
}

/** Duas organizações, duas pessoas, dois documentos. O cenário de todo teste. */
export const WORKSPACE_A = "11111111-1111-4111-8111-111111111111";
export const WORKSPACE_B = "22222222-2222-4222-8222-222222222222";
export const PESSOA_A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
export const PESSOA_B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";

export function montarTabelas(): TabelasDeMentira {
  return {
    memberships: [
      { id: "m-a", organization_id: WORKSPACE_A, user_id: PESSOA_A, role: "admin" },
      { id: "m-b", organization_id: WORKSPACE_B, user_id: PESSOA_B, role: "owner" },
    ],
    organizations: [
      { id: WORKSPACE_A, slug: "workspace-a", name: "Workspace A" },
      { id: WORKSPACE_B, slug: "workspace-b", name: "Workspace B" },
    ],
    documents: [
      { id: "t-a", organization_id: WORKSPACE_A, title: "documento do A", status: "pending" },
      { id: "t-b", organization_id: WORKSPACE_B, title: "documento do B", status: "pending" },
    ],
  };
}
