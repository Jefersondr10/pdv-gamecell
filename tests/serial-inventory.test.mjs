import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdtempSync,rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Store } from '../src/store.mjs';
import { publicSale } from '../src/domain.mjs';

function setup(t,path){const db=new Store(path);t.after(()=>{try{db.close();}catch{}});const actor=db.actor(db.register({name:'Teste SN',store_name:'Loja SN',email:'sn@example.test',password:'senha-ficticia-para-teste'}).token),product=db.addProduct(actor,{name:'PS4',sku:'PS4',price_cents:150000,serial_tracked:true}),customer=db.addCustomer(actor,{name:'Cliente'});return {db,actor,product,customer,ops:db.operations};}
const receive=(x,units,extra={})=>x.ops.receive(x.actor,{product_id:x.product.id,units:units.map((serial_number,i)=>({serial_number,unit_cost_cents:100000+i*10000})),request_id:randomUUID(),...extra});
const draft=(x,ids,extra={})=>x.db.saveDraft(x.actor,{customer_id:x.customer.id,seller_id:x.actor.id,items:[{product_id:x.product.id,quantity:ids.length||1,unit_ids:ids,unit_price_cents:150000}],...extra}).id;
const units=x=>x.db.serials.units(x.actor,x.product.id);
const stock=x=>x.db.products(x.actor).find(p=>p.id===x.product.id).stock;
const correction=(x,id,items)=>{const sale=x.db.sale(x.actor,id);return {customer_id:sale.customer_id,seller_id:sale.seller_id,items:items??sale.items,edit_token:sale.edit_token,request_id:randomUUID(),reason:'Corrigir aparelho',acknowledge_difference:true};};
const entryData=(x,id,extra={})=>({quantity:x.ops.entries(x.actor).find(e=>e.id===id).quantity_initial,version:x.ops.entries(x.actor).find(e=>e.id===id).version,request_id:randomUUID(),reason:'Conferência de entrada',...extra});
function invariant(x){assert.deepEqual(x.db.all('PRAGMA foreign_key_check'),[]);assert.equal(x.db.get('PRAGMA integrity_check').integrity_check,'ok');for(const lot of x.db.all('SELECT * FROM lots'))assert.ok(lot.quantity_remaining>=0&&lot.quantity_remaining<=lot.quantity_initial);}

