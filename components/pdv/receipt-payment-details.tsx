import type { ReceiptAttachmentRecord } from '@/lib/pdv-types';
import {
  receiptTransactionDisplay,
  shortReceiptDate,
} from '@/lib/receipt-document';
import { ReceiptReadingNotices } from '@/components/pdv/receipt-reading-notices';
import { SaleReceiptDetails } from '@/components/pdv/sale-receipt-details';
import { AttachmentPreviewLink } from '@/components/pdv/attachment-preview';

export function ReceiptPaymentDetails({
  financiallyReconciled = false,
  receipts,
  required = true,
  showNotices = true,
  layout = 'default',
}: {
  financiallyReconciled?: boolean;
  receipts: ReceiptAttachmentRecord[];
  required?: boolean;
  showNotices?: boolean;
  layout?: 'default' | 'sale-detail';
}) {
  if (!receipts.length && !required) return null;
  if (!receipts.length)
    return (
      <p className="mt-2 text-sm text-muted-foreground">
        Sem comprovante. Anexe agora ou depois em Vendas para identificar o Pix.
      </p>
    );
  if (layout === 'sale-detail')
    return (
      <div className="mt-4 space-y-4">
        {receipts.map((receipt, index) => (
          <SaleReceiptDetails
            key={receipt.id}
            receipt={receipt}
            index={index}
            financiallyReconciled={financiallyReconciled}
            showNotices={showNotices}
          />
        ))}
      </div>
    );
  return (
    <div className="mt-3 grid gap-3 sm:grid-cols-2">
      {receipts.map((receipt, index) => (
        <section
          className="report-row min-w-0 rounded-xl border p-3 text-sm"
          key={receipt.id}
        >
          <div className="flex items-start justify-between gap-3">
            <AttachmentPreviewLink
              file={receipt}
              title={`Comprovante ${index + 1}`}
              className="font-bold text-primary underline underline-offset-2"
            >
              Comprovante {index + 1}
            </AttachmentPreviewLink>
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
            Pix identificado no comprovante
            {receipt.receiptAmountSource === 'manual'
              ? ' · valor corrigido manualmente'
              : ''}
          </p>
          {receipt.receiptDetails ? (
            <div className="mt-3 space-y-3 break-words">
              <p className="text-sm tabular-nums">
                {shortReceiptDate(receipt.receiptDetails.paidAtText)}
              </p>
              <div className="grid gap-3">
                <div className="rounded-lg bg-muted/50 p-2.5">
                  <p className="mb-1 font-bold text-muted-foreground">
                    Pagador
                  </p>
                  <p>
                    {receipt.receiptDetails.payerName ||
                      'Nome não identificado'}
                  </p>
                  <p className="text-muted-foreground">
                    {receipt.receiptDetails.payerBank ||
                      'Banco não identificado'}
                  </p>
                </div>
                <div className="rounded-lg border bg-secondary/30 p-2.5">
                  <p className="mb-1 font-bold text-primary">Recebedor</p>
                  <p>
                    {receipt.receiptDetails.recipientName ||
                      'Nome não identificado'}
                  </p>
                  {receipt.receiptDetails.recipientDocument && (
                    <p className="mt-1 text-xs text-muted-foreground">
                      CPF/CNPJ: ***
                      {receipt.receiptDetails.recipientDocument.slice(-4)}
                    </p>
                  )}
                  <dl className="mt-3 border-t border-primary/15 pt-2">
                    <dt className="text-sm font-semibold text-muted-foreground">
                      Banco recebedor
                    </dt>
                    <dd className="mt-1 font-bold text-primary">
                      {receipt.receiptDetails.recipientBank ||
                        'Não identificado no comprovante'}
                    </dd>
                  </dl>
                </div>
              </div>
              <div className="border-t pt-2 text-xs text-muted-foreground">
                <p>{receiptTransactionDisplay(receipt.receiptDetails).label}</p>
                <p className="mt-1 break-all font-mono">
                  {receiptTransactionDisplay(receipt.receiptDetails).value ||
                    'Não identificado'}
                </p>
              </div>
            </div>
          ) : (
            <div className="mt-3 rounded-lg border bg-secondary/30 p-2.5">
              <dl>
                <dt className="text-sm font-semibold text-muted-foreground">
                  Banco recebedor
                </dt>
                <dd className="mt-1 font-bold text-primary">
                  Não identificado no comprovante
                </dd>
              </dl>
              <p className="mt-2 text-xs text-muted-foreground">
                Em Editar venda, use Reler comprovante para tentar identificar.
              </p>
            </div>
          )}
          {showNotices && (
            <ReceiptReadingNotices
              financiallyReconciled={financiallyReconciled}
              receipt={receipt}
            />
          )}
        </section>
      ))}
    </div>
  );
}
