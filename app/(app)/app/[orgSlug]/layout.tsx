import { notFound } from "next/navigation";
import type { ReactNode } from "react";
import { BudgetBanner } from "@/components/app/budget-banner";
import { AppHeader } from "@/components/app/header";
import { AppSidebar } from "@/components/app/sidebar";
import { SidebarInset, SidebarProvider } from "@/components/ui/sidebar";
import { isPlatformAdmin, requireOrgMember } from "@/lib/auth/guards";
import { getBudgetStatus } from "@/lib/limits/queries";
import { getUserOrgs } from "@/lib/orgs/queries";
import { createClient } from "@/lib/supabase/server";

// M-14: páginas autenticadas sempre dinâmicas, com `Cache-Control: private,
// no-store` herdado do response (Next adiciona em rotas dynamic). Sem isso,
// proxies CDN podem cachear HTML com dados do user.
export const dynamic = "force-dynamic";

type Props = {
  children: ReactNode;
  params: Promise<{ orgSlug: string }>;
};

export default async function AppLayout({ children, params }: Props) {
  const { orgSlug } = await params;
  const { user, org, role } = await requireOrgMember({ orgSlug });
  const orgs = await getUserOrgs(user.id);
  // Só pra decidir se a barra lateral mostra o grupo "plataforma". A tela em
  // si confere de novo com requirePlatformAdmin().
  const donoDaPlataforma = await isPlatformAdmin(user.id);

  const supabase = await createClient();

  // As duas leituras não dependem uma da outra, então elas vão juntas: o teto
  // entra em TODA página do workspace, e uma ida a mais ao banco em fila
  // atrasaria a tela inteira.
  //
  // ⚠️ `getBudgetStatus` NUNCA LANÇA — ela devolve `null` quando não deu pra
  // ler. É por isso que ela pode morar no layout: uma leitura que piscou some a
  // faixa daquela volta, e não derruba todas as telas do workspace.
  const [{ data: profile }, teto] = await Promise.all([
    supabase.from("profiles").select("full_name, avatar_url").eq("id", user.id).maybeSingle(),
    getBudgetStatus({ organizationId: org.id, supabase }),
  ]);

  if (!profile) notFound();

  return (
    <SidebarProvider>
      <AppSidebar
        orgSlug={orgSlug}
        currentOrg={{
          id: org.id,
          slug: org.slug,
          name: org.name,
          logo_url: org.logo_url,
        }}
        orgs={orgs.map((m) => m.organization)}
        currentRole={role}
        isPlatformAdmin={donoDaPlataforma}
      />
      {/* ⚠️ `min-w-0` NÃO É ENFEITE. Esta área é um item de flex, e item de flex
          nasce com `min-width: auto` — ou seja, ele CRESCE até caber o conteúdo
          em vez de deixar o conteúdo rolar. Com uma tabela larga dentro, a
          página inteira passava a rolar pro lado entre ~800 e ~1100 px de
          largura (notebook pequeno e tablet): a barra lateral saía do lugar e a
          última coluna ficava cortada. Com `min-w-0`, quem rola é a tabela,
          dentro do cartão dela — que é o que o `overflow-x-auto` do
          `components/ui/table.tsx` sempre quis fazer. */}
      <SidebarInset className="min-w-0">
        <AppHeader
          orgSlug={orgSlug}
          user={{
            fullName: profile.full_name,
            email: user.email ?? "",
            avatarUrl: profile.avatar_url,
          }}
        />
        <main className="min-w-0 flex-1 p-6 pb-24">
          {/* A faixa do teto vem ANTES do conteúdo e em toda página: quando os
              agentes param, a pessoa está no chat ou em Automações — não em
              Configurações. Ela some sozinha quando não há o que dizer. */}
          <BudgetBanner status={teto} role={role} orgSlug={orgSlug} />
          {children}
        </main>
      </SidebarInset>
    </SidebarProvider>
  );
}
