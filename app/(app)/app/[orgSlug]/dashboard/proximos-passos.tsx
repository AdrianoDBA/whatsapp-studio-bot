import { CheckIcon, CircleDashedIcon } from "lucide-react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import type { ProximoPasso } from "@/lib/dashboard/types";

/**
 * "O QUE FALTA PRA ISSO FUNCIONAR" — o primeiro bloco do Início.
 *
 * Quem decide o que entra na lista é `lib/dashboard/passos.ts`, que é puro e
 * tem teste. Aqui é só desenho.
 *
 * ⚠️ O BLOCO INTEIRO SOME quando não falta mais nada — quem confere é a página,
 * com `temPendencia`. Uma lista de degraus todos marcados ficaria ocupando o
 * topo da tela pra sempre, dizendo a mesma coisa todo dia.
 */
export function ProximosPassos({ passos }: { passos: ProximoPasso[] }) {
  const faltam = passos.filter((p) => !p.feito).length;

  return (
    <section className="overflow-hidden rounded-xl border border-primary/25 bg-primary/[0.04]">
      <header className="flex flex-wrap items-center justify-between gap-2 border-primary/15 border-b px-5 py-3">
        <p className="label-mono text-primary">/ falta configurar</p>
        <p className="text-muted-foreground text-xs">
          {faltam === 1 ? "1 coisa pendente" : `${faltam} coisas pendentes`}
        </p>
      </header>

      <ul className="divide-y divide-border/50">
        {passos.map((passo) => (
          <li
            key={passo.id}
            className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 px-5 py-3.5"
          >
            <div className="flex min-w-0 items-start gap-3">
              {passo.feito ? (
                <span className="mt-0.5 grid h-5 w-5 shrink-0 place-items-center rounded-full bg-primary/15 text-primary">
                  <CheckIcon className="h-3 w-3" />
                </span>
              ) : (
                <CircleDashedIcon className="mt-0.5 h-5 w-5 shrink-0 text-muted-foreground/60" />
              )}

              <div className="min-w-0 space-y-0.5">
                <p
                  className={`font-medium text-sm ${passo.feito ? "text-muted-foreground line-through decoration-muted-foreground/40" : ""}`}
                >
                  {passo.titulo}
                </p>
                {/* A explicação só aparece no que ainda falta: repetir o
                    "por quê" de um degrau já cumprido é ruído. */}
                {!passo.feito && (
                  <p className="text-balance text-muted-foreground text-xs leading-relaxed">
                    {passo.explicacao}
                  </p>
                )}
              </div>
            </div>

            {!passo.feito &&
              (passo.acao ? (
                <Button
                  render={<Link href={passo.acao.href} />}
                  nativeButton={false}
                  size="sm"
                  variant="outline"
                  className="shrink-0"
                >
                  {passo.acao.rotulo}
                </Button>
              ) : (
                // Sem botão porque essa pessoa não pode fazer esse passo. Ver o
                // aviso 1 no topo de `lib/dashboard/passos.ts`.
                <p className="shrink-0 text-muted-foreground text-xs">{passo.recado}</p>
              ))}
          </li>
        ))}
      </ul>
    </section>
  );
}
