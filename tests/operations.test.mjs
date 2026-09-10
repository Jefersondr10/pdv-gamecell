import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdtempSync,rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Store } from '../src/store.mjs';
import { apportion,publicSale,itemFinancials,reconcile } from '../src/domain.mjs';
function setup(t){const db=new Store();t.after(()=>db.close());const actor=db.actor(db.register({name:'Teste',store_name:'Operações',email:'ops@example.test',password:'senha-ficticia-de-teste'}).token),product=db.addProduct(actor,{name:'Produto',price_cents:1000}),customer=db.addCustomer(actor,{name:'Cliente'});return {db,actor,product,customer,ops:db.operations};}
function sale(x,quantity=1,extra={}){const id=x.db.saveDraft(x.actor,{customer_id:x.customer.id,seller_id:x.actor.id,items:[{product_id:x.product.id,quantity,unit_price_cents:1000}],...extra}).id;x.db.addPayment(x.actor,id,{method:'cash',amount_cents:quantity*1000,request_id:randomUUID()});x.db.confirm(x.actor,id,true);return id;}
const receive=(x,quantity,cost)=>x.ops.receive(x.actor,{product_id:x.product.id,quantity,unit_cost_cents:cost,request_id:randomUUID()});
function editData(x,id,extra={}){const s=x.db.sale(x.actor,id);return {customer_id:s.customer_id,seller_id:s.seller_id,items:s.items.map(i=>({id:i.id,product_id:i.product_id,description:i.description,quantity:i.quantity,unit_price_cents:i.unit_price_cents})),edit_token:s.edit_token,reason:'Correção de teste',request_id:randomUUID(),...extra};}
function invariants(x){
 assert.deepEqual(x.db.all('PRAGMA foreign_key_check'),[]);
 for(const l of x.db.all('SELECT * FROM lots'))assert.ok(l.quantity_remaining>=0&&l.quantity_remaining<=l.quantity_initial);
 for(const i of x.db.all("SELECT i.* FROM sale_items i JOIN sales s ON s.id=i.sale_id WHERE s.status='confirmed' AND i.product_id IS NOT NULL"))assert.equal(x.db.get('SELECT SUM(quantity) n FROM allocations WHERE item_id=?',i.id).n,i.quantity);
}
test('operações: produto e entrada juntos são atômicos e idempotentes',t=>{
 const x=setup(t),data={new_product:{name:'Produto novo',sku:'NOVO',price_cents:3000},quantity:3,unit_cost_cents:1200,request_id:randomUUID()};
 const r=x.ops.receive(x.actor,data);assert.ok(r.product_id);assert.equal(x.db.products(x.actor).find(p=>p.id===r.product_id).stock,3);
 assert.equal(x.ops.receive(x.actor,data).id,r.id);assert.equal(x.db.all('SELECT * FROM lots').length,1);
 const products=x.db.all('SELECT * FROM products'),audit=x.db.all('SELECT * FROM audit');
 assert.throws(()=>x.ops.receive(x.actor,{...data,new_product:{name:'Não gravar',price_cents:0},quantity:0,request_id:randomUUID()}));
 assert.deepEqual(x.db.all('SELECT * FROM products'),products);assert.deepEqual(x.db.all('SELECT * FROM audit'),audit);
});
test('operações: editar entrada consumida recalcula vendas seguintes e conserva pagamentos',t=>{
 const x=setup(t),a=receive(x,2,100),b=receive(x,3,200),s1=sale(x,2),s2=sale(x,2),payments=x.db.all('SELECT * FROM payments');
 assert.equal(x.db.fullSale(x.actor,s2).known_cost_cents,400);
 x.ops.updateEntry(x.actor,a.id,{quantity:1,unit_cost_cents:150,version:1,reason:'Quantidade corrigida',request_id:randomUUID()});
 assert.equal(x.db.fullSale(x.actor,s1).known_cost_cents,350);assert.equal(x.db.fullSale(x.actor,s2).known_cost_cents,400);assert.equal(x.db.products(x.actor)[0].stock,0);
 assert.deepEqual(x.db.all('SELECT * FROM payments'),payments);invariants(x);
});
test('operações: excluir entrada usada preserva histórico e cria custo pendente, sem custo zero',t=>{
 const x=setup(t),a=receive(x,2,100),id=sale(x,2),data={version:1,reason:'Entrada duplicada',request_id:randomUUID()};
 x.ops.updateEntry(x.actor,a.id,data,true);assert.equal(x.db.products(x.actor)[0].stock,-2);assert.equal(x.db.products(x.actor)[0].last_cost_cents,null);
 assert.equal(x.db.sale(x.actor,id).profit_cents,null);assert.equal(x.db.sale(x.actor,id).pending_cost_quantity,2);assert.ok(x.ops.entries(x.actor)[0].voided_at);
 assert.equal(x.ops.updateEntry(x.actor,a.id,data,true).replayed,true);receive(x,2,200);assert.equal(x.db.fullSale(x.actor,id).known_cost_cents,400);invariants(x);
});
test('operações: venda confirmada editável preserva número, ordem, datas, pagamento e detalhes',t=>{
 const x=setup(t);receive(x,2,100);receive(x,3,200);const first=sale(x,1),second=sale(x,2),old=x.db.fullSale(x.actor,first),data=editData(x,first);
 data.items[0].quantity=2;data.items[0].serial_number='SN-EDITADO';data.acknowledge_difference=true;
 x.ops.editSale(x.actor,first,data);const edited=x.db.fullSale(x.actor,first);
 for(const key of ['number','confirmed_at','business_date','status'])assert.equal(edited[key],old[key]);
 assert.deepEqual(edited.payments,old.payments);assert.equal(edited.known_cost_cents,200);assert.equal(x.db.fullSale(x.actor,second).known_cost_cents,400);
 assert.equal(edited.items[0].serial_number,'SN-EDITADO');assert.equal(edited.reconciliation.pending_cents,1000);
 assert.equal(x.ops.editSale(x.actor,first,data).replayed,true);assert.equal(x.db.sale(x.actor,first).corrections.length,1);invariants(x);
});
test('operações: preço novo com diferença exige ciência e rollback total',t=>{
 const x=setup(t);receive(x,2,100);const id=sale(x),data=editData(x,id),before=x.db.sale(x.actor,id),alloc=x.db.all('SELECT * FROM allocations'),audit=x.db.all('SELECT * FROM audit');
 data.items[0].unit_price_cents=2000;assert.throws(()=>x.ops.editSale(x.actor,id,data),/diferença/);assert.deepEqual(x.db.sale(x.actor,id),before);
 assert.deepEqual(x.db.all('SELECT * FROM allocations'),alloc);assert.deepEqual(x.db.all('SELECT * FROM audit'),audit);
});
test('operações: mês fechado bloqueia edição direta e impacto indireto de entrada, sem alterar snapshot',t=>{
 const x=setup(t),a=receive(x,2,100),id=sale(x);x.db.run("UPDATE sales SET business_date='2026-08-20' WHERE id=?",id);
 const p=x.db.finance.report(x.actor,'2026-08');x.db.finance.closeMonth(x.actor,{month:'2026-08',source_hash:p.result.source_hash,settings_version:p.result.settings_version});
 const snapshots=x.db.all('SELECT * FROM finance_closures'),lots=x.db.all('SELECT * FROM lots'),alloc=x.db.all('SELECT * FROM allocations');
 assert.throws(()=>x.ops.updateEntry(x.actor,a.id,{quantity:2,unit_cost_cents:200,version:1,reason:'Custo',request_id:randomUUID()}),/mês já fechado/);
 assert.throws(()=>x.ops.editSale(x.actor,id,editData(x,id)),/mês desta venda/);
 assert.deepEqual(x.db.all('SELECT * FROM finance_closures'),snapshots);assert.deepEqual(x.db.all('SELECT * FROM lots'),lots);assert.deepEqual(x.db.all('SELECT * FROM allocations'),alloc);
});
test('operações: tokens obsoletos, permissões e isolamento de loja',t=>{
 const x=setup(t),entry=receive(x,2,100),id=sale(x),old=editData(x,id);
 x.db.addPayment(x.actor,id,{method:'cash',amount_cents:100,request_id:randomUUID()});assert.throws(()=>x.ops.editSale(x.actor,id,old),/mudaram/);
 assert.throws(()=>x.ops.updateEntry(x.actor,entry.id,{quantity:1,unit_cost_cents:0,version:0,reason:'X',request_id:randomUUID()}),/outra tela/);
 const restricted={...x.actor,is_owner:false,permissions:['sales.edit_draft','stock.receive','costs.enter']};
 assert.throws(()=>x.ops.editSale(restricted,id,editData(x,id)),/Acesso/);assert.throws(()=>x.ops.updateEntry(restricted,entry.id,{}),/Acesso/);
 const other=x.db.actor(x.db.register({name:'Outro',store_name:'Outro',email:'other-ops@example.test',password:'senha-ficticia-de-teste'}).token);
 assert.throws(()=>x.ops.editSale(other,id,{request_id:randomUUID()}),/não encontrado/);assert.throws(()=>x.ops.updateEntry(other,entry.id,{request_id:randomUUID()}),/não encontrada/);
});
test('recebido e lucro por item: centavos conservados, excesso separado e informações restritas',t=>{
 assert.deepEqual(apportion(1,[{quantity:1,unit_price_cents:1,ordinal:1},{quantity:1,unit_price_cents:1,ordinal:0}]),[0,1]);
 const x=setup(t),items=[{description:'A',quantity:1,unit_price_cents:100,manual_cost_cents:40},{description:'B',quantity:2,unit_price_cents:100,manual_cost_cents:30}];
 const id=sale(x,1,{items,freight_cents:11,expenses:[{description:'Embalagem',amount_cents:10}]});
 const s=x.db.fullSale(x.actor,id);assert.equal(s.reconciliation.excess_cents,700);assert.equal(s.items.reduce((n,i)=>n+i.received_cents,0),300);assert.equal(s.items.reduce((n,i)=>n+i.provisional_profit_cents,0),s.provisional_profit_cents);assert.equal(s.items[0].profit_cents,null);
 const denied=x.db.sale({...x.actor,is_owner:false,permissions:[]},id);assert.equal(denied.items[0].profit_cents,undefined);assert.equal(denied.items[0].fee_share_cents,undefined);
 assert.doesNotMatch(JSON.stringify(publicSale(s)),/profit|fee_share|edit_token|received_cents/);
});

