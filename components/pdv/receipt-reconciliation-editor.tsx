'use client';

import {
  useCallback,
  useEffect,
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

import { Button } from '@/components/ui/button';
import { AttachmentPreviewLink } from '@/components/pdv/attachment-preview';
import {
  deriveReceiptReconciliation,
  receiptTargetLabel,
  type ReceiptValueInput,
} from '@/lib/receipt-reconciliation';
import { cn } from '@/lib/utils';

import type { ReceiptAttachmentRecord } from '@/lib/pdv-types';
import {
  useReceiptRuntime,
  type ServerReceiptJob,
} from '@/components/pdv/server-receipt-runtime';
import { ReceiptReadingNotices } from '@/components/pdv/receipt-reading-notices';

type AnalysisState = {
  amountCents?: number;
  message: string;
  progress: number;
  status: 'reading' | 'found' | 'missing' | 'error';
};

export function ReceiptReconciliationEditor({
  cashCents = 0,
  className,
  disabled = false,
  files,
  showSummary = true,
  targetCents,
  values,
}: {
  cashCents?: number;
  className?: string;
  disabled?: boolean;
  files: File[];
  showSummary?: boolean;
  targetCents: number;
  values: ReceiptValueInput[];
}) {
  const { enabled: serverReading } = useReceiptRuntime();
  const [analysis, setAnalysis] = useState<Record<string, AnalysisState>>({});
  const processedRef = useRef(new Set<string>());
  const filesRef = useRef(files);

  useEffect(() => {
    filesRef.current = files;
  }, [files]);

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
          setAnalysis((current) => ({
            ...current,
            [key]: suggestion
              ? {
                  amountCents: suggestion.amountCents,
                  message:
                    'Valor sugerido neste aparelho. Ele ainda não foi contabilizado como pagamento.',
                  progress: 1,
                  status: 'found',
                }
              : {
                  message:
                    'Valor não identificado. Tente outra imagem do comprovante.',
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
              message:
                'Não foi possível ler. Tente outra imagem do comprovante.',
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
      aria-busy={disabled}
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
              ? 'Salve a venda normalmente. A leitura será feita no servidor após o envio, mesmo com o aplicativo fechado. Se necessário, você poderá solicitar uma nova leitura.'
              : 'A leitura neste aparelho gera apenas uma sugestão. O pagamento continua pendente até uma leitura segura no servidor.'}
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
                      ? 'Valor lido e aguardando validação segura.'
                      : 'Valor anterior registrado.',
                  amountCents: values[index]?.amountCents ?? undefined,
                  progress: 1,
                  status: 'found' as const,
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
                ) : state?.status === 'found' ? (
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
              {(state?.amountCents ?? values[index]?.amountCents ?? null) !==
                null && (
                <output
                  className={cn(
                    'mt-2 block text-right text-sm font-extrabold',
                    state?.amountCents && !values[index]?.amountCents
                      ? 'text-amber-700 dark:text-amber-300'
                      : 'text-emerald-700 dark:text-emerald-300',
                  )}
                >
                  {state?.amountCents && !values[index]?.amountCents
                    ? 'Valor sugerido'
                    : 'Valor identificado'}
                  :{' '}
                  {formatMoney(
                    state?.amountCents ?? values[index]!.amountCents!,
                  )}
                </output>
              )}
            </div>
          );
        })}
      </div>

      {showSummary && (
        <ReconciliationSummary
          cashCents={cashCents}
          className="mt-3"
          reconciliation={reconciliation}
          targetCents={targetCents}
        />
      )}
    </section>
  );
}

export function ReconciliationSummary({
  cashCents = 0,
  className,
  reconciliation,
  targetCents,
}: {
  cashCents?: number;
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
            ? `Comprovantes iguais ao ${receiptTargetLabel(cashCents)}`
            : divergent
              ? 'Comprovantes não conferem'
              : 'Conferência dos comprovantes pendente'}
      </p>
      <p className="mt-0.5">
        {reconciliation.status === 'not_required'
          ? cashCents > 0
            ? 'Dinheiro é considerado pelo valor informado manualmente.'
            : 'Não há saldo a receber por Pix.'
          : reconciled
            ? `Comprovantes: ${formatMoney(reconciliation.confirmedTotalCents)} · Pix: ${formatMoney(targetCents)}.`
            : divergent
              ? `Os comprovantes estão ${formatMoney(Math.abs(reconciliation.differenceCents ?? 0))} ${(reconciliation.differenceCents ?? 0) < 0 ? 'abaixo' : 'acima'} do ${receiptTargetLabel(cashCents)}.${cashCents > 0 ? ' O dinheiro recebido já foi descontado do saldo.' : ''}`
              : reconciliation.reviewReceiptCount
                ? 'Há comprovante para revisar. Confira o aviso no documento; o valor lido sozinho não confirma o recebimento.'
                : `${reconciliation.pendingReceiptCount} comprovante(s) ainda sem valor confirmado.`}
      </p>
    </div>
  );
}