test('SN: dez PS4 no mesmo cadastro, saída escolhe custo exato e cancelamento libera o aparelho',t=>{
 const x=setup(t);receive(x,Array.from({length:10},(_,i)=>`PS4-${i}`));assert.equal(stock(x),10);assert.equal(x.db.products(x.actor).length,1);
 const chosen=units(x).find(u=>u.serial_number==='PS4-7'),id=draft(x,[chosen.id]);assert.equal(stock(x),10);x.db.confirm(x.actor,id,true);
 assert.equal(stock(x),9);assert.equal(x.db.sale(x.actor,id).known_cost_cents,170000);assert.equal(units(x).find(u=>u.id===chosen.id).status,'sold');
 const before=x.db.sale(x.actor,id);x.ops.cancelSale(x.actor,id,{edit_token:before.edit_token,request_id:randomUUID(),reason:'Cliente desistiu',acknowledge_stock_return:true});
 assert.equal(stock(x),10);assert.equal(units(x).find(u=>u.id===chosen.id).status,'available');
 const second=draft(x,[chosen.id]);x.db.confirm(x.actor,second,true);assert.equal(x.db.sale(x.actor,id).items[0].serial_number,'PS4-7');assert.equal(stock(x),9);invariant(x);
});
test('SN: concorrência entre rascunhos, repetição na venda e unidades faltantes não baixam estoque',t=>{
 const x=setup(t);receive(x,['001234567890123']);const unit=units(x)[0],first=draft(x,[unit.id]),second=draft(x,[unit.id]);
 x.db.confirm(x.actor,first,true);const alloc=x.db.all('SELECT * FROM allocations');assert.throws(()=>x.db.confirm(x.actor,second,true),/não está disponível/);
 assert.deepEqual(x.db.all('SELECT * FROM allocations'),alloc);assert.equal(x.db.sale(x.actor,second).status,'draft');assert.equal(stock(x),0);
 assert.throws(()=>draft(x,[unit.id,unit.id]),/mesmo aparelho/);const missing=draft(x,[]);assert.throws(()=>x.db.confirm(x.actor,missing,true),/cada unidade/);
 assert.throws(()=>draft(x,[unit.id],{items:[{product_id:x.product.id,quantity:1,unit_price_cents:1,unit_ids:[unit.id]},{product_id:x.product.id,quantity:1,unit_price_cents:1,unit_ids:[unit.id]}]}),/dois itens/);invariant(x);
});
test('SN: edição troca aparelhos, custo, quantidade e cancelamento devolve os selecionados',t=>{
 const x=setup(t);receive(x,['A','B','C']);const [a,b,c]=['A','B','C'].map(sn=>units(x).find(u=>u.serial_number===sn));
 const id=draft(x,[a.id]);x.db.confirm(x.actor,id,true);const item=x.db.sale(x.actor,id).items[0];
 x.ops.editSale(x.actor,id,correction(x,id,[{...item,quantity:2,unit_ids:[b.id,c.id]}]));
 assert.equal(stock(x),1);assert.equal(units(x).find(u=>u.id===a.id).status,'available');assert.equal(x.db.sale(x.actor,id).known_cost_cents,230000);
 assert.equal(x.db.sale(x.actor,id).items[0].serial_number,'B\nC');
 const before=x.db.sale(x.actor,id);x.ops.cancelSale(x.actor,id,{edit_token:before.edit_token,request_id:randomUUID(),reason:'Devolução',acknowledge_stock_return:true});assert.equal(stock(x),3);invariant(x);
});
test('SN: lote novo em conjunto é atômico/idempotente e duplicados não criam produto, lote ou auditoria',t=>{
 const x=setup(t),data={new_product:{name:'Celular',price_cents:50000,serial_tracked:true},units:[{serial_number:'000X',unit_cost_cents:20000},{serial_number:' 000x ',unit_cost_cents:22000}],request_id:randomUUID()},tables=['products','lots','inventory_units','audit','operation_requests'];
 const before=tables.map(table=>x.db.all(`SELECT * FROM ${table}`));assert.throws(()=>x.ops.receive(x.actor,data),/já está cadastrado/);assert.deepEqual(tables.map(table=>x.db.all(`SELECT * FROM ${table}`)),before);
 data.units[1].serial_number='000Y';const result=x.ops.receive(x.actor,data);assert.equal(x.ops.receive(x.actor,data).replayed,true);assert.equal(result.entry_ids.length,2);
 assert.throws(()=>receive(x,['000X']),/já está cadastrado/);assert.throws(()=>receive(x,['TEXT\nTEXT']),/um único/);assert.throws(()=>receive(x,['']),/SN/);invariant(x);
});
test('SN: rota legada de entrada não contorna identificação e produto comum segue FIFO/negativo',t=>{
 const x=setup(t);assert.throws(()=>x.db.receive(x.actor,{product_id:x.product.id,quantity:1,unit_cost_cents:100}),/SN/);
 const p=x.db.addProduct(x.actor,{name:'Cabo',price_cents:1000});const id=x.db.saveDraft(x.actor,{customer_id:x.customer.id,seller_id:x.actor.id,items:[{product_id:p.id,quantity:2,unit_price_cents:1000}]}).id;
 x.db.confirm(x.actor,id,true);assert.equal(x.db.products(x.actor).find(i=>i.id===p.id).stock,-2);
 x.db.receive(x.actor,{product_id:p.id,quantity:1,unit_cost_cents:100});assert.equal(x.db.sale(x.actor,id).pending_cost_quantity,1);
 assert.throws(()=>x.db.receive(x.actor,{product_id:p.id,quantity:1,unit_cost_cents:100,serial_number:'TESTE'}),/Ative/);invariant(x);
});
test('SN: ativar e identificar estoque legado conserva saldo, vendas e alocações existentes',t=>{
 const x=setup(t);x.db.updateProduct(x.actor,x.product.id,{edit_token:x.db.product(x.actor,x.product.id).edit_token,serial_tracked:false});
 const entry=x.db.receive(x.actor,{product_id:x.product.id,quantity:10,unit_cost_cents:90000});const id=draft(x,[],{items:[{product_id:x.product.id,quantity:2,unit_price_cents:150000}]});x.db.confirm(x.actor,id,true);
 const before=x.db.fullSale(x.actor,id),alloc=x.db.all('SELECT * FROM allocations');
 x.db.updateProduct(x.actor,x.product.id,{edit_token:x.db.product(x.actor,x.product.id).edit_token,serial_tracked:true});
 x.ops.updateEntry(x.actor,entry.id,entryData(x,entry.id,{units:[{serial_number:'A'},{serial_number:'B'}]}));assert.equal(stock(x),8);assert.deepEqual(x.db.all('SELECT * FROM allocations'),alloc);
 const kept=x.ops.entries(x.actor).find(e=>e.id===entry.id).units;
 assert.throws(()=>x.ops.updateEntry(x.actor,entry.id,entryData(x,entry.id,{units:[...kept,...Array.from({length:7},(_,i)=>({serial_number:'EXTRA'+i}))]})),/disponíveis/);
 const unit=units(x).find(u=>u.serial_number==='B'),next=draft(x,[unit.id]);x.db.confirm(x.actor,next,true);assert.equal(stock(x),7);assert.equal(x.db.sale(x.actor,next).known_cost_cents,90000);
 x.ops.editSale(x.actor,id,correction(x,id));assert.equal(x.db.fullSale(x.actor,id).known_cost_cents,before.known_cost_cents);assert.equal(stock(x),7);invariant(x);
});
test('SN: exclusão de entrada vendida e troca de produto são bloqueadas; custo é corrigível em mês aberto',t=>{
 const x=setup(t),entry=receive(x,['A']),unit=units(x)[0],id=draft(x,[unit.id]);x.db.confirm(x.actor,id,true);
 const before=x.db.all('SELECT * FROM lots');assert.throws(()=>x.ops.updateEntry(x.actor,entry.id,entryData(x,entry.id),true),/aparelho vendido/);
 assert.throws(()=>x.ops.updateEntry(x.actor,entry.id,entryData(x,entry.id,{units:[]})),/remover uma unidade vendida/);
 assert.throws(()=>x.ops.updateEntry(x.actor,entry.id,entryData(x,entry.id,{units:[{id:unit.id,serial_number:'TROCADO'}]})),/já foi vendido/);
 assert.deepEqual(x.db.all('SELECT * FROM lots'),before);
 x.ops.updateEntry(x.actor,entry.id,entryData(x,entry.id,{unit_cost_cents:110000}));assert.equal(x.db.sale(x.actor,id).known_cost_cents,110000);
 x.db.addPayment(x.actor,id,{method:'cash',amount_cents:150000,request_id:randomUUID()});x.db.run("UPDATE sales SET business_date='2026-08-20' WHERE id=?",id);
 const result=x.db.finance.report(x.actor,'2026-08').result;x.db.finance.closeMonth(x.actor,{month:'2026-08',source_hash:result.source_hash,settings_version:result.settings_version});
 assert.throws(()=>x.ops.updateEntry(x.actor,entry.id,entryData(x,entry.id,{unit_cost_cents:120000})),/mês já fechado/);assert.equal(units(x)[0].unit_cost_cents,110000);invariant(x);
});
test('SN: produto editável com token, preço/nome não reescrevem vendas, isolamento e custos privados',t=>{
 const x=setup(t);receive(x,['000123']);const unit=units(x)[0],id=draft(x,[unit.id]);x.db.confirm(x.actor,id,true);
 const other=x.db.actor(x.db.register({name:'Outro',store_name:'Outra loja',email:'other-sn@example.test',password:'senha-ficticia-para-teste'}).token),p=x.db.addProduct(other,{name:'PS4',serial_tracked:true});
 x.db.receive(other,{product_id:p.id,quantity:1,unit_cost_cents:5,serial_number:'000123'});
 assert.throws(()=>x.db.serials.units(other,x.product.id),/não encontrado/);assert.throws(()=>draft(x,[x.db.serials.units(other,p.id)[0].id]),/não pertence/);
 const restricted={...x.actor,is_owner:false,permissions:['sales.create','sales.edit_draft','sales.confirm']};
 assert.equal(x.db.serials.units(restricted,x.product.id)[0].unit_cost_cents,undefined);assert.equal(x.db.productHistory(restricted,x.product.id).units[0].unit_cost_cents,undefined);
 assert.throws(()=>x.db.updateProduct(restricted,x.product.id,{name:'X'}),/não permitido/);
 const old=x.db.product(x.actor,x.product.id);x.db.updateProduct(x.actor,x.product.id,{edit_token:old.edit_token,name:'PS4 revisado',sku:'NOVO',price_cents:180000});assert.equal(x.db.sale(x.actor,id).items[0].description,'PS4');
 assert.throws(()=>x.db.updateProduct(x.actor,x.product.id,{edit_token:old.edit_token,name:'Obsoleto'}),/mudou/);
 const published=publicSale(x.db.fullSale(x.actor,id));assert.doesNotMatch(JSON.stringify(published),/000123|unit_ids|unit_cost/);
 const data=correction(x,id);data.items[0].share_details=true;x.ops.editSale(x.actor,id,data);const shared=publicSale(x.db.fullSale(x.actor,id));assert.match(JSON.stringify(shared),/000123/);assert.doesNotMatch(JSON.stringify(shared),/unit_ids|unit_cost|lot_id/);invariant(x);
});
test('SN: mais de 1000 caracteres de identificação derivada e reedição preservam unidades',t=>{
 const x=setup(t);receive(x,Array.from({length:70},(_,i)=>String(i).padStart(15,'0')));const selected=units(x).map(u=>u.id),id=draft(x,selected);x.db.confirm(x.actor,id,true);
 const sale=x.db.sale(x.actor,id);assert.ok(sale.items[0].serial_number.length>1000);x.ops.editSale(x.actor,id,correction(x,id));assert.equal(stock(x),0);invariant(x);
});
test('SN: reabertura preserva unidades e vínculos existentes',t=>{
 const dir=mkdtempSync(join(tmpdir(),'gamecell-sn-'));let reopened;t.after(()=>{reopened?.close();rmSync(dir,{recursive:true,force:true});});const path=join(dir,'test.sqlite'),x=setup(t,path);receive(x,['PERSISTENTE']);const id=draft(x,[units(x)[0].id]);x.db.confirm(x.actor,id,true);
 const before=x.db.all('SELECT * FROM allocations');x.db.close();reopened=new Store(path);assert.equal(reopened.serials.units(x.actor,x.product.id)[0].status,'sold');assert.deepEqual(reopened.all('SELECT * FROM allocations'),before);assert.deepEqual(reopened.all('PRAGMA foreign_key_check'),[]);
});

