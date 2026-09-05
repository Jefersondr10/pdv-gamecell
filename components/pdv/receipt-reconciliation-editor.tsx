'use client';

import { useEffect, useId, useMemo, useRef, useState } from 'react';
import {
  AlertTriangle,
  CheckCircle2,
  FileSearch,
  LoaderCircle,
} from 'lucide-react';

import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { parseMoneyInput } from '@/lib/money';
import {
  deriveReceiptReconciliation,
  type ReceiptValueInput,
} from '@/lib/receipt-reconciliation';
import { cn } from '@/lib/utils';

import type { ReceiptAttachmentRecord } from '@/lib/pdv-types';

type AnalysisState = {
  message: string;
  progress: number;
  status: 'reading' | 'found' | 'missing' | 'error' | 'manual';
};

export function ReceiptReconciliationEditor({
  className,
  disabled = false,
  files,
  onValueChange,
  showSummary = true,
  targetCents,
  values,
}: {
  className?: string;
  disabled?: boolean;
  files: File[];
  onValueChange: (index: number, value: ReceiptValueInput) => void;
  showSummary?: boolean;
  targetCents: number;
  values: ReceiptValueInput[];
}) {
  const [analysis, setAnalysis] = useState<Record<string, AnalysisState>>({});
  const processedRef = useRef(new Set<string>());
  const filesRef = useRef(files);
  const onValueChangeRef = useRef(onValueChange);
  const valuesRef = useRef(values);

  useEffect(() => {
    filesRef.current = files;
    onValueChangeRef.current = onValueChange;
    valuesRef.current = values;
  }, [files, onValueChange, values]);

  useEffect(() => {
    const visibleKeys = new Set(files.map(fileKey));
    for (const key of processedRef.current) {
      if (!visibleKeys.has(key)) processedRef.current.delete(key);
    }
    files.forEach((file, index) => {
      const key = fileKey(file);
      if (
        processedRef.current.has(key) ||
        (values[index]?.amountCents ?? null) !== null
      ) {
        return;
      }
      processedRef.current.add(key);
      setAnalysis((current) => ({
        ...current,
        [key]: {
          message: 'Preparando leitura local…',
          progress: 0,
          status: 'reading',
        },
      }));
      void import('@/lib/client-receipt-ocr')
        .then(({ readReceiptAmount }) =>
          readReceiptAmount(file, (progress) => {
            setAnalysis((current) => ({
              ...current,
              [key]: {
                message:
                  progress < 0.4
                    ? 'Preparando leitura local…'
                    : 'Lendo valor da transação…',
                progress,
                status: 'reading',
              },
            }));
          }),
        )
        .then((suggestion) => {
          const currentFile = filesRef.current[index];
          if (!currentFile || fileKey(currentFile) !== key) return;
          if (suggestion && !valuesRef.current[index]?.amountCents) {
            onValueChangeRef.current(index, {
              amountCents: suggestion.amountCents,
              source: 'ocr',
            });
          }
          setAnalysis((current) => ({
            ...current,
            [key]: suggestion
              ? {
                  message: 'Valor encontrado. Confira antes de continuar.',
                  progress: 1,
                  status: 'found',
                }
              : {
                  message: 'Valor não identificado. Digite abaixo.',
                  progress: 1,
                  status: 'missing',
                },
          }));
        })
        .catch(() => {
          const currentFile = filesRef.current[index];
          if (!currentFile || fileKey(currentFile) !== key) return;
          setAnalysis((current) => ({
            ...current,
            [key]: {
              message: 'Não foi possível ler. Digite o valor da transação.',
              progress: 1,
              status: 'error',
            },
          }));
        });
    });
  }, [files, values]);

  const reconciliation = useMemo(
    () => deriveReceiptReconciliation(values, targetCents),
    [targetCents, values],
  );

  if (files.length === 0) return null;

  return (
    <section
      className={cn(
        'w-full rounded-2xl border bg-background/90 p-3 text-left shadow-sm',
        className,
      )}
    >
      <div className="flex items-start gap-2.5">
        <span className="grid size-9 shrink-0 place-items-center rounded-xl bg-primary/10 text-primary">
          <FileSearch className="size-4" />
        </span>
        <div className="min-w-0">
          <h3 className="text-sm font-extrabold">Conferir comprovantes</h3>
          <p className="text-xs text-muted-foreground">
            A leitura acontece neste aparelho. Somente o valor confirmado é
            salvo.
          </p>
        </div>
      </div>

      <div className="mt-3 space-y-2">
        {files.map((file, index) => {
          const state =
            analysis[fileKey(file)] ??
            (values[index]?.amountCents
              ? {
                  message:
                    values[index]?.source === 'ocr'
                      ? 'Valor lido. Confira antes de continuar.'
                      : 'Valor informado manualmente.',
                  progress: 1,
                  status:
                    values[index]?.source === 'ocr'
                      ? ('found' as const)
                      : ('manual' as const),
                }
              : undefined);
          return (
            <div
              className="rounded-xl border bg-muted/20 p-2.5"
              key={fileKey(file)}
            >
              <div className="flex min-w-0 items-center gap-2">
                {state?.status === 'reading' ? (
                  <LoaderCircle className="size-4 shrink-0 animate-spin text-primary" />
                ) : state?.status === 'found' || state?.status === 'manual' ? (
                  <CheckCircle2 className="size-4 shrink-0 text-emerald-600" />
                ) : (
                  <AlertTriangle className="size-4 shrink-0 text-amber-600" />
                )}
                <span className="min-w-0 flex-1 truncate text-xs font-bold">
                  {file.name}
                </span>
              </div>
              {state?.status === 'reading' && (
                <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-muted">
                  <div
                    className="h-full rounded-full bg-primary transition-[width]"
                    style={{ width: `${Math.max(8, state.progress * 100)}%` }}
                  />
                </div>
              )}
              <p className="mt-1 text-[.68rem] font-semibold text-muted-foreground">
                {state?.message ?? 'Aguardando leitura…'}
              </p>
              <ReceiptMoneyInput
                disabled={disabled}
                onChange={(amountCents) => {
                  onValueChange(index, {
                    amountCents,
                    source: amountCents === null ? null : 'manual',
                  });
                  setAnalysis((current) => ({
                    ...current,
                    [fileKey(file)]: {
                      message:
                        amountCents === null
                          ? 'Digite o valor da transação.'
                          : 'Valor informado manualmente.',
                      progress: 1,
                      status: amountCents === null ? 'missing' : 'manual',
                    },
                  }));
                }}
                valueCents={values[index]?.amountCents ?? null}
              />
            </div>
          );
        })}
      </div>

      {showSummary && (
        <ReconciliationSummary
          className="mt-3"
          reconciliation={reconciliation}
          targetCents={targetCents}
        />
      )}
    </section>
  );
}

