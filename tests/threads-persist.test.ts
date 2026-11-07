/**
 * Gravar e reler a conversa.
 *
 * O TESTE QUE MAIS IMPORTA AQUI é o do `sanearMensagem`. Sem ele, uma resposta
 * interrompida no meio de uma ferramenta grava uma chamada SEM resultado; no
 * turno seguinte o provedor recusa a conversa inteira, e ela fica quebrada PRA
 * SEMPRE — sem conserto nenhum pelo lado do aluno.
 *
 * O banco é um dublê que guarda o que foi chamado. Nenhuma rede acontece.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { describe, expect, test } from "vitest";
import {
  appendMessage,
  ensureTitle,
  historicoParaModelo,
  loadHistory,
  sanearMensagem,
  textoDaMensagem,
  tituloDaConversa,
} from "@/lib/threads/persist";
import type { AgentUIMessage } from "@/lib/threads/types";
import type { Database } from "@/types/supabase";

const ORG = "11111111-1111-4111-8111-111111111111";
const THREAD = "22222222-2222-4222-8222-222222222222";

// ---------------------------------------------------------------------------
// Dublê de banco
// ---------------------------------------------------------------------------

type Chamada = { metodo: string; args: unknown[] };

function criarBancoFalso(linhas: Record<string, unknown>[] = []) {
  const chamadas: Chamada[] = [];
  const inseridos: Record<string, unknown>[] = [];
  const atualizados: Record<string, unknown>[] = [];

  function registrar(metodo: string, ...args: unknown[]) {
    chamadas.push({ metodo, args });
  }

  function thenable<T>(valor: T) {
    return {
      // biome-ignore lint/suspicious/noThenProperty: imita o PostgREST
      then: (onOk: (v: T) => unknown) => Promise.resolve(onOk(valor)),
    };
  }

  const cliente = {
    from(tabela: string) {
      registrar("from", tabela);
      const encadeavel: Record<string, unknown> = {
        ...thenable({ data: linhas, error: null }),
      };
      for (const metodo of ["select", "eq", "order", "limit", "is", "neq"]) {
        encadeavel[metodo] = (...args: unknown[]) => {
          registrar(metodo, ...args);
          return encadeavel;
        };
      }
      encadeavel.insert = (valores: Record<string, unknown>) => {
        registrar("insert", valores);
        inseridos.push(valores);
        return thenable({ data: null, error: null });
      };
      encadeavel.update = (valores: Record<string, unknown>) => {
        registrar("update", valores);
        atualizados.push(valores);
        return encadeavel;
      };
      return encadeavel;
    },
  };

  return {
    supabase: cliente as unknown as SupabaseClient<Database>,
    chamadas,
    inseridos,
    atualizados,
    filtrouPor(coluna: string, valor: unknown) {
      return chamadas.some((c) => c.metodo === "eq" && c.args[0] === coluna && c.args[1] === valor);
    },
  };
}

/** Uma resposta do agente que chamou uma ferramenta e recebeu o resultado. */
function respostaCompleta(): AgentUIMessage {
  return {
    id: "a1",
    role: "assistant",
    parts: [
      { type: "step-start" },
      {
        type: "tool-buscar-na-base",
        toolCallId: "call-1",
        state: "output-available",
        input: { pergunta: "isso existe?" },
        output: { total: 3 },
      },
      { type: "text", text: "Achei 3 trechos sobre isso." },
    ] as AgentUIMessage["parts"],
  };
}

/** A MESMA resposta, cortada no meio: a ferramenta nunca respondeu. */
function respostaPelaMetade(): AgentUIMessage {
  return {
    id: "a2",
    role: "assistant",
    parts: [
      {
        type: "tool-buscar-na-base",
        toolCallId: "call-2",
        state: "input-available",
        input: { pergunta: "isso existe?" },
      },
    ] as AgentUIMessage["parts"],
  };
}

// ---------------------------------------------------------------------------

