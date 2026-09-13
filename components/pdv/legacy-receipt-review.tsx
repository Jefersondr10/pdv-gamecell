'use client';

import { useState } from 'react';
import { FileSearch, LoaderCircle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
} from '@/components/ui/card';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog';
import { messageOf, requestJson } from '@/lib/client-api';

type ReviewStatus = {
  enabled: boolean;
  eligibleSales: number;
  reviewedSales: number;
  readingSales: number;
  missingReceiptSales: number;
  manualReceiptSales: number;
};
const ENDPOINT = '/api/receipt-ocr/legacy-review';

export function LegacyReceiptReview({
  csrfToken,
  onChanged,
}: {
  csrfToken: string;
  onChanged: () => Promise<void>;
}) {
  const [open, setOpen] = useState(false);
  const [status, setStatus] = useState<ReviewStatus | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  async function analyze() {
    setOpen(true);
    setBusy(true);
    setError('');
    try {
      setStatus(await requestJson<ReviewStatus>(ENDPOINT));
    } catch (reason) {
      setError(messageOf(reason));
    } finally {
      setBusy(false);
    }
  }
  async function reread() {
    if (busy || !status?.enabled || !status.eligibleSales) return;
    setBusy(true);
    setError('');
    setNotice('Preparando a releitura dos comprovantes…');
    let sales = 0,
      receipts = 0;
    try {
      // Short, resumable requests; receipts of each sale are queued atomically.
      for (let batch = 0; batch < 20; batch++) {
        const result = await requestJson<{
          queuedSales: number;
          queuedReceipts: number;
          conflicts: number;
          status: ReviewStatus;
        }>(ENDPOINT, {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            'x-csrf-token': csrfToken,
          },
          body: JSON.stringify({ confirm: true }),
        });
        sales += result.queuedSales;
        receipts += result.queuedReceipts;
        setStatus(result.status);
        setNotice(
          `${receipts} comprovante(s) de ${sales} venda(s) enviado(s) para releitura. As leituras continuam no servidor.`,
        );
        if (
          !result.status.eligibleSales ||
          !result.queuedSales ||
          result.conflicts
        )
          break;
      }
      await onChanged();
    } catch (reason) {
      setError(
        `${messageOf(reason)} O que já foi enviado continua em leitura. Atualize a análise antes de continuar.`,
      );
    } finally {
      setBusy(false);
    }
  }
  return (
    <>
      <Card>
        <CardHeader>
          <FileSearch className="mb-2 size-6 text-primary" />
          <CardTitle>Revisar vendas antigas</CardTitle>
          <CardDescription>
            Reler comprovantes de vendas com Pix digitado no fluxo antigo.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Button variant="outline" onClick={() => void analyze()}>
            Analisar vendas antigas
          </Button>
        </CardContent>
      </Card>
      <Dialog
        open={open}
        onOpenChange={(next) => {
          if (!busy) setOpen(next);
        }}
      >
        <DialogContent
          showCloseButton={!busy}
          className="max-h-[90dvh] overflow-y-auto"
        >
          <DialogHeader>
            <DialogTitle>Revisão das vendas antigas</DialogTitle>
            <DialogDescription>
              O recebido usa comprovantes + dinheiro. O Pix digitado
              anteriormente não sobrepõe a leitura. Os lançamentos originais e
              arquivos ficam preservados no histórico.
            </DialogDescription>
          </DialogHeader>
          {busy && (
            <output className="flex items-center gap-2 text-sm">
              <LoaderCircle className="size-4 animate-spin" /> Processando…
            </output>
          )}
          {error && (
            <p role="alert" className="text-sm text-destructive">
              {error}
            </p>
          )}
          {notice && (
            <output className="block rounded-xl bg-secondary p-3 text-sm">
              {notice}
            </output>
          )}
          {status && (
            <div className="space-y-3 text-sm">
              <p className="font-bold">
                {status.eligibleSales} venda(s) disponível(is) para releitura.
              </p>
              <p>
                {status.readingSales} venda(s) em leitura ·{' '}
                {status.reviewedSales} venda(s) já enviada(s) por esta revisão.
              </p>
              {status.manualReceiptSales > 0 && (
                <p>
                  Correções manuais do valor do comprovante serão mantidas em{' '}
                  {status.manualReceiptSales} venda(s). Para refazê-las, use
                  Reler comprovante na venda.
                </p>
              )}
              {status.missingReceiptSales > 0 && (
                <p className="text-amber-800 dark:text-amber-200">
                  {status.missingReceiptSales} venda(s) sem comprovante: anexe
                  os arquivos em Vendas. Só o dinheiro informado conta como
                  recebido enquanto não houver comprovante.
                </p>
              )}
              <p>
                Durante a releitura, os comprovantes em processamento deixam
                temporariamente de compor o recebido. Uma leitura com erro fica
                pendente para conferência.
              </p>
              {!status.enabled && (
                <p className="text-destructive">
                  A leitura no servidor está indisponível.
                </p>
              )}
            </div>
          )}
          <DialogFooter className="flex-wrap">
            <Button
              variant="outline"
              disabled={busy}
              onClick={() => void analyze()}
            >
              Atualizar análise
            </Button>
            <Button
              disabled={busy || !status?.enabled || !status.eligibleSales}
              onClick={() => void reread()}
            >
              Reler comprovantes antigos
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