export function ReconciliationSummary({
  className,
  reconciliation,
  targetCents,
}: {
  className?: string;
  reconciliation: ReturnType<typeof deriveReceiptReconciliation>;
  targetCents: number;
}) {
  const divergent = reconciliation.status === 'divergent';
  const reconciled = reconciliation.status === 'reconciled';
  return (
    <div
      className={cn(
        'rounded-xl border px-3 py-2 text-xs',
        reconciled &&
          'border-emerald-500/30 bg-emerald-500/10 text-emerald-900 dark:text-emerald-100',
        divergent &&
          'border-rose-500/30 bg-rose-500/10 text-rose-900 dark:text-rose-100',
        reconciliation.status === 'pending' &&
          'border-amber-500/30 bg-amber-500/10 text-amber-950 dark:text-amber-100',
        className,
      )}
      role={divergent ? 'alert' : 'status'}
    >
      <p className="font-extrabold">
        {targetCents <= 0
          ? 'Venda sem valor definido'
          : reconciled
            ? 'Conciliado'
            : divergent
              ? 'Verificar venda'
              : 'Conciliação pendente'}
      </p>
      <p className="mt-0.5">
        {targetCents <= 0
          ? 'A conciliação ficará pendente até a venda possuir um valor.'
          : reconciled
            ? `Comprovantes: ${formatMoney(reconciliation.confirmedTotalCents)} · venda: ${formatMoney(targetCents)}.`
            : divergent
              ? `${(reconciliation.differenceCents ?? 0) < 0 ? 'Falta' : 'Sobra'} ${formatMoney(Math.abs(reconciliation.differenceCents ?? 0))} nos comprovantes.`
              : `${reconciliation.pendingReceiptCount} comprovante(s) ainda sem valor confirmado.`}
      </p>
    </div>
  );
}

