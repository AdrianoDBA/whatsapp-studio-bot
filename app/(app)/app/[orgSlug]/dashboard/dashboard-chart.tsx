"use client";

import { Area, AreaChart, CartesianGrid, XAxis, YAxis } from "recharts";
import {
  type ChartConfig,
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
} from "@/components/ui/chart";
import { formatShortDay, formatUsdFromMicros } from "@/lib/format";
import type { DaySpend } from "@/lib/limits/types";

/**
 * QUANTO A IA CUSTOU, DIA A DIA.
 *
 * Este gráfico já foi um array fixo em `lib/mock/dashboard.ts`. Agora ele lê
 * `org_ai_spend`, que é a MESMA tabela que segura o teto de gasto — o que
 * aparece aqui é literalmente o que o medidor conta.
 *
 * ⚠️ O DINHEIRO AQUI SAI COM 4 CASAS (`formatUsdFromMicros`), e não com as 2
 * de `formatTetoUsd`. Não é descuido nem inconsistência: 2 casas são a escala
 * do MÊS, e um dia de uso normal custa frações de centavo. Com 2 casas o eixo
 * inteiro viraria "US$ 0,00" repetido e o gráfico não diria nada. As 2 casas
 * continuam mandando no cartão "gasto do mês", logo acima, que é escala de mês.
 *
 * ⚠️ COMPONENTE DE NAVEGADOR ("use client") — Recharts mede o tamanho do
 * elemento pra desenhar. Por isso ele importa só `formatUsdFromMicros` e o
 * TIPO de `DaySpend`; nada daqui pode puxar `lib/limits/queries`, que fala com
 * o banco.
 */

const chartConfig = {
  micros: { label: "Custo", color: "var(--color-chart-1)" },
} satisfies ChartConfig;

export function DashboardChart({ data }: { data: DaySpend[] }) {
  const pontos = data.map((d) => ({ day: d.day, micros: d.spentMicros }));

  return (
    <ChartContainer config={chartConfig} className="h-72 w-full">
      <AreaChart data={pontos} margin={{ top: 12, right: 12, bottom: 0, left: 0 }}>
        <defs>
          <linearGradient id="custo-fill" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="var(--color-micros)" stopOpacity={0.45} />
            <stop offset="100%" stopColor="var(--color-micros)" stopOpacity={0} />
          </linearGradient>
        </defs>
        <CartesianGrid
          strokeDasharray="2 6"
          vertical={false}
          stroke="currentColor"
          strokeOpacity={0.08}
        />
        <XAxis
          dataKey="day"
          tickFormatter={formatShortDay}
          fontSize={10}
          tickLine={false}
          axisLine={false}
          stroke="currentColor"
          opacity={0.5}
          minTickGap={32}
        />
        <YAxis
          tickFormatter={(v: number) => formatUsdFromMicros(v)}
          fontSize={10}
          tickLine={false}
          axisLine={false}
          stroke="currentColor"
          opacity={0.5}
          width={72}
        />
        <ChartTooltip
          cursor={{
            stroke: "var(--color-micros)",
            strokeDasharray: "3 3",
            strokeOpacity: 0.4,
          }}
          content={
            <ChartTooltipContent
              indicator="line"
              labelFormatter={(rotulo) => formatShortDay(String(rotulo))}
              formatter={(valor) => formatUsdFromMicros(Number(valor))}
            />
          }
        />
        <Area
          dataKey="micros"
          type="monotone"
          stroke="var(--color-micros)"
          fill="url(#custo-fill)"
          strokeWidth={2}
          isAnimationActive={false}
          activeDot={{
            r: 5,
            fill: "var(--color-micros)",
            stroke: "var(--color-card)",
            strokeWidth: 3,
          }}
        />
      </AreaChart>
    </ChartContainer>
  );
}
