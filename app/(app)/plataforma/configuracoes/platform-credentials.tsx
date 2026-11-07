"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import {
  AlertTriangleIcon,
  CheckCircle2Icon,
  ExternalLinkIcon,
  KeyRoundIcon,
  Trash2Icon,
  UsersIcon,
} from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { FormProvider, useForm } from "react-hook-form";
import { toast } from "sonner";
import { TextField } from "@/components/forms/form-field";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  CAMPOS_DO_SMTP_DA_RESEND,
  EMAILS_POR_HORA_COM_SMTP_PROPRIO,
  EMAILS_POR_HORA_SEM_SMTP_PROPRIO,
  ENDERECO_DO_SMTP_NO_SUPABASE,
} from "@/lib/email/smtp-do-supabase";
import { formatDateTime } from "@/lib/format";
import type { PlatformAdmin } from "@/lib/platform/queries";
import {
  removePlatformCredentialAction,
  savePlatformCredentialAction,
} from "@/lib/secrets/actions";
import {
  type SavePlatformCredentialInput,
  savePlatformCredentialSchema,
} from "@/lib/secrets/schemas";
import type { CredentialProvider, VaultStatus } from "@/lib/secrets/types";

type ProviderCardData = {
  id: CredentialProvider;
  label: string;
  description: string;
  helpUrl: string;
  keyHint: string;
  /** `null` = ainda não cadastrada. O `masked` JÁ vem mascarado do servidor. */
  saved: { masked: string; label: string; from: string | null; updatedAt: string } | null;
  hasSenderField: boolean;
};

export type PlatformCredentialsProps = {
  /** `false` ⇒ todo botão Salvar fica desligado, com o aviso do que fazer. */
  vaultStatus: VaultStatus;
  local: boolean;
  admins: PlatformAdmin[];
  providers: ProviderCardData[];
};

export function PlatformCredentials({
  vaultStatus,
  local,
  admins,
  providers,
}: PlatformCredentialsProps) {
  return (
    <div className="space-y-8">
      <div className="space-y-1.5">
        <span className="label-mono">/ plataforma</span>
        <h1 className="font-semibold text-3xl tracking-tight">Chaves do sistema</h1>
        <p className="text-muted-foreground text-sm">
          O que você cadastra aqui vale pra <strong className="text-foreground">todos</strong> os
          workspaces do app — e a conta cai na sua. Cada workspace pode cadastrar a chave dele em
          Integrações; quando cadastra, a dele ganha da sua.
        </p>
      </div>

      {vaultStatus !== "ok" && <AvisoChaveMestra status={vaultStatus} local={local} />}

      <div className="space-y-4">
        {providers.map((p) => (
          <ProviderCard key={p.id} data={p} encryptionReady={vaultStatus === "ok"} />
        ))}
      </div>

      <DonosDaPlataforma admins={admins} />
    </div>
  );
}

/**
 * Sem a chave mestra (ENCRYPTION_KEY) o cofre não consegue trancar nada, então
 * não adianta deixar a pessoa digitar a chave e só descobrir no Salvar.
 */
