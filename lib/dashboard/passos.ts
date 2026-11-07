/**
 * "O QUE FALTA PRA ISSO FUNCIONAR" — a lista de degraus do Início.
 *
 * POR QUE ISTO EXISTE
 * -------------------
 * O Início era um gráfico inventado. O aluno que acabava de subir o template
 * caía nele, via linha subindo, e ia embora achando que estava tudo pronto —
 * **sem ninguém ter contado que faltava cadastrar uma chave de IA**. Ele só
 * descobria muito depois, na primeira conversa, num erro vindo do provedor em
 * inglês. A tela não era só inútil: ela ATRASAVA a descoberta.
 *
 * Este arquivo é a regra de "o que ainda falta", e é PURO de propósito: quem
 * fala com o banco é `queries.ts`. Assim a regra tem teste sem banco nenhum.
 *
 * ⚠️ TRÊS DECISÕES QUE PARECEM DETALHE E NÃO SÃO:
 *
 * 1. **Degrau que a pessoa não pode cumprir não vira botão.** Chave e teto são
 *    de dono/administrador. Pra quem é membro, o degrau da chave continua
 *    aparecendo (é ele que explica por que o agente falha), só que como recado
 *    — e o degrau do teto SOME, porque teto faltando não quebra nada pra quem
 *    não pode mexer nele.
 * 2. **"Conversar" só aparece depois que existe agente.** Um degrau que a
 *    pessoa não tem como cumprir ainda só faz a lista parecer mais longa.
 * 3. **Degrau cumprido continua na tela, marcado.** A lista inteira some
 *    sozinha quando não falta mais nada (`temPendencia`); enquanto falta algo,
 *    ver o que já foi feito é o que mostra progresso.
 */
import type { ProximoPasso } from "./types";

/** O retrato do workspace que a lista precisa. Tudo já contado. */
export type EstadoDoWorkspace = {
  orgSlug: string;
  /** Quem está olhando é dono ou administrador? */
  administra: boolean;
  /** Existe chave de IA valendo aqui (do workspace, da plataforma ou do .env)? */
  temChaveDeIa: boolean;
  agentes: number;
  execucoes: number;
  /** Existe teto mensal valendo (do workspace ou da plataforma)? */
  temTeto: boolean;
  /** A primeira base de conhecimento sem NENHUM documento, quando existe. */
  baseVazia: { slug: string; nome: string } | null;
  /** Quem está olhando é dono do SISTEMA (o nível acima de workspace)? */
  ehDonoDaPlataforma: boolean;
  /** Existe chave de email (Resend) cadastrada no nível da plataforma? */
  temChaveDeEmail: boolean;
};

const PEDIR_PRA_QUEM_ADMINISTRA = "Peça pra quem é dono ou administrador do workspace.";

