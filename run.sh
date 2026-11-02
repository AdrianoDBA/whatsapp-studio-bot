#!/bin/bash
# ========================================================
# Runner Script for Studio Fotográfico WhatsApp Bot (SaaS)
# ========================================================

set -e

DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" >/dev/null 2>&1 && pwd )"
cd "$DIR"

# 1. Setup Python virtual environment
if [ ! -d ".venv" ]; then
    echo "Creating virtual environment..."
    python3 -m venv .venv
    source .venv/bin/activate
    pip install -r requirements.txt
else
    source .venv/bin/activate
fi

# 2. Build frontend if dist does not exist
if [ ! -d "frontend/dist" ]; then
    echo "Building React Vite PWA frontend..."
    cd frontend
    npm install
    npm run build
    cd ..
fi

# 3. Ensure .env exists
if [ ! -f ".env" ]; then
    cp .env.example .env
fi

echo "Starting Studio Fotográfico WhatsApp Bot (SaaS) on port ${PORT:-5005}..."
exec python main.py
