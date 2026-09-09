'use client';

import {
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
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
import {
  useReceiptRuntime,
  type ServerReceiptJob,
} from '@/components/pdv/server-receipt-runtime';

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
  const { enabled: serverReading } = useReceiptRuntime();
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
    if (serverReading) return;
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
  }, [files, values, serverReading]);

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
            {serverReading
              ? 'Salve a venda normalmente. A leitura será feita no servidor após o envio, mesmo com o aplicativo fechado. Você pode corrigir o valor depois.'
              : 'A leitura acontece neste aparelho. O valor encontrado é salvo automaticamente e pode ser corrigido.'}
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
              <p className="mt-1 text-xs font-semibold text-muted-foreground">
                {state?.message ??
                  (serverReading
                    ? 'Pronto para enviar. Leitura automática após salvar.'
                    : 'Aguardando leitura…')}
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
        {reconciliation.status === 'not_required'
          ? 'Sem Pix — comprovante não exigido'
          : reconciled
            ? 'Comprovantes iguais ao Pix informado'
            : divergent
              ? 'Comprovantes não conferem'
              : 'Conferência dos comprovantes pendente'}
      </p>
      <p className="mt-0.5">
        {reconciliation.status === 'not_required'
          ? 'Dinheiro é considerado pelo valor informado manualmente.'
          : reconciled
            ? `Comprovantes: ${formatMoney(reconciliation.confirmedTotalCents)} · Pix: ${formatMoney(targetCents)}.`
            : divergent
              ? `Os comprovantes estão ${formatMoney(Math.abs(reconciliation.differenceCents ?? 0))} ${(reconciliation.differenceCents ?? 0) < 0 ? 'abaixo' : 'acima'} do Pix informado. Dinheiro não entra nesta comparação.`
              : `${reconciliation.pendingReceiptCount} comprovante(s) ainda sem valor confirmado.`}
      </p>
    </div>
  );
}

