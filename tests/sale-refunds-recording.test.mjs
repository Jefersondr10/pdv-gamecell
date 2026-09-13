import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { Store } from '../src/store.mjs';
import { application } from '../src/server.mjs';
import { businessDate } from '../src/domain.mjs';

function setup(t,path=':memory:') {
 const db=new Store(path);t?.after?.(()=>db.close());
 const token=db.register({name:'Operador de teste',store_name:'Loja de devoluções',email:'refund-record@example.test',password:'senha-ficticia-de-teste'}).token;
 const actor=db.actor(token),customer=db.addCustomer(actor,{name:'Cliente teste'}),product=db.addProduct(actor,{name:'Produto teste',price_cents:1000});
 db.receive(actor,{product_id:product.id,quantity:20,unit_cost_cents:300});
 return {db,actor,customer,product,token};
}

function cancelled(x,{paid=1000,seller=x.actor.id}={}) {
 const id=x.db.saveDraft(x.actor,{customer_id:x.customer.id,seller_id:seller,items:[{product_id:x.product.id,quantity:1,unit_price_cents:1000}]}).id;
 if(paid)x.db.addPayment(x.actor,id,{request_id:randomUUID(),method:'cash',amount_cents:paid});
 x.db.confirm(x.actor,id,true);
 const current=x.db.sale(x.actor,id);
 x.db.operations.cancelSale(x.actor,id,{request_id:randomUUID(),edit_token:current.edit_token,reason:'Cliente desistiu',acknowledge_stock_return:true,acknowledge_refund_pending:paid>0});
 return id;
}

function refundData(x,id,extra={}) {
 return {request_id:randomUUID(),refund_token:x.db.sale(x.actor,id).cancellation.refund_token,amount_cents:400,method:'cash',
  refunded_date:businessDate(),notes:'Valor devolvido ao cliente',acknowledge_refund_completed:true,...extra};
}
function reversalData(x,id,extra={}) {
 return {request_id:randomUUID(),refund_token:x.db.sale(x.actor,id).cancellation.refund_token,
  reason:'Baixa lançada por engano',reversed_date:businessDate(),acknowledge_refund_reversal:true,...extra};
}

const financial=sale=>({total_cents:sale.total_cents,reconciliation:sale.reconciliation,
 items:sale.items.map(item=>({id:item.id,total_cents:item.total_cents,received_cents:item.received_cents,cost_cents:item.cost_cents}))});

test('baixa de devolução parcial e integral preserva a fotografia financeira e atualiza saldo e histórico',t=>{
 const x=setup(t),id=cancelled(x),before=x.db.sale(x.actor,id),initialToken=before.cancellation.refund_token;
 assert.deepEqual(before.cancellation.refunds,[]);assert.equal(before.cancellation.refund_original_cents,1000);
 assert.equal(before.cancellation.refund_completed_cents,0);assert.equal(before.cancellation.refund_pending_cents,1000);
 assert.equal(before.cancellation.refund_state,'pending');

 const first=x.db.operations.recordRefund(x.actor,id,refundData(x,id));
 assert.equal(first.replayed,false);assert.equal(first.refund_completed_cents,400);assert.equal(first.refund_pending_cents,600);
 assert.equal(first.refund_state,'partial');assert.notEqual(first.refund_token,initialToken);
 let sale=x.db.sale(x.actor,id),c=sale.cancellation;
 assert.equal(c.refund_original_cents,1000);assert.equal(c.refund_completed_cents,400);assert.equal(c.refunded_cents,400);
 assert.equal(c.refund_pending_cents,600);assert.equal(c.refund_state,'partial');assert.equal(c.refunds.length,1);
 assert.deepEqual({...c.refunds[0],id:undefined,created_at:undefined,author_id:undefined},{id:undefined,amount_cents:400,method:'cash',refunded_date:businessDate(),notes:'Valor devolvido ao cliente',created_at:undefined,author_id:undefined,author:'Operador de teste',effective:true,reversed:false,reversal:null});
 assert.deepEqual(financial(sale),financial(before));
 let pending=x.db.snapshot(x.actor).refunds_pending;
 assert.equal(pending.count,1);assert.equal(pending.total_cents,600);assert.equal(pending.items[0].original_cents,1000);
 assert.equal(pending.items[0].refunded_cents,400);assert.equal(pending.items[0].pending_cents,600);

 const second=x.db.operations.recordRefund(x.actor,id,refundData(x,id,{amount_cents:600,method:'card',notes:''}));
 assert.equal(second.refund_completed_cents,1000);assert.equal(second.refund_pending_cents,0);assert.equal(second.refund_state,'completed');
 sale=x.db.sale(x.actor,id);c=sale.cancellation;assert.equal(c.refund_state,'completed');assert.equal(c.refunds.length,2);
 assert.deepEqual(financial(sale),financial(before));pending=x.db.snapshot(x.actor).refunds_pending;
 assert.equal(pending.count,0);assert.equal(pending.total_cents,0);assert.deepEqual(pending.items,[]);
 assert.equal(x.db.all("SELECT * FROM audit WHERE entity='sale' AND action='refund_recorded'").length,2);
 assert.throws(()=>x.db.run('UPDATE sale_refunds SET notes=? WHERE tenant_id=? AND sale_id=?','alterado',x.actor.tenant_id,id),/immutable/);
 assert.throws(()=>x.db.run('DELETE FROM sale_refunds WHERE tenant_id=? AND sale_id=?',x.actor.tenant_id,id),/immutable/);
});

