"use client";

/**
 * COMO UM DOCUMENTO ENTRA NA BASE — as duas portas.
 *
 * ┌──────────────────────────────────────────────────────────────────────────┐
 * │ A ABA "COLAR TEXTO" NÃO É ENFEITE.                                       │
 * │ Ela é o plano B de tudo: PDF escaneado (que é foto de página e não tem   │
 * │ texto), PDF com senha, Word, planilha, página da internet. Em todos      │
 * │ esses casos a saída é abrir, copiar e colar aqui — e é por isso que o    │
 * │ PDF nunca vira um bloqueio duro pro aluno.                               │
 * └──────────────────────────────────────────────────────────────────────────┘
 *
 * ⚠️ A LEITURA ACONTECE NA HORA, DENTRO DO ENVIO. Não existe fila pra isso
 * (a ponte da automação não serve arquivo). Por isso a tela avisa que pode
 * demorar alguns segundos e por isso o botão vira "Lendo o arquivo...".
 */

import { zodResolver } from "@hookform/resolvers/zod";
import { FileUpIcon, TypeIcon } from "lucide-react";
import { useRouter } from "next/navigation";
import { useId, useRef, useState, useTransition } from "react";
import { FormProvider, useForm } from "react-hook-form";
import { toast } from "sonner";
import { TextField } from "@/components/forms/form-field";
import { TextareaField } from "@/components/forms/textarea-field";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { createTextDocumentAction, uploadDocumentAction } from "@/lib/knowledge/actions";
import { MAX_CHARS_POR_DOCUMENTO } from "@/lib/knowledge/chunk";
import { KNOWLEDGE_ACCEPT_ATTR, tamanhoMaximoLegivel } from "@/lib/knowledge/mime";
import {
  type CriarDocumentoDeTextoInput,
  criarDocumentoDeTextoSchema,
} from "@/lib/knowledge/schemas";