function AvisoChaveMestra({ status, local }: { status: VaultStatus; local: boolean }) {
  // O QUE está errado muda o título; ONDE o app roda muda a instrução.
  // Mandar quem está no `npm run dev` "clicar em Deploy" é mandar procurar um
  // botão que não existe na tela dele.
  const titulo =
    status === "invalida"
      ? "A chave de segurança do sistema não serve"
      : status === "ephemeral"
        ? "A chave de segurança é temporária — o que você salvar agora se perde"
        : "Falta configurar a chave de segurança do sistema";

  const porque =
    status === "invalida"
      ? "O valor que está lá não é uma chave sorteada. Não vale inventar uma frase: o cofre só aceita a chave que o próprio app gera."
      : status === "ephemeral"
        ? "O app sorteou uma chave só pra esta vez, porque não achou nenhuma configurada. Ela muda toda vez que o app reinicia — e aí nada do que você salvar aqui abre de novo."
        : "Sem ela o app não consegue guardar chave nenhuma com segurança.";

  const campo = (
    <code className="rounded bg-muted px-1 py-0.5 font-mono text-foreground text-xs">
      ENCRYPTION_KEY
    </code>
  );

  return (
    <Card className="border-destructive/40 bg-destructive/5">
      <CardContent className="flex gap-3 p-5">
        <AlertTriangleIcon className="mt-0.5 h-4 w-4 shrink-0 text-destructive" />
        <div className="space-y-2 text-sm">
          <p className="font-medium text-destructive">{titulo}</p>
          <p className="text-muted-foreground">{porque}</p>
          {local ? (
            <p className="text-muted-foreground">
              Você está rodando na sua máquina. Gere uma chave com{" "}
              <code className="rounded bg-muted px-1 py-0.5 font-mono text-foreground text-xs">
                npm run gerar-chave
              </code>
              , cole no arquivo{" "}
              <code className="rounded bg-muted px-1 py-0.5 font-mono text-foreground text-xs">
                .env.local
              </code>{" "}
              em {campo}, e reinicie o {""}
              <code className="rounded bg-muted px-1 py-0.5 font-mono text-foreground text-xs">
                npm run dev
              </code>
              .
            </p>
          ) : (
            <p className="text-muted-foreground">
              Abra o registro (log) do app: ele já imprimiu uma chave pronta pra você colar no
              painel, no campo {campo}. Depois de colar, clique em Deploy e volte aqui.
            </p>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

function ProviderCard({
  data,
  encryptionReady,
}: {
  data: ProviderCardData;
  encryptionReady: boolean;
}) {
  const router = useRouter();
  const [salvando, startSave] = useTransition();
  const [apagando, startDelete] = useTransition();
  // Quando já existe chave, o campo começa escondido: quem entra na tela quer
  // conferir o que está cadastrado, não trocar.
  const [trocando, setTrocando] = useState(data.saved === null);

  const form = useForm<SavePlatformCredentialInput>({
    resolver: zodResolver(savePlatformCredentialSchema),
    defaultValues: {
      provider: data.id,
      secret: "",
      label: data.saved?.label ?? "",
      from: data.saved?.from ?? "",
    },
  });

  function onSubmit(values: SavePlatformCredentialInput) {
    startSave(async () => {
      const resultado = await savePlatformCredentialAction(values);
      if (!resultado.ok) {
        toast.error(resultado.error);
        return;
      }
      toast.success(`Chave do ${data.label} guardada.`);
      form.reset({ ...values, secret: "" });
      setTrocando(false);
      router.refresh();
    });
  }

  function apagar() {
    const confirmado = confirm(
      `Apagar a chave do ${data.label}? Os workspaces que dependem dela param de funcionar ` +
        "até você cadastrar outra.",
    );
    if (!confirmado) return;

    startDelete(async () => {
      const resultado = await removePlatformCredentialAction({ provider: data.id });
      if (!resultado.ok) {
        toast.error(resultado.error);
        return;
      }
      toast.success(`Chave do ${data.label} apagada.`);
      setTrocando(true);
      router.refresh();
    });
  }

  return (
    <Card className="overflow-hidden">
      <CardHeader className="flex flex-row items-center justify-between gap-3 border-b border-border/60 bg-card/40 py-3">
        <CardTitle className="flex items-center gap-2">
          <KeyRoundIcon className="h-3.5 w-3.5 text-muted-foreground" />
          <span className="font-medium text-sm">{data.label}</span>
        </CardTitle>
        {data.saved ? (
          <Badge variant="outline" className="gap-1 border-primary/40 bg-primary/10 text-primary">
            <CheckCircle2Icon className="h-3 w-3" />
            cadastrada
          </Badge>
        ) : (
          <Badge variant="outline" className="border-border text-muted-foreground">
            não cadastrada
          </Badge>
        )}
      </CardHeader>

      <CardContent className="space-y-4 p-5">
        <p className="text-muted-foreground text-sm">{data.description}</p>

        {data.saved && (
          <div className="space-y-1 rounded-lg border border-border/60 bg-muted/30 p-3">
            <p className="font-mono text-sm">{data.saved.masked}</p>
            {data.saved.from && (
              <p className="text-muted-foreground text-xs">
                Remetente dos emails: <span className="text-foreground">{data.saved.from}</span>
              </p>
            )}
            <p className="text-muted-foreground text-xs">
              Atualizada em {formatDateTime(data.saved.updatedAt)}
            </p>
          </div>
        )}

        {data.id === "resend" && data.saved && <PassoNoSupabase />}

        {trocando ? (
          <FormProvider {...form}>
            <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
              <TextField
                name="secret"
                control={form.control}
                label={data.saved ? "Nova chave" : "Chave"}
                description={`${data.keyHint}. Cole a chave inteira — ela some da tela assim que você salva.`}
                inputProps={{
                  type: "password",
                  autoComplete: "off",
                  spellCheck: false,
                  placeholder: "Cole aqui",
                }}
              />

              <TextField
                name="label"
                control={form.control}
                label="Apelido"
                description="Opcional. Só pra você lembrar de qual conta é essa chave."
                inputProps={{ placeholder: data.label }}
              />

              {data.hasSenderField && (
                <TextField
                  name="from"
                  control={form.control}
                  label="Remetente dos emails"
                  description="Quem aparece como remetente. Ex.: Meu App <ola@meusite.com>"
                  inputProps={{ placeholder: "Meu App <ola@meusite.com>" }}
                />
              )}

              <div className="flex flex-wrap items-center gap-2">
                <Button type="submit" size="sm" disabled={salvando || !encryptionReady}>
                  {salvando ? "Guardando..." : "Guardar chave"}
                </Button>
                {data.saved && (
                  <Button
                    type="button"
                    size="sm"
                    variant="ghost"
                    onClick={() => {
                      form.reset({
                        provider: data.id,
                        secret: "",
                        label: data.saved?.label ?? "",
                        from: data.saved?.from ?? "",
                      });
                      setTrocando(false);
                    }}
                  >
                    Cancelar
                  </Button>
                )}
                <a
                  href={data.helpUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="ml-auto inline-flex items-center gap-1 text-muted-foreground text-xs hover:text-foreground"
                >
                  Onde pego essa chave
                  <ExternalLinkIcon className="h-3 w-3" />
                </a>
              </div>

              {!encryptionReady && (
                <p className="text-destructive text-xs">
                  Configure a ENCRYPTION_KEY (aviso lá em cima) pra liberar o botão.
                </p>
              )}
            </form>
          </FormProvider>
        ) : (
          <div className="flex flex-wrap items-center gap-2">
            <Button type="button" size="sm" variant="outline" onClick={() => setTrocando(true)}>
              Trocar chave
            </Button>
            <Button
              type="button"
              size="sm"
              variant="ghost"
              onClick={apagar}
              disabled={apagando}
              className="gap-1.5 text-destructive hover:text-destructive"
            >
              <Trash2Icon className="h-3.5 w-3.5" />
              {apagando ? "Apagando..." : "Apagar"}
            </Button>
            <a
              href={data.helpUrl}
              target="_blank"
              rel="noreferrer"
              className="ml-auto inline-flex items-center gap-1 text-muted-foreground text-xs hover:text-foreground"
            >
              Onde pego essa chave
              <ExternalLinkIcon className="h-3 w-3" />
            </a>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

/**
 * O aviso do cartão da Resend: cadastrar a chave aqui NÃO faz a confirmação de
 * conta e a recuperação de senha saírem por ela.
 *
 * Esses dois emails quem manda é o Supabase, com o SMTP dele — a nossa chave
 * nunca é consultada nesse caminho (ver `lib/email/smtp-do-supabase.ts`, que é
 * o dono dos valores e explica por que isto é um texto e não um botão).
 *
 * ⚠️ ESTE AVISO NÃO SOME. Não existe "já fiz": o app não tem como conferir o
 * painel do Supabase, e um botão que só escondesse o aviso mentiria no dia em
 * que o projeto Supabase mudasse.
 */
function PassoNoSupabase() {
  return (
    <div className="space-y-3 rounded-lg border border-amber-500/40 bg-amber-500/5 p-4">
      <div className="flex items-start gap-2">
        <AlertTriangleIcon className="mt-0.5 h-4 w-4 shrink-0 text-amber-500" />
        <div className="space-y-1">
          <p className="font-medium text-sm">Falta um passo, e ele é no Supabase</p>
          <p className="text-muted-foreground text-xs leading-relaxed">
            A chave aí em cima já entrega os emails que{" "}
            <strong className="text-foreground">este app</strong> manda: convite e resultado de
            automação. Mas a{" "}
            <strong className="text-foreground">confirmação de conta</strong> e a{" "}
            <strong className="text-foreground">recuperação de senha</strong> quem manda é o
            Supabase, por conta própria — e o serviço de email embutido dele entrega só{" "}
            <strong className="text-foreground">
              {EMAILS_POR_HORA_SEM_SMTP_PROPRIO} por hora
            </strong>
            . Passou disso, quem tentar criar conta recebe erro e não entra, e você não fica
            sabendo.
          </p>
        </div>
      </div>

      <div className="space-y-2 rounded-md border border-border/60 bg-background/60 p-3">
        <p className="label-mono text-[10px]">cole isto no painel do supabase</p>
        <dl className="space-y-1.5">
          {CAMPOS_DO_SMTP_DA_RESEND.map((campo) => (
            <div key={campo.rotulo} className="flex flex-wrap items-baseline gap-x-2 text-xs">
              <dt className="w-28 shrink-0 text-muted-foreground">{campo.rotulo}</dt>
              <dd className={campo.valor ? "font-mono text-foreground" : "text-muted-foreground"}>
                {campo.valor ?? campo.explicacao}
              </dd>
            </div>
          ))}
        </dl>
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <a
          href={ENDERECO_DO_SMTP_NO_SUPABASE}
          target="_blank"
          rel="noreferrer"
          className="inline-flex items-center gap-1.5 rounded-md border border-border bg-background px-3 py-1.5 font-medium text-xs transition-colors hover:bg-accent"
        >
          Abrir essa tela no Supabase
          <ExternalLinkIcon className="h-3 w-3" />
        </a>
        <p className="text-muted-foreground text-xs">
          Feito isso, o limite sobe pra {EMAILS_POR_HORA_COM_SMTP_PROPRIO} por hora e dá pra pedir
          mais.
        </p>
      </div>
    </div>
  );
}

function DonosDaPlataforma({ admins }: { admins: PlatformAdmin[] }) {
  return (
    <Card className="overflow-hidden">
      <CardHeader className="border-b border-border/60 bg-card/40 py-3">
        <CardTitle className="flex items-center gap-2">
          <UsersIcon className="h-3.5 w-3.5 text-muted-foreground" />
          <span className="label-mono text-[10px]">/ quem é dono do sistema</span>
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3 p-5">
        <ul className="space-y-2">
          {admins.map((a) => (
            <li key={a.userId} className="flex items-center justify-between gap-3 text-sm">
              <span>{a.fullName ?? "(sem nome no perfil)"}</span>
              <span className="font-mono text-muted-foreground text-xs">
                desde {formatDateTime(a.createdAt)}
              </span>
            </li>
          ))}
        </ul>

        {admins.length <= 1 && (
          <p className="rounded-lg border border-border/60 bg-muted/30 p-3 text-muted-foreground text-xs">
            Você é a única pessoa dona do sistema. Se apagar sua conta, ninguém mais consegue mexer
            nestas chaves. Pra colocar outra pessoa, rode no SQL Editor do Supabase:{" "}
            <code className="rounded bg-muted px-1 py-0.5 font-mono text-foreground">
              select add_platform_admin('email@dapessoa.com');
            </code>
          </p>
        )}
      </CardContent>
    </Card>
  );
}
