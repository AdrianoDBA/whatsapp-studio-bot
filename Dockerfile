FROM node:20-slim AS node_base
FROM python:3.11-slim

# Instala Node.js a partir da imagem oficial do Node
COPY --from=node_base /usr/local/bin/node /usr/local/bin/node
COPY --from=node_base /usr/local/include/node /usr/local/include/node
COPY --from=node_base /usr/local/lib/node_modules /usr/local/lib/node_modules
RUN ln -s /usr/local/lib/node_modules/npm/bin/npm-cli.js /usr/local/bin/npm

WORKDIR /app

# Instala dependências Python
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Instala dependências do WhatsApp Gateway (Baileys)
COPY whatsapp-gateway/package*.json ./whatsapp-gateway/
RUN cd whatsapp-gateway && npm install --production

# Copia código completo do projeto
COPY . .

RUN chmod +x /app/start.sh

ENV PYTHONUNBUFFERED=1
ENV PORT=5005
ENV GATEWAY_PORT=5006
ENV DB_PATH=/data/studio.db
ENV AUTH_DIR=/data/auth_session
RUN mkdir -p /data

EXPOSE 5005

CMD ["/app/start.sh"]
