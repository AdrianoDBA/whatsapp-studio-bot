#!/bin/sh
# =============================================================================
# O que roda quando o container liga.
#
# 1. Confere a chave de segurança do cofre (ENCRYPTION_KEY) e, se ela ainda não
#    existir, gera uma temporária e imprime aqui no registro (log) pra você
#    copiar e colar no painel.
# 2. Cria/atualiza as tabelas do banco (só o que ainda falta).
# 3. Sobe o TRABALHADOR da automação (o que faz agendamento e webhook rodarem
#    sozinhos).
# 4. Sobe o site.
# 5. Espera o site responder e roda `npm run semear`, em segundo plano — é o
#    que leva agente, base de conhecimento, agendamento e webhook novos
#    (declarados em `lib/seed/registro.ts`) pros workspaces que JÁ existiam
#    antes deste deploy. Workspace novo já nasce com o produto dentro sozinho
#    (não depende disto); este passo é só pra quem já existia.
#
# Se o banco não puder ser atualizado, o container para com uma mensagem
# explicando o motivo — é melhor do que subir um site que dá erro em toda tela.
#
# ⚠️ A PARTIR DAQUI O CONTAINER TEM DOIS PROCESSOS, e este arquivo é o pai dos
# dois. Se QUALQUER um dos dois morrer, ele derruba o outro e o container
# inteiro cai. É de propósito: servir um site onde nenhuma automação roda, e
# calado, é o pior resultado possível — o EasyPanel reinicia e você vê no log.
# =============================================================================
set -e

echo "----------------------------------------------------------------"
echo " Iniciando o app..."
echo "----------------------------------------------------------------"

# -----------------------------------------------------------------------------
# 1. A chave de segurança do cofre (ENCRYPTION_KEY)
# -----------------------------------------------------------------------------
# É com ela que o app tranca as chaves de API que você cadastra pelas telas
# (OpenRouter, Anthropic, OpenAI, Google, Resend). Ela mora FORA do banco de
# propósito: quem tiver só o banco na mão não abre nada.
#
# Quando ela falta, o site sobe do mesmo jeito — mas a tela de chaves fica
# bloqueada até você colar a chave no painel. É melhor bloquear do que deixar
# você cadastrar uma chave de API que sumiria no próximo reinício, sem aviso.
#
# A marca ENCRYPTION_KEY_EPHEMERAL é como o app fica sabendo que a chave que
# está valendo é a temporária (ver `encryptionKeyIsEphemeral()` em lib/env.ts).

if [ -z "${ENCRYPTION_KEY:-}" ]; then
  ENCRYPTION_KEY="$(node -e "process.stdout.write(require('node:crypto').randomBytes(32).toString('base64'))")"
  ENCRYPTION_KEY_EPHEMERAL=1
  export ENCRYPTION_KEY
  export ENCRYPTION_KEY_EPHEMERAL

  echo ""
  echo "================================================================"
  echo " FALTA UMA CONFIGURAÇÃO — LEVA 30 SEGUNDOS"
  echo "================================================================"
  echo ""
  echo " O app precisa de uma chave de segurança pra trancar as chaves"
  echo " de API que você cadastra pelas telas (OpenRouter, Anthropic,"
  echo " OpenAI, Google, Resend)."
  echo ""
  echo " Já gerei uma pra você. COPIE a linha abaixo inteira:"
  echo ""
  echo "   ENCRYPTION_KEY=${ENCRYPTION_KEY}"
  echo ""
  echo " Cole no painel do seu app (no EasyPanel: aba Environment),"
  echo " numa linha nova, e clique em Deploy."
  echo ""
  echo " Copie SÓ essa linha. NÃO crie a variável"
  echo " ENCRYPTION_KEY_EPHEMERAL no painel — ela é coisa interna."
  echo ""
  echo " Enquanto você não colar, o site funciona normalmente, mas a"
  echo " tela de chaves fica bloqueada: a chave que gerei agora some"
  echo " quando o container reiniciar, e tudo que fosse guardado com"
  echo " ela viraria lixo."
  echo ""
  echo " GUARDE essa chave em lugar seguro depois de colar."
  echo " Perder a ENCRYPTION_KEY = perder todas as chaves de API"
  echo " cadastradas. Não existe recuperação: o conserto é recadastrar"
  echo " uma por uma."
  echo ""
  echo "================================================================"
  echo ""
else
  # A chave veio do painel. Se a marca de "temporária" tiver ficado ligada por
  # engano (acontece quando alguém cola as DUAS linhas do aviso acima no
  # painel), o cofre continuaria bloqueado sem motivo. Apagamos a marca aqui.
  unset ENCRYPTION_KEY_EPHEMERAL
  echo " Chave de segurança do cofre: configurada."
fi

