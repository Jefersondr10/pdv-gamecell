import type { SaleRecord } from './pdv-types.ts';
import { saleIssues, type SaleIssueKey } from './sale-display-status.ts';
import { saleReceiptIncome } from './receipt-income.ts';
import {
  receiptNoticeSentence,
  splitReceiptReadingNotices,
} from './receipt-reading-notices.ts';

export type SalePendingAction =
  | 'prices'
  | 'receipts'
  | 'cash'
  | 'photos'
  | 'view_receipts';
export type SalePendingItem = {
  key: SaleIssueKey;
  title: string;
  reasons: string[];
  actions: { key: SalePendingAction; label: string }[];
};
const money = (cents: number) =>
  (cents / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
export function salePendingItems(sale: SaleRecord): SalePendingItem[] {
  const income = saleReceiptIncome(sale);
  return saleIssues(sale).map((issue) => {
    const base = { key: issue.key, title: issue.label };
    switch (issue.key) {
      case 'missing_price':
        return {
          ...base,
          reasons: ['Preencha um preço válido para todos os aparelhos.'],
          actions: [{ key: 'prices', label: 'Editar preços' }],
        };
      case 'missing_receipt':
        return {
          ...base,
          reasons: ['Existe saldo a receber e nenhum comprovante anexado.'],
          actions: [
            { key: 'receipts', label: 'Anexar comprovante' },
            { key: 'cash', label: 'Adicionar dinheiro' },
          ],
        };
      case 'pending_payment':
        return {
          ...base,
          reasons: [
            `Faltam ${money(sale.productsTotalCents - income.receivedTotalCents)} para completar a venda.`,
          ],
          actions: [
            { key: 'receipts', label: 'Conferir comprovantes' },
            { key: 'cash', label: 'Conferir dinheiro' },
          ],
        };
      case 'overpaid':
        return {
          ...base,
          reasons: [
            `Os recebimentos estão ${money(income.receivedTotalCents - sale.productsTotalCents)} acima da venda. Confira os valores e os anexos.`,
          ],
          actions: [
            { key: 'receipts', label: 'Conferir comprovantes' },
            { key: 'cash', label: 'Conferir dinheiro' },
            { key: 'prices', label: 'Conferir preços' },
          ],
        };
      case 'missing_photo':
        return {
          ...base,
          reasons: sale.items
            .filter((item) => !item.photos.length)
            .map((item) => `Falta foto do aparelho SN ${item.serial}.`),
          actions: [{ key: 'photos', label: 'Adicionar fotos' }],
        };
      case 'reading':
        return {
          ...base,
          reasons: [
            'A leitura está em andamento. O resultado será atualizado automaticamente.',
          ],
          actions: [{ key: 'view_receipts', label: 'Ver comprovantes' }],
        };
      case 'review': {
        const reasons = sale.receipts.flatMap((receipt, index) =>
          splitReceiptReadingNotices(receipt).blocking.map(
            (notice) =>
              `Comprovante ${index + 1}: ${receiptNoticeSentence(notice)}`,
          ),
        );
        return {
          ...base,
          reasons: reasons.length
            ? [...new Set(reasons)]
            : ['Confira a leitura e os possíveis comprovantes repetidos.'],
          actions: [
            { key: 'receipts', label: 'Revisar comprovantes' },
            { key: 'view_receipts', label: 'Ver documentos' },
          ],
        };
      }
    }
  });
}
