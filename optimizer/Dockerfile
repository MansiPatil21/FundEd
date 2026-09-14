FROM python:3.12-slim

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1

WORKDIR /app

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY app ./app

RUN useradd --create-home --uid 10001 optimizer
USER optimizer

# Hosting platforms such as Render assign the port through $PORT; 5000 is the local default.
EXPOSE 5000
HEALTHCHECK --interval=15s --timeout=3s --retries=5 \
  CMD python -c "import os, urllib.request; urllib.request.urlopen('http://127.0.0.1:%s/health' % os.environ.get('PORT', '5000'), timeout=2)"

# Shell form so $PORT expands; exec so uvicorn is PID 1 and receives the platform's SIGTERM.
CMD ["sh", "-c", "exec uvicorn app.main:app --host 0.0.0.0 --port ${PORT:-5000}"]
