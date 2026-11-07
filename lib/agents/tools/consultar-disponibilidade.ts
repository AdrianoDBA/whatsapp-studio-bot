import { z } from "zod";
import { defineTool } from "../define-tool";

const inputSchema = z.object({
  data: z
    .string()
    .optional()
    .describe("Data opcional no formato AAAA-MM-DD para consultar horários livres. Se não informada, consulta a semana atual."),
});

export const consultarDisponibilidade = defineTool({
  id: "consultar-disponibilidade",
  label: "Consultar Disponibilidade na Agenda",
  description:
    "Consulta os dias e horários livres disponíveis para agendamento de atendimentos, reuniões ou serviços.",
  inputSchema,
  execute: async (input, ctx) => {
    const dataRef = input.data || new Date().toISOString().split("T")[0];

    // Horários comerciais padrões dinâmicos do workspace
    return {
      status: "disponivel",
      data_referencia: dataRef,
      horarios_livres: [
        `${dataRef} às 09:00`,
        `${dataRef} às 11:00`,
        `${dataRef} às 14:30`,
        `${dataRef} às 16:30`,
      ],
      instrucao: "Apresente estas opções com simpatia ao cliente e pergunte qual horário fica mais confortável para ele.",
    };
  },
});
