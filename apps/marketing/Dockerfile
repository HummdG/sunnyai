# The Sunny website and installer dashboard (one Next.js app), for Cloud Run.
#
#   docker build -f apps/marketing/Dockerfile -t sunny-web \
#     --build-arg NEXT_PUBLIC_SUNNY_API_URL=https://api.example \
#     --build-arg NEXT_PUBLIC_SITE_URL=https://www.example \
#     --build-arg NEXT_PUBLIC_FIREBASE_API_KEY=... \
#     --build-arg NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN=... \
#     --build-arg NEXT_PUBLIC_FIREBASE_PROJECT_ID=... .
#   docker run -p 8080:8080 -e SUNNY_API_URL=https://api.example sunny-web
#
# `NEXT_PUBLIC_*` values are compiled into the pages the browser downloads, so
# they are build arguments, fixed per environment. They are public by design:
# a Firebase web config and an API URL are what a browser has to be told.
# `SUNNY_API_URL` is read by the server at run time and can differ (an internal
# address, say), so it is an environment variable instead.
#
# The website was meant for Firebase App Hosting (ADR-002), which documents no
# support for the Next 16 this app uses, so it runs as its own Cloud Run
# service beside the API (D-37; infrastructure/terraform/web.tf).

FROM node:24-bookworm AS build


WORKDIR /src
COPY . .
RUN npm ci --no-audit --no-fund

ARG NEXT_PUBLIC_SUNNY_API_URL
# The site's own address, for share links and canonical URLs. Unset means
# production (heysunny.co.uk); any other value also keeps search engines out.
ARG NEXT_PUBLIC_SITE_URL
ARG NEXT_PUBLIC_SUNNY_WIDGET_ID
ARG NEXT_PUBLIC_FIREBASE_API_KEY
ARG NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN
ARG NEXT_PUBLIC_FIREBASE_PROJECT_ID
ENV NEXT_TELEMETRY_DISABLED=1 \
    SUNNY_NEXT_OUTPUT=standalone

# The site serves the real widget from its own origin, so it is built first.
RUN npm run build:widget && npm run build:marketing

# The standalone server does not copy static assets; it serves them if they
# are placed beside it (see Next's `output` docs).
RUN cp -r apps/marketing/public apps/marketing/.next/standalone/apps/marketing/ \
 && cp -r apps/marketing/.next/static apps/marketing/.next/standalone/apps/marketing/.next/

FROM node:24-bookworm-slim

ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    HOSTNAME=0.0.0.0 \
    PORT=8080

WORKDIR /app
COPY --from=build --chown=node:node /src/apps/marketing/.next/standalone /app
USER node
EXPOSE 8080
CMD ["node", "apps/marketing/server.js"]
