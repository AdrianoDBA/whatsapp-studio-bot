/**
 * O corpo do email que uma AÇÃO do agente manda (`ctx.acao.email`).
 *
 * Simples de propósito: o conteúdo é texto que o AGENTE escreveu (não a
 * plataforma), e enfeitar texto de máquina com caixa colorida e cor de marca só
 * atrapalha a leitura — e sugere uma curadoria humana que não existe.
 *
 * ⚠️ NÃO EXISTE PROP `link`, E ISSO É DECISÃO, NÃO ESQUECIMENTO. Este template
 * já teve uma (`link?: string`, com um "Ver o passo a passo dessa execução" no
 * rodapé) e nenhum chamador nunca passou — `criarAcoesDoMotor`
 * (`lib/agents/acoes.ts`) manda só `corpo`. Ela foi removida por dois motivos,
 * e os dois continuam valendo se alguém pensar em trazer de volta:
 *
 *  1. **Quem tem link pra mandar já manda dentro do corpo.** A entrega do
 *     resultado de uma automação (`lib/automation/entrega.ts`) monta o texto
 *     como `<resultado>\n\n---\n<link da execução>`. Uma segunda casa pro link
 *     só faria ele aparecer duas vezes.
 *  2. **Quem recebe o email quase nunca pode abrir esse link.** A tela de
 *     Execuções pede login E ser membro do workspace. Mandar pro cliente do
 *     aluno um "veja o passo a passo" que cai numa tela de login é pior que não
 *     mandar link nenhum.
 */
type Props = {
  corpo: string;
};

export function ResultadoDaAutomacao({ corpo }: Props) {
  return (
    <div style={{ fontFamily: "system-ui, sans-serif", fontSize: 15, lineHeight: 1.6 }}>
      <div style={{ whiteSpace: "pre-wrap" }}>{corpo}</div>
    </div>
  );
}

export default ResultadoDaAutomacao;