test('rateio: pagamentos mistos, taxas e itens gratuitos conservam centavos e lucro',()=>{
 const items=[{id:'a',quantity:1,unit_price_cents:100,cost_cents:40},{id:'b',quantity:2,unit_price_cents:100,cost_cents:60},{id:'c',quantity:1,unit_price_cents:0,cost_cents:10}];
 for(const paid of [0,1,149,299,300,301,500]){
  const r=reconcile(300,[{amount_cents:paid,fee_cents:paid?6:0}]),expectedProfit=300-110-r.fee_cents-11-10,rows=itemFinancials(items,r,11,10,expectedProfit);
  assert.equal(rows.reduce((s,i)=>s+i.received_cents,0),Math.min(paid,300));assert.equal(rows.reduce((s,i)=>s+i.pending_cents,0),r.pending_cents);
  assert.equal(rows.reduce((s,i)=>s+i.provisional_profit_cents,0),expectedProfit);assert.equal(rows.reduce((s,i)=>s+i.fee_share_cents,0),r.fee_cents);
  assert.equal(rows[2].provisional_profit_cents,-10);assert.equal(rows[2].received_cents,0);assert.equal(rows.every(i=>i.profit_cents!==null),paid===300);
  assert.ok(itemFinancials(items,r,11,10,null).every(i=>i.profit_cents===null&&i.provisional_profit_cents===null));
 }
 assert.deepEqual(apportion(3,[{quantity:1,unit_price_cents:0},{quantity:2,unit_price_cents:0}]),[1,2]);
 const mixed=reconcile(300,[{amount_cents:200,fee_cents:5},{amount_cents:100,fee_cents:0}]);assert.equal(itemFinancials(items,mixed,11,10,164).reduce((s,i)=>s+i.profit_cents,0),164);
});
test('relatório: valor real dos lotes, déficit separado, custo protegido e CSV seguro',t=>{
 const x=setup(t);receive(x,2,10000);receive(x,3,12000);const report=x.ops.report(x.actor);
 assert.equal(report.totals.inventory_cost_cents,56000);assert.equal(report.products[0].available_quantity,5);
 const hidden=x.ops.report({...x.actor,is_owner:false,permissions:[]});assert.equal(hidden.products[0].inventory_cost_cents,undefined);assert.equal(hidden.totals.inventory_cost_cents,undefined);
 x.db.addProduct(x.actor,{name:'=FORMULA()',sku:'+malicious',price_cents:0});const csv=x.ops.reportCsv(x.actor);assert.match(csv,/'=FORMULA/);assert.match(csv,/'\+malicious/);
 sale(x,6);const after=x.ops.report(x.actor).products.find(p=>p.id===x.product.id);assert.equal(after.stock,-1);assert.equal(after.pending_quantity,1);assert.equal(after.inventory_cost_cents,0);invariants(x);
 assert.match(x.ops.reportCsv(x.actor),/"-1"/);assert.doesNotMatch(x.ops.reportCsv(x.actor),/"'-1"/);
});

