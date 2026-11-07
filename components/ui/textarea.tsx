import type * as React from "react";

import { cn } from "@/lib/utils";

/**
 * Campo de texto de várias linhas.
 *
 * ⚠️ ESTE É O ÚNICO ARQUIVO DE `components/ui/` ESCRITO À MÃO.
 * O `@base-ui/react` (a base do shadcn neste projeto) não tem primitiva de
 * textarea — só de `input`. Então este arquivo é um `<textarea>` normal do
 * HTML vestido com exatamente as mesmas classes de `components/ui/input.tsx`,
 * pra os dois campos ficarem iguais na tela.
 *
 * Se um dia `npx shadcn@latest add textarea` passar a funcionar aqui, dá pra
 * trocar por ele — o nome exportado e as props são as mesmas.
 */
function Textarea({ className, ...props }: React.ComponentProps<"textarea">) {
  return (
    <textarea
      data-slot="textarea"
      className={cn(
        "field-sizing-content min-h-16 w-full min-w-0 rounded-lg border border-input bg-transparent px-2.5 py-1.5 text-base transition-colors outline-none placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 disabled:pointer-events-none disabled:cursor-not-allowed disabled:bg-input/50 disabled:opacity-50 aria-invalid:border-destructive aria-invalid:ring-3 aria-invalid:ring-destructive/20 md:text-sm dark:bg-input/30 dark:disabled:bg-input/80 dark:aria-invalid:border-destructive/50 dark:aria-invalid:ring-destructive/40",
        className,
      )}
      {...props}
    />
  );
}

export { Textarea };
