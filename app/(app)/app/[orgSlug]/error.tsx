"use client";

import { Button } from "@/components/ui/button";

/**
 * Tela de erro DENTRO do app (mantém menu lateral e cabeçalho no lugar).
 * Ver app/error.tsx pra explicação do código de erro.
 */
export default function OrgError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <div className="flex flex-col items-center justify-center gap-4 py-20 text-center">
      <h2 className="font-semibold text-xl">Essa parte não carregou</h2>
      <p className="max-w-md text-muted-foreground text-sm">
        Tente de novo. Se o problema persistir, entre em contato com o suporte técnico informando o código abaixo.
      </p>
      {error.digest && (
        <div className="space-y-1">
          <code className="rounded border border-border bg-card px-2 py-1 font-mono text-xs">
            código: {error.digest}
          </code>
          <p className="max-w-md text-muted-foreground text-xs">
            O mesmo código aparece no log do servidor (no EasyPanel: aba <strong>Logs</strong> do
            seu app).
          </p>
        </div>
      )}
      <Button onClick={reset}>Tentar novamente</Button>
    </div>
  );
}
