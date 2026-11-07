"use client";

/**
 * "TESTAR BUSCA" — o jeito mais rápido de descobrir se o documento certo entrou.
 *
 * É exatamente a mesma busca que o agente faz por dentro (a ferramenta
 * `buscar-na-base` chama a mesma função do servidor). Quando o agente diz que
 * não achou nada, é aqui que se descobre se o problema foi o documento ou foi a
 * pergunta.
 *
 * ⚠️ CADA BUSCA CUSTA ALGUNS CENTAVOS DE MILÉSIMO: a pergunta também precisa
 * virar números. É pouquíssimo (~1 micro-dólar), mas não é zero — por isso o
 * botão não dispara sozinho enquanto a pessoa digita.
 */

import { SearchIcon } from "lucide-react";
import { useId, useState, useTransition } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { searchKnowledgeBaseAction } from "@/lib/knowledge/actions";
import type { KnowledgeSearchHit } from "@/lib/knowledge/types";

export function TestarBusca({ orgSlug, baseSlug }: { orgSlug: string; baseSlug: string }) {
  const idDoCampo = useId();
  const [pergunta, setPergunta] = useState("");
  const [procurando, start] = useTransition();
  const [achados, setAchados] = useState<KnowledgeSearchHit[] | null>(null);

  function procurar(evento: React.FormEvent<HTMLFormElement>) {
    evento.preventDefault();
    const texto = pergunta.trim();
    if (texto.length < 2) {
      toast.error("Escreva a pergunta com pelo menos duas letras.");
      return;
    }

    start(async () => {
      const r = await searchKnowledgeBaseAction({ orgSlug, baseSlug, pergunta: texto });
      if (!r.ok) {
        setAchados(null);
        toast.error(r.error);
        return;
      }
      setAchados(r.data?.hits ?? []);
    });
  }

  return (
    <Card>
      <CardHeader className="border-border/60 border-b bg-card/40 py-3">
        <CardTitle className="label-mono text-[10px]">/ testar busca</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4 p-5">
        <form onSubmit={procurar} className="flex flex-wrap items-end gap-2">
          <div className="min-w-[16rem] flex-1 space-y-1.5">
            <label className="font-medium text-sm" htmlFor={idDoCampo}>
              Pergunte como uma pessoa perguntaria
            </label>
            <Input
              id={idDoCampo}
              value={pergunta}
              onChange={(e) => setPergunta(e.target.value)}
              placeholder="Ex: quantos dias de férias eu tenho?"
              maxLength={2000}
            />
          </div>
          <Button type="submit" disabled={procurando} className="gap-1.5">
            <SearchIcon className="h-3.5 w-3.5" />
            {procurando ? "Procurando..." : "Procurar"}
          </Button>
        </form>

        <p className="text-muted-foreground text-xs">
          A busca é por SIGNIFICADO, não por palavra exata: "férias" acha um trecho que fala de
          "descanso anual". Se não achar nada, o documento provavelmente não tem esse assunto.
        </p>

        {achados !== null && achados.length === 0 && (
          <p className="text-sm">
            Não achei nenhum trecho parecido com isso. Confira se o documento certo já foi enviado —
            e se ele está como <span className="font-medium">Pronto</span> na lista.
          </p>
        )}

        {achados !== null && achados.length > 0 && (
          <ul className="space-y-3">
            {achados.map((hit) => (
              <li key={hit.chunkId} className="rounded-lg border border-border/60 bg-card/40 p-4">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="font-medium text-sm">{hit.documentTitle}</span>
                  <span className="font-mono text-muted-foreground text-xs">
                    trecho #{hit.seq} · {Math.round(hit.similarity * 100)}% parecido
                  </span>
                </div>
                <p className="mt-2 whitespace-pre-wrap text-muted-foreground text-sm">
                  {hit.content}
                </p>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}
