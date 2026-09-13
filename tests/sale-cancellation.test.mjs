import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFileSync, mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { runInNewContext } from 'node:vm';
import { Store } from '../src/store.mjs';
import { application } from '../src/server.mjs';
import { migrateCancellationStatus } from '../src/sale-cancellation.mjs';
import { cancelSaleButton, wholesaleControl, salesRecords } from '../public/sales-view.mjs';

function setup(t,path=':memory:'){
 const db=new Store(path);t.after(()=>db.close());
 const token=db.register({name:'Cancelamento teste',store_name:'Loja fictícia',email:'cancel@example.test',password:'senha-ficticia-de-teste'}).token;
 const actor=db.actor(token),customer=db.addCustomer(actor,{name:'Cliente teste'}),product=db.addProduct(actor,{name:'Produto teste',price_cents:1000});
 return {db,actor,customer,product,token,ops:db.operations};
}
const draftData=(x,quantity=1)=>({customer_id:x.customer.id,seller_id:x.actor.id,items:[{product_id:x.product.id,quantity,unit_price_cents:1000}]});
function sale(x,quantity=1,confirmed=true){const id=x.db.saveDraft(x.actor,draftData(x,quantity)).id;if(confirmed)x.db.confirm(x.actor,id,true);return id;}
const payload=(x,id,extra={})=>({request_id:randomUUID(),edit_token:x.db.sale(x.actor,id).edit_token,reason:'Cliente desistiu e devolveu o produto',acknowledge_stock_return:true,...extra});
const stock=x=>x.db.products(x.actor).find(p=>p.id===x.product.id).stock;
const receive=(x,q,cost)=>x.db.receive(x.actor,{product_id:x.product.id,quantity:q,unit_cost_cents:cost});
const rows=(x)=>Object.fromEntries(x.db.all("SELECT name FROM sqlite_schema WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name").map(({name})=>[name,x.db.all(`SELECT rowid,* FROM "${name}" ORDER BY rowid`)]));

test('cancelar: confirmado devolve estoque e preserva pedido, fotografia, ordem e histórico',t=>{
 const x=setup(t);receive(x,4,300);const id=sale(x,2),before=x.db.fullSale(x.actor,id),order=x.db.all('SELECT * FROM sale_fifo_order');
 const link=x.db.share(x.actor,id).token,data=payload(x,id);
 assert.equal(stock(x),2);assert.equal(x.ops.cancelSale(x.actor,id,data).cancelled,true);
 const cancelled=x.db.sale(x.actor,id);assert.equal(cancelled.status,'cancelled');assert.equal(stock(x),4);
 assert.equal(cancelled.profit_cents,null);assert.equal(cancelled.provisional_profit_cents,null);assert.equal(cancelled.reconciliation.pending_cents,0);
 assert.equal(cancelled.items[0].cost_cents,before.items[0].cost_cents);assert.equal(cancelled.items[0].profit_cents,null);
 assert.equal(cancelled.number,before.number);assert.deepEqual(x.db.all('SELECT * FROM sale_fifo_order'),order);
 assert.equal(x.db.all('SELECT * FROM allocations').length,0);assert.equal(x.db.all('SELECT * FROM sale_cancellations').length,1);
 assert.equal(cancelled.cancellation.reason,data.reason);assert.throws(()=>x.db.public(link),/inválido/);
 assert.equal(x.db.snapshot(x.actor).dashboard.sales_count,0);assert.equal(x.db.snapshot(x.actor).dashboard.revenue_cents,0);
 assert.equal(x.db.listSales(x.actor,{status:'cancelled'})[0].id,id);assert.deepEqual(x.db.listSales(x.actor,{status:'confirmed'}),[]);
 assert.deepEqual(x.db.all('PRAGMA foreign_key_check'),[]);
});

test('cancelar: elimina saldo negativo e entrada posterior não atende venda cancelada',t=>{
 const x=setup(t),id=sale(x,3);assert.equal(stock(x),-3);
 x.ops.cancelSale(x.actor,id,payload(x,id));assert.equal(stock(x),0);receive(x,2,250);
 assert.equal(stock(x),2);assert.deepEqual(x.db.all('SELECT * FROM allocations'),[]);
 assert.equal(x.db.sale(x.actor,id).profit_state,'cancelled');
});