test('relatório: agregado usa limite de representação, não o limite de preço individual',t=>{
 const x=setup(t);receive(x,2,30_000_000_000);receive(x,2,30_000_000_000);
 assert.equal(x.ops.report(x.actor).totals.inventory_cost_cents,120_000_000_000);assert.match(x.ops.reportCsv(x.actor),/1200000000,00/);
});

test('operações: correção com custo omitido preserva valor oculto e fornecedor ausente',t=>{
 const x=setup(t),entry=receive(x,5,873);x.db.saveSupplier(x.actor,{name:'Único fornecedor atual'});
 const restricted={...x.actor,is_owner:false,permissions:['stock.receive','stock.correct','costs.enter']};
 assert.equal(x.ops.entries(restricted)[0].unit_cost_cents,undefined);
 x.ops.updateEntry(restricted,entry.id,{quantity:2,supplier_id:null,version:1,reason:'Conferência física',request_id:randomUUID()});
 const updated=x.ops.entries(x.actor)[0];assert.equal(updated.quantity_remaining,2);assert.equal(updated.unit_cost_cents,873);assert.equal(updated.supplier_id,null);invariants(x);
});

test('operações: FIFO segue confirmação, não criação; migração e reabertura preservam sequência',t=>{
 const dir=mkdtempSync(join(tmpdir(),'pdv-ops-test-')),path=join(dir,'test.sqlite');let db=new Store(path);
 t.after(()=>{db.close();rmSync(dir,{recursive:true,force:true});});
 const actor=db.actor(db.register({name:'A',store_name:'FIFO',email:'fifo-ops@example.test',password:'senha-ficticia-de-teste'}).token),product=db.addProduct(actor,{name:'P',price_cents:1000}),customer=db.addCustomer(actor,{name:'C'}),x={db,actor,product,customer,ops:db.operations};
 const draft=()=>db.saveDraft(actor,{customer_id:customer.id,seller_id:actor.id,items:[{product_id:product.id,quantity:1,unit_price_cents:1000}]}).id;
 const firstCreated=draft(),firstConfirmed=draft();db.confirm(actor,firstConfirmed,true);db.confirm(actor,firstCreated,true);
 db.run("UPDATE sales SET confirmed_at='2026-07-01T12:00:00.000Z'");
 // Simulate a pre-upgrade database; allocation insertion order preserves the tie.
 db.run('DELETE FROM sale_fifo_order');db.close();db=new Store(path);Object.assign(x,{db,ops:db.operations});
 assert.equal(db.get('SELECT sale_id FROM sale_fifo_order ORDER BY sequence LIMIT 1').sale_id,firstConfirmed);
 const entry=receive(x,1,123);assert.equal(db.fullSale(actor,firstConfirmed).known_cost_cents,123);assert.equal(db.fullSale(actor,firstCreated).pending_cost_quantity,1);
 x.ops.updateEntry(actor,entry.id,{quantity:2,unit_cost_cents:150,version:1,reason:'Contagem',request_id:randomUUID()});
 const ordering=db.all('SELECT * FROM sale_fifo_order'),allocations=db.all('SELECT * FROM allocations'),oldToken=db.sale(actor,firstConfirmed).edit_token;
 db.close();db=new Store(path);Object.assign(x,{db,ops:db.operations});assert.deepEqual(db.all('SELECT * FROM sale_fifo_order'),ordering);assert.deepEqual(db.all('SELECT * FROM allocations'),allocations);
 assert.notEqual(db.sale(actor,firstConfirmed).edit_token,oldToken);assert.equal(db.fullSale(actor,firstCreated).known_cost_cents,150);invariants(x);
});

