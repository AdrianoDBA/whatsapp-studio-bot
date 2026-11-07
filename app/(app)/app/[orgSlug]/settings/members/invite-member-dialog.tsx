"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { CheckIcon, CopyIcon, MessageSquareIcon, SendIcon } from "lucide-react";
import { useState, useTransition } from "react";
import { FormProvider, useForm } from "react-hook-form";
import { toast } from "sonner";
import { TextField } from "@/components/forms/form-field";
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
import { createInvitationAction, type CreateInvitationOutput } from "@/lib/invitations/actions";
import { type CreateInvitationInput, createInvitationSchema } from "@/lib/invitations/schemas";

export function InviteMemberDialog({ orgSlug }: { orgSlug: string }) {
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const [conviteCriado, setConviteCriado] = useState<CreateInvitationOutput | null>(null);
  const [linkCopiado, setLinkCopiado] = useState(false);
  const [msgCopiada, setMsgCopiada] = useState(false);

  const form = useForm<CreateInvitationInput>({
    resolver: zodResolver(createInvitationSchema),
    defaultValues: { orgSlug, email: "", role: "member" },
  });

  function handleOpenChange(newOpen: boolean) {
    setOpen(newOpen);
    if (!newOpen) {
      setTimeout(() => {
        setConviteCriado(null);
        form.reset({ orgSlug, email: "", role: "member" });
      }, 250);
    }
  }

  function onSubmit(values: CreateInvitationInput) {
    startTransition(async () => {
      const result = await createInvitationAction(values);
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      if (!result.data) {
        toast.error("Erro ao gerar convite.");
        return;
      }
      setConviteCriado(result.data);
      toast.success(
        result.data?.emailSent
          ? "Convite criado e e-mail enviado!"
          : "Convite criado! Copie o link abaixo para enviar ao membro.",
      );
    });
  }

  async function copiarLink() {
    if (!conviteCriado?.acceptUrl) return;
    await navigator.clipboard.writeText(conviteCriado.acceptUrl);
    setLinkCopiado(true);
    toast.success("Link do convite copiado!");
    setTimeout(() => setLinkCopiado(false), 2000);
  }

  async function copiarMensagem() {
    if (!conviteCriado?.whatsappMessage) return;
    await navigator.clipboard.writeText(conviteCriado.whatsappMessage);
    setMsgCopiada(true);
    toast.success("Mensagem para WhatsApp copiada!");
    setTimeout(() => setMsgCopiada(false), 2000);
  }

  function abrirWhatsApp() {
    if (!conviteCriado?.whatsappMessage) return;
    const url = `https://wa.me/?text=${encodeURIComponent(conviteCriado.whatsappMessage)}`;
    window.open(url, "_blank");
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogTrigger render={<Button>Convidar membro</Button>} />
      <DialogContent className="sm:max-w-md">
        {!conviteCriado ? (
          <>
            <DialogHeader>
              <DialogTitle>Convidar membro</DialogTitle>
              <DialogDescription className="text-xs">
                Convide um colaborador para acessar e gerenciar este workspace.
              </DialogDescription>
            </DialogHeader>
            <FormProvider {...form}>
              <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
                <TextField
                  name="email"
                  control={form.control}
                  label="Email"
                  inputProps={{ type: "email", placeholder: "pessoa@exemplo.com" }}
                />
                <Button type="submit" className="w-full gap-2" disabled={pending}>
                  {pending ? "Gerando convite..." : "Criar convite"}
                </Button>
              </form>
            </FormProvider>
          </>
        ) : (
          <div className="space-y-4">
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2">
                <span>Convite Criado! 🎉</span>
              </DialogTitle>
              <DialogDescription className="text-xs">
                {conviteCriado.emailSent
                  ? "O e-mail foi enviado com sucesso, mas você também pode enviar o link diretamente pelo WhatsApp."
                  : "Envie o link ou mensagem abaixo diretamente para o membro."}
              </DialogDescription>
            </DialogHeader>

            <div className="space-y-1.5 rounded-lg border bg-muted/30 p-3">
              <Label className="text-xs font-semibold">Link de Aceite do Convite:</Label>
              <div className="flex items-center gap-2">
                <Input
                  readOnly
                  value={conviteCriado.acceptUrl}
                  className="font-mono text-xs bg-background h-8"
                />
                <Button
                  size="sm"
                  variant={linkCopiado ? "default" : "outline"}
                  onClick={copiarLink}
                  className="h-8 shrink-0 gap-1 text-xs"
                >
                  {linkCopiado ? <CheckIcon className="h-3.5 w-3.5" /> : <CopyIcon className="h-3.5 w-3.5" />}
                  <span>{linkCopiado ? "Copiado!" : "Copiar Link"}</span>
                </Button>
              </div>
            </div>

            <div className="space-y-1.5 rounded-lg border bg-emerald-50/50 dark:bg-emerald-950/20 border-emerald-500/20 p-3">
              <Label className="text-xs font-semibold text-emerald-800 dark:text-emerald-300 flex items-center gap-1.5">
                <MessageSquareIcon className="h-3.5 w-3.5" />
                Mensagem Pronta para WhatsApp:
              </Label>
              <Textarea
                readOnly
                rows={4}
                value={conviteCriado.whatsappMessage}
                className="font-sans text-xs bg-background/80 resize-none leading-relaxed"
              />
              <div className="flex items-center justify-between gap-2 pt-1">
                <Button
                  size="sm"
                  variant={msgCopiada ? "default" : "outline"}
                  onClick={copiarMensagem}
                  className="h-8 gap-1.5 text-xs"
                >
                  {msgCopiada ? <CheckIcon className="h-3.5 w-3.5" /> : <CopyIcon className="h-3.5 w-3.5" />}
                  <span>{msgCopiada ? "Copiado!" : "Copiar Texto"}</span>
                </Button>
                <Button
                  size="sm"
                  onClick={abrirWhatsApp}
                  className="h-8 gap-1.5 bg-emerald-600 hover:bg-emerald-700 text-white text-xs"
                >
                  <SendIcon className="h-3.5 w-3.5" />
                  <span>Abrir no WhatsApp</span>
                </Button>
              </div>
            </div>

            <div className="flex justify-end pt-2 border-t">
              <Button size="sm" onClick={() => setOpen(false)}>
                Concluído
              </Button>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
