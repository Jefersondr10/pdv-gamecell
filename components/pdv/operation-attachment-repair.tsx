'use client';

import { useState } from 'react';
import { Button } from '@/components/ui/button';
import type { AttachmentIssue } from '@/lib/client-upload';

export function OperationAttachmentRepair({
  issue,
  busy,
  onRepair,
}: {
  issue: AttachmentIssue;
  busy: boolean;
  onRepair: (file: File) => Promise<boolean>;
}) {
  const [file, setFile] = useState<File | null>(null);
  const isReceipt = issue.field === 'receipts';
  return (
    <section className="mt-3 space-y-3 rounded-xl border border-amber-200 bg-amber-50/50 p-3">
      <h3 className="font-bold">Corrigir anexo</h3>
      <p className="break-words text-sm">
        {isReceipt ? 'Comprovante' : 'Foto do aparelho'}:{' '}
        <strong>{issue.name}</strong>
      </p>
      <p className="text-xs text-muted-foreground">
        Selecione novamente o arquivo correspondente. Os outros anexos e os
        dados da operação não serão alterados.
      </p>
      <label className="block space-y-2 text-sm font-semibold">
        Selecionar arquivo novamente
        <input
          type="file"
          accept={
            isReceipt
              ? 'image/jpeg,image/png,image/webp,image/heic,image/heif,application/pdf'
              : 'image/jpeg,image/png,image/webp,image/heic,image/heif'
          }
          disabled={busy}
          className="block w-full min-w-0 rounded-lg border bg-background p-2 text-xs"
          onChange={(event) => {
            setFile(event.target.files?.[0] ?? null);
            event.target.value = '';
          }}
        />
      </label>
      {file && <p className="break-words text-xs">Selecionado: {file.name}</p>}
      <Button
        className="w-full"
        disabled={busy || !file}
        onClick={async () => {
          if (file && (await onRepair(file))) setFile(null);
        }}
      >
        Salvar anexo e retomar
      </Button>
    </section>
  );
}
