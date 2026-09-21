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
COPY --from=builder --chown=node:node /app/drizzle/0013_manual_receipt_deletion.sql ./drizzle/0013_manual_receipt_deletion.sql
COPY --from=builder --chown=node:node /app/lib/server/file-deletion.ts ./lib/server/file-deletion.ts
COPY --from=builder --chown=node:node /app/lib/server/report-file-expiry.ts ./lib/server/report-file-expiry.ts
COPY --from=builder --chown=node:node /app/lib/server/receipt-payment-sync.ts ./lib/server/receipt-payment-sync.ts
COPY --from=builder --chown=node:node /app/lib/server/receipt-auto-payment.ts ./lib/server/receipt-auto-payment.ts
COPY --from=builder --chown=node:node /app/lib/server/receipt-evidence-safety.ts ./lib/server/receipt-evidence-safety.ts
COPY --from=builder --chown=node:node /app/lib/server/sale-received-totals.ts ./lib/server/sale-received-totals.ts
COPY --from=builder --chown=node:node /app/lib/server/sale-status-sql.ts ./lib/server/sale-status-sql.ts
COPY --from=builder --chown=node:node /app/lib/receipt-document.ts /app/lib/receipt-amount.ts /app/lib/money.ts /app/lib/receipt-reconciliation.ts ./lib/
COPY --from=builder --chown=node:node /app/lib/receipt-review-reasons.ts /app/lib/receipt-income.ts /app/lib/sale-display-status.ts /app/lib/order-status-names.ts ./lib/
COPY --from=builder --chown=node:node /app/lib/permissions.ts ./lib/permissions.ts
COPY --from=builder --chown=node:node /app/drizzle/0014_receipt_payment_sync.sql ./drizzle/0014_receipt_payment_sync.sql
COPY --from=builder --chown=node:node /app/drizzle/0015_receipt_identified_payments.sql ./drizzle/0015_receipt_identified_payments.sql
COPY --from=builder --chown=node:node /app/drizzle/0016_automatic_receipt_recovery.sql ./drizzle/0016_automatic_receipt_recovery.sql
COPY --from=builder --chown=node:node /app/drizzle/0017_public_report_links.sql ./drizzle/0017_public_report_links.sql
USER node
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=30s CMD node -e "fetch('http://127.0.0.1:3000/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "server.js"]
