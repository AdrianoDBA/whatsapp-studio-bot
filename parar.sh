#!/usr/bin/env bash

echo "🛑 Encerrando todos os serviços do AtendeAI..."

lsof -ti :3000 -ti :5006 | xargs kill -9 2>/dev/null || true
pkill -f "node.*gateway.js" 2>/dev/null || true
pkill -f "next.*dev" 2>/dev/null || true

echo "✅ Todos os serviços foram desligados com sucesso."
