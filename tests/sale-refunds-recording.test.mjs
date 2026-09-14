import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { Store } from '../src/store.mjs';
import { application } from '../src/server.mjs';
import { businessDate } from '../src/domain.mjs';
import { AUTOMATIC_CANCELLATION_REFUND_NOTE } from '../src/sale-cancellation.mjs';

function setup(t,path=':memory:') {
 const db=new Store(path);t?.after?.(()=>db.close());
 const token=db.register({name:'Operador de teste',store_name:'Loja de cancelamentos',email:'refund-record@example.test',password:'senha-ficticia-de-teste'}).token;
 const actor=db.actor(token),customer=db.addCustomer(actor,{name:'Cliente teste'}),product=db.addProduct(actor,{name:'Produto teste',price_cents:1000});
 db.receive(actor,{product_id:product.id,quantity:20,unit_cost_cents:300});
 return {db,actor,customer,product,token};
}

function sale(x,{paid=1000,confirmed=true,seller=x.actor.id}={}) {
 const id=x.db.saveDraft(x.actor,{customer_id:x.customer.id,seller_id:seller,items:[{product_id:x.product.id,quantity:1,unit_price_cents:1000}]}).id;
 if(paid)x.db.addPayment(x.actor,id,{request_id:randomUUID(),method:'cash',amount_cents:paid});
 if(confirmed)x.db.confirm(x.actor,id,true);
 return id;
}

const cancelData=(x,id,extra={})=>({request_id:randomUUID(),edit_token:x.db.sale(x.actor,id).edit_token,reason:'Cliente desistiu',...extra});

test('cancelamento encerra automaticamente todo o bruto recebido em uma linha imutável',t=>{
 const x=setup(t),id=sale(x,{paid:1250}),payments=x.db.all('SELECT * FROM payments');
 const result=x.db.operations.cancelSale(x.actor,id,cancelData(x,id));
 assert.equal(result.refund_completed_cents,1250);assert.equal(result.refund_pending_cents,0);
 const cancelled=x.db.sale(x.actor,id);
 assert.equal(cancelled.cancellation.refund_original_cents,1250);
 assert.equal(cancelled.cancellation.refund_completed_cents,1250);
 assert.equal(cancelled.cancellation.refund_pending_cents,0);
 assert.equal(cancelled.cancellation.refund_state,'completed');
 assert.equal(cancelled.cancellation.settled_automatically,true);
 assert.equal(cancelled.cancellation.refunds.length,1);
 assert.deepEqual(x.db.all('SELECT * FROM payments'),payments);
 const refund=x.db.get('SELECT * FROM sale_refunds WHERE tenant_id=? AND sale_id=?',x.actor.tenant_id,id);
 assert.equal(refund.amount_cents,1250);assert.equal(refund.method,'other');assert.equal(refund.notes,AUTOMATIC_CANCELLATION_REFUND_NOTE);
 assert.equal(refund.actor_id,x.actor.id);assert.equal(refund.actor_name_snapshot,x.actor.name);assert.equal(refund.refunded_date,businessDate());
 const audit=JSON.parse(x.db.get("SELECT data_json FROM audit WHERE tenant_id=? AND entity='sale' AND entity_id=? AND action='cancelled'",x.actor.tenant_id,id).data_json);
 assert.equal(audit.stock_returned,true);assert.equal(audit.refund_completed_cents,1250);assert.equal(audit.refund_pending_cents,0);assert.equal(audit.refund_id,refund.id);
});

test('cancelamento sem recebimento não inventa baixa nem pendência',t=>{
 const x=setup(t),id=sale(x,{paid:0}),result=x.db.operations.cancelSale(x.actor,id,cancelData(x,id)),cancelled=x.db.sale(x.actor,id);
 assert.equal(result.refund_completed_cents,0);assert.equal(result.refund_pending_cents,0);
 assert.equal(cancelled.cancellation.refund_state,'not_required');assert.equal(cancelled.cancellation.refunds.length,0);
 assert.equal(x.db.get('SELECT COUNT(*) AS total FROM sale_refunds WHERE tenant_id=? AND sale_id=?',x.actor.tenant_id,id).total,0);
});

