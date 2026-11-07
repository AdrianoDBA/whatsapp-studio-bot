# CLAUDE.md — components

## Organização

Cinco pastas, cada uma com um propósito:

- **`ui/`** — primitivas do shadcn/ui (Button, Card, Input, Dialog, etc.). NÃO editar a mão — instale via `npx shadcn@latest add <nome>`.
- **`app/`** — componentes do "shell" do app (Sidebar, Header, OrgSwitcher, UserDropdown, ThemeToggle) e os poucos componentes de produto usados por MAIS DE UMA tela (DataTable, EmptyState, RunTrace).
- **`ai/`** — as peças da CONVERSA com um agente (`MessageBubble`, `ToolCallCard`, `ThinkingIndicator`, `LiveTrace`). Apresentação pura: não buscam nada, não decidem nada.
- **`forms/`** — helpers de formulário (`TextField` e `TextareaField`, wrappers sobre RHF + shadcn Form).
- **`providers/`** — Provider components (ThemeProvider).

> **Exceção conhecida em `ui/`:** `textarea.tsx` foi escrito à mão. O
> `@base-ui/react` (a base do shadcn aqui) não tem primitiva de textarea — só
> de `input`. É um `<textarea>` do HTML com as classes de `ui/input.tsx`.
>
> **Por que `run-trace.tsx` mora em `app/` e não junto da página:** ele é o
> único componente usado por duas telas (o playground do agente e o detalhe da
> execução), e as duas mostram exatamente a mesma coisa.
>
> **Por que `budget-banner.tsx` também mora em `app/`:** ele é peça do shell,
> não de uma tela. Quem o desenha é o `layout.tsx` do workspace, então ele
> aparece em TODAS as páginas de dentro dele. É um componente de servidor de
> propósito — sem estado, sem clique, com o dado já pronto vindo do layout — e
> **nenhuma frase nasce nele**: o texto todo sai de `lib/limits/messages.ts`,
> que tem teste palavra por palavra.

## `components/ai/` — as peças da conversa

| Arquivo | O que mostra |
|---|---|
| `message-bubble.tsx` | um balão (a pergunta ou a resposta), com o rastro ao vivo embaixo |
| `tool-call-card.tsx` | "Usou Buscar na base de conhecimento" — abre e mostra o que foi pedido e o que voltou |
| `thinking-indicator.tsx` | as três bolinhas piscando |
| `live-trace.tsx` | a linha fina embaixo da resposta: ferramentas, tokens, custo e "ver o rastro completo" |

### Três regras que vieram de decisão de projeto, não de gosto

1. **O rótulo em PT-BR sai de `getTool(id)?.label`, nunca do id técnico.** O
   modelo pede `buscar-na-base`; a pessoa lê "Buscar na base de conhecimento". Dá pra
   importar `@/lib/agents/tools` de um componente `"use client"` porque ele é
   PURO (é catálogo em código, não consulta ao banco).

2. **Custo `null` NUNCA vira "US$ 0,00".** Zero quer dizer "não custou nada";
   `null` quer dizer "não deu pra calcular". Quando vem `null`, a bolha mostra
   **"preço no rastro"** e o link pra `/execucoes/[runId]`, onde está o número
   certo. Mostrar zero pros dois casos seria mentir sobre a conta.

3. **O cartão de ferramenta aparece num lugar só** — dentro do `<LiveTrace>`,
   embaixo do balão, e não também dentro dele. Nos dois lugares, o cartão
   dobraria na tela toda vez que o agente usasse uma ferramenta.

⚠️ **`LiveTrace` não é o `<RunTrace>` de `app/`.** O `RunTrace` lê
`agent_run_steps` do banco e mostra o passo a passo NUMERADO, com duração e custo
por passo. O `LiveTrace` mostra só o que já chegou pelo stream.

## Como decidir onde criar um componente

```
É uma primitive shadcn que falta?         → npx shadcn@latest add <nome>
É peça da conversa com um agente?         → components/ai/<nome>.tsx
É reutilizável globalmente no app?        → components/app/<nome>.tsx
É um wrapper de form?                     → components/forms/<nome>.tsx
Usado só numa página?                     → mesmo diretório da page.tsx,
                                            com sufixo descritivo
                                            (ex: contatos-form.tsx)
```

## Padrões

- **Componentes:** PascalCase, kebab-case nos arquivos (`org-switcher.tsx` exporta `OrgSwitcher`).
- **Client Components:** primeira linha `"use client";` se usa hooks/estado.
- **Server Components:** padrão (não declarar).
- **Render slot:** use `render={<X />}` (base-ui pattern), NÃO `asChild` (que é Radix).
- **Link dentro de Button:** `<Button render={<Link href="..." />} nativeButton={false}>Texto</Button>`.

## shadcn (base-nova preset)

Esse projeto usa o preset **`base-nova`** do shadcn que renderiza sobre `@base-ui/react` (não Radix). Diferenças importantes:

- Slot via `render` prop, não `asChild`.
- Botões precisam de `nativeButton={false}` quando renderizam como `<a>` (Link).
- Algumas APIs de Dialog/DropdownMenu diferem do Radix — leia o componente em `components/ui/` antes de assumir.

### DropdownMenu — pitfalls do base-ui

- **`DropdownMenuLabel` SEMPRE dentro de `DropdownMenuGroup`** (ou `DropdownMenuRadioGroup`). Sem isso, base-ui joga erro `MenuGroupContext is missing` ao abrir. Padrão:
  ```tsx
  <DropdownMenuContent>
    <DropdownMenuGroup>
      <DropdownMenuLabel>Seção</DropdownMenuLabel>
      <DropdownMenuItem>...</DropdownMenuItem>
    </DropdownMenuGroup>
    <DropdownMenuSeparator />
    <DropdownMenuItem>...</DropdownMenuItem>
  </DropdownMenuContent>
  ```
- `DropdownMenuItem` pode ficar fora de Group (ao contrário do Label).
- Para usar Link como item: `<DropdownMenuItem render={<Link href="..." />}>`.

## Acessibilidade

- Toda interação visível precisa ser acessível por teclado.
- Use `aria-label` em botões só com ícone.
- Forms usam `<FormLabel>` (htmlFor automático via `useFormField`).

## Estilo visual ("Operations Terminal")

Tema: dark + accent verde Kawasaki + mono uppercase em labels + glow sutil.

### Padrões obrigatórios

**Header de página:**
```tsx
<div className="space-y-1.5">
  <span className="label-mono">/ nome-da-secao</span>
  <h1 className="font-semibold text-3xl tracking-tight">Título</h1>
  <p className="text-muted-foreground text-sm">Descrição curta.</p>
</div>
```

**Cards de listagem:**
```tsx
<Card>
  <CardHeader className="border-b border-border/60 bg-card/40 py-3">
    <CardTitle className="label-mono text-[10px]">/ seção</CardTitle>
  </CardHeader>
  <CardContent>...</CardContent>
</Card>
```

**Wrapper de página:**
- Listagem: `<div className="space-y-8">`
- Form-focused: `<div className="max-w-2xl space-y-8">`

### Cores e fontes

- Não invente novas cores accent. Tudo via CSS variables em `app/globals.css`.
- Não adicione fontes novas. Stack já configurada: Work Sans (sans) + JetBrains Mono (mono).
