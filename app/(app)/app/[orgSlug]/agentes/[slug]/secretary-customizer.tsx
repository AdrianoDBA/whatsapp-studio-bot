"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";
import {
  SparklesIcon,
  SaveIcon,
  BotIcon,
  BuildingIcon,
  ClockIcon,
  DollarSignIcon,
  SlidersIcon,
  CheckCircle2Icon,
  HelpCircleIcon,
  AlertTriangleIcon,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  TONE_OPTIONS,
  buildSecretaryPrompt,
  type SecretaryConfig,
  type SecretaryTone,
} from "@/lib/whatsapp/secretary-prompt";
import { salvarConfiguracaoSecretariaAction } from "@/lib/whatsapp/secretary-actions";

type Props = {
  orgSlug: string;
  orgName: string;
  agentId: string;
  initialPrompt: string;
  initialConfig: Partial<SecretaryConfig> | null;
  podeEditar: boolean;
};

export function SecretaryCustomizer({
  orgSlug,
  orgName,
  agentId,
  initialPrompt,
  initialConfig,
  podeEditar,
}: Props) {
  const [isPending, startTransition] = useTransition();

  // Estados dos campos guiados
  const [assistantName, setAssistantName] = useState(
    initialConfig?.assistantName || "Sofia",
  );
  const [companyName, setCompanyName] = useState(
    initialConfig?.companyName || orgName || "Meu Estúdio",
  );
  const [tone, setTone] = useState<SecretaryTone>(
    initialConfig?.tone || "acolhedor",
  );
  const [servicesText, setServicesText] = useState(
    initialConfig?.servicesText ||
      "- Ensaio Gestante: R$ 450,00 (1 hora de sessão no estúdio, 20 fotos tratadas em alta resolução)\n- Ensaio Família: R$ 600,00 (1h30 de sessão, 30 fotos tratadas + 2 trocas de roupa)\n- Ensaio Infantil / Acompanhamento: R$ 400,00 (20 fotos)\n- Foto extra tratada: R$ 25,00 cada",
  );
  const [businessHours, setBusinessHours] = useState(
    initialConfig?.businessHours || "Segunda a Sexta das 08h30 às 18h30 e Sábados das 09h às 13h.",
  );
  const [paymentMethods, setPaymentMethods] = useState(
    initialConfig?.paymentMethods ||
      "Sinal de 50% via Pix na confirmação do agendamento e o saldo restante no dia do ensaio (ou parcelado em até 3x no cartão de crédito sem juros).",
  );
  const [humanHandoff, setHumanHandoff] = useState(
    initialConfig?.humanHandoff ||
      "Quando o cliente pedir expressamente para falar com uma pessoa da equipe, solicitar um desconto especial fora da tabela ou relatar qualquer insatisfação.",
  );
  const [additionalNotes, setAdditionalNotes] = useState(
    initialConfig?.additionalNotes ||
      "Temos estacionamento conveniado gratuito na porta. Para ensaios de gestante, temos figurinos disponíveis no estúdio sem custo adicional.",
  );

  // Modo Avançado: Prompt Bruto
  const [currentPrompt, setCurrentPrompt] = useState(initialPrompt);
  const [isRawMode, setIsRawMode] = useState(false);

  // Prompt pré-visualizado em tempo real com base no formulário
  const previewPrompt = buildSecretaryPrompt(
    {
      assistantName,
      companyName,
      tone,
      servicesText,
      businessHours,
      paymentMethods,
      humanHandoff,
      additionalNotes,
    },
    orgName,
  );

  function handleSalvar(overridePrompt?: string) {
    if (!podeEditar) {
      toast.error("Você não tem permissão para editar as configurações deste agente.");
      return;
    }

    startTransition(async () => {
      try {
        const res = await salvarConfiguracaoSecretariaAction({
          orgSlug,
          agentId,
          assistantName,
          companyName,
          tone,
          servicesText,
          businessHours,
          paymentMethods,
          humanHandoff,
          additionalNotes,
          directPrompt: overridePrompt,
        });

        if (!res.ok) {
          toast.error(res.error || "Erro ao salvar configurações.");
        } else {
          setCurrentPrompt(res.data?.systemPrompt || previewPrompt);
          toast.success(
            "Configurações da secretária salvas com sucesso! O WhatsApp já está utilizando as novas regras.",
          );
        }
      } catch (e: any) {
        toast.error("Falha ao salvar configurações: " + (e.message || "Erro desconhecido"));
      }
    });
  }

  return (
    <Card className="overflow-hidden border-border/80 shadow-sm">
      <CardHeader className="border-b border-border/60 bg-muted/20 py-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="space-y-1">
            <div className="flex items-center gap-2">
              <span className="grid h-6 w-6 place-items-center rounded bg-primary/10 text-primary">
                <SparklesIcon className="h-3.5 w-3.5" />
              </span>
              <CardTitle className="text-base font-semibold">
                Personalização da Secretária Virtual
              </CardTitle>
            </div>
            <CardDescription className="text-xs">
              Configure como a inteligência artificial deve se apresentar e quais serviços e preços
              ela responderá no WhatsApp deste workspace.
            </CardDescription>
          </div>

          {podeEditar && (
            <Button
              onClick={() => handleSalvar(isRawMode ? currentPrompt : undefined)}
              disabled={isPending}
              size="sm"
              className="gap-1.5"
            >
              <SaveIcon className="h-4 w-4" />
              {isPending ? "Salvando no WhatsApp..." : "Salvar Atendimento"}
            </Button>
          )}
        </div>
      </CardHeader>

      <CardContent className="p-0">
        <Tabs defaultValue="visual" className="w-full">
          <div className="border-b border-border/60 bg-muted/10 px-6 pt-2">
            <TabsList className="bg-transparent p-0">
              <TabsTrigger
                value="visual"
                className="gap-1.5 rounded-none border-b-2 border-transparent px-3 py-2 text-xs data-[state=active]:border-primary data-[state=active]:bg-transparent"
              >
                <SlidersIcon className="h-3.5 w-3.5" />
                Atendimento Guiado
              </TabsTrigger>
              <TabsTrigger
                value="preview"
                className="gap-1.5 rounded-none border-b-2 border-transparent px-3 py-2 text-xs data-[state=active]:border-primary data-[state=active]:bg-transparent"
              >
                <BotIcon className="h-3.5 w-3.5" />
                Prompt Compilado (IA)
              </TabsTrigger>
            </TabsList>
          </div>

          {/* ABA 1: ATENDIMENTO GUIADO (SIMPLES, DIRETO, PRO CLIENTE) */}
          <TabsContent value="visual" className="m-0 space-y-6 p-6">
            {!podeEditar && (
              <div className="flex items-center gap-2 rounded-lg border border-chart-3/30 bg-chart-3/10 p-3 text-xs text-chart-3">
                <AlertTriangleIcon className="h-4 w-4 shrink-0" />
                <span>
                  Você está em modo visualização. Apenas donos e administradores do workspace podem
                  alterar estas configurações.
                </span>
              </div>
            )}

            {/* Linha 1: Nome da Assistente & Nome da Empresa */}
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor="assistantName" className="flex items-center gap-1.5 text-xs font-medium">
                  <BotIcon className="h-3.5 w-3.5 text-primary" />
                  Nome da Secretária / Assistente
                </Label>
                <Input
                  id="assistantName"
                  value={assistantName}
                  onChange={(e) => setAssistantName(e.target.value)}
                  disabled={!podeEditar || isPending}
                  placeholder="ex: Sofia, Helena, Camila..."
                />
                <p className="text-[11px] text-muted-foreground">
                  Como ela se apresentará nas conversas ("Olá! Sou a Helena...").
                </p>
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="companyName" className="flex items-center gap-1.5 text-xs font-medium">
                  <BuildingIcon className="h-3.5 w-3.5 text-primary" />
                  Nome do seu Negócio / Estúdio
                </Label>
                <Input
                  id="companyName"
                  value={companyName}
                  onChange={(e) => setCompanyName(e.target.value)}
                  disabled={!podeEditar || isPending}
                  placeholder="ex: Studio Adriano Alves Fotografia"
                />
                <p className="text-[11px] text-muted-foreground">
                  O nome da sua marca oficial mencionado para os clientes.
                </p>
              </div>
            </div>

            {/* Linha 2: Tom de Voz */}
            <div className="space-y-2">
              <Label className="flex items-center gap-1.5 text-xs font-medium">
                <SparklesIcon className="h-3.5 w-3.5 text-primary" />
                Estilo e Tom de Voz no Atendimento
              </Label>
              <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2 lg:grid-cols-4">
                {TONE_OPTIONS.map((opt) => {
                  const isSelected = tone === opt.id;
                  return (
                    <button
                      key={opt.id}
                      type="button"
                      disabled={!podeEditar || isPending}
                      onClick={() => setTone(opt.id)}
                      className={`flex flex-col items-start gap-1.5 rounded-lg border p-3 text-left transition-all ${
                        isSelected
                          ? "border-primary bg-primary/5 ring-1 ring-primary"
                          : "border-border/70 hover:border-border hover:bg-muted/30"
                      } ${!podeEditar ? "cursor-default" : "cursor-pointer"}`}
                    >
                      <div className="flex w-full items-center justify-between">
                        <span className="text-lg">{opt.icon}</span>
                        {isSelected && (
                          <CheckCircle2Icon className="h-4 w-4 text-primary" />
                        )}
                      </div>
                      <div>
                        <p className="font-medium text-xs text-foreground">{opt.label}</p>
                        <p className="mt-0.5 text-[11px] text-muted-foreground leading-snug">
                          {opt.description}
                        </p>
                      </div>
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Linha 3: Serviços Oferecidos e Tabela de Preços */}
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <Label htmlFor="servicesText" className="flex items-center gap-1.5 text-xs font-medium">
                  <DollarSignIcon className="h-3.5 w-3.5 text-primary" />
                  Serviços Oferecidos, Pacotes e Valores
                </Label>
                <span className="text-[11px] text-muted-foreground">
                  Mais importante para orçamentos precisos
                </span>
              </div>
              <Textarea
                id="servicesText"
                rows={5}
                value={servicesText}
                onChange={(e) => setServicesText(e.target.value)}
                disabled={!podeEditar || isPending}
                placeholder="Exemplo:&#10;- Ensaio Gestante: R$ 450,00 (20 fotos tratadas)&#10;- Ensaio Família: R$ 600,00 (30 fotos tratadas)&#10;- Foto extra: R$ 25,00 cada"
                className="font-sans text-xs leading-relaxed"
              />
              <p className="text-[11px] text-muted-foreground">
                Coloque aqui todos os serviços que a secretária pode orçar. Ela usará exatamente
                esses dados para responder os clientes, sem inventar valores.
              </p>
            </div>

            {/* Linha 4: Horários e Pagamento */}
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor="businessHours" className="flex items-center gap-1.5 text-xs font-medium">
                  <ClockIcon className="h-3.5 w-3.5 text-primary" />
                  Horários de Atendimento & Funcionamento
                </Label>
                <Input
                  id="businessHours"
                  value={businessHours}
                  onChange={(e) => setBusinessHours(e.target.value)}
                  disabled={!podeEditar || isPending}
                  placeholder="ex: Segunda a Sexta das 08h às 18h..."
                />
                <p className="text-[11px] text-muted-foreground">
                  Dias e horários que você aceita agendar sessões ou atendimento.
                </p>
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="paymentMethods" className="flex items-center gap-1.5 text-xs font-medium">
                  <DollarSignIcon className="h-3.5 w-3.5 text-primary" />
                  Formas de Pagamento & Condições
                </Label>
                <Input
                  id="paymentMethods"
                  value={paymentMethods}
                  onChange={(e) => setPaymentMethods(e.target.value)}
                  disabled={!podeEditar || isPending}
                  placeholder="ex: Pix, cartão em até 3x, 50% de sinal..."
                />
                <p className="text-[11px] text-muted-foreground">
                  Como os clientes podem pagar e regras de sinal ou entrada.
                </p>
              </div>
            </div>

            {/* Linha 5: Transbordo para Humano & Regras Específicas */}
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor="humanHandoff" className="flex items-center gap-1.5 text-xs font-medium">
                  <HelpCircleIcon className="h-3.5 w-3.5 text-primary" />
                  Quando chamar Atendimento Humano
                </Label>
                <Textarea
                  id="humanHandoff"
                  rows={3}
                  value={humanHandoff}
                  onChange={(e) => setHumanHandoff(e.target.value)}
                  disabled={!podeEditar || isPending}
                  placeholder="ex: Quando o cliente pedir para falar com uma pessoa, em reclamações..."
                  className="text-xs"
                />
                <p className="text-[11px] text-muted-foreground">
                  Gatilhos para a secretária transferir o cliente para você ou sua equipe.
                </p>
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="additionalNotes" className="flex items-center gap-1.5 text-xs font-medium">
                  <SparklesIcon className="h-3.5 w-3.5 text-primary" />
                  Instruções Extras & Observações da Empresa
                </Label>
                <Textarea
                  id="additionalNotes"
                  rows={3}
                  value={additionalNotes}
                  onChange={(e) => setAdditionalNotes(e.target.value)}
                  disabled={!podeEditar || isPending}
                  placeholder="ex: Temos estacionamento conveniado, disponibilizamos figurinos..."
                  className="text-xs"
                />
                <p className="text-[11px] text-muted-foreground">
                  Diferenciais, endereço, estacionamento ou regras particulares do seu estúdio.
                </p>
              </div>
            </div>

            {podeEditar && (
              <div className="flex items-center justify-end border-t border-border/60 pt-4">
                <Button
                  onClick={() => handleSalvar()}
                  disabled={isPending}
                  className="gap-1.5"
                >
                  <SaveIcon className="h-4 w-4" />
                  {isPending ? "Salvando no WhatsApp..." : "Salvar Configurações da Secretária"}
                </Button>
              </div>
            )}
          </TabsContent>

          {/* ABA 2: PROMPT COMPILADO / AVANÇADO */}
          <TabsContent value="preview" className="m-0 space-y-4 p-6">
            <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-border/60 bg-muted/20 p-3">
              <div className="space-y-0.5">
                <p className="font-medium text-xs">Instruções enviadas para o modelo de IA</p>
                <p className="text-[11px] text-muted-foreground">
                  Este é o texto exato que guia as respostas da IA no WhatsApp a cada mensagem recebida.
                </p>
              </div>
              <div className="flex items-center gap-2">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => {
                    setIsRawMode(!isRawMode);
                    if (!isRawMode) {
                      setCurrentPrompt(previewPrompt);
                    }
                  }}
                  className="text-xs"
                >
                  {isRawMode ? "Usar Formulário Guiado" : "Editar Texto Livremente"}
                </Button>
              </div>
            </div>

            {isRawMode ? (
              <div className="space-y-2">
                <Textarea
                  rows={14}
                  value={currentPrompt}
                  onChange={(e) => setCurrentPrompt(e.target.value)}
                  disabled={!podeEditar || isPending}
                  className="font-mono text-xs leading-relaxed"
                />
                {podeEditar && (
                  <div className="flex justify-end gap-2">
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => setCurrentPrompt(previewPrompt)}
                    >
                      Restaurar do Formulário
                    </Button>
                    <Button
                      size="sm"
                      disabled={isPending}
                      onClick={() => handleSalvar(currentPrompt)}
                      className="gap-1.5"
                    >
                      <SaveIcon className="h-4 w-4" />
                      Salvar Prompt Personalizado
                    </Button>
                  </div>
                )}
              </div>
            ) : (
              <div className="max-h-[420px] overflow-y-auto rounded-lg border border-border/60 bg-muted/10 p-4 font-mono text-xs text-foreground/90 whitespace-pre-wrap leading-relaxed">
                {previewPrompt}
              </div>
            )}
          </TabsContent>
        </Tabs>
      </CardContent>
    </Card>
  );
}
