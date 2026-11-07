"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";
import { PowerIcon, BotIcon, CheckCircle2Icon, PauseCircleIcon } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { alternarBotAction } from "@/lib/whatsapp/actions";

type Props = {
  orgSlug: string;
  initialEnabled?: boolean;
  variant?: "badge" | "button" | "card" | "compact";
  className?: string;
};

export function BotToggle({
  orgSlug,
  initialEnabled = true,
  variant = "button",
  className = "",
}: Props) {
  const [enabled, setEnabled] = useState(initialEnabled);
  const [pending, startTransition] = useTransition();

  function handleToggle() {
    const nextState = !enabled;
    startTransition(async () => {
      // Otimista
      setEnabled(nextState);

      const res = await alternarBotAction({ orgSlug, enabled: nextState });
      if (!res.ok) {
        setEnabled(!nextState); // reverte em caso de erro
        toast.error(res.error || "Erro ao alterar estado do bot.");
        return;
      }

      if (nextState) {
        toast.success("🟢 Bot LIGADO com sucesso! As mensagens serão respondidas pela IA.");
      } else {
        toast.warning("⏸️ Bot DESLIGADO! O WhatsApp continuará recebendo mensagens, mas a IA não responderá.");
      }
    });
  }

  if (variant === "compact") {
    return (
      <Button
        size="sm"
        variant={enabled ? "outline" : "destructive"}
        onClick={handleToggle}
        disabled={pending}
        className={`h-7 px-2.5 text-xs gap-1.5 font-medium transition-all ${
          enabled
            ? "border-emerald-500/30 text-emerald-600 dark:text-emerald-400 hover:bg-emerald-50 dark:hover:bg-emerald-950/20"
            : "bg-destructive/10 text-destructive border-destructive/30 hover:bg-destructive/20"
        } ${className}`}
      >
        <span
          className={`h-2 w-2 rounded-full ${
            enabled ? "bg-emerald-500 animate-pulse" : "bg-destructive"
          }`}
        />
        <span>{enabled ? "Bot Ativo" : "Bot Pausado"}</span>
      </Button>
    );
  }

  if (variant === "card") {
    return (
      <div
        className={`flex flex-wrap items-center justify-between gap-3 p-3.5 rounded-xl border transition-all ${
          enabled
            ? "border-emerald-500/30 bg-emerald-50/20 dark:bg-emerald-950/10"
            : "border-amber-500/30 bg-amber-50/20 dark:bg-amber-950/10"
        } ${className}`}
      >
        <div className="flex items-center gap-2.5">
          <div
            className={`flex h-9 w-9 items-center justify-center rounded-lg ${
              enabled
                ? "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400"
                : "bg-amber-500/10 text-amber-600 dark:text-amber-400"
            }`}
          >
            <BotIcon className="h-5 w-5" />
          </div>
          <div className="space-y-0.5">
            <div className="flex items-center gap-2">
              <span className="font-semibold text-xs text-foreground">
                Respostas Automáticas da Secretária IA:
              </span>
              <Badge
                variant="outline"
                className={`text-[10px] ${
                  enabled
                    ? "bg-emerald-500/10 text-emerald-600 border-emerald-500/30"
                    : "bg-amber-500/10 text-amber-600 border-amber-500/30"
                }`}
              >
                {enabled ? "LIGADO (Ativo)" : "DESLIGADO (Pausado)"}
              </Badge>
            </div>
            <p className="text-[11px] text-muted-foreground">
              {enabled
                ? "A secretária responde clientes normalmente no WhatsApp 24h por dia."
                : "O bot está pausado. Você pode atender manualmente sem a IA interferir."}
            </p>
          </div>
        </div>

        <Button
          size="sm"
          variant={enabled ? "outline" : "default"}
          onClick={handleToggle}
          disabled={pending}
          className={`gap-1.5 text-xs h-8 ${
            enabled
              ? "border-amber-500/40 text-amber-700 dark:text-amber-300 hover:bg-amber-500/10"
              : "bg-emerald-600 hover:bg-emerald-700 text-white"
          }`}
        >
          {enabled ? (
            <>
              <PauseCircleIcon className="h-4 w-4" />
              <span>{pending ? "Pausando..." : "Pausar Bot"}</span>
            </>
          ) : (
            <>
              <CheckCircle2Icon className="h-4 w-4" />
              <span>{pending ? "Ligando..." : "Ligar Bot"}</span>
            </>
          )}
        </Button>
      </div>
    );
  }

  return (
    <Button
      size="sm"
      variant={enabled ? "outline" : "default"}
      onClick={handleToggle}
      disabled={pending}
      className={`gap-1.5 text-xs h-8 transition-all ${
        enabled
          ? "border-emerald-500/40 text-emerald-700 dark:text-emerald-300 hover:bg-emerald-500/10"
          : "bg-emerald-600 hover:bg-emerald-700 text-white"
      } ${className}`}
    >
      <PowerIcon className={`h-3.5 w-3.5 ${enabled ? "text-emerald-500" : "text-white"}`} />
      <span>
        {pending ? "Atualizando..." : enabled ? "Pausar Bot (Desligar)" : "Ligar Bot (Ativar)"}
      </span>
    </Button>
  );
}
