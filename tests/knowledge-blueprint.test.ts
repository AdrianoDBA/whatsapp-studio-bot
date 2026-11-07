import { describe, expect, it } from "vitest";
import { baseParaInsert, type KnowledgeBaseBlueprint } from "@/lib/knowledge/blueprint";

const BP: KnowledgeBaseBlueprint = {
  slug: "manual-do-produto",
  name: "Manual do produto",
  description: "O que a equipe precisa saber pra atender.",
  embeddingModel: "openai:text-embedding-3-small",
};

describe("baseParaInsert", () => {
  it("monta a linha com o workspace preso", () => {
    const linha = baseParaInsert(BP, "org-1", "user-1");
    expect(linha.organization_id).toBe("org-1");
    expect(linha.slug).toBe("manual-do-produto");
    expect(linha.name).toBe("Manual do produto");
    expect(linha.embedding_model).toBe("openai:text-embedding-3-small");
  });

  /**
   * 🔴 ACHADO PELA PROVA AO VIVO DO MATERIALIZADOR CONTRA POSTGRES DE
   * VERDADE (não pelo dublê de teste): sem `created_by`, a policy de INSERT
   * "admins create knowledge bases" (`20260821020000_knowledge_base.sql`,
   * `with check (... and auth.uid() = created_by)`) recusa TODA base
   * declarada em arquivo com `42501`, em qualquer workspace. Esta trava
   * garante que a coluna nunca some de novo, silenciosa, do jeito que sumiu
   * da primeira vez — o `tsc` e a suíte inteira ficavam verdes sem ela.
   */
  it("grava created_by com quem materializou (senão a policy de INSERT recusa a linha)", () => {
    const linha = baseParaInsert(BP, "org-1", "user-1");
    expect(linha.created_by).toBe("user-1");
  });

  it("descrição vazia vira null, não string vazia", () => {
    expect(
      baseParaInsert({ ...BP, description: undefined }, "org-1", "user-1").description,
    ).toBeNull();
    expect(baseParaInsert({ ...BP, description: "   " }, "org-1", "user-1").description).toBeNull();
  });

  /**
   * `exigir` mede o comprimento DEPOIS do trim, porque é o valor aparado que
   * vai pro banco. Antes deste conserto, uma descrição de exatamente 300
   * caracteres com espaço em volta era recusada aqui mesmo que o banco fosse
   * aceitar ela depois do `trim()` — errava pro lado inofensivo (recusa
   * demais), mas ainda era uma entrada válida sendo barrada à toa.
   */
  it("aceita descrição de 300 caracteres com espaço em volta (mede depois do trim)", () => {
    const trezentos = "x".repeat(300);
    const linha = baseParaInsert({ ...BP, description: `  ${trezentos}  ` }, "org-1", "user-1");
    expect(linha.description).toBe(trezentos);
  });

  /**
   * As checagens repetem as restrições do banco de propósito: elas quebram no
   * `npm run verify` com uma mensagem que diz o que consertar, em vez de voltar
   * um `violates check constraint` na cara de quem não lê SQL.
   */
  it.each([
    ["Manual", "apelido com maiúscula"],
    ["-manual", "apelido começando com hífen"],
    ["m", "apelido de uma letra só"],
  ])("recusa o apelido %s (%s)", (slug) => {
    expect(() => baseParaInsert({ ...BP, slug }, "org-1", "user-1")).toThrow(/apelido/i);
  });

  it("recusa nome fora de 2 a 80 caracteres", () => {
    expect(() => baseParaInsert({ ...BP, name: "x" }, "org-1", "user-1")).toThrow(/nome/i);
    expect(() => baseParaInsert({ ...BP, name: "x".repeat(81) }, "org-1", "user-1")).toThrow(
      /nome/i,
    );
  });

  /**
   * 🔴 `embedding_model` é CONGELADO pelo gatilho `freeze_knowledge_base_slug`
   * depois de criado, e misturar trechos lidos por dois modelos faz a busca
   * devolver trecho aleatório, sem erro nenhum (regra 10-I). Um valor
   * malformado tem que morrer aqui, não no gatilho.
   */
  it("recusa modelo de embedding fora do formato provedor:modelo", () => {
    expect(() => baseParaInsert({ ...BP, embeddingModel: "texto" }, "org-1", "user-1")).toThrow(
      /modelo/i,
    );
  });

  /**
   * 🟠 IMPORTANTE da revisão: `knowledge_bases_model_len` no banco exige
   * `char_length between 3 and 120`. Antes deste conserto só o FORMATO era
   * conferido — um modelo bem-formado mas gigante passava aqui e quebrava só
   * na materialização, exatamente o que este arquivo existe pra impedir.
   */
  it("recusa modelo de embedding acima de 120 caracteres, aceita exatamente 120", () => {
    const noLimite = `a:${"b".repeat(118)}`; // 2 + 118 = 120
    expect(noLimite.length).toBe(120);
    expect(() =>
      baseParaInsert({ ...BP, embeddingModel: noLimite }, "org-1", "user-1"),
    ).not.toThrow();

    const acimaDoLimite = `openai:${"x".repeat(150)}`;
    expect(() =>
      baseParaInsert({ ...BP, embeddingModel: acimaDoLimite }, "org-1", "user-1"),
    ).toThrow(/modelo/i);
  });
});
