import { ArrowLeftIcon, ShieldIcon } from "lucide-react";
import Link from "next/link";
import type { ReactNode } from "react";
import { ThemeToggle } from "@/components/app/theme-toggle";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { requirePlatformAdmin } from "@/lib/auth/guards";
import { getUserOrgs } from "@/lib/orgs/queries";

/**
 * A casca da área do DONO DA PLATAFORMA.
 *
 * É uma casca própria, e não a do workspace, porque nada aqui pertence a um
 * workspace: a chave cadastrada nesta área vale pra todos eles. Reaproveitar a
 * barra lateral do workspace obrigaria a inventar um "workspace atual" que não
 * existe.
 *
 * O `requirePlatformAdmin()` aqui protege TODA página desta pasta de uma vez.
 * Quem não é dono é levado de volta pro próprio painel, sem nem saber que esta
 * área existe.
 */

// Páginas autenticadas são sempre dinâmicas: sem isso, um proxy no meio do
// caminho poderia guardar o HTML de uma pessoa e mostrar pra outra.
export const dynamic = "force-dynamic";

export default async function PlataformaLayout({ children }: { children: ReactNode }) {
  const user = await requirePlatformAdmin();

  // Link de volta pro app. Um dono da plataforma normalmente também tem
  // workspace; se não tiver nenhum, o caminho de volta é criar o primeiro.
  const orgs = await getUserOrgs(user.id);
  const voltarPara = orgs[0] ? `/app/${orgs[0].organization.slug}/dashboard` : "/onboarding";

  return (
    <div className="min-h-screen bg-background">
      <header className="sticky top-0 z-10 flex h-14 items-center gap-3 border-b border-border bg-background/80 px-4 backdrop-blur-md">
        <div className="flex items-center gap-2">
          <div className="grid h-7 w-7 place-items-center rounded-md border border-border bg-card text-primary">
            <ShieldIcon className="h-3.5 w-3.5" />
          </div>
          <span className="label-mono">plataforma</span>
        </div>

        <Separator orientation="vertical" className="h-5" />

        <span className="hidden text-muted-foreground text-sm sm:inline">
          Área do dono do sistema
        </span>

        <div className="flex-1" />

        <ThemeToggle />
        <Button
          render={<Link href={voltarPara} />}
          nativeButton={false}
          variant="outline"
          size="sm"
          className="gap-1.5"
        >
          <ArrowLeftIcon className="h-3.5 w-3.5" />
          Voltar pro app
        </Button>
      </header>

      <main className="mx-auto w-full max-w-4xl p-6 pb-24">{children}</main>
    </div>
  );
}
