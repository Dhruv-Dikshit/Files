# syntax=docker/dockerfile:1

# ── dependencies ──────────────────────────────────────────────────────────
FROM node:22-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json .npmrc ./
COPY prisma ./prisma
COPY prisma.config.ts ./
RUN npm ci

# ── build the Next.js standalone server ───────────────────────────────────
FROM deps AS build
COPY . .
ENV NEXT_TELEMETRY_DISABLED=1 STANDALONE=1
RUN npx prisma generate && npm run build

# ── one-shot database migration runner (has the Prisma CLI) ───────────────
FROM deps AS migrate
CMD ["npx", "prisma", "migrate", "deploy"]

# ── runtime image ─────────────────────────────────────────────────────────
FROM node:22-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1 PORT=3000 HOSTNAME=0.0.0.0
RUN addgroup -S evenly && adduser -S evenly -G evenly
COPY --from=build --chown=evenly:evenly /app/.next/standalone ./
COPY --from=build --chown=evenly:evenly /app/.next/static ./.next/static
USER evenly
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s CMD wget -qO- http://127.0.0.1:3000/welcome >/dev/null || exit 1
CMD ["node", "server.js"]
