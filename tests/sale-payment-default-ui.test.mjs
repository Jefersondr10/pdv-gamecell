import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';

const source=readFileSync(new URL('../public/app.mjs',import.meta.url),'utf8');

function preferredHarness(rates){
 const start=source.indexOf('const preferredPaymentMethod =');
 const end=source.indexOf('const pixAccountOptions',start);
 const ctx={state:{rates}};
 runInNewContext(`${source.slice(start,end)};this.preferredPaymentMethod=preferredPaymentMethod;`,ctx);
 return ctx;
}

test('novo pagamento prefere cartão quando existe uma taxa de crédito',()=>{
 assert.equal(preferredHarness([{mode:'debit'},{mode:'credit'}]).preferredPaymentMethod(),'card');
 assert.equal(preferredHarness([{mode:'debit'}]).preferredPaymentMethod(),'pix');
 assert.equal(preferredHarness([]).preferredPaymentMethod(),'pix');
});

test('selecionar cartão inicia a modalidade em Crédito',()=>{
 const start=source.indexOf('function changePaymentMethod(');
 const end=source.indexOf('function editorSellerOptions(',start);
 const ctx={defaultPixAccountId:value=>value};
 runInNewContext(source.slice(start,end),ctx);
 const payment={method:'pix',mode:'debit',saved:false,rate_id:'taxa-anterior'};
 ctx.changePaymentMethod(payment,'card');
 assert.equal(payment.method,'card');assert.equal(payment.mode,'credit');assert.equal(payment.rate_id,'');
});

test('botão de adicionar pagamento grava Cartão e Crédito como padrão disponível',()=>{
 assert.match(source,/a==='add-payment'\)\{const method=preferredPaymentMethod\(\);working\.payments\.push\(\{request_id:paymentRequestId\(\),method,mode:method==='card'\?'credit':''/);
 const modal=source.slice(source.indexOf('function openPaymentModal('),source.indexOf('function customerFormFields('));
 assert.match(modal,/if\(method==='card'&&!values\.mode\)values\.mode='credit'/);
});
