import { describe, expect, it } from "vitest";
import {
  agendamentoParaInsert,
  type ScheduleBlueprint,
  type WebhookBlueprint,
  webhookParaInsert,
} from "@/lib/automation/blueprint";

const AGENDA: ScheduleBlueprint = {
  slug: "resumo-da-manha",
  name: "Resumo da manhã",
  agentSlug: "assistente",
  kind: "daily",
  hour: 9,
  minute: 0,
  timezone: "America/Sao_Paulo",
  input: {},
};

const WEBHOOK: WebhookBlueprint = {
  slug: "entrada-do-site",
  label: "Entrada do site",
  agentSlug: "assistente",
  esperarResposta: false,
};

describe("agendamentoParaInsert", () => {
  it("monta a linha com workspace, agente e responsável presos", () => {
    const linha = agendamentoParaInsert(AGENDA, "org-1", "agente-1", "dono-1");
    expect(linha.organization_id).toBe("org-1");
    expect(linha.agent_id).toBe("agente-1");
    expect(linha.run_as).toBe("dono-1");
    expect(linha.slug).toBe("resumo-da-manha");
  });

  /**
   * 🔴 O ARQUIVO NÃO LIGA AUTOMAÇÃO. Ligar é decisão de gente, numa tela que diz
   * o que vai passar a acontecer (regra 10-L). Se um campo do blueprint pudesse
   * escrever `is_active`, um `git push` passaria a disparar automação sem
   * ninguém olhar — que é exatamente o desfecho que a regra existe pra impedir.
   */
  it("nasce DESLIGADO, e nenhum campo do arquivo consegue mudar isso", () => {
    const linha = agendamentoParaInsert(AGENDA, "org-1", "agente-1", "dono-1");
    expect(linha.is_active).toBe(false);
  });

  /**
   * O modo (`ensaio` / `real`) não aparece na linha montada aqui: quem decide é
   * o padrão do banco, que é `'ensaio'` (regra 10-L). Escrever a coluna daqui,
   * mesmo com o valor certo, abriria a porta pra alguém trocar o valor um dia.
   */
  it("não escreve o modo — o padrão do banco é quem manda", () => {
    const linha = agendamentoParaInsert(AGENDA, "org-1", "agente-1", "dono-1") as Record<
      string,
      unknown
    >;
    expect(Object.keys(linha)).not.toContain("modo");
  });

  it("recusa hora e minuto fora da faixa", () => {
    expect(() => agendamentoParaInsert({ ...AGENDA, hour: 24 }, "o", "a", "d")).toThrow(/hora/i);
    expect(() => agendamentoParaInsert({ ...AGENDA, minute: 60 }, "o", "a", "d")).toThrow(
      /minuto/i,
    );
  });

  it("exige os campos que o tipo de agendamento pede", () => {
    expect(() =>
      agendamentoParaInsert({ ...AGENDA, kind: "weekly", weekdays: undefined }, "o", "a", "d"),
    ).toThrow(/dias da semana/i);
    expect(() =>
      agendamentoParaInsert(
        { ...AGENDA, kind: "interval", everyMinutes: undefined },
        "o",
        "a",
        "d",
      ),
    ).toThrow(/intervalo/i);
  });

  /** 0 = domingo e 6 = sábado; trocar isso quebra `next_schedule_run`. */
  it("recusa dia da semana fora de 0 a 6", () => {
    expect(() =>
      agendamentoParaInsert({ ...AGENDA, kind: "weekly", weekdays: [7] }, "o", "a", "d"),
    ).toThrow(/dias da semana/i);
  });

  /**
   * `schedules_weekdays_range` no banco exige `array_length(weekdays, 1)
   * between 1 and 7`. Uma lista com repetição (todo item ainda 0–6) passaria
   * pelo `.every(...)` sem esse teto de tamanho.
   */
  it("recusa mais de 7 dias da semana, mesmo com valores repetidos e válidos", () => {
    expect(() =>
      agendamentoParaInsert(
        { ...AGENDA, kind: "weekly", weekdays: [0, 0, 0, 0, 0, 0, 0, 0] },
        "o",
        "a",
        "d",
      ),
    ).toThrow(/dias da semana/i);
    expect(() =>
      agendamentoParaInsert(
        { ...AGENDA, kind: "weekly", weekdays: [0, 1, 2, 3, 4, 5, 6] },
        "o",
        "a",
        "d",
      ),
    ).not.toThrow();
  });

  /**
   * 🔴 CRÍTICO da revisão: `schedules_day_of_month_range` no banco vai só até
   * 28 — NÃO 31. 28 é o maior dia que existe em TODO mês, fevereiro incluso
   * (mesmo comentário da migration, junto de `next_schedule_run`). Sem esse
   * teto, `dayOfMonth: 31` passava aqui limpo e quebrava só na materialização.
   */
  it("recusa dia do mês acima de 28 (não 31)", () => {
    expect(() =>
      agendamentoParaInsert(
        { ...AGENDA, kind: "monthly", hour: 9, minute: 0, dayOfMonth: 29 },
        "o",
        "a",
        "d",
      ),
    ).toThrow(/dia do mês/i);
    expect(() =>
      agendamentoParaInsert(
        { ...AGENDA, kind: "monthly", hour: 9, minute: 0, dayOfMonth: 28 },
        "o",
        "a",
        "d",
      ),
    ).not.toThrow();
  });

  /**
   * 🔴 CRÍTICO da revisão: `schedules_every_minutes_range` no banco exige
   * `between 5 and 1440` (1440 = um dia inteiro em minutos). O código antigo
   * só conferia `>= 1`, então `everyMinutes: 2` — um pedido plausível — passava
   * aqui e quebrava na materialização.
   */
  it("recusa intervalo fora de 5 a 1440 minutos", () => {
    expect(() =>
      agendamentoParaInsert({ ...AGENDA, kind: "interval", everyMinutes: 4 }, "o", "a", "d"),
    ).toThrow(/intervalo/i);
    expect(() =>
      agendamentoParaInsert({ ...AGENDA, kind: "interval", everyMinutes: 1441 }, "o", "a", "d"),
    ).toThrow(/intervalo/i);
    expect(() =>
      agendamentoParaInsert({ ...AGENDA, kind: "interval", everyMinutes: 5 }, "o", "a", "d"),
    ).not.toThrow();
    expect(() =>
      agendamentoParaInsert({ ...AGENDA, kind: "interval", everyMinutes: 1440 }, "o", "a", "d"),
    ).not.toThrow();
  });

  /**
   * O `input` vira `Json` DE VERDADE (round-trip por `JSON.stringify` +
   * `JSON.parse`), não só o tipo trocado no compilador: `undefined` e função
   * somem, `NaN` vira `null` — o mesmo comportamento que `JSON.stringify`
   * sozinho já teria, só que agora é o VALOR gravado, não um `as` que finge.
   */
  it("converte a entrada pra JSON de verdade — undefined, função e NaN não sobrevivem intactos", () => {
    const linha = agendamentoParaInsert(
      { ...AGENDA, input: { mantem: 1, some: undefined, fn: () => "x", vira_null: Number.NaN } },
      "o",
      "a",
      "d",
    );
    expect(linha.input).toEqual({ mantem: 1, vira_null: null });
  });

  /**
   * Referência circular é o único caso em que `JSON.stringify` lança de
   * verdade. Sem tratamento, isso estourava como `TypeError` cru — a mesma
   * classe de erro que este arquivo existe pra evitar.
   */
  it("recusa entrada com referência circular, com mensagem legível", () => {
    const circular: Record<string, unknown> = {};
    circular.self = circular;
    expect(() => agendamentoParaInsert({ ...AGENDA, input: circular }, "o", "a", "d")).toThrow(
      /não é serializável/i,
    );
  });

  /**
   * 🔴 RODADA DE CONSERTO 1 (Task 9): `entrega` virou CONFIGURAÇÃO do
   * arquivo (era "coluna da pessoa", protegida — ver o comentário de
   * `ScheduleBlueprint.entrega`). Sem declarar, nasce `{ tipo: "nenhuma" }`
   * — o mesmo padrão de `schedules.entrega` no banco
   * (`schedules_entrega_check`, `20260821110000_agente_que_age.sql`).
   *
   * Declarar isso aqui NÃO faz nenhum email sair sozinho: `is_active` nasce
   * `false` (só uma PESSOA liga) e `modo` nasce `'ensaio'` (nesse modo
   * `ctx.acao` não age de verdade) — os dois continuam de fora do arquivo,
   * ver o bloco 🔴 no topo de `lib/automation/blueprint.ts`.
   */
  describe("entrega", () => {
    it("sem declarar, nasce nenhuma", () => {
      const linha = agendamentoParaInsert(AGENDA, "o", "a", "d");
      expect(linha.entrega).toEqual({ tipo: "nenhuma" });
    });

    it("declarada com email, grava exatamente o que foi declarado", () => {
      const linha = agendamentoParaInsert(
        { ...AGENDA, entrega: { tipo: "email", para: ["chefe@empresa.com"] } },
        "o",
        "a",
        "d",
      );
      expect(linha.entrega).toEqual({ tipo: "email", para: ["chefe@empresa.com"] });
    });

    /**
     * `EntregaDeEntrada`, nunca `Entrega`: o `tipo: "conexao"` do schema de
     * LEITURA não é aceito aqui, porque não existe catálogo de conexão pra
     * validar o `slug` contra (guardado pra "a onda das conexões" — ver
     * `lib/automation/entrega.ts`). Um `as` forçando o tipo é o único jeito
     * de tentar declarar isso, e mesmo assim a validação em tempo de
     * execução recusa.
     */
    it("recusa entrega do tipo conexao, mesmo forçando o tipo", () => {
      const comConexao = {
        ...AGENDA,
        entrega: { tipo: "conexao", slug: "https://x.com", caminho: "/y" },
      } as unknown as ScheduleBlueprint;
      expect(() => agendamentoParaInsert(comConexao, "o", "a", "d")).toThrow(/entrega inválida/i);
    });

    it("recusa email sem destinatário, com mensagem legível", () => {
      const semDestinatario = {
        ...AGENDA,
        entrega: { tipo: "email", para: [] },
      } as ScheduleBlueprint;
      expect(() => agendamentoParaInsert(semDestinatario, "o", "a", "d")).toThrow(
        /entrega inválida/i,
      );
    });
  });
});