# -----------------------------------------------------------------------------
# 2. As tabelas do banco
# -----------------------------------------------------------------------------
node /app/scripts/migrate.mjs

# -----------------------------------------------------------------------------
# 3. O trabalhador da automação
# -----------------------------------------------------------------------------
# É ele que faz agendamento e webhook rodarem sozinhos. Ele sobe ANTES do site
# de propósito: assim, quando o primeiro trabalho aparecer, ele já está de pé.
#
# Sem DATABASE_URL ele não morre — imprime um aviso e fica parado. Derrubar o
# container por causa disso transformaria um app que funciona num app que
# reinicia pra sempre.
echo " Ligando o trabalhador da automação..."
node /app/scripts/worker.mjs &
WORKER_PID=$!

# -----------------------------------------------------------------------------
# 4. O site
# -----------------------------------------------------------------------------
echo "----------------------------------------------------------------"
echo " Site no ar na porta ${PORT:-80}"
echo "----------------------------------------------------------------"

node /app/server.js &
SITE_PID=$!

# -----------------------------------------------------------------------------
# 5. O pai dos dois
# -----------------------------------------------------------------------------
# Quando o EasyPanel manda parar (SIGTERM), repassamos o pedido pros dois
# filhos em vez de morrer sozinho e deixar processo órfão pra trás.
trap 'echo " Parando..."; kill -TERM "$WORKER_PID" "$SITE_PID" 2>/dev/null; exit 0' TERM INT

# -----------------------------------------------------------------------------
# 6. Semeando os workspaces que já existem
# -----------------------------------------------------------------------------
# Agente, base de conhecimento, agendamento e webhook nascem de
# `lib/seed/registro.ts` (ver CLAUDE.md). Workspace NOVO já nasce com o
# produto dentro sozinho; quem precisa disto aqui é só o workspace que JÁ
# existia antes de uma declaração nova entrar no ar.
#
# `npm run semear` chama a própria rota HTTP do site (`/api/internal/semear`)
# — rodar antes do site responder seria ovo-e-galinha. Por isso esperamos, com
# um teto de tentativas (nunca um `sleep` fixo torcendo pra dar certo).
#
# Roda em SEGUNDO PLANO (o `&` no fim), sem travar o boot: o container fica
# saudável (o healthcheck olha só `/api/health`, não o semear) mesmo enquanto
# ele ainda está rodando.
#
# ⚠️ FALHAR AQUI NUNCA DERRUBA O CONTAINER. Workspace desatualizado é
# reparável — basta rodar `npm run semear` na mão, ou esperar o próximo
# deploy; container em laço de reinício deixa o aluno SEM SITE, e essa troca
# não vale a pena. Por isso todo o bloco abaixo mora dentro de um `if`: com
# `set -e` ligado, um comando que falha fora de um `if`/`while`/`until`
# derrubaria o subshell (e, se não fosse subshell, o container inteiro).
(
  PORTA_DO_SITE="${PORT:-80}"
  TENTATIVAS=0
  TETO_DE_TENTATIVAS=60

  until wget -q -O /dev/null "http://127.0.0.1:${PORTA_DO_SITE}/api/health"; do
    TENTATIVAS=$((TENTATIVAS + 1))
    if [ "$TENTATIVAS" -ge "$TETO_DE_TENTATIVAS" ]; then
      echo ""
      echo " [semear] o site não respondeu a tempo — pulando o semear deste boot."
      echo " [semear] rode 'npm run semear' na mão quando o site estiver de pé."
      exit 0
    fi
    sleep 2
  done

  echo " [semear] site no ar — materializando os workspaces que já existem..."

  if node /app/scripts/semear.mjs; then
    echo " [semear] concluído."
  else
    STATUS=$?
    if [ "$STATUS" -eq 2 ]; then
      echo " [semear] concluído, com workspace pulado (ver o motivo acima)."
    else
      echo " [semear] terminou com erro (ver acima) — o site continua no ar normalmente."
      echo " [semear] rode 'npm run semear' na mão pra tentar de novo."
    fi
  fi
) &

# Um morreu? Derruba o outro e cai junto.
while true; do
  if ! kill -0 "$WORKER_PID" 2>/dev/null; then
    echo ""
    echo "================================================================"
    echo " O trabalhador da automação parou."
    echo " Derrubando o container pra o painel reiniciar tudo — melhor do"
    echo " que deixar o site no ar com as automações mortas, em silêncio."
    echo "================================================================"
    kill -TERM "$SITE_PID" 2>/dev/null || true
    exit 1
  fi

  if ! kill -0 "$SITE_PID" 2>/dev/null; then
    echo ""
    echo "================================================================"
    echo " O site parou. Derrubando o trabalhador junto."
    echo "================================================================"
    kill -TERM "$WORKER_PID" 2>/dev/null || true
    exit 1
  fi

  sleep 2
done
