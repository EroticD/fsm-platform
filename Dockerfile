# syntax=docker/dockerfile:1

# Må holdes i sync med `prisma` i package.json. CLI-en installeres i et eget
# steg fordi den har toppnivåavhengigheter (effect, c12, ...) som ikke følger
# med @prisma-mappen.
ARG PRISMA_VERSION=7.10.1

# ---------------------------------------------------------------------------
# base – felles utgangspunkt. Debian (glibc) brukes fordi Prismas query-engine
# er kompilert mot OpenSSL 3.0, som er det som finnes i Debian bookworm.
# ---------------------------------------------------------------------------
FROM node:22-bookworm-slim AS base
ENV NEXT_TELEMETRY_DISABLED=1
# Node-imaget kan være bygget med eldre Debian-pakker enn det som ligger i
# security-repoet. Oppgrader først, slik at f.eks. libssl3 får sikkerhetsfikser
# før Trivy skanner det ferdige imaget.
RUN apt-get update \
 && apt-get upgrade -y \
 && apt-get install -y --no-install-recommends openssl ca-certificates tzdata \
 && rm -rf /var/lib/apt/lists/*
# Node 22-imaget leveres med en eldre npm som har kjente HIGH-sårbarheter.
# Oppdater npm eksplisitt, slik at container-skanningen ikke feiler på den.
RUN npm install -g npm@12.2.1 \
 && cd /tmp \
 && npm pack undici@6.29.1 >/dev/null \
 && tar -xzf undici-6.29.1.tgz \
 && rm -rf /usr/local/lib/node_modules/npm/node_modules/undici \
 && mv package /usr/local/lib/node_modules/npm/node_modules/undici \
 && rm -f undici-6.29.1.tgz \
 && npm cache clean --force
WORKDIR /app

# ---------------------------------------------------------------------------
# deps – installerer alle avhengigheter (også utvikleravhengigheter, siden
# Prisma-CLI-en trengs ved oppstart for å kjøre migrasjoner).
# ---------------------------------------------------------------------------
FROM base AS deps
COPY package.json package-lock.json prisma.config.mjs ./
COPY prisma ./prisma
RUN --mount=type=cache,target=/root/.npm \
    npm ci

# ---------------------------------------------------------------------------
# prisma-cli – et minimalt node_modules med Prisma-CLI-en og alle dens
# toppnivåavhengigheter. Appens egne avhengigheter kommer fra standalone-treet.
# ---------------------------------------------------------------------------
FROM base AS prisma-cli
ARG PRISMA_VERSION
# npm 12 blokkerer install-skript som standard. Kjør Prisma sin
# engine-postinstall eksplisitt, ellers mangler schema-engine i imaget.
RUN --mount=type=cache,target=/root/.npm \
    mkdir -p /cli \
 && cd /cli \
 && npm init -y >/dev/null \
 && npm install --omit=dev --no-audit --no-fund "prisma@${PRISMA_VERSION}" \
 && node node_modules/@prisma/engines/scripts/postinstall.js

# ---------------------------------------------------------------------------
# tessdata – henter OCR-språkdata i et eget steg. Da slipper det ferdige
# imaget curl og annet som bare trengs under bygging.
# ---------------------------------------------------------------------------
FROM debian:bookworm-slim AS tessdata
RUN apt-get update \
 && apt-get install -y --no-install-recommends ca-certificates curl \
 && rm -rf /var/lib/apt/lists/*
RUN mkdir -p /tessdata \
 && curl -fsSL -o /tmp/nor.traineddata.gz https://cdn.jsdelivr.net/npm/@tesseract.js-data/nor/4.0.0_best_int/nor.traineddata.gz \
 && curl -fsSL -o /tmp/eng.traineddata.gz https://cdn.jsdelivr.net/npm/@tesseract.js-data/eng/4.0.0_best_int/eng.traineddata.gz \
 && gunzip -f /tmp/nor.traineddata.gz /tmp/eng.traineddata.gz \
 && mv /tmp/nor.traineddata /tmp/eng.traineddata /tessdata/

# ---------------------------------------------------------------------------
# builder – genererer Prisma-klienten og bygger Next.js-appen.
# ---------------------------------------------------------------------------
FROM base AS builder
ENV NODE_ENV=production
COPY --from=deps /app/node_modules ./node_modules
COPY . .
# Kalles via sin virkelige sti, ikke .bin-symbolet, se kommentaren i runner-steget.
RUN node ./node_modules/prisma/build/index.js generate
RUN npm run build

# ---------------------------------------------------------------------------
# runner – det ferdige imaget. Inneholder bare det som trengs i drift.
# ---------------------------------------------------------------------------
FROM base AS runner
ENV NODE_ENV=production
# Deterministisk tidssone for logger og datoformatering. Kalenderdatoer lagres
# som date i databasen, så dette påvirker ikke selve datoverdiene.
ENV TZ=Europe/Oslo
ENV PORT=3000
# Next.js sin standalone-server lytter på dette vertsnavnet i containeren.
ENV HOSTNAME=0.0.0.0
# Opplastede bilder og vedlegg havner her, og mappen monteres som et volum.
ENV UPLOAD_DIR=/app/uploads
# OCR-språkdata legges inn på forhånd, slik at OCR ikke trenger nettverkstilgang
# når appen kjører. Koden leser TESSDATA_DIR (se src/lib/pdf-text.ts).
ENV TESSDATA_DIR=/app/tessdata

# Metadata som brukes av GitHub Container Registry og andre registere.
ARG BUILD_VERSION=dev
ARG BUILD_REVISION=unknown
LABEL org.opencontainers.image.title="FSM-plattformen" \
      org.opencontainers.image.description="Service- og vedlikeholdssystem (FSM) med oppdrag, kalender, servicerapporter og PDF." \
      org.opencontainers.image.version="${BUILD_VERSION}" \
      org.opencontainers.image.revision="${BUILD_REVISION}" \
      org.opencontainers.image.licenses="BUSL-1.1"

# Kjør som en vanlig bruker, ikke root.
RUN groupadd --system --gid 1001 nodejs \
 && useradd --system --uid 1001 --gid nodejs nextjs

# poppler-utils gir pdftotext/pdftoppm, som tekstuttrekk og OCR bygger på.
RUN apt-get update \
 && apt-get install -y --no-install-recommends poppler-utils \
 && rm -rf /var/lib/apt/lists/*

COPY --from=tessdata --chown=nextjs:nodejs /tessdata /app/tessdata

# Selve appen: standalone-serveren, statiske filer og public-mappen.
COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static
COPY --from=builder --chown=nextjs:nodejs /app/public ./public

# Prisma-skjema, konfigurasjon, seed-skript og CLI – trengs for
# `prisma migrate deploy` og `node scripts/seed.mjs` ved oppstart.
COPY --from=builder --chown=nextjs:nodejs /app/prisma ./prisma
COPY --from=builder --chown=nextjs:nodejs /app/prisma.config.mjs ./prisma.config.mjs
COPY --from=builder --chown=nextjs:nodejs /app/scripts ./scripts
# CLI-en kalles via sin egen fil (node_modules/prisma/build/index.js) fordi den
# finner hjelpefilene sine relativt til sin egen mappe. Symbolet i .bin blir en
# vanlig fil når den kopieres mellom byggesteg, og da feiler oppslaget.
COPY --from=prisma-cli --chown=nextjs:nodejs /cli/node_modules ./node_modules

# BSL 1.1 krever at lisensen vises sammen med hver kopi av programvaren.
COPY --chown=nextjs:nodejs LICENSE ./LICENSE

COPY --chown=nextjs:nodejs docker-entrypoint.sh /usr/local/bin/docker-entrypoint.sh
RUN chmod +x /usr/local/bin/docker-entrypoint.sh \
 && mkdir -p /app/uploads \
 && chown -R nextjs:nodejs /app/uploads

USER nextjs
EXPOSE 3000

# Containeren regnes som frisk når appen svarer på liveness-sjekken. Den er
# bevisst uten databasekall, slik at en midlertidig treg database ikke får
# Docker til å restarte en ellers fungerende prosess. Readiness (database,
# disk, kø) sjekkes av orchestratoren på /api/ready.
HEALTHCHECK --interval=30s --timeout=5s --start-period=30s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||3000)+'/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

ENTRYPOINT ["docker-entrypoint.sh"]
CMD ["node", "server.js"]