export function UploadForm({ orgSlug, baseSlug }: { orgSlug: string; baseSlug: string }) {
  return (
    <Card>
      <CardHeader className="border-border/60 border-b bg-card/40 py-3">
        <CardTitle className="label-mono text-[10px]">/ adicionar documento</CardTitle>
      </CardHeader>
      <CardContent className="p-5">
        <Tabs defaultValue="arquivo">
          <TabsList>
            <TabsTrigger value="arquivo" className="gap-1.5">
              <FileUpIcon className="h-3.5 w-3.5" />
              Enviar arquivo
            </TabsTrigger>
            <TabsTrigger value="texto" className="gap-1.5">
              <TypeIcon className="h-3.5 w-3.5" />
              Colar texto
            </TabsTrigger>
          </TabsList>

          <TabsContent value="arquivo" className="pt-4">
            <FormularioDeArquivo orgSlug={orgSlug} baseSlug={baseSlug} />
          </TabsContent>
          <TabsContent value="texto" className="pt-4">
            <FormularioDeTexto orgSlug={orgSlug} baseSlug={baseSlug} />
          </TabsContent>
        </Tabs>
      </CardContent>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Enviar arquivo
// ---------------------------------------------------------------------------

function FormularioDeArquivo({ orgSlug, baseSlug }: { orgSlug: string; baseSlug: string }) {
  const router = useRouter();
  const idDoCampo = useId();
  const formRef = useRef<HTMLFormElement>(null);
  const [enviando, startEnvio] = useTransition();
  const [nomeEscolhido, setNomeEscolhido] = useState<string | null>(null);

  function onSubmit(evento: React.FormEvent<HTMLFormElement>) {
    evento.preventDefault();
    const formulario = evento.currentTarget;
    const dados = new FormData(formulario);
    dados.set("baseSlug", baseSlug);

    startEnvio(async () => {
      const resultado = await uploadDocumentAction(orgSlug, dados);
      if (!resultado.ok) {
        toast.error(resultado.error);
        return;
      }
      // ⚠️ `status: "failed"` NÃO é `{ ok: false }`: o documento entrou na
      // lista e o motivo está gravado na linha dele. Mandar um toast de erro
      // aqui repetiria a mesma frase que a tabela já mostra.
      if (resultado.data?.status === "failed") {
        toast.warning("O documento entrou, mas a leitura falhou. Veja o motivo na lista abaixo.");
      } else {
        toast.success("Documento lido e indexado.");
      }
      formRef.current?.reset();
      setNomeEscolhido(null);
      router.refresh();
    });
  }

  return (
    <form ref={formRef} onSubmit={onSubmit} className="space-y-4">
      <div className="space-y-1.5">
        <label className="font-medium text-sm" htmlFor={idDoCampo}>
          Arquivo
        </label>
        <input
          id={idDoCampo}
          type="file"
          name="arquivo"
          required
          accept={KNOWLEDGE_ACCEPT_ATTR}
          onChange={(e) => setNomeEscolhido(e.target.files?.[0]?.name ?? null)}
          className="block w-full rounded-lg border border-input bg-transparent p-2 text-sm file:mr-3 file:rounded-md file:border-0 file:bg-secondary file:px-3 file:py-1.5 file:font-medium file:text-secondary-foreground file:text-xs dark:bg-input/30"
        />
        <p className="text-muted-foreground text-xs">
          PDF, .txt, .md ou .csv, até {tamanhoMaximoLegivel()}. O nome do arquivo vira o título do
          documento.
        </p>
      </div>

      {nomeEscolhido && (
        <p className="text-muted-foreground text-xs">
          Escolhido: <span className="font-medium">{nomeEscolhido}</span>
        </p>
      )}

      <Button type="submit" disabled={enviando}>
        {enviando ? "Enviando o arquivo..." : "Enviar e indexar"}
      </Button>

      <p className="text-muted-foreground text-xs">
        Depois de enviar, a leitura acontece em segundo plano — a linha do documento aparece como
        "Na fila" e vira "Pronto" sozinha. Pode fechar a página.
      </p>
    </form>
  );
}

// ---------------------------------------------------------------------------
// Colar texto
// ---------------------------------------------------------------------------

function FormularioDeTexto({ orgSlug, baseSlug }: { orgSlug: string; baseSlug: string }) {
  const router = useRouter();
  const [salvando, startSalvar] = useTransition();

  const form = useForm<CriarDocumentoDeTextoInput>({
    resolver: zodResolver(criarDocumentoDeTextoSchema),
    defaultValues: { orgSlug, baseSlug, title: "", content: "" },
  });

  function onSubmit(values: CriarDocumentoDeTextoInput) {
    startSalvar(async () => {
      const resultado = await createTextDocumentAction(values);
      if (!resultado.ok) {
        toast.error(resultado.error);
        return;
      }
      if (resultado.data?.status === "failed") {
        toast.warning("O texto entrou, mas a leitura falhou. Veja o motivo na lista abaixo.");
      } else {
        toast.success("Texto lido e indexado.");
      }
      form.reset({ orgSlug, baseSlug, title: "", content: "" });
      router.refresh();
    });
  }

  return (
    <FormProvider {...form}>
      <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
        <TextField
          name="title"
          control={form.control}
          label="Título"
          description="Como esse texto vai aparecer na lista — e é ele que o agente cita como origem."
          inputProps={{ placeholder: "Ex: Política de férias" }}
        />
        <TextareaField
          name="content"
          control={form.control}
          label="Texto"
          description={`Cole aqui o conteúdo. Até ${MAX_CHARS_POR_DOCUMENTO / 1000} mil letras.`}
          textareaProps={{ rows: 10, placeholder: "Cole o texto do documento aqui..." }}
        />
        <Button type="submit" disabled={salvando}>
          {salvando ? "Lendo o texto..." : "Guardar e indexar"}
        </Button>
      </form>
    </FormProvider>
  );
}
