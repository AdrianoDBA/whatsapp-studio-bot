"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import type { ActionResult } from "@/lib/action-result";
import { requireOrgRole, requireUser } from "@/lib/auth/guards";
import { logError } from "@/lib/logger";
import { materializarWorkspace } from "@/lib/seed/materializar";
import { createClient } from "@/lib/supabase/server";
import { isValidSlug, slugify } from "./slug";

const createOrgSchema = z.object({
  name: z.string().min(2, "Nome muito curto").max(80, "Nome muito longo"),
  slug: z.string().refine(isValidSlug, "Slug inválido (3-40 letras minúsculas, números e hífens)"),
});

export type CreateOrgInput = z.infer<typeof createOrgSchema>;

/**
 * R3-SA-001: usa RPC atômica `create_organization_with_owner` que faz
 * INSERT org + INSERT membership numa transação. Postgres faz rollback
 * automático se membership falha — sem deixar org órfã.
 */
export async function createOrganizationAction(
  input: CreateOrgInput,
): Promise<ActionResult<{ slug: string }>> {
  const parsed = createOrgSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Dados inválidos" };
  }

  const user = await requireUser();
  const supabase = await createClient();

  const { data, error } = await supabase
    .rpc("create_organization_with_owner", {
      _name: parsed.data.name,
      _slug: parsed.data.slug,
    })
    .single();

  if (error) {
    // unique_violation (23505) vem como mensagem do Postgres
    if (error.message?.includes("23505") || error.message?.toLowerCase().includes("duplicate")) {
      return { ok: false, error: "Esse slug já está em uso. Escolha outro." };
    }
    logError("orgs.create", error);
    return { ok: false, error: "Erro ao criar workspace. Tente novamente." };
  }

  if (!data?.slug) {
    return { ok: false, error: "Erro ao criar workspace. Tente novamente." };
  }

  /* O workspace já existe neste ponto — a RPC comitou. Materializar é um passo
     SEPARADO porque as declarações moram em TypeScript e a RPC é SQL: não há
     transação comum possível.
     Por isso a falha aqui NÃO derruba a criação. O desfecho ruim é um workspace
     vazio, e `npm run semear` conserta (o materializador é idempotente). O
     desfecho ruim de abortar seria uma pessoa sem workspace nenhum por causa de
     um agente. */
  try {
    const resultado = await materializarWorkspace(supabase, data.id, user.id);
    // Agendamento pulado não é um erro de materialização (as linhas de
    // agente/base/webhook nasceram normalmente) — é uma automação que outra
    // pessoa já assumiu (`run_as` != dono). Não descarta o campo: registra
    // pra quem olhar o log conseguir explicar por que aquele agendamento não
    // está ligado no workspace novo.
    if (resultado.agendamentosPulados.length > 0) {
      logError("orgs.create.semear.pulados", new Error(resultado.agendamentosPulados.join(", ")));
    }
  } catch (err) {
    logError("orgs.create.semear", err);
  }

  return { ok: true, data: { slug: data.slug } };
}

/**
 * L-5: agora requer autenticação e limita tamanho do input
 * (evita CPU DoS via slugify em string gigante).
 */
const suggestSlugSchema = z.string().min(1).max(200);
export async function suggestSlugAction(name: string): Promise<{ slug: string }> {
  await requireUser();
  const parsed = suggestSlugSchema.safeParse(name);
  if (!parsed.success) return { slug: "" };
  return { slug: slugify(parsed.data) };
}

const updateOrgSchema = z.object({
  orgSlug: z.string(),
  name: z.string().min(2, "Nome muito curto").max(80, "Nome muito longo"),
  newSlug: z
    .string()
    .refine(isValidSlug, "Slug inválido (3-40 letras minúsculas, números e hífens)"),
});

export type UpdateOrgInput = z.infer<typeof updateOrgSchema>;

export async function updateOrganizationAction(
  input: UpdateOrgInput,
): Promise<ActionResult<{ slug: string }>> {
  const parsed = updateOrgSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Dados inválidos" };
  }

  const { org } = await requireOrgRole({
    orgSlug: parsed.data.orgSlug,
    roles: ["owner", "admin"],
  });

  const supabase = await createClient();
  const { error } = await supabase
    .from("organizations")
    .update({ name: parsed.data.name, slug: parsed.data.newSlug })
    .eq("id", org.id);

  if (error) {
    if (error.code === "23505") {
      return { ok: false, error: "Esse slug já está em uso. Escolha outro." };
    }
    logError("orgs.update", error);
    return { ok: false, error: "Erro ao atualizar workspace. Tente novamente." };
  }

  revalidatePath("/app", "layout");
  return { ok: true, data: { slug: parsed.data.newSlug } };
}

/**
 * M-12: whitelist MIME → magic bytes para validar conteúdo real
 * (não confiar no Content-Type do client que vem do multipart header).
 */
const MIME_EXT_WHITELIST: Record<string, string> = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/webp": "webp",
  "image/gif": "gif",
};