export function SavedReceiptValueEditor({
  disabled = false,
  onAutoValueFound,
  onValueChange,
  receipt,
  value,
  serverJob,
  onServerRetry,
  receiptAction,
}: {
  disabled?: boolean;
  onAutoValueFound?: (value: ReceiptValueInput) => Promise<void>;
  onValueChange: (value: ReceiptValueInput) => void;
  receipt: ReceiptAttachmentRecord;
  value: ReceiptValueInput;
  serverJob?: ServerReceiptJob;
  onServerRetry?: () => Promise<void>;
  receiptAction?: ReactNode;
}) {
  const { enabled: serverReading } = useReceiptRuntime();
  const [state, setState] = useState<AnalysisState | null>(null);
  const mountedRef = useRef(false);
  const onAutoValueFoundRef = useRef(onAutoValueFound);
  const onValueChangeRef = useRef(onValueChange);
  const readingReceiptRef = useRef<string | null>(null);
  const receiptIdentity = `${receipt.id}:${receipt.url}`;
  const receiptIdentityRef = useRef(receiptIdentity);
  const valueRef = useRef(value);
  const reading = state?.status === 'reading';

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  useEffect(() => {
    onAutoValueFoundRef.current = onAutoValueFound;
    onValueChangeRef.current = onValueChange;
    receiptIdentityRef.current = receiptIdentity;
    valueRef.current = value;
  }, [onAutoValueFound, onValueChange, receiptIdentity, value]);

  const readSavedReceipt = useCallback(async () => {
    if (readingReceiptRef.current === receiptIdentity) return;

    const currentValue = valueRef.current;
    if (currentValue.amountCents !== null && currentValue.source !== 'ocr') {
      setState({
        message:
          'O valor manual foi preservado. Apague-o para usar a leitura automática.',
        progress: 1,
        status: 'manual',
      });
      return;
    }

    readingReceiptRef.current = receiptIdentity;
    setState({
      message: 'Baixando o comprovante neste aparelho…',
      progress: 0,
      status: 'reading',
    });
    try {
      const response = await fetch(receipt.url, {
        credentials: 'same-origin',
      });
      if (!response.ok) throw new Error('receipt download failed');
      const blob = await response.blob();
      const file = new File([blob], receipt.name, {
        type: receipt.mimeType || blob.type,
      });
      const { readReceiptAmount } = await import('@/lib/client-receipt-ocr');
      const suggestion = await readReceiptAmount(file, (progress) => {
        if (
          !mountedRef.current ||
          receiptIdentityRef.current !== receiptIdentity ||
          (valueRef.current.amountCents !== null &&
            valueRef.current.source !== 'ocr')
        ) {
          return;
        }
        setState({
          message:
            progress < 0.4
              ? 'Preparando leitura local…'
              : 'Lendo valor da transação…',
          progress,
          status: 'reading',
        });
      });
      if (
        !mountedRef.current ||
        receiptIdentityRef.current !== receiptIdentity
      ) {
        return;
      }

      const latestValue = valueRef.current;
      if (latestValue.amountCents !== null && latestValue.source !== 'ocr') {
        return;
      }

      if (!suggestion) {
        setState({
          message: 'Valor não identificado. Digite abaixo ou tente novamente.',
          progress: 1,
          status: 'missing',
        });
        return;
      }

      const nextValue: ReceiptValueInput = {
        amountCents: suggestion.amountCents,
        source: 'ocr',
      };
      valueRef.current = nextValue;
      onValueChangeRef.current(nextValue);

      const persistAutomatically = onAutoValueFoundRef.current;
      if (persistAutomatically) {
        try {
          await persistAutomatically(nextValue);
        } catch {
          if (
            mountedRef.current &&
            receiptIdentityRef.current === receiptIdentity &&
            valueRef.current.source !== 'manual'
          ) {
            setState({
              message: 'Valor encontrado. Salve as alterações para confirmar.',
              progress: 1,
              status: 'found',
            });
          }
          return;
        }
      }

      if (
        !mountedRef.current ||
        receiptIdentityRef.current !== receiptIdentity ||
        valueRef.current.source === 'manual'
      ) {
        return;
      }
      setState({
        message: persistAutomatically
          ? 'Valor encontrado e salvo.'
          : 'Valor encontrado. Confira antes de salvar.',
        progress: 1,
        status: 'found',
      });
    } catch {
      if (
        !mountedRef.current ||
        receiptIdentityRef.current !== receiptIdentity ||
        (valueRef.current.amountCents !== null &&
          valueRef.current.source !== 'ocr')
      ) {
        return;
      }
      setState({
        message: 'Não foi possível ler. Digite o valor ou tente novamente.',
        progress: 1,
        status: 'error',
      });
    } finally {
      if (readingReceiptRef.current === receiptIdentity) {
        readingReceiptRef.current = null;
      }
    }
  }, [receipt.mimeType, receipt.name, receipt.url, receiptIdentity]);

  if (serverReading)
    return (
      <div className="rounded-xl border bg-muted/20 p-2.5">
        <div className="flex min-w-0 flex-wrap items-center gap-2">
          <a
            className="min-w-0 flex-1 truncate text-xs font-bold underline-offset-2 hover:underline"
            href={receipt.url}
            target="_blank"
            rel="noreferrer"
          >
            {receipt.name}
          </a>
          {serverJob?.status === 'needs_review' &&
            value.amountCents === null && (
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={disabled}
                onClick={() => void onServerRetry?.()}
              >
                <FileSearch />
                Tentar leitura
              </Button>
            )}
          {receiptAction}
        </div>
        <output className="mt-1 block text-xs text-muted-foreground">
          {value.amountCents !== null
            ? value.source === 'manual'
              ? 'Valor manual preservado.'
              : 'Valor lido e salvo. Confira se corresponde à transação.'
            : serverJob?.status === 'needs_review'
              ? 'Não foi possível identificar o valor. Digite abaixo ou tente outra leitura.'
              : serverJob?.status === 'cancelled'
                ? 'Leitura encerrada. Confira o valor da transação.'
                : serverJob?.status === 'processing'
                  ? 'Lendo no servidor. Você pode fechar o aplicativo.'
                  : 'Aguardando leitura no servidor. Não é necessário manter esta tela aberta.'}
        </output>
        <ReceiptMoneyInput
          disabled={disabled}
          valueCents={value.amountCents}
          onChange={(amountCents) =>
            onValueChange({
              amountCents,
              source: amountCents === null ? null : 'manual',
            })
          }
        />
      </div>
    );

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
          {reading
            ? 'Lendo…'
            : state?.status === 'error' || state?.status === 'missing'
              ? 'Tentar novamente'
              : 'Ler novamente'}
        </Button>
        {receiptAction}
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
        <p className="mt-1 text-xs font-semibold text-muted-foreground">
          {state.message}
        </p>
      )}
      <ReceiptMoneyInput
        disabled={disabled}
        onChange={(amountCents) => {
          const nextValue: ReceiptValueInput = {
            amountCents,
            source: amountCents === null ? null : 'manual',
          };
          valueRef.current = nextValue;
          onValueChange(nextValue);
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
      <span className="text-xs font-extrabold uppercase tracking-wide text-muted-foreground">
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
