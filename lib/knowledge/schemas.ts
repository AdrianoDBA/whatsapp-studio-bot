/**
 * Os formatos (Zod) da base de conhecimento.
 *
 * Toda função do servidor desta pasta valida a entrada aqui ANTES de tocar o
 * banco (regra 5 do CLAUDE.md raiz). As mensagens são em PT-BR coloquial
 * porque elas aparecem embaixo do campo, na tela.
 *
 * ⚠️ SEM `.default()` EM LUGAR NENHUM (regra 15 do CLAUDE.md raiz):
 * `.default()` quebra a tipagem do `useForm`, e esses formatos são usados pelos
 * formulários com React Hook Form. Valor padrão de formulário vai em
 * `defaultValues`.
 *
 * Arquivo PURO: pode ser importado por componente com "use client".
 */
import { z } from "zod";
import { MAX_CHARS_POR_DOCUMENTO } from "./chunk";

const orgSlug = z.string().trim().min(1, "Workspace não informado.");
const baseSlug = z
  .string()
  .trim()
  .min(2, "Base não informada.")
  .max(60, "Base não informada.")
  .regex(/^[a-z0-9]+(-[a-z0-9]+)*$/, "Base não informada.");
const uuid = z.string().uuid("Esse item não existe mais.");

// ---------------------------------------------------------------------------
// Base de conhecimento — não tem formato aqui. Base nasce de arquivo
// (`lib/knowledge/blueprint.ts`) e é gravada por `materializarWorkspace`;
// nenhuma função do servidor cria, edita ou apaga base.
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Documentos
// ---------------------------------------------------------------------------

export const criarDocumentoDeTextoSchema = z.object({
  orgSlug,
  baseSlug,
  title: z
    .string()
    .trim()
    .min(1, "Dê um título pra esse texto.")
    .max(200, "Esse título é longo demais (máximo 200 letras)."),
  content: z
    .string()
    .trim()
    .min(20, "Cole um texto com pelo menos 20 letras — abaixo disso não dá pra procurar nada.")
    .max(
      MAX_CHARS_POR_DOCUMENTO,
      `Esse texto é grande demais (o limite é ${MAX_CHARS_POR_DOCUMENTO / 1000} mil letras). ` +
        "Divida em partes e cole uma de cada vez.",
    ),
});
export type CriarDocumentoDeTextoInput = z.infer<typeof criarDocumentoDeTextoSchema>;

export const acaoEmDocumentoSchema = z.object({ orgSlug, documentId: uuid });
export type AcaoEmDocumentoInput = z.infer<typeof acaoEmDocumentoSchema>;

// ---------------------------------------------------------------------------
// Busca
// ---------------------------------------------------------------------------

export const buscarNaBaseSchema = z.object({
  orgSlug,
  baseSlug,
  pergunta: z
    .string()
    .trim()
    .min(2, "Escreva a pergunta com pelo menos duas letras.")
    .max(2000, "Essa pergunta é longa demais."),
});
export type BuscarNaBaseInput = z.infer<typeof buscarNaBaseSchema>;