export function montarProximosPassos(e: EstadoDoWorkspace): ProximoPasso[] {
  const base = `/app/${e.orgSlug}`;
  const passos: ProximoPasso[] = [];

  // 1. A chave. É o único degrau que, faltando, quebra TUDO — por isso ele
  //    aparece pra todo mundo, mesmo pra quem não pode resolver.
  passos.push({
    id: "chave",
    titulo: "Cadastrar uma chave de IA",
    explicacao:
      "Sem ela nenhum agente responde. A do OpenRouter é a mais simples: uma chave só " +
      "serve pros agentes e pra ler os seus documentos.",
    feito: e.temChaveDeIa,
    acao: e.administra ? { rotulo: "Cadastrar", href: `${base}/settings/integracoes` } : null,
    recado: e.administra ? null : PEDIR_PRA_QUEM_ADMINISTRA,
  });

  // 2. O agente. NÃO é gated por papel: ninguém cria pela tela, nem dono nem
  //    administrador — agente nasce de arquivo, e quem cria é o Claude Code.
  //    O botão leva pra lista (que qualquer membro já pode ver), e é lá que a
  //    própria tela explica quem faz o quê.
  //
  //    ⚠️ O TÍTULO DESCREVE ESTADO, NÃO AÇÃO — e isso foi medido no navegador.
  //    Enquanto ele dizia "Criar seu primeiro agente", o degrau nascia RISCADO
  //    em todo workspace novo: `materializarWorkspace` grava o agente
  //    declarado em `lib/seed/registro.ts` no instante em que o workspace é
  //    criado. O aluno abria a tela e via, marcado como feito, um passo que
  //    ele não deu — e que ele não teria como dar, porque não existe tela de
  //    criar agente. "Ter um agente no ar" é verdade nos dois casos: quando
  //    veio do arquivo e quando ainda não veio nenhum.
  passos.push({
    id: "agente",
    titulo: "Ter um agente no ar",
    explicacao: "Ele nasce do código: peça pro Claude Code criar um agente pra você.",
    feito: e.agentes > 0,
    acao: { rotulo: "Ver agentes", href: `${base}/agentes` },
    recado: null,
  });

  // 3. A primeira conversa — só faz sentido depois que existe agente.
  if (e.agentes > 0) {
    passos.push({
      id: "conversa",
      titulo: "Conversar com ele pela primeira vez",
      explicacao:
        "Abra o agente e mande uma pergunta. Dá pra ver depois o que ele fez e quanto custou.",
      feito: e.execucoes > 0,
      acao: { rotulo: "Abrir agentes", href: `${base}/agentes` },
      recado: null,
    });
  }

  // 4. A base vazia. Só aparece quando ela existe e está sem documento: quem
  //    não usa conhecimento não precisa ver degrau nenhum sobre isso.
  //
  //    ⚠️ O BOTÃO É DE DONO/ADMINISTRADOR, e isso foi DEFEITO MEDIDO NO
  //    NAVEGADOR, não teoria. A tela de Conhecimento abre pra todo membro, e
  //    por isso o degrau parecia acionável por qualquer um. Só que a policy de
  //    insert de `documents` exige `has_org_role(owner, admin)` — o membro
  //    chegava numa tela sem botão de subir e ficava sem entender o que tinha
  //    feito de errado. Ele continua VENDO o degrau (é ele que explica por que
  //    o agente não acha nada na base), só que como recado.
  if (e.baseVazia) {
    passos.push({
      id: "documento",
      titulo: `Subir um documento em "${e.baseVazia.nome}"`,
      explicacao: "A base está criada, mas vazia — o agente ainda não tem o que consultar nela.",
      feito: false,
      acao: e.administra
        ? { rotulo: "Subir documento", href: `${base}/conhecimento/${e.baseVazia.slug}` }
        : null,
      recado: e.administra ? null : PEDIR_PRA_QUEM_ADMINISTRA,
    });
  }

  // 5. O email. Só pra quem é dono do SISTEMA, porque é lá que a chave mora
  //    (uma só, pro app inteiro — não é coisa de workspace). Some assim que
  //    a chave existe: o segundo passo (o SMTP no painel do Supabase) o app
  //    não tem como conferir, então quem conta aquilo é o cartão da Resend,
  //    onde a pessoa já está com a mão na massa. Um degrau que nunca some
  //    porque não dá pra verificar viraria enfeite, e enfeite ensina a
  //    ignorar a lista inteira.
  if (e.ehDonoDaPlataforma && !e.temChaveDeEmail) {
    passos.push({
      id: "email",
      titulo: "Configurar o envio de email",
      explicacao:
        "Sem isso, o Supabase entrega só 2 emails por hora — quem tentar criar conta depois " +
        "disso recebe erro e fica de fora, e você não fica sabendo.",
      feito: false,
      acao: { rotulo: "Configurar", href: "/plataforma/configuracoes" },
      recado: null,
    });
  }

  // 6. O teto. Some pra quem não pode mexer nele (ver o aviso 1 do topo).
  if (e.administra) {
    passos.push({
      id: "teto",
      titulo: "Definir um teto de gasto",
      explicacao:
        "É quanto o workspace pode gastar de IA por mês. Sem teto, não existe nada segurando a conta.",
      feito: e.temTeto,
      acao: { rotulo: "Definir teto", href: `${base}/settings/limites` },
      recado: null,
    });
  }

  return passos;
}

/** A lista inteira some da tela quando isto é `false`. */
export function temPendencia(passos: ProximoPasso[]): boolean {
  return passos.some((p) => !p.feito);
}
