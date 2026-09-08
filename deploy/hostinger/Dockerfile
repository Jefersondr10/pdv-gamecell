FROM node:24.20.0-bookworm-slim AS builder
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
RUN npm run build:vps

FROM node:24.20.0-bookworm-slim AS runtime
ENV NODE_ENV=production HOST=0.0.0.0 PORT=3000 PDV_DATA_DIR=/data
WORKDIR /app
COPY --from=builder --chown=node:node /app/dist/standalone ./
COPY --from=builder --chown=node:node /app/lib/server/node ./lib/server/node
COPY --from=builder --chown=node:node /app/scripts/hostinger ./scripts/hostinger
COPY --from=builder --chown=node:node /app/drizzle/0009_durable_receipt_jobs.sql ./drizzle/0009_durable_receipt_jobs.sql
COPY --from=builder --chown=node:node /app/drizzle/0010_backup_alert_destinations.sql ./drizzle/0010_backup_alert_destinations.sql
COPY --from=builder --chown=node:node /app/drizzle/0011_user_function_permissions.sql ./drizzle/0011_user_function_permissions.sql
COPY --from=builder --chown=node:node /app/drizzle/0012_client_name_identity.sql ./drizzle/0012_client_name_identity.sql
USER node
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=30s CMD node -e "fetch('http://127.0.0.1:3000/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "server.js"]