test('SN: identificação removida pode ser restaurada na mesma entrada sem duplicar saldo',t=>{
 const x=setup(t);
 x.db.updateProduct(x.actor,x.product.id,{edit_token:x.db.product(x.actor,x.product.id).edit_token,serial_tracked:false});
 const entry=x.db.receive(x.actor,{product_id:x.product.id,quantity:2,unit_cost_cents:100000});
 x.db.updateProduct(x.actor,x.product.id,{edit_token:x.db.product(x.actor,x.product.id).edit_token,serial_tracked:true});
 x.ops.updateEntry(x.actor,entry.id,entryData(x,entry.id,{units:[{serial_number:'RESTAURAR'},{serial_number:'MANTER'}]}));
 const unit=units(x).find(u=>u.serial_number==='RESTAURAR'),keep=units(x).find(u=>u.serial_number==='MANTER');
 x.ops.updateEntry(x.actor,entry.id,entryData(x,entry.id,{quantity:1,units:[keep]}));assert.equal(units(x).find(u=>u.id===unit.id).status,'removed');assert.equal(stock(x),1);
 x.ops.updateEntry(x.actor,entry.id,entryData(x,entry.id,{quantity:2,units:[keep,{serial_number:'RESTAURAR'}]}));
 assert.equal(units(x).length,2);assert.equal(units(x).find(u=>u.id===unit.id).status,'available');assert.equal(stock(x),2);
 const sale=draft(x,[unit.id]);x.db.confirm(x.actor,sale,true);assert.equal(stock(x),1);invariant(x);
});

