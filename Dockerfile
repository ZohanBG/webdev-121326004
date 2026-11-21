# LabSpot in one image. There is no build step and no dependency to compile (express, pg and bcryptjs are
# plain JavaScript), so one stage on the slim Node 22 image is enough.
FROM node:22-slim

# Secure session cookies and the production start-up checks (src/config.js); Render does not need to set it.
ENV NODE_ENV=production
WORKDIR /app

# Copied first, so this layer stays cached while only the code changes.
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force

# Only what the app runs. Nothing else from the folder can get in, so neither can .env.
COPY src ./src
COPY public ./public
COPY scripts ./scripts
COPY migrations ./migrations

# The unprivileged user of the official image; the app never writes to disk.
USER node

# Documentation only: the server listens on PORT (Render sets it), 3000 when it is not set.
EXPOSE 3000

# No curl in the slim image: Node's own fetch asks /health (200 when the database answers).
HEALTHCHECK --interval=30s --timeout=8s --start-period=30s --retries=3 \
  CMD ["node", "-e", "fetch('http://127.0.0.1:' + (process.env.PORT || 3000) + '/health').then((r) => process.exit(r.ok ? 0 : 1), () => process.exit(1))"]

# Pending migrations first, against the DATABASE_URL in the environment; the server starts only if they
# succeed. exec makes node PID 1, so it receives SIGTERM (src/server.js closes cleanly on it).
CMD ["sh", "-c", "node scripts/migrate.js && exec node src/server.js"]
