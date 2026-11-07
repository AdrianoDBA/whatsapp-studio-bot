import { z } from "zod";

/**
 * Tamanho mínimo da senha. Está numa constante porque este número aparece na
 * validação, no texto da tela e nos testes — mudar em um lugar só criava
 * incoerência (era o caso: a apostila dizia 8, o app exigia 10).
 */
export const PASSWORD_MIN_LENGTH = 10;

const passwordField = z
  .string()
  .min(PASSWORD_MIN_LENGTH, `Senha precisa ter pelo menos ${PASSWORD_MIN_LENGTH} caracteres`)
  .max(128, "Senha muito longa");

export const signUpSchema = z.object({
  email: z.string().email("Email inválido"),
  password: passwordField,
  fullName: z.string().min(2, "Nome muito curto").max(80, "Nome muito longo"),
  /** Pra onde mandar a pessoa depois de confirmar o email (ex: convite). */
  next: z.string().optional(),
});

export type SignUpInput = z.infer<typeof signUpSchema>;

export const signUpFormSchema = signUpSchema
  .omit({ next: true })
  .extend({ confirmPassword: z.string() })
  .refine((data) => data.password === data.confirmPassword, {
    message: "As senhas não coincidem",
    path: ["confirmPassword"],
  });

export type SignUpFormInput = z.infer<typeof signUpFormSchema>;

export const signInSchema = z.object({
  email: z.string().email("Email inválido"),
  password: z.string().min(1, "Informe a senha"),
});

export type SignInInput = z.infer<typeof signInSchema>;

export const resetPasswordSchema = z.object({
  email: z.string().email("Email inválido"),
});

export type ResetPasswordInput = z.infer<typeof resetPasswordSchema>;

export const updatePasswordSchema = z
  .object({
    password: passwordField,
    confirmPassword: z.string(),
  })
  .refine((data) => data.password === data.confirmPassword, {
    message: "As senhas não coincidem",
    path: ["confirmPassword"],
  });

export type UpdatePasswordInput = z.infer<typeof updatePasswordSchema>;
