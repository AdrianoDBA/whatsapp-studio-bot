#!/bin/bash
set -e
mkdir -p /data
mkdir -p /data/auth_session
mkdir -p /data/comprovantes

# Se não tem banco no volume, copia o que já tem com 55 slots e 355 msgs
if [ ! -f /data/studio.db ]; then
  echo "Primeiro deploy - copiando studio.db pro volume /data"
  cp -n studio.db /data/studio.db || touch /data/studio.db
fi

# Se tem comprovantes locais, migra
cp -rn static/comprovantes/* /data/comprovantes/ 2>/dev/null || true

# Inicia o Gateway do WhatsApp Baileys na porta 5006 em background
echo "Iniciando WhatsApp Baileys Gateway na porta 5006..."
(cd whatsapp-gateway && node gateway.js) &

echo "Iniciando Gunicorn em 0.0.0.0:$PORT com DB em /data/studio.db"
exec gunicorn --bind 0.0.0.0:${PORT:-5005} --workers 2 --timeout 120 --access-logfile - app:app
