/**
 * "ESTE PEDIDO VEIO DE DENTRO DO CONTAINER OU DE FORA?"
 *
 * Arquivo PURO (só lê cabeçalho). Ele existe separado porque a resposta é
 * usada em DOIS lugares — no porteiro (`proxy.ts`) e na própria rota
 * (`/api/internal/run-job`) — e uma checagem de segurança escrita duas vezes é
 * uma checagem que um dia vai divergir.
 *
 * ⚠️ A PEGADINHA QUE CUSTOU UM DEPURAÇÃO INTEIRA
 * O jeito ingênuo de fazer isso é "tem cabeçalho `x-forwarded-*`? então veio
 * de fora". NÃO FUNCIONA: o próprio Next carimba `x-forwarded-for`,
 * `x-forwarded-host`, `x-forwarded-proto` e `x-forwarded-port` em TODO pedido
 * que ele recebe, inclusive num pedido feito de dentro do container pra
 * 127.0.0.1. Com essa regra, a rota interna respondia 404 pro trabalhador e
 * NENHUMA automação rodava.
 *
 * O que funciona é olhar o VALOR: quem chamou de dentro tem endereço de
 * loopback (127.x.x.x / ::1). Quem veio de fora passou pelo proxy do
 * EasyPanel, e o endereço de quem chamou está lá, no meio da lista.
 *
 * E se alguém de fora FORJAR `x-forwarded-for: 127.0.0.1`? O proxy do
 * EasyPanel ACRESCENTA o endereço real no fim da lista em vez de trocar — e
 * basta UM endereço de fora na lista pra este arquivo responder "veio de
 * fora". Por isso a conferência é "algum não é loopback", e não "o primeiro
 * é loopback".
 *
 * ⚠️ RESÍDUO: com o container exposto direto na internet (`TRUST_PROXY=0`),
 * não existe proxy pra carimbar nada e esta camada perde o valor. O que segura
 * o caso, aí, é a assinatura da chamada interna — que deriva da ENCRYPTION_KEY
 * e nunca sai do container.
 */

/** 127.x.x.x, ::1 e as formas que o Node escreve isso. */
const LOOPBACK_RE =
  /^(::1|::ffff:127\.\d{1,3}\.\d{1,3}\.\d{1,3}|127\.\d{1,3}\.\d{1,3}\.\d{1,3}|localhost)$/i;

/** Tira colchetes de IPv6 e a porta de um `1.2.3.4:5678`. */
function soOEndereco(bruto: string): string {
  let valor = bruto.trim();
  if (valor.startsWith("[")) {
    const fim = valor.indexOf("]");
    if (fim > 0) valor = valor.slice(1, fim);
  } else if ((valor.match(/:/g)?.length ?? 0) === 1) {
    valor = valor.slice(0, valor.indexOf(":"));
  }
  return valor.toLowerCase();
}

/**
 * `true` quando algum endereço na cadeia de proxy NÃO é loopback — ou seja,
 * quando o pedido atravessou a internet pra chegar aqui.
 */
export function chamadaVeioDeFora(headers: Headers): boolean {
  const candidatos: string[] = [];

  const cadeia = headers.get("x-forwarded-for");
  if (cadeia) candidatos.push(...cadeia.split(","));

  const real = headers.get("x-real-ip");
  if (real) candidatos.push(real);

  return candidatos.some((bruto) => {
    const endereco = soOEndereco(bruto);
    return endereco !== "" && !LOOPBACK_RE.test(endereco);
  });
}