describe("sanearMensagem — a trava que impede conversa quebrada pra sempre", () => {
  test("derruba chamada de ferramenta que NÃO chegou a ter resultado", () => {
    const limpa = sanearMensagem(respostaPelaMetade());
    expect(limpa.parts).toHaveLength(0);
  });

  test("derruba também a chamada que ainda estava recebendo a entrada", () => {
    const limpa = sanearMensagem({
      id: "a3",
      role: "assistant",
      parts: [
        { type: "tool-buscar-na-base", toolCallId: "c", state: "input-streaming" },
      ] as AgentUIMessage["parts"],
    });
    expect(limpa.parts).toHaveLength(0);
  });

  test("MANTÉM a chamada que respondeu, e a que falhou explicando o motivo", () => {
    const limpa = sanearMensagem({
      id: "a4",
      role: "assistant",
      parts: [
        {
          type: "tool-buscar-na-base",
          toolCallId: "c1",
          state: "output-available",
          input: {},
          output: { total: 0 },
        },
        {
          type: "tool-buscar-na-base",
          toolCallId: "c2",
          state: "output-error",
          input: {},
          errorText: "A ferramenta não conseguiu responder.",
        },
      ] as AgentUIMessage["parts"],
    });
    expect(limpa.parts).toHaveLength(2);
  });

  test("não mexe em texto, raciocínio nem marcação de passo", () => {
    const limpa = sanearMensagem(respostaCompleta());
    expect(limpa.parts.map((p) => p.type)).toEqual(["step-start", "tool-buscar-na-base", "text"]);
  });

  test("corta texto absurdo em vez de recusar a gravação", () => {
    const limpa = sanearMensagem({
      id: "a5",
      role: "user",
      parts: [{ type: "text", text: "a".repeat(50_000) }],
    });
    const parte = limpa.parts[0];
    expect(parte?.type).toBe("text");
    expect(parte?.type === "text" && parte.text.length).toBeLessThanOrEqual(20_001);
  });
});

describe("o que a conversa quebrada faria com o modelo", () => {
  test("a resposta pela metade NÃO vira chamada de ferramenta sem resultado", async () => {
    // Sem o saneamento, `convertToModelMessages` monta um `tool-call` órfão e o
    // provedor recusa a conversa inteira no turno seguinte.
    const historico = [respostaPelaMetade()].map(sanearMensagem);
    const paraOModelo = await historicoParaModelo(historico, {});

    const temChamada = JSON.stringify(paraOModelo).includes("tool-call");
    expect(temChamada).toBe(false);
  });

  test("a resposta completa continua virando chamada + resultado", async () => {
    const paraOModelo = await historicoParaModelo([sanearMensagem(respostaCompleta())], {});
    const texto = JSON.stringify(paraOModelo);
    expect(texto).toContain("tool-call");
    expect(texto).toContain("tool-result");
  });
});

describe("textoDaMensagem / tituloDaConversa", () => {
  test("junta os pedaços de texto e ignora o resto", () => {
    expect(textoDaMensagem(respostaCompleta())).toBe("Achei 3 trechos sobre isso.");
  });

  test("o título é a primeira linha, cortada", () => {
    expect(tituloDaConversa("Quantas tarefas estão em aberto?\nE quem é o dono?")).toBe(
      "Quantas tarefas estão em aberto?",
    );
  });

  test("título longo ganha reticências e não passa de 60", () => {
    const t = tituloDaConversa("z".repeat(200));
    expect(t).not.toBeNull();
    expect((t ?? "").length).toBeLessThanOrEqual(60);
    expect(t?.endsWith("…")).toBe(true);
  });

  test("texto em branco não vira título", () => {
    expect(tituloDaConversa("   \n  ")).toBeNull();
  });
});

describe("appendMessage", () => {
  test("grava sempre com o workspace, a conversa e o papel", async () => {
    const banco = criarBancoFalso();
    await appendMessage({
      supabase: banco.supabase,
      organizationId: ORG,
      threadId: THREAD,
      role: "assistant",
      message: respostaCompleta(),
      runId: "run-1",
      metadata: { runId: "run-1", costMicros: null },
    });

    const linha = banco.inseridos[0];
    expect(linha?.organization_id).toBe(ORG);
    expect(linha?.thread_id).toBe(THREAD);
    expect(linha?.role).toBe("assistant");
    expect(linha?.run_id).toBe("run-1");
    expect(Array.isArray(linha?.parts)).toBe(true);
  });

  test("a chamada de ferramenta sem resultado NÃO chega no banco", async () => {
    const banco = criarBancoFalso();
    await appendMessage({
      supabase: banco.supabase,
      organizationId: ORG,
      threadId: THREAD,
      role: "assistant",
      message: respostaPelaMetade(),
      runId: "run-2",
    });
    expect(banco.inseridos[0]?.parts).toEqual([]);
  });

  test("balão gigante vira só o texto, em vez de a gravação falhar", async () => {
    const banco = criarBancoFalso();
    await appendMessage({
      supabase: banco.supabase,
      organizationId: ORG,
      threadId: THREAD,
      role: "assistant",
      message: {
        id: "a9",
        role: "assistant",
        parts: [
          { type: "text", text: "Achei o que você pediu." },
          {
            type: "tool-buscar-na-base",
            toolCallId: "c",
            state: "output-available",
            input: {},
            output: { lixo: "x".repeat(80_000) },
          },
        ] as AgentUIMessage["parts"],
      },
      runId: "run-3",
    });

    const partes = banco.inseridos[0]?.parts as Array<{ type: string; text?: string }>;
    expect(partes).toHaveLength(1);
    expect(partes[0]?.type).toBe("text");
    expect(partes[0]?.text).toContain("Achei o que você pediu.");
  });
});

