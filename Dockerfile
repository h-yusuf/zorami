# syntax=docker/dockerfile:1

# Stage 1: build frontend dashboard (React + Vite + Tailwind) jadi static assets.
FROM node:20-slim AS frontend-build
WORKDIR /app
COPY frontend/ frontend/
RUN cd frontend && npm ci && npm run build

FROM python:3.11-slim

# libopus0: runtime library dibutuhkan opuslib (STT/TTS audio codec).
# libpq5: runtime library dibutuhkan asyncpg/psycopg2 buat konek Postgres.
RUN apt-get update && apt-get install -y --no-install-recommends \
    libopus0 \
    libpq5 \
    && rm -rf /var/lib/apt/lists/*

COPY --from=ghcr.io/astral-sh/uv:latest /uv /uvx /usr/local/bin/

WORKDIR /app

# Copy manifest dulu biar layer cache install dependency gak invalidate tiap ganti kode.
COPY pyproject.toml uv.lock ./
RUN uv sync --frozen --no-install-project --no-dev

COPY app/ app/
COPY alembic/ alembic/
COPY alembic.ini ./
COPY --from=frontend-build /app/frontend/dist frontend/dist

RUN uv sync --frozen --no-dev

ENV PATH="/app/.venv/bin:$PATH"

EXPOSE 8000

# Panggil uvicorn langsung dari venv, BUKAN lewat "uv run" - uv run melakukan
# project-sync check tiap start (termasuk group dev, walau image di-build
# dengan --no-dev), yang berarti kontainer nyoba download pytest dkk dari
# internet tiap kali start dan bisa nyangkut/lambat kalau jaringannya dibatasi.
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]
