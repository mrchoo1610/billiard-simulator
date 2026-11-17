# MimePool: one container serves the web app and the /ws relay.
FROM node:22-alpine

ENV NODE_ENV=production \
    HOST=0.0.0.0 \
    PORT=28787

WORKDIR /app

# dependencies first, so this layer is reused when only source files change
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force

# only what the server serves or runs (no tests, docs, scripts)
COPY index.html sw.js ./
COPY assets ./assets
COPY src ./src
COPY server ./server

USER node
EXPOSE 28787

HEALTHCHECK --interval=30s --timeout=5s --start-period=5s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||28787)+'/healthz').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "server/index.mjs"]