test('cancelar: FIFO recompõe outras vendas sem apagar itens nem custos históricos da cancelada',t=>{
 const x=setup(t);receive(x,1,100);receive(x,2,400);const first=sale(x),second=sale(x);
 assert.equal(x.db.fullSale(x.actor,second).known_cost_cents,400);
 x.ops.cancelSale(x.actor,first,payload(x,first));assert.equal(stock(x),2);
 assert.equal(x.db.fullSale(x.actor,second).known_cost_cents,100);
 assert.equal(x.db.fullSale(x.actor,first).known_cost_cents,100);assert.equal(x.db.all('SELECT * FROM sale_items').length,2);
 assert.equal(x.db.all('SELECT * FROM allocations').length,1);
});

test('cancelar: rascunho e avulso não geram movimento de estoque',t=>{
 const x=setup(t);receive(x,2,400);const draft=sale(x,1,false);
 x.ops.cancelSale(x.actor,draft,payload(x,draft));assert.equal(stock(x),2);
 const avulso=x.db.saveDraft(x.actor,{customer_id:x.customer.id,seller_id:x.actor.id,items:[{description:'Avulso',quantity:1,unit_price_cents:600,manual_cost_cents:100}]}).id;
 x.db.confirm(x.actor,avulso,true);x.ops.cancelSale(x.actor,avulso,payload(x,avulso));assert.equal(stock(x),2);
});

test('cancelar: pagamento registrado exige ciência explícita da devolução pendente',t=>{
 const x=setup(t),id=sale(x);x.db.addPayment(x.actor,id,{method:'cash',amount_cents:1000,request_id:randomUUID()});
 const before=rows(x);assert.throws(()=>x.ops.cancelSale(x.actor,id,payload(x,id)),/devolução pendente/);assert.deepEqual(rows(x),before);
 const result=x.ops.cancelSale(x.actor,id,payload(x,id,{acknowledge_refund_pending:true}));assert.equal(result.refund_pending_cents,1000);
});

test('cancelar: exige permissão, loja, motivo, retorno físico, token e UUID válidos',t=>{
 const x=setup(t),id=sale(x),data=payload(x,id),before=rows(x);
 assert.throws(()=>x.ops.cancelSale({...x.actor,is_owner:false,permissions:['sales.edit_confirmed']},id,data),/Acesso/);
 const other=x.db.actor(x.db.register({name:'Outra',store_name:'Outra',email:'outra-cancel@example.test',password:'senha-ficticia-de-teste'}).token);
 assert.throws(()=>x.ops.cancelSale(other,id,data),/encontrad/);
 for(const extra of [{reason:''},{reason:'a'.repeat(501)},{acknowledge_stock_return:false},{acknowledge_stock_return:'true'},{edit_token:'antigo'},{request_id:'abc'}])assert.throws(()=>x.ops.cancelSale(x.actor,id,{...data,...extra}));
 assert.deepEqual(x.db.all('SELECT rowid,* FROM sales'),before.sales);assert.deepEqual(x.db.all('SELECT * FROM sale_cancellations'),[]);
});

test('cancelar: replay idempotente, outro payload conflita e novo cancelamento é bloqueado',t=>{
 const x=setup(t),id=sale(x),data=payload(x,id);
 assert.equal(x.ops.cancelSale(x.actor,id,data).replayed,false);const before=rows(x);
 assert.equal(x.ops.cancelSale(x.actor,id,data).replayed,true);assert.deepEqual(rows(x),before);
 assert.throws(()=>x.ops.cancelSale(x.actor,id,{...data,reason:'Outro motivo'}),/outros dados/);
 assert.throws(()=>x.ops.cancelSale(x.actor,id,payload(x,id)),/já está cancelada/);
 assert.deepEqual(rows(x),before);
});

test('cancelar: auditoria com falha reverte status, lotes, alocações, foto e request',t=>{
 const x=setup(t);receive(x,2,300);const id=sale(x),before=rows(x),audit=x.db.audit;
 x.db.audit=()=>{throw Error('auditoria indisponível');};assert.throws(()=>x.ops.cancelSale(x.actor,id,payload(x,id)),/auditoria/);x.db.audit=audit;
 assert.deepEqual(rows(x),before);
});

