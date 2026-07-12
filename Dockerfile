FROM node:22-alpine AS frontend-build

WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY index.html vite.config.js ./
COPY public ./public
COPY src ./src
RUN npm run build

FROM python:3.12-slim AS runtime

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    ZEN_API_HOST=0.0.0.0 \
    ZEN_DB_PATH=/tmp/zen-stock-prophet/simulator.db

WORKDIR /app
COPY requirements-render.txt ./
RUN pip install --no-cache-dir -r requirements-render.txt

COPY backend ./backend
COPY --from=frontend-build /app/dist ./dist
RUN mkdir -p /tmp/zen-stock-prophet && \
    useradd --create-home --uid 10001 appuser && \
    chown -R appuser:appuser /app /tmp/zen-stock-prophet

USER appuser
EXPOSE 10000

CMD ["sh", "-c", "uvicorn backend.server:app --host 0.0.0.0 --port ${PORT:-10000}"]
