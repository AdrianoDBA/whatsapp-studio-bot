#!/bin/bash
set -e

DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"
mkdir -p "$DIR/logs"

echo "=== INICIANDO BOT LOCALMENTE (SEM DEPENDÊNCIA DE APIS EXTERNAS) ==="

# 1. Limpa processos anteriores nas portas 5005 e 5006
echo "[1/4] Liberando portas 5005 e 5006..."
lsof -ti :5005 -ti :5006 | xargs kill -9 2>/dev/null || true
pkill -f "node.*gateway.js" 2>/dev/null || true
pkill -f "gunicorn.*app:app" 2>/dev/null || true
sleep 1

# 2. Inicia Gateway WhatsApp Baileys (QR Code local na porta 5006)
echo "[2/4] Iniciando WhatsApp Baileys Gateway (porta 5006)..."
cd "$DIR/whatsapp-gateway"
nohup node gateway.js > "$DIR/logs/gateway.log" 2>&1 &
cd "$DIR"

# 3. Inicia servidor Web Flask/Gunicorn (porta 5005)
echo "[3/4] Iniciando Servidor Web do Studio (porta 5005)..."
export OBJC_DISABLE_INITIALIZE_FORK_SAFETY=YES
export USE_PROVIDER=baileys
export DB_PATH="$DIR/studio.db"
nohup "$DIR/.venv/bin/gunicorn" --bind 0.0.0.0:5005 --workers 1 --threads 4 --timeout 120 app:app --chdir "$DIR" > "$DIR/logs/gunicorn.log" 2>&1 &

# 4. Aguarda inicialização e verifica saúde dos serviços
echo "[4/4] Verificando serviços locais..."
sleep 3

GATEWAY_STATUS="OFFLINE"
if curl -s http://127.0.0.1:5006/status > /dev/null 2>&1; then
    GATEWAY_STATUS="ONLINE (porta 5006)"
fi

APP_STATUS="OFFLINE"
if curl -s http://127.0.0.1:5005/health > /dev/null 2>&1; then
    APP_STATUS="ONLINE (porta 5005)"
fi

echo ""
echo "=========================================================="
echo "  STATUS DOS SERVIÇOS LOCAIS:"
echo "  • Web App / Painel:   $APP_STATUS"
echo "  • WhatsApp Gateway:  $GATEWAY_STATUS"
echo "=========================================================="
echo ""
echo "  LINKS LOCAIS PARA TESTE:"
echo "  👉 Painel de Controle:   http://localhost:5005/painel?token=painel-seguro-studio-2026"
echo "  👉 Chat de Teste:        http://localhost:5005/dashboard"
echo "  👉 Conectar WhatsApp:    http://localhost:5005/comecar"
echo "  👉 Ver Status Conexão:   http://localhost:5005/status-conexao"
echo ""
echo "  Logs disponíveis em: $DIR/logs/"
echo "=========================================================="
