/**
 * "O QUE FALTA PRA ISSO FUNCIONAR" — a lista de degraus do Início.
 *
 * POR QUE ESTE ARQUIVO EXISTE
 * --------------------------
 * O Início era um gráfico inventado. Um aluno que acabava de subir o template
 * caía nele, via a linha subindo, e ia embora achando que estava tudo pronto —
 * **sem ninguém ter contado que faltava cadastrar uma chave de IA**. O erro só
 * aparecia muito depois, na primeira conversa, numa mensagem do provedor em
 * inglês.
 *
 * O caso mais escorregadio está no `describe` de papel: um degrau que a pessoa
 * NÃO PODE cumprir não pode virar botão. Chave e teto são de dono/admin, e as
 * telas deles são `requireOrgRole` — um botão ali levaria o membro pra uma tela
 * que o chuta de volta pro Início, num laço que parece defeito do app.
 */
import { describe, expect, it } from "vitest";
import { type EstadoDoWorkspace, montarProximosPassos, temPendencia } from "@/lib/dashboard/passos";

/** Um workspace recém-criado, do jeito que o aluno encontra no primeiro login. */
const ZERADO: EstadoDoWorkspace = {
  orgSlug: "acme",
  administra: true,
  temChaveDeIa: false,
  agentes: 0,
  execucoes: 0,
  temTeto: false,
  baseVazia: null,
  // O caso comum: quem abre o Início é dono do WORKSPACE, não do sistema.
  // O degrau do email é o único desta lista que não é do workspace.
  ehDonoDaPlataforma: false,
  temChaveDeEmail: false,
};

/** Tudo no lugar: chave, agente, já conversou e com teto definido. */
const PRONTO: EstadoDoWorkspace = {
  ...ZERADO,
  temChaveDeIa: true,
  agentes: 2,
  execucoes: 14,
  temTeto: true,
};

function ids(estado: EstadoDoWorkspace): string[] {
  return montarProximosPassos(estado).map((p) => p.id);
}

function passo(estado: EstadoDoWorkspace, id: string) {
  return montarProximosPassos(estado).find((p) => p.id === id);
}

describe("o workspace recém-criado", () => {
  it("abre pedindo chave e agente, nessa ordem", () => {
    // A chave vem primeiro porque, faltando ela, NADA funciona — nem o agente
    // que a pessoa acabou de criar.
    expect(ids(ZERADO).slice(0, 2)).toEqual(["chave", "agente"]);
  });

  it('não pede "converse com ele" antes de existir um agente', () => {
    expect(ids(ZERADO)).not.toContain("conversa");
    expect(ids({ ...ZERADO, agentes: 1 })).toContain("conversa");
  });

  it("tem pendência, então o bloco aparece", () => {
    expect(temPendencia(montarProximosPassos(ZERADO))).toBe(true);
  });
});

describe("o workspace pronto", () => {
  it("não tem mais pendência nenhuma — e o bloco some da tela", () => {
    expect(temPendencia(montarProximosPassos(PRONTO))).toBe(false);
  });

  it("os degraus continuam na lista, todos marcados", () => {
    // O bloco some por causa de `temPendencia`, não por a lista ficar vazia:
    // enquanto ele está na tela, ver o que já foi feito é o que mostra progresso.
    const passos = montarProximosPassos(PRONTO);
    expect(passos.length).toBeGreaterThan(0);
    expect(passos.every((p) => p.feito)).toBe(true);
  });
});

describe("quem é membro comum não recebe botão que não pode clicar", () => {
  const MEMBRO: EstadoDoWorkspace = { ...ZERADO, administra: false };

  it("o degrau da chave CONTINUA aparecendo, mas como recado", () => {
    // Continua aparecendo porque é ele que explica por que o agente do membro
    // não responde. Só que sem botão: `/settings/integracoes` é `requireOrgRole`.
    const chave = passo(MEMBRO, "chave");
    expect(chave).toBeDefined();
    expect(chave?.acao).toBeNull();
    expect(chave?.recado).toContain("dono ou administrador");
  });

  it("o degrau do teto SOME pra quem não pode mexer nele", () => {
    // Diferente da chave: teto faltando não quebra nada pro membro, então o
    // degrau seria uma pendência eterna que ele não tem como resolver.
    expect(ids(MEMBRO)).not.toContain("teto");
    expect(ids(ZERADO)).toContain("teto");
  });

  it("sem teto, o membro chega em 'nada pendente' quando o resto está pronto", () => {
    const membroPronto: EstadoDoWorkspace = {
      ...PRONTO,
      administra: false,
      temTeto: false,
    };
    expect(temPendencia(montarProximosPassos(membroPronto))).toBe(false);
  });

  it("a base vazia também vira recado, não botão", () => {
    // ⚠️ DEFEITO MEDIDO NO NAVEGADOR. A tela de Conhecimento abre pra todo
    // membro, então o degrau parecia acionável por qualquer um — mas a policy
    // de insert de `documents` exige owner/admin. O membro clicava, chegava
    // numa tela sem botão de subir e não tinha como entender o porquê.
    const p = passo(
      { ...ZERADO, administra: false, baseVazia: { slug: "manuais", nome: "Manuais" } },
      "documento",
    );
    expect(p).toBeDefined();
    expect(p?.acao).toBeNull();
    expect(p?.recado).toContain("dono ou administrador");
  });

  it("todo degrau tem OU botão OU recado — nunca os dois, nunca nenhum", () => {
    for (const administra of [true, false]) {
      const estado = {
        ...ZERADO,
        administra,
        agentes: 1,
        baseVazia: { slug: "x", nome: "X" },
      };
      for (const p of montarProximosPassos(estado)) {
        const temBotao = p.acao !== null;
        const temRecado = p.recado !== null;
        expect(temBotao !== temRecado, `degrau "${p.id}" com acao e recado inconsistentes`).toBe(
          true,
        );
      }
    }
  });
});

