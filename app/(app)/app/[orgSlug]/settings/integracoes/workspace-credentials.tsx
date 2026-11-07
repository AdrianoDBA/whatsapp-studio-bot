"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import {
  AlertTriangleIcon,
  ExternalLinkIcon,
  KeyRoundIcon,
  ServerIcon,
  UserIcon,
} from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { FormProvider, useForm } from "react-hook-form";
import { toast } from "sonner";
import { TextField } from "@/components/forms/form-field";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { formatDateTime } from "@/lib/format";
import { removeOrgCredentialAction, saveOrgCredentialAction } from "@/lib/secrets/actions";
import { type SaveOrgCredentialInput, saveOrgCredentialSchema } from "@/lib/secrets/schemas";
import type { CredentialProvider, CredentialSource } from "@/lib/secrets/types";

type ProviderCardData = {
  id: CredentialProvider;
  label: string;
  description: string;
  helpUrl: string;
  keyHint: string;
  /** O workspace tem chave própria? `null` = está usando a da plataforma. */
  saved: { masked: string; updatedAt: string } | null;
  /** O dono do sistema cadastrou chave desse provedor? */
  platformHasKey: boolean;
  /** De onde a chave sai HOJE. Calculado no servidor. */
  activeSource: CredentialSource | null;
};

export type WorkspaceCredentialsProps = {
  orgSlug: string;
  encryptionReady: boolean;
  /** Só provedor de IA. O Resend fica só na tela da plataforma. */
  providers: ProviderCardData[];
};

export function WorkspaceCredentials({
  orgSlug,
  encryptionReady,
  providers,
}: WorkspaceCredentialsProps) {
  return (
    <div className="max-w-3xl space-y-8">
      <div className="space-y-1.5">
        <span className="label-mono">/ integrações</span>
        <h1 className="font-semibold text-3xl tracking-tight">Integrações</h1>
        <p className="text-muted-foreground text-sm">
          Aqui você escolhe <strong className="text-foreground">quem paga a conta</strong> da
          inteligência artificial neste workspace: o dono do sistema ou você.
        </p>
      </div>

      {!encryptionReady && (
        <Card className="border-destructive/40 bg-destructive/5">
          <CardContent className="flex gap-3 p-5">
            <AlertTriangleIcon className="mt-0.5 h-4 w-4 shrink-0 text-destructive" />
            <div className="space-y-1 text-sm">
              <p className="font-medium text-destructive">
                O sistema ainda não está pronto pra guardar chave
              </p>
              <p className="text-muted-foreground">
                Fale com quem cuida do app: falta configurar a chave de segurança (ENCRYPTION_KEY)
                no painel. Enquanto isso, dá pra usar a chave da plataforma, mas não dá pra
                cadastrar a sua.
              </p>
            </div>
          </CardContent>
        </Card>
      )}

      <div className="space-y-4">
        {providers.map((p) => (
          <ProviderCard key={p.id} orgSlug={orgSlug} data={p} encryptionReady={encryptionReady} />
        ))}
      </div>
    </div>
  );
}

