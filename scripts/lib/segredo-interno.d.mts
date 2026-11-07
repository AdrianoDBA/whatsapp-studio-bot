/**
 * Os tipos do `segredo-interno.mjs`.
 *
 * POR QUE ESTE ARQUIVO EXISTE: o `tsconfig.json` deste projeto tem
 * `allowJs: false`, então o TypeScript não olha dentro de um `.mjs`. Sem esta
 * declaração, o `import ... from "@/scripts/lib/segredo-interno.mjs"` feito
 * pela rota interna não compilaria. O `include` do tsconfig já cobre
 * `**\/*.mts`.
 */

/** Deriva o segredo da chamada interna a partir da ENCRYPTION_KEY. Hex de 64. */
export function derivarSegredoInterno(encryptionKey: string | undefined | null): string;

/** A assinatura HMAC-SHA256 de uma chamada. Hex de 64. */
export function assinarChamada(
  segredo: string,
  jobId: string,
  workerId: string,
  momentoMs: number,
): string;

/** Confere a assinatura em tempo constante. Nunca lança. */
export function conferirAssinatura(
  segredo: string,
  jobId: string,
  workerId: string,
  momentoMs: number,
  assinatura: string,
): boolean;

/** A assinatura HMAC-SHA256 de uma chamada de `npm run semear`. Hex de 64. */
export function assinarChamadaSemear(
  segredo: string,
  organizationId: string,
  momentoMs: number,
): string;

/** Confere a assinatura de uma chamada de `npm run semear`, em tempo constante. Nunca lança. */
export function conferirAssinaturaSemear(
  segredo: string,
  organizationId: string,
  momentoMs: number,
  assinatura: string,
): boolean;
