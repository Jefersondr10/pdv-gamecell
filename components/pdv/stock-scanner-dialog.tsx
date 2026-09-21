'use client';

import { useEffect, useRef, useState } from 'react';
import {
  BarcodeScanner,
  type ScanFeedback,
} from '@/components/pdv/barcode-scanner';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { messageOf, requestJson } from '@/lib/client-api';
import type { ProductRecord } from '@/lib/pdv-types';
import type { ScanCandidate, ScannerMode } from '@/lib/scanner';
import { resolveStockScan, type StockScanResult } from '@/lib/stock-scan';

export function StockScannerDialog({
  products,
  onClose,
  onFound,
}: {
  products: ProductRecord[];
  onClose: () => void;
  onFound: (result: StockScanResult) => void;
}) {
  const [mode, setMode] = useState<ScannerMode>('apple_serial');
  const [notice, setNotice] = useState('');
  const requestRef = useRef<AbortController | null>(null);
  useEffect(
    () => () => {
      requestRef.current?.abort();
    },
    [],
  );

  const accept = async (candidate: ScanCandidate): Promise<ScanFeedback> => {
    if (requestRef.current) return 'silent';
    const controller = new AbortController();
    requestRef.current = controller;
    setNotice('Localizando no estoque…');
    try {
      const result = await resolveStockScan(
        candidate,
        mode,
        products,
        (query) =>
          requestJson(
            `/api/inventory?view=serial-search&q=${encodeURIComponent(query)}`,
            { signal: controller.signal },
          ),
      );
      if (controller.signal.aborted) return 'silent';
      if (!result.productIds.length) {
        setNotice(
          mode === 'apple_serial'
            ? 'SN não encontrado nesta loja. Confira a etiqueta e tente novamente.'
            : 'Código não cadastrado nesta loja. Tente ler o SN do aparelho.',
        );
        return 'error';
      }
      onFound(result);
      return 'success';
    } catch (error) {
      if (controller.signal.aborted) return 'silent';
      setNotice(`Não foi possível buscar: ${messageOf(error)}`);
      return 'error';
    } finally {
      if (requestRef.current === controller) requestRef.current = null;
    }
  };

  const close = () => {
    requestRef.current?.abort();
    onClose();
  };
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) close();
      }}
    >
      <DialogContent className="flex max-h-[92dvh] flex-col overflow-y-auto sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>Localizar no estoque</DialogTitle>
          <DialogDescription>
            Leia pela câmera ou use um bipador. Esta consulta não altera o
            estoque.
          </DialogDescription>
        </DialogHeader>
        <fieldset
          className="grid grid-cols-2 gap-2"
          aria-label="Tipo de código para buscar"
        >
          {(
            [
              ['apple_serial', 'SN do aparelho'],
              ['product', 'UPC / EAN / JAN'],
            ] as const
          ).map(([value, label]) => (
            <Button
              key={value}
              variant={mode === value ? 'default' : 'outline'}
              aria-pressed={mode === value}
              onClick={() => {
                if (mode === value) return;
                requestRef.current?.abort();
                requestRef.current = null;
                setNotice('');
                setMode(value);
              }}
            >
              {label}
            </Button>
          ))}
        </fieldset>
        <div className="min-h-0 shrink-0">
          <BarcodeScanner
            key={mode}
            autoStart
            mode={mode}
            onAccepted={accept}
            notice={notice}
            title={
              mode === 'apple_serial'
                ? 'Bipar SN do aparelho'
                : 'Bipar código do produto'
            }
          />
        </div>
      </DialogContent>
    </Dialog>
  );
}
