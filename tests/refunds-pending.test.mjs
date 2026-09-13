import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdtempSync,rmSync,readFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { Store } from '../src/store.mjs';
import { application } from '../src/server.mjs';
import { businessDate } from '../src/domain.mjs';
import { pendingRefunds } from '../src/sale-cancellation.mjs';
import { refundReminders,refundBadge,cancellationPayments } from '../public/sales-view.mjs';
import { refundCashNotice } from '../public/finance-ui.mjs';

function setup(t,path=':memory:'){
 const db=new Store(path);t.after(()=>db.close());
 const token=db.register({name:'Teste',store_name:'Devoluções teste',email:'refund@example.test',password:'senha-ficticia-de-teste'}).token,actor=db.actor(token);
 const customer=db.addCustomer(actor,{name:'Cliente <fictício>'}),product=db.addProduct(actor,{name:'Produto teste',price_cents:1000});
 db.receive(actor,{product_id:product.id,quantity:20,unit_cost_cents:300});return {db,actor,customer,product,token};
}
function sale(x,{paid=1000,confirmed=true,seller=x.actor.id}={}){
 const id=x.db.saveDraft(x.actor,{customer_id:x.customer.id,seller_id:seller,items:[{product_id:x.product.id,quantity:1,unit_price_cents:1000}]}).id;
 if(paid)x.db.addPayment(x.actor,id,{request_id:randomUUID(),method:'cash',amount_cents:paid});if(confirmed)x.db.confirm(x.actor,id,true);return id;
}
const data=(x,id,extra={})=>({request_id:randomUUID(),edit_token:x.db.sale(x.actor,id).edit_token,reason:'Cliente desistiu',acknowledge_stock_return:true,acknowledge_refund_pending:true,...extra});
const cancel=(x,id,extra={})=>x.db.operations.cancelSale(x.actor,id,data(x,id,extra));
const stock=x=>x.db.products(x.actor).find(p=>p.id===x.product.id).stock;

test('devolução: parcial, integral e excedente usam bruto recebido, sem inventar valor restante',t=>{
 const x=setup(t);
 for(const paid of [0,250,1000,1250]){
  const id=sale(x,{paid}),payload=data(x,id,{refund_pending_cents:1});const before=stock(x);
  const result=x.db.operations.cancelSale(x.actor,id,payload);assert.equal(result.refund_pending_cents,paid);
  const s=x.db.sale(x.actor,id);assert.equal(s.cancellation.refund_pending_cents,paid);assert.equal(s.cancellation.refund_state,paid?'pending':'not_required');
  assert.equal(s.reconciliation.gross_cents,paid);assert.equal(s.reconciliation.pending_cents,0);assert.equal(s.profit_cents,null);assert.equal(stock(x),before+1);
  assert.equal(s.items[0].received_cents,Math.min(1000,paid));
  assert.equal(x.db.operations.cancelSale(x.actor,id,payload).replayed,true);assert.equal(stock(x),before+1);
 }
 assert.equal(x.db.snapshot(x.actor).refunds_pending.total_cents,2500);assert.equal(x.db.snapshot(x.actor).refunds_pending.count,3);
});

