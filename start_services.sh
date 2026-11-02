#!/bin/bash
DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"
mkdir -p "$DIR/logs"

# Limpa processos anteriores
lsof -ti :5005 -ti :5006 | xargs kill -9 2>/dev/null || true
pkill -f "cloudflared.*5005" 2>/dev/null || true
pkill -f "lt --port 5005" 2>/dev/null || true

# Inicia Gunicorn
nohup "$DIR/.venv/bin/gunicorn" --bind 0.0.0.0:5005 --workers 1 --threads 4 --timeout 120 app:app --chdir "$DIR" > "$DIR/logs/gunicorn.log" 2>&1 &

# Inicia Gateway WhatsApp
cd "$DIR/whatsapp-gateway"
nohup node gateway.js > "$DIR/logs/gateway.log" 2>&1 &

# Inicia Túnel Fixo Localtunnel com subdomínio customizado
nohup lt --port 5005 --subdomain studiobot-oficial > "$DIR/logs/localtunnel.log" 2>&1 &

# Inicia Túnel Cloudflare de redundância
nohup cloudflared tunnel --url http://127.0.0.1:5005 > "$DIR/logs/cloudflared.log" 2>&1 &

sleep 4
echo "Todos os serviços e túneis ativos!"
