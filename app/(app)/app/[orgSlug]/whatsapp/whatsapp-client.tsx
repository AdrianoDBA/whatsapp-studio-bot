"use client";

import { useEffect, useState, useCallback } from "react";
import Link from "next/link";
import { toast } from "sonner";
import {
  QrCodeIcon,
  SmartphoneIcon,
  PlugIcon,
  CheckCircle2Icon,
  AlertCircleIcon,
  RefreshCwIcon,
  Trash2Icon,
  SparklesIcon,
  ArrowRightIcon,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { BotToggle } from "@/components/whatsapp/bot-toggle";
import {
  consultarStatusWhatsAppAction,
  desconectarWhatsAppAction,
  salvarCloudApiAction,
  solicitarQrCodeAction,
} from "@/lib/whatsapp/actions";
import type { WhatsAppInstance } from "@/lib/whatsapp/types";

type Props = {
  orgSlug: string;
  initialInstance: WhatsAppInstance | null;
};

export function WhatsAppClient({ orgSlug, initialInstance }: Props) {
  const [instance, setInstance] = useState<WhatsAppInstance | null>(initialInstance);
  const [isLoading, setIsLoading] = useState(false);
  const [qrBase64, setQrBase64] = useState<string | null>(initialInstance?.qr_code || null);

  // Formulário Cloud API
  const [phoneNumberId, setPhoneNumberId] = useState(initialInstance?.cloud_phone_number_id || "");
  const [wabaId, setWabaId] = useState(initialInstance?.cloud_waba_id || "");
  const [accessToken, setAccessToken] = useState(initialInstance?.cloud_access_token || "");
  const [phoneNumber, setPhoneNumber] = useState(initialInstance?.phone_number || "");

  const isConnected = instance?.status === "connected";

  const verificarStatus = useCallback(
    async (silencioso = false) => {
      try {
        const res = await consultarStatusWhatsAppAction({ orgSlug });
        if (res.ok && res.data) {
          if (res.data.isConnected) {
            setInstance((prev) => ({
              ...(prev || {
                id: "",
                organization_id: "",
                instance_name: "Principal",
                provider: "baileys",
                status: "connected",
                bot_enabled: true,
                qr_code: null,
                phone_number: res.data?.phoneNumber || null,
                cloud_phone_number_id: null,
                cloud_waba_id: null,
                cloud_access_token: null,
                connected_at: new Date().toISOString(),
                last_seen_at: null,
                created_at: new Date().toISOString(),
                updated_at: new Date().toISOString(),
              }),
              status: "connected",
              phone_number: res.data?.phoneNumber || prev?.phone_number || null,
              qr_code: null,
            }));
            setQrBase64(null);
            if (!silencioso) {
              toast.success("WhatsApp conectado com sucesso!");
            }
            return true;
          } else if (res.data.qrCode && res.data.qrCode !== qrBase64) {
            setQrBase64(res.data.qrCode);
          }
        }
      } catch {
        // Silencia falha temporária de rede no polling
      }
      return false;
    },
    [orgSlug, qrBase64],
  );

  // Polling automático a cada 2.5s para detectar quando o celular ler o QR Code
  useEffect(() => {
    if (isConnected) return;

    let cancelado = false;
    let timer: NodeJS.Timeout | null = null;

    async function tick() {
      if (cancelado) return;
      const conectado = await verificarStatus(false);
      if (!conectado && !cancelado) {
        timer = setTimeout(tick, 2500);
      }
    }

    timer = setTimeout(tick, 1500);

    return () => {
      cancelado = true;
      if (timer) clearTimeout(timer);
    };
  }, [isConnected, verificarStatus]);

  async function handleGerarQr() {
    setIsLoading(true);
    try {
      const res = await solicitarQrCodeAction({ orgSlug });
      if (!res.ok) {
        toast.error(res.error || "Erro ao gerar QR Code.");
      } else if (res.data) {
        setQrBase64(res.data.qrCode);
        toast.success("QR Code gerado! Aponte o celular para conectar.");
      }
    } catch {
      toast.error("Erro inesperado de conexão com o servidor.");
    } finally {
      setIsLoading(false);
    }
  }

  async function handleVerificarManual() {
    setIsLoading(true);
    try {
      const conectado = await verificarStatus(false);
      if (!conectado) {
        toast.info("Ainda aguardando leitura do QR Code pelo celular.");
      }
    } finally {
      setIsLoading(false);
    }
  }

  async function handleDesconectar() {
    if (!confirm("Tem certeza que deseja desconectar o WhatsApp da sua organização?")) return;
    setIsLoading(true);
    try {
      const res = await desconectarWhatsAppAction({ orgSlug });
      if (res.ok) {
        setInstance((prev) => (prev ? { ...prev, status: "disconnected", phone_number: null, qr_code: null } : null));
        setQrBase64(null);
        toast.success("WhatsApp desconectado com sucesso.");
      } else {
        toast.error(res.error || "Erro ao desconectar.");
      }
    } catch {
      toast.error("Erro inesperado ao desconectar.");
    } finally {
      setIsLoading(false);
    }
  }

  async function handleSalvarCloudApi(e: React.FormEvent) {
    e.preventDefault();
    setIsLoading(true);
    try {
      const res = await salvarCloudApiAction({
        orgSlug,
        input: {
          phoneNumberId,
          wabaId,
          accessToken,
          phoneNumber,
        },
      });
      if (res.ok) {
        toast.success("Credenciais da Meta Cloud API salvas com sucesso!");
        setInstance((prev) => (prev ? { ...prev, status: "connected", provider: "cloud_api", phone_number: phoneNumber } : null));
      } else {
        toast.error(res.error || "Falha ao validar credenciais da Meta.");
      }
    } catch {
      toast.error("Erro ao salvar configuração.");
    } finally {
      setIsLoading(false);
    }
  }

  return (
    <div className="space-y-6">
      {/* Status da Instância */}
      <Card className="border-border/60 bg-card/60 backdrop-blur">
        <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-3">
          <div className="space-y-1">
            <CardTitle className="text-xl font-semibold flex items-center gap-2">
              <SmartphoneIcon className="h-5 w-5 text-emerald-500" />
              Conexão com WhatsApp & Celular
            </CardTitle>
            <CardDescription>
              Associe o número de celular da sua empresa ao Agente de Atendimento inteligente.
            </CardDescription>
          </div>
          <div className="flex items-center gap-2">
            <BotToggle orgSlug={orgSlug} initialEnabled={instance?.bot_enabled ?? true} variant="compact" />
            {isConnected ? (
              <Badge variant="outline" className="bg-emerald-500/10 text-emerald-500 border-emerald-500/30 flex items-center gap-1.5 py-1 px-3">
                <CheckCircle2Icon className="h-4 w-4" />
                Conectado
              </Badge>
            ) : qrBase64 ? (
              <Badge variant="outline" className="bg-amber-500/10 text-amber-500 border-amber-500/30 flex items-center gap-1.5 py-1 px-3">
                <RefreshCwIcon className="h-4 w-4 animate-spin" />
                Aguardando Leitura
              </Badge>
            ) : (
              <Badge variant="outline" className="bg-destructive/10 text-destructive border-destructive/30 flex items-center gap-1.5 py-1 px-3">
                <AlertCircleIcon className="h-4 w-4" />
                Desconectado
              </Badge>
            )}
          </div>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4 pt-2 border-t border-border/40 text-sm">
            <div>
              <span className="text-muted-foreground block text-xs">Número Vinculado:</span>
              <span className="font-mono font-medium">{instance?.phone_number || "Nenhum número conectado"}</span>
            </div>
            <div>
              <span className="text-muted-foreground block text-xs">Método de Conexão:</span>
              <span className="capitalize">{instance?.provider === "cloud_api" ? "Meta Cloud API Oficial" : "WhatsApp Web (QR Code)"}</span>
            </div>
            <div>
              <span className="text-muted-foreground block text-xs">Ações Rápidas:</span>
              {isConnected ? (
                <Button variant="destructive" size="sm" onClick={handleDesconectar} disabled={isLoading} className="h-8">
                  <Trash2Icon className="h-3.5 w-3.5 mr-1" />
                  Desconectar
                </Button>
              ) : (
                <Button size="sm" onClick={handleGerarQr} disabled={isLoading} className="h-8 bg-emerald-600 hover:bg-emerald-700 text-white">
                  <QrCodeIcon className="h-3.5 w-3.5 mr-1" />
                  Conectar Aparelho
                </Button>
              )}
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Controle de Ligar / Desligar Bot de Atendimento */}
      <BotToggle orgSlug={orgSlug} initialEnabled={instance?.bot_enabled ?? true} variant="card" />

      {/* Atalho para Personalização da Secretária */}
      <Card className="border-primary/30 bg-primary/5">
        <CardContent className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 p-4">
          <div className="flex items-start gap-3">
            <div className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-primary/10 text-primary">
              <SparklesIcon className="h-5 w-5" />
            </div>
            <div>
              <p className="font-semibold text-sm">Personalizar Secretária & Serviços</p>
              <p className="text-xs text-muted-foreground">
                Defina o nome da assistente, tom de conversa e a tabela de preços/serviços que ela
                usará para responder seus clientes neste WhatsApp.
              </p>
            </div>
          </div>
          <Button
            render={<Link href={`/app/${orgSlug}/agentes/atendimento`} />}
            nativeButton={false}
            size="sm"
            className="shrink-0 gap-1.5"
          >
            Personalizar Atendimento
            <ArrowRightIcon className="h-4 w-4" />
          </Button>
        </CardContent>
      </Card>

      {/* Abas de Configuração de Conexão */}
      <Tabs defaultValue="baileys" className="w-full">
        <TabsList className="grid w-full grid-cols-2 max-w-md">
          <TabsTrigger value="baileys" className="flex items-center gap-2">
            <QrCodeIcon className="h-4 w-4" />
            QR Code (WhatsApp Web)
          </TabsTrigger>
          <TabsTrigger value="meta" className="flex items-center gap-2">
            <PlugIcon className="h-4 w-4" />
            Meta Cloud API Oficial
          </TabsTrigger>
        </TabsList>

        {/* Aba 1: QR Code Baileys */}
        <TabsContent value="baileys" className="mt-4">
          <Card className="border-border/60">
            <CardHeader>
              <CardTitle className="text-lg">Conexão Rápida por QR Code</CardTitle>
              <CardDescription>
                Conecte seu WhatsApp escaneando o código abaixo como um aparelho adicional.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-6">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-8 items-center">
                {/* Passo a Passo */}
                <div className="space-y-4">
                  <h4 className="font-medium text-sm text-foreground">Passo a passo no celular:</h4>
                  <ol className="list-decimal list-inside space-y-2 text-sm text-muted-foreground">
                    <li>Abra o aplicativo do WhatsApp no celular da sua empresa.</li>
                    <li>
                      Toque no menu de opções <span className="text-foreground font-mono font-medium">(⋮)</span> no Android ou{" "}
                      <span className="text-foreground font-medium">Configurações</span> no iPhone.
                    </li>
                    <li>
                      Selecione <strong className="text-foreground">Aparelhos conectados</strong>.
                    </li>
                    <li>
                      Toque em <strong className="text-foreground">Conectar um aparelho</strong>.
                    </li>
                    <li>Aponte a câmera do celular para o QR Code ao lado.</li>
                  </ol>

                  <div className="pt-2">
                    <Button onClick={handleGerarQr} disabled={isLoading} variant="outline" className="flex items-center gap-2">
                      <RefreshCwIcon className={`h-4 w-4 ${isLoading ? "animate-spin" : ""}`} />
                      {qrBase64 ? "Atualizar QR Code" : "Gerar QR Code Agora"}
                    </Button>
                  </div>
                </div>

                {/* Exibição do QR Code */}
                <div className="flex flex-col items-center justify-center p-6 bg-muted/20 border border-border/50 rounded-xl">
                  {isConnected ? (
                    <div className="text-center space-y-3 py-8">
                      <div className="h-16 w-16 bg-emerald-500/10 text-emerald-500 rounded-full flex items-center justify-center mx-auto">
                        <CheckCircle2Icon className="h-8 w-8" />
                      </div>
                      <h4 className="font-medium text-foreground">Aparelho Conectado com Sucesso!</h4>
                      <p className="text-xs text-muted-foreground max-w-xs">
                        Seu Agente de Atendimento já está respondendo às mensagens que chegarem neste WhatsApp.
                      </p>
                    </div>
                  ) : qrBase64 ? (
                    <div className="text-center space-y-3">
                      <div className="bg-white p-3 rounded-lg shadow-sm border border-border inline-block">
                        <img
                          src={qrBase64.startsWith("data:") ? qrBase64 : `data:image/png;base64,${qrBase64}`}
                          alt="QR Code WhatsApp"
                          className="w-56 h-56 object-contain"
                        />
                      </div>
                      <p className="text-xs text-muted-foreground animate-pulse">
                        Aguardando leitura do QR Code pelo celular...
                      </p>
                      <Button
                        size="sm"
                        variant="secondary"
                        onClick={handleVerificarManual}
                        disabled={isLoading}
                        className="mt-2 text-xs"
                      >
                        <RefreshCwIcon className={`h-3 w-3 mr-1 ${isLoading ? "animate-spin" : ""}`} />
                        Já escaneou? Verificar Conexão
                      </Button>
                    </div>
                  ) : (
                    <div className="text-center py-12 space-y-3">
                      <QrCodeIcon className="h-12 w-12 text-muted-foreground/40 mx-auto" />
                      <p className="text-sm text-muted-foreground">Clique no botão abaixo para gerar seu QR Code de conexão.</p>
                      <Button onClick={handleGerarQr} disabled={isLoading} className="bg-emerald-600 hover:bg-emerald-700 text-white">
                        Gerar QR Code
                      </Button>
                    </div>
                  )}
                </div>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        {/* Aba 2: Meta Cloud API Oficial */}
        <TabsContent value="meta" className="mt-4">
          <Card className="border-border/60">
            <CardHeader>
              <CardTitle className="text-lg">Configuração da Meta Cloud API Oficial</CardTitle>
              <CardDescription>
                Para empresas de médio e grande porte utilizando a API Oficial do WhatsApp Business da Meta.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <form onSubmit={handleSalvarCloudApi} className="space-y-4 max-w-xl">
                <div className="space-y-2">
                  <Label htmlFor="phoneNumberId">Phone Number ID da Meta</Label>
                  <Input
                    id="phoneNumberId"
                    value={phoneNumberId}
                    onChange={(e) => setPhoneNumberId(e.target.value)}
                    placeholder="Ex: 109283746592837"
                    required
                  />
                  <p className="text-xs text-muted-foreground">Encontrado no painel de desenvolvedores do Meta for Developers.</p>
                </div>

                <div className="space-y-2">
                  <Label htmlFor="wabaId">WhatsApp Business Account ID (WABA ID)</Label>
                  <Input
                    id="wabaId"
                    value={wabaId}
                    onChange={(e) => setWabaId(e.target.value)}
                    placeholder="Ex: 928374659283746"
                    required
                  />
                </div>

                <div className="space-y-2">
                  <Label htmlFor="accessToken">Token de Acesso Permanente (System User Token)</Label>
                  <Input
                    id="accessToken"
                    type="password"
                    value={accessToken}
                    onChange={(e) => setAccessToken(e.target.value)}
                    placeholder="EAA..."
                    required
                  />
                  <p className="text-xs text-muted-foreground">Token com permissões de whatsapp_business_messaging.</p>
                </div>

                <div className="space-y-2">
                  <Label htmlFor="phoneNumber">Número de Telefone (opcional)</Label>
                  <Input
                    id="phoneNumber"
                    value={phoneNumber}
                    onChange={(e) => setPhoneNumber(e.target.value)}
                    placeholder="Ex: +55 (11) 98765-4321"
                  />
                </div>

                <div className="pt-2">
                  <Button type="submit" disabled={isLoading} className="bg-emerald-600 hover:bg-emerald-700 text-white">
                    {isLoading ? "Salvando..." : "Salvar Configuração Meta"}
                  </Button>
                </div>
              </form>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}
