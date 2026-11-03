#!/bin/bash
echo "Encerrando serviços locais do WhatsApp Studio Bot..."
lsof -ti :5005 -ti :5006 | xargs kill -9 2>/dev/null || true
pkill -f "node.*gateway.js" 2>/dev/null || true
pkill -f "gunicorn.*app:app" 2>/dev/null || true
echo "Serviços locais encerrados com sucesso."