describe("a base de conhecimento vazia", () => {
  it("só vira degrau quando a base existe e está sem documento", () => {
    expect(ids(PRONTO)).not.toContain("documento");
    expect(ids({ ...PRONTO, baseVazia: { slug: "manuais", nome: "Manuais" } })).toContain(
      "documento",
    );
  });

  it("o degrau leva direto pra base certa e diz o nome dela", () => {
    const p = passo({ ...PRONTO, baseVazia: { slug: "manuais", nome: "Manuais" } }, "documento");
    expect(p?.titulo).toContain("Manuais");
    expect(p?.acao?.href).toBe("/app/acme/conhecimento/manuais");
  });

  it("base vazia segura a pendência sozinha", () => {
    // Todo o resto pronto, mas a base criada e vazia: o agente não acha nada
    // nela, e ninguém iria descobrir isso sem um aviso.
    const comBaseVazia = { ...PRONTO, baseVazia: { slug: "manuais", nome: "Manuais" } };
    expect(temPendencia(montarProximosPassos(comBaseVazia))).toBe(true);
  });
});

describe("os endereços e as frases", () => {
  it("todo link começa com o workspace de quem está olhando", () => {
    for (const p of montarProximosPassos({ ...ZERADO, agentes: 1 })) {
      if (p.acao) expect(p.acao.href.startsWith("/app/acme/")).toBe(true);
    }
  });

  it("nenhum degrau tem título ou explicação vazios", () => {
    for (const p of montarProximosPassos({
      ...ZERADO,
      agentes: 1,
      baseVazia: { slug: "x", nome: "X" },
    })) {
      expect(p.titulo.length).toBeGreaterThan(3);
      expect(p.explicacao.length).toBeGreaterThan(10);
    }
  });

  it("nenhum degrau joga jargão na cara do aluno", () => {
    const proibido = ["RLS", "policy", "schema", "Server Action", "embedding", "RSC"];
    for (const p of montarProximosPassos({
      ...ZERADO,
      agentes: 1,
      baseVazia: { slug: "x", nome: "X" },
    })) {
      const texto = `${p.titulo} ${p.explicacao} ${p.recado ?? ""}`;
      for (const palavra of proibido) {
        expect(texto.toLowerCase(), `"${palavra}" apareceu no degrau ${p.id}`).not.toContain(
          palavra.toLowerCase(),
        );
      }
    }
  });

  it("cada degrau aparece uma vez só", () => {
    const lista = ids({ ...ZERADO, agentes: 1, baseVazia: { slug: "x", nome: "X" } });
    expect(new Set(lista).size).toBe(lista.length);
  });
});

/**
 * O DEGRAU DO EMAIL — o único desta lista que não é do workspace.
 *
 * Ele existe porque o gargalo de email é invisível até doer: o Supabase entrega
 * 2 emails por hora, e quando estoura, quem tenta criar conta recebe erro e
 * fica de fora — sem nada aparecer pro dono do sistema. Antes disso, a única
 * forma de descobrir era abrir Plataforma → Configurações por conta própria,
 * ou ler o guia de publicação.
 *
 * ⚠️ SÓ QUEM PODE CUMPRIR VÊ. A chave de email é UMA, do app inteiro, e mora
 * numa tela que só o dono do sistema abre (`requirePlatformAdmin`). Mostrar
 * esse degrau pra quem administra só um workspace seria um botão levando pra
 * uma tela que chuta a pessoa de volta.
 */
describe("o degrau do email", () => {
  const DONO_DO_SISTEMA: EstadoDoWorkspace = {
    ...ZERADO,
    ehDonoDaPlataforma: true,
    temChaveDeEmail: false,
  };

  it("aparece pra quem é dono do sistema e ainda não cadastrou a chave", () => {
    expect(ids(DONO_DO_SISTEMA)).toContain("email");
  });

  it("some assim que a chave existe", () => {
    expect(ids({ ...DONO_DO_SISTEMA, temChaveDeEmail: true })).not.toContain("email");
  });

  it("nunca aparece pra quem não é dono do sistema", () => {
    // Nem pra quem administra o workspace: a tela da chave é de outro nível.
    expect(ids({ ...ZERADO, administra: true, temChaveDeEmail: false })).not.toContain("email");
    expect(ids({ ...ZERADO, administra: false, temChaveDeEmail: false })).not.toContain("email");
  });

  it("leva pra tela da plataforma, não pra uma de dentro do workspace", () => {
    const passo = montarProximosPassos(DONO_DO_SISTEMA).find((p) => p.id === "email");
    expect(passo?.acao?.href).toBe("/plataforma/configuracoes");
    // Um href com o slug do workspace no meio seria a tela errada.
    expect(passo?.acao?.href).not.toContain(DONO_DO_SISTEMA.orgSlug);
  });

  it("diz o número que dói, não uma frase vaga", () => {
    // "configure o email" não faz ninguém sair do lugar. "2 por hora, e quem
    // tentar criar conta depois disso fica de fora" faz.
    const passo = montarProximosPassos(DONO_DO_SISTEMA).find((p) => p.id === "email");
    expect(passo?.explicacao).toContain("2 emails por hora");
  });
});
