import {
  ArrowUpRight,
  Building2,
  CalendarDays,
  FileText,
  UserRound,
} from 'lucide-react';
import { ReceiptReadingNotices } from '@/components/pdv/receipt-reading-notices';
import { AttachmentPreviewLink } from '@/components/pdv/attachment-preview';
import {
  receiptTransactionDisplay,
  shortReceiptDate,
} from '@/lib/receipt-document';
import type { ReceiptAttachmentRecord } from '@/lib/pdv-types';

// A presentation-only layout for sale details. Reports retain their compact layout.
export function SaleReceiptDetails({
  receipt,
  index,
  financiallyReconciled,
  showNotices,
}: {
  receipt: ReceiptAttachmentRecord;
  index: number;
  financiallyReconciled: boolean;
  showNotices: boolean;
}) {
  const details = receipt.receiptDetails;
  const transaction = details ? receiptTransactionDisplay(details) : null;
  return (
    <article className="min-w-0 overflow-hidden rounded-xl border bg-card">
      <header className="flex flex-wrap items-center justify-between gap-x-4 gap-y-3 border-b bg-secondary/35 px-4 py-3.5 sm:px-5">
        <AttachmentPreviewLink
          file={receipt}
          title={`Comprovante ${index + 1}`}
          className="inline-flex min-h-10 items-center gap-2 rounded-md text-base font-extrabold text-primary underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <FileText className="size-5 shrink-0" />
          Comprovante {index + 1}
          <ArrowUpRight className="size-4 shrink-0" />
        </AttachmentPreviewLink>
        <div className="min-w-0 sm:text-right">
          <p className="text-xs font-semibold text-muted-foreground">
            Valor identificado
          </p>
          <p className="mt-0.5 text-lg font-extrabold tabular-nums">
            {receipt.receiptAmountCents === null
              ? 'Em leitura / conferir'
              : (receipt.receiptAmountCents / 100).toLocaleString('pt-BR', {
                  style: 'currency',
                  currency: 'BRL',
                })}
          </p>
        </div>
      </header>
      <div className="space-y-4 p-4 sm:p-5">
        <div className="flex flex-wrap items-center justify-between gap-2 text-sm font-medium text-muted-foreground">
          <p className="inline-flex items-center gap-1.5 tabular-nums">
            <CalendarDays className="size-4 shrink-0" />
            {details
              ? shortReceiptDate(details.paidAtText)
              : 'Data e horário não identificados'}
          </p>
          <p className="text-xs">
            {receipt.receiptAmountSource === 'manual'
              ? 'Valor corrigido manualmente'
              : 'Dados lidos do documento'}
          </p>
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          <section className="min-w-0 rounded-lg border bg-muted/25 p-4">
            <h4 className="flex items-center gap-2 border-b pb-2.5 text-sm font-extrabold">
              <UserRound className="size-4 text-muted-foreground" />
              Pagador
            </h4>
            <p className="mt-3 break-words text-base font-bold">
              {details?.payerName || 'Nome não identificado'}
            </p>
            <dl className="mt-3 space-y-1">
              <dt className="text-xs font-semibold text-muted-foreground">
                Banco pagador
              </dt>
              <dd className="break-words text-sm font-semibold">
                {details?.payerBank || 'Não identificado no comprovante'}
              </dd>
            </dl>
          </section>
          <section className="min-w-0 rounded-lg border border-primary/20 bg-secondary/30 p-4">
            <h4 className="flex items-center gap-2 border-b border-primary/15 pb-2.5 text-sm font-extrabold text-primary">
              <Building2 className="size-4" />
              Recebedor
            </h4>
            <p className="mt-3 break-words text-base font-bold">
              {details?.recipientName || 'Nome não identificado'}
            </p>
            {details?.recipientDocument && (
              <p className="mt-1 text-xs font-medium text-muted-foreground">
                CPF/CNPJ: ***{details.recipientDocument.slice(-4)}
              </p>
            )}
            <dl className="mt-3 space-y-1">
              <dt className="text-xs font-semibold text-muted-foreground">
                Banco recebedor
              </dt>
              <dd className="break-words text-sm font-extrabold text-primary">
                {details?.recipientBank || 'Não identificado no comprovante'}
              </dd>
            </dl>
          </section>
        </div>
        <dl className="rounded-lg bg-muted/40 px-3 py-2.5">
          <dt className="text-xs font-semibold text-muted-foreground">
            {transaction?.label || 'Identificador da transação'}
          </dt>
          <dd className="mt-1 break-all font-mono text-xs leading-relaxed">
            {transaction?.value || 'Não identificado'}
          </dd>
        </dl>
        {!details && (
          <p className="text-sm font-medium text-muted-foreground">
            Em Pagamentos / preço de venda, use Reler comprovante para tentar
            identificar os dados.
          </p>
        )}
        {showNotices && (
          <ReceiptReadingNotices
            className="[&_p]:text-sm [&_li]:text-sm [&_output]:text-sm"
            financiallyReconciled={financiallyReconciled}
            receipt={receipt}
          />
        )}
      </div>
    </article>
  );
}