test('operações: editar venda aberta não pode mudar o custo de outra venda de mês fechado',t=>{
 const x=setup(t);receive(x,2,100);receive(x,3,400);const earlier=sale(x),later=sale(x);
 x.db.run("UPDATE sales SET business_date='2026-07-01' WHERE id=?",earlier);x.db.run("UPDATE sales SET business_date='2026-08-01' WHERE id=?",later);
 const closing=x.db.finance.report(x.actor,'2026-08').result;x.db.finance.closeMonth(x.actor,{month:'2026-08',source_hash:closing.source_hash,settings_version:closing.settings_version});
 const tables=['sales','sale_items','allocations','lots','audit','operation_requests','finance_closures','sale_fifo_order'],before=tables.map(table=>x.db.all('SELECT * FROM '+table));
 const data=editData(x,earlier,{acknowledge_difference:true});data.items[0].quantity=2;
 assert.throws(()=>x.ops.editSale(x.actor,earlier,data),/mês já fechado/);
 tables.forEach((table,index)=>assert.deepEqual(x.db.all('SELECT * FROM '+table),before[index],table));invariants(x);
});

test('operações: troca catálogo e avulso, remove item, limpa identificação e conserva link público',t=>{
 const x=setup(t);receive(x,4,100);const other=x.db.addProduct(x.actor,{name:'Outro produto',price_cents:1000});
 x.ops.receive(x.actor,{product_id:other.id,quantity:3,unit_cost_cents:300,request_id:randomUUID()});
 const id=sale(x,2,{items:[{product_id:x.product.id,quantity:1,unit_price_cents:1000,serial_number:'SN-ORIGINAL',share_details:true},{description:'Avulso',quantity:1,unit_price_cents:1000,manual_cost_cents:80}]});
 const share=x.db.share(x.actor,id),linkBefore=x.db.fullSale(x.actor,id).share_hash;
 let data=editData(x,id);data.items[0].product_id=other.id;data.items[1].product_id=x.product.id;x.ops.editSale(x.actor,id,data);
 let s=x.db.fullSale(x.actor,id);assert.equal(s.known_cost_cents,400);assert.equal(s.items[0].serial_number,'');assert.equal(s.items[0].share_details,false);assert.equal(s.share_hash,linkBefore);
 data=editData(x,id,{acknowledge_difference:true});data.items=data.items.slice(0,1);data.items[0].product_id=null;data.items[0].description='Novo avulso';data.items[0].manual_cost_cents=55;
 x.ops.editSale(x.actor,id,data);s=x.db.fullSale(x.actor,id);assert.equal(s.known_cost_cents,55);assert.equal(x.db.products(x.actor).find(p=>p.id===x.product.id).stock,4);assert.equal(x.db.products(x.actor).find(p=>p.id===other.id).stock,3);
 assert.equal(x.db.public(share.token).items[0].description,'Novo avulso');assert.equal(s.items[0].serial_number,'');invariants(x);
});

