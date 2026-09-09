'use client';

import { FileText, Pencil, XCircle, Paperclip } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog';
import { SaleStatusBadge } from '@/components/pdv/sale-status-badge';
import { OrderStatusBadge } from '@/components/pdv/order-status-badge';
import type { SaleRecord } from '@/lib/pdv-types';
import { saleIssues } from '@/lib/sale-display-status';

const money = (cents: number) =>
  new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(
    cents / 100,
  );
const date = (millis: number) =>
  new Intl.DateTimeFormat('pt-BR', {
    timeZone: 'America/Sao_Paulo',
    dateStyle: 'short',
    timeStyle: 'short',
  }).format(millis);

export function SaleDetailsDialog({
  sale,
  onClose,
  onReport,
  onEdit,
  onCancel,
  canEdit,
  canCancel,
}: {
  sale: SaleRecord | null;
  onClose: () => void;
  onReport: (sale: SaleRecord) => void;
  onEdit: (sale: SaleRecord) => void;
  onCancel: (sale: SaleRecord) => void;
  canEdit: boolean;
  canCancel: boolean;
}) {
  return (
    <Dialog
      open={Boolean(sale)}
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <DialogContent className="flex h-dvh max-h-dvh max-w-none flex-col gap-0 rounded-none p-0 pt-[env(safe-area-inset-top)] pb-[env(safe-area-inset-bottom)] [&>[data-slot=dialog-close]]:top-[max(.5rem,env(safe-area-inset-top))] sm:h-[90dvh] sm:max-w-2xl sm:rounded-2xl sm:py-0">
        {sale && (
          <>
            <DialogHeader className="shrink-0 border-b px-4 py-3 pr-12">
              <DialogTitle>
                Detalhes da venda #{String(sale.number).padStart(5, '0')}
              </DialogTitle>
              <DialogDescription>
                {date(sale.createdAt)} · {sale.sellerName}
              </DialogDescription>
            </DialogHeader>
            <div className="min-h-0 flex-1 space-y-4 overflow-y-auto p-4 overscroll-contain">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <h2 className="text-lg font-bold">{sale.customerName}</h2>
                <SaleStatusBadge sale={sale} />
              </div>
              {saleIssues(sale).length > 1 && (
                <p className="text-sm text-muted-foreground">
                  Outras pendências:{' '}
                  {saleIssues(sale)
                    .slice(1)
                    .map((issue) => issue.label)
                    .join(' · ')}
                </p>
              )}
              <dl className="grid grid-cols-2 gap-3 rounded-xl bg-muted/50 p-3">
                <div>
                  <dt className="text-sm text-muted-foreground">
                    Valor da venda
                  </dt>
                  <dd className="font-bold tabular-nums">
                    {money(sale.productsTotalCents)}
                  </dd>
                </div>
                <div>
                  <dt className="text-sm text-muted-foreground">
                    Total pago informado
                  </dt>
                  <dd className="font-bold tabular-nums">
                    {money(sale.receivedTotalCents)}
                  </dd>
                </div>
                {sale.status !== 'cancelled' &&
                  sale.receivedDifferenceCents !== 0 && (
                    <div className="col-span-2 text-sm font-semibold text-amber-800 dark:text-amber-200">
                      {sale.receivedDifferenceCents < 0
                        ? 'Falta receber'
                        : 'Pago a mais'}{' '}
                      {money(Math.abs(sale.receivedDifferenceCents))}
                    </div>
                  )}
              </dl>
              {sale.status === 'cancelled' ? (
                <p className="rounded-xl bg-muted p-3 text-sm">
                  Cancelada{' '}
                  {sale.cancelledAt ? `em ${date(sale.cancelledAt)}` : ''}
                  {sale.cancelledByName ? ` por ${sale.cancelledByName}` : ''}.
                  <br />
                  Motivo: {sale.cancellationReason || 'Não informado'}
                </p>
              ) : (
                sale.orderStatus && (
                  <div className="flex items-center gap-2 text-sm">
                    <span>Acompanhamento da loja:</span>
                    <OrderStatusBadge status={sale.orderStatus} />
                  </div>
                )
              )}
              <section>
                <h3 className="mb-2 font-bold">
                  Produtos · {sale.items.length} aparelho(s)
                </h3>
                <div className="divide-y rounded-xl border">
                  {sale.items.map((item) => (
                    <div key={item.id} className="space-y-1 p-3">
                      <div className="flex justify-between gap-3">
                        <strong>{item.productName}</strong>
                        <span className="shrink-0 text-sm font-bold">
                          {money(item.soldPriceCents)}
                        </span>
                      </div>
                      <p className="text-sm text-muted-foreground">
                        {item.productDetail}
                      </p>
                      <p className="text-sm">
                        SN <code className="font-semibold">{item.serial}</code>
                      </p>
                      {item.photos.length > 0 && (
                        <div className="flex flex-wrap gap-2 pt-1">
                          {item.photos.map((photo, i) => (
                            <a
                              key={photo.id}
                              href={photo.url}
                              target="_blank"
                              rel="noreferrer"
                              className="inline-flex min-h-10 items-center gap-1 rounded-lg border px-2 text-sm font-semibold text-primary"
                            >
                              <Paperclip className="size-4" />
                              Foto {i + 1}
                            </a>
                          ))}
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              </section>
              <section>
                <h3 className="mb-2 font-bold">Pagamentos informados</h3>
                <div className="divide-y rounded-xl border">
                  {sale.payments.length ? (
                    sale.payments.map((payment, i) => (
                      <div
                        key={i}
                        className="flex justify-between gap-3 p-3 text-sm"
                      >
                        <span>
                          {payment.method === 'pix'
                            ? `Pix${payment.accountName ? ` · ${payment.accountName}` : ''}`
                            : 'Dinheiro'}
                        </span>
                        <strong className="shrink-0">
                          {money(payment.amountCents)}
                        </strong>
                      </div>
                    ))
                  ) : (
                    <p className="p-3 text-sm text-muted-foreground">
                      Nenhum pagamento informado.
                    </p>
                  )}
                </div>
              </section>
              <section>
                <h3 className="mb-2 font-bold">
                  Comprovantes · {sale.receipts.length}
                </h3>
                <div className="divide-y rounded-xl border">
                  {sale.receipts.map((receipt, i) => (
                    <a
                      key={receipt.id}
                      href={receipt.url}
                      target="_blank"
                      rel="noreferrer"
                      className="flex min-h-12 items-center justify-between gap-2 p-3 text-sm hover:bg-muted/50"
                    >
                      <span className="min-w-0 truncate text-primary">
                        <Paperclip className="mr-1 inline size-4" />
                        {receipt.name || `Comprovante ${i + 1}`}
                      </span>
                      <strong className="shrink-0">
                        {receipt.receiptAmountCents === null
                          ? 'A conferir'
                          : money(receipt.receiptAmountCents)}
                      </strong>
                    </a>
                  ))}
                  {!sale.receipts.length && (
                    <p className="p-3 text-sm text-muted-foreground">
                      Sem comprovante anexado.
                    </p>
                  )}
                </div>
                <p className="mt-2 text-sm text-muted-foreground">
                  Total dos comprovantes:{' '}
                  <strong>
                    {money(sale.reconciliation.confirmedTotalCents)}
                  </strong>
                  .{' '}
                  {sale.reconciliation.pendingReceiptCount > 0
                    ? 'Há valores pendentes de leitura ou conferência.'
                    : sale.reconciliation.status === 'divergent'
                      ? `Diferença em relação à venda: ${money(sale.reconciliation.differenceCents ?? 0)}.`
                      : ''}
                </p>
                <p className="mt-1 text-xs text-muted-foreground">
                  Conciliação compara documentos com o valor da venda; não
                  confirma crédito na conta bancária.
                </p>
              </section>
            </div>
            <div className="flex shrink-0 flex-wrap items-center justify-end gap-2 border-t bg-background p-3">
              {canCancel && sale.status === 'completed' && (
                <Button
                  aria-label="Cancelar esta venda"
                  variant="ghost"
                  className="mr-auto text-destructive"
                  onClick={() => {
                    onClose();
                    onCancel(sale);
                  }}
                >
                  <XCircle />
                  Cancelar venda
                </Button>
              )}
              <Button
                variant="outline"
                onClick={() => {
                  onClose();
                  onReport(sale);
                }}
              >
                <FileText />
                PDF
              </Button>
              {canEdit && sale.status === 'completed' && (
                <Button
                  onClick={() => {
                    onClose();
                    onEdit(sale);
                  }}
                >
                  <Pencil />
                  Editar
                </Button>
              )}
              <Button variant="outline" onClick={onClose}>
                Fechar
              </Button>
            </div>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
