# Website + Verwaltung. Die Minecraft-Server selbst laufen in eigenen Containern,
# die diese Anwendung über den Docker-Socket startet.
FROM node:22-bookworm-slim AS deps
WORKDIR /app
# Build-Werkzeuge, falls für die Datenbank-Bibliothek kein fertiges Binärpaket geladen werden kann.
RUN apt-get update && apt-get install -y --no-install-recommends python3 make g++ ca-certificates \
    && rm -rf /var/lib/apt/lists/*
COPY package.json package-lock.json ./
RUN npm ci

FROM node:22-bookworm-slim AS build
WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN npm run build

FROM node:22-bookworm-slim
WORKDIR /app
ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1 PORT=3000 HOSTNAME=0.0.0.0
COPY --from=build /app/.next/standalone ./
COPY --from=build /app/.next/static ./.next/static
COPY --from=build /app/public ./public
COPY --from=build /app/scripts/make-admin.mjs ./scripts/make-admin.mjs
EXPOSE 3000
CMD ["node", "server.js"]
