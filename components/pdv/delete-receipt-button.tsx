'use client';

import { useRef, useState } from 'react';
import { LoaderCircle, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { createOperationId } from '@/lib/client-operation-id';
import { messageOf, requestJson } from '@/lib/client-api';
import type { ReceiptAttachmentRecord } from '@/lib/pdv-types';

export function DeleteReceiptButton({
  receipt,
  saleId,
  csrfToken,
  disabled,
  onBusyChange,
  onDeleted,
}: {
  receipt: ReceiptAttachmentRecord;
  saleId: string;
  csrfToken: string;
  disabled: boolean;
  onBusyChange: (busy: boolean) => void;
  onDeleted: (cleanupPending: boolean) => void;
}) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const inFlight = useRef(false);
  // Retain across a network failure. Retrying cannot create a second deletion.
  const operationId = useRef(createOperationId());
  async function remove() {
    if (disabled || inFlight.current) return;
    inFlight.current = true;
    setBusy(true);
    onBusyChange(true);
    setError('');
    try {
      const result = await requestJson<{ cleanupPending: boolean }>(
        `/api/sales/${saleId}/receipts/${receipt.id}`,
        {
          method: 'DELETE',
          headers: {
            'content-type': 'application/json',
            'x-csrf-token': csrfToken,
          },
          body: JSON.stringify({ operationId: operationId.current }),
        },
      );
      setOpen(false);
      onDeleted(result.cleanupPending);
    } catch (cause) {
      setError(
        `${messageOf(cause)} Se a conexão falhou, tente novamente para confirmar o resultado.`,
      );
    } finally {
      inFlight.current = false;
      setBusy(false);
      onBusyChange(false);
    }
  }
  return (
    <>
      <Button
        type="button"
        size="sm"
        variant="ghost"
        className="shrink-0 text-destructive hover:text-destructive"
        disabled={disabled}
        aria-label={`Excluir comprovante ${receipt.name}`}
        onClick={() => {
          setError('');
          setOpen(true);
        }}
      >
        <Trash2 /> Excluir
      </Button>
      <AlertDialog
        open={open}
        onOpenChange={(next) => {
          if (!inFlight.current) setOpen(next);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Excluir este comprovante?</AlertDialogTitle>
            <AlertDialogDescription>
              O arquivo{' '}
              <span className="font-semibold break-all">{receipt.name}</span>{' '}
              será removido desta venda. A conferência dos comprovantes será
              recalculada.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <p className="text-sm text-muted-foreground">
            A venda e seus pagamentos não serão apagados. Outras alterações
            neste formulário não serão salvas por esta ação. Não há opção de
            desfazer; a exclusão fica registrada no histórico.
          </p>
          {error && (
            <p role="alert" className="text-sm text-destructive">
              {error}
            </p>
          )}
          <AlertDialogFooter>
            <Button
              type="button"
              variant="outline"
              disabled={busy}
              onClick={() => setOpen(false)}
            >
              Manter comprovante
            </Button>
            <Button
              type="button"
              variant="destructive"
              disabled={busy || disabled}
              onClick={() => void remove()}
            >
              {busy ? <LoaderCircle className="animate-spin" /> : <Trash2 />}
              {busy ? 'Excluindo…' : 'Excluir comprovante'}
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