test('correção integral preserva os dois eventos, restaura a pendência e permite lançar o valor correto',t=>{
 const x=setup(t),id=cancelled(x),before=financial(x.db.sale(x.actor,id));
 const refund=x.db.operations.recordRefund(x.actor,id,refundData(x,id,{amount_cents:400,method:'pix'}));
 const refundToken=refund.refund_token,reversal=x.db.operations.reverseRefund(x.actor,id,refund.id,reversalData(x,id));
 assert.equal(reversal.replayed,false);assert.equal(reversal.refund_id,refund.id);assert.equal(reversal.amount_cents,400);
 assert.equal(reversal.refund_completed_cents,0);assert.equal(reversal.refund_pending_cents,1000);
 assert.equal(reversal.refund_state,'pending');assert.notEqual(reversal.refund_token,refundToken);
 assert.equal(reversal.effective,false);assert.equal(reversal.reversed,true);

 let sale=x.db.sale(x.actor,id),entry=sale.cancellation.refunds[0],correction=entry.reversal;
 assert.equal(entry.effective,false);assert.equal(entry.reversed,true);assert.equal(correction.id,reversal.id);
 assert.equal(correction.refund_id,refund.id);assert.equal(correction.amount_cents,400);
 assert.equal(correction.reason,'Baixa lançada por engano');assert.equal(correction.author,'Operador de teste');
 assert.deepEqual(sale.cancellation.refund_reversals,[correction]);
 assert.equal(x.db.snapshot(x.actor).refunds_pending.total_cents,1000);
 assert.deepEqual(financial(sale),before);

 const correct=x.db.operations.recordRefund(x.actor,id,refundData(x,id,{amount_cents:250,method:'cash'}));
 assert.equal(correct.refund_completed_cents,250);assert.equal(correct.refund_pending_cents,750);
 sale=x.db.sale(x.actor,id);assert.equal(sale.cancellation.refunds.length,2);
 assert.equal(sale.cancellation.refunds.filter(item=>item.effective).length,1);
 assert.equal(sale.cancellation.refunds.find(item=>item.id===correct.id).effective,true);
 assert.deepEqual(financial(sale),before);

 x.db.run('UPDATE users SET name=? WHERE tenant_id=? AND id=?','Nome alterado',x.actor.tenant_id,x.actor.id);
 sale=x.db.sale(x.actor,id);entry=sale.cancellation.refunds.find(item=>item.id===refund.id);
 assert.equal(entry.author,'Operador de teste');assert.equal(entry.reversal.author,'Operador de teste');
 assert.throws(()=>x.db.run('UPDATE sale_refund_reversals SET reason=? WHERE tenant_id=? AND id=?','alterado',x.actor.tenant_id,reversal.id),/immutable/);
 assert.throws(()=>x.db.run('DELETE FROM sale_refund_reversals WHERE tenant_id=? AND id=?',x.actor.tenant_id,reversal.id),/immutable/);
 assert.equal(x.db.all("SELECT * FROM audit WHERE entity='sale' AND action='refund_reversal_recorded'").length,1);
});

