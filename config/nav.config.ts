import {
  ActivityIcon,
  BookOpenIcon,
  BotIcon,
  BuildingIcon,
  CalendarClockIcon,
  DollarSignIcon,
  GaugeIcon,
  HomeIcon,
  type LucideIcon,
  PlugIcon,
  ShieldIcon,
  SmartphoneIcon,
  UserIcon,
  UsersIcon,
} from "lucide-react";

export type NavItem = {
  /** Sufixo do path; combinado com /app/{orgSlug} no consumer. */
  path: string;
  label: string;
  icon: LucideIcon;
  /** Restringe item a roles específicos. Sem isso, todos os membros veem. */
  roles?: Array<"owner" | "admin" | "member">;
};

/**
 * Item que fica FORA de qualquer workspace (a área do dono da plataforma).
 *
 * Aqui o endereço é ABSOLUTO, e não um sufixo: `/plataforma/...` não mora
 * dentro de `/app/{orgSlug}`, então o `path` do `NavItem` não serviria.
 */
export type PlatformNavItem = {
  href: string;
  label: string;
  icon: LucideIcon;
};

/**
 * Navegação da barra lateral, dentro de um workspace.
 *
 * Pra adicionar uma nova página, adicione um item aqui e crie a rota em
 * app/(app)/app/[orgSlug]/<sua-pasta>/page.tsx.
 *
 * Tudo que tem `/settings/` no caminho cai no grupo "configurações" da barra
 * lateral — quem monta os grupos é `components/app/sidebar.tsx`.
 */
export const navItems: NavItem[] = [
  { path: "/dashboard", label: "Início", icon: HomeIcon },
  { path: "/agentes", label: "Agentes", icon: BotIcon },
  { path: "/conhecimento", label: "Conhecimento", icon: BookOpenIcon },
  { path: "/whatsapp", label: "WhatsApp & Celular", icon: SmartphoneIcon },
  // ⚠️ SÓ DONO E ADMINISTRADOR VEEM "Automações", e o motivo não é hierarquia:
  // a tela mostra o ENDEREÇO SECRETO dos webhooks. Esconder o item aqui não
  // protege nada sozinho — a página confere de novo, com
  // `requireOrgRole({ roles: ["owner", "admin"] })`.
  {
    path: "/automacoes",
    label: "Automações",
    icon: CalendarClockIcon,
    roles: ["owner", "admin"],
  },
  { path: "/execucoes", label: "Execuções", icon: ActivityIcon },
  // ⚠️ NÃO EXISTE MAIS "Chat IA" aqui. A tela `/ai-demo` foi aposentada: o chat
  // agora é POR AGENTE, em `/agentes/[apelido]/conversar` — com as instruções,
  // o modelo e as ferramentas que o aluno escolheu, e com rastro de custo. Um
  // item de menu apontando pra `/ai-demo` viraria um 404 na cara de todo mundo.
  //
  // Pelo mesmo motivo não existe item de menu pra "Conversas": conversa é
  // sempre COM UM AGENTE, e o caminho é Agentes → abrir o agente → Conversar.
  { path: "/settings/members", label: "Membros", icon: UsersIcon },
  {
    path: "/settings/integracoes",
    label: "Integrações",
    icon: PlugIcon,
    roles: ["owner", "admin"],
  },
  {
    path: "/settings/organization",
    label: "Workspace",
    icon: BuildingIcon,
    roles: ["owner", "admin"],
  },
  // ⚠️ SÓ DONO E ADMINISTRADOR VEEM "Limites de IA": mexer no teto é mexer no
  // que o time inteiro consegue fazer. Membro comum não fica sem informação —
  // a faixa do topo diz o número e manda pedir pra quem administra. Esconder o
  // item não protege nada sozinho: a página confere de novo, com
  // `requireOrgRole({ roles: ["owner", "admin"] })`.
  {
    path: "/settings/limites",
    label: "Limites de IA",
    icon: GaugeIcon,
    roles: ["owner", "admin"],
  },
  { path: "/settings/profile", label: "Meu perfil", icon: UserIcon },
];

/**
 * Navegação da área do dono da plataforma.
 *
 * Só aparece na barra lateral pra quem está na tabela `platform_admins` — e a
 * própria página confere de novo, com `requirePlatformAdmin()`. Esconder o
 * link não protege nada sozinho; é só pra não poluir a tela de quem não usa.
 */
export const platformNavItems: PlatformNavItem[] = [
  {
    href: "/plataforma/configuracoes",
    label: "Configurações da plataforma",
    icon: ShieldIcon,
  },
  {
    href: "/plataforma/gastos",
    label: "Gastos por workspace",
    icon: DollarSignIcon,
  },
];
