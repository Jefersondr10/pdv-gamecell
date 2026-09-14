import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runInNewContext } from 'node:vm';
import { Store } from '../src/store.mjs';
import { application } from '../src/server.mjs';
import { businessDate, publicSale } from '../src/domain.mjs';
import { shiftMonth } from '../src/finance.mjs';
import { brazilianDate, isoDate } from '../public/date-control.mjs';

const today=businessDate(), previous=shiftMonth(today.slice(0,7),-1)+'-15';
function setup(t) {
 const db=new Store();t.after(()=>db.close());
 const actor=db.actor(db.register({name:'Datas',store_name:'Loja de testes',email:'datas@example.test',password:'senha-ficticia-de-teste'}).token);
 const customer=db.addCustomer(actor,{name:'Cliente fictício'}),product=db.addProduct(actor,{name:'Produto fictício',price_cents:1000});
 const data={customer_id:customer.id,seller_id:actor.id,items:[{product_id:product.id,quantity:1,unit_price_cents:1000}]};
 return {db,actor,product,data};
}
const closeMonth=(x,month)=>{const r=x.db.finance.calculate(x.actor,month);return x.db.finance.closeMonth(x.actor,{month,source_hash:r.source_hash,settings_version:r.settings_version});};
const snapshot=x=>JSON.stringify(['sales','sale_items','payments','allocations','lots','audit','sale_fifo_order'].map(table=>x.db.all(`SELECT * FROM ${table}`)));

test('data da venda: hoje por padrão, edição omitida preserva dia e rascunho legado confirma hoje',t=>{
 const x=setup(t),id=x.db.saveDraft(x.actor,x.data).id;
 assert.equal(x.db.sale(x.actor,id).business_date,today);
 x.db.saveDraft(x.actor, {draft_token:x.db.operations.draftToken(x.actor,id),...({...x.data,business_date:previous})}, id);
 x.db.saveDraft(x.actor, {draft_token:x.db.operations.draftToken(x.actor,id),...(x.data)}, id);assert.equal(x.db.sale(x.actor,id).business_date,previous);
 const legacy=x.db.saveDraft(x.actor,x.data).id;
 x.db.run('UPDATE sales SET business_date=NULL WHERE id=?',legacy);
 x.db.saveDraft(x.actor, {draft_token:x.db.operations.draftToken(x.actor,legacy),...(x.data)}, legacy);assert.equal(x.db.sale(x.actor,legacy).business_date,null);
 x.db.confirm(x.actor,legacy,true);assert.equal(x.db.sale(x.actor,legacy).business_date,today);
});

test('migração de data da venda: horário de verão de São Paulo é aplicado e o índice continua utilizável',t=>{
 const directory=mkdtempSync(join(tmpdir(),'pdv-business-date-')),path=join(directory,'pdv.sqlite');
 t.after(()=>rmSync(directory,{recursive:true,force:true}));
 let db=new Store(path);
 const actor=db.actor(db.register({name:'Migração',store_name:'Loja histórica',email:'historico@example.test',password:'senha-ficticia-de-teste'}).token);
 const migrated=db.saveDraft(actor,{items:[]}).id,preserved=db.saveDraft(actor,{items:[],business_date:'2018-01-14'}).id;
 db.run('UPDATE sales SET created_at=?,business_date=NULL WHERE id=?','2018-01-15T02:30:00.000Z',migrated);
 db.run('UPDATE sales SET created_at=? WHERE id=?','2018-01-15T02:30:00.000Z',preserved);
 db.close();

 db=new Store(path);
 assert.equal(db.get('SELECT business_date FROM sales WHERE id=?',migrated).business_date,'2018-01-15');
 assert.equal(db.get('SELECT business_date FROM sales WHERE id=?',preserved).business_date,'2018-01-14');
 assert.deepEqual(db.listSales(actor,{from:'2018-01-15',to:'2018-01-15'}).map(s=>s.id),[migrated]);
 const plan=db.all('EXPLAIN QUERY PLAN SELECT id FROM sales INDEXED BY idx_sales_date WHERE tenant_id=? AND business_date>=? AND business_date<=?',actor.tenant_id,'2018-01-15','2018-01-15');
 assert.ok(plan.some(row=>/idx_sales_date/.test(row.detail)),JSON.stringify(plan));
 db.close();

 db=new Store(path);
 assert.equal(db.get('SELECT business_date FROM sales WHERE id=?',migrated).business_date,'2018-01-15');
 db.close();
});