test('replay de baixa e correção conserva o comprovante mas sempre hidrata saldo e token atuais',t=>{
 const x=setup(t),id=cancelled(x),firstPayload=refundData(x,id,{amount_cents:100});
 const first=x.db.operations.recordRefund(x.actor,id,firstPayload);
 const second=x.db.operations.recordRefund(x.actor,id,refundData(x,id,{amount_cents:200}));
 let replay=x.db.operations.recordRefund(x.actor,id,firstPayload);
 assert.equal(replay.replayed,true);assert.equal(replay.id,first.id);
 assert.equal(replay.refund_completed_cents,300);assert.equal(replay.refund_pending_cents,700);
 assert.equal(replay.refund_token,second.refund_token);assert.equal(replay.effective,true);

 const reversalPayload=reversalData(x,id),reversal=x.db.operations.reverseRefund(x.actor,id,first.id,reversalPayload);
 replay=x.db.operations.recordRefund(x.actor,id,firstPayload);
 assert.equal(replay.id,first.id);assert.equal(replay.replayed,true);assert.equal(replay.effective,false);
 assert.equal(replay.refund_completed_cents,200);assert.equal(replay.refund_pending_cents,800);
 assert.equal(replay.refund_token,reversal.refund_token);assert.equal(replay.reversal.id,reversal.id);

 const third=x.db.operations.recordRefund(x.actor,id,refundData(x,id,{amount_cents:50}));
 const reversalReplay=x.db.operations.reverseRefund(x.actor,id,first.id,reversalPayload);
 assert.equal(reversalReplay.id,reversal.id);assert.equal(reversalReplay.replayed,true);
 assert.equal(reversalReplay.refund_completed_cents,250);assert.equal(reversalReplay.refund_pending_cents,750);
 assert.equal(reversalReplay.refund_token,third.refund_token);assert.equal(reversalReplay.effective,false);
 assert.equal(x.db.all('SELECT * FROM sale_refund_reversals').length,1);
});

test('baixa exige ciência estrita, venda cancelada, saldo, método, data e token atuais',t=>{
 const x=setup(t),active=x.db.saveDraft(x.actor,{customer_id:x.customer.id,seller_id:x.actor.id,items:[{product_id:x.product.id,quantity:1,unit_price_cents:1000}]}).id;
 assert.throws(()=>x.db.operations.recordRefund(x.actor,active,null),/Dados da devolução/);
 assert.throws(()=>x.db.operations.recordRefund(x.actor,active,{request_id:randomUUID(),refund_token:'inexistente',amount_cents:400,method:'cash',
  refunded_date:businessDate(),notes:'',acknowledge_refund_completed:true}),/cancelada/);
 const id=cancelled(x),base=refundData(x,id);
 for(const acknowledgement of [undefined,false,'true',1])assert.throws(()=>x.db.operations.recordRefund(x.actor,id,{...base,request_id:randomUUID(),acknowledge_refund_completed:acknowledgement}),/já foi devolvido/);
 for(const amount of [0,1001])assert.throws(()=>x.db.operations.recordRefund(x.actor,id,{...base,request_id:randomUUID(),amount_cents:amount}),/Valor devolvido|saldo pendente/);
 assert.throws(()=>x.db.operations.recordRefund(x.actor,id,{...base,request_id:randomUUID(),method:'transfer'}),/Método/);
 assert.throws(()=>x.db.operations.recordRefund(x.actor,id,{...base,request_id:randomUUID(),refunded_date:'2000-01-01'}),/anterior/);
 assert.throws(()=>x.db.operations.recordRefund(x.actor,id,{...base,request_id:randomUUID(),refunded_date:'2199-12-31'}),/futuro/);
 assert.throws(()=>x.db.operations.recordRefund(x.actor,id,{...base,request_id:'inválido'}),/Identificador/);

 const stale=base,first=x.db.operations.recordRefund(x.actor,id,{...base,request_id:randomUUID(),amount_cents:100});
 assert.equal(first.refund_pending_cents,900);
 assert.throws(()=>x.db.operations.recordRefund(x.actor,id,{...stale,request_id:randomUUID(),amount_cents:100}),/mudaram/);
 assert.equal(x.db.all('SELECT * FROM sale_refunds').length,1);
});

