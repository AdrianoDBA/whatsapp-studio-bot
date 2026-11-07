"use client";

/**
 * O FORMULÁRIO DO TETO DE GASTO.
 *
 * ⚠️ BOTÃO PRONTO ANTES DE CAMPO EM BRANCO. Leigo escolhe, não calcula: a
 * primeira coisa da tela são os valores redondos (US$ 5 · 20 · 50 · 200 · sem
 * teto), e o campo livre existe escondido atrás de "Outro valor". Um campo
 * vazio pedindo "quanto você quer gastar com IA por mês?" é a pergunta que
 * ninguém sabe responder na primeira vez.
 *
 * ⚠️ NADA AQUI CONVERTE PRA REAL, e isso é decisão do contrato. Cotação parada
 * faz o teto mentir quando o dólar mexe — e teto que mente é pior que teto
 * nenhum. A tela explica isso com todas as letras (`TEXTO_POR_QUE_EM_DOLAR`).
 *
 * ⚠️ A CONTA DE DÓLAR PRA MICRO-DÓLAR NÃO ACONTECE AQUI. Este formulário fala
 * em DÓLAR (é o que a pessoa digita); quem multiplica é `usdToMicros`, dentro
 * da função do servidor, passando por centavos. Ver `lib/limits/money.ts`.
 */

import { zodResolver } from "@hookform/resolvers/zod";
import { useRouter } from "next/navigation";
import { useId, useState, useTransition } from "react";
import { FormProvider, useForm } from "react-hook-form";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { salvarTetoDoWorkspaceAction } from "@/lib/limits/actions";
import {
  formatTetoUsd,
  microsToUsd,
  TETOS_SUGERIDOS_MICROS,
  usdToMicros,
} from "@/lib/limits/money";
import { type TetoDoWorkspaceInput, tetoDoWorkspaceSchema } from "@/lib/limits/schemas";
import type { BudgetStatus } from "@/lib/limits/types";

/**
 * Lê um valor em dinheiro do jeito que brasileiro escreve. `null` = não deu.
 *
 *   "20"          → 20
 *   "20,50"       → 20.5
 *   "1.234,56"    → 1234.56   (ponto de milhar, vírgula decimal)
 *   "1,234.56"    → 1234.56   (o contrário, que também aparece)
 *   "US$ 20"      → 20
 *   "vinte"       → null
 *
 * O `Number()` sozinho não dá conta: `Number("1.234,56")` é `NaN`, e era esse
 * `NaN` que virava "sem teto".
 */
function lerDinheiro(bruto: string): number | null {
  // Tira só o que é enfeite de moeda. Qualquer OUTRA letra é erro de digitação
  // ("2O" com a letra O), e erro de digitação não pode virar um teto errado
  // em silêncio.
  let t = bruto
    .trim()
    .replace(/^(us\$|u\$|r\$|\$|usd)\s*/i, "")
    .replace(/\s*(usd|dolar(es)?|d[oó]lar(es)?)$/i, "")
    .trim();

  if (!/^\d+([.,]\d+)*$/.test(t)) return null;

  const temVirgula = t.includes(",");
  const temPonto = t.includes(".");

  if (temVirgula && temPonto) {
    // O separador decimal é o que aparece POR ÚLTIMO; o outro é de milhar.
    const decimal = t.lastIndexOf(",") > t.lastIndexOf(".") ? "," : ".";
    const milhar = decimal === "," ? "." : ",";
    t = t.split(milhar).join("").replace(decimal, ".");
  } else if (temVirgula) {
    t = t.replace(",", ".");
  } else if (temPonto) {
    // Um ponto só com 3 casas depois é milhar ("1.234"), não decimal.
    const partes = t.split(".");
    if (partes.length === 2 && partes[1]?.length === 3) t = partes.join("");
  }

  const n = Number(t);
  if (!Number.isFinite(n) || n < 0) return null;
  return n;
}

const CLASSE_SELECT =
  "h-8 w-full rounded-lg border border-input bg-transparent px-2 text-sm outline-none " +
  "focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 dark:bg-input/30";

