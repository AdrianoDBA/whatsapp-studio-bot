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

# Provedor padrão: meta (Cloud API Oficial) ou baileys (QR Code local)
PROVIDER="${USE_PROVIDER:-meta}"
echo "[STARTUP] Modo de Provedor WhatsApp configurado: $PROVIDER"

if [ "$PROVIDER" = "baileys" ]; then
    echo "[STARTUP] USE_PROVIDER=baileys: Iniciando WhatsApp Baileys Gateway na porta 5006..."
    cd /app/whatsapp-gateway
    node gateway.js &
    cd /app
else
    echo "[STARTUP] USE_PROVIDER=meta: Usando WhatsApp Cloud API oficial. Gateway Baileys mantido em repouso (sem geração de QR Code)."
fi

echo "[STARTUP] Iniciando Gunicorn na porta ${PORT:-10000}..."
cd /app
exec gunicorn --bind 0.0.0.0:${PORT:-10000} --workers 1 --threads 4 --timeout 120 app:app