test('operações: edição restrita mantém custo manual e frete omitidos; status é atômico',t=>{
 const x=setup(t),id=sale(x,1,{items:[{description:'Avulso',quantity:1,unit_price_cents:1000,manual_cost_cents:345}],freight_cents:45,expenses:[{description:'Caixa',amount_cents:23}]}),status=x.db.saveSaleStatus(x.actor,{name:'Entregue',color:'green'});
 const restricted={...x.actor,is_owner:false,permissions:['sales.edit_confirmed']},view=x.db.sale(restricted,id),data={customer_id:view.customer_id,seller_id:view.seller_id,items:view.items.map(i=>({id:i.id,description:i.description,quantity:i.quantity,unit_price_cents:i.unit_price_cents})),edit_token:view.edit_token,reason:'Nota',request_id:randomUUID(),public_notes:'Revisado'};
 assert.equal(view.items[0].manual_cost_cents,undefined);x.ops.editSale(restricted,id,data);
 const s=x.db.fullSale(x.actor,id);assert.equal(s.known_cost_cents,345);assert.equal(s.freight_cents,45);assert.equal(s.expenses[0].amount_cents,23);
 const next=editData(x,id,{operational_status_id:status.id}),before=x.db.fullSale(x.actor,id);assert.throws(()=>x.ops.editSale(restricted,id,next),/Acesso/);assert.deepEqual(x.db.fullSale(x.actor,id),before);
 x.ops.editSale(x.actor,id,next);assert.equal(x.db.sale(x.actor,id).operational_status_id,status.id);
});

