"use client";

/**
 * OS WEBHOOKS: o endereço secreto que faz um sistema de fora disparar o agente.
 *
 * Não tem formulário de criar aqui — um webhook nasce de arquivo
 * (`lib/automation/blueprint.ts`) e é gravado por `materializarWorkspace`,
 * SEMPRE com um token sorteado e descartado (ninguém vê). Peça pro Claude
 * Code declarar um na lista `WEBHOOKS` de `lib/seed/registro.ts`. Um workspace
 * novo já nasce com ele; um workspace que já existe (como o do aluno olhando
 * esta tela) recebe no próximo deploy — o comando `npm run semear` continua
 * existindo pra quem quiser forçar agora, sem esperar. Depois de existir,
 * "Gerar token" é o jeito de conseguir um token que dá pra usar de verdade.
 *
 * ┌─────────────────────────────────────────────────────────────────────────┐
 * │ ⚠️ O TOKEN APARECE UMA VEZ SÓ.                                           │
 * │ Ele existe só no momento em que alguém clica "Gerar token", dentro da    │
 * │ resposta da função do servidor. O banco guarda só o sha256 dele — não    │
 * │ existe "mostrar de novo", nem pra quem administra, nem pra quem tem      │
 * │ acesso ao banco.                                                        │
 * │                                                                          │
 * │ Por isso o cartão verde só some quando a pessoa clica em "Já copiei", e  │
 * │ o texto diz isso com todas as letras. Um toast que some sozinho em 4     │
 * │ segundos faria o aluno perder o token e não entender por quê.            │
 * │                                                                          │
 * │ ISSO NÃO VALE PRO ENDEREÇO (a URL): ele vem do `id` da linha, nunca do   │
 * │ token, e fica visível pra sempre na lista abaixo. Girar o token não      │
 * │ muda o endereço — é essa separação que deixa "Gerar token" seguro de     │
 * │ clicar de novo.                                                         │
 * └─────────────────────────────────────────────────────────────────────────┘
 */

import { AlertTriangleIcon, RefreshCwIcon } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { toast } from "sonner";
import { EmptyState } from "@/components/app/empty-state";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  alternarModoDoWebhookAction,
  assumirWebhookAction,
  girarTokenDoWebhookAction,
} from "@/lib/automation/actions";
import type { WebhookSummary } from "@/lib/automation/types";
import { formatDateTime } from "@/lib/format";
import { ChaveDeModo } from "./agendamentos-panel";

/** Copia pra área de transferência e avisa. Nunca lança. */
async function copiar(texto: string, oQue: string): Promise<void> {
  try {
    await navigator.clipboard.writeText(texto);
    toast.success(`${oQue} copiado.`);
  } catch {
    toast.error(`Não deu pra copiar automaticamente. Selecione o ${oQue.toLowerCase()} e copie.`);
  }
}

type TokenRecemGirado = { url: string; token: string };

