import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { Store } from '../src/store.mjs';
import { application } from '../src/server.mjs';
import { businessDate } from '../src/domain.mjs';
import { pendingRefunds } from '../src/sale-cancellation.mjs';

function setup(t){
 const db=new Store();t.after(()=>db.close());
 const token=db.register({name:'Teste',store_name:'Cancelamentos teste',email:'refund@example.test',password:'senha-ficticia-de-teste'}).token,actor=db.actor(token);
 const customer=db.addCustomer(actor,{name:'Cliente fictício'}),product=db.addProduct(actor,{name:'Produto teste',price_cents:1000});
 db.receive(actor,{product_id:product.id,quantity:20,unit_cost_cents:300});return {db,actor,customer,product,token};
}

function sale(x,{paid=1000,confirmed=true,seller=x.actor.id}={}){
 const id=x.db.saveDraft(x.actor,{customer_id:x.customer.id,seller_id:seller,items:[{product_id:x.product.id,quantity:1,unit_price_cents:1000}]}).id;
 if(paid)x.db.addPayment(x.actor,id,{request_id:randomUUID(),method:'cash',amount_cents:paid});if(confirmed)x.db.confirm(x.actor,id,true);return id;
}

const data=(x,id,extra={})=>({request_id:randomUUID(),edit_token:x.db.sale(x.actor,id).edit_token,reason:'Cliente desistiu',...extra});
const cancel=(x,id,extra={})=>x.db.operations.cancelSale(x.actor,id,data(x,id,extra));
const stock=x=>x.db.products(x.actor).find(p=>p.id===x.product.id).stock;

test('nenhum cancelamento deixa valor a devolver, inclusive bruto parcial ou excedente',t=>{
 const x=setup(t);
 for(const paid of [0,250,1000,1250]){
  const id=sale(x,{paid}),before=stock(x),result=cancel(x,id),cancelled=x.db.sale(x.actor,id);
  assert.equal(result.refund_completed_cents,paid);assert.equal(result.refund_pending_cents,0);
  assert.equal(cancelled.cancellation.refund_original_cents,paid);assert.equal(cancelled.cancellation.refund_completed_cents,paid);
  assert.equal(cancelled.cancellation.refund_pending_cents,0);assert.equal(cancelled.cancellation.refund_state,paid?'completed':'not_required');
  assert.equal(cancelled.reconciliation.gross_cents,paid);assert.equal(cancelled.reconciliation.pending_cents,0);assert.equal(cancelled.profit_cents,null);
  assert.equal(stock(x),before+1);assert.equal(cancelled.items[0].received_cents,Math.min(1000,paid));
 }
 const snapshot=x.db.snapshot(x.actor);assert.deepEqual(snapshot.refunds_pending,{count:0,total_cents:0,items:[]});
});

test('Pix, cartão e dinheiro são fotografados, mas o total bruto inteiro é encerrado',t=>{
 const x=setup(t),id=sale(x,{paid:0}),pix=x.db.savePixAccount(x.actor,{name:'Conta de teste'}),rate=x.db.saveRate(x.actor,{machine:'Máquina teste',brand:'Visa',mode:'credit',installments:18,basis_points:1500});
 const requests=[{method:'pix',pix_account_id:pix.id,amount_cents:200},{method:'card',rate_id:rate.id,amount_cents:800},{method:'cash',amount_cents:100}].map(payment=>({...payment,request_id:randomUUID()}));
 for(const payment of requests)x.db.addPayment(x.actor,id,payment);
 const link=x.db.share(x.actor,id).token,tables=['payments','payment_requests','payment_changes'],before=tables.map(table=>x.db.all('SELECT * FROM '+table)),photo=x.db.fullSale(x.actor,id);
 cancel(x,id);const cancelled=x.db.sale(x.actor,id);
 assert.equal(cancelled.cancellation.refund_completed_cents,1100);assert.equal(cancelled.cancellation.refund_pending_cents,0);
 assert.equal(cancelled.reconciliation.fee_cents,120);assert.equal(cancelled.reconciliation.net_cents,980);assert.deepEqual(cancelled.payments,photo.payments.map(payment=>({...payment})));
 assert.deepEqual(tables.map(table=>x.db.all('SELECT * FROM '+table)),before);assert.throws(()=>x.db.public(link),/inválido/);
 assert.equal(x.db.snapshot(x.actor).dashboard.gross_cents,0);assert.equal(x.db.snapshot(x.actor).dashboard.profit_cents,0);
});

test('cancelamento usa somente os pagamentos efetivos após uma correção',t=>{
 const x=setup(t),id=sale(x),current=x.db.sale(x.actor,id);
 x.db.operations.editSale(x.actor,id,{request_id:randomUUID(),edit_token:current.edit_token,reason:'Corrigir valor digitado',customer_id:current.customer_id,seller_id:current.seller_id,
  items:current.items,payments:[{id:current.payments[0].id,method:'cash',amount_cents:400,paid_date:businessDate()}],acknowledge_difference:true});
 assert.equal(x.db.all('SELECT * FROM payments').length,2);assert.equal(x.db.fullSale(x.actor,id).reconciliation.gross_cents,400);
 const result=cancel(x,id),refund=x.db.get('SELECT * FROM sale_refunds WHERE tenant_id=? AND sale_id=?',x.actor.tenant_id,id);
 assert.equal(result.refund_completed_cents,400);assert.equal(result.refund_pending_cents,0);assert.equal(refund.amount_cents,400);
});

