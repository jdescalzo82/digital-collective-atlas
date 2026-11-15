FROM python:3.13-slim
WORKDIR /app
COPY . .
RUN useradd --system --uid 10001 atlas && mkdir -p /app/data && chown atlas /app/data
USER atlas
ENV DCA_HOST=0.0.0.0 DCA_PORT=8000 DCA_DB_PATH=/app/data/atlas.db PYTHONUNBUFFERED=1
EXPOSE 8000
HEALTHCHECK --interval=30s --timeout=5s CMD python3 -c "import urllib.request,sys; sys.exit(urllib.request.urlopen('http://127.0.0.1:8000/api/health', timeout=4).status != 200)"
CMD ["python3", "-m", "server"]
