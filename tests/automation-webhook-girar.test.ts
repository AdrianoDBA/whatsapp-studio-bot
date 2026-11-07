import { beforeEach, describe, expect, it, vi } from "vitest";
import { gerarTokenDeWebhook, montarUrlDoWebhook } from "@/lib/automation/webhooks";

/**
 * Girar o segredo tem que MANTER o endereço.
 *
 * Hoje "revogar" APAGA a linha, com esta justificativa no código: "como o token
 * não pode ser mostrado de novo, um endereço desligado seria uma linha morta".
 * A consequência é que rotacionar segredo TROCA A URL, e todo sistema de fora
 * que chamava aquele endereço quebra — então na prática ninguém rotaciona.
 *
 * A URL vem do `id` do endpoint, não do token. Girar só reescreve o hash.
 *
 * ⚠️ ESTES TRÊS TESTES JÁ VALEM HOJE, ANTES DE `girarTokenDoWebhookAction`
 * EXISTIR — de propósito. Eles não testam a action; travam as duas
 * propriedades das quais o giro depende (`montarUrlDoWebhook` deriva do
 * `id`; cada `gerarTokenDeWebhook` sorteia diferente), pra que um refactor
 * futuro em qualquer uma delas não faça o giro trocar a URL em silêncio.
 */
describe("girar o token", () => {
  it("a URL não depende do token", () => {
    const a = montarUrlDoWebhook("https://app.exemplo.com", "endpoint-1");
    const b = montarUrlDoWebhook("https://app.exemplo.com", "endpoint-1");
    expect(a).toBe(b);
    expect(a).toContain("endpoint-1");
  });

  it("cada giro sorteia um segredo diferente", () => {
    const um = gerarTokenDeWebhook();
    const outro = gerarTokenDeWebhook();
    expect(um.token).not.toBe(outro.token);
    expect(um.tokenHash).not.toBe(outro.tokenHash);
    expect(um.tokenHash).toMatch(/^[0-9a-f]{64}$/);
  });

  it("o hash não carrega o token", () => {
    const novo = gerarTokenDeWebhook();
    expect(novo.tokenHash).not.toContain(novo.token);
  });
});

// ---------------------------------------------------------------------------
// `girarTokenDoWebhookAction` — a action de verdade
// ---------------------------------------------------------------------------
//
// Substituiu `revogarWebhookAction` (que apagava a linha). O banco é de
// mentira aqui: o que está sendo travado é O QUE A ACTION MANDA PRO BANCO, não
// o resultado de uma consulta de verdade — isso é papel de teste de
// integração, que este projeto não tem pra Server Actions.

const ORG_ID = "org-1";
const ENDPOINT_ID = "aaaaaaaa-1111-4111-8111-111111111111";
const APP_URL = "https://app.exemplo.com";

// `vi.hoisted` roda ANTES das constantes lá embaixo (`ENDPOINT_ID` etc.) —
// por isso os valores default do mock repetem os literais na mão, em vez de
// referenciar as constantes do escopo do módulo.
const { requireOrgRoleMock, logErrorMock, revalidatePathMock, getAppUrlMock, fromMock, chain } =
  vi.hoisted(() => {
    const chain = {
      update: vi.fn((_payload: Record<string, unknown>) => chain),
      eq: vi.fn((_coluna: string, _valor: string) => chain),
      select: vi.fn((_colunas: string) => chain),
      single: vi.fn(
        async (): Promise<{
          data: { id: string } | null;
          error: { message: string } | null;
        }> => ({
          data: { id: "aaaaaaaa-1111-4111-8111-111111111111" },
          error: null,
        }),
      ),
    };
    return {
      requireOrgRoleMock: vi.fn(async () => ({
        org: { id: "org-1" },
        user: { id: "user-1" },
      })),
      logErrorMock: vi.fn(),
      revalidatePathMock: vi.fn(),
      getAppUrlMock: vi.fn(async () => "https://app.exemplo.com"),
      fromMock: vi.fn(() => chain),
      chain,
    };
  });

vi.mock("@/lib/auth/guards", () => ({ requireOrgRole: requireOrgRoleMock }));
vi.mock("@/lib/logger", () => ({ logError: logErrorMock }));
vi.mock("next/cache", () => ({ revalidatePath: revalidatePathMock }));
vi.mock("@/lib/app-url", () => ({ getAppUrl: getAppUrlMock }));
// `webhooks.ts` importa daqui — mockado só pra não puxar `pg` num teste que
// não fala com banco nenhum. `girarTokenDoWebhookAction` nunca chama os dois.
vi.mock("@/lib/automation/queue", () => ({
  webhookEndpointForCheck: vi.fn(),
  webhookTouch: vi.fn(),
}));
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({ from: fromMock }),
}));

