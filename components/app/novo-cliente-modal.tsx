"use client";

import {
  CheckIcon,
  CopyIcon,
  ExternalLinkIcon,
  MessageSquareIcon,
  PlusIcon,
  SparklesIcon,
  UserPlusIcon,
  Building2Icon,
  MailIcon,
  BotIcon,
  PhoneIcon,
} from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  criarNovoClienteAction,
  type CriarNovoClienteOutput,
} from "@/lib/orgs/novo-cliente-actions";
import { TONE_OPTIONS, type SecretaryTone } from "@/lib/whatsapp/secretary-prompt";

type Props = {
  trigger?: React.ReactNode;
  variant?: "header" | "dropdown" | "button";
};

export function NovoClienteModal({ trigger, variant = "button" }: Props) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();

  // Form states
  const [empresaNome, setEmpresaNome] = useState("");
  const [clienteEmail, setClienteEmail] = useState("");
  const [assistenteNome, setAssistenteNome] = useState("Sofia");
  const [tom, setTom] = useState<SecretaryTone>("acolhedor");
  const [telefone, setTelefone] = useState("");
  const [servicosIniciais, setServicosIniciais] = useState("");

  // Result state
  const [resultado, setResultado] = useState<CriarNovoClienteOutput | null>(null);
  const [mensagemEditavel, setMensagemEditavel] = useState("");
  const [linkCopiado, setLinkCopiado] = useState(false);
  const [msgCopiada, setMsgCopiada] = useState(false);

  function resetForm() {
    setEmpresaNome("");
    setClienteEmail("");
    setAssistenteNome("Sofia");
    setTom("acolhedor");
    setTelefone("");
    setServicosIniciais("");
    setResultado(null);
    setMensagemEditavel("");
    setLinkCopiado(false);
    setMsgCopiada(false);
  }

  function handleOpenChange(newOpen: boolean) {
    setOpen(newOpen);
    if (!newOpen) {
      setTimeout(resetForm, 250);
    }
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!empresaNome.trim()) {
      toast.error("Informe o nome da empresa ou negócio.");
      return;
    }
    if (!clienteEmail.trim()) {
      toast.error("Informe o e-mail do cliente.");
      return;
    }

    startTransition(async () => {
      const res = await criarNovoClienteAction({
        empresaNome: empresaNome.trim(),
        clienteEmail: clienteEmail.trim(),
        assistenteNome: assistenteNome.trim() || "Sofia",
        tom,
        telefone: telefone.trim(),
        servicosIniciais: servicosIniciais.trim(),
      });

      if (!res.ok) {
        toast.error(res.error);
        return;
      }
      if (!res.data) {
        toast.error("Erro ao processar criação do cliente.");
        return;
      }

      setResultado(res.data);
      setMensagemEditavel(res.data.whatsappMessage);
      toast.success("Cliente e workspace criados com sucesso!");
    });
  }

  async function copiarLink() {
    if (!resultado?.acceptUrl) return;
    try {
      await navigator.clipboard.writeText(resultado.acceptUrl);
      setLinkCopiado(true);
      toast.success("Link de ativação copiado!");
      setTimeout(() => setLinkCopiado(false), 2000);
    } catch {
      toast.error("Não foi possível copiar o link.");
    }
  }

  async function copiarMensagem() {
    if (!mensagemEditavel) return;
    try {
      await navigator.clipboard.writeText(mensagemEditavel);
      setMsgCopiada(true);
      toast.success("Mensagem do WhatsApp copiada!");
      setTimeout(() => setMsgCopiada(false), 2000);
    } catch {
      toast.error("Não foi possível copiar a mensagem.");
    }
  }

  function abrirNoWhatsApp() {
    if (!resultado) return;
    const cleanPhone = telefone.replace(/\D/g, "");
    const encoded = encodeURIComponent(mensagemEditavel);
    const url = cleanPhone
      ? `https://wa.me/${cleanPhone}?text=${encoded}`
      : `https://wa.me/?text=${encoded}`;
    window.open(url, "_blank");
  }

  function navegarAteWorkspace() {
    if (!resultado?.orgSlug) return;
    setOpen(false);
    router.push(`/app/${resultado.orgSlug}/dashboard`);
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogTrigger
        render={
          trigger ? (
            (trigger as any)
          ) : variant === "header" ? (
            <Button
              size="sm"
              className="gap-1.5 bg-primary/95 hover:bg-primary text-primary-foreground font-medium shadow-xs"
            >
              <UserPlusIcon className="h-4 w-4" />
              <span>Novo Cliente</span>
            </Button>
          ) : variant === "dropdown" ? (
            <button className="flex w-full items-center gap-2 text-sm text-foreground hover:text-primary transition-colors cursor-pointer py-1.5 px-2">
              <UserPlusIcon className="h-4 w-4 text-primary" />
              <span>Novo Cliente (Link VIP)</span>
            </button>
          ) : (
            <Button className="gap-2 shadow-sm font-medium">
              <PlusIcon className="h-4 w-4" />
              Novo Cliente
            </Button>
          )
        }
      />

      <DialogContent className="sm:max-w-xl max-h-[90vh] overflow-y-auto">
        {!resultado ? (
          /* ETAPA 1: FORMULÁRIO DE CADASTRO DO CLIENTE */
          <form onSubmit={handleSubmit} className="space-y-4">
            <DialogHeader>
              <div className="flex items-center gap-2">
                <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-primary/10 text-primary">
                  <UserPlusIcon className="h-5 w-5" />
                </div>
                <div>
                  <DialogTitle className="text-lg font-semibold">Novo Cliente (Entrega VIP)</DialogTitle>
                  <DialogDescription className="text-xs">
                    Crie o ambiente exclusivo do cliente e gere o link para ele ativar no WhatsApp em 1 clique.
                  </DialogDescription>
                </div>
              </div>
            </DialogHeader>

            <div className="space-y-3.5 pt-1">
              {/* Nome da Empresa */}
              <div className="space-y-1">
                <Label htmlFor="empresaNome" className="text-xs font-medium flex items-center gap-1.5">
                  <Building2Icon className="h-3.5 w-3.5 text-muted-foreground" />
                  Nome da Empresa ou Negócio <span className="text-destructive">*</span>
                </Label>
                <Input
                  id="empresaNome"
                  value={empresaNome}
                  onChange={(e) => setEmpresaNome(e.target.value)}
                  placeholder="Ex: Clínica Sorriso, Studio Bella, Advocacia Silva..."
                  required
                  disabled={pending}
                  className="h-9"
                />
              </div>

              {/* Email do Cliente */}
              <div className="space-y-1">
                <Label htmlFor="clienteEmail" className="text-xs font-medium flex items-center gap-1.5">
                  <MailIcon className="h-3.5 w-3.5 text-muted-foreground" />
                  E-mail do Cliente (Login Admin) <span className="text-destructive">*</span>
                </Label>
                <Input
                  id="clienteEmail"
                  type="email"
                  value={clienteEmail}
                  onChange={(e) => setClienteEmail(e.target.value)}
                  placeholder="cliente@empresa.com"
                  required
                  disabled={pending}
                  className="h-9"
                />
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                {/* Nome da Secretária */}
                <div className="space-y-1">
                  <Label htmlFor="assistenteNome" className="text-xs font-medium flex items-center gap-1.5">
                    <BotIcon className="h-3.5 w-3.5 text-muted-foreground" />
                    Nome da Secretária (IA)
                  </Label>
                  <Input
                    id="assistenteNome"
                    value={assistenteNome}
                    onChange={(e) => setAssistenteNome(e.target.value)}
                    placeholder="Sofia"
                    disabled={pending}
                    className="h-9"
                  />
                </div>

                {/* WhatsApp do Cliente */}
                <div className="space-y-1">
                  <Label htmlFor="telefone" className="text-xs font-medium flex items-center gap-1.5">
                    <PhoneIcon className="h-3.5 w-3.5 text-muted-foreground" />
                    WhatsApp do Cliente (Opcional)
                  </Label>
                  <Input
                    id="telefone"
                    value={telefone}
                    onChange={(e) => setTelefone(e.target.value)}
                    placeholder="DDD + Número (ex: 11999998888)"
                    disabled={pending}
                    className="h-9"
                  />
                </div>
              </div>

              {/* Tom de Voz */}
              <div className="space-y-1.5">
                <Label className="text-xs font-medium flex items-center gap-1.5">
                  <SparklesIcon className="h-3.5 w-3.5 text-primary" />
                  Tom de Atendimento da Secretária
                </Label>
                <div className="grid grid-cols-2 gap-2">
                  {TONE_OPTIONS.map((t) => {
                    const selected = tom === t.id;
                    return (
                      <button
                        key={t.id}
                        type="button"
                        onClick={() => setTom(t.id)}
                        disabled={pending}
                        className={`text-left p-2 rounded-lg border text-xs transition-all flex flex-col gap-0.5 cursor-pointer ${
                          selected
                            ? "border-primary bg-primary/10 text-foreground ring-1 ring-primary"
                            : "border-border hover:bg-muted/40 text-muted-foreground"
                        }`}
                      >
                        <span className="font-semibold text-foreground flex items-center gap-1">
                          <span>{t.icon}</span> {(t.label.split("&")[0] ?? t.label).trim()}
                        </span>
                        <span className="text-[10px] line-clamp-1 text-muted-foreground">
                          {t.description}
                        </span>
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* Serviços / Preços Iniciais */}
              <div className="space-y-1">
                <Label htmlFor="servicos" className="text-xs font-medium">
                  Serviços e Preços Iniciais (Opcional - o cliente pode ajustar depois)
                </Label>
                <Textarea
                  id="servicos"
                  rows={2}
                  value={servicosIniciais}
                  onChange={(e) => setServicosIniciais(e.target.value)}
                  placeholder="Ex: Consulta Médica: R$ 250&#10;Retorno: Grátis até 30 dias"
                  disabled={pending}
                  className="text-xs resize-none"
                />
              </div>
            </div>

            <div className="flex items-center justify-end gap-2 pt-2 border-t">
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => setOpen(false)}
                disabled={pending}
              >
                Cancelar
              </Button>
              <Button type="submit" size="sm" disabled={pending} className="gap-1.5">
                {pending ? (
                  <>
                    <span className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-primary-foreground border-t-transparent" />
                    <span>Criando workspace...</span>
                  </>
                ) : (
                  <>
                    <SparklesIcon className="h-4 w-4" />
                    <span>Criar Workspace e Gerar Link</span>
                  </>
                )}
              </Button>
            </div>
          </form>
        ) : (
          /* ETAPA 2: SUCESSO - LINK DE ENTREGA E MENSAGEM WHATSAPP */
          <div className="space-y-4">
            <DialogHeader>
              <div className="flex items-center gap-2">
                <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-emerald-500/10 text-emerald-600 dark:text-emerald-400">
                  <CheckIcon className="h-5 w-5" />
                </div>
                <div>
                  <DialogTitle className="text-lg font-semibold flex items-center gap-2">
                    <span>Ambiente Pronto! 🎉</span>
                    <Badge variant="outline" className="text-[10px] bg-emerald-500/10 text-emerald-600 border-emerald-500/30">
                      Pronto para envio
                    </Badge>
                  </DialogTitle>
                  <DialogDescription className="text-xs">
                    O workspace <strong>{resultado.orgName}</strong> (/{resultado.orgSlug}) foi criado com sucesso.
                  </DialogDescription>
                </div>
              </div>
            </DialogHeader>

            {/* Link direto de acesso */}
            <div className="space-y-1.5 rounded-lg border bg-card p-3">
              <Label className="text-xs font-semibold text-foreground flex items-center justify-between">
                <span>Link Exclusivo de Ativação do Cliente:</span>
                <span className="text-[10px] text-muted-foreground font-normal">
                  Cria a senha e acessa o onboarding
                </span>
              </Label>
              <div className="flex items-center gap-2">
                <Input
                  readOnly
                  value={resultado.acceptUrl}
                  className="font-mono text-xs bg-muted/50 h-8"
                />
                <Button
                  size="sm"
                  variant={linkCopiado ? "default" : "outline"}
                  onClick={copiarLink}
                  className="h-8 gap-1 shrink-0"
                >
                  {linkCopiado ? <CheckIcon className="h-3.5 w-3.5" /> : <CopyIcon className="h-3.5 w-3.5" />}
                  <span>{linkCopiado ? "Copiado!" : "Copiar"}</span>
                </Button>
              </div>
            </div>

            {/* Mensagem Formatada para WhatsApp */}
            <div className="space-y-1.5 rounded-lg border bg-emerald-50/40 dark:bg-emerald-950/20 border-emerald-500/20 p-3">
              <div className="flex items-center justify-between">
                <Label className="text-xs font-semibold text-emerald-800 dark:text-emerald-300 flex items-center gap-1.5">
                  <MessageSquareIcon className="h-3.5 w-3.5" />
                  Mensagem Pronta para WhatsApp (Editável):
                </Label>
                <span className="text-[10px] text-muted-foreground">Você pode ajustar antes de enviar</span>
              </div>

              <Textarea
                rows={6}
                value={mensagemEditavel}
                onChange={(e) => setMensagemEditavel(e.target.value)}
                className="font-sans text-xs bg-background/80 resize-none leading-relaxed"
              />

              <div className="flex flex-wrap items-center justify-between gap-2 pt-1">
                <Button
                  size="sm"
                  variant={msgCopiada ? "default" : "outline"}
                  onClick={copiarMensagem}
                  className="h-8 gap-1.5 text-xs"
                >
                  {msgCopiada ? <CheckIcon className="h-3.5 w-3.5" /> : <CopyIcon className="h-3.5 w-3.5" />}
                  <span>{msgCopiada ? "Mensagem Copiada!" : "Copiar Mensagem WhatsApp"}</span>
                </Button>

                <Button
                  size="sm"
                  onClick={abrirNoWhatsApp}
                  className="h-8 gap-1.5 bg-emerald-600 hover:bg-emerald-700 text-white text-xs"
                >
                  <MessageSquareIcon className="h-3.5 w-3.5" />
                  <span>Abrir no WhatsApp</span>
                  <ExternalLinkIcon className="h-3 w-3 opacity-70" />
                </Button>
              </div>
            </div>

            {/* Rodapé de navegação */}
            <div className="flex items-center justify-between pt-2 border-t">
              <Button variant="ghost" size="sm" onClick={resetForm} className="text-xs">
                Cadastrar outro cliente
              </Button>

              <div className="flex items-center gap-2">
                <Button variant="outline" size="sm" onClick={() => setOpen(false)} className="text-xs">
                  Fechar
                </Button>
                <Button size="sm" onClick={navegarAteWorkspace} className="gap-1.5 text-xs">
                  <span>Acessar Workspace</span>
                  <ExternalLinkIcon className="h-3.5 w-3.5" />
                </Button>
              </div>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
