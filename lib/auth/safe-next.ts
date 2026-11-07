/**
 * Valida pra onde mandar a pessoa depois do login/cadastro.
 *
 * POR QUE ISSO EXISTE
 * -------------------
 * O endereço de destino vem da URL (`?next=/algum/lugar`), e URL qualquer um
 * escreve. Sem validar, alguém manda um link tipo
 * `seusite.com/login?next=//site-falso.com` — a pessoa entra achando que está
 * no seu site e é jogada num site clonado que rouba a senha dela.
 *
 * Aqui só passa endereço interno do próprio site.
 */

export const DESTINO_PADRAO = "/onboarding";

export function safeNext(raw: string | null | undefined, origin: string): string {
  if (!raw) return DESTINO_PADRAO;
  // Tem que ser caminho interno...
  if (!raw.startsWith("/")) return DESTINO_PADRAO;
  // ...e não pode ser "//outro-site.com" nem "/\outro-site.com", que o
  // navegador entende como endereço externo.
  if (raw.startsWith("//") || raw.startsWith("/\\")) return DESTINO_PADRAO;

  try {
    const parsed = new URL(raw, origin);
    if (parsed.origin !== origin) return DESTINO_PADRAO;
    return parsed.pathname + parsed.search + parsed.hash;
  } catch {
    return DESTINO_PADRAO;
  }
}

/**
 * Versão pro navegador, onde a origem é sempre a da própria janela.
 * Usada nos formulários de login e cadastro.
 */
export function safeNextNoNavegador(raw: string | null | undefined): string {
  if (typeof window === "undefined") return safeNext(raw, "http://localhost");
  return safeNext(raw, window.location.origin);
}
