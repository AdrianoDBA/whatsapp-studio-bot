"use client";

import {
  ArrowRightIcon,
  BotIcon,
  CheckCircle2Icon,
  ClockIcon,
  MessageCircleIcon,
  QrCodeIcon,
  SparklesIcon,
  ZapIcon,
} from "lucide-react";
import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { BotToggle } from "@/components/whatsapp/bot-toggle";
import type { SecretaryConfig } from "@/lib/whatsapp/secretary-prompt";
import type { WhatsAppStatus } from "@/lib/whatsapp/types";

type Props = {
  orgSlug: string;
  whatsappStatus: WhatsAppStatus;
  whatsappPhone: string | null;
  agentConfig: SecretaryConfig | null;
};

export function GuiaAtivacaoCliente({
  orgSlug,
  whatsappStatus,
  whatsappPhone,
  agentConfig,
}: Props) {
  const isConnected = whatsappStatus === "connected";
  // Consideramos configurada se tem serviços cadastrados ou se o nome foi customizado
  const isConfigured = Boolean(
    agentConfig?.servicesText && agentConfig.servicesText.trim().length > 0,
  );

  const totalFeito = (isConnected ? 1 : 0) + (isConfigured ? 1 : 0);
  const assistenteNome = agentConfig?.assistantName || "Sofia";

  return (
    <Card className="overflow-hidden border-primary/20 bg-linear-to-b from-card via-card to-primary/5 shadow-xs">
      <CardHeader className="pb-3 border-b border-border/40">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="space-y-1">
            <div className="flex items-center gap-2">
              <div className="flex h-7 w-7 items-center justify-center rounded-md bg-primary/10 text-primary">
                <SparklesIcon className="h-4 w-4" />
              </div>
              <CardTitle className="text-base font-semibold">
                Guia Rápido de Ativação da sua Secretária IA
              </CardTitle>
            </div>
            <CardDescription className="text-xs">
              Complete os 2 passos abaixo para que sua secretária atenda seus clientes no WhatsApp 24h por dia.
            </CardDescription>
          </div>

          <div className="flex items-center gap-3">
            <BotToggle orgSlug={orgSlug} initialEnabled={agentConfig?.botActive ?? true} variant="compact" />
            <div className="text-right">
              <span className="text-xs font-semibold text-foreground">
                Progresso: {totalFeito}/2
              </span>
            </div>
            <div className="h-2 w-20 rounded-full bg-muted overflow-hidden">
              <div
                className="h-full bg-primary transition-all duration-500 rounded-full"
                style={{ width: `${(totalFeito / 2) * 100}%` }}
              />
            </div>
          </div>
        </div>
      </CardHeader>

      <CardContent className="p-4 space-y-4">
        {totalFeito === 2 && (
          <div className="flex items-center gap-3 rounded-lg border border-emerald-500/30 bg-emerald-500/10 p-3 text-emerald-800 dark:text-emerald-300">
            <CheckCircle2Icon className="h-5 w-5 shrink-0 text-emerald-600 dark:text-emerald-400" />
            <div className="text-xs space-y-0.5">
              <p className="font-semibold text-emerald-900 dark:text-emerald-200">
                🎉 Parabéns! Sua secretária {assistenteNome} está 100% pronta e ativa no WhatsApp!
              </p>
              <p className="text-emerald-700 dark:text-emerald-400">
                Mande uma mensagem do seu celular pessoal para o número da empresa para testar o atendimento em tempo real.
              </p>
            </div>
          </div>
        )}

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {/* PASSO 1: CONECTAR WHATSAPP */}
          <div
            className={`flex flex-col justify-between rounded-xl border p-4 transition-all ${
              isConnected
                ? "border-emerald-500/30 bg-emerald-50/30 dark:bg-emerald-950/10"
                : "border-primary/30 bg-card hover:border-primary/60 shadow-xs"
            }`}
          >
            <div className="space-y-2.5">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <span className="flex h-6 w-6 items-center justify-center rounded-full bg-primary/10 text-primary font-bold text-xs">
                    1
                  </span>
                  <span className="font-semibold text-sm">Conectar WhatsApp</span>
                </div>
                {isConnected ? (
                  <Badge variant="outline" className="text-[10px] bg-emerald-500/10 text-emerald-600 border-emerald-500/30 gap-1">
                    <CheckCircle2Icon className="h-3 w-3" />
                    Conectado
                  </Badge>
                ) : (
                  <Badge variant="outline" className="text-[10px] bg-amber-500/10 text-amber-600 border-amber-500/30 gap-1">
                    <ClockIcon className="h-3 w-3" />
                    Aguardando QR Code
                  </Badge>
                )}
              </div>

              <p className="text-xs text-muted-foreground leading-relaxed">
                {isConnected ? (
                  <>
                    Aparelho pareado com sucesso{" "}
                    {whatsappPhone && <strong className="text-foreground">({whatsappPhone})</strong>}. A secretária
                    já pode ler e responder mensagens no seu número.
                  </>
                ) : (
                  "Escaneie o QR Code com a câmera do seu celular (igual ao WhatsApp Web) para vincular o número comercial à secretária."
                )}
              </p>
            </div>

            <div className="pt-3">
              <Button
                render={<Link href={`/app/${orgSlug}/whatsapp`} />}
                nativeButton={false}
                size="sm"
                variant={isConnected ? "outline" : "default"}
                className="w-full gap-2 text-xs"
              >
                {isConnected ? (
                  <>
                    <MessageCircleIcon className="h-3.5 w-3.5" />
                    <span>Ver Aparelho Conectado</span>
                  </>
                ) : (
                  <>
                    <QrCodeIcon className="h-3.5 w-3.5" />
                    <span>Conectar Celular (QR Code)</span>
                    <ArrowRightIcon className="h-3 w-3 ml-auto" />
                  </>
                )}
              </Button>
            </div>
          </div>

          {/* PASSO 2: PERSONALIZAR SECRETÁRIA & PREÇOS */}
          <div
            className={`flex flex-col justify-between rounded-xl border p-4 transition-all ${
              isConfigured
                ? "border-emerald-500/30 bg-emerald-50/30 dark:bg-emerald-950/10"
                : "border-primary/30 bg-card hover:border-primary/60 shadow-xs"
            }`}
          >
            <div className="space-y-2.5">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <span className="flex h-6 w-6 items-center justify-center rounded-full bg-primary/10 text-primary font-bold text-xs">
                    2
                  </span>
                  <span className="font-semibold text-sm">Personalizar Secretária</span>
                </div>
                {isConfigured ? (
                  <Badge variant="outline" className="text-[10px] bg-emerald-500/10 text-emerald-600 border-emerald-500/30 gap-1">
                    <CheckCircle2Icon className="h-3 w-3" />
                    Personalizada
                  </Badge>
                ) : (
                  <Badge variant="outline" className="text-[10px] bg-sky-500/10 text-sky-600 border-sky-500/30 gap-1">
                    <ZapIcon className="h-3 w-3" />
                    Ajuste seus Preços
                  </Badge>
                )}
              </div>

              <p className="text-xs text-muted-foreground leading-relaxed">
                {isConfigured ? (
                  <>
                    Secretária configurada como <strong className="text-foreground">{assistenteNome}</strong> com sua
                    tabela de serviços e regras salvas no sistema.
                  </>
                ) : (
                  "Escolha o nome da assistente, o tom de voz e informe seus serviços com preços e horários para ela informar os clientes."
                )}
              </p>
            </div>

            <div className="pt-3">
              <Button
                render={<Link href={`/app/${orgSlug}/agentes/atendimento`} />}
                nativeButton={false}
                size="sm"
                variant={isConfigured ? "outline" : "default"}
                className="w-full gap-2 text-xs"
              >
                <BotIcon className="h-3.5 w-3.5" />
                <span>{isConfigured ? "Revisar Secretária & Preços" : "Personalizar Secretária Agora"}</span>
                <ArrowRightIcon className="h-3 w-3 ml-auto" />
              </Button>
            </div>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
