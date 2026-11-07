import { Badge } from "@/components/ui/badge";

/**
 * O SELO DE ENSAIO: as duas peças que avisam "isto foi um ensaio, nada saiu
 * pra fora".
 *
 * POR QUE ISTO EXISTE (o defeito mais grave da onda 7, medido no navegador)
 * ---------------------------------------------------------------------------
 * Com o ensaio LIGADO — que é o padrão do playground —, o aluno pedia "manda o
 * email de aviso agora" e o card de resposta escrevia, com todas as letras:
 * "Enviei o email com o relatório do dia para chefe@empresa.com". Nada tinha
 * saído. A ferramenta devolveu certinho `{"aviso":"Isto foi um ENSAIO…"}` e o
 * modelo ignorou — e ignorou de forma INTERMITENTE (numa outra rodada ele
 * disse "em modo de ensaio"), que é o pior dos mundos: o aluno não tem como
 * saber quando pode acreditar no que está lendo.
 *
 * A instrução no prompt (`lib/agents/prompt.ts`) reduz a frequência disso, mas
 * NÃO garante nada — foi medido justamente ignorando a instrução equivalente
 * que a ferramenta já mandava. **Quem garante é este selo**, porque ele não
 * passa pelo modelo: vem de `agent_runs.modo`, gravado pelo motor na abertura
 * da execução.
 *
 * REGRA DE OURO DAS DUAS PEÇAS: elas só aparecem quando o BANCO diz "ensaio".
 * A ausência delas não afirma nada; a presença afirma que nada saiu. É por
 * isso que `lerModo` (em `lib/agents/runs-queries.ts`) fecha qualquer valor
 * que não seja exatamente `"ensaio"` em `"real"` — inclusive execução antiga,
 * gravada antes da coluna existir.
 *
 * Mora em `components/app/` pela mesma razão do `<RunTrace>`: é usado por mais
 * de uma tela (o playground, o detalhe da execução e a lista de execuções), e
 * as três precisam dizer EXATAMENTE a mesma coisa.
 */

/**
 * O selo curto, pra ficar do lado do "deu certo" / "deu errado".
 *
 * É o que resolve "quem bate o olho tem que saber, sem clicar em nada".
 */
export function SeloDeEnsaio({ className }: { className?: string }) {
  return (
    <Badge
      variant="outline"
      className={`border-chart-3/50 bg-chart-3/10 text-chart-3 ${className ?? ""}`}
    >
      ensaio
    </Badge>
  );
}

/**
 * O aviso por extenso, pra ficar em cima da resposta do agente.
 *
 * O selo curto sozinho não bastava: ele diz "ensaio", enquanto o texto logo
 * abaixo dele diz "Enviei o email". Quem não sabe o que "ensaio" quer dizer
 * acredita na frase, não no selo — então a frase precisa ser desmentida com
 * todas as letras, no mesmo lugar em que ela aparece.
 *
 * `comoRodarDeVerdade` é a última frase, e ela MUDA por tela: no playground dá
 * pra desligar o ensaio ali mesmo; numa execução que já passou (agendamento,
 * webhook) o botão está em outro lugar, e prometer um que não existe naquela
 * tela é o mesmo tipo de mentira, só menor.
 */
export function AvisoDeEnsaio({ comoRodarDeVerdade }: { comoRodarDeVerdade?: string }) {
  return (
    <p className="flex items-start gap-2 rounded-lg border border-chart-3/40 bg-chart-3/5 p-3 text-sm leading-relaxed">
      <span aria-hidden="true">✋</span>
      <span>
        <strong>Isto foi um ensaio.</strong> Nada saiu daqui pra fora — nenhum email foi enviado.{" "}
        <strong>Se o agente disser que enviou ou mandou alguma coisa, ele não mandou.</strong>
        {comoRodarDeVerdade ? ` ${comoRodarDeVerdade}` : null}
      </span>
    </p>
  );
}
