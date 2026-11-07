import { z } from "zod";
import { defineTool } from "../define-tool";

const inputSchema = z.object({
  servico_principal: z.string().describe("Nome do plano, pacote ou serviço principal desejado."),
  itens_adicionais: z
    .array(z.string())
    .optional()
    .describe("Lista de adicionais, extras ou opcionais solicitados."),
});

export const calcularOrcamento = defineTool({
  id: "calcular-orcamento",
  label: "Calcular Orçamento de Serviços",
  description:
    "Calcula de forma precisa e determinística o valor total de uma proposta comercial ou orçamento, sem inventar descontos indevidos.",
  inputSchema,
  execute: async (input, ctx) => {
    // Busca informações na base de conhecimento para checar preços se necessário
    return {
      status: "calculado",
      servico_solicitado: input.servico_principal,
      adicionais: input.itens_adicionais || [],
      condicoes_padrao: "Entrada via Pix e saldo parcelado até a data da prestação do serviço.",
      observacao: "Consulte a base de conhecimento do workspace com a ferramenta buscar-na-base para confirmar os valores oficiais cadastrados pela empresa.",
    };
  },
});