function close(x,month){const result=x.db.finance.report(x.actor,month).result;x.db.finance.closeMonth(x.actor,{month,source_hash:result.source_hash,settings_version:result.settings_version});}
test('cancelar: mês fechado e mudança indireta de FIFO em mês fechado são protegidos',t=>{
 const x=setup(t);receive(x,1,100);receive(x,1,300);const first=sale(x),second=sale(x);
 x.db.addPayment(x.actor,second,{method:'cash',amount_cents:1000,request_id:randomUUID()});
 x.db.run("UPDATE sales SET business_date='2026-07-15' WHERE id=?",first);x.db.run("UPDATE sales SET business_date='2026-08-15' WHERE id=?",second);close(x,'2026-08');
 const before=rows(x);assert.throws(()=>x.ops.cancelSale(x.actor,second,payload(x,second)),/fechado/);assert.deepEqual(rows(x),before);
 assert.throws(()=>x.ops.cancelSale(x.actor,first,payload(x,first)),/mês já fechado/);assert.deepEqual(rows(x),before);
});

test('cancelar: nenhuma operação reativa a venda e perfil restrito não recebe custos na foto',t=>{
 const x=setup(t);receive(x,1,300);const id=sale(x);x.ops.cancelSale(x.actor,id,payload(x,id));const before=rows(x);
 assert.throws(()=>x.db.confirm(x.actor,id,true),/cancelada/);
 assert.throws(()=>x.db.saveDraft(x.actor,draftData(x),id),/cancelada/);
 assert.throws(()=>x.ops.editSale(x.actor,id,{request_id:randomUUID()}),/confirmada/);
 assert.throws(()=>x.db.addPayment(x.actor,id,{method:'cash',amount_cents:1,request_id:randomUUID()}),/cancelada/);
 assert.throws(()=>x.db.setOperationalStatus(x.actor,id,{operational_status_id:null}),/cancelada/);
 assert.throws(()=>x.ops.setWholesale(x.actor,id,{request_id:randomUUID(),is_wholesale:true}),/cancelada/);
 assert.throws(()=>x.db.share(x.actor,id),/cancelada/);assert.deepEqual(rows(x),before);
 const restricted=x.db.sale({...x.actor,is_owner:false,permissions:[]},id);
 assert.equal(restricted.known_cost_cents,undefined);assert.equal(restricted.items[0].cost_cents,undefined);assert.equal(restricted.items[0].allocations,undefined);
 assert.equal(restricted.profit_cents,undefined);assert.equal(restricted.snapshot_json,undefined);assert.equal(restricted.share_hash,undefined);
});

test('cancelar: replay de pagamento removido e marcação anterior continua sem ressuscitar dados',t=>{
 const x=setup(t),id=sale(x,1,false),payment={method:'cash',amount_cents:1000,request_id:randomUUID()},paymentId=x.db.addPayment(x.actor,id,payment).id;
 const toggle={request_id:randomUUID(),edit_token:x.db.sale(x.actor,id).edit_token,is_wholesale:true};x.ops.setWholesale(x.actor,id,toggle);x.db.confirm(x.actor,id,true);
 const current=x.db.sale(x.actor,id);x.ops.editSale(x.actor,id,{...draftData(x),items:current.items,request_id:randomUUID(),edit_token:current.edit_token,reason:'Pagamento registrado por engano',acknowledge_difference:true,payments:[]});
 assert.equal(x.db.fullSale(x.actor,id).reconciliation.gross_cents,0);x.ops.cancelSale(x.actor,id,payload(x,id));const before=rows(x);
 assert.equal(x.db.addPayment(x.actor,id,payment).id,paymentId);assert.equal(x.ops.setWholesale(x.actor,id,toggle).replayed,true);
 assert.deepEqual(rows(x),before);
});

test('cancelar: replay de atacado mantém permissão original do editor de confirmadas',t=>{
 const x=setup(t),id=sale(x),editor={...x.actor,is_owner:false,permissions:['sales.edit_confirmed']};
 const data={request_id:randomUUID(),edit_token:x.db.sale(x.actor,id).edit_token,is_wholesale:true};
 x.ops.setWholesale(editor,id,data);x.ops.cancelSale(x.actor,id,payload(x,id));const before=rows(x);
 assert.equal(x.ops.setWholesale(editor,id,data).replayed,true);
 assert.throws(()=>x.ops.setWholesale(editor,id,{...data,request_id:randomUUID()}),/cancelada/);assert.deepEqual(rows(x),before);
});