test('correção exige permissão superior, ciência, motivo, data, alvo e token atuais',t=>{
 const x=setup(t),id=cancelled(x),refund=x.db.operations.recordRefund(x.actor,id,refundData(x,id,{amount_cents:400})),base=reversalData(x,id);
 for(const acknowledgement of [undefined,false,'true',1])assert.throws(()=>x.db.operations.reverseRefund(x.actor,id,refund.id,{...base,request_id:randomUUID(),acknowledge_refund_reversal:acknowledgement}),/baixa foi lançada por engano/);
 for(const reason of ['', ' '.repeat(3), 'x'.repeat(501)])assert.throws(()=>x.db.operations.reverseRefund(x.actor,id,refund.id,{...base,request_id:randomUUID(),reason}),/Motivo/);
 assert.throws(()=>x.db.operations.reverseRefund(x.actor,id,refund.id,{...base,request_id:randomUUID(),amount_cents:1}),/sempre.*integral/);
 assert.throws(()=>x.db.operations.reverseRefund(x.actor,id,refund.id,{...base,request_id:randomUUID(),refund_token:'token-antigo'}),/mudaram/);
 assert.throws(()=>x.db.operations.reverseRefund(x.actor,id,refund.id,{...base,request_id:randomUUID(),reversed_date:'2000-01-01'}),/anterior/);
 assert.throws(()=>x.db.operations.reverseRefund(x.actor,id,refund.id,{...base,request_id:randomUUID(),reversed_date:'2199-12-31'}),/futuro/);
 assert.throws(()=>x.db.operations.reverseRefund(x.actor,id,randomUUID(),{...base,request_id:randomUUID()}),{status:404});
 const other=cancelled(x),otherRefund=x.db.operations.recordRefund(x.actor,other,refundData(x,other,{amount_cents:100}));
 assert.throws(()=>x.db.operations.reverseRefund(x.actor,id,otherRefund.id,{...base,request_id:randomUUID()}),{status:404});
 assert.equal(x.db.all('SELECT * FROM sale_refund_reversals').length,0);

 const active=x.db.saveDraft(x.actor,{customer_id:x.customer.id,seller_id:x.actor.id,items:[{product_id:x.product.id,quantity:1,unit_price_cents:1000}]}).id;
 assert.throws(()=>x.db.operations.reverseRefund(x.actor,active,refund.id,{...base,request_id:randomUUID()}),/cancelada/);
 const reversal=x.db.operations.reverseRefund(x.actor,id,refund.id,base);
 assert.throws(()=>x.db.operations.reverseRefund(x.actor,id,refund.id,reversalData(x,id)),/já foi corrigida/);
 assert.equal(x.db.operations.reverseRefund(x.actor,id,refund.id,base).id,reversal.id);
});

test('baixa é idempotente, conflito de payload não duplica e falha de auditoria reverte tudo',t=>{
 const x=setup(t),id=cancelled(x),payload=refundData(x,id,{amount_cents:250,method:'pix'});
 const first=x.db.operations.recordRefund(x.actor,id,payload),before=x.db.all('SELECT * FROM sale_refunds');
 const replay=x.db.operations.recordRefund(x.actor,id,payload);assert.equal(replay.replayed,true);assert.equal(replay.id,first.id);
 assert.deepEqual(x.db.all('SELECT * FROM sale_refunds'),before);
 assert.throws(()=>x.db.operations.recordRefund(x.actor,id,{...payload,amount_cents:200}),/outros dados/);
 const current=refundData(x,id,{amount_cents:100}),audit=x.db.audit;x.db.audit=()=>{throw Error('auditoria indisponível');};
 assert.throws(()=>x.db.operations.recordRefund(x.actor,id,current),/auditoria/);x.db.audit=audit;
 assert.deepEqual(x.db.all('SELECT * FROM sale_refunds'),before);
});

