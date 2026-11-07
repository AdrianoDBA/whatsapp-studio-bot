"use client";

import { Button } from "@/components/ui/button";

/**
 * Tela mostrada quando alguma página quebra.
 *
 * O `digest` é um código curto que o Next gera pro erro. Ele também aparece no
 * log do servidor — é o que liga "o que a pessoa viu na tela" com "a linha que
 * explica o motivo". Sem mostrar esse código, o aluno não tem como achar a
 * causa nem passar informação útil pro Claude Code.
 */
export default function AppError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-4 p-6 text-center">
      <h2 className="font-semibold text-2xl">Algo deu errado</h2>
      <p className="max-w-md text-muted-foreground text-sm">
        Tente de novo. Se continuar, copie o código abaixo e mande pro Claude Code contando o que
        você estava fazendo.
      </p>
      {error.digest && (
        <div className="space-y-1">
          <code className="rounded border border-border bg-card px-2 py-1 font-mono text-xs">
            código: {error.digest}
          </code>
          <p className="max-w-md text-muted-foreground text-xs">
            Esse mesmo código aparece no log do servidor, junto da explicação do erro. No EasyPanel:
            abra seu app e clique na aba <strong>Logs</strong>.
          </p>
        </div>
      )}
      <Button onClick={reset}>Tentar novamente</Button>
    </div>
  );
}