/** Os valores redondos do teto do MÊS. Os outros dois campos são mais apertados. */
const SUGESTOES_DO_MES = TETOS_SUGERIDOS_MICROS;
/** Um dia ruim custa bem menos que um mês. */
const SUGESTOES_DO_DIA = [1_000_000, 5_000_000, 20_000_000];
/** Uma execução só. Aqui a escala é de centavos. */
const SUGESTOES_POR_EXECUCAO = [50_000, 200_000, 1_000_000];

/** As opções de aviso. O banco aceita de 50 a 99; a tela oferece as redondas. */
const AVISOS = [50, 60, 70, 80, 90, 95];

type Props = {
  orgSlug: string;
  status: BudgetStatus;
};

/** Micro-dólar do banco → o número em dólar que o campo mostra. */
function paraDolar(micros: number | null): number | null {
  return micros === null ? null : microsToUsd(micros);
}

export function LimitesForm({ orgSlug, status }: Props) {
  const router = useRouter();
  const [salvando, salvar] = useTransition();
  const idBase = useId();

  const form = useForm<TetoDoWorkspaceInput>({
    resolver: zodResolver(tetoDoWorkspaceSchema),
    // ⚠️ Valor padrão de formulário mora AQUI, nunca num `.default()` do Zod:
    // `.default()` quebra a tipagem do `useForm` (regra 15 do CLAUDE.md raiz).
    defaultValues: {
      orgSlug,
      monthlyBudgetUsd: paraDolar(status.monthlyBudgetMicros),
      dailyBudgetUsd: paraDolar(status.dailyBudgetMicros),
      maxRunCostUsd: paraDolar(status.maxRunCostMicros),
      hardStop: status.hardStop,
      alertAtPercent: status.alertAtPercent,
    },
  });

  const valores = form.watch();
  const erros = form.formState.errors;

  function onSubmit(values: TetoDoWorkspaceInput) {
    salvar(async () => {
      const resultado = await salvarTetoDoWorkspaceAction(values);
      if (!resultado.ok) {
        toast.error(resultado.error);
        return;
      }
      toast.success("Teto salvo. Ele já vale pra próxima execução.");
      // A faixa do topo aparece em toda página do workspace: sem o refresh, ela
      // continuaria mostrando o número velho até alguém navegar.
      router.refresh();
    });
  }

  return (
    <FormProvider {...form}>
      <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-6">
        <Card>
          <CardHeader className="border-border/60 border-b bg-card/40 py-3">
            <CardTitle className="label-mono text-[10px]">/ teto do mês</CardTitle>
          </CardHeader>
          <CardContent className="space-y-6 p-6">
            <SeletorDeTeto
              id={`${idBase}-mes`}
              titulo="Quanto este workspace pode gastar com IA por mês"
              ajuda="Chegando nesse valor, nenhuma execução nova começa. Ele zera sozinho na virada do mês."
              sugestoes={SUGESTOES_DO_MES}
              valor={valores.monthlyBudgetUsd ?? null}
              onChange={(v) => form.setValue("monthlyBudgetUsd", v, { shouldValidate: true })}
              erro={erros.monthlyBudgetUsd?.message}
            />

            <SeletorDeTeto
              id={`${idBase}-dia`}
              titulo="Teto do dia (opcional)"
              ajuda="Serve pra um dia ruim não comer o mês inteiro. Ele zera à meia-noite, no horário de Brasília."
              sugestoes={SUGESTOES_DO_DIA}
              valor={valores.dailyBudgetUsd ?? null}
              onChange={(v) => form.setValue("dailyBudgetUsd", v, { shouldValidate: true })}
              erro={erros.dailyBudgetUsd?.message}
            />
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="border-border/60 border-b bg-card/40 py-3">
            <CardTitle className="label-mono text-[10px]">/ o que acontece no teto</CardTitle>
          </CardHeader>
          <CardContent className="space-y-6 p-6">
            <fieldset className="space-y-2 border-0 p-0">
              <legend className="mb-1 font-medium text-sm">Corte automático</legend>
              <div className="grid gap-2 sm:grid-cols-2">
                <OpcaoDeCorte
                  marcada={valores.hardStop === true}
                  onClick={() => form.setValue("hardStop", true)}
                  titulo="Parar os agentes"
                  texto="Chegou no teto, nada novo começa. É o padrão."
                />
                <OpcaoDeCorte
                  marcada={valores.hardStop === false}
                  onClick={() => form.setValue("hardStop", false)}
                  titulo="Só avisar"
                  texto="Os agentes continuam rodando e a conta continua subindo."
                />
              </div>
              <p className="text-[11px] text-muted-foreground">
                Mesmo com o corte ligado, a execução que já tinha começado termina: o custo de uma
                execução só existe depois que ela acaba. É uma linha de parada, não uma trava.
              </p>
            </fieldset>

            <div className="space-y-1.5">
              <label htmlFor={`${idBase}-aviso`} className="font-medium text-sm">
                Avisar quando passar de
              </label>
              <select
                id={`${idBase}-aviso`}
                className={CLASSE_SELECT}
                value={valores.alertAtPercent ?? 80}
                onChange={(e) => form.setValue("alertAtPercent", Number(e.target.value))}
              >
                {AVISOS.map((p) => (
                  <option key={p} value={p}>
                    {p}% do teto
                  </option>
                ))}
              </select>
              <p className="text-[11px] text-muted-foreground">
                O aviso aparece numa faixa no topo de todas as telas deste workspace, uma vez por
                mês. Se você aumentar o teto depois, ele volta a valer.
              </p>
              {erros.alertAtPercent && (
                <p className="text-destructive text-sm">{erros.alertAtPercent.message}</p>
              )}
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="border-border/60 border-b bg-card/40 py-3">
            <CardTitle className="label-mono text-[10px]">/ avançado</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4 p-6">
            <SeletorDeTeto
              id={`${idBase}-execucao`}
              titulo="Teto por execução (opcional)"
              ajuda="O único que age DURANTE: o agente para de dar passos quando o que ele já gastou nessa execução passa desse valor."
              sugestoes={SUGESTOES_POR_EXECUCAO}
              valor={valores.maxRunCostUsd ?? null}
              onChange={(v) => form.setValue("maxRunCostUsd", v, { shouldValidate: true })}
              erro={erros.maxRunCostUsd?.message}
            />
            <p className="text-[11px] text-muted-foreground">
              Sem esse teto, uma execução no talo pode custar alguns dólares sozinha — ela para só
              quando bate no número de passos do agente. Com um modelo que não está na tabela de
              preços do template, esse teto não age (não dá pra parar por um número que não existe).
            </p>
          </CardContent>
        </Card>

        <Button type="submit" disabled={salvando}>
          {salvando ? "Salvando..." : "Salvar limites"}
        </Button>
      </form>
    </FormProvider>
  );
}

