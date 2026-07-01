FROM node:22-alpine AS builder
WORKDIR /build

COPY package*.json ./
RUN npm ci --omit=dev --no-audit --no-fund && npm cache clean --force

FROM node:22-alpine AS production
ENV NODE_ENV=production
WORKDIR /app

COPY --from=builder --chown=node:node /build/node_modules ./node_modules
COPY --chown=node:node main.js ./
COPY --chown=node:node public/ ./public/

# Runtime image does not need npm/corepack. Removing them reduces image surface
# and avoids CVEs from toolchain packages not used at runtime.
RUN rm -rf \
  /usr/local/lib/node_modules/npm \
  /usr/local/lib/node_modules/corepack \
  /usr/local/bin/npm \
  /usr/local/bin/npx \
  /usr/local/bin/corepack

USER node

ENV PORT=3000
EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD wget -qO- http://127.0.0.1:3000/api/health > /dev/null 2>&1 || exit 1

CMD ["node", "main.js"]
