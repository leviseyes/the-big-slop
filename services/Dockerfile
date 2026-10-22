FROM node:24-bookworm-slim
RUN apt-get update && apt-get install -y --no-install-recommends ffmpeg ca-certificates && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY --chown=node:node services/ ./services/
RUN mkdir -p /app/worker-state && chown node:node /app/worker-state
USER node
CMD ["node", "services/worker.mjs"]