import { girarTokenDoWebhookAction } from "@/lib/automation/actions";

describe("girarTokenDoWebhookAction", () => {
  beforeEach(() => {
    requireOrgRoleMock.mockClear();
    logErrorMock.mockClear();
    revalidatePathMock.mockClear();
    getAppUrlMock.mockClear();
    fromMock.mockClear();
    chain.update.mockClear();
    chain.eq.mockClear();
    chain.select.mockClear();
    chain.single.mockReset().mockResolvedValue({ data: { id: ENDPOINT_ID }, error: null });
  });

  it("gira o token e devolve a URL que vem do id, não do token", async () => {
    const resultado = await girarTokenDoWebhookAction({
      orgSlug: "acme",
      endpointId: ENDPOINT_ID,
    });

    expect(resultado.ok).toBe(true);
    if (!resultado.ok) throw new Error("esperava sucesso");
    expect(resultado.data?.url).toBe(`${APP_URL}/api/webhooks/${ENDPOINT_ID}`);
    expect(resultado.data?.token).toMatch(/^whk_/);
  });

  /**
   * ⚠️ A instrução mais fácil de errar nesta action: `grant update (slug)`
   * NÃO existe em `webhook_endpoints`, de propósito (o slug é a identidade
   * que o materializador usa). Um spread descuidado (`{ ...algumaCoisa,
   * token_hash, token_prefix }`) vazaria `slug` pro update e o banco
   * recusaria com 42501 em produção — sem teste nenhum acusando em dev.
   */
  it("o update grava SÓ token_hash e token_prefix — nunca slug, nunca a linha inteira", async () => {
    await girarTokenDoWebhookAction({ orgSlug: "acme", endpointId: ENDPOINT_ID });

    expect(chain.update).toHaveBeenCalledTimes(1);
    const payload = chain.update.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(Object.keys(payload).sort()).toEqual(["token_hash", "token_prefix"]);
    expect(payload.token_hash).toMatch(/^[0-9a-f]{64}$/);
  });

  it("confere a organização e o id do endereço antes de gravar", async () => {
    await girarTokenDoWebhookAction({ orgSlug: "acme", endpointId: ENDPOINT_ID });

    expect(chain.eq).toHaveBeenNthCalledWith(1, "organization_id", ORG_ID);
    expect(chain.eq).toHaveBeenNthCalledWith(2, "id", ENDPOINT_ID);
  });

  it("exige owner/admin", async () => {
    await girarTokenDoWebhookAction({ orgSlug: "acme", endpointId: ENDPOINT_ID });

    expect(requireOrgRoleMock).toHaveBeenCalledWith({
      orgSlug: "acme",
      roles: ["owner", "admin"],
    });
  });

  it("cada giro sorteia um token diferente do giro anterior, mas o endereço não muda", async () => {
    const primeiro = await girarTokenDoWebhookAction({
      orgSlug: "acme",
      endpointId: ENDPOINT_ID,
    });
    const segundo = await girarTokenDoWebhookAction({
      orgSlug: "acme",
      endpointId: ENDPOINT_ID,
    });

    if (!primeiro.ok || !segundo.ok) throw new Error("esperava sucesso nos dois");
    expect(primeiro.data?.token).not.toBe(segundo.data?.token);
    expect(primeiro.data?.url).toBe(segundo.data?.url);
  });

  it("banco recusou (ou o endereço não existe nesse workspace): erro traduzido, sem vazar o banco", async () => {
    chain.single.mockResolvedValue({ data: null, error: { message: "no rows returned" } });

    const resultado = await girarTokenDoWebhookAction({
      orgSlug: "acme",
      endpointId: ENDPOINT_ID,
    });

    expect(resultado).toEqual({
      ok: false,
      error: "Não deu pra gerar um endereço novo agora. Tente de novo.",
    });
    expect(logErrorMock).toHaveBeenCalledWith("automation.girarToken", expect.anything());
  });

  it("formato de entrada inválido nem chega no banco", async () => {
    const resultado = await girarTokenDoWebhookAction({
      orgSlug: "acme",
      endpointId: "não-é-um-uuid",
    });

    expect(resultado.ok).toBe(false);
    expect(fromMock).not.toHaveBeenCalled();
  });

  it("depois de girar, a tela de automações é revalidada", async () => {
    await girarTokenDoWebhookAction({ orgSlug: "acme", endpointId: ENDPOINT_ID });
    expect(revalidatePathMock).toHaveBeenCalledWith("/app/acme/automacoes");
  });
});
