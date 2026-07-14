# ─── Build stage ────────────────────────────────────────────────────────────
FROM node:20-slim AS build

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci

COPY tsconfig.json tsconfig.build.json ./
COPY src ./src
RUN npm run build

# ─── Runtime stage ──────────────────────────────────────────────────────────
# Separate stage so the final image doesn't carry devDependencies, source
# maps for dev tooling, or the TypeScript compiler itself.
FROM node:20-slim AS runtime

WORKDIR /app
ENV NODE_ENV=production

COPY package.json package-lock.json ./
RUN npm ci --omit=dev

COPY --from=build /app/dist ./dist

EXPOSE 3000

# Fastify listens on HOST/PORT env vars (see src/index.ts) — override at
# `docker run -e PORT=... -e HOST=...` or in your platform's env config.
CMD ["node", "dist/index.js"]