test('permissão e escopo da venda isolam a baixa por usuário e por loja',t=>{
 const x=setup(t),deniedUser=x.db.addUser(x.actor,{name:'Sem permissão',email:'refund-denied@example.test',password:'senha-ficticia-de-teste',permissions:[]});
 const allowedUser=x.db.addUser(x.actor,{name:'Caixa',email:'refund-cashier@example.test',password:'senha-ficticia-de-teste',permissions:['sales.refund']});
 const hiddenUser=x.db.addUser(x.actor,{name:'Outro caixa',email:'refund-hidden@example.test',password:'senha-ficticia-de-teste',permissions:['sales.refund']});
 const denied=x.db.actor(x.db.login({email:'refund-denied@example.test',password:'senha-ficticia-de-teste'}).token);
 const allowed=x.db.actor(x.db.login({email:'refund-cashier@example.test',password:'senha-ficticia-de-teste'}).token);
 const hidden=x.db.actor(x.db.login({email:'refund-hidden@example.test',password:'senha-ficticia-de-teste'}).token);
 const deniedSale=cancelled(x,{seller:deniedUser.id}),id=cancelled(x,{seller:allowedUser.id});
 assert.throws(()=>x.db.operations.recordRefund(denied,deniedSale,refundData(x,deniedSale)),/Acesso/);
 assert.throws(()=>x.db.operations.recordRefund(hidden,id,refundData(x,id)),/não encontrada/);
 const data={...refundData(x,id,{amount_cents:100,method:'other'}),refund_token:x.db.sale(allowed,id).cancellation.refund_token};
 assert.equal(x.db.operations.recordRefund(allowed,id,data).amount_cents,100);
 const other=x.db.actor(x.db.register({name:'Outra loja',store_name:'Isolada',email:'refund-other@example.test',password:'senha-ficticia-de-teste'}).token);
 assert.throws(()=>x.db.operations.recordRefund(other,id,{...data,request_id:randomUUID()}),/não encontrado/);
});

test('permissão superior e escopo isolam a correção por usuário, venda e loja',t=>{
 const x=setup(t),cashier=x.db.addUser(x.actor,{name:'Caixa',email:'refund-correct-cashier@example.test',password:'senha-ficticia-de-teste',permissions:['sales.refund']}),
  supervisor=x.db.addUser(x.actor,{name:'Supervisor',email:'refund-supervisor@example.test',password:'senha-ficticia-de-teste',permissions:['sales.refund_correct']}),
  hiddenUser=x.db.addUser(x.actor,{name:'Supervisor oculto',email:'refund-hidden-supervisor@example.test',password:'senha-ficticia-de-teste',permissions:['sales.refund_correct']});
 const cashierActor=x.db.actor(x.db.login({email:'refund-correct-cashier@example.test',password:'senha-ficticia-de-teste'}).token),
  supervisorActor=x.db.actor(x.db.login({email:'refund-supervisor@example.test',password:'senha-ficticia-de-teste'}).token),
  hidden=x.db.actor(x.db.login({email:'refund-hidden-supervisor@example.test',password:'senha-ficticia-de-teste'}).token);
 const id=cancelled(x,{seller:supervisor.id}),refund=x.db.operations.recordRefund(x.actor,id,refundData(x,id,{amount_cents:100}));
 assert.throws(()=>x.db.operations.reverseRefund(cashierActor,id,refund.id,reversalData(x,id)),/Acesso/);
 assert.throws(()=>x.db.operations.reverseRefund(hidden,id,refund.id,reversalData(x,id)),/não encontrada/);
 const payload={...reversalData(x,id),refund_token:x.db.sale(supervisorActor,id).cancellation.refund_token};
 assert.equal(x.db.operations.reverseRefund(supervisorActor,id,refund.id,payload).author,'Supervisor');
 const other=x.db.actor(x.db.register({name:'Outra loja',store_name:'Outra',email:'refund-correct-other@example.test',password:'senha-ficticia-de-teste'}).token);
 assert.throws(()=>x.db.operations.reverseRefund(other,id,refund.id,{...payload,request_id:randomUUID()}),/não encontrado/);
});

