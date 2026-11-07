import { z } from "zod";

export const criarNovoClienteSchema = z.object({
  empresaNome: z
    .string()
    .min(2, "Nome da empresa muito curto (mínimo 2 letras)")
    .max(80, "Nome da empresa muito longo (máximo 80 letras)"),
  clienteEmail: z.string().email("E-mail do cliente inválido"),
  assistenteNome: z.string().max(60, "Nome da assistente muito longo").optional(),
  tom: z.enum(["acolhedor", "profissional", "objetivo", "descontraido"]).optional(),
  telefone: z.string().max(30, "Telefone muito longo").optional(),
  servicosIniciais: z.string().max(8000, "Texto de serviços muito longo").optional(),
});

export type CriarNovoClienteInput = z.infer<typeof criarNovoClienteSchema>;

export type CriarNovoClienteOutput = {
  orgId: string;
  orgSlug: string;
  orgName: string;
  acceptUrl: string;
  whatsappMessage: string;
  whatsappShareUrl: string;
  token: string;
  emailSent: boolean;
};
