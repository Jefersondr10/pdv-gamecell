import type { ReceiptAttachmentRecord } from '@/lib/pdv-types';
import { receiptDocumentLines } from '@/lib/receipt-document';

export function ReceiptPaymentDetails({
  receipts,
}: {
  receipts: ReceiptAttachmentRecord[];
}) {
  if (!receipts.length)
    return (
      <p className="mt-2 text-sm text-muted-foreground">
        Sem comprovante. Anexe agora ou depois em Vendas para identificar o Pix.
        Dinheiro é informado manualmente.
      </p>
    );
  return (
    <div className="mt-3 grid gap-3 sm:grid-cols-2">
      {receipts.map((receipt, index) => (
        <section
          className="report-row min-w-0 rounded-xl border p-3 text-sm"
          key={receipt.id}
        >
          <div className="flex items-start justify-between gap-3">
            <a
              href={receipt.url}
              target="_blank"
              rel="noreferrer"
              className="font-bold text-primary underline underline-offset-2"
            >
              Comprovante {index + 1}
            </a>
            <strong className="shrink-0">
              {receipt.receiptAmountCents === null
                ? 'Em leitura / conferir'
                : (receipt.receiptAmountCents / 100).toLocaleString('pt-BR', {
                    style: 'currency',
                    currency: 'BRL',
                  })}
            </strong>
          </div>
          <p className="mt-1 text-xs text-muted-foreground">
            {receipt.receiptPaymentId
              ? 'Pix registrado a partir deste comprovante'
              : 'Dados do documento - confira o registro do pagamento'}
            {receipt.receiptAmountSource === 'manual'
              ? ' · valor corrigido manualmente'
              : ''}
          </p>
          {receipt.receiptDetails ? (
            <div className="mt-2 space-y-1 break-words">
              {receiptDocumentLines(receipt.receiptDetails).map((line) => (
                <p key={line}>{line}</p>
              ))}
            </div>
          ) : (
            <p className="mt-2 text-muted-foreground">
              Dados bancários ainda não identificados. Em Editar venda, use
              Reler comprovante para tentar identificar.
            </p>
          )}
          {receipt.receiptReviewReason && (
            <p role="alert" className="mt-2 font-semibold text-amber-800">
              {receipt.receiptReviewReason}
            </p>
          )}
        </section>
      ))}
    </div>
  );
}
