import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const source = readFileSync(
  'components/pdv/views/sales-production-view.tsx',
  'utf8',
);

assert.match(
  source,
  /const \[cashEditorOpen, setCashEditorOpen\] = useState\(false\)/,
);
assert.match(source, /!cashEditorOpen \? \(/);
assert.match(
  source,
  /hasSavedCashPayment[\s\S]*?'Alterar dinheiro'[\s\S]*?'Adicionar dinheiro'/,
);
assert.match(
  source,
  /const openCashEditor = \(\) => \{[\s\S]*?setCashEditorOpen\(true\)[\s\S]*?payment\.method === 'cash'[\s\S]*?formatMoneyInput\(payment\.amountCents\)/,
);
assert.match(source, /onClick=\{openCashEditor\}/);
assert.match(source, /id=\{`sale-\$\{sale\.id\}-cash-editor`\}/);
assert.match(
  source,
  /setPaymentAmount\(''\);[\s\S]*?setQueuedPayments\(\[\]\);[\s\S]*?setPaymentEdits\(\{\}\);[\s\S]*?setCashEditorOpen\(false\)/,
);

// The progressive editor must remain cash-only; Pix still comes exclusively
// from receipt reading and must not be offered as a manual payment option.
assert.match(
  source,
  /const paymentMethod = paymentAmount\.trim\(\) \? 'cash' : ''/,
);
assert.match(
  source,
  /O Pix vem do valor[\s\S]*?lido no comprovante, sem cadastro manual/,
);
assert.match(
  source,
  /activeReceipts\.map\(\(receipt\) => \(\{[\s\S]*?receiptDetails: receipt\.receiptDetails,[\s\S]*?receiptPaymentId: receipt\.receiptPaymentId,[\s\S]*?receiptReviewReason:/,
  'blocked receipt metadata must reach reconciliation instead of producing a false green match',
);

console.log('Cash payment progressive editor verified.');