test('devolução: Pix, cartão e dinheiro preservados, taxa não reduz devolução e links ficam revogados',t=>{
 const x=setup(t),id=sale(x,{paid:0}),pix=x.db.savePixAccount(x.actor,{name:'Conta de teste'}),rate=x.db.saveRate(x.actor,{machine:'Máquina teste',brand:'Visa',mode:'credit',installments:18,basis_points:1500});
 const requests=[{method:'pix',pix_account_id:pix.id,amount_cents:200},{method:'card',rate_id:rate.id,amount_cents:800},{method:'cash',amount_cents:100}].map(p=>({...p,request_id:randomUUID()}));
 for(const p of requests)x.db.addPayment(x.actor,id,p);
 const link=x.db.share(x.actor,id).token,tables=['payments','payment_requests','payment_changes'],before=tables.map(table=>x.db.all('SELECT * FROM '+table)),photo=x.db.fullSale(x.actor,id);
 cancel(x,id);const s=x.db.sale(x.actor,id);assert.equal(s.cancellation.refund_pending_cents,1100);assert.equal(s.reconciliation.fee_cents,120);assert.equal(s.reconciliation.net_cents,980);assert.deepEqual(s.payments,photo.payments.map(p=>({...p})));
 assert.deepEqual(tables.map(table=>x.db.all('SELECT * FROM '+table)),before);assert.throws(()=>x.db.public(link),/inválido/);
 assert.equal(x.db.addPayment(x.actor,id,requests[0]).replayed,true);assert.throws(()=>x.db.addPayment(x.actor,id,{...requests[0],request_id:randomUUID()}),/cancelada/);
 assert.equal(x.db.snapshot(x.actor).dashboard.gross_cents,0);assert.equal(x.db.snapshot(x.actor).dashboard.profit_cents,0);
 x.db.saveRate(x.actor,{machine:'Máquina teste',brand:'Visa',mode:'credit',installments:18,basis_points:2000},rate.id);
 assert.equal(x.db.sale(x.actor,id).cancellation.refund_pending_cents,1100);assert.equal(x.db.sale(x.actor,id).reconciliation.fee_cents,120);
});

test('devolução: correção anterior considera pagamento efetivo, não soma registros substituídos',t=>{
 const x=setup(t),id=sale(x),s=x.db.sale(x.actor,id);
 x.db.operations.editSale(x.actor,id,{request_id:randomUUID(),edit_token:s.edit_token,reason:'Corrigir valor digitado',customer_id:s.customer_id,seller_id:s.seller_id,items:s.items,payments:[{id:s.payments[0].id,method:'cash',amount_cents:400,paid_date:businessDate()}],acknowledge_difference:true});
 assert.equal(x.db.all('SELECT * FROM payments').length,2);assert.equal(x.db.fullSale(x.actor,id).reconciliation.gross_cents,400);
 cancel(x,id);assert.equal(x.db.sale(x.actor,id).cancellation.refund_pending_cents,400);assert.equal(x.db.snapshot(x.actor).refunds_pending.total_cents,400);
});

test('devolução: ciência estrita e token desatualizado não cancelam nem criam pendência',t=>{
 const x=setup(t),id=sale(x),s=x.db.fullSale(x.actor,id);
 for(const acknowledge of [undefined,false,'true',1])assert.throws(()=>cancel(x,id,{acknowledge_refund_pending:acknowledge}),/devolução pendente/);
 const stale=data(x,id);x.db.addPayment(x.actor,id,{request_id:randomUUID(),method:'cash',amount_cents:50});
 assert.throws(()=>x.db.operations.cancelSale(x.actor,id,stale),/venda mudou/);
 assert.equal(x.db.fullSale(x.actor,id).status,s.status);assert.equal(x.db.snapshot(x.actor).refunds_pending.count,0);
});

test('devolução: agregado pode ultrapassar teto de uma venda sem perder centavos',t=>{
 const x=setup(t);for(let i=0;i<2;i++){const id=sale(x,{paid:100_000_000_000});cancel(x,id);}
 assert.equal(x.db.snapshot(x.actor).refunds_pending.total_cents,200_000_000_000);
 assert.throws(()=>pendingRefunds({all:()=>[{pending_cents:Number.MAX_SAFE_INTEGER},{pending_cents:1}]},x.actor),/representação exata/);
});

test('devolução: pendência de rascunho pago persiste após reabrir sem devolver estoque inexistente',()=>{
 const dir=mkdtempSync(join(tmpdir(),'pdv-refund-')),path=join(dir,'fake.sqlite');let db;
 try{
  const x=setup({after(){}},path);db=x.db;const id=sale(x,{paid:500,confirmed:false}),before=stock(x);cancel(x,id);assert.equal(stock(x),before);
  db.close();db=new Store(path);x.db=db;const s=db.sale(x.actor,id);
  assert.equal(s.cancellation.refund_pending_cents,500);assert.equal(db.snapshot(x.actor).refunds_pending.total_cents,500);assert.equal(stock(x),before);assert.deepEqual(db.all('PRAGMA foreign_key_check'),[]);
 }finally{db?.close();rmSync(dir,{recursive:true,force:true});}
});