test('cancelamento continua idempotente e não duplica a baixa automática',t=>{
 const x=setup(t),id=sale(x),data=cancelData(x,id),first=x.db.operations.cancelSale(x.actor,id,data);
 const beforeRefunds=x.db.all('SELECT * FROM sale_refunds'),beforeRequests=x.db.all('SELECT * FROM operation_requests');
 const replay=x.db.operations.cancelSale(x.actor,id,data);
 assert.equal(first.replayed,false);assert.equal(replay.replayed,true);assert.equal(replay.refund_pending_cents,0);
 assert.deepEqual(x.db.all('SELECT * FROM sale_refunds'),beforeRefunds);assert.deepEqual(x.db.all('SELECT * FROM operation_requests'),beforeRequests);
 assert.throws(()=>x.db.operations.cancelSale(x.actor,id,{...data,reason:'Outro motivo'}),/outros dados/);
});

test('falha de auditoria reverte venda, estoque, baixa e chave idempotente na mesma transação',t=>{
 const x=setup(t),id=sale(x),beforeStock=x.db.products(x.actor).find(row=>row.id===x.product.id).stock;
 const beforeRequests=x.db.all('SELECT * FROM operation_requests'),audit=x.db.audit;x.db.audit=()=>{throw Error('auditoria indisponível');};
 assert.throws(()=>x.db.operations.cancelSale(x.actor,id,cancelData(x,id)),/auditoria/);x.db.audit=audit;
 assert.equal(x.db.sale(x.actor,id).status,'confirmed');assert.equal(x.db.all('SELECT * FROM sale_cancellations').length,0);
 assert.equal(x.db.all('SELECT * FROM sale_refunds').length,0);assert.deepEqual(x.db.all('SELECT * FROM operation_requests'),beforeRequests);
 assert.equal(x.db.products(x.actor).find(row=>row.id===x.product.id).stock,beforeStock);
});

test('baixa e correção manuais ficam encerradas e não podem reabrir saldo',t=>{
 const x=setup(t),id=sale(x);x.db.operations.cancelSale(x.actor,id,cancelData(x,id));
 const refund=x.db.get('SELECT * FROM sale_refunds WHERE tenant_id=? AND sale_id=?',x.actor.tenant_id,id),before=x.db.all('SELECT * FROM sale_refunds');
 assert.throws(()=>x.db.operations.recordRefund(x.actor,id,{}),/encerrada automaticamente/);
 assert.throws(()=>x.db.operations.reverseRefund(x.actor,id,refund.id,{}),/não pode ser reaberto/);
 assert.deepEqual(x.db.all('SELECT * FROM sale_refunds'),before);assert.deepEqual(x.db.all('SELECT * FROM sale_refund_reversals'),[]);
 assert.equal(x.db.sale(x.actor,id).cancellation.refund_pending_cents,0);
});

test('histórico automático é imutável e persiste ao reabrir o banco',()=>{
 const dir=mkdtempSync(join(tmpdir(),'pdv-auto-refund-')),path=join(dir,'refunds.sqlite');let db;
 try{
  const x=setup(null,path);db=x.db;const id=sale(x,{paid:750});db.operations.cancelSale(x.actor,id,cancelData(x,id));
  const before=db.get('SELECT * FROM sale_refunds WHERE tenant_id=? AND sale_id=?',x.actor.tenant_id,id);
  assert.throws(()=>db.run('UPDATE sale_refunds SET amount_cents=1 WHERE id=?',before.id),/immutable/);
  assert.throws(()=>db.run('DELETE FROM sale_refunds WHERE id=?',before.id),/immutable/);
  db.close();db=new Store(path);x.db=db;
  const after=db.get('SELECT * FROM sale_refunds WHERE tenant_id=? AND sale_id=?',x.actor.tenant_id,id),cancelled=db.sale(x.actor,id);
  assert.deepEqual(after,before);assert.equal(cancelled.cancellation.refund_completed_cents,750);assert.equal(cancelled.cancellation.refund_pending_cents,0);
  assert.equal(db.snapshot(x.actor).refunds_pending.count,0);assert.deepEqual(db.all('PRAGMA foreign_key_check'),[]);
 }finally{db?.close();rmSync(dir,{recursive:true,force:true});}
});