test('migração de data da venda: banco antigo sem a coluna recebe coluna, backfill e índice',t=>{
 const directory=mkdtempSync(join(tmpdir(),'pdv-business-column-')),path=join(directory,'pdv.sqlite');
 t.after(()=>rmSync(directory,{recursive:true,force:true}));
 let db=new Store(path);
 const actor=db.actor(db.register({name:'Legado',store_name:'Loja antiga',email:'legado@example.test',password:'senha-ficticia-de-teste'}).token);
 const sale=db.saveDraft(actor,{items:[]}).id;
 db.run('UPDATE sales SET created_at=? WHERE id=?','2018-01-15T02:30:00.000Z',sale);
 db.db.exec('DROP INDEX idx_sales_date; ALTER TABLE sales DROP COLUMN business_date');
 db.close();

 db=new Store(path);
 assert.ok(db.all('PRAGMA table_info(sales)').some(column=>column.name==='business_date'));
 assert.equal(db.get('SELECT business_date FROM sales WHERE id=?',sale).business_date,'2018-01-15');
 assert.ok(db.get("SELECT 1 AS found FROM sqlite_schema WHERE type='index' AND name='idx_sales_date'").found);
 db.close();
});

test('migração de data da venda: criação inválida impede qualquer backfill parcial',t=>{
 const db=new Store(':memory:');t.after(()=>db.close());
 const actor=db.actor(db.register({name:'Atomicidade',store_name:'Loja antiga',email:'atomico@example.test',password:'senha-ficticia-de-teste'}).token);
 const valid=db.saveDraft(actor,{items:[]}).id,invalid=db.saveDraft(actor,{items:[]}).id;
 db.run('UPDATE sales SET created_at=?,business_date=NULL WHERE id=?','2018-01-15T02:30:00.000Z',valid);
 db.run('UPDATE sales SET created_at=?,business_date=NULL WHERE id=?','data-inválida',invalid);
 assert.throws(()=>db.migrateLegacyBusinessDates(),/data de criação inválida/);
 assert.deepEqual(db.all('SELECT id,business_date FROM sales ORDER BY id').map(row=>row.business_date),[null,null]);
});

test('data da venda: confirmação mantém dia escolhido, filtros, fechamento e pedido usam esse dia',t=>{
 const x=setup(t);x.db.receive(x.actor,{product_id:x.product.id,quantity:3,unit_cost_cents:200});
 const id=x.db.saveDraft(x.actor,{...x.data,business_date:previous}).id,before=x.db.sale(x.actor,id);
 x.db.addPayment(x.actor,id,{method:'cash',amount_cents:1000,request_id:randomUUID()});
 const payments=x.db.effectivePayments(x.actor,id);x.db.confirm(x.actor,id);
 const s=x.db.sale(x.actor,id);assert.equal(s.business_date,previous);assert.equal(s.created_at,before.created_at);assert.equal(s.number,before.number);
 assert.equal(businessDate(new Date(s.confirmed_at)),today);assert.deepEqual(x.db.effectivePayments(x.actor,id),payments);
 assert.equal(x.db.listSales(x.actor,{from:previous,to:previous})[0].id,id);
 assert.equal(x.db.listSales(x.actor,{from:today,to:today}).length,0);
 assert.equal(x.db.finance.calculate(x.actor,previous.slice(0,7)).sales_profit_cents,800);
 assert.equal(x.db.finance.calculate(x.actor,today.slice(0,7)).sales_count,0);
 assert.equal(publicSale(s).date,previous);
 closeMonth(x,previous.slice(0,7));const stable=snapshot(x);
 assert.equal(x.db.confirm(x.actor,id).already_confirmed,true);assert.equal(snapshot(x),stable);
});