export function SavedReceiptValueEditor({
  disabled = false,
  receipt,
  value,
  serverJob,
  onServerRetry,
  receiptAction,
}: {
  disabled?: boolean;
  receipt: ReceiptAttachmentRecord;
  value: ReceiptValueInput;
  serverJob?: ServerReceiptJob;
  onServerRetry?: () => Promise<void>;
  receiptAction?: ReactNode;
}) {
  const { enabled: serverReading } = useReceiptRuntime();
  const [state, setState] = useState<AnalysisState | null>(null);
  const [localSuggestionCents, setLocalSuggestionCents] = useState<
    number | null
  >(null);
  const mountedRef = useRef(false);
  const readingReceiptRef = useRef<string | null>(null);
  const receiptIdentity = `${receipt.id}:${receipt.url}`;
  const receiptIdentityRef = useRef(receiptIdentity);
  const reading = state?.status === 'reading';
  const [confirmReread, setConfirmReread] = useState(false);
  const [requestingReread, setRequestingReread] = useState(false);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  useEffect(() => {
    receiptIdentityRef.current = receiptIdentity;
  }, [receiptIdentity]);

  const readSavedReceipt = useCallback(async () => {
    if (readingReceiptRef.current === receiptIdentity) return;

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
          receiptIdentityRef.current !== receiptIdentity
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

      if (!suggestion) {
        setState({
          message:
            'Valor não identificado. Tente novamente ou anexe outro comprovante.',
          progress: 1,
          status: 'missing',
        });
        return;
      }

      setLocalSuggestionCents(suggestion.amountCents);

      if (
        !mountedRef.current ||
        receiptIdentityRef.current !== receiptIdentity
      ) {
        return;
      }
      setState({
        amountCents: suggestion.amountCents,
        message:
          'Valor sugerido neste aparelho. Ele não foi contabilizado como pagamento.',
        progress: 1,
        status: 'found',
      });
    } catch {
      if (
        !mountedRef.current ||
        receiptIdentityRef.current !== receiptIdentity
      ) {
        return;
      }
      setState({
        message:
          'Não foi possível ler. Tente novamente ou anexe outro comprovante.',
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
          <AttachmentPreviewLink
            className="min-w-0 flex-1 truncate text-xs font-bold underline-offset-2 hover:underline"
            file={receipt}
            title="Comprovante de pagamento"
          >
            {receipt.name}
          </AttachmentPreviewLink>
          {serverJob &&
            !['pending', 'processing', 'retry'].includes(
              serverJob.status ?? '',
            ) &&
            onServerRetry && (
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={disabled || requestingReread}
                onClick={() => setConfirmReread(true)}
              >
                <FileSearch />
                Reler comprovante
              </Button>
            )}
          {receiptAction}
        </div>
        {confirmReread && (
          <div className="my-2 rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm text-amber-950">
            <p>
              A nova leitura substituirá o valor salvo deste comprovante e
              voltará a atualizar o Pix. Dinheiro não será alterado.
            </p>
            <div className="mt-2 flex gap-2">
              <Button
                size="sm"
                disabled={disabled || requestingReread}
                onClick={async () => {
                  setRequestingReread(true);
                  try {
                    await onServerRetry?.();
                    setConfirmReread(false);
                  } finally {
                    setRequestingReread(false);
                  }
                }}
              >
                Confirmar releitura
              </Button>
              <Button
                size="sm"
                variant="ghost"
                onClick={() => setConfirmReread(false)}
              >
                Agora não
              </Button>
            </div>
          </div>
        )}
        <ReceiptReadingNotices
          receipt={{
            ...receipt,
            receiptAmountCents: value.amountCents,
            receiptOcrStatus: serverJob?.status ?? receipt.receiptOcrStatus,
          }}
        />
        <output className="mt-1 block text-xs text-muted-foreground">
          {value.amountCents !== null
            ? value.source === 'manual'
              ? 'Valor anterior registrado. Solicite a releitura para aplicar a conferência automática.'
              : 'Valor lido e salvo. Confira se corresponde à transação.'
            : serverJob?.status === 'needs_review'
              ? 'Não foi possível confirmar o pagamento. Tente outra leitura ou anexe outro comprovante.'
              : serverJob?.status === 'cancelled'
                ? 'Leitura encerrada. Confira o valor da transação.'
                : serverJob?.status === 'processing'
                  ? 'Lendo no servidor. Você pode fechar o aplicativo.'
                  : 'Aguardando leitura no servidor. Não é necessário manter esta tela aberta.'}
        </output>
        {value.amountCents !== null && (
          <output className="mt-2 block text-right text-sm font-extrabold text-emerald-700 dark:text-emerald-300">
            Valor identificado: {formatMoney(value.amountCents)}
          </output>
        )}
      </div>
    );

  return (
    <div className="rounded-xl border bg-muted/20 p-2.5">
      <div className="flex min-w-0 flex-wrap items-center gap-2">
        <AttachmentPreviewLink
          className="min-w-0 flex-1 truncate text-xs font-bold underline-offset-2 hover:underline"
          file={receipt}
          title="Comprovante de pagamento"
        >
          {receipt.name}
        </AttachmentPreviewLink>
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
      <ReceiptReadingNotices
        receipt={{ ...receipt, receiptAmountCents: value.amountCents }}
      />
      {(value.amountCents ?? localSuggestionCents) !== null && (
        <output
          className={cn(
            'mt-2 block text-right text-sm font-extrabold',
            value.amountCents !== null
              ? 'text-emerald-700 dark:text-emerald-300'
              : 'text-amber-700 dark:text-amber-300',
          )}
        >
          {value.amountCents !== null ? 'Valor identificado' : 'Valor sugerido'}
          : {formatMoney(value.amountCents ?? localSuggestionCents!)}
        </output>
      )}
    </div>
  );
}

function fileKey(file: File) {
  return `${file.name}:${file.size}:${file.lastModified}:${file.type}`;
}

function formatMoney(cents: number) {
  return new Intl.NumberFormat('pt-BR', {
    style: 'currency',
    currency: 'BRL',
  }).format(cents / 100);
}
