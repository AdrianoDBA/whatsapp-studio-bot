import { CalendarClockIcon } from "lucide-react";
import type { ProximaAutomacao } from "@/lib/dashboard/types";
import { formatRelativeTime } from "@/lib/format";

/**
 * "O QUE VAI RODAR SOZINHO DAQUI A POUCO".
 *
 * ⚠️ SÓ APARECE PRA DONO E ADMINISTRADOR. Não é sigilo — qualquer membro pode
 * ler `schedules`. É que o destino deste bloco é `/automacoes`, que é
 * `requireOrgRole`: um bloco cuja única saída chuta a pessoa de volta pro
 * Início não é informação, é armadilha. Quem filtra é `lib/dashboard/queries`.
 *
 * ⚠️ COMPONENTE DE SERVIDOR — mesmo motivo de `UltimasExecucoes`: o texto "em
 * 3 h" muda com o relógio, e num componente de navegador o servidor e o
 * navegador escreveriam coisas diferentes.
 */
export function ProximasAutomacoes({ automacoes }: { automacoes: ProximaAutomacao[] }) {
  return (
    <ul className="divide-y divide-border/50">
      {automacoes.map((a) => (
        <li
          key={a.id}
          className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 px-5 py-3"
        >
          <div className="flex min-w-0 items-center gap-3">
            <CalendarClockIcon className="h-3.5 w-3.5 shrink-0 text-muted-foreground/60" />
            <div className="min-w-0">
              <p className="truncate font-medium text-sm">{a.nome}</p>
              <p className="truncate text-muted-foreground text-xs">{a.agenteNome}</p>
            </div>
          </div>
          <p className="shrink-0 text-muted-foreground text-xs">
            roda {formatRelativeTime(a.proximaEm)}
          </p>
        </li>
      ))}
    </ul>
  );
}
