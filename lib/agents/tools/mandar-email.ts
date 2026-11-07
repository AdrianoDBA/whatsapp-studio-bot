/**
 * MANDAR EMAIL — a primeira ferramenta do registro que AGE de verdade.
 *
 * Ela não sabe mandar email: quem sabe é `ctx.acao.email`, a ÚNICA porta pra
 * agir (`lib/agents/acoes.ts`). Esta ferramenta só traduz o pedido do modelo
 * pro formato que a porta espera, e traduz a resposta de volta pro modelo.
 *
 * 🚫 NUNCA `import { ... } from "@/lib/email"`, NUNCA `fetch(...)` aqui dentro.
 * Em modo ensaio, um caminho desses mandaria o email de verdade achando que
 * estava simulando — é exatamente o caminho paralelo que a regra 10-K do
 * CLAUDE.md proíbe. A guarda é `tests/agents-tools-so-usam-acao.test.ts`, que
 * vasculha o código-fonte de `lib/agents/tools/` atrás desses dois padrões
 * (ignorando linha de comentário — é assim que este próprio aviso escapa
 * dela).
 */
import { z } from "zod";
import { defineTool, falhaDeFerramenta } from "../define-tool";

const inputSchema = z.object({
  para: z
    .array(z.string().email())
    .min(1)
    .max(5)
    .describe("Os endereços de email de quem vai receber (pelo menos 1, no máximo 5)."),
  assunto: z.string().min(1).max(200).describe("O assunto do email, curto e direto."),
  corpo: z
    .string()
    .min(1)
    .max(20_000)
    .describe("O texto do email, em português. Escreva direto, sem assinatura."),
});

export const mandarEmail = defineTool({
  id: "mandar-email",
  label: "Mandar email",
  description:
    "Manda um email pra um ou mais endereços. Use quando a pessoa pedir pra avisar alguém, " +
    "mandar um resumo, encaminhar uma informação ou responder por email. Escreva o corpo em " +
    "português, direto, sem assinatura — quem usa a ferramenta não vê o email antes de sair.",
  // Mandar email gasta a reputação do domínio do workspace e chega na caixa
  // de outra pessoa — por isso só quem administra pode deixar o agente usar.
  requiresRole: ["owner", "admin"],
  // Rótulo pra tela (regra: `age` não impede nada sozinho — quem barra a
  // ação em ensaio é o `ctx.acao`, não este campo).
  age: true,
  inputSchema,

  async execute(input, ctx) {
    const resultado = await ctx.acao.email(input);

    if (!resultado.ok) {
      // `resultado.erro` já vem em PT-BR leigo (ex.: MENSAGEM_EMAIL_NAO_CONFIGURADO
      // de `lib/agents/acoes.ts`) — não precisa traduzir de novo aqui.
      return falhaDeFerramenta(resultado.erro);
    }

    if (resultado.simulado) {
      // ⚠️ O CAMPO `aviso` EXISTE PRA ISTO: sem uma frase explícita dizendo
      // "não foi enviado", o modelo tende a ler `ok: true` e responder "mandei
      // o email" mesmo em ensaio — o que destruiria o propósito do ensaio.
      return {
        ensaio: true,
        aviso:
          "Isto foi um ENSAIO: o email NÃO foi enviado de verdade. Diga isso com todas as " +
          "letras na sua resposta pra pessoa, em vez de dizer que mandou.",
        oQueEuFaria: resultado.oQueEuFaria,
      };
    }

    return { enviado: true, para: input.para };
  },
});
