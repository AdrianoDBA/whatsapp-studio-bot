FROM python:3.11-slim

WORKDIR /app

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY . .

ENV PORT=5005
ENV PYTHONUNBUFFERED=1
ENV TZ=America/Sao_Paulo

RUN mkdir -p /data /app/static/comprovantes /app/static/uploads

ENV DB_PATH=/data/studio.db

EXPOSE 5005

CMD ["sh", "-c", "gunicorn --bind 0.0.0.0:${PORT:-5005} --workers 2 --timeout 120 app:app"]
