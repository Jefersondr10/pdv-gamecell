'use client';

import { useState, type ReactNode } from 'react';
import {
  ArrowUpRight,
  Banknote,
  CalendarDays,
  CircleAlert,
  FileText,
  Paperclip,
  Pencil,
  ReceiptText,
  Smartphone,
  UserRound,
  WalletCards,
  XCircle,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog';
import { SaleStatusBadge } from '@/components/pdv/sale-status-badge';
import { ReceiptPaymentDetails } from '@/components/pdv/receipt-payment-details';
import { SalePricesEditor } from '@/components/pdv/sale-prices-editor';
import { receiptDrivenPayments } from '@/lib/receipt-income';
import { saleIssues } from '@/lib/sale-display-status';
import { saleFinancialSummary } from '@/lib/sale-financial-summary';
import { receiptTargetLabel } from '@/lib/receipt-reconciliation';
import { cn } from '@/lib/utils';
import type { SaleRecord } from '@/lib/pdv-types';
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
  const issues = sale ? saleIssues(sale) : [];
  const payments = sale ? receiptDrivenPayments(sale) : [];
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
        className="flex h-dvh max-h-dvh max-w-none flex-col gap-0 overflow-hidden rounded-none p-0 pt-[env(safe-area-inset-top)] pb-[env(safe-area-inset-bottom)] [overflow-wrap:anywhere] [&>[data-slot=dialog-close]]:top-[max(1rem,env(safe-area-inset-top))] sm:h-[92dvh] sm:max-w-5xl sm:rounded-2xl sm:py-0"
      >
        {sale && (
          <>
            <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain">
              <DialogHeader className="gap-2 border-b bg-card px-4 py-4 pr-12 text-left sm:px-7 sm:py-5 sm:pr-14">
                <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
                  <span className="inline-flex items-center gap-1.5 rounded-md bg-secondary px-2.5 py-1 text-sm font-extrabold tabular-nums text-primary">
                    <ReceiptText className="size-4" />
                    Venda #{String(sale.number).padStart(5, '0')}
                  </span>
                  <SaleStatusBadge sale={sale} />
                </div>
                <DialogTitle className="break-words text-xl font-extrabold leading-tight tracking-tight sm:text-2xl">
                  {sale.customerName}
                </DialogTitle>
                <DialogDescription className="sr-only">
                  Detalhes da venda #{String(sale.number).padStart(5, '0')},
                  cliente, aparelhos e pagamentos.
                </DialogDescription>
                <dl className="flex flex-wrap gap-x-6 gap-y-2 pt-1 text-xs font-medium text-muted-foreground">
                  <div className="flex items-center gap-1.5">
                    <CalendarDays className="size-3.5 shrink-0" />
                    <dt className="sr-only">Data e horário</dt>
                    <dd>{date(sale.createdAt)}</dd>
                  </div>
                  <div className="flex items-center gap-1.5">
                    <UserRound className="size-3.5 shrink-0" />
                    <dt>Vendedor:</dt>
                    <dd className="font-semibold">{sale.sellerName}</dd>
                  </div>
                </dl>
              </DialogHeader>

              <div className="space-y-5 bg-background p-3 sm:p-6">
                {notice && (
                  <output className="block rounded-xl border border-success/20 bg-success/10 p-3 text-sm font-semibold text-success">
                    {notice}
                  </output>
                )}

                <section
                  aria-label="Resumo financeiro"
                  className="grid grid-cols-1 overflow-hidden rounded-xl border bg-card shadow-sm md:grid-cols-[1fr_1.2fr]"
                >
                  <div className="flex flex-col justify-center bg-slate-900 p-5 text-white sm:p-6">
                    <p className="text-sm font-semibold text-slate-300">
                      Valor da venda
                    </p>
                    <p className="mt-1 text-3xl font-extrabold leading-tight tracking-tight tabular-nums sm:text-4xl">
                      {money(sale.productsTotalCents)}
                    </p>
                    <p className="mt-3 flex items-center gap-1.5 text-xs font-medium text-slate-300">
                      <Smartphone className="size-3.5" />
                      {sale.items.length}{' '}
                      {sale.items.length === 1
                        ? 'aparelho vendido'
                        : 'aparelhos vendidos'}
                    </p>
                  </div>
                  <div className="flex flex-col justify-center gap-3 p-4 sm:p-6">
                    {sale.status === 'cancelled' ? (
                      <div>
                        <p className="font-extrabold">Venda cancelada</p>
                        <p className="mt-1 text-sm font-medium text-muted-foreground">
                          Não compõe os recebimentos ativos.
                        </p>
                      </div>
                    ) : (
                      <>
                        {sale.receivedTotalCents > 0 && (
                          <div>
                            <div className="flex flex-wrap items-baseline justify-between gap-2 text-success">
                              <p className="text-sm font-bold">
                                Total recebido
                              </p>
                              <p className="text-2xl font-extrabold tracking-tight tabular-nums">
                                {money(sale.receivedTotalCents)}
                              </p>
                            </div>
                            <div className="mt-2 space-y-1 text-sm font-semibold tabular-nums text-success">
                              {(financial?.pixCents ?? 0) > 0 && (
                                <p className="flex flex-wrap justify-between gap-2">
                                  <span>Recebido Pix</span>
                                  <span>{money(financial!.pixCents)}</span>
                                </p>
                              )}
                              {(financial?.cashCents ?? 0) > 0 && (
                                <p className="flex flex-wrap justify-between gap-2">
                                  <span>Recebido Dinheiro</span>
                                  <span>{money(financial!.cashCents)}</span>
                                </p>
                              )}
                            </div>
                          </div>
                        )}
                        {sale.receivedDifferenceCents !== 0 ? (
                          <div
                            className={cn(
                              'flex flex-wrap items-baseline justify-between gap-2 rounded-lg px-3 py-2.5',
                              sale.receivedDifferenceCents < 0
                                ? 'bg-destructive/5 text-destructive'
                                : 'bg-amber-50 text-amber-800 dark:bg-amber-950/30 dark:text-amber-200',
                            )}
                          >
                            <p className="text-sm font-bold">
                              {sale.receivedDifferenceCents < 0
                                ? 'Falta receber'
                                : 'Pago a mais'}
                            </p>
                            <p className="text-xl font-extrabold tabular-nums">
                              {money(Math.abs(sale.receivedDifferenceCents))}
                            </p>
                          </div>
                        ) : (
                          <p className="border-t pt-3 text-sm font-semibold text-success">
                            Sem saldo a receber.
                          </p>
                        )}
                      </>
                    )}
                  </div>
                </section>

                {issues.length > 0 && (
                  <section
                    className="rounded-xl border border-amber-200 bg-amber-50/80 p-4 dark:border-amber-800 dark:bg-amber-950/30"
                    aria-label="Pendências da venda"
                  >
                    <h3 className="flex flex-wrap items-center gap-2 text-sm font-extrabold text-amber-950 dark:text-amber-200">
                      <CircleAlert className="size-4 shrink-0" />
                      Conferência da venda
                      <span className="ml-auto text-xs font-semibold">
                        {issues.length}{' '}
                        {issues.length === 1 ? 'pendência' : 'pendências'}
                      </span>
                    </h3>
                    <ol className="mt-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                      {issues.map((issue, index) => (
                        <li
                          key={issue.key}
                          className="flex items-start gap-2 text-sm font-semibold text-amber-950 dark:text-amber-200"
                        >
                          <span className="flex size-5 shrink-0 items-center justify-center rounded bg-amber-200/55 text-xs font-extrabold dark:bg-amber-800/50">
                            {index + 1}
                          </span>
                          <span>{issue.label}</span>
                        </li>
                      ))}
                    </ol>
                  </section>
                )}

                {sale.status === 'cancelled' && (
                  <section className="rounded-xl border bg-muted/60 p-4">
                    <h3 className="flex items-center gap-2 font-extrabold">
                      <XCircle className="size-4" />
                      Cancelamento
                    </h3>
                    <p className="mt-2 text-sm font-medium text-muted-foreground">
                      {sale.cancelledAt
                        ? date(sale.cancelledAt)
                        : 'Data não informada'}
                      {sale.cancelledByName ? ' · ' + sale.cancelledByName : ''}
                    </p>
                    <p className="mt-1 text-sm">
                      <strong>Motivo:</strong>{' '}
                      {sale.cancellationReason || 'Não informado'}
                    </p>
                  </section>
                )}

                <div
                  className={cn(
                    'grid grid-cols-1 items-start gap-5',
                    !pricesEditing && 'lg:grid-cols-[1.35fr_1fr]',
                  )}
                >
                  <SalePricesEditor
                    sale={sale}
                    csrfToken={csrfToken}
                    title="Aparelhos vendidos"
                    description={
                      sale.items.length +
                      (sale.items.length === 1
                        ? ' aparelho nesta venda'
                        : ' aparelhos nesta venda')
                    }
                    headingIcon={
                      <SectionIcon>
                        <Smartphone className="size-5" />
                      </SectionIcon>
                    }
                    className="sale-detail-products min-w-0 rounded-xl bg-card p-4 shadow-sm sm:p-5"
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
                    <div className="divide-y rounded-lg border">
                      {sale.items.map((item, index) => (
                        <div
                          key={item.id}
                          className="min-w-0 space-y-3 p-3 sm:p-4"
                        >
                          <div className="flex items-start gap-3">
                            <span className="mt-0.5 hidden size-7 shrink-0 items-center justify-center rounded-md bg-muted text-xs font-bold tabular-nums text-muted-foreground sm:flex">
                              {String(index + 1).padStart(2, '0')}
                            </span>
                            <div className="min-w-0 flex-1">
                              <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
                                <h4 className="break-words text-base font-extrabold">
                                  {item.productName}
                                </h4>
                                <strong className="text-base font-extrabold tabular-nums">
                                  {money(item.soldPriceCents)}
                                </strong>
                              </div>
                              <p className="mt-1 text-sm font-semibold text-muted-foreground">
                                {item.productDetail}
                              </p>
                            </div>
                          </div>
                          <button
                            aria-label={
                              'Abrir movimentações do SN ' + item.serial
                            }
                            title="Ver todas as movimentações deste SN"
                            type="button"
                            className="grid min-h-10 w-full grid-cols-[minmax(0,1fr)_auto] items-center gap-x-2 gap-y-1 rounded-lg bg-muted/55 px-3 py-2 text-left text-sm transition hover:bg-secondary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                            onClick={() => onOpenSerial(item.serial)}
                          >
                            <span className="text-xs font-bold text-muted-foreground">
                              SN
                            </span>
                            <ArrowUpRight className="ml-auto size-4 shrink-0 text-primary" />
                            <code className="col-span-2 min-w-0 break-all font-semibold">
                              {item.serial}
                            </code>
                          </button>
                          {item.photos.length > 0 && (
                            <div className="flex flex-wrap items-center gap-2">
                              {item.photos.map((photo, i) => (
                                <a
                                  key={photo.id}
                                  href={photo.url}
                                  target="_blank"
                                  rel="noreferrer"
                                  className="inline-flex min-h-10 items-center gap-1.5 rounded-lg border px-3 py-2 text-sm font-semibold text-primary transition hover:bg-secondary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
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

                  <section className="min-w-0 rounded-xl border bg-card p-4 shadow-sm sm:p-5">
                    <SectionHeading
                      icon={<WalletCards className="size-5" />}
                      title="Pagamentos recebidos"
                      description="Recebimentos desta venda"
                    />
                    {payments.length ? (
                      <div className="mt-4 divide-y rounded-lg border">
                        {payments.map((payment) => (
                          <div
                            key={payment.id}
                            className="flex items-start gap-3 p-3"
                          >
                            <span className="mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-full bg-success/10 text-success">
                              {payment.method === 'pix' ? (
                                <ReceiptText className="size-4" />
                              ) : (
                                <Banknote className="size-4" />
                              )}
                            </span>
                            <div className="min-w-0 flex-1">
                              <div className="flex flex-wrap items-baseline justify-between gap-1.5">
                                <p className="text-sm font-bold">
                                  {payment.method === 'pix'
                                    ? 'Pix'
                                    : 'Dinheiro'}
                                </p>
                                <strong className="text-base font-extrabold tabular-nums text-success">
                                  {money(payment.amountCents)}
                                </strong>
                              </div>
                              <p className="mt-1 break-words text-sm font-medium text-muted-foreground">
                                {payment.method === 'pix'
                                  ? payment.recipientName ||
                                    'Recebedor não identificado'
                                  : 'Informado manualmente'}
                              </p>
                            </div>
                          </div>
                        ))}
                      </div>
                    ) : (
                      <div className="mt-4 rounded-lg border border-dashed bg-muted/25 p-4">
                        <p className="text-sm font-bold">
                          Nenhum recebimento registrado
                        </p>
                        <p className="mt-1 text-sm leading-relaxed text-muted-foreground">
                          {sale.status === 'cancelled'
                            ? 'Venda cancelada, sem recebimento no saldo ativo.'
                            : 'O Pix aparece após a leitura do comprovante. Dinheiro é informado manualmente.'}
                        </p>
                      </div>
                    )}
                    {payments.length > 0 && (
                      <div className="mt-4 flex flex-wrap items-baseline justify-between gap-2 border-t pt-3">
                        <span className="text-sm font-bold">
                          Total recebido
                        </span>
                        <strong className="text-lg font-extrabold tabular-nums text-success">
                          {money(sale.receivedTotalCents)}
                        </strong>
                      </div>
                    )}
                  </section>
                </div>

                {showReceiptConference && (
                  <section className="min-w-0 rounded-xl border bg-card p-4 shadow-sm sm:p-5">
                    <SectionHeading
                      icon={<ReceiptText className="size-5" />}
                      title="Comprovantes de pagamento"
                      description={
                        sale.receipts.length +
                        (sale.receipts.length === 1
                          ? ' documento anexado'
                          : ' documentos anexados')
                      }
                    />
                    {sale.receipts.length ? (
                      <>
                        {financial?.receiptText && (
                          <p
                            className={cn(
                              'mt-4 rounded-lg border px-3 py-2.5 text-sm font-semibold tabular-nums',
                              financial.receiptWarning
                                ? 'border-amber-200 bg-amber-50 text-amber-900 dark:border-amber-800 dark:bg-amber-950/30 dark:text-amber-200'
                                : 'border-border bg-muted/40 text-muted-foreground',
                            )}
                          >
                            {financial.receiptText}
                          </p>
                        )}
                        <ReceiptPaymentDetails
                          layout="sale-detail"
                          financiallyReconciled={
                            sale.reconciliation.status === 'reconciled' &&
                            sale.receivedDifferenceCents === 0
                          }
                          receipts={sale.receipts}
                        />
                        <div className="mt-4 space-y-1 border-t pt-4 text-sm font-medium text-muted-foreground">
                          <p className="flex flex-wrap justify-between gap-2">
                            <span>Valor identificado nos comprovantes</span>
                            <strong className="tabular-nums text-foreground">
                              {money(sale.reconciliation.confirmedTotalCents)}
                            </strong>
                          </p>
                          {sale.reconciliation.pendingReceiptCount > 0 ? (
                            <p>
                              Há valores pendentes de leitura ou conferência.
                            </p>
                          ) : sale.reconciliation.status === 'divergent' ? (
                            <p>
                              Comprovantes{' '}
                              {money(
                                Math.abs(
                                  sale.reconciliation.differenceCents ?? 0,
                                ),
                              )}{' '}
                              {(sale.reconciliation.differenceCents ?? 0) < 0
                                ? 'abaixo'
                                : 'acima'}{' '}
                              do {receiptTargetLabel(financial?.cashCents ?? 0)}
                              .
                            </p>
                          ) : null}
                        </div>
                      </>
                    ) : (
                      <div className="mt-4 flex items-start gap-3 rounded-lg border border-dashed bg-muted/25 p-4">
                        <Paperclip className="mt-0.5 size-5 shrink-0 text-muted-foreground" />
                        <div>
                          <p className="text-sm font-bold">
                            Nenhum comprovante anexado
                          </p>
                          <p className="mt-1 text-sm leading-relaxed text-muted-foreground">
                            Anexe o documento em Pagamentos / preço de venda
                            para identificar o Pix.
                          </p>
                        </div>
                      </div>
                    )}
                    <p className="mt-4 text-xs font-medium leading-relaxed text-muted-foreground">
                      {(financial?.cashCents ?? 0) > 0
                        ? 'Comprovantes e dinheiro são somados e comparados ao preço da venda. Dinheiro é conferido manualmente.'
                        : 'Os comprovantes são comparados ao preço da venda.'}{' '}
                      Não confirma crédito na conta bancária.
                    </p>
                  </section>
                )}

                {sale.status === 'cancelled' && sale.receipts.length > 0 && (
                  <section className="rounded-xl border bg-card p-4 sm:p-5">
                    <SectionHeading
                      icon={<ReceiptText className="size-5" />}
                      title="Comprovantes arquivados"
                      description="Preservados somente no histórico da venda cancelada."
                    />
                    <ReceiptPaymentDetails
                      layout="sale-detail"
                      receipts={sale.receipts}
                      required={false}
                      showNotices={false}
                    />
                  </section>
                )}
              </div>
            </div>
            <div className="grid shrink-0 grid-cols-2 items-center gap-2 border-t bg-card p-3 sm:flex sm:flex-wrap sm:justify-end sm:px-6 [&_button]:h-auto [&_button]:min-h-10 [&_button]:min-w-0 [&_button]:flex-wrap [&_button]:gap-1 [&_button]:whitespace-normal [&_button]:py-2 [&_button]:font-bold">
              {locked && (
                <output className="col-span-2 block w-full text-sm font-medium text-muted-foreground">
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
                  className="text-destructive sm:mr-auto"
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
                Abrir PDF
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
                  Editar venda
                </Button>
              )}
              <Button
                disabled={locked}
                variant="outline"
                className="min-w-0 whitespace-normal"
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

function SectionIcon({ children }: { children: ReactNode }) {
  return (
    <span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-secondary text-primary">
      {children}
    </span>
  );
}

function SectionHeading({
  icon,
  title,
  description,
}: {
  icon: ReactNode;
  title: string;
  description: string;
}) {
  return (
    <div className="flex items-center gap-3">
      <SectionIcon>{icon}</SectionIcon>
      <div className="min-w-0">
        <h3 className="text-base font-extrabold leading-snug">{title}</h3>
        <p className="mt-0.5 text-sm font-medium text-muted-foreground">
          {description}
        </p>
      </div>
    </div>
  );
}
