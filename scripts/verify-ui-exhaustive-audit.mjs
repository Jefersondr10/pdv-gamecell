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
const saleList = sales.slice(
  sales.indexOf('function SaleList('),
  sales.indexOf('function GroupedList('),
);
const editSaleDialog = sales.slice(
  sales.indexOf('function EditSaleDialog('),
  sales.indexOf('function MediaPickerButtons('),
);
const saleDateDialog = sales.slice(
  sales.indexOf('function SaleDateDialog('),
  sales.indexOf('function CancelDialog('),
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
assert.match(saleList, /<article/);
assert.match(
  saleList,
  /<\/button>\s*<SaleActionsMenu/,
  'the actions trigger must be a sibling of the sale card button',
);
assert.match(
  sales,
  /const canEdit = canAny\(data\.user, \[[\s\S]*?'sales\.participants'[\s\S]*?'sales\.payments'[\s\S]*?'sales\.attachments'[\s\S]*?'sales\.receipts'[\s\S]*?'sales\.receipts\.delete'[\s\S]*?'sales\.prices'[\s\S]*?'sales\.status'[\s\S]*?\]\);/,
  'Editar venda must restore every permission supported by the full editor',
);
assert.match(
  sales,
  /const canEditInfo = canAny\(data\.user, \[[\s\S]*?'sales\.participants'[\s\S]*?'sales\.status'[\s\S]*?\]\);/,
  'the focused status, customer and seller action must use only its relevant permissions',
);
assert.match(
  sales,
  /const canManageReceipts = canAny\(data\.user, \[[\s\S]*?'sales\.attachments'[\s\S]*?'sales\.receipts'[\s\S]*?'sales\.receipts\.delete'[\s\S]*?\]\);/,
  'the focused receipt action must be available to every receipt-management permission',
);
for (const label of [
  'Ver detalhes',
  'Editar venda',
  'Status, cliente e vendedor',
  'Pagamentos / preço de venda',
  'Fotos dos aparelhos',
  'Alterar data e horário',
  'Abrir PDF',
  'Cancelar venda',
])
  assert.match(saleList, new RegExp(label));
assert.doesNotMatch(
  saleList,
  /Comprovantes e releitura|Adicionar comprovante|Dinheiro recebido|Status da venda/,
  'the menu must keep payments and sale editing consolidated',
);
assert.doesNotMatch(editSaleDialog, /initialSection|scrollIntoView/);
assert.match(
  sales,
  /type SaleEditorMode = 'full' \| 'info' \| 'payments' \| 'photos';/,
);
assert.match(
  editSaleDialog,
  /const editsInfo = mode === 'full' \|\| mode === 'info';/,
  'the full and focused info editors must share participants and status',
);
assert.match(
  editSaleDialog,
  /const editsPayments = mode === 'full' \|\| mode === 'payments';/,
  'the full and focused payments editors must share receipt polling and payment logic',
);
assert.match(
  editSaleDialog,
  /const editsPhotos = mode === 'full' \|\| mode === 'photos';/,
  'the full and focused photo editors must share attachment logic',
);
assert.match(
  editSaleDialog,
  /participantsSaved = editsInfo\s*\? await participants\.save\(\)\s*: false/,
);
assert.match(editSaleDialog, /if \(editsPayments && hasPaymentCorrections\)/);
assert.match(
  editSaleDialog,
  /editsInfo &&\s*selectedStatusId !== currentStatusId/,
);
assert.match(
  editSaleDialog,
  /\.\.\.\(editsPayments \? receiptFiles : \[\]\),[\s\S]*?\.\.\.\(editsPhotos \? selectedItemFiles : \[\]\)/,
  'the full editor must save receipt and device-photo attachments together',
);
assert.match(
  editSaleDialog,
  /\(mode === 'full' \|\| mode === 'payments'\) &&[\s\S]*?can\(data\.user, 'sales\.prices'\)/,
  'prices must be available in the full and payments/price editors instead of the focused info editor',
);
assert.match(
  sales,
  /key=\{editSale \? `\$\{editSaleMode\}:\$\{editSale\.id\}`/,
);
assert.match(saleDateDialog, /const savingRef = useRef\(false\)/);
assert.match(
  saleDateDialog,
  /if \(savingRef\.current \|\| !sale \|\| !current \|\| parsed === null\)/,
  'date changes must be single-flight before React rerenders',
);
assert.match(saleDateDialog, /showCloseButton=\{!busy\}/);
assert.match(saleDateDialog, /type="datetime-local"/);

console.log(
  'Exhaustive UI audit guards passed: navigation, single-flight mutations, protected reports, sale actions/date editing and automatic-only Pix receipt reading.',
);
