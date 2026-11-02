FROM python:3.11-slim
WORKDIR /app
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt
COPY . .
ENV PYTHONUNBUFFERED=1
ENV PORT=5005
ENV DB_PATH=/data/studio.db
RUN mkdir -p /data
EXPOSE 5005
CMD ["sh","-c","gunicorn --bind 0.0.0.0:${PORT} --workers 2 --timeout 120 app:app"]