test('SN: rascunho identificado ainda sem aparelhos impede desligar o controle',t=>{
 const x=setup(t),sale=draft(x,[]);
 assert.equal(x.db.sale(x.actor,sale).status,'draft');
 assert.throws(()=>x.db.updateProduct(x.actor,x.product.id,{edit_token:x.db.product(x.actor,x.product.id).edit_token,serial_tracked:false}),/SN|IMEI/);
 assert.equal(x.db.product(x.actor,x.product.id).serial_tracked,true);invariant(x);
});

test('SN: migração de banco sem controle de unidades preserva todos os registros e mês fechado',t=>{
 const dir=mkdtempSync(join(tmpdir(),'gamecell-sn-migration-'));let migrated;
 t.after(()=>{migrated?.close();rmSync(dir,{recursive:true,force:true});});
 const path=join(dir,'legacy.sqlite'),x=setup(t,path);
 x.db.updateProduct(x.actor,x.product.id,{edit_token:x.db.product(x.actor,x.product.id).edit_token,serial_tracked:false});
 x.db.receive(x.actor,{product_id:x.product.id,quantity:10,unit_cost_cents:90000});
 const sale=draft(x,[],{business_date:'2026-08-20',items:[{product_id:x.product.id,quantity:2,unit_price_cents:150000,serial_number:'SN LIVRE ANTIGO'}]});
 x.db.addPayment(x.actor,sale,{method:'cash',amount_cents:300000,request_id:randomUUID()});x.db.confirm(x.actor,sale,true);
 const report=x.db.finance.report(x.actor,'2026-08').result;
 x.db.finance.closeMonth(x.actor,{month:'2026-08',source_hash:report.source_hash,settings_version:report.settings_version});
 const finance=x.db.finance.report(x.actor,'2026-08'),historicSale=x.db.fullSale(x.actor,sale);
 x.db.db.exec('DROP TABLE sale_item_units; DROP TABLE sale_item_tracking; DROP TABLE inventory_units; ALTER TABLE products DROP COLUMN serial_tracked;');
 const names=x.db.all("SELECT name FROM sqlite_schema WHERE type='table' AND name NOT LIKE 'sqlite_stat%' ORDER BY name").map(t=>t.name);
 const records=store=>Object.fromEntries(names.map(name=>[name,store.all('SELECT rowid AS preservation_rowid,* FROM "'+name.replaceAll('"','""')+'"').map(row=>{const copy={...row};if(name==='products')delete copy.serial_tracked;return copy;})]));
 const before=records(x.db);x.db.close();migrated=new Store(path);
 assert.deepEqual(records(migrated),before);assert.equal(migrated.product(x.actor,x.product.id).serial_tracked,false);
 for(const table of ['inventory_units','sale_item_tracking','sale_item_units'])assert.equal(migrated.get('SELECT COUNT(*) AS n FROM '+table).n,0);
 assert.deepEqual(migrated.fullSale(x.actor,sale),historicSale);assert.deepEqual(migrated.finance.report(x.actor,'2026-08'),finance);
 assert.equal(migrated.products(x.actor)[0].stock,8);assert.deepEqual(migrated.all('PRAGMA foreign_key_check'),[]);
 migrated.close();migrated=new Store(path);assert.deepEqual(records(migrated),before);
 assert.deepEqual(migrated.finance.report(x.actor,'2026-08'),finance);
});
