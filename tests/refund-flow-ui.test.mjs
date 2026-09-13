import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';

const app=readFileSync(new URL('../public/app.mjs',import.meta.url),'utf8');
const server=readFileSync(new URL('../src/server.mjs',import.meta.url),'utf8');
const source=(from,to)=>{const start=app.indexOf(from),end=app.indexOf(to,start+from.length);assert.ok(start>=0&&end>start);return app.slice(start,end);};

test('devolução na interface: detalhe cancelado mostra gestão e módulo é servido com tipo seguro',()=>{
 const detail=source('function renderDetail()', 'function showCancellationRefresh()');
 assert.match(detail,/refundManagement\(s,\{esc,money,date,can\}\)/);
 assert.match(server,/\['\/refund-ui\.mjs', \['refund-ui\.mjs', 'text\/javascript; charset=utf-8'\]\]/);
 assert.match(app,/'sales\.refund':'Registrar devoluções realizadas'/);
 assert.match(app,/'sales\.refund_correct':'Corrigir baixas de devolução'/);
});

test('devolução na interface: correção explica que não movimenta dinheiro e usa token atual',async()=>{
 let shown;
 const ctx={
  can:permission=>permission==='sales.refund_correct',
  api:async()=>({id:'sale',status:'cancelled',cancellation:{refund_token:'token-atual',refunds:[{id:'refund-1',amount_cents:500,refunded_date:'2026-09-12',reversed:false}]}}),
  saoPauloToday:()=> '2026-09-13',money:value=>`R$ ${value}`,esc:String,paymentRequestId:()=> '00000000-0000-4000-8000-000000000002',
  field:(label,content)=>`<label>${label}${content}</label>`,input:(name,value)=>`<input name="${name}" value="${value}">`,
  showModal:(title,contents,id,attrs)=>{shown={title,contents,id,attrs};},modal:{querySelector:selector=>selector==='[type="submit"]'?{}:{textContent:''}}
 };
 runInNewContext(source('async function openRefundCorrectionModal(', 'function showModal('),ctx);
 await ctx.openRefundCorrectionModal('sale','refund-1');
 assert.equal(shown.title,'Corrigir baixa de devolução');assert.equal(shown.id,'refund-reversal-form');
 assert.match(shown.attrs,/data-id="sale" data-refund-id="refund-1"/);assert.match(shown.contents,/token-atual/);
 assert.match(shown.contents,/lançada por engano/);assert.match(shown.contents,/não cobra o cliente/);assert.match(shown.contents,/name="acknowledge_refund_reversal" required/);
});

test('devolução na interface: envio da correção não aceita valor do navegador e atualiza o detalhe',()=>{
 const submit=source("else if(form.id==='refund-reversal-form')", "else if(form.id==='filter-form')");
 assert.match(submit,/\/refunds\/\$\{form\.dataset\.refundId\}\/reversal/);
 const payload=submit.match(/\/reversal`,\{([^}]+)\}\)/)?.[1]??'';assert.ok(payload);assert.doesNotMatch(payload,/amount_cents/);
 assert.match(submit,/acknowledge_refund_reversal:new FormData\(form\)\.has/);assert.match(submit,/detailId=form\.dataset\.id;detailSale=null;view='detail'/);
 assert.match(submit,/voltou a aparecer como valor a devolver/);
});

test('devolução na interface: modal explica a ação real e usa o saldo mais recente',async()=>{
 let shown;
 const ctx={
  can:permission=>permission==='sales.refund',
  api:async()=>({id:'sale',status:'cancelled',cancellation:{created_at:'2026-09-12T12:00:00.000Z',refund_pending_cents:750,refund_token:'token-seguro'}}),
  saoPauloToday:value=>value?'2026-09-12':'2026-09-13',money:value=>`R$ ${value}`,value:value=>String(value/100).replace('.',','),esc:String,
  paymentRequestId:()=> '00000000-0000-4000-8000-000000000001',field:(label,content)=>`<label>${label}${content}</label>`,
  input:(name,value)=>`<input name="${name}" value="${value}">`,refundMethodOptions:()=>'<option value="pix">Pix</option>',
  showModal:(title,contents,id,attrs)=>{shown={title,contents,id,attrs};},
  modal:{querySelector:selector=>selector==='[type="submit"]'?{}:{textContent:''}}
 };
 runInNewContext(source('async function openRefundModal(', 'function showModal('),ctx);
 await ctx.openRefundModal('sale');
 assert.equal(shown.title,'Registrar devolução realizada');assert.equal(shown.id,'refund-form');assert.match(shown.attrs,/data-id="sale"/);
 assert.match(shown.contents,/Falta devolver ao cliente/);assert.match(shown.contents,/R\$ 750/);assert.match(shown.contents,/token-seguro/);
 assert.match(shown.contents,/depois.*dinheiro tiver sido devolvido/s);assert.match(shown.contents,/não faz Pix nem estorno/);
 assert.match(shown.contents,/name="acknowledge_refund_completed" required/);
});

test('devolução na interface: envio registra uma vez e atualiza o detalhe sem repetir a operação',()=>{
 const submit=source("else if(form.id==='refund-form')", "else if(form.id==='filter-form')");
 assert.match(submit,/\/sales\/\$\{form\.dataset\.id\}\/refunds/);
 assert.match(submit,/amount_cents:cents\(d\.amount\)/);assert.match(submit,/acknowledge_refund_completed:new FormData\(form\)\.has/);
 assert.match(submit,/detailId=form\.dataset\.id;detailSale=null;view='detail'/);
 assert.match(submit,/await finishMutation/);
});
