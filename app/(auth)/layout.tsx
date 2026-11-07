/**
 * A moldura das telas de entrar / criar conta / recuperar senha.
 *
 * ⚠️ O TEXTO DA FAIXA DA DIREITA NÃO MORA AQUI. Ele mora em
 * `config/landing.config.ts` (bloco `paginasDeEntrada`), pelo mesmo motivo do
 * resto do texto de tela: quem troca essas frases é alguém que não programa, e
 * enquanto elas ficaram escritas na mão aqui dentro passaram batido nas duas
 * limpezas da landing — e mentiam (mandavam rodar um comando que não existe e
 * mostravam um placar inventado). O nome do app também não se escreve na mão:
 * vem de `appConfig.name`.
 */
import { ArrowLeftIcon, TerminalIcon } from "lucide-react";
import Link from "next/link";
import type { ReactNode } from "react";
import { appConfig } from "@/config/app.config";
import { landingConfig } from "@/config/landing.config";

const painel = landingConfig.paginasDeEntrada;

/** A primeira letra do nome do app, pro quadradinho do logo. */
function inicialDoApp(): string {
  return appConfig.name.trim().charAt(0).toUpperCase() || "A";
}

export default function AuthLayout({ children }: { children: ReactNode }) {
  return (
    <div className="relative min-h-screen bg-background lg:grid lg:grid-cols-[1fr_1.1fr]">
      {/* Left: form */}
      <div className="relative flex min-h-screen flex-col px-6 py-8 lg:min-h-0 lg:px-12">
        <div className="flex items-center justify-between">
          <Link
            href="/"
            className="inline-flex items-center gap-2 text-muted-foreground text-sm transition-colors hover:text-foreground"
          >
            <ArrowLeftIcon className="h-3.5 w-3.5" />
            Voltar
          </Link>
          <Link href="/" className="flex items-center gap-2">
            <span className="grid h-7 w-7 place-items-center rounded-md bg-primary text-primary-foreground">
              <span className="font-bold text-sm">{inicialDoApp()}</span>
            </span>
          </Link>
        </div>

        <div className="flex flex-1 items-center justify-center py-12">
          <div className="w-full max-w-sm">{children}</div>
        </div>

        <p className="text-center font-mono text-[10px] text-muted-foreground uppercase tracking-wider">
          {appConfig.name}
        </p>
      </div>

      {/* Right: branded panel (hidden on mobile) */}
      <aside className="relative hidden overflow-hidden bg-card lg:flex lg:items-center lg:justify-center">
        <div className="pointer-events-none absolute inset-0 bg-dot-grid opacity-60" />
        <div className="pointer-events-none absolute inset-0 halo-primary" />
        <div className="pointer-events-none absolute right-0 bottom-0 h-2/3 w-full bg-gradient-to-tl from-primary/20 via-transparent to-transparent blur-3xl" />

        <div className="relative max-w-md space-y-8 px-12">
          <div className="space-y-3">
            <span className="label-mono">/ {appConfig.name}</span>
            <h2 className="font-semibold text-4xl tracking-tight leading-[1.1]">
              {painel.titulo}
              <br />
              <span className="text-glow-primary text-primary">{painel.destaque}</span>
            </h2>
          </div>

          <p className="text-balance text-muted-foreground leading-relaxed">{painel.subtitulo}</p>

          {/* Mini terminal */}
          <div className="rounded-xl border border-border/60 bg-background/60 p-4 font-mono text-xs backdrop-blur-sm">
            <div className="flex items-center gap-2 border-b border-border/40 pb-3">
              <TerminalIcon className="h-3 w-3 text-primary" />
              <span className="label-mono text-[9px]">terminal</span>
            </div>
            <div className="mt-3 space-y-1.5 text-muted-foreground">
              {painel.terminal.map((linha) => (
                <div key={linha.comando}>
                  <div>
                    <span className="text-foreground/60">$</span> {linha.comando}
                  </div>
                  <div className="text-primary">✓ {linha.resultado}</div>
                </div>
              ))}
            </div>
          </div>

          <div className="grid grid-cols-2 gap-px overflow-hidden rounded-lg border border-border/60 bg-border/60">
            {painel.jaVemPronto.map((item) => (
              <JaVemPronto key={item} texto={item} />
            ))}
          </div>
        </div>
      </aside>
    </div>
  );
}

function JaVemPronto({ texto }: { texto: string }) {
  return (
    <div className="bg-background px-4 py-3">
      <div className="label-mono mb-1 text-[9px]">já vem pronto</div>
      <div className="font-semibold text-sm tracking-tight">{texto}</div>
    </div>
  );
}
