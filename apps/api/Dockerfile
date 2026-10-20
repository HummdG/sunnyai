# The Sunny API image, for Cloud Run.
#
#   docker build -f apps/api/Dockerfile -t sunny-api .     # from the repo root
#   docker run -p 8080:8080 -e NODE_ENV=development sunny-api
#
# Two stages. The first compiles the API and the workspace packages it uses to
# JavaScript (scripts/build-api.mjs, which explains why it compiles file by
# file rather than bundling) and installs their production dependencies from
# the lockfile. The second is a slim runtime with that tree and nothing else:
# no dev tooling, no TypeScript runner, no other app.

FROM node:24-bookworm AS build


# The compiler, on its own: installing the whole workspace (Next, Playwright,
# Firebase tools...) to compile one service would be most of the build time.
WORKDIR /tools
RUN npm install --no-audit --no-fund --no-save esbuild@0.28.2

WORKDIR /src
COPY . .
RUN ln -s /tools/node_modules node_modules && node scripts/build-api.mjs

WORKDIR /src/dist/api
RUN npm install --omit=dev --no-audit --no-fund && npm cache clean --force

FROM node:24-bookworm-slim

# Cloud Run sends traffic to $PORT on any interface; the API's own default is
# loopback, which is right on a laptop and unreachable in a container.
ENV NODE_ENV=production \
    HOST=0.0.0.0 \
    PORT=8080

WORKDIR /app
# Owned by the unprivileged user it runs as, so the file store (development and
# tests only; production uses Firestore) can create its folder.
RUN chown node:node /app
COPY --from=build --chown=node:node /src/dist/api /app
USER node
EXPOSE 8080

# Production refuses to boot without a session secret, allowed origins and an
# explicit store (apps/api/src/config.ts): infrastructure/terraform sets them.
CMD ["node", "--enable-source-maps", "apps/api/src/main.js"]
