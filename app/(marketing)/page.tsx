/**
 * A PÁGINA DE ENTRADA (a landing) — a primeira coisa que alguém vê no seu
 * endereço, antes de criar conta.
 *
 * ⚠️ NÃO ESCREVA TEXTO AQUI DENTRO. Todo o texto desta página mora em
 * `config/landing.config.ts`, e o nome do app em `config/app.config.ts`. É de
 * propósito: quem vai trocar essas frases é um aluno que não programa, e ele
 * não deveria precisar achar a palavra certa no meio de 400 linhas de JSX.
 *
 * ⚠️ ESTA PÁGINA JÁ MENTIU, E DE SEIS JEITOS. Vale saber quais, porque são os
 * erros que qualquer landing comete:
 *
 *   1. vendia autenticação, multi-tenant e convites — sem uma palavra sobre
 *      agente de IA, que é o grosso do que este app faz;
 *   2. anunciava uma tela de "KPI cards e gráficos Recharts" que foi apagada;
 *   3. o painel do topo era inventado (Usuários 1.234, Receita R$ 4,5k, e um
 *      gráfico que só subia) — quem criasse conta caía numa tela diferente;
 *   4. mandava rodar `npx degit nathan/template meu-saas`, e esse endereço
 *      não existe: o comando falhava pra quem copiasse;
 *   5. escrevia o nome do app na mão, então renomear o app deixava a landing
 *      com o nome velho;
 *   6. o rodapé dizia "MIT" e não existe arquivo de licença no projeto.
 *
 * O exemplo de conversa que ficou no lugar do painel falso aparece com a
 * palavra **exemplo** na tela. Ele mostra como o produto funciona, não quantos
 * clientes ele já teve.
 */
import {
  ActivityIcon,
  ArrowRightIcon,
  BookOpenIcon,
  BotIcon,
  CalendarClockIcon,
  FileTextIcon,
  GaugeIcon,
  LockIcon,
  type LucideIcon,
  UsersIcon,
  ZapIcon,
} from "lucide-react";
import Link from "next/link";
import { redirect } from "next/navigation";
import { Button } from "@/components/ui/button";
import { appConfig } from "@/config/app.config";
import {
  type FuncionalidadeDaLanding,
  landingConfig,
  type NomeDeIcone,
} from "@/config/landing.config";
import { getCurrentUser } from "@/lib/auth/guards";
import { getUserOrgs } from "@/lib/orgs/queries";

/**
 * Os apelidos em português do arquivo de configuração viram ícone aqui.
 *
 * O aluno escreve `icone: "relogio"`; quem sabe que existe uma biblioteca
 * chamada lucide é este arquivo, e só ele.
 */
const ICONES: Record<NomeDeIcone, LucideIcon> = {
  robo: BotIcon,
  livro: BookOpenIcon,
  relogio: CalendarClockIcon,
  medidor: GaugeIcon,
  pessoas: UsersIcon,
  raio: ZapIcon,
  cadeado: LockIcon,
  grafico: ActivityIcon,
};

