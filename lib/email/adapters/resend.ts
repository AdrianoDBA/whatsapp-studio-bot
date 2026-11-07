import { render } from "@react-email/render";
import { Resend } from "resend";
import { erroDeEmailParaOAluno } from "../erros";
import type { EmailProvider, SendEmailInput, SendEmailResult } from "../provider";

/**
 * ⚠️ O `error` DESTE ADAPTADOR JÁ SAI EM PT-BR LEIGO.
 *
 * Quem lê `SendEmailResult.error` daqui é `lib/agents/acoes.ts`, e de lá o
 * texto vai pro rastro do agente, pro chat, pro playground e pra
 * `jobs.last_error` — que a tela de Automações mostra CRU. Devolver o que o
 * Resend escreveu (inglês, vocabulário dele) é a regra 6 do projeto sendo
 * violada em quatro telas de uma vez.
 *
 * O motivo técnico não some: `erroDeEmailParaOAluno` grava ele no registro
 * (log) do servidor antes de devolver a frase. Ver `lib/email/erros.ts`.
 */
export class ResendAdapter implements EmailProvider {
  private client: Resend;
  private from: string;

  constructor(apiKey: string, from: string) {
    this.client = new Resend(apiKey);
    this.from = from;
  }

  async send(opts: SendEmailInput): Promise<SendEmailResult> {
    try {
      const html = await render(opts.react);
      const text = await render(opts.react, { plainText: true });
      const { data, error } = await this.client.emails.send({
        from: this.from,
        to: opts.to,
        subject: opts.subject,
        html,
        text,
        replyTo: opts.replyTo,
      });
      if (error) return { ok: false, error: erroDeEmailParaOAluno("email/resend", error) };
      return { ok: true, id: data?.id ?? "" };
    } catch (err) {
      // Aqui cai o que nem chegou a virar resposta do Resend (rede fora,
      // template que estourou). Mesma regra: leigo na tela, técnico no log.
      return { ok: false, error: erroDeEmailParaOAluno("email/resend", err) };
    }
  }
}