export function WebhooksPanel({
  orgSlug,
  webhooks,
  meuUserId,
}: {
  orgSlug: string;
  webhooks: WebhookSummary[];
  /** Pra saber se o webhook roda no MEU nome (só aí dá pra ligar o modo real). */
  meuUserId: string;
}) {
  const [recemGirado, setRecemGirado] = useState<TokenRecemGirado | null>(null);

  return (
    <Card>
      <CardHeader className="border-border/60 border-b bg-card/40 py-3">
        <CardTitle className="label-mono text-[10px]">/ webhooks</CardTitle>
      </CardHeader>

      <CardContent className="space-y-4 p-0">
        {recemGirado && (
          <CartaoDoTokenNovo dados={recemGirado} onFechar={() => setRecemGirado(null)} />
        )}

        {webhooks.length === 0 ? (
          <EmptyState
            title="Nenhum endereço ainda"
            description="Peça pro Claude Code declarar um na lista WEBHOOKS, em lib/seed/registro.ts. Workspace novo já nasce com ele; este aqui recebe no próximo deploy — ou rode npm run semear agora, sem esperar."
          />
        ) : (
          <ul className="divide-y divide-border/60">
            {webhooks.map((w) => (
              <li key={w.id}>
                <LinhaDoWebhook
                  orgSlug={orgSlug}
                  webhook={w}
                  meuUserId={meuUserId}
                  onGirado={setRecemGirado}
                />
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// O cartão do token recém-gerado
// ---------------------------------------------------------------------------

function CartaoDoTokenNovo({ dados, onFechar }: { dados: TokenRecemGirado; onFechar: () => void }) {
  const exemplo =
    `curl -X POST "${dados.url}" \\\n` +
    `  -H "Authorization: Bearer ${dados.token}" \\\n` +
    `  -H "Content-Type: application/json" \\\n` +
    `  -d '{"mensagem": "oi"}'`;

  return (
    <div className="m-4 space-y-3 rounded-lg border border-primary/40 bg-primary/5 p-4">
      <p className="font-medium text-sm">Guarde esse token agora — ele aparece uma vez só.</p>
      <p className="text-muted-foreground text-sm">
        O endereço abaixo não muda — ele continua na lista pra sempre. É só o token que some depois
        de fechar este cartão: o app guarda apenas uma marca embaralhada dele. O token anterior
        parou de funcionar neste instante — se algum sistema usava ele, atualize lá.
      </p>

      <div className="space-y-1">
        <span className="label-mono block text-[10px]">/ endereço</span>
        <div className="flex flex-wrap items-center gap-2">
          <code className="min-w-0 flex-1 break-all rounded bg-background/60 px-2 py-1 font-mono text-xs">
            {dados.url}
          </code>
          <Button size="xs" variant="outline" onClick={() => copiar(dados.url, "Endereço")}>
            Copiar
          </Button>
        </div>
      </div>

      <div className="space-y-1">
        <span className="label-mono block text-[10px]">/ token</span>
        <div className="flex flex-wrap items-center gap-2">
          <code className="min-w-0 flex-1 break-all rounded bg-background/60 px-2 py-1 font-mono text-xs">
            {dados.token}
          </code>
          <Button size="xs" variant="outline" onClick={() => copiar(dados.token, "Token")}>
            Copiar
          </Button>
        </div>
      </div>

      <div className="space-y-1">
        <span className="label-mono block text-[10px]">/ pra testar no terminal</span>
        <pre className="overflow-x-auto rounded bg-background/60 p-2 font-mono text-[11px]">
          {exemplo}
        </pre>
        <Button size="xs" variant="ghost" onClick={() => copiar(exemplo, "Comando")}>
          Copiar o comando
        </Button>
      </div>

      <Button size="sm" onClick={onFechar}>
        Já copiei, pode esconder
      </Button>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Uma linha da lista
// ---------------------------------------------------------------------------

function LinhaDoWebhook({
  orgSlug,
  webhook,
  meuUserId,
  onGirado,
}: {
  orgSlug: string;
  webhook: WebhookSummary;
  meuUserId: string;
  /** Mostra o cartão do token novo lá em cima, depois de girar com sucesso. */
  onGirado: (dados: TokenRecemGirado) => void;
}) {
  const router = useRouter();
  const [ocupado, executar] = useTransition();

  const meu = webhook.runAsUserId === meuUserId;

  function chamar(acao: () => Promise<{ ok: boolean; error?: string }>, sucesso: string) {
    executar(async () => {
      const resultado = await acao();
      if (!resultado.ok) {
        toast.error(resultado.error ?? "Não deu certo. Tente de novo.");
        return;
      }
      toast.success(sucesso);
      router.refresh();
    });
  }

  function girar() {
    const confirmado = confirm(
      `Gerar um token novo pro endereço “${webhook.label}”? O token atual para de funcionar na ` +
        "hora — se algum sistema estiver chamando esse endereço, você vai precisar atualizar o " +
        "token lá.",
    );
    if (!confirmado) return;

    executar(async () => {
      const resultado = await girarTokenDoWebhookAction({ orgSlug, endpointId: webhook.id });
      if (!resultado.ok) {
        toast.error(resultado.error);
        return;
      }
      if (resultado.data) onGirado(resultado.data);
      router.refresh();
    });
  }

  return (
    <div className="flex flex-wrap items-start justify-between gap-4 p-4">
      <div className="min-w-0 flex-1 space-y-1.5">
        <div className="flex flex-wrap items-center gap-2">
          <span className="font-medium text-sm">{webhook.label}</span>
          {webhook.isActive ? (
            <Badge variant="outline" className="border-primary/40 bg-primary/10 text-primary">
              Ativo
            </Badge>
          ) : (
            <Badge variant="outline" className="border-border/60 text-muted-foreground">
              Desligado
            </Badge>
          )}
        </div>

        <p className="text-muted-foreground text-sm">{webhook.agentName}</p>

        <div className="flex flex-wrap items-center gap-2">
          <code className="min-w-0 break-all rounded bg-muted/40 px-2 py-1 font-mono text-[11px]">
            {webhook.url}
          </code>
          <Button size="xs" variant="ghost" onClick={() => copiar(webhook.url, "Endereço")}>
            Copiar
          </Button>
        </div>

        <p className="font-mono text-[11px] text-muted-foreground">
          token {webhook.tokenPrefix}… · {webhook.callsCount} chamada
          {webhook.callsCount === 1 ? "" : "s"}
          {webhook.lastCalledAt && ` · última: ${formatDateTime(webhook.lastCalledAt)}`}
        </p>

        <p className="text-[11px] text-muted-foreground">
          roda no nome de: {webhook.runAsName ?? "ninguém"}
        </p>

        {/* Aparece na lista porque isto se escolhe SÓ no arquivo — sem mostrar
            aqui, ninguém teria como conferir o que foi declarado. */}
        <p className="text-[11px] text-muted-foreground">
          {webhook.esperarResposta
            ? "responde: a resposta do agente (quem chamou espera)"
            : "responde: um comprovante na hora"}
        </p>

        {!webhook.isActive && (
          <p className="flex items-start gap-1.5 rounded-lg border border-chart-3/40 bg-chart-3/10 p-2 text-[11px] text-chart-3">
            <AlertTriangleIcon className="mt-px h-3 w-3 shrink-0" />
            <span>
              Esse endereço foi desligado sozinho porque quem respondia por ele saiu do workspace.
              Esta tela ainda não tem um botão pra ligar ele de volta — fale com quem administra o
              projeto.
            </span>
          </p>
        )}

        <ChaveDeModo
          qual="webhook"
          modo={webhook.modo}
          podeLigar={meu}
          ligando={ocupado}
          onLigar={() =>
            chamar(
              () => alternarModoDoWebhookAction({ orgSlug, id: webhook.id, modo: "real" }),
              "Modo real ligado. A partir de agora esse endereço age de verdade.",
            )
          }
          onVoltarProEnsaio={() =>
            chamar(
              () => alternarModoDoWebhookAction({ orgSlug, id: webhook.id, modo: "ensaio" }),
              "Voltou pro ensaio. O endereço continua respondendo, mas nada sai mais pra fora.",
            )
          }
        />
      </div>

      <div className="flex flex-wrap items-center gap-1.5">
        {!meu && (
          <Button
            size="sm"
            variant="outline"
            disabled={ocupado}
            onClick={() =>
              chamar(
                () => assumirWebhookAction({ orgSlug, id: webhook.id }),
                "Agora esse endereço roda no seu nome. Ligue o modo real quando quiser.",
              )
            }
          >
            Assumir
          </Button>
        )}

        <Button
          size="sm"
          variant="outline"
          className="gap-1.5"
          aria-label={`Gerar um token novo pro endereço ${webhook.label}`}
          disabled={ocupado}
          onClick={girar}
        >
          <RefreshCwIcon className="h-3.5 w-3.5" />
          Gerar token
        </Button>
      </div>
    </div>
  );
}
