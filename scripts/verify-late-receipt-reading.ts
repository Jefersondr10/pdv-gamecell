import assert from 'node:assert/strict';
import {
  extractReceiptDocument,
  preferReceiptReading,
} from '../lib/receipt-document.ts';

const fixture = (header: string, ending = '') => `${header}
12/09/2026 14:30:00
Valor: R$ 6.640,00
Pagador
Nome: Cliente fictício
Banco: Banco de teste
Recebedor
Nome: Loja fictícia
Banco: Banco recebedor
CPF/CNPJ: ***.123.***-**
ID de transação Pix
E0000000000000000000000000000001
${ending}`;

for (const header of [
  'Pronto! Seu pagamento foi realizado.',
  'Comprovante do Pix',
  'Transferência foi efetuada',
  'Pix efetuado',
  'Comprovante de Pix',
  'Comprovante de\ntransferência\nPix',
]) {
  const reading = extractReceiptDocument(fixture(header));
  assert.equal(reading.amountCents, 664000);
  assert.equal(reading.details.state, 'completed', header);
  assert.equal(reading.details.blocked, false, header);
}

const complete = extractReceiptDocument(
  fixture('Pronto! Seu pagamento foi realizado.'),
);
const unknown = extractReceiptDocument(fixture('Dados da transação'));
assert.equal(unknown.details.state, 'unknown');
assert.equal(complete.details.recipientDocument, null);
assert.equal(complete.details.automaticEligible, true);
assert.equal(
  preferReceiptReading([unknown, complete]).details.state,
  'completed',
);

for (const status of [
  'Agendado',
  'Agendamento',
  'Cancelado',
  'Estornado',
  'Recusado',
  'Negado',
  'Pagamento não autorizado',
  'Pagamento não aprovado',
  'Pagamento não foi realizado',
  'Transferência não foi concluída',
  'Não efetivada',
  'Pagamento não efetuado',
  'Transferência não foi efetuada',
  'Não enviado',
  'Em processamento',
  'Em análise',
  'Pendente',
  'Aguardando',
  'Não foi possível',
]) {
  for (const header of [
    'Comprovante do Pix',
    'Comprovante de\ntransferência\nPix',
  ]) {
    const blocked = extractReceiptDocument(fixture(header, status));
    assert.equal(blocked.details.blocked, true, status);
    const preferred = preferReceiptReading([complete, blocked]);
    assert.equal(preferred.details.blocked, true, status);
    assert.equal(preferred.details.automaticEligible, false, status);
  }
}
for (const conflicting of [
  fixture('Comprovante de Pix').replace('6.640,00', '6.650,00'),
  fixture('Comprovante de Pix').replace(/0001\n/, '0002\n'),
]) {
  const selected = preferReceiptReading([
    complete,
    extractReceiptDocument(conflicting),
  ]);
  assert.equal(selected.details.ambiguous, true);
  assert.equal(selected.details.automaticEligible, false);
}
assert.equal(
  extractReceiptDocument('Valor: R$ 6.640,00').details.state,
  'unknown',
);
assert.equal(
  extractReceiptDocument(fixture('Solicitação de transferência')).details.state,
  'unknown',
);
console.log(
  'PASS: completed Pix wording, stronger OCR with masked document, conflicts and uncompleted payments stay blocked.',
);
