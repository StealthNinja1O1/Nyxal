FROM oven/bun:1 AS builder
WORKDIR /app

COPY package.json bun.lock ./
RUN bun install --frozen-lockfile

COPY . .

RUN bun run compile


FROM debian:bookworm-slim AS runtime
WORKDIR /app

# ca-certs for https calls + curl for the docker healthcheck (compose runs
# `curl /api/health` from inside the container to know if nyxal is up).
RUN apt-get update \
 && apt-get install -y --no-install-recommends ca-certificates curl \
 && rm -rf /var/lib/apt/lists/*

COPY --from=builder /app/build/nyxal /app/nyxal

ENV NYXAL_PORT=3000 \
    NYXAL_DB_PATH=/app/data/nyxal.db

EXPOSE 3000
VOLUME /app/data

CMD ["/app/nyxal"]
