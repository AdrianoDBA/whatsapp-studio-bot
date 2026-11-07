/**
 * O QUE FAZER COM O RESULTADO — o passo que faltava pra "automação" ser
 * automação.
 *
 * ⚠️ ENTREGA NÃO É FERRAMENTA, é passo do trabalho. O modelo não decide se
 * entrega e **não pode esquecer**. Isso também elimina o risco de injeção: o
 * destino é fixo, escrito por quem criou o agendamento — um documento
 * envenenado não muda pra onde o resultado vai.
 *
 * ⚠️ FALHA DE ENTREGA NÃO TRANSFORMA A EXECUÇÃO EM `failed`. O agente fez o
 * trabalho dele; quem falhou foi o email. Quem chama grava o erro em
 * `jobs.last_error`, e a execução (`agent_runs`) continua `succeeded`.
 *
 * ⚠️ ESTA FUNÇÃO NÃO GRAVA PASSO NO RASTRO DO AGENTE (correção desta tarefa —
 * substitui o que um rascunho anterior do contrato previa). Quem chama
 * (`lib/automation/run-job.ts`) roda a entrega DEPOIS que `runAgent` já
 * fechou a execução (`finishRun`), e `record_agent_run_step` recusa gravar
 * quando `agent_runs.status <> 'running'`. Tentar gravar ali ou estoura
 * exceção ou é engolido em silêncio. Por isso: `agent_runs` /
 * `agent_run_steps` guardam o que o AGENTE fez; `jobs.last_error` guarda o
 * que a AUTOMAÇÃO fez com o resultado.
 *
 * Arquivo quase puro: recebe as ações prontas, não monta nada.
 */
import { z } from "zod";
import type { Acoes } from "@/lib/agents/acoes";

/**
 * QUANTOS ENDEREÇOS UMA ENTREGA POR EMAIL ALCANÇA.
 *
 * ⚠️ ESTE NÚMERO É O MESMO DA FERRAMENTA `mandar-email`
 * (`lib/agents/tools/mandar-email.ts`, `.max(5)`), E TEM QUE CONTINUAR SENDO.
 * Os dois caminhos terminam na MESMA porta (`ctx.acao.email`), que dispara um
 * `fetch` por destinatário em `Promise.all` (`lib/agents/acoes.ts`) com o
 * remetente que `resolveEmailSender` achar — e esse remetente cai workspace →
 * PLATAFORMA. Ou seja: um workspace sem chave própria dispara com a chave do
 * dono do sistema, e quem queima a reputação do domínio é ele.
 *
 * Teto num lado só não protege nada: os dois caminhos têm que continuar com
 * o MESMO número. Hoje quem grava `entrega` é `agendamentoParaInsert`
 * (`lib/automation/blueprint.ts`), chamado só por `materializarWorkspace` —
 * mas ele valida com este MESMO `entregaDeEntradaSchema`, então um teto solto
 * aqui deixaria um agendamento de 5 em 5 minutos com cem destinatários fazer
 * o que a ferramenta recusaria.
 *
 * A guarda contra os dois números se separarem é
 * `tests/entrega-do-resultado.test.ts` — ela cobra o mesmo teto nos dois.
 */
export const MAX_DESTINATARIOS_DA_ENTREGA = 5;

/**
 * O ramo de email, escrito UMA vez e usado nos dois schemas abaixo.
 *
 * Fica capado também na LEITURA de propósito: uma linha do banco com mais
 * destinatários que o teto vira `{ tipo: "nenhuma" }` e a entrega não
 * acontece. Errar pro lado de "não mandei" é o único erro seguro aqui —
 * o contrário seria o disparo em massa que este teto existe pra impedir.
 */
const entregaPorEmail = z.object({
  tipo: z.literal("email"),
  para: z
    .array(z.string().email("Isso não parece um email."))
    .min(1, "Diga pra quem mandar.")
    .max(
      MAX_DESTINATARIOS_DA_ENTREGA,
      `Escolha no máximo ${MAX_DESTINATARIOS_DA_ENTREGA} endereços de email.`,
    ),
});