function legacySales(db){
 const sql=db.get("SELECT sql FROM sqlite_schema WHERE name='sales'").sql.replace(', \'cancelled\'','').replace('CREATE TABLE sales','CREATE TABLE legacy_sales');
 const objects=db.all("SELECT sql FROM sqlite_schema WHERE tbl_name='sales' AND sql IS NOT NULL AND type IN ('index','trigger')");
 db.db.exec('PRAGMA foreign_keys=OFF; PRAGMA legacy_alter_table=ON');
 db.transaction(()=>{db.db.exec(sql);db.db.exec('INSERT INTO legacy_sales SELECT * FROM sales; DROP TABLE sales; ALTER TABLE legacy_sales RENAME TO sales;');for(const object of objects)db.db.exec(object.sql);});
 db.db.exec('PRAGMA foreign_keys=ON; PRAGMA legacy_alter_table=OFF');
}
test('cancelar: migração preserva linhas, rowid, índices, triggers filhos e integridade',t=>{
 const x=setup(t);receive(x,2,300);const id=sale(x);legacySales(x.db);x.db.run('UPDATE sales SET rowid=71 WHERE id=?',id);
 x.db.db.exec(`CREATE INDEX probe_sale_date ON sales(business_date);
 CREATE TRIGGER probe_sales_update BEFORE UPDATE ON sales BEGIN SELECT CASE WHEN NEW.number<0 THEN RAISE(ABORT,'invalid') END; END;
 CREATE TRIGGER probe_payments_sales BEFORE INSERT ON payments BEGIN SELECT id FROM sales WHERE id=NEW.sale_id; END;`);
 const before=rows(x),objects=x.db.all("SELECT name,sql FROM sqlite_schema WHERE name LIKE 'probe_%' ORDER BY name");
 migrateCancellationStatus(x.db);assert.deepEqual(rows(x),before);assert.deepEqual(x.db.all("SELECT name,sql FROM sqlite_schema WHERE name LIKE 'probe_%' ORDER BY name"),objects);
 assert.equal(x.db.get('PRAGMA foreign_keys').foreign_keys,1);assert.equal(x.db.get('PRAGMA legacy_alter_table').legacy_alter_table,0);assert.deepEqual(x.db.all('PRAGMA foreign_key_check'),[]);
 x.ops.cancelSale(x.actor,id,payload(x,id));assert.equal(x.db.get('SELECT rowid FROM sales WHERE id=?',id).rowid,71);
 migrateCancellationStatus(x.db);assert.equal(x.db.sale(x.actor,id).status,'cancelled');
});

test('cancelar: falha na migração reverte banco inteiro e restaura pragmas',t=>{
 const x=setup(t);sale(x);legacySales(x.db);const before=rows(x),schema=x.db.all("SELECT name,sql FROM sqlite_schema ORDER BY name"),original=x.db.all;
 x.db.all=function(sql,...args){if(sql==='PRAGMA foreign_key_check')return [{table:'probe'}];return original.call(this,sql,...args);};
 assert.throws(()=>migrateCancellationStatus(x.db),/integridade/);x.db.all=original;
 assert.deepEqual(rows(x),before);assert.deepEqual(x.db.all("SELECT name,sql FROM sqlite_schema ORDER BY name"),schema);
 assert.equal(x.db.get('PRAGMA foreign_keys').foreign_keys,1);assert.equal(x.db.get('PRAGMA legacy_alter_table').legacy_alter_table,0);
});

test('cancelar: atualização de banco legado e cancelamento persistem ao reabrir Store',()=>{
 const dir=mkdtempSync(join(tmpdir(),'pdv-cancel-migration-')),path=join(dir,'isolated.sqlite');let db;
 try{
  const x=setup({after(){}},path);db=x.db;receive(x,2,300);const id=sale(x);legacySales(db);
  const before=rows(x);db.close();db=new Store(path);x.db=db;x.ops=db.operations;
  assert.deepEqual(rows(x),before);x.ops.cancelSale(x.actor,id,payload(x,id));db.close();db=new Store(path);x.db=db;
  assert.equal(db.sale(x.actor,id).status,'cancelled');assert.equal(stock(x),2);assert.deepEqual(db.all('PRAGMA foreign_key_check'),[]);
 }finally{db?.close();rmSync(dir,{recursive:true,force:true});}
});

