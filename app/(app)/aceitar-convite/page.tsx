import Link from "next/link";
import { redirect } from "next/navigation";
import type { ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { getCurrentUser } from "@/lib/auth/guards";
import { createClient } from "@/lib/supabase/server";
import { AcceptForm } from "./accept-form";

type Props = { searchParams: Promise<{ token?: string }> };

export const metadata = { title: "Aceitar convite" };

const ROLE_LABEL: Record<"owner" | "admin" | "member", string> = {
  owner: "Dono",
  admin: "Admin",
  member: "Membro",
};

export default async function AcceptInvitePage({ searchParams }: Props) {
  const { token } = await searchParams;
  if (!token) redirect("/");

  const user = await getCurrentUser();

  // Quem chega aqui por email de convite normalmente ainda NÃO tem conta.
  // Precisamos tratar isso ANTES de consultar o banco: as regras de segurança
  // do banco não deixam visitante deslogado ler convite, e a consulta voltaria
  // vazia — fazendo a tela mentir "convite inválido".
  if (!user) {
    const voltarPara = `/aceitar-convite?token=${encodeURIComponent(token)}`;
    return (
      <Centered>
        <h1 className="font-semibold text-2xl">Você foi convidado</h1>
        <p className="text-muted-foreground text-sm">
          Entre com sua conta (ou crie uma) pra aceitar o convite. Use o mesmo email em que você
          recebeu o convite.
        </p>
        <div className="flex flex-col gap-2">
          <Button
            render={<Link href={`/signup?next=${encodeURIComponent(voltarPara)}`} />}
            nativeButton={false}
            className="w-full"
          >
            Criar minha conta
          </Button>
          <Button
            render={<Link href={`/login?next=${encodeURIComponent(voltarPara)}`} />}
            nativeButton={false}
            variant="outline"
            className="w-full"
          >
            Já tenho conta
          </Button>
        </div>
      </Centered>
    );
  }

  const supabase = await createClient();
  const { data: invite } = await supabase
    .from("invitations")
    .select(
      "email, role, expires_at, accepted_at, organization_id, organization:organizations(name, slug)",
    )
    .eq("token", token)
    .maybeSingle();

  if (!invite) {
    return (
      <Centered>
        <h1 className="font-semibold text-2xl">Convite inválido</h1>
        <p className="text-muted-foreground text-sm">
          Esse link de convite não existe ou foi cancelado.
        </p>
      </Centered>
    );
  }

  if (invite.accepted_at) {
    return (
      <Centered>
        <h1 className="font-semibold text-2xl">Convite já aceito</h1>
        <Button render={<Link href="/" />} nativeButton={false}>
          Ir para o app
        </Button>
      </Centered>
    );
  }

  if (new Date(invite.expires_at) < new Date()) {
    return (
      <Centered>
        <h1 className="font-semibold text-2xl">Convite expirado</h1>
        <p className="text-muted-foreground text-sm">Peça um novo convite ao admin.</p>
      </Centered>
    );
  }

  const org = invite.organization;

  // Defensivo: se por algum motivo o nome do workspace não vier (regra de
  // segurança do banco, organização apagada no meio do caminho), mostramos uma
  // tela explicando em vez de quebrar com "Algo deu errado".
  if (!org) {
    return (
      <Centered>
        <h1 className="font-semibold text-2xl">Convite indisponível</h1>
        <p className="text-muted-foreground text-sm">
          Não consegui carregar o workspace desse convite. Ele pode ter sido apagado. Peça um
          convite novo pra quem te chamou.
        </p>
      </Centered>
    );
  }

  if (user.email?.toLowerCase() !== invite.email.toLowerCase()) {
    return (
      <Centered>
        <h1 className="font-semibold text-2xl">Email errado</h1>
        <p className="text-muted-foreground text-sm">
          Esse convite é para outro email. Faça logout e entre com o email correto.
        </p>
      </Centered>
    );
  }

  // R4-HIGH-6: lê role atual (se já é membro) pra mostrar delta na UI.
  // Evita "silent upgrade" — user vê explícito que vai virar admin.
  const { data: existingMembership } = await supabase
    .from("memberships")
    .select("role")
    .eq("organization_id", invite.organization_id)
    .eq("user_id", user.id)
    .maybeSingle();

  const inviteRole = invite.role as "admin" | "member";
  const currentRole = existingMembership?.role as "owner" | "admin" | "member" | undefined;
  const isUpgrade = currentRole === "member" && inviteRole === "admin";
  const isNoOp =
    currentRole === inviteRole ||
    currentRole === "owner" ||
    (currentRole === "admin" && inviteRole === "member");

  return (
    <Centered>
      <h1 className="font-semibold text-2xl">Você foi convidado para {org.name}</h1>
      <p className="text-muted-foreground text-sm">
        Role oferecido: <strong className="text-foreground">{ROLE_LABEL[inviteRole]}</strong>
      </p>

      {currentRole && (
        <div className="rounded border border-border bg-card/40 p-3 text-left text-sm">
          {isUpgrade ? (
            <p>
              Você já é <strong>{ROLE_LABEL[currentRole]}</strong> dessa organização. Aceitar este
              convite vai te <strong>promover a Admin</strong>.
            </p>
          ) : isNoOp ? (
            <p>
              Você já é <strong>{ROLE_LABEL[currentRole]}</strong> dessa organização. Aceitar apenas
              marca o convite como recebido — seu role não muda.
            </p>
          ) : null}
        </div>
      )}

      <AcceptForm token={token} orgName={org.name} />
    </Centered>
  );
}

function Centered({ children }: { children: ReactNode }) {
  return (
    <div className="flex min-h-screen items-center justify-center p-6">
      <div className="w-full max-w-md space-y-4 text-center">{children}</div>
    </div>
  );
}
