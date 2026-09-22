'use client';

/* oxlint-disable next/no-img-element -- authenticated attachment URLs must load directly with the session cookie */

import { useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertTriangle,
  Ban,
  Camera,
  LoaderCircle,
  PackagePlus,
  ReceiptText,
  RotateCcw,
  Smartphone,
} from 'lucide-react';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from '@/components/ui/accordion';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { messageOf, requestJson } from '@/lib/client-api';
import type { AttachmentRecord } from '@/lib/pdv-types';
import {
  serialMovements,
  type SerialHistoryResponse,
  type SerialHistorySale,
  type SerialMovement,
} from '@/lib/serial-history';
import { cn } from '@/lib/utils';

type OpenSaleResult = false | string | void;
type OpenSaleHandler = (
  saleId: string,
) => OpenSaleResult | Promise<OpenSaleResult>;

export function SerialHistoryDialog({
  serial,
  onOpenChange,
  onOpenSale,
}: {
  serial: string | null;
  onOpenChange: (open: boolean) => void;
  onOpenSale?: OpenSaleHandler;
}) {
  const [result, setResult] = useState<{
    serial: string;
    history: SerialHistoryResponse | null;
    error: string;
  } | null>(null);
  const [saleOpenState, setSaleOpenState] = useState<{
    serial: string;
    saleId: string;
    error: string;
  } | null>(null);
  const openRequestRef = useRef(0);
  const currentSaleOpenState =
    saleOpenState?.serial === serial ? saleOpenState : null;
  const openingSaleId = currentSaleOpenState?.saleId ?? '';
  const saleOpenError = currentSaleOpenState?.error ?? '';
  const currentResult = result?.serial === serial ? result : null;
  const history = currentResult?.history ?? null;
  const error = currentResult?.error ?? '';
  const loading = Boolean(serial && !currentResult);

  useEffect(() => {
    openRequestRef.current += 1;
    if (!serial) return;
    const controller = new AbortController();
    void requestJson<SerialHistoryResponse>(
      `/api/inventory/history?serial=${encodeURIComponent(serial)}`,
      { signal: controller.signal },
    )
      .then((result) => {
        if (!controller.signal.aborted)
          setResult({ serial, history: result, error: '' });
      })
      .catch((caught) => {
        if (!controller.signal.aborted)
          setResult({ serial, history: null, error: messageOf(caught) });
      });
    return () => controller.abort();
  }, [serial]);

  const openSale = async (saleId: string) => {
    if (!onOpenSale || openingSaleId || !serial) return;
    const requestSerial = serial;
    const requestId = ++openRequestRef.current;
    setSaleOpenState({ serial: requestSerial, saleId, error: '' });
    try {
      const outcome = await onOpenSale(saleId);
      if (openRequestRef.current !== requestId) return;
      if (outcome === false) return;
      if (typeof outcome === 'string' && outcome) {
        setSaleOpenState({ serial: requestSerial, saleId: '', error: outcome });
        return;
      }
      onOpenChange(false);
    } catch (caught) {
      if (openRequestRef.current !== requestId) return;
      setSaleOpenState({
        serial: requestSerial,
        saleId: '',
        error: messageOf(caught),
      });
    } finally {
      if (openRequestRef.current === requestId)
        setSaleOpenState((current) =>
          current?.serial === requestSerial
            ? { ...current, saleId: '' }
            : current,
        );
    }
  };

  const movements = useMemo(
    () => (history ? serialMovements(history) : []),
    [history],
  );

  return (
    <Dialog open={Boolean(serial)} onOpenChange={onOpenChange}>
      <DialogContent className="flex h-dvh max-h-dvh max-w-none flex-col gap-0 overflow-hidden rounded-none p-0 pb-[env(safe-area-inset-bottom)] pt-[env(safe-area-inset-top)] sm:h-[90dvh] sm:max-w-2xl sm:rounded-2xl sm:pb-0 sm:pt-0">
        <DialogHeader className="shrink-0 border-b px-4 py-4 pr-12">
          <DialogTitle className="flex items-center gap-2">
            <Smartphone className="size-5 text-primary" />
            Movimentação do SN
          </DialogTitle>
          <DialogDescription className="mt-1">
            {history ? (
              <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
                <code className="font-bold text-foreground">
                  {history.unit.serial}
                </code>
                <span aria-hidden>·</span>
                <span>{history.unit.productName}</span>
                <span aria-hidden>·</span>
                <span>{history.unit.productDetail}</span>
              </span>
            ) : (
              <span>SN {serial}</span>
            )}
          </DialogDescription>
        </DialogHeader>

        <div className="min-h-0 flex-1 overflow-y-auto p-3 overscroll-contain sm:p-4">
          {loading ? (
            <output
              aria-live="polite"
              className="grid min-h-60 place-items-center text-sm font-semibold text-muted-foreground"
            >
              <span className="flex items-center gap-2">
                <LoaderCircle className="size-5 animate-spin text-primary" />
                Buscando a movimentação completa…
              </span>
            </output>
          ) : error ? (
            <div
              className="grid min-h-60 place-items-center p-5 text-center"
              role="alert"
            >
              <div>
                <AlertTriangle className="mx-auto size-9 text-destructive" />
                <p className="mt-3 font-bold">Não foi possível abrir este SN</p>
                <p className="mt-1 text-sm text-muted-foreground">{error}</p>
              </div>
            </div>
          ) : history ? (
            <>
              <div className="mb-3 flex flex-wrap items-center justify-between gap-2 rounded-xl bg-muted/55 px-3 py-2">
                <div className="min-w-0">
                  <p className="truncate font-bold">
                    {history.unit.productName}
                  </p>
                  <p className="truncate text-sm text-muted-foreground">
                    {history.unit.productDetail}
                  </p>
                </div>
                <Badge
                  className={cn(
                    history.unit.status === 'available' &&
                      'bg-success/10 text-success hover:bg-success/10',
                  )}
                  variant={
                    history.unit.status === 'available'
                      ? 'default'
                      : 'secondary'
                  }
                >
                  {history.unit.status === 'available'
                    ? 'Disponível no estoque'
                    : history.unit.status === 'reserved'
                      ? 'Reservado'
                      : 'Vendido'}
                </Badge>
              </div>

              <p className="mb-2 text-xs font-bold uppercase tracking-[.12em] text-muted-foreground">
                Linha do tempo · {movements.length}{' '}
                {movements.length === 1 ? 'movimentação' : 'movimentações'}
              </p>
              <Accordion
                className="overflow-hidden rounded-2xl border"
                defaultValue={
                  movements.length ? [movements[movements.length - 1].key] : []
                }
              >
                {movements.map((movement, index) => (
                  <MovementRow
                    isLast={index === movements.length - 1}
                    key={movement.key}
                    movement={movement}
                    onOpenSale={onOpenSale ? openSale : undefined}
                    openingSaleId={openingSaleId}
                  />
                ))}
              </Accordion>
              {saleOpenError && (
                <p
                  className="mt-3 rounded-xl bg-destructive/10 p-3 text-sm font-semibold text-destructive"
                  role="alert"
                >
                  {saleOpenError}
                </p>
              )}
            </>
          ) : null}
        </div>

        <div className="shrink-0 border-t bg-background p-3 text-right">
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Fechar
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function MovementRow({
  movement,
  isLast,
  onOpenSale,
  openingSaleId,
}: {
  movement: SerialMovement;
  isLast: boolean;
  onOpenSale?: OpenSaleHandler;
  openingSaleId: string;
}) {
  const presentation = movementPresentation(movement);
  return (
    <AccordionItem value={movement.key}>
      <AccordionTrigger className="items-center gap-3 rounded-none px-3 py-3 hover:bg-muted/35 hover:no-underline sm:px-4">
        <span className="relative self-stretch">
          <span
            className={cn(
              'relative z-10 grid size-9 place-items-center rounded-full',
              presentation.iconClass,
            )}
          >
            <presentation.Icon className="size-4" />
          </span>
          {!isLast && (
            <span className="absolute left-1/2 top-9 h-[calc(100%+1.5rem)] w-px -translate-x-1/2 bg-border" />
          )}
        </span>
        <span className="min-w-0 flex-1">
          <span className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
            <strong>{presentation.title}</strong>
            <span className="text-xs text-muted-foreground">
              {formatDateTime(movement.at)}
            </span>
          </span>
          <span className="mt-0.5 block truncate text-xs text-muted-foreground">
            {presentation.summary}
          </span>
        </span>
      </AccordionTrigger>
      <AccordionContent className="px-4 pb-4 pl-[4.35rem]">
        {movement.kind === 'entry' ? (
          <>
            <DetailGrid
              rows={[
                ['Operador', movement.entry.operatorName || 'Não disponível'],
                ['Data da entrada', formatDateTime(movement.entry.createdAt)],
              ]}
            />
            {movement.entry.note && (
              <p className="mt-2 rounded-lg bg-muted p-2.5 text-sm">
                <strong>Observação:</strong> {movement.entry.note}
              </p>
            )}
            <AttachmentGallery
              label="Fotos da entrada"
              photos={movement.entry.photos}
            />
          </>
        ) : movement.kind === 'sale' ? (
          <SaleMovementDetails
            opening={openingSaleId === movement.sale.id}
            sale={movement.sale}
            onOpenSale={onOpenSale}
          />
        ) : (
          <>
            <DetailGrid
              rows={[
                [
                  'Cancelada por',
                  movement.sale.cancelledByName || 'Não informado',
                ],
                [
                  'Data do cancelamento',
                  movement.sale.cancelledAt
                    ? formatDateTime(movement.sale.cancelledAt)
                    : 'Não informada',
                ],
              ]}
            />
            <p className="mt-2 rounded-lg bg-destructive/5 p-2.5 text-sm">
              <strong>Motivo:</strong>{' '}
              {movement.sale.cancellationReason || 'Não informado'}
            </p>
            <AttachmentGallery
              label="Fotos da venda cancelada"
              photos={movement.sale.photos}
            />
            {onOpenSale && (
              <OpenSaleButton
                opening={openingSaleId === movement.sale.id}
                sale={movement.sale}
                onOpenSale={onOpenSale}
              />
            )}
          </>
        )}
      </AccordionContent>
    </AccordionItem>
  );
}

function SaleMovementDetails({
  sale,
  onOpenSale,
  opening,
}: {
  sale: SerialHistorySale;
  onOpenSale?: OpenSaleHandler;
  opening: boolean;
}) {
  return (
    <>
      <DetailGrid
        rows={[
          ['Cliente', sale.customerName || 'Não disponível'],
          ['Vendedor', sale.sellerName || 'Não disponível'],
          [
            'Preço vendido',
            sale.soldPriceCents === null
              ? 'Não disponível'
              : formatMoney(sale.soldPriceCents),
          ],
          [
            'Preço de referência',
            sale.referencePriceCents === null
              ? 'Não disponível'
              : formatMoney(sale.referencePriceCents),
          ],
        ]}
      />
      <AttachmentGallery label="Fotos desta venda" photos={sale.photos} />
      {onOpenSale && (
        <OpenSaleButton opening={opening} sale={sale} onOpenSale={onOpenSale} />
      )}
    </>
  );
}

function OpenSaleButton({
  sale,
  onOpenSale,
  opening,
}: {
  sale: SerialHistorySale;
  onOpenSale: OpenSaleHandler;
  opening: boolean;
}) {
  return (
    <Button
      className="mt-3 w-full"
      disabled={opening}
      onClick={() => void onOpenSale(sale.id)}
      variant="outline"
    >
      {opening ? <LoaderCircle className="animate-spin" /> : <ReceiptText />}
      {opening
        ? 'Abrindo venda…'
        : `Ver detalhes da venda #${String(sale.number).padStart(5, '0')}`}
    </Button>
  );
}

function DetailGrid({ rows }: { rows: Array<[string, string]> }) {
  return (
    <dl className="grid gap-2 sm:grid-cols-2">
      {rows.map(([label, value]) => (
        <div className="rounded-lg bg-muted/60 p-2.5" key={label}>
          <dt className="text-xs font-bold uppercase text-muted-foreground">
            {label}
          </dt>
          <dd className="mt-0.5 break-words font-semibold">{value}</dd>
        </div>
      ))}
    </dl>
  );
}

function AttachmentGallery({
  label,
  photos,
}: {
  label: string;
  photos: AttachmentRecord[];
}) {
  return (
    <section className="mt-3">
      <p className="flex items-center gap-1.5 text-xs font-bold uppercase text-muted-foreground">
        <Camera className="size-3.5" /> {label} · {photos.length}
      </p>
      {photos.length ? (
        <div className="mt-2 flex gap-2 overflow-x-auto pb-1">
          {photos.map((photo) => (
            <a
              className="shrink-0 overflow-hidden rounded-xl border bg-muted"
              href={photo.url}
              key={photo.id}
              rel="noreferrer"
              target="_blank"
              title={`Abrir ${photo.name}`}
            >
              <img
                alt={photo.name}
                className="size-20 object-cover"
                decoding="async"
                loading="lazy"
                src={photo.url}
              />
            </a>
          ))}
        </div>
      ) : (
        <p className="mt-2 text-sm text-muted-foreground">
          Nenhuma foto vinculada a esta movimentação.
        </p>
      )}
    </section>
  );
}

function movementPresentation(movement: SerialMovement) {
  if (movement.kind === 'entry')
    return {
      Icon: PackagePlus,
      iconClass: 'bg-primary/10 text-primary',
      title: 'Entrada no estoque',
      summary: movement.entry.operatorName
        ? `Registrada por ${movement.entry.operatorName}`
        : 'Entrada registrada',
    };
  if (movement.kind === 'cancellation')
    return {
      Icon: RotateCcw,
      iconClass: 'bg-amber-500/15 text-amber-800 dark:text-amber-200',
      title: `Cancelamento da venda #${String(movement.sale.number).padStart(5, '0')}`,
      summary: movement.sale.cancellationReason || 'Venda cancelada',
    };
  return {
    Icon: movement.sale.status === 'cancelled' ? Ban : ReceiptText,
    iconClass:
      movement.sale.status === 'cancelled'
        ? 'bg-muted text-muted-foreground'
        : 'bg-success/10 text-success',
    title: `Venda #${String(movement.sale.number).padStart(5, '0')}`,
    summary:
      movement.sale.customerName !== null &&
      movement.sale.soldPriceCents !== null
        ? `${movement.sale.customerName} · ${formatMoney(movement.sale.soldPriceCents)}`
        : 'Venda registrada',
  };
}

function formatDateTime(value: number) {
  return new Intl.DateTimeFormat('pt-BR', {
    timeZone: 'America/Sao_Paulo',
    dateStyle: 'short',
    timeStyle: 'short',
  }).format(new Date(value));
}

function formatMoney(cents: number) {
  return new Intl.NumberFormat('pt-BR', {
    style: 'currency',
    currency: 'BRL',
  }).format(cents / 100);
}
