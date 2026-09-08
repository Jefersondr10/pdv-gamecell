'use client';

import { useRef, useState } from 'react';
import { LoaderCircle, Power, RotateCcw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { messageOf, requestJson } from '@/lib/client-api';
import type { ProductRecord } from '@/lib/pdv-types';

export function ProductStatusAction({
  product,
  csrfToken,
  onChanged,
  disabled = false,
  onBusyChange,
}: {
  product: ProductRecord;
  csrfToken: string;
  onChanged: () => Promise<void>;
  disabled?: boolean;
  onBusyChange?: (busy: boolean) => void;
}) {
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [targetActive, setTargetActive] = useState(!product.active);
  const [saved, setSaved] = useState(false);
  const sending = useRef(false);
  const action = product.active ? 'Desativar' : 'Reativar';
  const confirmedAction = targetActive ? 'Reativar' : 'Desativar';
  const save = async () => {
    if (sending.current) return;
    sending.current = true;
    setBusy(true);
    onBusyChange?.(true);
    setError('');
    let persisted = saved;
    try {
      if (!persisted)
        await requestJson(`/api/products/${product.id}`, {
          method: 'PATCH',
          headers: {
            'content-type': 'application/json',
            'x-csrf-token': csrfToken,
          },
          body: JSON.stringify({ active: targetActive }),
        });
      persisted = true;
      setSaved(true);
      await onChanged();
      setConfirming(false);
    } catch (error) {
      setError(
        persisted
          ? 'A situação foi salva, mas a lista não pôde ser atualizada. Tente atualizar a lista novamente.'
          : messageOf(error),
      );
    } finally {
      sending.current = false;
      setBusy(false);
      onBusyChange?.(false);
    }
  };
  return (
    <>
      <Button
        className="h-11 shrink-0 rounded-xl"
        variant="outline"
        type="button"
        disabled={disabled || busy}
        aria-label={`${action} ${product.model} ${product.detail}`}
        onClick={() => {
          setError('');
          setSaved(false);
          setTargetActive(!product.active);
          setConfirming(true);
        }}
      >
        {product.active ? (
          <Power className="size-4" />
        ) : (
          <RotateCcw className="size-4" />
        )}
        {action}
      </Button>
      <AlertDialog
        open={confirming}
        onOpenChange={(open) => {
          if (!sending.current) setConfirming(open);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {saved ? 'Situação salva' : `${confirmedAction} produto?`}
            </AlertDialogTitle>
            <AlertDialogDescription>
              <span className="mb-2 block font-semibold text-foreground">
                {product.model} · {product.detail}
              </span>
              {!targetActive
                ? 'Este produto não aceitará novas entradas. Seus códigos, preço, fotos e histórico serão mantidos. Os aparelhos já disponíveis continuam no estoque e podem ser vendidos. Você pode reativá-lo depois.'
                : 'O produto voltará a aceitar novas entradas com os mesmos códigos e preço. Isso não cria aparelhos nem altera o estoque ou o histórico.'}
            </AlertDialogDescription>
          </AlertDialogHeader>
          {error && (
            <p
              role="alert"
              className="rounded-xl bg-destructive/10 p-3 text-sm text-destructive"
            >
              {error}
            </p>
          )}
          <AlertDialogFooter>
            <AlertDialogCancel disabled={busy}>Cancelar</AlertDialogCancel>
            <AlertDialogAction disabled={busy} onClick={() => void save()}>
              {busy && <LoaderCircle className="size-4 animate-spin" />}
              {busy
                ? saved
                  ? 'Atualizando…'
                  : 'Salvando…'
                : saved
                  ? 'Atualizar lista'
                  : `${confirmedAction} produto`}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