export default async function LandingPage() {
  const user = await getCurrentUser();
  if (user) {
    const orgs = await getUserOrgs(user.id);
    if (orgs.length > 0) redirect(`/app/${orgs[0]!.organization.slug}/dashboard`);
    redirect("/onboarding");
  }

  const { hero, esteira, funcionalidades, secaoFuncionalidades, chamadaFinal } = landingConfig;

  return (
    <div className="relative min-h-screen overflow-hidden bg-background">
      {/* Camadas de atmosfera */}
      <div className="pointer-events-none absolute inset-0 bg-dot-grid opacity-60" />
      <div className="pointer-events-none absolute inset-0 halo-primary" />
      <div
        className="pointer-events-none absolute inset-x-0 top-0 h-px"
        style={{
          background:
            "linear-gradient(90deg, transparent, oklch(from var(--primary) l c h / 0.6), transparent)",
        }}
      />

      <Nav />

      {/* Topo */}
      <section className="relative mx-auto max-w-6xl px-6 pt-24 pb-20 sm:pt-32 sm:pb-28">
        <div className="flex flex-col items-center gap-8 text-center">
          <Selo>
            <span className="relative flex h-1.5 w-1.5">
              <span className="absolute inline-flex h-full w-full rounded-full bg-primary opacity-75 pulse-soft" />
              <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-primary" />
            </span>
            {hero.selo}
          </Selo>

          <h1
            className="fade-up max-w-4xl font-semibold text-5xl tracking-tight sm:text-6xl md:text-7xl"
            style={{ animationDelay: "80ms" }}
          >
            {hero.titulo}
            <br />
            <span className="text-glow-primary text-primary">{hero.destaque}</span>
          </h1>

          <p
            className="fade-up max-w-xl text-balance text-muted-foreground sm:text-lg"
            style={{ animationDelay: "180ms" }}
          >
            {hero.subtitulo}
          </p>

          <div
            className="fade-up flex flex-col items-center gap-3 sm:flex-row"
            style={{ animationDelay: "280ms" }}
          >
            <Button
              render={<Link href="/signup" />}
              nativeButton={false}
              size="lg"
              className="group h-11 gap-2 px-6 text-[15px]"
            >
              {hero.botaoPrincipal}
              <ArrowRightIcon className="h-4 w-4 transition-transform group-hover:translate-x-0.5" />
            </Button>
            <Button
              render={<Link href="/login" />}
              nativeButton={false}
              variant="ghost"
              size="lg"
              className="h-11 px-6 text-[15px] text-muted-foreground hover:text-foreground"
            >
              {hero.botaoSecundario}
            </Button>
          </div>
        </div>

        {/* O exemplo de conversa */}
        <div className="fade-up relative mt-20 sm:mt-24" style={{ animationDelay: "500ms" }}>
          <div className="-top-8 absolute inset-x-0 mx-auto h-32 max-w-3xl rounded-full bg-primary/20 blur-3xl" />
          <ConversaDeExemplo />
        </div>
      </section>

      {/* A esteira deslizante */}
      <section className="relative border-border/60 border-y bg-card/30 py-6">
        <div className="absolute inset-y-0 left-0 z-10 w-24 bg-gradient-to-r from-background to-transparent" />
        <div className="absolute inset-y-0 right-0 z-10 w-24 bg-gradient-to-l from-background to-transparent" />
        <div className="flex overflow-hidden">
          <div className="flex animate-marquee shrink-0 items-center gap-8 pr-8">
            {[...esteira, ...esteira].map((item, i) => (
              <span
                // biome-ignore lint/suspicious/noArrayIndexKey: a esteira repete a lista de propósito
                key={i}
                className="flex items-center gap-8 whitespace-nowrap font-mono text-muted-foreground/60 text-sm"
              >
                {item}
                <span aria-hidden="true" className="text-muted-foreground/30">
                  ·
                </span>
              </span>
            ))}
          </div>
        </div>
      </section>

      {/* Os seis quadrinhos */}
      <section className="relative mx-auto max-w-6xl px-6 py-24 sm:py-32">
        <div className="mb-16 flex flex-col items-center gap-4 text-center">
          <span className="label-mono">/ {secaoFuncionalidades.selo}</span>
          <h2 className="max-w-2xl font-semibold text-3xl tracking-tight sm:text-4xl">
            {secaoFuncionalidades.titulo}
          </h2>
        </div>

        <div className="grid gap-px overflow-hidden rounded-2xl border border-border/60 bg-border/60 sm:grid-cols-2 lg:grid-cols-3">
          {funcionalidades.map((f) => (
            <Quadrinho key={f.titulo} {...f} />
          ))}
        </div>
      </section>

      {/* O último empurrão */}
      <section className="relative mx-auto max-w-6xl px-6 pb-24 sm:pb-32">
        <div className="relative overflow-hidden rounded-3xl border border-border/60 bg-card/40 px-8 py-16 text-center sm:px-16 sm:py-24">
          <div className="pointer-events-none absolute inset-0 bg-dot-grid-sm opacity-40" />
          <div className="pointer-events-none absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-primary/60 to-transparent" />
          <div className="-inset-x-32 pointer-events-none absolute bottom-0 h-48 bg-primary/10 blur-[80px]" />

          <div className="relative flex flex-col items-center gap-6">
            <span className="label-mono">/ {chamadaFinal.selo}</span>
            <h2 className="max-w-2xl font-semibold text-4xl tracking-tight sm:text-5xl">
              {chamadaFinal.titulo} <span className="text-primary">{chamadaFinal.destaque}</span>
            </h2>
            <p className="max-w-lg text-muted-foreground">{chamadaFinal.subtitulo}</p>
            <Button
              render={<Link href="/signup" />}
              nativeButton={false}
              size="lg"
              className="group mt-2 h-12 gap-2 px-8 text-base"
            >
              {chamadaFinal.botao}
              <ArrowRightIcon className="h-4 w-4 transition-transform group-hover:translate-x-0.5" />
            </Button>
          </div>
        </div>
      </section>

      <Rodape />
    </div>
  );
}