async function detectImageMime(file: File): Promise<string | null> {
  const buf = new Uint8Array(await file.slice(0, 12).arrayBuffer());
  // PNG: 89 50 4E 47 0D 0A 1A 0A
  if (buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47) return "image/png";
  // JPEG: FF D8 FF
  if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return "image/jpeg";
  // WebP: "RIFF" .... "WEBP"
  if (
    buf[0] === 0x52 &&
    buf[1] === 0x49 &&
    buf[2] === 0x46 &&
    buf[3] === 0x46 &&
    buf[8] === 0x57 &&
    buf[9] === 0x45 &&
    buf[10] === 0x42 &&
    buf[11] === 0x50
  )
    return "image/webp";
  // GIF: "GIF8"
  if (buf[0] === 0x47 && buf[1] === 0x49 && buf[2] === 0x46 && buf[3] === 0x38) return "image/gif";
  return null;
}

export async function uploadOrgLogoAction(
  orgSlug: string,
  formData: FormData,
): Promise<ActionResult<{ path: string }>> {
  // AUTORIZAÇÃO PRIMEIRO, sempre. Antes de olhar o arquivo, antes de qualquer
  // coisa. Este arquivo é o modelo que você vai copiar pras suas próprias
  // telas — se a checagem ficar no fim, um dia alguém copia só a primeira
  // metade.
  const { org } = await requireOrgRole({ orgSlug, roles: ["owner", "admin"] });

  const file = formData.get("logo");
  if (!(file instanceof File)) {
    return { ok: false, error: "Arquivo inválido" };
  }
  // Este limite anda junto com dois outros: `bodySizeLimit` em next.config.ts
  // e o `file_size_limit` do bucket no Supabase. Mudou um, mude os três.
  if (file.size > 2 * 1024 * 1024) {
    return { ok: false, error: "Imagem muito grande (máx 2MB)" };
  }

  // M-12: valida magic bytes
  const realMime = await detectImageMime(file);
  if (!realMime || !MIME_EXT_WHITELIST[realMime]) {
    return { ok: false, error: "Formato não permitido (use PNG, JPG, WebP ou GIF)" };
  }
  const ext = MIME_EXT_WHITELIST[realMime];

  const supabase = await createClient();

  // M-13: path com UUID em vez de timestamp (sem race/colisão).
  const path = `${org.id}/${crypto.randomUUID()}.${ext}`;

  const { error: uploadError } = await supabase.storage
    .from("org-logos")
    .upload(path, file, { contentType: realMime });

  if (uploadError) {
    logError("orgs.logo.upload", uploadError);
    return { ok: false, error: "Falha ao enviar imagem. Tente novamente." };
  }

  // NEW-HIGH-8: armazena PATH (não URL pública). Resolver via signed URL no read.
  // M-13: apaga logo antigo após sucesso (sem vazar storage).
  const { data: currentOrg } = await supabase
    .from("organizations")
    .select("logo_url")
    .eq("id", org.id)
    .maybeSingle();

  const { error: updateError } = await supabase
    .from("organizations")
    .update({ logo_url: path })
    .eq("id", org.id);

  if (updateError) {
    logError("orgs.logo.update", updateError);
    return { ok: false, error: "Falha ao salvar imagem. Tente novamente." };
  }

  // Best-effort cleanup do logo anterior (não bloqueia sucesso se falhar)
  const previous = currentOrg?.logo_url;
  if (previous && !previous.startsWith("http") && previous !== path) {
    await supabase.storage.from("org-logos").remove([previous]);
  }

  revalidatePath("/app", "layout");
  return { ok: true, data: { path } };
}

/**
 * M-10: delete da organização com confirmação por slug (defense-in-depth UI).
 * Owner-only. Trigger SQL `organizations_cleanup_logos` apaga objetos do bucket.
 */
const deleteOrgSchema = z.object({
  orgSlug: z.string(),
  confirmSlug: z.string(),
});
export type DeleteOrgInput = z.infer<typeof deleteOrgSchema>;

export async function deleteOrganizationAction(
  input: DeleteOrgInput,
): Promise<{ ok: false; error: string } | never> {
  const parsed = deleteOrgSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: "Dados inválidos" };
  }
  if (parsed.data.orgSlug !== parsed.data.confirmSlug) {
    return { ok: false, error: "A confirmação não bate com o slug" };
  }

  const { org } = await requireOrgRole({
    orgSlug: parsed.data.orgSlug,
    roles: ["owner"],
  });

  const supabase = await createClient();
  const { error } = await supabase.from("organizations").delete().eq("id", org.id);
  if (error) {
    logError("orgs.delete", error);
    return { ok: false, error: "Falha ao deletar workspace. Tente novamente." };
  }

  // Pode ter outras orgs; o cookie é só hint. Deixa middleware re-checar via query
  // se needed. Aqui não removemos pq user pode ainda ter outras orgs.
  revalidatePath("/app", "layout");
  redirect("/onboarding");
}