test('data da venda: inválida, vazia ou futura não grava nem altera o rascunho',t=>{
 const x=setup(t),id=x.db.saveDraft(x.actor,x.data).id,before=snapshot(x);
 for(const business_date of [null,'','15/08/2026','2026-02-30','2199-01-01',123,{}]){
  assert.throws(()=>x.db.saveDraft(x.actor,{...x.data,business_date}));
  assert.throws(()=>x.db.saveDraft(x.actor, {draft_token:x.db.operations.draftToken(x.actor,id),...({...x.data,business_date})}, id));
  assert.equal(snapshot(x),before);
 }
});

test('data da venda: mês fechado bloqueia cadastro e confirmação tardia sem baixar estoque',t=>{
 const x=setup(t);x.db.receive(x.actor,{product_id:x.product.id,quantity:2,unit_cost_cents:200});
 const id=x.db.saveDraft(x.actor,{...x.data,business_date:previous}).id;
 closeMonth(x,previous.slice(0,7));const before=snapshot(x);
 assert.throws(()=>x.db.saveDraft(x.actor,{...x.data,business_date:previous}),/mês desta data já foi fechado/);
 assert.throws(()=>x.db.confirm(x.actor,id,true),/mês desta data já foi fechado/);
 assert.equal(snapshot(x),before);assert.equal(x.db.products(x.actor)[0].stock,2);
 x.db.saveDraft(x.actor, {draft_token:x.db.operations.draftToken(x.actor,id),...({...x.data,business_date:today})}, id);x.db.confirm(x.actor,id,true);
 assert.equal(x.db.products(x.actor)[0].stock,1);
});

test('data da venda: retroagir não muda ordem FIFO e edição posterior preserva instantes',t=>{
 const x=setup(t);x.db.receive(x.actor,{product_id:x.product.id,quantity:1,unit_cost_cents:200});x.db.receive(x.actor,{product_id:x.product.id,quantity:1,unit_cost_cents:400});
 const first=x.db.saveDraft(x.actor,x.data).id;x.db.confirm(x.actor,first,true);
 const second=x.db.saveDraft(x.actor,{...x.data,business_date:previous}).id;x.db.confirm(x.actor,second,true);
 assert.equal(x.db.fullSale(x.actor,first).known_cost_cents,200);assert.equal(x.db.fullSale(x.actor,second).known_cost_cents,400);
 const before=x.db.sale(x.actor,second),order=x.db.all('SELECT * FROM sale_fifo_order');
 x.db.operations.editSale(x.actor,second,{...x.data,business_date:today,items:before.items,edit_token:before.edit_token,request_id:randomUUID(),reason:'Corrigir data',acknowledge_difference:true});
 const after=x.db.sale(x.actor,second);assert.equal(after.business_date,today);assert.equal(after.confirmed_at,before.confirmed_at);assert.equal(after.created_at,before.created_at);assert.deepEqual(x.db.all('SELECT * FROM sale_fifo_order'),order);
 assert.equal(after.known_cost_cents,400);
});