function legacyCancellation(x,{paid=1000}={}) {
 const id=sale(x,{paid}),snapshot=x.db.fullSale(x.actor,id),at=new Date().toISOString();
 x.db.run('INSERT INTO sale_cancellations VALUES(?,?,?,?,?,?)',x.actor.tenant_id,id,x.actor.id,'Cancelamento antigo',at,JSON.stringify(snapshot));
 x.db.run("UPDATE sales SET status='cancelled',updated_at=? WHERE tenant_id=? AND id=?",at,x.actor.tenant_id,id);
 x.db.run('DELETE FROM allocations WHERE tenant_id=? AND item_id IN (SELECT id FROM sale_items WHERE tenant_id=? AND sale_id=?)',x.actor.tenant_id,x.actor.tenant_id,id);
 return {id,at};
}

test('cancelamento antigo é projetado como encerrado sem alterar sua baixa parcial',t=>{
 const x=setup(t),{id,at}=legacyCancellation(x),historicalId=randomUUID(),historicalRequest=randomUUID();
 x.db.run(`INSERT INTO sale_refunds(id,tenant_id,sale_id,actor_id,actor_name_snapshot,request_id,amount_cents,method,refunded_date,notes,created_at)
  VALUES(?,?,?,?,?,?,?,?,?,?,?)`,historicalId,x.actor.tenant_id,id,x.actor.id,'Nome histórico',historicalRequest,300,'cash',businessDate(new Date(at)),'Baixa antiga',at);
 const refunds=x.db.all('SELECT * FROM sale_refunds WHERE tenant_id=? AND sale_id=? ORDER BY rowid',x.actor.tenant_id,id),audits=x.db.all('SELECT * FROM audit');
 const cancelled=x.db.sale(x.actor,id);
 assert.equal(cancelled.cancellation.refund_completed_cents,1000);assert.equal(cancelled.cancellation.refund_pending_cents,0);assert.equal(cancelled.cancellation.settled_automatically,true);
 assert.equal(cancelled.cancellation.refunds.length,1);assert.equal(cancelled.cancellation.refunds[0].amount_cents,300);
 assert.deepEqual(x.db.all('SELECT * FROM sale_refunds WHERE tenant_id=? AND sale_id=? ORDER BY rowid',x.actor.tenant_id,id),refunds);
 assert.deepEqual(x.db.all('SELECT * FROM audit'),audits);
});

test('cancelamento antigo preserva baixa corrigida e não recria nem apaga eventos',t=>{
 const x=setup(t),{id,at}=legacyCancellation(x),refundId=randomUUID(),reversalId=randomUUID();
 x.db.run(`INSERT INTO sale_refunds(id,tenant_id,sale_id,actor_id,actor_name_snapshot,request_id,amount_cents,method,refunded_date,notes,created_at)
  VALUES(?,?,?,?,?,?,?,?,?,?,?)`,refundId,x.actor.tenant_id,id,x.actor.id,x.actor.name,randomUUID(),400,'cash',businessDate(new Date(at)),'Baixa antiga',at);
 x.db.run(`INSERT INTO sale_refund_reversals(id,tenant_id,sale_id,refund_id,actor_id,actor_name_snapshot,request_id,reason,reversed_date,created_at)
  VALUES(?,?,?,?,?,?,?,?,?,?)`,reversalId,x.actor.tenant_id,id,refundId,x.actor.id,x.actor.name,randomUUID(),'Correção antiga',businessDate(new Date(at)),at);
 const refunds=x.db.all('SELECT * FROM sale_refunds'),reversals=x.db.all('SELECT * FROM sale_refund_reversals'),audits=x.db.all('SELECT * FROM audit');
 const cancelled=x.db.sale(x.actor,id);assert.equal(cancelled.cancellation.refund_completed_cents,1000);assert.equal(cancelled.cancellation.refund_pending_cents,0);
 assert.equal(cancelled.cancellation.refunds.find(row=>row.id===refundId).reversed,true);
 assert.deepEqual(x.db.all('SELECT * FROM sale_refunds'),refunds);assert.deepEqual(x.db.all('SELECT * FROM sale_refund_reversals'),reversals);assert.deepEqual(x.db.all('SELECT * FROM audit'),audits);
});

