/**
 * Formato de resposta de TODA função do servidor deste projeto.
 *
 * A tela sempre checa `if (!result.ok)` e mostra `result.error`. Quando a
 * função precisa devolver alguma informação (o endereço da organização criada,
 * o id da tarefa nova), ela vem dentro de `data`.
 *
 * POR QUE TER UM SÓ FORMATO
 * -------------------------
 * Antes cada pasta inventava o seu: uma devolvia `{ ok, slug }`, outra
 * `{ ok, emailSent }`, outra `{ ok, path }`. Quem copiava uma tela pra fazer
 * outra herdava o formato errado e a tela quebrava em silêncio. Com um formato
 * só, copiar sempre funciona.
 *
 * COMO USAR NUMA FUNÇÃO NOVA
 *   export async function minhaAction(...): Promise<ActionResult> {
 *     if (deuRuim) return { ok: false, error: "Mensagem em português pro usuário" };
 *     return { ok: true };
 *   }
 *
 * E quando precisar devolver algo:
 *   Promise<ActionResult<{ id: string }>>  →  return { ok: true, data: { id } };
 */
export type ActionResult<T = void> = { ok: true; data?: T } | { ok: false; error: string };