// ---------------------------------------------------------------------------
// Um teto: os botões prontos, "sem teto" e o campo livre escondido
// ---------------------------------------------------------------------------

function SeletorDeTeto({
  id,
  titulo,
  ajuda,
  sugestoes,
  valor,
  onChange,
  erro,
}: {
  id: string;
  titulo: string;
  ajuda: string;
  /** Os valores redondos, em MICRO-dólar (é como eles são escritos no código). */
  sugestoes: readonly number[];
  /** O valor atual, em DÓLAR. `null` = sem teto. */
  valor: number | null;
  onChange: (valor: number | null) => void;
  erro?: string;
}) {
  // Os redondos chegam em micro-dólar (é como eles são escritos no código) e o
  // formulário fala em dólar: a conversão acontece num lugar só, aqui.
  const opcoes = sugestoes.map((micros) => ({ micros, dolar: microsToUsd(micros) }));
  const combina = valor !== null && opcoes.some((o) => o.dolar === valor);

  // "Outro valor" fica aberto quando o teto salvo não é nenhum dos redondos —
  // senão a pessoa abriria a tela sem enxergar o próprio número.
  const [outro, setOutro] = useState(valor !== null && !combina);
  const [texto, setTexto] = useState(valor === null ? "" : String(valor));
  const [invalido, setInvalido] = useState(false);

  function escolher(v: number | null) {
    setOutro(false);
    setInvalido(false);
    setTexto(v === null ? "" : String(v));
    onChange(v);
  }

  function digitar(bruto: string) {
    setTexto(bruto);
    const numero = lerDinheiro(bruto);

    // TEXTO QUE NÃO VIRA NÚMERO NÃO PODE VIRAR "SEM TETO".
    //
    // Antes virava: qualquer coisa que o `Number()` não entendesse caía em
    // `null`, e `null` neste formulário quer dizer exatamente "sem teto". Ou
    // seja, digitar "1.234,56" — que é como se escreve número em português —
    // APAGAVA o teto e ainda mostrava "Teto salvo". A proteção sumia sem
    // ninguém ver.
    //
    // Agora: enquanto o texto não fizer sentido, o valor de antes continua
    // valendo e a pessoa vê o aviso. Pra tirar o teto existe o botão
    // "Sem teto", que é uma escolha, não um acidente de digitação.
    if (numero === null) {
      setInvalido(bruto.trim() !== "");
      return;
    }
    setInvalido(false);
    onChange(numero);
  }

  return (
    <div className="space-y-2">
      <p className="font-medium text-sm">{titulo}</p>
      <p className="text-[11px] text-muted-foreground">{ajuda}</p>

      <div className="flex flex-wrap gap-1.5">
        {opcoes.map((o) => (
          <BotaoDeTeto
            key={o.micros}
            marcado={!outro && valor === o.dolar}
            onClick={() => escolher(o.dolar)}
            rotulo={formatTetoUsd(o.micros)}
          />
        ))}
        <BotaoDeTeto
          marcado={!outro && valor === null}
          onClick={() => escolher(null)}
          rotulo="Sem teto"
        />
        <BotaoDeTeto marcado={outro} onClick={() => setOutro(true)} rotulo="Outro valor" />
      </div>

      {outro && (
        <div className="space-y-1.5 pt-1">
          <label htmlFor={id} className="text-[11px] text-muted-foreground">
            Quanto, em dólar (use ponto ou vírgula pros centavos)
          </label>
          <Input
            id={id}
            type="text"
            inputMode="decimal"
            placeholder="Ex: 12,50"
            value={texto}
            onChange={(e) => digitar(e.target.value)}
            className="max-w-[180px]"
          />
          {/* Três estados, e os três precisam de frase própria.
              ⚠️ Repare que "não entendi" NÃO é mais deduzido de `valor === null`:
              texto inválido não mexe mais no valor (senão apagaria o teto), então
              quem sabe que está inválido é o `invalido`. */}
          {invalido ? (
            <p className="text-[11px] text-destructive">
              Não entendi esse valor — o teto que já estava continua valendo. Escreva só o número,
              assim: 12,50
            </p>
          ) : texto.trim() === "" ? (
            <p className="text-[11px] text-muted-foreground">
              Escreva um valor. Pra deixar sem teto nenhum, clique em "Sem teto" aí em cima.
            </p>
          ) : valor === null ? (
            <p className="text-[11px] text-muted-foreground">Sem teto.</p>
          ) : (
            <p className="text-[11px] text-muted-foreground">
              Vai salvar: {formatTetoUsd(usdToMicros(valor))}
            </p>
          )}
        </div>
      )}

      {erro && <p className="text-destructive text-sm">{erro}</p>}
    </div>
  );
}

function BotaoDeTeto({
  marcado,
  onClick,
  rotulo,
}: {
  marcado: boolean;
  onClick: () => void;
  rotulo: string;
}) {
  return (
    <button
      type="button"
      aria-pressed={marcado}
      onClick={onClick}
      className={`rounded-lg border px-2.5 py-1 text-xs transition-colors ${
        marcado
          ? "border-primary/50 bg-primary/10 text-primary"
          : "border-border/60 text-muted-foreground"
      }`}
    >
      {rotulo}
    </button>
  );
}

function OpcaoDeCorte({
  marcada,
  onClick,
  titulo,
  texto,
}: {
  marcada: boolean;
  onClick: () => void;
  titulo: string;
  texto: string;
}) {
  return (
    <button
      type="button"
      aria-pressed={marcada}
      onClick={onClick}
      className={`rounded-lg border p-2.5 text-left transition-colors ${
        marcada ? "border-primary/50 bg-primary/5" : "border-border/60"
      }`}
    >
      <span className="block font-medium text-sm">{titulo}</span>
      <span className="block text-[11px] text-muted-foreground">{texto}</span>
    </button>
  );
}
