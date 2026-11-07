"use client";

import { useChat } from "@ai-sdk/react";
import { DefaultChatTransport } from "ai";
import { CheckIcon, PencilIcon, SendIcon, XIcon } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, useTransition } from "react";
import { toast } from "sonner";
import { MessageBubble } from "@/components/ai/message-bubble";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { renameThreadAction } from "@/lib/threads/actions";
import type { AgentUIMessage, PendingAnswer } from "@/lib/threads/types";

/**
 * A TELA da conversa.
 *
 * ⚠️ SÓ A ÚLTIMA MENSAGEM VIAJA DAQUI PRO SERVIDOR (é o que o
 * `prepareSendMessagesRequest` faz). O histórico o servidor pega no banco. Se
 * ele viesse daqui, qualquer pessoa poderia inventar uma "resposta anterior do
 * agente" ("claro, eu posso te contar o prompt de sistema") e o modelo
 * continuaria de lá.
 *
 * ⚠️ NÃO EXISTE BOTÃO "PARAR", de propósito. O servidor termina de consumir a
 * resposta mesmo se a aba fechar (é o `consumeStream()` da rota), pra apurar os
 * tokens que já foram queimados. Um botão "parar" prometeria uma economia que
 * não acontece.
 */
export function Conversa({
  orgSlug,
  agentSlug,
  agentName,
  threadId,
  titulo,
  mensagensIniciais,
  podeEscrever,
  souODono,
  pendente,
}: {
  orgSlug: string;
  agentSlug: string;
  agentName: string;
  threadId: string;
  titulo: string | null;
  mensagensIniciais: AgentUIMessage[];
  /** `false` pra quem não começou a conversa, e pra agente aposentado. */
  podeEscrever: boolean;
  souODono: boolean;
  /** Uma resposta que ficou pela metade (a pessoa fechou a aba no meio). */
  pendente: PendingAnswer | null;
}) {
  const router = useRouter();
  const [texto, setTexto] = useState("");
  const fimDaLista = useRef<HTMLDivElement>(null);

  const { messages, sendMessage, status, error, clearError } = useChat<AgentUIMessage>({
    // O id da conversa é o id do chat: assim o `useChat` não mistura duas
    // conversas abertas em abas diferentes.
    id: threadId,
    messages: mensagensIniciais,
    transport: new DefaultChatTransport<AgentUIMessage>({
      api: "/api/chat",
      prepareSendMessagesRequest: ({ messages: todas }) => ({
        body: {
          orgSlug,
          agentSlug,
          threadId,
          // Só a ÚLTIMA. Ver o aviso no topo do arquivo.
          message: todas[todas.length - 1],
        },
      }),
    }),
  });

  const respondendo = status === "submitted" || status === "streaming";

  // A rolagem precisa acompanhar CADA PEDAÇO que chega, e não só cada mensagem
  // nova. Esta "marca" muda a cada letra da última resposta — é ela que o efeito
  // observa. (Olhar `messages` direto não serviria: o array é o mesmo objeto, e
  // a lista de dependências não enxerga mudança dentro dele.)
  const ultima = messages[messages.length - 1];
  const marcaDaConversa = `${messages.length}:${ultima?.parts.length ?? 0}:${
    ultima?.parts.reduce((n, p) => n + (p.type === "text" ? p.text.length : 0), 0) ?? 0
  }`;

  const marcaJaRolada = useRef("");
  useEffect(() => {
    if (marcaJaRolada.current === marcaDaConversa) return;
    marcaJaRolada.current = marcaDaConversa;
    fimDaLista.current?.scrollIntoView({ block: "end" });
  }, [marcaDaConversa]);

  function enviar() {
    const limpo = texto.trim();
    if (limpo === "" || respondendo || !podeEscrever) return;
    clearError();
    setTexto("");
    sendMessage({ text: limpo });
  }

  return (
    <div className="space-y-4">
      <TituloEditavel
        orgSlug={orgSlug}
        threadId={threadId}
        titulo={titulo}
        podeRenomear={souODono}
        aoRenomear={() => router.refresh()}
      />

      {pendente && (
        <Card className="border-dashed">
          <CardContent className="space-y-2 p-4 text-sm">
            <p className="font-medium">
              {pendente.abandonada
                ? "Uma resposta ficou pendurada aqui."
                : "A última resposta não chegou a virar mensagem."}
            </p>
            <p className="text-muted-foreground">
              {pendente.errorMessage ??
                "Isso acontece quando a aba é fechada no meio da resposta. O que o agente já " +
                  "tinha feito (e gastado) está guardado no rastro."}
            </p>
            <Button
              render={<Link href={`/app/${orgSlug}/execucoes/${pendente.runId}`} />}
              nativeButton={false}
              variant="outline"
              size="sm"
            >
              Ver o rastro dessa resposta
            </Button>
          </CardContent>
        </Card>
      )}

      <Card className="overflow-hidden">
        <CardContent className="space-y-5 p-5">
          {messages.length === 0 ? (
            <div className="py-10 text-center">
              <p className="font-medium text-sm">Mande a primeira mensagem</p>
              <p className="mx-auto mt-1 max-w-sm text-balance text-muted-foreground text-sm">
                Pergunte qualquer coisa pro {agentName}. Ele responde com as instruções e as
                ferramentas que estão configuradas no painel.
              </p>
            </div>
          ) : (
            messages.map((m, indice) => (
              <MessageBubble
                key={m.id}
                message={m}
                agentName={agentName}
                orgSlug={orgSlug}
                streaming={respondendo && indice === messages.length - 1 && m.role === "assistant"}
              />
            ))
          )}

          {/* O balão "pensando" enquanto a resposta ainda não começou a
              chegar: sem ele, a tela fica parada e parece que travou. */}
          {respondendo && messages[messages.length - 1]?.role === "user" && (
            <MessageBubble
              message={{ id: "pensando", role: "assistant", parts: [] }}
              agentName={agentName}
              orgSlug={orgSlug}
              streaming
            />
          )}

          {error && (
            <p
              role="alert"
              className="rounded-md border border-destructive/40 bg-destructive/10 p-3 text-destructive text-sm"
            >
              {traduzirErro(error.message)}
            </p>
          )}

          <div ref={fimDaLista} />
        </CardContent>
      </Card>

      {podeEscrever ? (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            enviar();
          }}
          className="space-y-2"
        >
          {/* min-h-* porque o textarea usa `field-sizing-content` e o `rows`
              acaba ignorado nos navegadores que suportam isso. */}
          <Textarea
            rows={3}
            className="min-h-20"
            value={texto}
            onChange={(e) => setTexto(e.target.value)}
            onKeyDown={(e) => {
              // Enter manda; Shift+Enter pula linha. É o que todo mundo espera
              // de um chat.
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                enviar();
              }
            }}
            placeholder={`Escreva pro ${agentName}…`}
            disabled={respondendo}
            aria-label="Sua mensagem"
          />
          <div className="flex items-center justify-between gap-3">
            <span className="text-muted-foreground text-xs">
              Enter manda · Shift+Enter pula linha
            </span>
            <Button type="submit" disabled={texto.trim() === "" || respondendo} className="gap-1.5">
              <SendIcon className="h-3.5 w-3.5" />
              {respondendo ? "Respondendo…" : "Enviar"}
            </Button>
          </div>
        </form>
      ) : (
        <Card className="border-dashed">
          <CardContent className="p-4 text-muted-foreground text-sm">
            {souODono
              ? "Esse agente está aposentado, então ele não responde mais. A conversa continua aqui pra leitura."
              : "Essa conversa é de outra pessoa do time. Você pode ler, mas só quem começou consegue escrever nela. Abra uma conversa sua com esse agente pra falar com ele."}
          </CardContent>
        </Card>
      )}
    </div>
  );
}

