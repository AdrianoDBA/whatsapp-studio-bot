import type { LucideIcon } from "lucide-react";
import Link from "next/link";

/**
 * Um número do Início.
 *
 * ⚠️ NÃO EXISTE MAIS SETINHA DE "SUBIU/DESCEU". Ela existia porque o número era
 * inventado — dá pra desenhar qualquer variação num array fixo. Com dado real
 * não há de onde tirar a comparação sem uma segunda consulta por cartão, e uma
 * setinha que aponta pra cima sem saber por quê é exatamente o tipo de coisa
 * que fazia esta tela mentir. No lugar dela entrou `rodape`, que é uma frase
 * curta e verdadeira ("2 deram errado", "13% do teto").
 */
type Props = {
  label: string;
  /** Já formatado (`formatTetoUsd`, `formatTokens`…). Este componente não faz conta. */
  value: string;
  /** A linha de baixo. `null` esconde. */
  rodape?: string | null;
  /** `alerta` pinta o rodapé de vermelho — falha, teto estourado. */
  tom?: "normal" | "alerta";
  icon: LucideIcon;
  /** Cartão vira link. `null` pra quem não pode abrir o destino. */
  href?: string | null;
};

export function KpiCard({ label, value, rodape, tom = "normal", icon: Icon, href }: Props) {
  const conteudo = (
    <>
      {/* Risco de luz no topo, só no hover. */}
      <div className="pointer-events-none absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-primary/0 to-transparent transition-all group-hover:via-primary/60" />

      <div className="p-5">
        <div className="flex items-start justify-between">
          <span className="label-mono">{label}</span>
          <Icon className="h-3.5 w-3.5 text-muted-foreground/60 transition-colors group-hover:text-primary" />
        </div>

        <div className="mt-3 font-semibold text-3xl tracking-tight tabular-nums">{value}</div>

        {rodape ? (
          <p
            className={`mt-1.5 text-xs ${tom === "alerta" ? "text-destructive" : "text-muted-foreground"}`}
          >
            {rodape}
          </p>
        ) : (
          // Espaço reservado: sem ele, um cartão com rodapé e outro sem ficam
          // com alturas diferentes e a fileira desalinha.
          <p className="mt-1.5 text-xs opacity-0" aria-hidden="true">
            &nbsp;
          </p>
        )}
      </div>
    </>
  );

  const classe =
    "group relative block overflow-hidden rounded-xl border border-border bg-card glow-hover surface-highlight";

  if (!href) {
    return <div className={classe}>{conteudo}</div>;
  }

  return (
    <Link href={href} className={classe}>
      {conteudo}
    </Link>
  );
}
