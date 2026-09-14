import { CircleAlert, CircleCheck, Info, LoaderCircle } from 'lucide-react';

import type { ReceiptNoticeInput } from '@/lib/receipt-reading-notices';
import {
  receiptNoticeGroup,
  receiptNoticeSentence,
  splitReceiptReadingNotices,
} from '@/lib/receipt-reading-notices';
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
  const blockingGroup = receiptNoticeGroup(blocking);
  const informationalGroup = receiptNoticeGroup(informational);

  return (
    <div className={cn('mt-3 space-y-2', className)}>
      {financiallyReconciled &&
        !blocking.length &&
        informational.length > 0 && (
          <p className="flex items-start gap-2 rounded-lg bg-emerald-50 px-2.5 py-2 text-xs font-semibold text-emerald-900 dark:bg-emerald-950/30 dark:text-emerald-200">
            <CircleCheck className="mt-0.5 size-4 shrink-0" />
            Valor conciliado. As observações abaixo são informativas.
          </p>
        )}
      {progress.map((notice) => (
        <output
          className="flex items-start gap-2 rounded-lg bg-sky-50 px-2.5 py-2 text-xs font-semibold text-sky-900 dark:bg-sky-950/30 dark:text-sky-200"
          key={notice.key}
        >
          <LoaderCircle className="mt-0.5 size-4 shrink-0 animate-spin" />
          {receiptNoticeSentence(notice)}
        </output>
      ))}
      {blocking.length === 1 && (
        <p
          className="flex items-center gap-2 rounded-lg border-2 border-red-300 bg-red-50 px-3 py-2.5 text-xs font-bold text-red-950 shadow-sm dark:border-red-800 dark:bg-red-950/40 dark:text-red-100"
          role="alert"
        >
          <CircleAlert className="size-4 shrink-0" />
          {blockingGroup.items[0]}
        </p>
      )}
      {blockingGroup.numbered && (
        <div
          className="rounded-lg border-2 border-red-300 bg-red-50 px-3 py-2.5 text-xs text-red-950 shadow-sm dark:border-red-800 dark:bg-red-950/40 dark:text-red-100"
          role="alert"
        >
          <p className="flex items-center gap-1.5 font-bold">
            <CircleAlert className="size-4 shrink-0" />
            {blocking.length} problemas no comprovante:
          </p>
          <ol className="mt-1.5 space-y-1 pl-5">
            {blockingGroup.items.map((label, index) => (
              <li className="list-decimal pl-0.5" key={blocking[index].key}>
                {label}
              </li>
            ))}
          </ol>
        </div>
      )}
      {informational.length === 1 && (
        <p className="flex items-center gap-2 rounded-lg border border-slate-200 bg-slate-50/80 px-2.5 py-2 text-xs text-slate-700 dark:border-slate-700 dark:bg-slate-900/40 dark:text-slate-300">
          <Info className="size-4 shrink-0 text-slate-500" />
          {informationalGroup.items[0]}
        </p>
      )}
      {informationalGroup.numbered && (
        <div className="rounded-lg border border-slate-200 bg-slate-50/80 px-2.5 py-2 text-xs text-slate-700 dark:border-slate-700 dark:bg-slate-900/40 dark:text-slate-300">
          <p className="flex items-center gap-1.5 font-bold">
            <Info className="size-4 shrink-0 text-slate-500" />
            {informational.length} dados não identificados:
          </p>
          <ol className="mt-1.5 space-y-1 pl-5">
            {informationalGroup.items.map((label, index) => (
              <li
                className="list-decimal pl-0.5"
                key={informational[index].key}
              >
                {label}
              </li>
            ))}
          </ol>
          <p className="mt-2 text-[11px] text-slate-500 dark:text-slate-400">
            Observações informativas; não alteram o valor recebido.
          </p>
        </div>
      )}
    </div>
  );
}