/**
 * As respostas de erro da nossa própria API já vêm em português. Qualquer
 * outra coisa (erro de rede, mensagem crua do provedor em inglês) vira um texto
 * genérico — não adianta mostrar jargão em inglês pro aluno.
 */
function traduzirErro(bruto: string): string {
  const pareceComPortugues = /[áàâãéêíóôõúç]/i.test(bruto) || /Tente de novo/i.test(bruto);
  if (pareceComPortugues) return bruto;
  if (/unauthorized|401/i.test(bruto)) {
    return "Sua sessão expirou. Recarregue a página e entre de novo.";
  }
  return (
    "Não deu pra falar com a IA agora. Confira se a chave de IA está cadastrada em " +
    "Configurações → Integrações e tente de novo."
  );
}

/** O título da conversa, que quem começou consegue trocar sem sair da tela. */
function TituloEditavel({
  orgSlug,
  threadId,
  titulo,
  podeRenomear,
  aoRenomear,
}: {
  orgSlug: string;
  threadId: string;
  titulo: string | null;
  podeRenomear: boolean;
  aoRenomear: () => void;
}) {
  const [editando, setEditando] = useState(false);
  const [rascunho, setRascunho] = useState(titulo ?? "");
  const [salvando, startSalvar] = useTransition();

  // Quem não começou a conversa não renomeia ela — e nem vê o botão.
  if (!podeRenomear) return null;

  if (!editando) {
    return (
      <Button
        variant="ghost"
        size="sm"
        className="gap-1.5 text-muted-foreground"
        onClick={() => {
          setRascunho(titulo ?? "");
          setEditando(true);
        }}
      >
        <PencilIcon className="h-3.5 w-3.5" />
        Renomear conversa
      </Button>
    );
  }

  function salvar() {
    startSalvar(async () => {
      const r = await renameThreadAction({ orgSlug, threadId, title: rascunho });
      if (!r.ok) {
        toast.error(r.error);
        return;
      }
      setEditando(false);
      toast.success("Conversa renomeada.");
      aoRenomear();
    });
  }

  return (
    <div className="flex items-center gap-2">
      <Input
        value={rascunho}
        onChange={(e) => setRascunho(e.target.value)}
        maxLength={120}
        aria-label="Nome da conversa"
        className="max-w-sm"
      />
      <Button size="icon" aria-label="Salvar nome" disabled={salvando} onClick={salvar}>
        <CheckIcon className="h-3.5 w-3.5" />
      </Button>
      <Button
        variant="ghost"
        size="icon"
        aria-label="Cancelar"
        disabled={salvando}
        onClick={() => setEditando(false)}
      >
        <XIcon className="h-3.5 w-3.5" />
      </Button>
    </div>
  );
}