test('data em mês fechado é bloqueada sem alterar fechamento nem resultado histórico',t=>{
 const x=setup(t),id=cancelled(x);x.db.run("UPDATE sale_cancellations SET created_at='2026-08-10T12:00:00.000Z' WHERE tenant_id=? AND sale_id=?",x.actor.tenant_id,id);
 const report=x.db.finance.report(x.actor,'2026-08');
 x.db.finance.closeMonth(x.actor,{month:'2026-08',source_hash:report.result.source_hash,settings_version:report.result.settings_version,
  acknowledge_refund_reserve:true,refunds_token:report.refunds_pending.token});
 const closures=x.db.all('SELECT * FROM finance_closures'),result=x.db.finance.calculate(x.actor,'2026-08');
 assert.throws(()=>x.db.operations.recordRefund(x.actor,id,refundData(x,id,{refunded_date:'2026-08-10'})),/mês.*fechado/i);
 assert.deepEqual(x.db.all('SELECT * FROM finance_closures'),closures);assert.deepEqual(x.db.finance.calculate(x.actor,'2026-08'),result);
 assert.equal(x.db.all('SELECT * FROM sale_refunds').length,0);
});

test('correção usa mês aberto próprio e não reescreve fechamento do mês da baixa',t=>{
 const x=setup(t),id=cancelled(x);x.db.run("UPDATE sale_cancellations SET created_at='2026-08-01T12:00:00.000Z' WHERE tenant_id=? AND sale_id=?",x.actor.tenant_id,id);
 const refund=x.db.operations.recordRefund(x.actor,id,refundData(x,id,{amount_cents:400,refunded_date:'2026-08-10'}));
 const report=x.db.finance.report(x.actor,'2026-08');x.db.finance.closeMonth(x.actor,{month:'2026-08',source_hash:report.result.source_hash,
  settings_version:report.result.settings_version,acknowledge_refund_reserve:true,refunds_token:report.refunds_pending.token});
 const closures=x.db.all('SELECT * FROM finance_closures'),result=x.db.finance.calculate(x.actor,'2026-08');
 assert.throws(()=>x.db.operations.reverseRefund(x.actor,id,refund.id,reversalData(x,id,{reversed_date:'2026-08-15'})),/mês.*fechado/i);
 const reversal=x.db.operations.reverseRefund(x.actor,id,refund.id,reversalData(x,id));
 assert.equal(reversal.refund_pending_cents,1000);assert.deepEqual(x.db.all('SELECT * FROM finance_closures'),closures);
 assert.deepEqual(x.db.finance.calculate(x.actor,'2026-08'),result);
});

test('falha de auditoria reverte correção e não consome sua chave idempotente',t=>{
 const x=setup(t),id=cancelled(x),refund=x.db.operations.recordRefund(x.actor,id,refundData(x,id,{amount_cents:300})),payload=reversalData(x,id);
 const beforeRequests=x.db.all('SELECT * FROM operation_requests'),audit=x.db.audit;x.db.audit=()=>{throw Error('auditoria indisponível');};
 assert.throws(()=>x.db.operations.reverseRefund(x.actor,id,refund.id,payload),/auditoria/);x.db.audit=audit;
 assert.deepEqual(x.db.all('SELECT * FROM operation_requests'),beforeRequests);assert.deepEqual(x.db.all('SELECT * FROM sale_refund_reversals'),[]);
 const result=x.db.operations.reverseRefund(x.actor,id,refund.id,payload);assert.equal(result.replayed,false);assert.equal(result.refund_pending_cents,1000);
});

