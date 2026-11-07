/**
 * O PASSO QUE FALTA — e por que o app não consegue dar ele sozinho.
 *
 * ┌──────────────────────────────────────────────────────────────────────────┐
 * │  Os emails deste app saem por DOIS caminhos diferentes, e a chave da      │
 * │  Resend cadastrada nas telas só alcança UM deles.                         │
 * └──────────────────────────────────────────────────────────────────────────┘
 *
 *   convite, resultado de automação
 *     → `getEmailProvider()` (lib/email/index.ts) → Resend → ✅ resolvido pela tela
 *
 *   confirmação de conta, recuperação de senha
 *     → `supabase.auth.signUp()` / `resetPasswordForEmail()` (lib/auth/actions.ts)
 *     → o Supabase manda POR CONTA PRÓPRIA, com o SMTP dele
 *     → ❌ a nossa chave nunca é consultada nesse caminho
 *
 * O segundo caminho é o que dói: o SMTP embutido do Supabase manda **2 emails
 * por hora**. Passou disso, quem tentar criar conta recebe erro e não entra —
 * e o dono do sistema não fica sabendo, porque o erro é do lado de lá.
 *
 * ⚠️ POR QUE ISTO É UM TEXTO, E NÃO UM BOTÃO QUE CONFIGURA SOZINHO.
 * Trocar o SMTP de um projeto Supabase é a API de gerenciamento deles, e ela
 * pede um token de CONTA (`sbp_…`) — que abre todos os projetos daquela conta,
 * não só este. Seria uma quinta variável obrigatória, com poder muito maior que
 * as quatro de hoje, pra economizar um copia-e-cola de uma vez na vida. A troca
 * não vale.
 *
 * ⚠️ E POR QUE NÃO TEM BOTÃO "JÁ FIZ".
 * O app não tem como CONFERIR se você fez — quem sabe é o painel do Supabase.
 * Um botão que só esconde o aviso mentiria no dia em que você trocasse de
 * projeto Supabase: o aviso continuaria escondido, e o gargalo, de volta.
 */

/** Onde a pessoa cola isso. O `_` é o Supabase resolvendo o projeto atual. */
export const ENDERECO_DO_SMTP_NO_SUPABASE =
  "https://supabase.com/dashboard/project/_/auth/smtp";

/** Quantos emails o SMTP embutido do Supabase entrega por hora. */
export const EMAILS_POR_HORA_SEM_SMTP_PROPRIO = 2;

/** Quantos ele passa a entregar depois que você aponta pra Resend. */
export const EMAILS_POR_HORA_COM_SMTP_PROPRIO = 30;

/** Uma linha do quadrinho de copiar e colar. */
export type CampoDoSmtp = {
  /** O nome do campo, como ele aparece no painel do Supabase. */
  rotulo: string;
  /** O valor a colar, quando ele é fixo. */
  valor?: string;
  /** O que colar, quando o valor é pessoal (a chave, o remetente). */
  explicacao?: string;
};

/**
 * Os valores do SMTP da Resend.
 *
 * Conferidos em resend.com/docs/send-with-smtp: o servidor é `smtp.resend.com`,
 * o usuário é literalmente a palavra `resend`, a senha é a chave de API, e a
 * porta 465 é a que já sobe criptografada (as 25/587/2587 começam em texto
 * puro e só depois criptografam).
 */
export const CAMPOS_DO_SMTP_DA_RESEND: readonly CampoDoSmtp[] = [
  { rotulo: "Host", valor: "smtp.resend.com" },
  { rotulo: "Port number", valor: "465" },
  { rotulo: "Username", valor: "resend" },
  {
    rotulo: "Password",
    explicacao: "a mesma chave da Resend que você cadastrou aqui (a que começa com re_)",
  },
  {
    rotulo: "Sender email",
    explicacao: "o mesmo remetente que você cadastrou aqui — o domínio dele precisa estar verificado na Resend",
  },
];