/** A primeira letra do nome do app, pro quadradinho verde do logo. */
function inicialDoApp(): string {
  return appConfig.name.trim().charAt(0).toUpperCase() || "A";
}

function Nav() {
  return (
    <nav className="relative mx-auto flex max-w-6xl items-center justify-between gap-4 px-6 py-5">
      {/* `min-w-0` + `truncate`: o nome vem do config e pode ser comprido. Sem
          isso ele quebra em duas linhas no celular e entorta a barra inteira. */}
      <Link href="/" className="group flex min-w-0 items-center gap-2.5">
        <span className="grid h-7 w-7 shrink-0 place-items-center rounded-md bg-primary text-primary-foreground">
          <span className="font-bold text-sm">{inicialDoApp()}</span>
        </span>
        {/* O nome vem de config/app.config.ts — renomear o app renomeia aqui. */}
        <span className="truncate font-semibold text-sm tracking-tight sm:text-[15px]">
          {appConfig.name}
        </span>
      </Link>
      <div className="flex shrink-0 items-center gap-1">
        <Button
          render={<Link href="/login" />}
          nativeButton={false}
          variant="ghost"
          size="sm"
          className="text-muted-foreground hover:text-foreground"
        >
          {landingConfig.navegacao.entrar}
        </Button>
        <Button render={<Link href="/signup" />} nativeButton={false} size="sm" className="h-8">
          {landingConfig.navegacao.criarConta}
        </Button>
      </div>
    </nav>
  );
}

function Selo({ children }: { children: React.ReactNode }) {
  return (
    <div
      className="fade-up inline-flex items-center gap-2 rounded-full border border-border/60 bg-card/60 px-3 py-1 font-mono text-[11px] text-muted-foreground backdrop-blur-sm"
      style={{ animationDelay: "0ms" }}
    >
      {children}
    </div>
  );
}

function Quadrinho({ icone, titulo, descricao, etiqueta }: FuncionalidadeDaLanding) {
  const Icone = ICONES[icone];
  return (
    <div className="group relative bg-background p-8 transition-colors hover:bg-card/40">
      <div className="flex flex-col gap-5">
        <div className="flex items-center justify-between">
          <div className="grid h-10 w-10 place-items-center rounded-lg border border-border/60 bg-card/60 text-primary transition-colors group-hover:border-primary/40">
            <Icone className="h-4 w-4" />
          </div>
          <span className="label-mono">/{etiqueta}</span>
        </div>
        <div className="space-y-2">
          <h3 className="font-medium text-lg tracking-tight">{titulo}</h3>
          <p className="text-muted-foreground text-sm leading-relaxed">{descricao}</p>
        </div>
      </div>
    </div>
  );
}