test('HTTP cancelar: sessão, CSRF, concorrência, replay e consulta do status',async t=>{
 const x=setup(t),id=sale(x),data=payload(x,id),origin='http://127.0.0.1:3999',{server}=application({store:x.db,origin});
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));t.after(()=>new Promise(resolve=>server.close(resolve)));
 const base='http://127.0.0.1:'+server.address().port,headers={Cookie:'pdv_session='+x.token,Origin:origin,'Content-Type':'application/json'};
 const call=(h=headers)=>fetch(base+'/api/sales/'+id+'/cancel',{method:'POST',headers:h,body:JSON.stringify(data)});
 assert.equal((await call({'Content-Type':'application/json',Origin:origin})).status,401);assert.equal((await call({...headers,Origin:'https://example.test'})).status,403);
 const responses=await Promise.all([call(),call()]);assert.deepEqual(responses.map(r=>r.status),[200,200]);assert.deepEqual((await Promise.all(responses.map(r=>r.json()))).map(r=>r.replayed).sort(),[false,true]);
 const read=await fetch(base+'/api/state?status=cancelled',{headers});assert.equal(read.status,200);const state=await read.json();assert.equal(state.sales[0].status,'cancelled');assert.equal(state.dashboard.sales_count,0);
});

test('interface cancelar: ação visível, situação pronta e cancelada sem controles ou lucro pendente',t=>{
 const x=setup(t),id=sale(x),s=x.db.sale(x.actor,id),esc=v=>String(v??'').replaceAll('<','&lt;'),can=()=>true;
 assert.match(cancelSaleButton(s,{esc,can}),/Cancelar venda/);assert.equal(cancelSaleButton(s,{esc,can:()=>false}),'');
 x.ops.cancelSale(x.actor,id,payload(x,id));const cancelled=x.db.sale(x.actor,id);
 assert.equal(cancelSaleButton(cancelled,{esc,can}),'');assert.equal(wholesaleControl(cancelled,{esc,can}),'');
 const html=salesRecords([cancelled],{esc,can,money:String,date:String,statusBadge:()=>'<span>Cancelada</span>'});
 assert.match(html,/Valor do pedido cancelado/);assert.doesNotMatch(html,/data-action="(?:edit-sale|cancel-sale)"|data-sale-wholesale|Lucro da venda|Pagamento pendente/);
 const source=readFileSync(new URL('../public/app.mjs',import.meta.url),'utf8');assert.match(source,/option\('cancelled','Canceladas'/);assert.match(source,/badge bad">Cancelada/);assert.match(source,/name="acknowledge_stock_return" required/);
});

test('interface cancelar: busca dados atuais e exige ciência de devolução para pagos sem cancelar só ao abrir',async()=>{
 const source=readFileSync(new URL('../public/app.mjs',import.meta.url),'utf8');
 const fn=source.slice(source.indexOf('async function openCancelSale('),source.indexOf('function showModal('));
 for(const paid of [false,true]){
  const calls=[],shown=[],submit={remove(){this.removed=true;}},back={};
  const ctx={can:()=>true,api:async(path,...args)=>{calls.push([path,...args]);return {id:'sale',number:1,total_cents:1000,status:'confirmed',edit_token:'novo',customer_name:'<Cliente>',reconciliation:{gross_cents:paid?1000:0}};},showModal:(...args)=>shown.push(args),modal:{querySelector:selector=>selector==='[type="submit"]'?submit:back},money:String,esc:v=>String(v).replaceAll('<','&lt;'),field:(label,html)=>label+html,paymentRequestId:randomUUID};
  ctx.view='sales';ctx.working=null;ctx.workingDirty=false;ctx.pendingWorks=new Map();
  runInNewContext(fn,ctx);await ctx.openCancelSale('sale');assert.deepEqual(calls,[['/sales/sale']]);assert.equal(back.textContent,'Voltar');
  assert.equal(submit.textContent,'Confirmar cancelamento');assert.match(shown[0][1],/edit_token" value="novo"/);assert.match(shown[0][1],/acknowledge_stock_return" required/);assert.doesNotMatch(shown[0][1],/<Cliente>/);
  if(paid){assert.match(shown[0][1],/acknowledge_refund_pending" required/);assert.match(shown[0][1],/Devolução pendente: 1000/);}
  else assert.doesNotMatch(shown[0][1],/acknowledge_refund_pending/);
 }
});
