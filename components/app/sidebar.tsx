"use client";

import { SettingsIcon } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
} from "@/components/ui/sidebar";
import {
  navItems as configuredNavItems,
  platformNavItems as configuredPlatformItems,
} from "@/config/nav.config";
import { appConfig } from "@/config/app.config";
import { OrgSwitcher, type OrgSwitcherOrg } from "./org-switcher";

type Props = {
  orgSlug: string;
  currentOrg: OrgSwitcherOrg;
  orgs: OrgSwitcherOrg[];
  currentRole: "owner" | "admin" | "member";
  /**
   * Essa pessoa é dona da plataforma? Quem é vê um grupo a mais na barra, com
   * a tela de chaves que vale pra todos os workspaces.
   *
   * Esconder o link NÃO é a proteção: a própria página confere de novo, com
   * `requirePlatformAdmin()`. Isto aqui só evita mostrar pra quem não usa.
   */
  isPlatformAdmin: boolean;
};

type NavRenderItem = {
  href: string;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
};

export function AppSidebar({ orgSlug, currentOrg, orgs, currentRole, isPlatformAdmin }: Props) {
  const pathname = usePathname();
  const base = `/app/${orgSlug}`;

  const allItems: NavRenderItem[] = configuredNavItems
    .filter((item) => !item.roles || item.roles.includes(currentRole))
    .map((item) => ({
      href: `${base}${item.path}`,
      label: item.label,
      icon: item.icon,
    }));

  const mainItems = allItems.filter((i) => !i.href.includes("/settings/"));
  const settingsItems = allItems.filter((i) => i.href.includes("/settings/"));

  return (
    <Sidebar collapsible="icon">
      <SidebarHeader className="border-b border-sidebar-border">
        <OrgSwitcher current={currentOrg} orgs={orgs} />
      </SidebarHeader>
      <SidebarContent>
        <SidebarGroup>
          <SidebarGroupLabel className="label-mono px-3 pt-1 text-[10px]">
            workspace
          </SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>
              {mainItems.map((item) => (
                <NavLink key={item.href} item={item} pathname={pathname} />
              ))}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>

        {settingsItems.length > 0 && (
          <SidebarGroup>
            <SidebarGroupLabel className="label-mono px-3 pt-1 text-[10px]">
              configurações
            </SidebarGroupLabel>
            <SidebarGroupContent>
              <SidebarMenu>
                {settingsItems.map((item) => (
                  <NavLink key={item.href} item={item} pathname={pathname} />
                ))}
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>
        )}

        {isPlatformAdmin && (
          <SidebarGroup>
            <SidebarGroupLabel className="label-mono px-3 pt-1 text-[10px]">
              plataforma
            </SidebarGroupLabel>
            <SidebarGroupContent>
              <SidebarMenu>
                {configuredPlatformItems.map((item) => (
                  <NavLink
                    key={item.href}
                    item={{ href: item.href, label: item.label, icon: item.icon }}
                    pathname={pathname}
                  />
                ))}
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>
        )}
      </SidebarContent>
      <SidebarFooter className="border-t border-sidebar-border">
        <div className="flex items-center justify-between px-2 py-1.5">
          <span className="label-mono">v{appConfig.version}</span>
          <Link
            href={`${base}/settings/profile`}
            className="grid h-7 w-7 place-items-center rounded-md text-muted-foreground transition-colors hover:bg-sidebar-accent hover:text-foreground"
            aria-label="Configurações"
          >
            <SettingsIcon className="h-3.5 w-3.5" />
          </Link>
        </div>
      </SidebarFooter>
    </Sidebar>
  );
}

function NavLink({ item, pathname }: { item: NavRenderItem; pathname: string }) {
  const active = pathname === item.href || pathname.startsWith(`${item.href}/`);
  const Icon = item.icon;

  return (
    <SidebarMenuItem>
      <SidebarMenuButton
        render={<Link href={item.href} />}
        isActive={active}
        tooltip={item.label}
        className="relative h-8"
      >
        {active && <span className="absolute inset-y-1 left-0 w-0.5 rounded-r-full bg-primary" />}
        <Icon className={`h-4 w-4 ${active ? "text-primary" : ""}`} />
        <span className={active ? "font-medium text-foreground" : ""}>{item.label}</span>
      </SidebarMenuButton>
    </SidebarMenuItem>
  );
}
