"use client";

/**
 * As três bolinhas que piscam enquanto o agente pensa.
 *
 * Apresentação pura: não busca nada, não decide nada.
 *
 * ⚠️ O RÓTULO É IMPORTANTE PRO LEIGO. "Pensando…" e "Buscando na base de
 * conhecimento…" são a diferença entre "travou" e "está trabalhando". Quem
 * sabe o que está acontecendo é quem chama; este componente só escreve.
 */
export function ThinkingIndicator({ label = "Pensando…" }: { label?: string }) {
  return (
    <span
      className="inline-flex items-center gap-2 text-muted-foreground text-sm"
      role="status"
      aria-live="polite"
    >
      <span className="inline-flex items-center gap-1">
        <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-primary" />
        <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-primary [animation-delay:200ms]" />
        <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-primary [animation-delay:400ms]" />
      </span>
      {label}
    </span>
  );
}