/**
 * O EXEMPLO DE CONVERSA — o que substituiu o painel inventado.
 *
 * ⚠️ A PALAVRA "EXEMPLO" FICA NA TELA, sempre. A versão antiga desta página
 * mostrava um painel com "Usuários 1.234" e "Receita R$ 4,5k" sem nenhum
 * aviso, e quem criasse conta por causa daquilo entrava num app vazio. A
 * diferença não é de honestidade abstrata: aqui a tela demonstra COMO o
 * produto funciona (a pessoa pergunta, o agente responde e diz de onde tirou),
 * em vez de afirmar QUANTO ele já rendeu.
 *
 * Os balões copiam o desenho dos de verdade (`components/ai/message-bubble`):
 * escuro e alinhado à direita pra pergunta, com borda e alinhado à esquerda
 * pra resposta. Assim a tela real não parece outro produto.
 */
function ConversaDeExemplo() {
  const { exemplo } = landingConfig;

  return (
    <div className="relative mx-auto overflow-hidden rounded-2xl border border-border/60 bg-card/40 shadow-2xl backdrop-blur-sm">
      <div className="pointer-events-none absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-primary/40 to-transparent" />

      {/* A moldura de janela */}
      <div className="flex items-center justify-between gap-4 border-border/60 border-b bg-card/60 px-4 py-3">
        <div className="flex items-center gap-1.5">
          <div className="h-2.5 w-2.5 rounded-full bg-foreground/15" />
          <div className="h-2.5 w-2.5 rounded-full bg-foreground/15" />
          <div className="h-2.5 w-2.5 rounded-full bg-foreground/15" />
        </div>
        <div className="hidden items-center gap-2 font-mono text-[10px] text-muted-foreground sm:flex">
          <span className="h-1.5 w-1.5 rounded-full bg-primary" />
          {exemplo.endereco}
        </div>
        <span className="rounded-full border border-border/60 bg-background/60 px-2 py-0.5 font-mono text-[10px] text-muted-foreground uppercase tracking-wider">
          exemplo
        </span>
      </div>

      <div className="space-y-5 p-6 sm:p-8">
        {/* A pergunta da pessoa */}
        <div className="flex flex-row-reverse gap-3">
          <div
            className="grid h-7 w-7 shrink-0 place-items-center rounded-md bg-foreground font-medium text-[11px] text-background"
            aria-hidden="true"
          >
            VC
          </div>
          <div className="max-w-[85%]">
            <div className="inline-block max-w-full rounded-lg bg-foreground px-3.5 py-2.5 text-left text-background text-sm leading-relaxed">
              {exemplo.pergunta}
            </div>
          </div>
        </div>

        {/* A resposta do agente */}
        <div className="flex gap-3">
          <div
            className="grid h-7 w-7 shrink-0 place-items-center rounded-md bg-primary text-primary-foreground"
            aria-hidden="true"
          >
            <BotIcon className="h-3.5 w-3.5" />
          </div>
          <div className="min-w-0 max-w-[85%] space-y-2">
            <div className="inline-block max-w-full rounded-lg border border-border/60 bg-card/80 px-3.5 py-2.5 text-left text-sm leading-relaxed">
              {exemplo.resposta}
            </div>
            {/* De onde ele tirou. É o que o agente de verdade mostra. */}
            <div className="flex items-center gap-1.5 text-muted-foreground text-xs">
              <FileTextIcon className="h-3 w-3 shrink-0 text-primary" />
              <span className="truncate">{exemplo.fonte}</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function Rodape() {
  const { rodape } = landingConfig;
  return (
    <footer className="relative mx-auto max-w-6xl border-border/60 border-t px-6 py-10">
      <div className="flex flex-col items-center justify-between gap-4 text-sm sm:flex-row">
        <div className="flex items-center gap-2">
          <span className="grid h-5 w-5 place-items-center rounded bg-primary text-primary-foreground">
            <span className="font-bold text-[10px]">{inicialDoApp()}</span>
          </span>
          {/* ⚠️ Sem "MIT" aqui. Ver o aviso no rodapé de config/landing.config.ts. */}
          <span className="font-mono text-muted-foreground text-xs">
            {appConfig.name} · {rodape.esquerda}
          </span>
        </div>
        <span className="font-mono text-muted-foreground text-xs">{rodape.direita}</span>
      </div>
    </footer>
  );
}
