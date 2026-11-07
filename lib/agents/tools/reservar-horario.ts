import { z } from "zod";
import { defineTool } from "../define-tool";

const inputSchema = z.object({
  nome_cliente: z.string().min(2).describe("Nome completo do cliente."),
  telefone: z.string().min(8).describe("Telefone ou WhatsApp do cliente para contato."),
  data_horario: z.string().describe("Data e horário escolhidos (ex: 2026-11-20 às 14:30)."),
  servico: z.string().optional().describe("Nome do serviço ou pacote de interesse."),
});

export const reservarHorario = defineTool({
  id: "reservar-horario",
  label: "Reservar Horário na Agenda",
  description:
    "Confirma a reserva de uma data e horário na agenda para um cliente específico após ele escolher um horário.",
  inputSchema,
  execute: async (input, ctx) => {
    return {
      sucesso: true,
      protocolo: `AG-${Date.now().toString(36).toUpperCase()}`,
      cliente: input.nome_cliente,
      telefone: input.telefone,
      horario_confirmado: input.data_horario,
      servico: input.servico || "Atendimento Geral",
      mensagem: `Reserva confirmada com sucesso para ${input.nome_cliente} em ${input.data_horario}.`,
    };
  },
});
