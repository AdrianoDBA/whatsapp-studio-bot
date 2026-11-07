#!/usr/bin/env bash
# Redireciona para o encerramento unificado do AtendeAI
DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"
exec "$DIR/parar.sh"
