/**
 * Configuração central do seu app.
 *
 * Mude aqui pra customizar identidade, features e branding.
 * Tudo é type-safe — Claude Code te ajuda a manter consistente.
 */

export const appConfig = {
  /** Nome do seu app (aparece em metadata, header, footer, emails). */
  name: "AtendeAI",

  /** Descrição curta usada em metadata HTML e emails. */
  description: "Plataforma de Atendimento Inteligente e Agentes com WhatsApp",

  /**
   * A versão do app, mostrada no rodapé da barra lateral.
   *
   * ⚠️ DONO ÚNICO. Ela ficava escrita na mão dentro de `components/app/sidebar.tsx`,
   * congelada em "v1.0" enquanto o template já ia na `v1.0.1` — o aluno lia um
   * número que não correspondia a nada.
   *
   * Tem que bater com o `version` do `package.json` (`tests/versao.test.ts`
   * confere) e com a tag `vX.Y.Z` que é publicada pra turma. Subiu versão? Mexa
   * nos dois arquivos e corte a tag com o mesmo número.
   */
  version: "1.2.0",

  /**
   * O endereço público do app NÃO fica aqui: ele é descoberto sozinho a cada
   * requisição (ver lib/app-url.ts), então você não precisa configurar nada
   * quando ligar seu domínio. Se precisar dele no código, use `getAppUrl()`.
   */

  /** Cor accent (verde Kawasaki por padrão). Aplicada via CSS variables — só pra referência. */
  brand: {
    primaryColor: "verde-kawasaki",
  },

  /** Flags pra habilitar/desabilitar funcionalidades grandes. */
  features: {
    /** Permite múltiplos workspaces por user. Sem isso, force 1 org por user. */
    multipleOrganizations: true,
    /** Habilita uploads para Supabase Storage (avatars/logos). */
    storage: true,
  },

  /** Email de contato mostrado pros seus usuários. */
  email: {
    supportEmail: "suporte@example.com",
  },
} as const;

export type AppConfig = typeof appConfig;