test('cancelar não exige confirmações redundantes, mas mantém token de concorrência',t=>{
 const x=setup(t),id=sale(x),stale=data(x,id);x.db.addPayment(x.actor,id,{request_id:randomUUID(),method:'cash',amount_cents:50});
 assert.throws(()=>x.db.operations.cancelSale(x.actor,id,stale),/venda mudou/i);
 const current=data(x,id,{acknowledge_stock_return:false,acknowledge_refund_pending:false}),result=x.db.operations.cancelSale(x.actor,id,current);
 assert.equal(result.cancelled,true);assert.equal(result.refund_completed_cents,1050);assert.equal(result.refund_pending_cents,0);
});

test('rascunho pago também é encerrado sem movimentar estoque inexistente',t=>{
 const x=setup(t),id=sale(x,{paid:500,confirmed:false}),before=stock(x);cancel(x,id);const cancelled=x.db.sale(x.actor,id);
 assert.equal(stock(x),before);assert.equal(cancelled.status,'cancelled');assert.equal(cancelled.cancellation.refund_completed_cents,500);
 assert.equal(cancelled.cancellation.refund_pending_cents,0);assert.equal(x.db.snapshot(x.actor).refunds_pending.total_cents,0);
});

test('relatório financeiro não cria alerta nem reserva de caixa para venda cancelada',t=>{
 const x=setup(t),id=sale(x);cancel(x,id);const report=x.db.finance.report(x.actor,'2026-08');
 assert.deepEqual(report.refunds_pending.count,0);assert.deepEqual(report.refunds_pending.total_cents,0);assert.equal(report.cash_recheck_required,false);
 assert.equal(report.result.result_cents,0);assert.equal(report.result.sales_count,0);
 const closed=x.db.finance.closeMonth(x.actor,{month:'2026-08',source_hash:report.result.source_hash,settings_version:report.result.settings_version,cash_available_cents:5000});
 assert.equal(closed.closed,true);assert.equal(closed.result.cash_available_cents,5000);
 const audit=JSON.parse(x.db.get("SELECT data_json FROM audit WHERE tenant_id=? AND entity='finance_closure' AND action='closed'",x.actor.tenant_id).data_json);
 assert.equal(audit.refund_reserve_acknowledged_cents,0);
});

test('retirada não pede ciência de devolução depois de cancelamentos',t=>{
 const x=setup(t),settings=x.db.finance.settings(x.actor);
 x.db.finance.saveSettings(x.actor,{version:settings.version,reserve_basis_points:0,partners:[{name:'Sócio',basis_points:10000}]});
 const sold=sale(x);x.db.run("UPDATE sales SET business_date='2026-08-10' WHERE id=?",sold);
 const before=x.db.finance.report(x.actor,'2026-08'),closed=x.db.finance.closeMonth(x.actor,{month:'2026-08',source_hash:before.result.source_hash,settings_version:before.result.settings_version,cash_available_cents:2000});
 const current=sale(x);cancel(x,current);
 const withdrawal=x.db.finance.withdraw(x.actor,closed.closure_id,{request_id:randomUUID(),partner_id:closed.result.partners[0].id,amount_cents:100,paid_date:businessDate(),notes:'Retirada teste'});
 assert.equal(withdrawal.amount_cents,100);assert.equal(x.db.all('SELECT * FROM profit_withdrawals').length,1);
});

test('resumo vazio respeita permissão financeira no escopo global',t=>{
 const x=setup(t),id=sale(x);cancel(x,id);
 assert.deepEqual(pendingRefunds(x.db,x.actor),{count:0,total_cents:0,items:[]});
 const global=pendingRefunds(x.db,x.actor,{shopWide:true});assert.equal(global.count,0);assert.equal(global.total_cents,0);assert.match(global.token,/^[a-f0-9]{64}$/);
 assert.throws(()=>pendingRefunds(x.db,{...x.actor,is_owner:false,permissions:[]},{shopWide:true}),/Acesso/);
});

test('HTTP confirma cancelamento sem campos de devolução e não mantém lembrete',async t=>{
 const x=setup(t),id=sale(x),origin='http://127.0.0.1:3997',{server}=application({store:x.db,origin});
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));t.after(()=>new Promise(resolve=>server.close(resolve)));
 const base='http://127.0.0.1:'+server.address().port,headers={Cookie:'pdv_session='+x.token,Origin:origin,'Content-Type':'application/json'};
 const response=await fetch(base+'/api/sales/'+id+'/cancel',{method:'POST',headers,body:JSON.stringify(data(x,id))});assert.equal(response.status,200);
 const result=await response.json();assert.equal(result.refund_completed_cents,1000);assert.equal(result.refund_pending_cents,0);
 const state=await (await fetch(base+'/api/state?status=confirmed&from=2026-01-01&to=2026-01-01',{headers:{Cookie:'pdv_session='+x.token}})).json();
 assert.deepEqual(state.sales,[]);assert.deepEqual(state.refunds_pending,{count:0,total_cents:0,items:[]});
 const payment=await fetch(base+'/api/sales/'+id+'/payments',{method:'POST',headers,body:JSON.stringify({method:'cash',amount_cents:1,request_id:randomUUID()})});assert.equal(payment.status,409);
});
