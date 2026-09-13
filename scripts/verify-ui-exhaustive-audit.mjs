import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const sales = readFileSync(
  'components/pdv/views/sales-production-view.tsx',
  'utf8',
);
const stock = readFileSync(
  'components/pdv/views/stock-production-view.tsx',
  'utf8',
);
const settings = readFileSync(
  'components/pdv/views/settings-production-view.tsx',
  'utf8',
);
const sell = readFileSync('components/pdv/sell-wizard.tsx', 'utf8');
const receiptEditor = readFileSync(
  'components/pdv/receipt-reconciliation-editor.tsx',
  'utf8',
);
const clientsDialog = settings.slice(
  settings.indexOf('function ClientsDialog('),
  settings.indexOf('function OrderStatusesDialog('),
);
const usersDialog = settings.slice(
  settings.indexOf('function UsersDialog('),
  settings.indexOf('function RecoveryCodesDialog('),
);

assert.match(
  sales,
  /if \(!openSaleId\) \{[\s\S]*?openedTargetRef\.current = '';[\s\S]*?return;/,
  'closing a targeted sale must allow the same sale to be opened again',
);
assert.match(
  sales,
  /if \(uploadInFlightRef\.current\) return;[\s\S]*?uploadInFlightRef\.current = true;/,
  'the composite sale editor must reject duplicate saves synchronously',
);
assert.match(
  sales,
  /finally \{[\s\S]*?uploadInFlightRef\.current = false;[\s\S]*?setUploadBusy\(false\);/,
  'the composite sale editor must release its save guard after completion',
);
assert.match(
  stock,
  /if \(!pdfBusy\) onOpenChange\(next\);/,
  'the stock report must remain open while its PDF is being generated',
);
assert.match(stock, /showCloseButton=\{!pdfBusy\}/);
assert.ok(
  (sales.match(/showCloseButton=\{!pdfBusy\}/g) ?? []).length >= 2,
  'single-sale and period sales reports must hide close controls during PDF generation',
);
assert.match(
  sales,
  /if \(!pdfBusy\) onOpenChange\(next\);/,
  'a single-sale report must remain mounted until its PDF is finished',
);
for (const [name, source] of [
  ['clients', clientsDialog],
  ['users', usersDialog],
]) {
  assert.match(source, /const busyRef = useRef\(false\);/);
  assert.match(
    source,
    /onOpenChange=\{\(next\) => \{[\s\S]*?if \(!busyRef\.current\) onOpenChange\(next\);/,
    `${name} dialog must reject close events while a mutation is in flight`,
  );
  assert.match(source, /showCloseButton=\{!busy\}/);
  assert.match(
    source,
    /if \(busyRef\.current\) return;[\s\S]*?busyRef\.current = true;/,
    `${name} mutations must be single-flight before React rerenders`,
  );
  assert.match(
    source,
    /finally \{[\s\S]*?busyRef\.current = false;[\s\S]*?setBusy\(false\);/,
  );
}
assert.match(
  usersDialog,
  /disabled=\{busy\}[\s\S]*?if \(!busyRef\.current\) onOpenChange\(false\);/,
  'the users footer close action must also honor the immediate mutation guard',
);
assert.match(sell, /label="Dinheiro recebido"/);
assert.match(sell, /receiptCount > 0/);
assert.match(sell, /'comprovante enviado'/);
assert.match(
  sell,
  /O Pix, o valor recebido e o status serão atualizados/,
  'a completed sale with a receipt must explain automatic reading instead of reporting zero Pix as pending',
);
assert.match(sell, /const receiptReading =/);
assert.match(sell, /reconciliation.status === 'pending'/);
assert.doesNotMatch(
  receiptEditor,
  /function ReceiptMoneyInput|Valor da transação/,
  'Pix receipt values must not be manually typed',
);
assert.match(receiptEditor, /Reler comprovante/);

console.log(
  'Exhaustive UI audit guards passed: navigation, single-flight mutations, protected reports and automatic-only Pix receipt reading.',
);
