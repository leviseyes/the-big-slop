FROM node:24-bookworm-slim
RUN apt-get update && apt-get install -y --no-install-recommends ca-certificates libatomic1 && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --no-fund --no-audit
COPY . .
RUN npm run build && mkdir -p .wrangler && chown -R node:node /app
USER node
ENV HOST=0.0.0.0 PORT=5173 WRANGLER_SEND_METRICS=false CLOUDFLARE_CF_FETCH_ENABLED=false
EXPOSE 5173
CMD ["npm", "start"]
