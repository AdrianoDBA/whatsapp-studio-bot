FROM node:20-slim AS base
RUN apt-get update && apt-get install -y python3 python3-pip python3-venv && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY requirements.txt .
RUN pip3 install --no-cache-dir -r requirements.txt --break-system-packages
COPY whatsapp-gateway/package*.json ./whatsapp-gateway/
RUN cd whatsapp-gateway && npm install --production
COPY . .
RUN chmod +x start.sh start_services.sh stop_services.sh
EXPOSE 5005 5006
CMD ["./start.sh"]
