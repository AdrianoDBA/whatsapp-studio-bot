import { KeyRoundIcon, SparklesIcon } from "lucide-react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import type { EmbeddingReadiness } from "@/lib/knowledge/types";
import { getProviderInfo } from "@/lib/secrets/providers";

/**
 * O AVISO MAIS IMPORTANTE DESTA TELA — "dá pra ler documento aqui?"
 *
 * A Anthropic não tem serviço de embedding. Quem cadastrou SÓ a chave dela
 * consegue conversar com um agente normalmente, mas NÃO consegue indexar
 * nenhum documento. (O OpenRouter repassa embedding, sim — e é o caminho
 * recomendado justamente por isso: uma chave só faz as duas coisas.)
 *
 * Sem este cartão, o caminho do aluno seria: subir um PDF de 4 MB → esperar
 * → "Falhou", sem saber por quê. Com ele, o aviso aparece antes de qualquer
 * upload, e o texto diz o que fazer e onde.
 *
 * É Server Component de propósito: não tem nada de interativo aqui, e a
 * resposta vem de `getEmbeddingReadiness`, que fala com o banco.
 */
export function EmbeddingKeyCard({
  orgSlug,
  prontidao,
}: {
  orgSlug: string;
  prontidao: EmbeddingReadiness;
}) {
  if (prontidao.pronto) {
    // ⚠️ O NOME BONITO VEM DO CATÁLOGO, sempre. Aqui já existiu um
    // `p === "openai" ? "OpenAI" : "Google"` — escrito quando só havia dois
    // provedores de embedding. Quando o OpenRouter entrou, ele caiu no "senão"
    // e a tela passou a dizer "sua chave da Google" pra quem só tinha
    // OpenRouter cadastrado. Nome de provedor mora em `lib/secrets/providers.ts`
    // e em lugar nenhum mais.
    const nomes = prontidao.provedoresProntos.map((p) => getProviderInfo(p).label).join(" e ");
    return (
      <p className="flex items-center gap-2 text-muted-foreground text-xs">
        <SparklesIcon className="h-3.5 w-3.5 text-primary" />
        Os documentos vão ser lidos com a sua chave da {nomes}.
      </p>
    );
  }

  return (
    <Card className="border-amber-500/40 bg-amber-500/5">
      <CardContent className="flex flex-wrap items-start justify-between gap-4 p-5">
        <div className="flex items-start gap-3">
          <KeyRoundIcon className="mt-0.5 h-4 w-4 shrink-0 text-amber-500" />
          <div className="space-y-1">
            <p className="font-medium text-sm">Falta a chave que lê documento</p>
            <p className="max-w-xl text-muted-foreground text-sm">{prontidao.mensagem}</p>
          </div>
        </div>
        <Button
          render={<Link href={`/app/${orgSlug}/settings/integracoes`} />}
          nativeButton={false}
          size="sm"
          variant="outline"
        >
          Abrir Integrações
        </Button>
      </CardContent>
    </Card>
  );
}