test('devolução: lista ignora filtros da página mas respeita loja e vendas visíveis ao vendedor',t=>{
 const x=setup(t),user=x.db.addUser(x.actor,{name:'Equipe',email:'equipe@example.test',password:'senha-ficticia-de-teste',permissions:['finance.view']}),staff={...x.actor,id:user.id,is_owner:false,permissions:['finance.view']};
 const own=sale(x),assigned=sale(x,{paid:500,seller:user.id});cancel(x,own);cancel(x,assigned);
 x.db.run("UPDATE sales SET business_date='2026-07-10' WHERE tenant_id=?",x.actor.tenant_id);
 const filters={from:'2026-09-08',to:'2026-09-08',status:'confirmed',seller_id:x.actor.id};
 const snapshot=x.db.snapshot(staff,filters);assert.deepEqual(snapshot.sales,[]);assert.equal(snapshot.refunds_pending.count,1);assert.equal(snapshot.refunds_pending.items[0].id,assigned);
 const global=x.db.finance.report(staff,'2026-09').refunds_pending;assert.equal(global.total_cents,1500);assert.equal(global.items,undefined);
 assert.throws(()=>pendingRefunds(x.db,{...staff,permissions:[]},{shopWide:true}),/Acesso/);
 const other=x.db.actor(x.db.register({name:'Outra',store_name:'Outra loja',email:'outra@example.test',password:'senha-ficticia-de-teste'}).token);
 assert.equal(x.db.snapshot(other).refunds_pending.count,0);assert.throws(()=>x.db.sale(other,own),/encontrad/);
 const restricted=x.db.sale(staff,assigned);assert.equal(restricted.reconciliation.fee_cents,undefined);assert.equal(restricted.items[0].cost_cents,undefined);assert.equal(restricted.cancellation.refund_pending_cents,500);
});

function close(x,month,extra={}){const result=x.db.finance.report(x.actor,month).result;return x.db.finance.closeMonth(x.actor,{month,source_hash:result.source_hash,settings_version:result.settings_version,cash_available_cents:5000,...extra});}
function cashAck(x){return {acknowledge_refund_reserve:true,refunds_token:x.db.finance.report(x.actor,'2026-08').refunds_pending.token};}
test('devolução: mês anterior fechado preserva fonte e valores, caixa antigo fica a conferir',t=>{
 const x=setup(t),old=sale(x);x.db.run("UPDATE sales SET business_date='2026-08-10' WHERE id=?",old);close(x,'2026-08');
 const before=x.db.all('SELECT * FROM finance_closures'),hash=x.db.finance.calculate(x.actor,'2026-08').source_hash;
 const current=sale(x);cancel(x,current);
 const report=x.db.finance.report(x.actor,'2026-08');assert.equal(report.source_changed,false);assert.equal(report.result.source_hash,hash);assert.deepEqual(x.db.all('SELECT * FROM finance_closures'),before);
 assert.equal(report.refunds_pending.total_cents,1000);assert.equal(report.cash_recheck_required,true);assert.equal(report.cash_after_planned_cents,null);assert.equal(report.cash_after_recorded_cents,null);
 assert.equal(report.result.cash_available_cents,5000);
});

test('devolução: fechar exige reserva atual, sem descontar novamente do resultado ou caixa informado',t=>{
 const x=setup(t),id=sale(x);cancel(x,id);const stale=cashAck(x);const another=sale(x);cancel(x,another);
 assert.throws(()=>close(x,'2026-08'),/separou/);assert.throws(()=>close(x,'2026-08',stale),/mudaram/);
 const report=close(x,'2026-08',cashAck(x));assert.equal(report.result.result_cents,0);assert.equal(report.result.cash_available_cents,5000);
 assert.equal(x.db.all('SELECT * FROM finance_closures').length,1);assert.equal(close(x,'2026-08').closed,true);
});