describe("webhookParaInsert", () => {
  it("monta a linha com o hash de um token que ninguém viu", () => {
    const linha = webhookParaInsert(WEBHOOK, "org-1", "agente-1", "dono-1");
    expect(linha.organization_id).toBe("org-1");
    expect(linha.slug).toBe("entrada-do-site");
    expect(linha.token_hash).toMatch(/^[0-9a-f]{64}$/);
  });

  /**
   * 🔴 O TOKEN NÃO SAI DAQUI, e é isso que torna seguro declarar webhook em
   * arquivo versionado. O endpoint nasce inutilizável de propósito: quem
   * precisa do endereço aperta "gerar token" na tela, que sorteia outro e
   * mostra uma vez. A URL não muda, porque ela vem do `id`.
   */
  it("não devolve o token em lugar nenhum da linha", () => {
    const linha = webhookParaInsert(WEBHOOK, "org-1", "agente-1", "dono-1");
    expect(Object.keys(linha)).not.toContain("token");
    /* `token_prefix` é público POR DESENHO — é como a tela mostra de qual token
       se trata — e por isso ele começa com o mesmo prefixo do token. O que não
       pode escapar é o token inteiro, e o teto de 16 caracteres da constraint
       `webhook_endpoints_token_prefix_len` é o que garante que o apelido não
       vira o segredo. */
    expect(linha.token_prefix!.length).toBeLessThanOrEqual(16);
  });

  it("sorteia um token diferente a cada chamada", () => {
    const a = webhookParaInsert(WEBHOOK, "org-1", "agente-1", "dono-1");
    const b = webhookParaInsert(WEBHOOK, "org-1", "agente-1", "dono-1");
    expect(a.token_hash).not.toBe(b.token_hash);
  });

  it("carrega o esperar_resposta declarado no arquivo", () => {
    expect(webhookParaInsert(WEBHOOK, "o", "a", "d").esperar_resposta).toBe(false);
    expect(
      webhookParaInsert({ ...WEBHOOK, esperarResposta: true }, "o", "a", "d").esperar_resposta,
    ).toBe(true);
  });

  /**
   * 🔴 MUDOU DE `false` PRA `true` na Task 8, rodada 2 — e não é regressão na
   * regra 10-L.
   *
   * A versão original deste teste (Task 4) exigia `is_active: false`, pelo
   * mesmo raciocínio do agendamento: ligar é decisão de gente. Só que o
   * agendamento TEM uma tela que liga/desliga (`ligarDesligarAgendamentoAction`)
   * — o webhook NÃO TEM NENHUMA. Exigir `false` aqui faria todo webhook
   * declarado em arquivo nascer inalcançável PRA SEMPRE: nenhuma tela, nenhuma
   * function, nada no produto liga essa coluna de volta pra webhook.
   *
   * O webhook não precisa dessa trava porque já nasce inutilizável de outro
   * jeito: o token é sorteado e descartado (ninguém vê), e `modo` nasce
   * `'ensaio'` (padrão do banco, teste abaixo). Duas travas de verdade. A
   * regra 10-L continua de pé: o ato humano que ARMA o endereço é "gerar
   * token" na tela, e o que faz ele AGIR DE VERDADE é o modo real — os dois
   * continuam decisão de gente. Ver `lib/automation/blueprint.ts`,
   * `webhookParaInsert`, e `lib/automation/CLAUDE.md`, regra 15.
   */
  it("nasce LIGADO (token+modo já travam), e o modo não é escrito — o padrão do banco é quem manda", () => {
    const linha = webhookParaInsert(WEBHOOK, "org-1", "agente-1", "dono-1") as Record<
      string,
      unknown
    >;
    expect(linha.is_active).toBe(true);
    expect(Object.keys(linha)).not.toContain("modo");
  });
});