/**
 * O QUE O BANCO PODE DEVOLVER. É o schema de LEITURA — e só ele conhece
 * `conexao`.
 *
 * ⚠️ NÃO USE ESTE SCHEMA PRA VALIDAR O QUE O ALUNO MANDA. Pra isso existe
 * `entregaDeEntradaSchema`, logo abaixo. Ver o porquê lá.
 */
export const entregaSchema = z.discriminatedUnion("tipo", [
  z.object({ tipo: z.literal("nenhuma") }),
  entregaPorEmail,
  // Aceito no banco desde já; a tela só passa a oferecer na onda das conexões.
  z.object({ tipo: z.literal("conexao"), slug: z.string().min(1), caminho: z.string().min(1) }),
]);

/**
 * O QUE UMA FUNÇÃO DO SERVIDOR ACEITA GRAVAR. Sem `conexao`.
 *
 * ⚠️ O RAMO `conexao` NÃO PODE ENTRAR PELA PORTA DA FRENTE — E JÁ ENTROU UMA
 * VEZ. Até a Task 9, a porta era `criarAgendamentoAction`: `criarAgendamentoSchema`
 * embutia o schema de LEITURA inteiro, então quem administrava qualquer
 * workspace chamava a action com
 * `{"tipo":"conexao","slug":"https://onde.eu.quiser","caminho":"/x"}` e ganhava
 * um canal de saída permanente: `entregarResultado` concatena os dois campos e
 * faz POST com o resultado do agente lá dentro, de novo a cada rodada. E os
 * outros administradores do workspace liam só "uma entrega que esta tela ainda
 * não sabe mostrar" — um canal que nenhuma tela consegue auditar. A Task 9
 * removeu `criarAgendamentoAction` inteira. HOJE a única porta de escrita é
 * `agendamentoParaInsert` (`lib/automation/blueprint.ts`, chamado só por
 * `materializarWorkspace`), e ela usa ESTE MESMO schema — é por isso que ele
 * precisa continuar existindo e continuar sendo o único usado pra gravar.
 *
 * Fechar a ENTRADA e deixar a LEITURA aberta é de propósito: o formato fica
 * guardado pra onda das conexões (o banco continua sabendo ler), mas ninguém
 * consegue criar um. No dia em que a tela de conexões nascer, o que muda aqui
 * é este schema — e aí `slug` passa a ser o nome de uma conexão cadastrada,
 * conferida contra o banco, nunca um endereço solto escrito por quem chamou.
 */
export const entregaDeEntradaSchema = z.discriminatedUnion("tipo", [
  z.object({ tipo: z.literal("nenhuma") }),
  entregaPorEmail,
]);

export type Entrega = z.infer<typeof entregaSchema>;
export type EntregaDeEntrada = z.infer<typeof entregaDeEntradaSchema>;

/** Linha do banco → `Entrega`. Lixo vira "nenhuma", nunca exceção. */
export function lerEntrega(bruto: unknown): Entrega {
  const r = entregaSchema.safeParse(bruto);
  return r.success ? r.data : { tipo: "nenhuma" };
}

export async function entregarResultado(p: {
  entrega: Entrega;
  acoes: Acoes;
  output: string;
  nomeDaAutomacao: string;
  linkDaExecucao: string;
}): Promise<{ ok: true; simulado: boolean } | { ok: false; erro: string }> {
  if (p.entrega.tipo === "nenhuma") return { ok: true, simulado: false };

  if (p.entrega.tipo === "email") {
    const r = await p.acoes.email({
      para: p.entrega.para,
      assunto: `${p.nomeDaAutomacao} — resultado`,
      corpo: `${p.output}\n\n---\n${p.linkDaExecucao}`,
    });
    if (!r.ok) return { ok: false, erro: r.erro };
    return { ok: true, simulado: r.simulado };
  }

  const r = await p.acoes.http({
    metodo: "POST",
    url: `${p.entrega.slug}${p.entrega.caminho}`,
    corpo: { automacao: p.nomeDaAutomacao, resultado: p.output, execucao: p.linkDaExecucao },
  });
  if (!r.ok) return { ok: false, erro: r.erro };
  return { ok: true, simulado: r.simulado };
}
