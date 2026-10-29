# syntax=docker/dockerfile:1.7
ARG NODE_IMAGE=node:22.22.0-bookworm-slim
# Imagem única: API + painel (estático) + pixel.js. O worker usa a mesma imagem
# com outro comando (node dist/worker.js) — ver docs/DEPLOY.md.

FROM ${NODE_IMAGE} AS build
WORKDIR /src
RUN corepack enable && corepack prepare pnpm@11.24.0 --activate
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json tsconfig.base.json ./
COPY apps/server/package.json apps/server/
COPY apps/web/package.json apps/web/
COPY packages/domain/package.json packages/domain/
COPY packages/gateways/package.json packages/gateways/
COPY packages/db/package.json packages/db/
COPY packages/pixel/package.json packages/pixel/
RUN pnpm install --frozen-lockfile
COPY . .
RUN pnpm build

# apps/server/dist é autossuficiente (dependências, painel, pixel e migrações embutidos)
FROM ${NODE_IMAGE}
ENV NODE_ENV=production \
    PORT=8080
WORKDIR /app
COPY --from=build --chown=node:node /src/apps/server/dist ./dist
USER node
EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=5s CMD node -e "fetch('http://127.0.0.1:'+process.env.PORT+'/healthz').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "dist/server.js"]