test('histórico, saldo e token de devolução persistem ao reabrir o banco',()=>{
 const dir=mkdtempSync(join(tmpdir(),'pdv-sale-refunds-')),path=join(dir,'refunds.sqlite');let db;
 try{
  const x=setup(null,path);db=x.db;const id=cancelled(x),first=x.db.operations.recordRefund(x.actor,id,refundData(x,id,{amount_cents:300}));
  const token=first.refund_token;db.close();db=new Store(path);x.db=db;
  const sale=db.sale(x.actor,id);assert.equal(sale.cancellation.refund_completed_cents,300);assert.equal(sale.cancellation.refund_pending_cents,700);
  assert.equal(sale.cancellation.refund_token,token);assert.equal(sale.cancellation.refunds.length,1);
  assert.equal(db.snapshot(x.actor).refunds_pending.total_cents,700);assert.deepEqual(db.all('PRAGMA foreign_key_check'),[]);
 }finally{db?.close();rmSync(dir,{recursive:true,force:true});}
});

test('correção imutável e autoria fotografada persistem ao reabrir o banco',()=>{
 const dir=mkdtempSync(join(tmpdir(),'pdv-sale-refund-reversal-')),path=join(dir,'refunds.sqlite');let db;
 try{
  const x=setup(null,path);db=x.db;const id=cancelled(x),refund=db.operations.recordRefund(x.actor,id,refundData(x,id,{amount_cents:300}));
  const reversal=db.operations.reverseRefund(x.actor,id,refund.id,reversalData(x,id)),token=reversal.refund_token;
  db.close();db=new Store(path);x.db=db;db.run('UPDATE users SET name=? WHERE tenant_id=? AND id=?','Outro nome',x.actor.tenant_id,x.actor.id);
  const sale=db.sale(x.actor,id),entry=sale.cancellation.refunds[0];
  assert.equal(sale.cancellation.refund_completed_cents,0);assert.equal(sale.cancellation.refund_pending_cents,1000);
  assert.equal(sale.cancellation.refund_token,token);assert.equal(entry.effective,false);assert.equal(entry.author,'Operador de teste');
  assert.equal(entry.reversal.id,reversal.id);assert.equal(entry.reversal.author,'Operador de teste');
  assert.equal(db.snapshot(x.actor).refunds_pending.total_cents,1000);assert.deepEqual(db.all('PRAGMA foreign_key_check'),[]);
 }finally{db?.close();rmSync(dir,{recursive:true,force:true});}
});

test('HTTP registra devolução uma vez, protege sessão e CSRF e devolve o estado atualizado',async t=>{
 const x=setup(t),id=cancelled(x),origin='http://127.0.0.1:3999',{server}=application({store:x.db,origin});
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));t.after(()=>new Promise(resolve=>server.close(resolve)));
 const base='http://127.0.0.1:'+server.address().port,headers={Cookie:'pdv_session='+x.token,Origin:origin,'Content-Type':'application/json'},payload=refundData(x,id,{amount_cents:400});
 const call=(h=headers,data=payload)=>fetch(base+'/api/sales/'+id+'/refunds',{method:'POST',headers:h,body:JSON.stringify(data)});
 assert.equal((await call({'Content-Type':'application/json',Origin:origin})).status,401);
 assert.equal((await call({...headers,Origin:'https://example.test'})).status,403);
 let response=await call();assert.equal(response.status,201);const created=await response.json();assert.equal(created.replayed,false);assert.equal(created.refund_pending_cents,600);
 response=await call();assert.equal(response.status,200);assert.equal((await response.json()).replayed,true);
 response=await fetch(base+'/api/sales/'+id,{headers:{Cookie:'pdv_session='+x.token}});assert.equal(response.status,200);
 const sale=await response.json();assert.equal(sale.cancellation.refund_completed_cents,400);assert.equal(sale.cancellation.refund_pending_cents,600);
 assert.equal(sale.cancellation.refund_state,'partial');assert.equal(sale.cancellation.refunds.length,1);
});

