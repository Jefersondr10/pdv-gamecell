'use client';
import { receiptDrivenPayments } from '@/lib/receipt-income';
import { ReceiptPaymentDetails } from '@/components/pdv/receipt-payment-details';

import { useState } from 'react';
import { FileText, Pencil, XCircle, Paperclip } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog';
import {
  SaleStatusBadge,
  SaleIssuesNotice,
} from '@/components/pdv/sale-status-badge';
import type { SaleRecord } from '@/lib/pdv-types';
import { saleIssues } from '@/lib/sale-display-status';
import { saleFinancialSummary } from '@/lib/sale-financial-summary';
import { receiptTargetLabel } from '@/lib/receipt-reconciliation';
import { SalePricesEditor } from '@/components/pdv/sale-prices-editor';
import type { SalePrices } from '@/lib/sale-prices';

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
  canEditPrices,
  csrfToken,
  onPricesChanged,
  onOpenSerial,
  closeLabel = 'Fechar',
}: {
  sale: SaleRecord | null;
  onClose: (reason?: 'action') => void;
  onReport: (sale: SaleRecord) => void;
  onEdit: (sale: SaleRecord) => void;
  onCancel: (sale: SaleRecord) => void;
  canEdit: boolean;
  canCancel: boolean;
  canEditPrices: boolean;
  csrfToken: string;
  onPricesChanged: (saleId: string, value: SalePrices) => void;
  onOpenSerial: (serial: string) => void;
  closeLabel?: string;
}) {
  const financial = sale ? saleFinancialSummary(sale) : null;
  const showReceiptConference = Boolean(
    sale &&
    sale.status !== 'cancelled' &&
    (sale.receipts.length > 0 || sale.reconciliation.status !== 'not_required'),
  );
  const [pricesBusy, setPricesBusy] = useState(false);
  const [pricesEditing, setPricesEditing] = useState(false);
  const [notice, setNotice] = useState('');
  const locked = pricesBusy || pricesEditing;
  return (
    <Dialog
      open={Boolean(sale)}
      onOpenChange={(open) => {
        if (!open && !locked) onClose();
      }}
    >
      <DialogContent
        showCloseButton={!locked}
        className="flex h-dvh max-h-dvh max-w-none flex-col gap-0 rounded-none p-0 pt-[env(safe-area-inset-top)] pb-[env(safe-area-inset-bottom)] [&>[data-slot=dialog-close]]:top-[max(.5rem,env(safe-area-inset-top))] sm:h-[90dvh] sm:max-w-2xl sm:rounded-2xl sm:py-0"
      >
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
              {notice && (
                <output className="block rounded-xl bg-success/10 p-3 text-sm font-semibold text-success">
                  {notice}
                </output>
              )}
              <div className="flex flex-wrap items-center justify-between gap-2">
                <h2 className="text-lg font-bold">{sale.customerName}</h2>
                <SaleStatusBadge sale={sale} />
              </div>
              <SaleIssuesNotice
                issueKeys={saleIssues(sale).map((issue) => issue.key)}
              />
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
                    Total recebido
                  </dt>
                  <dd className="font-bold tabular-nums text-success">
                    {money(sale.receivedTotalCents)}
                  </dd>
                  {sale.status !== 'cancelled' &&
                    sale.receivedDifferenceCents !== 0 && (
                      <dd
                        className={`mt-1 text-sm font-semibold tabular-nums ${sale.receivedDifferenceCents < 0 ? 'text-destructive' : 'text-amber-800 dark:text-amber-200'}`}
                      >
                        {sale.receivedDifferenceCents < 0
                          ? 'Falta receber'
                          : 'Pago a mais'}{' '}
                        {money(Math.abs(sale.receivedDifferenceCents))}
                      </dd>
                    )}
                </div>
              </dl>
              {sale.status !== 'cancelled' && financial?.receiptText && (
                <p
                  className={`rounded-xl border p-3 text-sm tabular-nums ${
                    financial.receiptWarning
                      ? 'border-amber-300/60 bg-amber-50/50 font-semibold text-amber-800 dark:bg-amber-950/20 dark:text-amber-200'
                      : 'text-muted-foreground'
                  }`}
                >
                  {financial.receiptText}
                </p>
              )}
              {sale.status === 'cancelled' ? (
                <p className="rounded-xl bg-muted p-3 text-sm">
                  Cancelada{' '}
                  {sale.cancelledAt ? `em ${date(sale.cancelledAt)}` : ''}
                  {sale.cancelledByName ? ` por ${sale.cancelledByName}` : ''}
                  .
                  <br />
                  Motivo: {sale.cancellationReason || 'Não informado'}
                </p>
              ) : null}
              <SalePricesEditor
                sale={sale}
                csrfToken={csrfToken}
                title={`Produtos · ${sale.items.length} aparelho(s)`}
                editable={canEditPrices && sale.status === 'completed'}
                disabled={pricesBusy}
                onBusyChange={setPricesBusy}
                onEditingChange={setPricesEditing}
                onSaved={(value) => {
                  onPricesChanged(sale.id, value);
                  setNotice(
                    'Preços salvos. Total, pagamentos, comprovantes e status conferidos novamente.',
                  );
                }}
              >
                <div className="grid grid-cols-[repeat(auto-fit,minmax(min(100%,16rem),1fr))] gap-2">
                  {sale.items.map((item) => (
                    <div
                      key={item.id}
                      className="min-w-0 space-y-1 rounded-xl border p-3"
                    >
                      <div className="flex flex-wrap justify-between gap-x-2 gap-y-1">
                        <strong className="min-w-0 break-words">
                          {item.productName}
                        </strong>
                        <span className="shrink-0 text-sm font-bold">
                          {money(item.soldPriceCents)}
                        </span>
                      </div>
                      <p className="text-sm text-muted-foreground">
                        {item.productDetail}
                      </p>
                      <button
                        aria-label={`Abrir movimentações do SN ${item.serial}`}
                        className="rounded-md text-left text-sm break-all outline-none transition hover:text-primary hover:underline focus-visible:ring-2 focus-visible:ring-ring"
                        onClick={() => onOpenSerial(item.serial)}
                        title="Ver todas as movimentações deste SN"
                        type="button"
                      >
                        SN <code className="font-semibold">{item.serial}</code>
                      </button>
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
              </SalePricesEditor>
              <section>
                <h3 className="mb-2 font-bold">Pagamentos recebidos</h3>
                <div className="divide-y rounded-xl border">
                  {receiptDrivenPayments(sale).length ? (
                    receiptDrivenPayments(sale).map((payment, i) => (
                      <div
                        key={i}
                        className="flex justify-between gap-3 p-3 text-sm"
                      >
                        <span>
                          {payment.method === 'pix'
                            ? `Pix · ${payment.recipientName || 'Recebedor não identificado'}`
                            : 'Dinheiro · informado manualmente'}
                        </span>
                        <strong className="shrink-0">
                          {money(payment.amountCents)}
                        </strong>
                      </div>
                    ))
                  ) : (
                    <p className="p-3 text-sm text-muted-foreground">
                      {sale.status === 'cancelled'
                        ? 'Venda cancelada; nenhum recebimento permanece no saldo ativo.'
                        : `Nenhum recebimento registrado. Falta receber ${money(sale.productsTotalCents)}.`}
                    </p>
                  )}
                </div>
                {showReceiptConference && (
                  <>
                    <ReceiptPaymentDetails
                      financiallyReconciled={
                        sale.reconciliation.status === 'reconciled' &&
                        sale.receivedDifferenceCents === 0
                      }
                      receipts={sale.receipts}
                    />
                    <p className="mt-2 text-sm text-muted-foreground">
                      Valor identificado nos comprovantes:{' '}
                      <strong>
                        {money(sale.reconciliation.confirmedTotalCents)}
                      </strong>
                      .{' '}
                      {sale.reconciliation.pendingReceiptCount > 0
                        ? 'Há valores pendentes de leitura ou conferência.'
                        : sale.reconciliation.status === 'divergent'
                          ? `Comprovantes ${money(Math.abs(sale.reconciliation.differenceCents ?? 0))} ${(sale.reconciliation.differenceCents ?? 0) < 0 ? 'abaixo' : 'acima'} do ${receiptTargetLabel(financial?.cashCents ?? 0)}.`
                          : ''}
                    </p>
                    <p className="mt-1 text-xs text-muted-foreground">
                      {(financial?.cashCents ?? 0) > 0
                        ? 'Comprovantes e dinheiro são somados e comparados ao preço da venda. Dinheiro é conferido manualmente.'
                        : 'Os comprovantes são comparados ao preço da venda.'}{' '}
                      Não confirma crédito na conta bancária.
                    </p>
                  </>
                )}
                {sale.status === 'cancelled' && sale.receipts.length > 0 && (
                  <>
                    <p className="mt-3 text-sm font-semibold">
                      Comprovantes arquivados
                    </p>
                    <p className="text-xs text-muted-foreground">
                      Preservados somente no histórico da venda cancelada.
                    </p>
                    <ReceiptPaymentDetails
                      receipts={sale.receipts}
                      required={false}
                      showNotices={false}
                    />
                  </>
                )}
              </section>
            </div>
            <div className="flex shrink-0 flex-wrap items-center justify-end gap-2 border-t bg-background p-3">
              {locked && (
                <output className="block w-full text-sm text-muted-foreground">
                  {pricesBusy
                    ? 'Aguarde a confirmação do servidor.'
                    : 'Salve ou cancele a edição dos preços para continuar.'}
                </output>
              )}
              {canCancel && sale.status === 'completed' && (
                <Button
                  aria-label="Cancelar esta venda"
                  disabled={locked}
                  variant="ghost"
                  className="mr-auto text-destructive"
                  onClick={() => {
                    onClose('action');
                    onCancel(sale);
                  }}
                >
                  <XCircle />
                  Cancelar venda
                </Button>
              )}
              <Button
                variant="outline"
                disabled={locked}
                onClick={() => {
                  onClose('action');
                  onReport(sale);
                }}
              >
                <FileText />
                PDF
              </Button>
              {canEdit && sale.status === 'completed' && (
                <Button
                  disabled={locked}
                  onClick={() => {
                    onClose('action');
                    onEdit(sale);
                  }}
                >
                  <Pencil />
                  Editar
                </Button>
              )}
              <Button
                disabled={locked}
                variant="outline"
                onClick={() => onClose()}
              >
                {closeLabel}
              </Button>
            </div>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