function ProviderCard({
  orgSlug,
  data,
  encryptionReady,
}: {
  orgSlug: string;
  data: ProviderCardData;
  encryptionReady: boolean;
}) {
  const router = useRouter();
  const [salvando, startSave] = useTransition();
  const [trocando, startSwitch] = useTransition();
  // O formulário da chave própria só abre quando a pessoa pede.
  const [abrindoFormulario, setAbrindoFormulario] = useState(false);

  const usandoAPropria = data.saved !== null;

  const form = useForm<SaveOrgCredentialInput>({
    resolver: zodResolver(saveOrgCredentialSchema),
    defaultValues: { orgSlug, provider: data.id, secret: "" },
  });

  function onSubmit(values: SaveOrgCredentialInput) {
    startSave(async () => {
      const resultado = await saveOrgCredentialAction(values);
      if (!resultado.ok) {
        toast.error(resultado.error);
        return;
      }
      toast.success(`Agora este workspace usa a sua chave do ${data.label}.`);
      form.reset({ orgSlug, provider: data.id, secret: "" });
      setAbrindoFormulario(false);
      router.refresh();
    });
  }

  /** Voltar pra chave da plataforma APAGA o segredo guardado aqui. */
  function voltarPraPlataforma() {
    // O aviso muda conforme exista ou não chave da plataforma pra cair de
    // volta. Sem esse cuidado, alguém apagaria a própria chave achando que ia
    // "voltar pro padrão" e ficaria com o provedor desligado.
    const confirmado = confirm(
      data.platformHasKey
        ? "Isso apaga a chave que está guardada aqui. Pra voltar, você vai precisar colar ela " +
            "de novo. Pode apagar?"
        : "Isso apaga a chave que está guardada aqui. Como o dono do sistema não cadastrou " +
            "nenhuma, os modelos deste provedor vão PARAR DE FUNCIONAR até você cadastrar " +
            "outra. Pode apagar?",
    );
    if (!confirmado) return;

    startSwitch(async () => {
      const resultado = await removeOrgCredentialAction({ orgSlug, provider: data.id });
      if (!resultado.ok) {
        toast.error(resultado.error);
        return;
      }
      toast.success(
        data.platformHasKey
          ? "Este workspace voltou a usar a chave do dono do sistema."
          : "Sua chave foi apagada. Cadastre outra pra voltar a usar este provedor.",
      );
      setAbrindoFormulario(false);
      router.refresh();
    });
  }

  const ocupado = salvando || trocando;

  return (
    <Card className="overflow-hidden">
      <CardHeader className="flex flex-row items-center justify-between gap-3 border-b border-border/60 bg-card/40 py-3">
        <CardTitle className="flex items-center gap-2">
          <KeyRoundIcon className="h-3.5 w-3.5 text-muted-foreground" />
          <span className="font-medium text-sm">{data.label}</span>
        </CardTitle>
        <FaixaQuemPaga usandoAPropria={usandoAPropria} origem={data.activeSource} />
      </CardHeader>

      <CardContent className="space-y-4 p-5">
        <p className="text-muted-foreground text-sm">{data.description}</p>

        {data.activeSource === null && (
          <p className="rounded-lg border border-border/60 bg-muted/30 p-3 text-sm">
            Ninguém cadastrou chave desse provedor ainda — nem você, nem o dono do sistema. Os
            modelos dele não vão funcionar até alguém cadastrar.
          </p>
        )}

        {data.activeSource === "env" && (
          <p className="rounded-lg border border-chart-3/40 bg-chart-3/10 p-3 text-sm">
            Hoje está usando a chave que está nas variáveis do servidor. Funciona, mas o jeito
            recomendado agora é cadastrar aqui.
          </p>
        )}

        {/* ------------------------------------------------------------- */}
        {/* Opção A — a chave do dono do sistema                           */}
        {/* ------------------------------------------------------------- */}
        <Opcao
          titulo="Usar a chave da plataforma"
          descricao="Quem paga: o dono do sistema. Você não precisa de conta em lugar nenhum."
          icone={<ServerIcon className="h-3.5 w-3.5" />}
          ativa={!usandoAPropria && data.platformHasKey}
          desabilitada={!data.platformHasKey}
          motivoDesabilitada={
            data.activeSource === "env"
              ? "Hoje a chave vem das variáveis do servidor, não do painel. Funciona, mas quem cuida do sistema deveria cadastrar pelas telas — é o único jeito de trocar sem reiniciar o app."
              : "O dono do sistema ainda não cadastrou uma chave aqui. Por enquanto só dá pra usar a sua própria."
          }
          acao={
            usandoAPropria && data.platformHasKey ? (
              <Button
                type="button"
                size="sm"
                variant="outline"
                onClick={voltarPraPlataforma}
                disabled={ocupado}
              >
                {trocando ? "Trocando..." : "Usar esta"}
              </Button>
            ) : null
          }
        />

        {/* ------------------------------------------------------------- */}
        {/* Opção B — a chave do próprio time                              */}
        {/* ------------------------------------------------------------- */}
        <Opcao
          titulo="Usar a minha chave"
          descricao={`Quem paga: você. A cobrança cai na sua conta da ${data.label}.`}
          icone={<UserIcon className="h-3.5 w-3.5" />}
          ativa={usandoAPropria}
          desabilitada={false}
          acao={
            usandoAPropria || abrindoFormulario ? null : (
              <Button
                type="button"
                size="sm"
                variant="outline"
                onClick={() => setAbrindoFormulario(true)}
                disabled={!encryptionReady}
              >
                Cadastrar a minha
              </Button>
            )
          }
        >
          {usandoAPropria && data.saved && (
            <div className="space-y-1 rounded-lg border border-border/60 bg-muted/30 p-3">
              <p className="font-mono text-sm">{data.saved.masked}</p>
              <p className="text-muted-foreground text-xs">
                Cadastrada em {formatDateTime(data.saved.updatedAt)}
              </p>
            </div>
          )}

          {usandoAPropria && (
            <Button
              type="button"
              size="sm"
              variant="ghost"
              onClick={voltarPraPlataforma}
              disabled={ocupado}
              className="text-destructive hover:text-destructive"
            >
              {trocando ? "Apagando..." : "Apagar minha chave"}
            </Button>
          )}

          {(abrindoFormulario || usandoAPropria) && (
            <FormProvider {...form}>
              <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-3 pt-1">
                <TextField
                  name="secret"
                  control={form.control}
                  label={usandoAPropria ? "Trocar por outra chave" : "Sua chave"}
                  description={`${data.keyHint}. Cole a chave inteira — ela some da tela assim que você salva.`}
                  inputProps={{
                    type: "password",
                    autoComplete: "off",
                    spellCheck: false,
                    placeholder: "Cole aqui",
                  }}
                />
                <div className="flex flex-wrap items-center gap-2">
                  <Button type="submit" size="sm" disabled={ocupado || !encryptionReady}>
                    {salvando ? "Guardando..." : "Guardar minha chave"}
                  </Button>
                  {!usandoAPropria && (
                    <Button
                      type="button"
                      size="sm"
                      variant="ghost"
                      onClick={() => setAbrindoFormulario(false)}
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
              </form>
            </FormProvider>
          )}
        </Opcao>
      </CardContent>
    </Card>
  );
}

/** A faixa do topo do cartão: quem está pagando a conta desse provedor hoje. */
function FaixaQuemPaga({
  usandoAPropria,
  origem,
}: {
  usandoAPropria: boolean;
  origem: "workspace" | "platform" | "env" | null;
}) {
  // Chave que vem das variáveis do servidor NÃO é "a chave do dono do
  // sistema": ninguém cadastrou nada no painel. Acender esse lado dizia uma
  // coisa que a própria tela desmentia três linhas abaixo, em "o dono do
  // sistema ainda não cadastrou uma chave aqui".
  const daPlataforma = !usandoAPropria && origem === "platform";
  return (
    <div className="flex items-center gap-1.5">
      <span className="label-mono hidden text-[10px] sm:inline">quem paga</span>
      <div className="flex items-center gap-1 rounded-md border border-border bg-input p-0.5">
        <span
          className={`rounded-sm px-2 py-0.5 text-[11px] ${
            usandoAPropria
              ? "bg-primary font-medium text-primary-foreground"
              : "text-muted-foreground"
          }`}
        >
          Você
        </span>
        <span
          className={`rounded-sm px-2 py-0.5 text-[11px] ${
            daPlataforma
              ? "bg-primary font-medium text-primary-foreground"
              : "text-muted-foreground"
          }`}
        >
          O dono do sistema
        </span>
      </div>
    </div>
  );
}

function Opcao({
  titulo,
  descricao,
  icone,
  ativa,
  desabilitada,
  motivoDesabilitada,
  acao,
  children,
}: {
  titulo: string;
  descricao: string;
  icone: React.ReactNode;
  ativa: boolean;
  desabilitada: boolean;
  motivoDesabilitada?: string;
  acao?: React.ReactNode;
  children?: React.ReactNode;
}) {
  return (
    <div
      className={`space-y-3 rounded-lg border p-4 ${
        ativa ? "border-primary/40 bg-primary/5" : "border-border/60"
      } ${desabilitada ? "opacity-60" : ""}`}
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="space-y-1">
          <p className="flex items-center gap-2 font-medium text-sm">
            <span className={ativa ? "text-primary" : "text-muted-foreground"}>{icone}</span>
            {titulo}
            {ativa && <span className="label-mono text-[10px] text-primary">em uso</span>}
          </p>
          <p className="text-muted-foreground text-sm">{descricao}</p>
          {desabilitada && motivoDesabilitada && (
            <p className="text-muted-foreground text-xs">{motivoDesabilitada}</p>
          )}
        </div>
        {!desabilitada && acao}
      </div>
      {children}
    </div>
  );
}
