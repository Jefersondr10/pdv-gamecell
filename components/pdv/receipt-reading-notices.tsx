import { CircleAlert, CircleCheck, Info, LoaderCircle } from 'lucide-react';

import type { ReceiptNoticeInput } from '@/lib/receipt-reading-notices';
import { splitReceiptReadingNotices } from '@/lib/receipt-reading-notices';
import { cn } from '@/lib/utils';

export function ReceiptReadingNotices({
  className,
  financiallyReconciled = false,
  receipt,
}: {
  className?: string;
  financiallyReconciled?: boolean;
  receipt: ReceiptNoticeInput;
}) {
  const { blocking, informational, progress } =
    splitReceiptReadingNotices(receipt);
  if (!blocking.length && !informational.length && !progress.length)
    return null;

  return (
    <div className={cn('mt-3 space-y-2', className)}>
      {financiallyReconciled &&
        !blocking.length &&
        informational.length > 0 && (
          <p className="flex items-start gap-2 rounded-lg bg-emerald-50 px-2.5 py-2 text-xs font-semibold text-emerald-900 dark:bg-emerald-950/30 dark:text-emerald-200">
            <CircleCheck className="mt-0.5 size-4 shrink-0" />
            Valor conciliado. Os dados não identificados abaixo são apenas
            informativos.
          </p>
        )}
      {progress.map((notice) => (
        <p
          className="flex items-start gap-2 rounded-lg bg-sky-50 px-2.5 py-2 text-xs font-semibold text-sky-900 dark:bg-sky-950/30 dark:text-sky-200"
          key={notice.key}
        >
          <LoaderCircle className="mt-0.5 size-4 shrink-0 animate-spin" />
          {notice.label}
        </p>
      ))}
      {blocking.length > 0 && (
        <div
          className="rounded-lg border border-amber-300/70 bg-amber-50 px-2.5 py-2 text-xs text-amber-950 dark:bg-amber-950/30 dark:text-amber-100"
          role="alert"
        >
          <p className="flex items-center gap-1.5 font-bold">
            <CircleAlert className="size-4 shrink-0" />
            Conferência necessária
          </p>
          <ul className="mt-1.5 space-y-1 pl-5">
            {blocking.map((notice) => (
              <li className="list-disc" key={notice.key}>
                {notice.label}
              </li>
            ))}
          </ul>
        </div>
      )}
      {informational.length > 0 && (
        <div className="rounded-lg border border-sky-200 bg-sky-50/70 px-2.5 py-2 text-xs text-sky-950 dark:bg-sky-950/20 dark:text-sky-100">
          <p className="flex items-center gap-1.5 font-bold">
            <Info className="size-4 shrink-0" />
            Dados não identificados
          </p>
          <ul className="mt-1.5 grid gap-x-4 gap-y-1 pl-5 sm:grid-cols-2">
            {informational.map((notice) => (
              <li className="list-disc" key={notice.key}>
                {notice.label}
              </li>
            ))}
          </ul>
          <p className="mt-2 text-[11px] text-sky-800 dark:text-sky-200">
            Estes dados ajudam na conferência, mas não alteram sozinhos o valor
            recebido.
          </p>
        </div>
      )}
    </div>
  );
}