test('reabrir banco antigo mantém tabelas históricas intactas e elimina só a pendência projetada',()=>{
 const dir=mkdtempSync(join(tmpdir(),'pdv-legacy-refund-')),path=join(dir,'refunds.sqlite');let db;
 try{
  const x=setup(null,path);db=x.db;const {id,at}=legacyCancellation(x),refundId=randomUUID();
  db.run(`INSERT INTO sale_refunds(id,tenant_id,sale_id,actor_id,actor_name_snapshot,request_id,amount_cents,method,refunded_date,notes,created_at)
   VALUES(?,?,?,?,?,?,?,?,?,?,?)`,refundId,x.actor.tenant_id,id,x.actor.id,x.actor.name,randomUUID(),250,'cash',businessDate(new Date(at)),'Histórico anterior',at);
  const refunds=db.all('SELECT * FROM sale_refunds'),audits=db.all('SELECT * FROM audit'),cancellations=db.all('SELECT * FROM sale_cancellations');
  db.close();db=new Store(path);x.db=db;
  assert.deepEqual(db.all('SELECT * FROM sale_refunds'),refunds);assert.deepEqual(db.all('SELECT * FROM audit'),audits);assert.deepEqual(db.all('SELECT * FROM sale_cancellations'),cancellations);
  const cancelled=db.sale(x.actor,id);assert.equal(cancelled.cancellation.refund_completed_cents,1000);assert.equal(cancelled.cancellation.refund_pending_cents,0);
  assert.deepEqual(db.snapshot(x.actor).refunds_pending,{count:0,total_cents:0,items:[]});assert.deepEqual(db.all('PRAGMA foreign_key_check'),[]);
 }finally{db?.close();rmSync(dir,{recursive:true,force:true});}
});

test('HTTP cancela sem ciências extras e rejeita as rotas manuais antigas sem mutação',async t=>{
 const x=setup(t),id=sale(x),origin='http://127.0.0.1:3999',{server}=application({store:x.db,origin});
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));t.after(()=>new Promise(resolve=>server.close(resolve)));
 const base='http://127.0.0.1:'+server.address().port,headers={Cookie:'pdv_session='+x.token,Origin:origin,'Content-Type':'application/json'},payload=cancelData(x,id);
 let response=await fetch(base+'/api/sales/'+id+'/cancel',{method:'POST',headers,body:JSON.stringify(payload)});
 assert.equal(response.status,200);const cancelled=await response.json();assert.equal(cancelled.refund_completed_cents,1000);assert.equal(cancelled.refund_pending_cents,0);
 response=await fetch(base+'/api/sales/'+id+'/cancel',{method:'POST',headers,body:JSON.stringify(payload)});assert.equal(response.status,200);assert.equal((await response.json()).replayed,true);
 const refund=x.db.get('SELECT * FROM sale_refunds WHERE tenant_id=? AND sale_id=?',x.actor.tenant_id,id),before=x.db.all('SELECT * FROM sale_refunds');
 response=await fetch(base+'/api/sales/'+id+'/refunds',{method:'POST',headers,body:'{}'});assert.equal(response.status,409);
 response=await fetch(base+'/api/sales/'+id+'/refunds/'+refund.id+'/reversal',{method:'POST',headers,body:'{}'});assert.equal(response.status,409);
 assert.deepEqual(x.db.all('SELECT * FROM sale_refunds'),before);assert.equal(x.db.all('SELECT * FROM sale_refund_reversals').length,0);
 const state=await (await fetch(base+'/api/state',{headers:{Cookie:'pdv_session='+x.token}})).json();assert.equal(state.refunds_pending.count,0);assert.equal(state.refunds_pending.total_cents,0);
});
