import { describe, expect, it } from "vitest";
import {
  buildSecretaryPrompt,
  TONE_OPTIONS,
  type SecretaryConfig,
} from "@/lib/whatsapp/secretary-prompt";

describe("Secretary Prompt Builder", () => {
  it("carrega todos os 4 tons de voz com opções válidas", () => {
    expect(TONE_OPTIONS).toHaveLength(4);
    const ids = TONE_OPTIONS.map((t) => t.id);
    expect(ids).toContain("acolhedor");
    expect(ids).toContain("profissional");
    expect(ids).toContain("objetivo");
    expect(ids).toContain("descontraido");
  });

  it("compila um prompt completo com todas as seções necessárias", () => {
    const config: SecretaryConfig = {
      assistantName: "Camila",
      companyName: "Studio Foto & Luz",
      tone: "acolhedor",
      servicesText: "- Ensaio Gestante: R$ 500,00\n- Ensaio Família: R$ 700,00",
      businessHours: "Segunda a Sexta das 9h às 18h",
      paymentMethods: "50% de sinal no Pix e saldo no dia",
      humanHandoff: "Quando pedir para falar com uma pessoa",
      additionalNotes: "Temos estacionamento no local",
    };

    const prompt = buildSecretaryPrompt(config, "Studio Foto & Luz");

    expect(prompt).toContain("Você é Camila");
    expect(prompt).toContain("Studio Foto & Luz");
    expect(prompt).toContain("Acolhedor, empático, simpático");
    expect(prompt).toContain("Ensaio Gestante: R$ 500,00");
    expect(prompt).toContain("Segunda a Sexta das 9h às 18h");
    expect(prompt).toContain("50% de sinal no Pix");
    expect(prompt).toContain("Quando pedir para falar com uma pessoa");
    expect(prompt).toContain("Temos estacionamento no local");
    expect(prompt).toContain("solicitar-humano");
    expect(prompt).toContain("consultar-disponibilidade");
  });

  it("usa valores padrão quando campos opcionais estão vazios", () => {
    const prompt = buildSecretaryPrompt({}, "Minha Empresa");
    expect(prompt).toContain("Secretária Virtual");
    expect(prompt).toContain("Minha Empresa");
    expect(prompt).toContain("Acolhedor");
  });
});
