import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { Store } from '../src/store.mjs';
import { editedTimestamp } from '../src/payment-corrections.mjs';
import { feeCents,businessDate } from '../src/domain.mjs';
import { mkdtempSync,rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

function setup(t){
 const db=new Store();t.after(()=>db.close());const actor=db.actor(db.register({name:'Revisor',store_name:'Correções',email:'full@example.test',password:'senha-ficticia-de-teste'}).token);
 const product=db.addProduct(actor,{name:'Produto original',price_cents:10000}),customer=db.addCustomer(actor,{name:'Cliente'}),ops=db.operations;
 return {db,actor,product,customer,ops};
}
const receive=(x,extra={})=>x.ops.receive(x.actor,{product_id:x.product.id,quantity:4,unit_cost_cents:1000,request_id:randomUUID(),...extra});
function createSale(x,payments=[{method:'cash',amount_cents:10000}],extra={}){
 const id=x.db.saveDraft(x.actor,{customer_id:x.customer.id,seller_id:x.actor.id,items:[{product_id:x.product.id,quantity:1,unit_price_cents:10000}],...extra}).id;
 const requests=payments.map(p=>({request_id:randomUUID(),...p}));for(const data of requests)x.db.addPayment(x.actor,id,data);x.db.confirm(x.actor,id,true);return {id,requests};
}
function edit(x,id,extra={}){const s=x.db.sale(x.actor,id);return {customer_id:s.customer_id,seller_id:s.seller_id,items:s.items.map(i=>({id:i.id,product_id:i.product_id,description:i.description,quantity:i.quantity,unit_price_cents:i.unit_price_cents})),reason:'Conferência completa',edit_token:s.edit_token,request_id:randomUUID(),...extra};}
const tables=['sales','sale_items','lots','allocations','payments','payment_requests','payment_changes','audit','operation_requests'];
const snapshot=x=>tables.map(table=>x.db.all('SELECT * FROM '+table));
function invariant(x){
 assert.deepEqual(x.db.all('PRAGMA foreign_key_check'),[]);
 assert.equal(x.db.get(`SELECT COUNT(*) n FROM allocations a JOIN lots l ON l.tenant_id=a.tenant_id AND l.id=a.lot_id JOIN sale_items i ON i.tenant_id=a.tenant_id AND i.id=a.item_id WHERE l.product_id<>i.product_id`).n,0);
 for(const l of x.db.all('SELECT * FROM lots'))assert.ok(l.quantity_remaining>=0&&l.quantity_remaining<=l.quantity_initial);
}
function close(x,month){const r=x.db.finance.report(x.actor,month).result;x.db.finance.closeMonth(x.actor,{month,source_hash:r.source_hash,settings_version:r.settings_version});}

test('edição completa: entrada troca produto e data, refaz ambos os estoques sem alocação cruzada',t=>{
 const x=setup(t),entry=receive(x,{quantity:2,unit_cost_cents:500}),sale=createSale(x),other=x.db.addProduct(x.actor,{name:'Outro',price_cents:10000});
 x.ops.updateEntry(x.actor,entry.id,{product_id:other.id,received_date:'2026-08-01',quantity:3,unit_cost_cents:700,version:1,reason:'Produto lançado errado',request_id:randomUUID()});
 const products=x.db.products(x.actor);assert.equal(products.find(p=>p.id===x.product.id).stock,-1);assert.equal(products.find(p=>p.id===other.id).stock,3);assert.equal(x.db.fullSale(x.actor,sale.id).pending_cost_quantity,1);
 assert.equal(x.ops.entries(x.actor)[0].received_date,'2026-08-01');invariant(x);
});
test('edição completa: entrada retroativa altera FIFO já atendido e retorna saldo final correto',t=>{
 const x=setup(t);receive(x,{quantity:1,unit_cost_cents:900,received_date:'2026-08-10'});const s=createSale(x);
 const retro=receive(x,{quantity:1,unit_cost_cents:300,received_date:'2026-08-01'});assert.equal(retro.quantity_remaining,0);assert.equal(retro.consumed_quantity,1);assert.equal(retro.resolved_quantity,0);assert.equal(x.db.fullSale(x.actor,s.id).known_cost_cents,300);invariant(x);
});
test('edição completa: nova identificação no pedido, custo de entrada e data comercial, sem renomear catálogo',t=>{
 const x=setup(t),entry=receive(x),s=createSale(x),before=x.db.fullSale(x.actor,s.id),data=edit(x,s.id,{business_date:'2026-08-05',entry_costs:[{id:entry.id,version:1,unit_cost_cents:1750}]});
 data.items[0].description='Produto com descrição corrigida';data.items[0].serial_number='SN-001';x.ops.editSale(x.actor,s.id,data);
 const after=x.db.fullSale(x.actor,s.id);assert.equal(after.items[0].description,data.items[0].description);assert.equal(x.db.products(x.actor)[0].name,'Produto original');assert.equal(after.known_cost_cents,1750);assert.equal(after.business_date,'2026-08-05');assert.equal(after.confirmed_at,before.confirmed_at);assert.deepEqual(after.payments,before.payments);
 assert.equal(x.ops.entries(x.actor)[0].unit_cost_cents,1750);assert.equal(x.ops.editSale(x.actor,s.id,data).replayed,true);invariant(x);
});
test('edição completa: cartão e Pix preservam fotografia antiga ao corrigir valor e data',t=>{
 const x=setup(t);receive(x);const rate=x.db.saveRate(x.actor,{machine:'Máquina antiga',brand:'Visa',mode:'credit',installments:2,basis_points:199}),account=x.db.savePixAccount(x.actor,{name:'Conta antiga'});
 const s=createSale(x,[{method:'card',rate_id:rate.id,amount_cents:7000},{method:'pix',pix_account_id:account.id,amount_cents:3000}]),old=x.db.fullSale(x.actor,s.id),originalRows=x.db.all('SELECT * FROM payments'),requests=x.db.all('SELECT * FROM payment_requests');
 x.db.saveRate(x.actor,{machine:'Máquina nova',brand:'Visa',mode:'credit',installments:2,basis_points:999,active:false},rate.id);x.db.savePixAccount(x.actor,{name:'Conta renomeada',active:false},account.id);
 const data=edit(x,s.id,{payments:old.payments.map(p=>({id:p.id,amount_cents:p.method==='card'?7500:2500,paid_date:'2026-08-07'}))});x.ops.editSale(x.actor,s.id,data);
 const updated=x.db.fullSale(x.actor,s.id),card=updated.payments.find(p=>p.method==='card'),pix=updated.payments.find(p=>p.method==='pix');assert.equal(card.machine,'Máquina antiga');assert.equal(card.basis_points,199);assert.equal(card.fee_cents,feeCents(7500,199));assert.equal(pix.pix_account_name,'Conta antiga');assert.equal(businessDate(new Date(card.created_at)),'2026-08-07');assert.equal(updated.reconciliation.gross_cents,10000);
 for(const p of originalRows)assert.deepEqual(x.db.get('SELECT * FROM payments WHERE id=?',p.id),p);assert.deepEqual(x.db.all('SELECT * FROM payment_requests'),requests);
 for(const req of s.requests)assert.equal(x.db.addPayment(x.actor,s.id,req).replayed,true);assert.equal(x.db.fullSale(x.actor,s.id).reconciliation.gross_cents,10000);
 assert.equal(x.ops.editSale(x.actor,s.id,data).replayed,true);assert.equal(x.db.all('SELECT * FROM payment_changes').length,2);invariant(x);
});
test('edição completa: substituir, remover e incluir pagamentos; replay antigo nunca ressuscita removido',t=>{
 const x=setup(t);receive(x);const s=createSale(x),rate=x.db.saveRate(x.actor,{machine:'Cartão',brand:'Outra',mode:'debit',installments:1,basis_points:249});
 let payment=x.db.fullSale(x.actor,s.id).payments[0];x.ops.editSale(x.actor,s.id,edit(x,s.id,{payments:[{id:payment.id,method:'card',rate_id:rate.id,amount_cents:10000}]}));
 payment=x.db.fullSale(x.actor,s.id).payments[0];assert.equal(payment.method,'card');assert.equal(payment.fee_cents,249);
 x.ops.editSale(x.actor,s.id,edit(x,s.id,{payments:[],acknowledge_difference:true}));assert.equal(x.db.fullSale(x.actor,s.id).payments.length,0);assert.equal(x.db.addPayment(x.actor,s.id,s.requests[0]).replayed,true);assert.equal(x.db.fullSale(x.actor,s.id).payments.length,0);
 const data=edit(x,s.id,{payments:[{method:'cash',amount_cents:10000}]});x.ops.editSale(x.actor,s.id,data);x.ops.editSale(x.actor,s.id,data);assert.equal(x.db.fullSale(x.actor,s.id).payments.length,1);assert.equal(x.db.fullSale(x.actor,s.id).reconciliation.gross_cents,10000);assert.equal(x.db.all('SELECT * FROM payments').length,3);invariant(x);
});
test('edição completa: bloqueio de permissões, IDs repetidos/cruzados, campos inválidos e rollback',t=>{
 const x=setup(t);receive(x);const s=createSale(x),other=createSale(x),p=x.db.fullSale(x.actor,s.id).payments[0],foreign=x.db.fullSale(x.actor,other.id).payments[0],restricted={...x.actor,is_owner:false,permissions:['sales.edit_confirmed','payments.record']};
 for(const extra of [{payments:[{id:p.id,amount_cents:9999}]},{payments:[]}]){const before=snapshot(x);assert.throws(()=>x.ops.editSale(restricted,s.id,edit(x,s.id,{...extra,acknowledge_difference:true})),/Acesso/);assert.deepEqual(snapshot(x),before);}
 for(const payments of [[{id:p.id},{id:p.id}],[{id:foreign.id}],[null],[{id:p.id,method:'card',rate_id:{}}],[{id:p.id,method:'pix',pix_account_id:[]}],[{id:p.id,amount_cents:-1}]]){const before=snapshot(x);assert.throws(()=>x.ops.editSale(x.actor,s.id,edit(x,s.id,{payments})));assert.deepEqual(snapshot(x),before);}
 const before=snapshot(x),audit=x.db.audit.bind(x.db);x.db.audit=(...args)=>{if(args[1]==='payment')throw Error('Falha simulada de auditoria');return audit(...args);};
 assert.throws(()=>x.ops.editSale(x.actor,s.id,edit(x,s.id,{payments:[{id:p.id,amount_cents:9000}],acknowledge_difference:true})),/Falha simulada/);assert.deepEqual(snapshot(x),before);invariant(x);
});
test('edição completa: origem/destino fechados e custo de outro mês são protegidos integralmente',t=>{
 const x=setup(t),entry=receive(x),s=createSale(x);x.db.run("UPDATE sales SET business_date='2026-07-05' WHERE id=?",s.id);close(x,'2026-08');
 let before=snapshot(x);assert.throws(()=>x.ops.editSale(x.actor,s.id,edit(x,s.id,{business_date:'2026-08-10'})),/nova data está fechado/);assert.deepEqual(snapshot(x),before);
 close(x,'2026-07');before=snapshot(x);assert.throws(()=>x.ops.editSale(x.actor,s.id,edit(x,s.id,{business_date:'2026-06-01',payments:[],acknowledge_difference:true})),/mês desta venda/);assert.deepEqual(snapshot(x),before);
 assert.throws(()=>x.ops.updateEntry(x.actor,entry.id,{quantity:4,unit_cost_cents:777,version:1,reason:'Custo',request_id:randomUUID()}),/mês já fechado/);assert.deepEqual(snapshot(x),before);invariant(x);
});
test('edição completa: data brasileira válida, mesmo dia preserva timestamp; futuro e data impossível rejeitados',t=>{
 assert.equal(editedTimestamp('2026-08-31','2026-09-01T01:30:00.000Z'),'2026-09-01T01:30:00.000Z');assert.throws(()=>editedTimestamp('2026-02-30'));assert.throws(()=>editedTimestamp('2099-01-01'),/futuro/);
 const x=setup(t),entry=receive(x),s=createSale(x),before=snapshot(x);assert.throws(()=>x.ops.editSale(x.actor,s.id,edit(x,s.id,{business_date:'2099-01-01'})),/futuro/);assert.deepEqual(snapshot(x),before);
 const productCount=x.db.products(x.actor).length;assert.throws(()=>x.ops.updateEntry(x.actor,entry.id,{new_product:{name:'Não criar',price_cents:0},received_date:'2026-02-30',quantity:2,version:1,reason:'Data errada',request_id:randomUUID()}),/Data inválida/);assert.equal(x.db.products(x.actor).length,productCount);assert.deepEqual(snapshot(x),before);
});

test('edição completa: vendedor original inativo permanece, mas uma nova atribuição a inativo é rejeitada',t=>{
 const x=setup(t);receive(x);const seller=x.db.addUser(x.actor,{name:'Antigo',email:'inactive-seller@example.test',password:'senha-ficticia-de-teste',permissions:[]}),s=createSale(x,undefined,{seller_id:seller.id});
 x.db.run('UPDATE users SET active=0 WHERE id=?',seller.id);
 x.ops.editSale(x.actor,s.id,edit(x,s.id,{public_notes:'Detalhe corrigido'}));assert.equal(x.db.fullSale(x.actor,s.id).seller_id,seller.id);
 const other=createSale(x),before=snapshot(x);assert.throws(()=>x.ops.editSale(x.actor,other.id,edit(x,other.id,{seller_id:seller.id})),/inativo/);assert.deepEqual(snapshot(x),before);invariant(x);
});

test('edição completa: Pix legado sem conta pode ser corrigido em cadeia, sem liberar novos Pix nulos',t=>{
 const x=setup(t);receive(x);const s=createSale(x),original=x.db.fullSale(x.actor,s.id).payments[0];
 // Simula o registro anterior ao cadastro de contas; a aplicação atual não cria Pix sem conta.
 x.db.db.exec('DROP TRIGGER trg_payments_pix_catalog_update');x.db.run("UPDATE payments SET method='pix' WHERE id=?",original.id);x.db.installCatalogIntegrityTriggers();
 for(const amount of [9000,8000]){const old=x.db.fullSale(x.actor,s.id).payments[0];x.ops.editSale(x.actor,s.id,edit(x,s.id,{payments:[{id:old.id,amount_cents:amount,pix_account_id:null}],acknowledge_difference:true}));const next=x.db.fullSale(x.actor,s.id).payments[0];assert.equal(next.pix_account_id,null);assert.equal(next.pix_account_name,null);assert.equal(next.amount_cents,amount);}
 const originalStored=x.db.get('SELECT * FROM payments WHERE id=?',original.id);assert.equal(originalStored.amount_cents,10000);assert.equal(x.db.all('SELECT * FROM payment_changes').length,2);
 let before=snapshot(x);assert.throws(()=>x.ops.editSale(x.actor,s.id,edit(x,s.id,{payments:[{method:'pix',amount_cents:8000}],acknowledge_difference:true})),/conta Pix/);assert.deepEqual(snapshot(x),before);
 const old=x.db.fullSale(x.actor,s.id).payments[0];
 const insertReplacement=(method,accountId,accountName,link=true)=>x.db.transaction(()=>{
  const nextId=randomUUID();if(link)x.db.run('INSERT INTO payment_changes VALUES(?,?,?,?,?,?,?)',x.actor.tenant_id,s.id,old.id,nextId,'Teste de integridade',x.actor.id,new Date().toISOString());
  x.db.run('INSERT INTO payments(id,tenant_id,sale_id,method,amount_cents,basis_points,fee_cents,created_at,pix_account_id,pix_account_name) VALUES(?,?,?,?,?,?,?,?,?,?)',nextId,x.actor.tenant_id,s.id,method,100,0,0,new Date().toISOString(),accountId,accountName);
 });
 for(const args of [['pix',null,null,false],['pix',null,'Parcial'],['pix','inexistente',null],['cash',null,'Inválido']]){assert.throws(()=>insertReplacement(...args),/snapshot/);assert.deepEqual(snapshot(x),before);}
 assert.throws(()=>x.db.transaction(()=>x.db.run('INSERT INTO payment_changes VALUES(?,?,?,?,?,?,?)',x.actor.tenant_id,s.id,old.id,randomUUID(),'Órfão',x.actor.id,new Date().toISOString())),/FOREIGN KEY/);assert.deepEqual(snapshot(x),before);invariant(x);
});

test('edição completa: pagamento de outra loja é recusado na API de domínio e nas chaves do banco',t=>{
 const x=setup(t);receive(x);const s=createSale(x),old=x.db.fullSale(x.actor,s.id).payments[0],actor=x.db.actor(x.db.register({name:'Outra loja',store_name:'Separada',email:'separate-full@example.test',password:'senha-ficticia-de-teste'}).token);
 const customer=x.db.addCustomer(actor,{name:'Outro cliente'}),foreignId=x.db.saveDraft(actor,{customer_id:customer.id,seller_id:actor.id,items:[{description:'Avulso',quantity:1,unit_price_cents:1000,manual_cost_cents:0}]}).id;
 x.db.addPayment(actor,foreignId,{method:'cash',amount_cents:1000,request_id:randomUUID()});x.db.confirm(actor,foreignId,true);const foreign=x.db.fullSale(actor,foreignId).payments[0],before=snapshot(x);
 assert.throws(()=>x.ops.editSale(x.actor,s.id,edit(x,s.id,{payments:[{id:foreign.id}]})),/nesta venda/);assert.deepEqual(snapshot(x),before);
 assert.throws(()=>x.db.transaction(()=>x.db.run('INSERT INTO payment_changes VALUES(?,?,?,?,?,?,?)',x.actor.tenant_id,s.id,old.id,foreign.id,'Conta cruzada',x.actor.id,new Date().toISOString())),/FOREIGN KEY/);assert.deepEqual(snapshot(x),before);
 assert.throws(()=>x.ops.updateEntry(x.actor,x.ops.entries(x.actor)[0].id,{product_id:randomUUID(),quantity:1,reason:'Teste',version:1,request_id:randomUUID()}),/não encontrado/);assert.deepEqual(snapshot(x),before);invariant(x);
});

test('edição completa: mudança conjunta dos itens, cliente, vendedor, detalhes, despesas, status e pagamentos',t=>{
 const x=setup(t);receive(x);const s=createSale(x),other=x.db.addProduct(x.actor,{name:'Produto substituto',price_cents:2000}),customer=x.db.addCustomer(x.actor,{name:'Cliente corrigido'}),seller=x.db.addUser(x.actor,{name:'Vendedor corrigido',email:'new-full-seller@example.test',password:'senha-ficticia-de-teste',permissions:[]});
 const lot=receive(x,{product_id:other.id,quantity:3,unit_cost_cents:500}),status=x.db.saveSaleStatus(x.actor,{name:'Entregue',color:'#00DDEE'}),pix=x.db.savePixAccount(x.actor,{name:'Nova conta'}),rate=x.db.saveRate(x.actor,{machine:'Nova máquina',brand:'Mastercard',mode:'credit',installments:3,basis_points:592});
 const data=edit(x,s.id,{customer_id:customer.id,seller_id:seller.id,business_date:'2026-08-28',operational_status_id:status.id,public_notes:'Pedido atualizado',freight_cents:100,expenses:[{description:'Embalagem',amount_cents:50}],items:[{product_id:other.id,description:'Produto escolhido',quantity:2,unit_price_cents:2000,serial_number:'IMEI-1\nIMEI-2',details:'Azul',share_details:true},{description:'Serviço avulso',quantity:1,unit_price_cents:1000,manual_cost_cents:200}],entry_costs:[{id:lot.id,version:1,unit_cost_cents:600}],payments:[{method:'pix',amount_cents:2000,pix_account_id:pix.id,paid_date:'2026-08-28'},{method:'card',amount_cents:3000,rate_id:rate.id,paid_date:'2026-08-29'}]});
 x.ops.editSale(x.actor,s.id,data);const after=x.db.fullSale(x.actor,s.id);assert.equal(after.customer_id,customer.id);assert.equal(after.seller_id,seller.id);assert.equal(after.business_date,'2026-08-28');assert.equal(after.operational_status.id,status.id);assert.equal(after.items.length,2);assert.equal(after.items[0].serial_number,'IMEI-1\nIMEI-2');assert.equal(after.items[0].share_details,true);assert.equal(after.total_cents,5000);assert.equal(after.known_cost_cents,1400);assert.equal(after.profit_cents,5000-1400-178-150);assert.equal(after.reconciliation.gross_cents,5000);assert.equal(x.db.products(x.actor).find(p=>p.id===x.product.id).stock,4);assert.equal(x.db.products(x.actor).find(p=>p.id===other.id).stock,1);invariant(x);
});

test('edição completa: atualização aditiva preserva registros e correções persistem após reabrir',t=>{
 const dir=mkdtempSync(join(tmpdir(),'pdv-full-edit-')),path=join(dir,'test.sqlite');let db=new Store(path);t.after(()=>{db.close();rmSync(dir,{recursive:true,force:true});});
 const token=db.register({name:'Persistência',store_name:'Teste',email:'persist-full@example.test',password:'senha-ficticia-de-teste'}).token,actor=db.actor(token),product=db.addProduct(actor,{name:'Persistido',price_cents:10000}),customer=db.addCustomer(actor,{name:'Cliente'}),x={db,actor,product,customer,ops:db.operations};receive(x);const s=createSale(x),raw=db.all('SELECT * FROM payments'),requests=db.all('SELECT * FROM payment_requests'),before=snapshot(x);
 // A versão anterior não tinha esta tabela; o trigger anterior é instalado no banco de teste.
 db.db.exec('DROP TRIGGER trg_payments_pix_catalog_insert; DROP TABLE payment_changes; CREATE TRIGGER trg_payments_pix_catalog_insert BEFORE INSERT ON payments WHEN NEW.method="pix" AND NEW.pix_account_id IS NULL BEGIN SELECT RAISE(ABORT, \'old snapshot trigger\'); END;');db.close();db=new Store(path);x.db=db;x.ops=db.operations;
 assert.deepEqual(snapshot(x),before);assert.equal(db.actor(token).id,actor.id);const original=db.fullSale(actor,s.id).payments[0],data=edit(x,s.id,{payments:[{id:original.id,amount_cents:9000}],acknowledge_difference:true});x.ops.editSale(actor,s.id,data);const corrected=db.fullSale(actor,s.id);db.close();db=new Store(path);x.db=db;x.ops=db.operations;
 assert.equal(db.fullSale(actor,s.id).reconciliation.gross_cents,9000);assert.equal(db.fullSale(actor,s.id).payments[0].id,corrected.payments[0].id);assert.deepEqual(db.get('SELECT * FROM payments WHERE id=?',raw[0].id),raw[0]);assert.deepEqual(db.all('SELECT * FROM payment_requests'),requests);assert.equal(x.ops.editSale(actor,s.id,data).replayed,true);invariant(x);
});
