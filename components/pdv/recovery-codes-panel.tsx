'use client';

import { useRef, useState } from 'react';
import { Check, Copy, Download, ShieldCheck } from 'lucide-react';

import { Button } from '@/components/ui/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';

export function RecoveryCodesPanel({
  codes,
  onContinue,
  continueLabel = 'Continuar',
  compact = false,
}: {
  codes: string[];
  onContinue: () => void;
  continueLabel?: string;
  compact?: boolean;
}) {
  const [copied, setCopied] = useState(false);
  const [copying, setCopying] = useState(false);
  const [copyError, setCopyError] = useState('');
  const copyingRef = useRef(false);
  const [confirmed, setConfirmed] = useState(false);
  const text = recoveryText(codes);
  const content = (
    <>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        {codes.map((code) => (
          <code
            data-copyable
            className="rounded-xl border bg-muted/40 px-2 py-2 text-center text-xs font-bold tracking-wide"
            key={code}
          >
            {code}
          </code>
        ))}
      </div>
      <div className="mt-3 grid grid-cols-2 gap-2">
        <Button
          disabled={copying}
          onClick={async () => {
            if (copyingRef.current) return;
            copyingRef.current = true;
            setCopying(true);
            setCopyError('');
            setCopied(false);
            try {
              await navigator.clipboard.writeText(text);
              setCopied(true);
            } catch {
              setCopyError(
                'Não foi possível copiar. Use Baixar ou selecione os códigos para guardá-los.',
              );
            } finally {
              copyingRef.current = false;
              setCopying(false);
            }
          }}
          type="button"
          variant="outline"
        >
          {copied ? <Check /> : <Copy />}{' '}
          {copying ? 'Copiando…' : copied ? 'Copiados' : 'Copiar'}
        </Button>
        <Button
          onClick={() => downloadCodes(text)}
          type="button"
          variant="outline"
        >
          <Download /> Baixar
        </Button>
      </div>
      {copyError && (
        <p className="mt-2 text-sm text-destructive" role="alert">
          {copyError}
        </p>
      )}
      <label className="mt-4 flex cursor-pointer items-start gap-3 rounded-xl border p-3 text-sm">
        <input
          checked={confirmed}
          className="mt-0.5 size-4 accent-primary"
          onChange={(event) => setConfirmed(event.target.checked)}
          type="checkbox"
        />
        <span>
          Já guardei estes códigos em um local seguro fora deste aparelho.
        </span>
      </label>
      <Button
        className="mt-3 h-11 w-full"
        disabled={!confirmed}
        onClick={onContinue}
        type="button"
      >
        {continueLabel}
      </Button>
    </>
  );

  if (compact) return content;
  return (
    <Card className="w-full max-w-2xl">
      <CardHeader>
        <span className="mb-2 grid size-11 place-items-center rounded-2xl bg-secondary text-primary">
          <ShieldCheck />
        </span>
        <CardTitle>Guarde seus códigos de recuperação</CardTitle>
        <CardDescription>
          Eles aparecem somente agora. Se esquecer a senha, use um deles para
          recuperar a conta; a lista antiga será substituída.
        </CardDescription>
      </CardHeader>
      <CardContent>{content}</CardContent>
    </Card>
  );
}

function recoveryText(codes: string[]) {
  return [
    'AtacadoApple — códigos de recuperação',
    'Guarde em local seguro. Cada recuperação substitui toda a lista.',
    '',
    ...codes,
  ].join('\n');
}

function downloadCodes(text: string) {
  const url = URL.createObjectURL(
    new Blob([text], { type: 'text/plain;charset=utf-8' }),
  );
  const link = document.createElement('a');
  link.href = url;
  link.download = 'atacadoapple-codigos-recuperacao.txt';
  link.click();
  URL.revokeObjectURL(url);
}
