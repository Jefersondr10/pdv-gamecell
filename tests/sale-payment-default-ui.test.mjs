import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';

const source=readFileSync(new URL('../public/app.mjs',import.meta.url),'utf8');
const css=readFileSync(new URL('../public/brand.css',import.meta.url),'utf8');

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

test('pagamento mobile mostra o líquido individual e atualiza junto com o valor',()=>{
 const math=source.slice(source.indexOf('function paymentRateBasis('),source.indexOf('function normalizeCardSelection('));
 const markup=source.slice(source.indexOf('function paymentNetMarkup('),source.indexOf('function paymentEditorRows('));
 const ctx={state:{rates:[{id:'rate-6',basis_points:600}]},working:{items:[],payments:[{method:'card',rate_id:'rate-6',amount:'100,00'}]},cents:value=>Math.round(Number(String(value).replace(',','.'))*100),can:()=>true,money:value=>`R$ ${value}`};
 runInNewContext(math+markup,ctx);
 const totals=ctx.editorNumbers();
 assert.deepEqual(JSON.parse(JSON.stringify(totals.payments[0])),{amount:10000,basis:600,fee:600,net:9400});
 assert.match(ctx.paymentNetMarkup(ctx.working.payments[0],0),/data-payment-net="0"[\s\S]*Líquido a receber[\s\S]*data-payment-net-value/);
 assert.match(ctx.paymentNetMarkup(ctx.working.payments[0],0),/aria-live="polite"/);
 ctx.can=()=>false;assert.equal(ctx.paymentNetMarkup(ctx.working.payments[0],0),'');
 assert.match(source,/querySelectorAll\('\[data-payment-net\]'\)[\s\S]*data-payment-net-value[\s\S]*money\(payment\.net\)/);
 assert.match(source,/querySelectorAll\('\[data-payment-net-value\]'\)[^;]*target\.textContent='—'/);
 assert.match(css,/\.payment-net-summary\s*\{\s*display:none/);
 assert.match(css,/@media screen and \(max-width:700px\)[\s\S]*?\.mobile-flow \.payment-net-summary\s*\{[^}]*display:flex[^}]*justify-content:space-between/);
});
