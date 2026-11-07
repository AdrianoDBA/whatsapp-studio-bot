#!/usr/bin/env bash
set -e

DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"
cd "$DIR"
mkdir -p "$DIR/logs"

echo ""
echo "=========================================================="
echo "   🚀 INICIANDO ATENDEAI — SAAS COM WHATSAPP & IA"
echo "=========================================================="
echo ""

# 1. Garante que .env.local existe com as credenciais locais do Supabase
if [ ! -f "$DIR/.env.local" ]; then
  echo "⚙️ Configurando .env.local com Supabase local..."
  cat << 'EOF' > "$DIR/.env.local"
SUPABASE_URL=http://127.0.0.1:44321
SUPABASE_ANON_KEY=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6ImFub24iLCJleHAiOjE5ODM4MTI5OTZ9.CRXP1A7WOeoJeXxjNni43kdQwgnWNReilDMblYTn_I0
DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:44322/postgres
ENCRYPTION_KEY=D41FrgAsSo6/jC3Ow47Fa9KT/UgRDMeKaEzKhpN5ft0=
WHATSAPP_GATEWAY_URL=http://127.0.0.1:5006
EOF
fi

# 2. Confere se o Supabase local está ativo
if ! npx supabase status >/dev/null 2>&1; then
  echo "🐘 Iniciando banco de dados e autenticação local (Supabase)..."
  npx supabase start >/dev/null 2>&1 || true
fi

# 3. Limpa processos antigos nas portas 3000 e 5006
echo "🧹 [1/3] Liberando portas 3000 (Web App) e 5006 (WhatsApp Gateway)..."
lsof -ti :3000 -ti :5006 | xargs kill -9 2>/dev/null || true
pkill -f "node.*gateway.js" 2>/dev/null || true
sleep 1

# 3. Inicia Gateway do WhatsApp na porta 5006
echo "📱 [2/3] Iniciando Gateway do WhatsApp (Baileys na porta 5006)..."
nohup node "$DIR/whatsapp-gateway/gateway.js" </dev/null > "$DIR/logs/gateway.log" 2>&1 &
GATEWAY_PID=$!
disown -h $GATEWAY_PID 2>/dev/null || disown $GATEWAY_PID 2>/dev/null || true

# 4. Aguarda o gateway subir
sleep 2
if curl -s http://127.0.0.1:5006/status > /dev/null 2>&1; then
  echo "✅ WhatsApp Gateway ONLINE (porta 5006)"
else
  echo "⚠️ WhatsApp Gateway iniciando em segundo plano..."
fi

# 5. Abre o navegador automaticamente
(
  sleep 4
  if command -v open >/dev/null 2>&1; then
    open "http://localhost:3000"
  elif command -v xdg-open >/dev/null 2>&1; then
    xdg-open "http://localhost:3000"
  fi
) &

echo "🌐 [3/3] Iniciando o Servidor Web Next.js (porta 3000)..."
echo ""
echo "=========================================================="
echo "  TUDO PRONTO! O NAVEGADOR VAI ABRIR AUTOMATICAMENTE:"
echo "  👉 Link do App: http://localhost:3000"
echo "  👉 Para Conectar WhatsApp: Menu lateral > WhatsApp & Celular"
echo "  👉 Para encerrar: Pressione Ctrl+C ou execute ./parar.sh"
echo "=========================================================="
echo ""

exec npm run dev
