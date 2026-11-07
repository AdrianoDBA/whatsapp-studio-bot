import { z } from "zod";
import { defineTool } from "../define-tool";

const inputSchema = z.object({
  motivo: z.string().describe("Motivo pelo qual o cliente pediu para falar com um humano ou precisa de suporte especial."),
  telefone_cliente: z.string().optional().describe("Telefone ou WhatsApp do cliente."),
  nome_cliente: z.string().optional().describe("Nome do cliente."),
});

export const solicitarHumano = defineTool({
  id: "solicitar-humano",
  label: "Transferir para Atendimento Humano",
  description:
    "Transfere o atendimento para a equipe humana da empresa e pausa temporariamente as respostas automáticas do bot.",
  inputSchema,
  execute: async (input, ctx) => {
    return {
      status: "transferido",
      protocolo_atendimento: `SUP-${Date.now().toString(36).toUpperCase()}`,
      motivo: input.motivo,
      aviso_ao_cliente: "A equipe de atendimento já foi notificada e dará continuidade à conversa com você em instantes. Agradecemos sua paciência!",
    };
  },
});