test('operações: editor autorizado mantém vendedor original sem precisar reatribuir a venda',t=>{
 const x=setup(t),id=sale(x,1,{items:[{description:'Avulso',quantity:1,unit_price_cents:1000,manual_cost_cents:100}]}),user=x.db.addUser(x.actor,{name:'Revisor',email:'review-ops@example.test',password:'senha-ficticia-de-teste',permissions:['sales.view_all','sales.edit_confirmed']});
 const actor={...user,tenant_id:x.actor.tenant_id},data=editData(x,id);x.ops.editSale(actor,id,data);assert.equal(x.db.sale(x.actor,id).seller_id,x.actor.id);
 const other=x.db.addUser(x.actor,{name:'Outro',email:'assign-ops@example.test',password:'senha-ficticia-de-teste',permissions:[]});assert.throws(()=>x.ops.editSale(actor,id,editData(x,id,{seller_id:other.id})),/Acesso/);
});

test('operações: falha na auditoria desfaz todo o recebimento e seu cadastro',t=>{
 const x=setup(t),beforeProducts=x.db.all('SELECT * FROM products'),beforeAudit=x.db.all('SELECT * FROM audit'),audit=x.db.audit.bind(x.db);
 x.db.audit=(actor,entity,key,action,data)=>{if(entity==='lot')throw Error('Falha simulada');return audit(actor,entity,key,action,data);};
 assert.throws(()=>x.ops.receive(x.actor,{new_product:{name:'Não persistir',price_cents:1000},quantity:1,unit_cost_cents:100,request_id:randomUUID()}),/Falha simulada/);
 assert.deepEqual(x.db.all('SELECT * FROM products'),beforeProducts);assert.deepEqual(x.db.all('SELECT * FROM audit'),beforeAudit);assert.equal(x.db.all('SELECT * FROM lots').length,0);assert.equal(x.db.all('SELECT * FROM operation_requests').length,0);invariants(x);
});
