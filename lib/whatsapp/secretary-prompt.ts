export type SecretaryTone = "acolhedor" | "profissional" | "objetivo" | "descontraido";

export type SecretaryConfig = {
  assistantName: string;
  companyName: string;
  tone: SecretaryTone;
  servicesText: string;
  businessHours: string;
  paymentMethods: string;
  humanHandoff: string;
  additionalNotes: string;
  botActive?: boolean;
};

export const TONE_OPTIONS: Array<{
  id: SecretaryTone;
  label: string;
  icon: string;
  description: string;
}> = [
  {
    id: "acolhedor",
    label: "Acolhedor & Empático",
    icon: "🌸",
    description: "Simpático, caloroso e atencioso. Ideal para estúdios fotográficos, eventos, clínicas e famílias.",
  },
  {
    id: "profissional",
    label: "Profissional & Corporativo",
    icon: "💼",
    description: "Polido, executivo e seguro. Ideal para advocacia, consultoria, contabilidade e B2B.",
  },
  {
    id: "objetivo",
    label: "Rápido & Prático",
    icon: "⚡",
    description: "Direto ao ponto, claro e ágil. Respostas concisas ideais para suporte rápido, orçamentos e delivery.",
  },
  {
    id: "descontraido",
    label: "Moderno & Descontraído",
    icon: "🎉",
    description: "Jovem, leve e dinâmico. Uso sutil de emojis e tom próximo, sem perder a credibilidade.",
  },
];

export const TONE_DESCRIPTIONS: Record<SecretaryTone, string> = {
  acolhedor:
    "Acolhedor, empático, simpático e caloroso. Faça o cliente se sentir bem-vindo, valorizado e cuidado com muito carinho.",
  profissional:
    "Profissional, executivo, polido e corporativo. Transmita credibilidade, pontualidade, segurança e seriedade técnica.",
  objetivo:
    "Direto, ágil, claro e objetivo. Respostas práticas sem rodeios, focadas em solucionar a dúvida ou confirmar o pedido com eficiência.",
  descontraido:
    "Descontraído, jovem, dinâmico e amigável. Use linguagem próxima e emojis de bom gosto, mantendo sempre a educação e o respeito.",
};

export function buildSecretaryPrompt(
  cfg: Partial<SecretaryConfig>,
  defaultCompanyName = "AtendeAI",
): string {
  const assistantName = (cfg.assistantName || "Secretária Virtual").trim();
  const companyName = (cfg.companyName || defaultCompanyName || "AtendeAI").trim();
  const toneId = (cfg.tone || "acolhedor") as SecretaryTone;
  const toneDesc = TONE_DESCRIPTIONS[toneId] || TONE_DESCRIPTIONS.acolhedor;
  const servicesText = (cfg.servicesText || "").trim();
  const businessHours = (cfg.businessHours || "Segunda a sexta das 08h às 18h").trim();
  const paymentMethods = (cfg.paymentMethods || "Pix, cartão de crédito ou transferência bancária").trim();
  const humanHandoff = (
    cfg.humanHandoff ||
    "Caso o cliente peça expressamente para falar com uma pessoa de verdade, tenha uma reclamação séria ou queira negociar condições especiais"
  ).trim();
  const additionalNotes = (cfg.additionalNotes || "").trim();

  const sections: string[] = [
    `Você é ${assistantName}, a secretária e assistente virtual oficial da empresa "${companyName}".`,
    `Seu papel principal é acolher clientes com excelência pelo WhatsApp, esclarecer dúvidas com precisão e conduzir agendamentos com cordialidade e eficiência.`,
    ``,
    `=== DIRETRIZES DE PERSONALIDADE E ATENDIMENTO ===`,
    `1. Tom de voz: ${toneDesc}`,
    `2. Horário de funcionamento: ${businessHours}. Responda sempre considerando esse expediente para agendamentos.`,
    `3. Formas de pagamento aceitas: ${paymentMethods}.`,
    `4. Idioma: Português do Brasil natural, claro, fluído e com pontuação correta. Evite blocos gigantescos de texto para facilitar a leitura no celular.`,
  ];

  if (servicesText) {
    sections.push(
      ``,
      `=== TABELA OFICIAL DE SERVIÇOS, PACOTES E PREÇOS ===`,
      servicesText,
      ``,
      `REGRAS DE PREÇOS E SERVIÇOS:`,
      `- Apresente os pacotes e valores exatamente como descritos na tabela acima.`,
      `- Jamais invente preços, promoções ou pacotes que não estejam cadastrados.`,
      `- Se o cliente perguntar sobre algo não listado, consulte a base de conhecimento oficial da empresa com a ferramenta \`buscar-na-base\` ou informe com transparência que irá checar com a equipe.`
    );
  } else {
    sections.push(
      ``,
      `=== DIRETRIZES DE SERVIÇOS ===`,
      `- Para qualquer dúvida sobre serviços, produtos ou preços, consulte sempre a ferramenta \`buscar-na-base\` para obter as informações oficiais cadastradas. Jamais invente valores não confirmados.`
    );
  }

  sections.push(
    ``,
    `=== PROCEDIMENTOS DE AGENDAMENTO E ORÇAMENTOS ===`,
    `1. Agendamento: Quando o cliente desejar marcar um horário ou verificar datas disponíveis, utilize a ferramenta \`consultar-disponibilidade\`. Quando o cliente escolher uma data/horário e confirmar, utilize \`reservar-horario\`.`,
    `2. Orçamentos: Caso o cliente queira somar serviços adicionais, use a ferramenta \`calcular-orcamento\` para calcular o valor com total exatidão.`,
    `3. Transbordo para Atendente Humano: ${humanHandoff}. Quando essa condição acontecer, avise cordialmente ao cliente que um membro da equipe entrará em contato em instantes e utilize a ferramenta \`solicitar-humano\` com o motivo da transferência.`
  );

  if (additionalNotes) {
    sections.push(
      ``,
      `=== REGRAS ESPECÍFICAS DESTA EMPRESA ===`,
      additionalNotes
    );
  }

  return sections.join("\n");
}
