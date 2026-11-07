/**
 * Os formatos (Zod) das telas de chave.
 *
 * São QUATRO formatos porque são quatro funções do servidor: guardar e apagar
 * chave da plataforma, guardar e apagar chave do workspace. Cada par tem um
 * guard de permissão diferente, e separar os formatos deixa impossível chamar
 * a função com o dado do outro escopo.
 *
 * ⚠️ REGRA 15 DO CLAUDE.md: nada de `.default()` aqui. Esses formatos são
 * usados pelo `useForm`, e `.default()` faz a tipagem do formulário divergir
 * do que o Zod devolve — o campo vira "opcional na entrada, obrigatório na
 * saída" e o TypeScript passa a reclamar em lugares que não têm nada a ver.
 *
 * Arquivo PURO: só Zod e o catálogo de provedores (que também é puro). Pode ser
 * importado por componente com "use client" — e é o que faz a conferência do
 * prefixo aparecer NO CAMPO, antes de o formulário sair da tela.
 */
import { z } from "zod";
import { conferirPrefixoDaChave } from "./providers";

/** Os cinco provedores que o banco aceita (enum `credential_provider`). */
export const credentialProviderEnum = z.enum([
  "openrouter",
  "anthropic",
  "openai",
  "google",
  "resend",
]);

/**
 * A chave em si.
 *
 * Piso de 8 caracteres: chave de provedor nenhum é menor que isso, e sem piso
 * um espaço em branco colado sem querer viraria uma credencial "válida" que
 * quebra só na hora de usar. Teto de 500: nenhuma chave de API chega perto, e
 * o teto evita alguém colar um arquivo inteiro no campo.
 */
const segredo = z
  .string()
  .trim()
  .min(8, "Cole a chave inteira — essa parece curta demais.")
  .max(500, "Isso é grande demais pra ser uma chave. Cole só a chave.");

/** Rótulo humano. O banco tem teto de 120 caracteres nessa coluna. */
const rotulo = z.string().trim().max(120, "O apelido pode ter no máximo 120 caracteres.");

/** O remetente dos emails. Só o Resend usa. */
const remetente = z
  .string()
  .trim()
  .max(200, "O remetente pode ter no máximo 200 caracteres.")
  .refine((v) => v === "" || v.includes("@"), {
    message: 'O remetente precisa ter um email dentro, tipo "Meu App <ola@meusite.com>".',
  });

/** O apelido do workspace na URL. */
const orgSlug = z.string().min(1).max(80);

/**
 * "A chave é mesmo desse provedor?" — a conferência que faltava.
 *
 * Mora no formato (e não só na função do servidor) porque o formato é o que o
 * `useForm` usa: assim o aviso aparece EMBAIXO DO CAMPO enquanto a pessoa
 * ainda está na tela, em vez de virar um toast depois do envio.
 *
 * Vai como `superRefine` do objeto inteiro, e não do campo `secret`, porque a
 * resposta depende de DOIS campos: qual provedor e qual chave.
 */
function conferirAChave(
  valor: { provider: z.infer<typeof credentialProviderEnum>; secret: string },
  ctx: z.RefinementCtx,
): void {
  const problema = conferirPrefixoDaChave(valor.provider, valor.secret);
  if (problema) {
    ctx.addIssue({ code: "custom", path: ["secret"], message: problema });
  }
}

// -----------------------------------------------------------------------------
// Plataforma — vale pra todos os workspaces. Só o dono da plataforma mexe.
// -----------------------------------------------------------------------------

export const savePlatformCredentialSchema = z
  .object({
    provider: credentialProviderEnum,
    secret: segredo,
    label: rotulo.optional(),
    from: remetente.optional(),
  })
  .superRefine(conferirAChave);
export type SavePlatformCredentialInput = z.infer<typeof savePlatformCredentialSchema>;

export const removePlatformCredentialSchema = z.object({
  provider: credentialProviderEnum,
});
export type RemovePlatformCredentialInput = z.infer<typeof removePlatformCredentialSchema>;

// -----------------------------------------------------------------------------
// Workspace — vale só pra um time. Dono/admin do workspace mexe.
// -----------------------------------------------------------------------------

export const saveOrgCredentialSchema = z
  .object({
    orgSlug,
    provider: credentialProviderEnum,
    secret: segredo,
  })
  .superRefine(conferirAChave);
export type SaveOrgCredentialInput = z.infer<typeof saveOrgCredentialSchema>;

export const removeOrgCredentialSchema = z.object({
  orgSlug,
  provider: credentialProviderEnum,
});
export type RemoveOrgCredentialInput = z.infer<typeof removeOrgCredentialSchema>;
