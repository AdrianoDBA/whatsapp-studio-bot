# syntax=docker/dockerfile:1
# =============================================================================
# Imagem de produção do template.
#
# Você NÃO precisa mexer aqui. O EasyPanel lê este arquivo sozinho.
#
# Três coisas que valem saber:
#  - O site sobe na PORTA 80 (a porta padrão da web). No EasyPanel, quando ele
#    perguntar a porta, é 80.
#  - Nenhuma chave sua entra na imagem. Tudo é lido quando o app liga, então
#    trocar uma variável no painel é só clicar em Deploy de novo — sem precisar
#    reconstruir nada do zero.
#  - O container roda DOIS processos: o site e o trabalhador da automação (o
#    que faz agendamento e webhook rodarem sozinhos). Quem cuida dos dois é o
#    docker-entrypoint.sh; se um morre, o container inteiro cai de propósito.
# =============================================================================

# --- 1. Baixa as bibliotecas -------------------------------------------------
FROM node:22-alpine AS deps
WORKDIR /app
RUN apk add --no-cache libc6-compat
COPY package.json package-lock.json* ./
# `npm ci` instala exatamente as versões travadas no package-lock.json.
# Se o lock estiver fora de sincronia (acontece quando alguém roda `npm install`
# num sistema operacional diferente), caímos no `npm install` em vez de deixar
# o deploy morrer — o aviso fica no log.
RUN npm ci --no-audit --no-fund || \
    (echo "[aviso] package-lock.json fora de sincronia com o Linux; usando npm install" && \
     npm install --no-audit --no-fund)

# --- 1b. Biblioteca de banco usada FORA do site -----------------------------
# O Next só empacota o que o site usa. Dois programas rodam fora dele e também
# precisam falar com o banco: o script que cria as tabelas (scripts/migrate.mjs)
# e o trabalhador da automação (scripts/worker.mjs). A biblioteca deles vem por
# aqui.
FROM node:22-alpine AS pgdeps
WORKDIR /pg
COPY package.json package-lock.json* ./
RUN npm install pg --omit=dev --no-audit --no-fund --no-save

# --- 2. Constrói o site ------------------------------------------------------
FROM node:22-alpine AS builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
ENV NEXT_TELEMETRY_DISABLED=1
RUN npm run build

# --- 3. Imagem final que vai rodar ------------------------------------------
FROM node:22-alpine AS runner
WORKDIR /app

ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
# Porta padrão da web. É esta que você informa no EasyPanel.
ENV PORT=80
ENV HOSTNAME=0.0.0.0
# Esta imagem foi feita pra rodar atrás do proxy do EasyPanel, que é quem
# informa o endereço real de cada visitante. Se você expuser o container
# direto na internet, defina TRUST_PROXY=0 nas variáveis do app.
ENV TRUST_PROXY=1

RUN addgroup --system --gid 1001 nodejs && \
    adduser --system --uid 1001 nextjs

COPY --from=builder --chown=nextjs:nodejs /app/public ./public
COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static

# Necessários pra criar as tabelas do banco no boot E pra o trabalhador da
# automação rodar (scripts/worker.mjs + scripts/lib/).
COPY --from=builder --chown=nextjs:nodejs /app/scripts ./scripts
COPY --from=pgdeps --chown=nextjs:nodejs /pg/node_modules ./node_modules
COPY --from=builder --chown=nextjs:nodejs /app/supabase/migrations ./supabase/migrations
# Certificado da autoridade do Supabase — sem ele o app não consegue confirmar
# que está falando com o banco certo, e se recusa a conectar (proposital).
COPY --from=builder --chown=nextjs:nodejs /app/supabase/certs ./supabase/certs
COPY --chown=nextjs:nodejs docker-entrypoint.sh ./docker-entrypoint.sh
RUN chmod +x ./docker-entrypoint.sh

USER nextjs
EXPOSE 80

# Um usuário comum consegue usar a porta 80 dentro do container porque o Docker
# já libera isso por padrão — não precisa de permissão especial.
# A checagem de saúde olha DUAS coisas: se o site responde e se o trabalhador
# da automação deu sinal de vida nos últimos 2 minutos (ver app/api/health).
# O tempo de graça é maior que antes porque agora o boot também liga o segundo
# processo.
HEALTHCHECK --interval=30s --timeout=10s --start-period=90s --retries=3 \
  CMD wget --no-verbose --tries=1 --spider http://127.0.0.1:80/api/health || exit 1

ENTRYPOINT ["./docker-entrypoint.sh"]