test('HTTP data da venda: criar, editar rascunho e confirmar preservam data comercial',async t=>{
 const x=setup(t),origin='http://127.0.0.1:3999',{server}=application({store:x.db,origin});
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));t.after(()=>new Promise(resolve=>server.close(resolve)));
 const base='http://127.0.0.1:'+server.address().port,headers={Origin:origin,'Content-Type':'application/json'};
 const login=await fetch(base+'/api/login',{method:'POST',headers,body:JSON.stringify({email:'datas@example.test',password:'senha-ficticia-de-teste'})});headers.Cookie=login.headers.get('set-cookie').split(';')[0];
 async function call(path,data,method='POST',expected=200){const res=await fetch(base+'/api'+path,{method,headers,body:JSON.stringify(data)}),body=await res.json();assert.equal(res.status,expected,JSON.stringify(body));return body;}
 const {id}=await call('/sales',x.data,'POST',201);
 const updated=await call('/sales/'+id,{...x.data,business_date:previous,draft_token:x.db.operations.draftToken(x.actor,id)},'PUT');
 await call('/sales/'+id+'/confirm',{acknowledge_difference:true,draft_token:updated.draft_token});
 const response=await fetch(base+'/api/sales/'+id,{headers});assert.equal((await response.json()).business_date,previous);
 await call('/sales',{...x.data,business_date:'2026-02-30'},'POST',400);
});

const app=readFileSync(new URL('../public/app.mjs',import.meta.url),'utf8');
test('interface da venda: data brasileira visível desde o início, hoje em São Paulo e edição preservada',()=>{
 const make=app.slice(app.indexOf('function makeWorking('),app.indexOf('function startSale('));
 const dateField=app.slice(app.indexOf('function editorSaleDate('),app.indexOf('function editorCustomerField('));
 const ctx={state:{user:{id:'u'}},crypto:{randomUUID},brazilianDate,saoPauloToday:()=> '2026-09-08',esc:String,field:(label,control)=>label+control};
 runInNewContext(make+'\n'+dateField,ctx);
 const w=ctx.makeWorking();assert.equal(w.business_date,'08/09/2026');
 assert.equal(ctx.makeWorking({business_date:'2026-08-15',items:[],payments:[]}).business_date,'15/08/2026');
 for(const status of ['draft','confirmed']){const html=ctx.editorSaleDate({...w,status});assert.match(html,/Data da venda/);assert.match(html,/required/);assert.match(html,/value="08\/09\/2026"/);assert.match(html,/data-max-date="2026-09-08"/);}
 const editor=app.slice(app.indexOf('function renderEditor()'),app.indexOf('function updateSummary()'));
 assert.match(editor,/sale-editor-core-fields/);
 assert.match(editor,/\$\{editorSaleDate\(w\)\}\$\{wholesaleEditor\(w\.is_wholesale\)\}\$\{editorCustomerField\(w\)\}/);
 const timezone=app.slice(app.indexOf('function saoPauloToday('),app.indexOf('function todayFilter(')),zone={};runInNewContext(timezone,zone);
 assert.equal(zone.saoPauloToday(new Date('2026-09-09T01:30:00Z')),'2026-09-08');
});

test('interface da venda: envia data em novos/rascunhos/confirmados e valida antes de qualquer gravação',async()=>{
 const source=app.slice(app.indexOf('async function saveWorking('),app.indexOf('async function shareSale('));
 for(const status of ['new','draft','confirmed']){
  const calls=[],working={id:status==='new'?null:'sale',status:status==='confirmed'?status:'draft',business_date:'15/08/2026',reason:'Data correta',items:[],payments:[],entry_costs:{}};
  const ctx={finishMutation:async()=>{},forgetWorking:()=>{},working,isoDate,salePaymentPayload:p=>p,saoPauloToday:()=> '2026-09-09',can:()=>false,editorNumbers:()=>({diff:0}),load:async()=>{},render:()=>{},toast:()=>{},api:async(path,data,method)=>{calls.push({path,data,method});return {id:'sale'};}};
  runInNewContext(source,ctx);await ctx.saveWorking(false);assert.equal(calls[0].data.business_date,'2026-08-15');
  const length=calls.length;
  for(const date of ['', '31/02/2026','10/09/2026']){ctx.working=working;working.business_date=date;await assert.rejects(ctx.saveWorking(false));assert.equal(calls.length,length);}
 }
});
