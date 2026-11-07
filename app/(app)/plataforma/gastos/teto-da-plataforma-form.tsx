"use client";

/**
 * O CAMPO QUE GRAVA O TETO DA PLATAFORMA, uma linha da tabela por vez.
 *
 * ⚠️ ESTE É O ÚNICO TETO QUE O DONO DO WORKSPACE NÃO ALCANÇA — e é por isso que
 * ele existe. Ele vale POR CIMA do teto de lá e corta **mesmo com o corte
 * automático do workspace desligado**; senão bastaria desligar o corte pra
 * gastar a chave de quem paga a conta.
 *
 * ⚠️ Quem manda é o banco: `set_org_platform_cap` confere `is_platform_admin()`
 * e recusa qualquer outra pessoa. A validação aqui é só pra a mensagem sair em
 * português antes da ida ao servidor — nunca como proteção.
 */

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { salvarTetoDaPlataformaAction } from "@/lib/limits/actions";
import { microsToUsd } from "@/lib/limits/money";
import { tetoDaPlataformaSchema } from "@/lib/limits/schemas";

type Props = {
  organizationId: string;
  organizationName: string;
  /** O que está gravado hoje, em micro-dólar. `null` = sem limite da plataforma. */
  platformCapMicros: number | null;
};

export function TetoDaPlataformaForm({
  organizationId,
  organizationName,
  platformCapMicros,
}: Props) {
  const router = useRouter();
  const [salvando, salvar] = useTransition();
  const [texto, setTexto] = useState(
    platformCapMicros === null ? "" : String(microsToUsd(platformCapMicros)),
  );

  function enviar() {
    // Campo vazio = SEM limite da plataforma. É o mesmo `null` do banco, e é o
    // jeito de tirar um limite que já tinha sido posto.
    const limpo = texto.trim().replace(",", ".");
    const valor = limpo === "" ? null : Number(limpo);

    if (valor !== null && !Number.isFinite(valor)) {
      toast.error("Escreva só o número, em dólar. Ex: 50 ou 12,50.");
      return;
    }

    const conferido = tetoDaPlataformaSchema.safeParse({
      organizationId,
      platformCapUsd: valor,
    });
    if (!conferido.success) {
      toast.error(conferido.error.issues[0]?.message ?? "Confira o valor e tente de novo.");
      return;
    }

    salvar(async () => {
      const resultado = await salvarTetoDaPlataformaAction(conferido.data);
      if (!resultado.ok) {
        toast.error(resultado.error);
        return;
      }
      toast.success(
        valor === null
          ? `${organizationName} ficou sem limite da plataforma.`
          : `Limite salvo pra ${organizationName}.`,
      );
      // A linha da tabela mostra o % em cima deste número: sem o refresh, ela
      // continuaria com a conta antiga até alguém navegar.
      router.refresh();
    });
  }

  return (
    <div className="flex items-center gap-1.5">
      <Input
        type="text"
        inputMode="decimal"
        aria-label={`Limite de gasto com IA pra ${organizationName}, em dólar por mês`}
        placeholder="sem limite"
        value={texto}
        onChange={(e) => setTexto(e.target.value)}
        className="h-8 w-24"
      />
      <Button size="sm" variant="outline" disabled={salvando} onClick={enviar}>
        {salvando ? "..." : "Salvar"}
      </Button>
    </div>
  );
}