export function SavedReceiptValueEditor({
  disabled = false,
  onValueChange,
  receipt,
  value,
}: {
  disabled?: boolean;
  onValueChange: (value: ReceiptValueInput) => void;
  receipt: ReceiptAttachmentRecord;
  value: ReceiptValueInput;
}) {
  const [state, setState] = useState<AnalysisState | null>(null);
  const reading = state?.status === 'reading';

  const readSavedReceipt = async () => {
    setState({
      message: 'Baixando o comprovante neste aparelho…',
      progress: 0,
      status: 'reading',
    });
    try {
      const response = await fetch(receipt.url, {
        cache: 'no-store',
        credentials: 'same-origin',
      });
      if (!response.ok) throw new Error('receipt download failed');
      const blob = await response.blob();
      const file = new File([blob], receipt.name, {
        type: receipt.mimeType || blob.type,
      });
      const { readReceiptAmount } = await import('@/lib/client-receipt-ocr');
      const suggestion = await readReceiptAmount(file, (progress) => {
        setState({
          message:
            progress < 0.4
              ? 'Preparando leitura local…'
              : 'Lendo valor da transação…',
          progress,
          status: 'reading',
        });
      });
      if (!suggestion) {
        setState({
          message: 'Valor não identificado. Digite abaixo.',
          progress: 1,
          status: 'missing',
        });
        return;
      }
      onValueChange({ amountCents: suggestion.amountCents, source: 'ocr' });
      setState({
        message: 'Valor encontrado. Confira antes de salvar.',
        progress: 1,
        status: 'found',
      });
    } catch {
      setState({
        message: 'Não foi possível ler. Digite o valor da transação.',
        progress: 1,
        status: 'error',
      });
    }
  };

  return (
    <div className="rounded-xl border bg-muted/20 p-2.5">
      <div className="flex min-w-0 flex-wrap items-center gap-2">
        <a
          className="min-w-0 flex-1 truncate text-xs font-bold underline-offset-2 hover:underline"
          href={receipt.url}
          rel="noreferrer"
          target="_blank"
        >
          {receipt.name}
        </a>
        <Button
          disabled={disabled || reading}
          onClick={() => void readSavedReceipt()}
          size="sm"
          type="button"
          variant="outline"
        >
          {reading ? <LoaderCircle className="animate-spin" /> : <FileSearch />}
          Ler valor
        </Button>
      </div>
      {reading && (
        <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-muted">
          <div
            className="h-full rounded-full bg-primary transition-[width]"
            style={{ width: `${Math.max(8, state.progress * 100)}%` }}
          />
        </div>
      )}
      {state && (
        <p className="mt-1 text-[.68rem] font-semibold text-muted-foreground">
          {state.message}
        </p>
      )}
      <ReceiptMoneyInput
        disabled={disabled}
        onChange={(amountCents) => {
          onValueChange({
            amountCents,
            source: amountCents === null ? null : 'manual',
          });
          setState({
            message:
              amountCents === null
                ? 'Digite o valor da transação.'
                : 'Valor informado manualmente.',
            progress: 1,
            status: amountCents === null ? 'missing' : 'manual',
          });
        }}
        valueCents={value.amountCents}
      />
    </div>
  );
}

function ReceiptMoneyInput({
  disabled,
  onChange,
  valueCents,
}: {
  disabled: boolean;
  onChange: (value: number | null) => void;
  valueCents: number | null;
}) {
  const [draft, setDraft] = useState(() => moneyInputValue(valueCents));
  const inputId = useId();
  const lastEmittedRef = useRef<number | null | undefined>(undefined);
  useEffect(() => {
    if (lastEmittedRef.current === valueCents) {
      lastEmittedRef.current = undefined;
      return;
    }
    setDraft(moneyInputValue(valueCents));
  }, [valueCents]);
  return (
    <label className="mt-2 block" htmlFor={inputId}>
      <span className="text-[.7rem] font-extrabold uppercase tracking-wide text-muted-foreground">
        Valor da transação
      </span>
      <Input
        className="mt-1 h-10 bg-background text-right font-extrabold"
        disabled={disabled}
        id={inputId}
        inputMode="decimal"
        onChange={(event) => {
          const next = event.target.value;
          setDraft(next);
          const amount = parseMoneyInput(next);
          const normalized = amount > 0 ? amount : null;
          lastEmittedRef.current = normalized;
          onChange(normalized);
        }}
        onBlur={() => setDraft(moneyInputValue(valueCents))}
        placeholder="R$ 0,00"
        value={draft}
      />
    </label>
  );
}

function fileKey(file: File) {
  return `${file.name}:${file.size}:${file.lastModified}:${file.type}`;
}

function moneyInputValue(cents: number | null) {
  if (cents === null) return '';
  return (cents / 100).toLocaleString('pt-BR', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

function formatMoney(cents: number) {
  return new Intl.NumberFormat('pt-BR', {
    style: 'currency',
    currency: 'BRL',
  }).format(cents / 100);
}