describe("loadHistory", () => {
  test("pede o banco por seq (nunca por created_at) e devolve na ordem da conversa", async () => {
    const banco = criarBancoFalso([
      { id: "m3", role: "assistant", parts: [{ type: "text", text: "terceira" }], metadata: null },
      { id: "m2", role: "user", parts: [{ type: "text", text: "segunda" }], metadata: null },
      { id: "m1", role: "user", parts: [{ type: "text", text: "primeira" }], metadata: null },
    ]);

    const historico = await loadHistory({
      supabase: banco.supabase,
      organizationId: ORG,
      threadId: THREAD,
      tools: {},
    });

    expect(historico.map((m) => textoDaMensagem(m))).toEqual(["primeira", "segunda", "terceira"]);

    const ordenacao = banco.chamadas.find((c) => c.metodo === "order");
    expect(ordenacao?.args[0]).toBe("seq");
    expect(banco.chamadas.some((c) => c.metodo === "order" && c.args[0] === "created_at")).toBe(
      false,
    );
  });

  test("o papel 'tool' do banco vira 'assistant' na tela", async () => {
    const banco = criarBancoFalso([
      { id: "m1", role: "tool", parts: [{ type: "text", text: "resultado" }], metadata: null },
    ]);
    const historico = await loadHistory({
      supabase: banco.supabase,
      organizationId: ORG,
      threadId: THREAD,
      tools: {},
    });
    expect(historico[0]?.role).toBe("assistant");
  });

  test("linha com `parts` estragado não derruba a conversa", async () => {
    const banco = criarBancoFalso([{ id: "m1", role: "user", parts: null, metadata: null }]);
    const historico = await loadHistory({
      supabase: banco.supabase,
      organizationId: ORG,
      threadId: THREAD,
      tools: {},
    });
    expect(historico[0]?.parts).toEqual([]);
  });

  test("o que já estava gravado quebrado é saneado na LEITURA também", async () => {
    const banco = criarBancoFalso([
      {
        id: "m1",
        role: "assistant",
        parts: [{ type: "tool-buscar-na-base", toolCallId: "c", state: "input-available" }],
        metadata: null,
      },
    ]);
    const historico = await loadHistory({
      supabase: banco.supabase,
      organizationId: ORG,
      threadId: THREAD,
      tools: {},
    });
    expect(historico[0]?.parts).toHaveLength(0);
  });
});

describe("ensureTitle", () => {
  test("só escreve quando a conversa ainda não tem título", async () => {
    const banco = criarBancoFalso();
    await ensureTitle({
      supabase: banco.supabase,
      organizationId: ORG,
      threadId: THREAD,
      texto: "Quantas tarefas estão em aberto?",
    });

    expect(banco.atualizados[0]).toEqual({ title: "Quantas tarefas estão em aberto?" });
    // O `is("title", null)` é o que evita renomear por cima de um nome que a
    // pessoa escolheu na mão.
    expect(
      banco.chamadas.some((c) => c.metodo === "is" && c.args[0] === "title" && c.args[1] === null),
    ).toBe(true);
  });

  test("texto em branco não escreve nada", async () => {
    const banco = criarBancoFalso();
    await ensureTitle({
      supabase: banco.supabase,
      organizationId: ORG,
      threadId: THREAD,
      texto: "   ",
    });
    expect(banco.atualizados).toHaveLength(0);
  });
});