test('HTTP corrige baixa com CSRF, token e concorrência; replay retorna estado atual',async t=>{
 const x=setup(t),id=cancelled(x),refund=x.db.operations.recordRefund(x.actor,id,refundData(x,id,{amount_cents:400})),
  denied=x.db.addUser(x.actor,{name:'Sem correção',email:'refund-http-denied@example.test',password:'senha-ficticia-de-teste',permissions:['sales.refund']}),
  deniedToken=x.db.login({email:'refund-http-denied@example.test',password:'senha-ficticia-de-teste'}).token,
  origin='http://127.0.0.1:3998',{server}=application({store:x.db,origin});
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));t.after(()=>new Promise(resolve=>server.close(resolve)));
 const base='http://127.0.0.1:'+server.address().port,headers={Cookie:'pdv_session='+x.token,Origin:origin,'Content-Type':'application/json'};
 const path='/api/sales/'+id+'/refunds/'+refund.id+'/reversal',call=(data,h=headers)=>fetch(base+path,{method:'POST',headers:h,body:JSON.stringify(data)});
 const first=reversalData(x,id),second={...reversalData(x,id),refund_token:first.refund_token};
 assert.equal((await call({...first,request_id:randomUUID()},{Origin:origin,'Content-Type':'application/json'})).status,401);
 assert.equal((await call({...first,request_id:randomUUID()},{...headers,Origin:'https://example.test'})).status,403);
 assert.equal((await call({...first,request_id:randomUUID()},{...headers,Cookie:'pdv_session='+deniedToken})).status,403);
 const payloads=[first,second],responses=await Promise.all(payloads.map(payload=>call(payload))),statuses=responses.map(response=>response.status);
 assert.deepEqual([...statuses].sort((a,b)=>a-b),[201,409]);
 const winner=payloads[statuses.indexOf(201)],created=await responses[statuses.indexOf(201)].json();
 assert.equal(created.refund_pending_cents,1000);assert.equal(created.reversed,true);
 let response=await call(winner);assert.equal(response.status,200);const replay=await response.json();
 assert.equal(replay.replayed,true);assert.equal(replay.id,created.id);assert.equal(replay.refund_token,created.refund_token);
 assert.equal(x.db.all('SELECT * FROM sale_refund_reversals').length,1);
 response=await call({...winner,reason:'Outro motivo'});assert.equal(response.status,409);
});

test('HTTP serializa nova baixa contra correção usando o mesmo token',async t=>{
 const x=setup(t),id=cancelled(x),first=x.db.operations.recordRefund(x.actor,id,refundData(x,id,{amount_cents:100})),origin='http://127.0.0.1:3997',{server}=application({store:x.db,origin});
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));t.after(()=>new Promise(resolve=>server.close(resolve)));
 const base='http://127.0.0.1:'+server.address().port,headers={Cookie:'pdv_session='+x.token,Origin:origin,'Content-Type':'application/json'},token=first.refund_token;
 const newRefund={...refundData(x,id,{amount_cents:100}),refund_token:token},reversal={...reversalData(x,id),refund_token:token};
 const calls=[fetch(base+'/api/sales/'+id+'/refunds',{method:'POST',headers,body:JSON.stringify(newRefund)}),
  fetch(base+'/api/sales/'+id+'/refunds/'+first.id+'/reversal',{method:'POST',headers,body:JSON.stringify(reversal)})];
 const responses=await Promise.all(calls),statuses=responses.map(response=>response.status);
 assert.deepEqual([...statuses].sort((a,b)=>a-b),[201,409]);
 const sale=x.db.sale(x.actor,id),completed=sale.cancellation.refund_completed_cents;
 assert.ok(completed===0||completed===200);assert.equal(sale.cancellation.refund_pending_cents,1000-completed);
 assert.equal(x.db.all('SELECT * FROM sale_refunds').length+x.db.all('SELECT * FROM sale_refund_reversals').length,2);
 assert.deepEqual(x.db.all('PRAGMA foreign_key_check'),[]);
});
