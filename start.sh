#!/bin/bash
set -e

echo "[STARTUP] Criando diretório de persistência /data se não existir..."
mkdir -p /data/auth_session

# Se existir banco pré-configurado no container e não em /data, copia para inicializar
if [ -f "/app/studio.db" ] && [ ! -f "/data/studio.db" ]; then
    echo "[STARTUP] Inicializando /data/studio.db a partir do template do app..."
    cp /app/studio.db /data/studio.db
fi

# Se houver sessão whatsapp salva em /app/whatsapp-gateway/auth_session e não em /data, migra
if [ -d "/app/whatsapp-gateway/auth_session" ] && [ ! -f "/data/auth_session/creds.json" ]; then
    echo "[STARTUP] Migrando credenciais existentes do WhatsApp para /data/auth_session..."
    cp -r /app/whatsapp-gateway/auth_session/* /data/auth_session/ 2>/dev/null || true
fi

echo "[STARTUP] Iniciando WhatsApp Baileys Gateway na porta 5006..."
cd /app/whatsapp-gateway
node gateway.js &

echo "[STARTUP] Iniciando Gunicorn na porta ${PORT:-5005}..."
cd /app
exec gunicorn --bind 0.0.0.0:${PORT:-5005} --workers 1 --threads 4 --timeout 120 app:app