test('devolução: retirada exige ciência atual dentro da transação e replay permanece idempotente',t=>{
 const x=setup(t),settings=x.db.finance.settings(x.actor);
 x.db.finance.saveSettings(x.actor,{version:settings.version,reserve_basis_points:0,partners:[{name:'Sócio',basis_points:10000}]});
 const old=sale(x);x.db.run("UPDATE sales SET business_date='2026-08-10' WHERE id=?",old);const r=close(x,'2026-08');
 const id=sale(x);cancel(x,id);const payload={request_id:randomUUID(),partner_id:r.result.partners[0].id,amount_cents:100,paid_date:businessDate(),notes:'Retirada teste'};
 assert.throws(()=>x.db.finance.withdraw(x.actor,r.closure_id,payload),/separou/);assert.equal(x.db.all('SELECT * FROM profit_withdrawals').length,0);
 const ack=cashAck(x);const another=sale(x);cancel(x,another);assert.throws(()=>x.db.finance.withdraw(x.actor,r.closure_id,{...payload,...ack}),/mudaram/);
 const fresh={...payload,...cashAck(x)};x.db.finance.withdraw(x.actor,r.closure_id,fresh);
 const third=sale(x);cancel(x,third);x.db.finance.withdraw(x.actor,r.closure_id,fresh);assert.equal(x.db.all('SELECT * FROM profit_withdrawals').length,1);
});

test('HTTP devolução: confirmação e resumo persistem em chamada autenticada, nova cobrança bloqueada',async t=>{
 const x=setup(t),id=sale(x),origin='http://127.0.0.1:3999',{server}=application({store:x.db,origin});
 await new Promise(r=>server.listen(0,'127.0.0.1',r));t.after(()=>new Promise(r=>server.close(r)));
 const base='http://127.0.0.1:'+server.address().port,headers={Cookie:'pdv_session='+x.token,Origin:origin,'Content-Type':'application/json'};
 const post=(path,payload)=>fetch(base+'/api'+path,{method:'POST',headers,body:JSON.stringify(payload)});
 assert.equal((await post('/sales/'+id+'/cancel',data(x,id,{acknowledge_refund_pending:false}))).status,400);
 const payload=data(x,id),responses=await Promise.all([post('/sales/'+id+'/cancel',payload),post('/sales/'+id+'/cancel',payload)]);assert.deepEqual(responses.map(r=>r.status),[200,200]);
 const state=await (await fetch(base+'/api/state?status=confirmed&from=2026-01-01&to=2026-01-01',{headers})).json();assert.deepEqual(state.sales,[]);assert.equal(state.refunds_pending.total_cents,1000);
 assert.equal((await post('/sales/'+id+'/payments',{method:'cash',amount_cents:1,request_id:randomUUID()})).status,409);
});

test('interface devolução: alerta orienta abrir o pedido e pagamentos históricos continuam escapados',()=>{
 const esc=v=>String(v??'').replaceAll('<','&lt;').replaceAll('"','&quot;'),money=String;
 const summary={count:1,total_cents:1000,items:[{id:'x',number:1,customer_name:'<script>',pending_cents:1000}]};
 const html=refundReminders(summary,{esc,money});assert.match(html,/Valores a devolver/);assert.match(html,/Registrar devolução realizada/);assert.match(html,/data-action="open-sale"/);assert.doesNotMatch(html,/<script>/);assert.equal(refundReminders({count:0},{esc,money}),'');
 assert.match(refundBadge({cancellation:{refund_pending_cents:1000}},money),/Falta devolver · 1000/);
 const history=cancellationPayments({reconciliation:{gross_cents:1000},payments:[{method:'pix',amount_cents:1000,pix_account_name:'<Conta>'}]},{esc,money});assert.match(history,/Histórico preservado/);assert.doesNotMatch(history,/<Conta>|data-action=/);
 assert.match(refundCashNotice(summary,money),/Separe este valor antes das retiradas/);
 const app=readFileSync(new URL('../public/app.mjs',import.meta.url),'utf8');assert.match(app,/acknowledge_refund_pending:new FormData\(form\).has/);
 const finance=readFileSync(new URL('../public/finance-ui.mjs',import.meta.url),'utf8');
 assert.match(finance,/name="acknowledge_refund_reserve" required/);assert.match(finance,/refunds_token:d.refunds_token,acknowledge_refund_reserve:new FormData\(form\).has/g);
 assert.match(finance,/mesmo sem pagamento recebido/);
});
