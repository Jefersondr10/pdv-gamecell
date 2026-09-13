import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { Store } from '../src/store.mjs';
import { application } from '../src/server.mjs';
import { matchesCatalog,unitList,unitPicker } from '../public/serial-ui.mjs';

test('buscas: nome, código, acentos, CPF, telefone e termos literais',()=>{
 for(const [text,query] of [['João Silva','JOAO'],['PS4 Slim PS4-01','ps4 slim'],['Cliente (11) 98888-1234','11988881234'],['CPF 12345678909','123.456.789-09'],['Produto [ABC]','[abc]']])assert.equal(matchesCatalog(text,query),true);
 assert.equal(matchesCatalog('Ana','Pedro'),false);assert.equal(matchesCatalog('PS4','PS5'),false);
});
test('unidades: HTML escapado, busca, seleção e custos respeitam permissão',()=>{
 const rows=[{id:'unit',serial_number:'<SN>',status:'available',unit_cost_cents:90000}],helpers={esc:s=>String(s).replaceAll('<','&lt;').replaceAll('>','&gt;'),money:c=>'R$ '+c,costs:false};
 const html=unitList(rows,helpers),picker=unitPicker(rows,['unit'],helpers);assert.match(html,/&lt;SN&gt;/);assert.doesNotMatch(html,/90000|R\$|<SN>/);assert.match(picker,/name="unit_ids" value="unit" checked/);assert.match(picker,/type="search"/);assert.doesNotMatch(picker,/90000/);
 assert.match(unitList(rows,{...helpers,costs:true}),/90000/);
});
test('contratos mobile: SN visível na etapa do produto, revisão por aparelho e busca não refaz formulário',()=>{
 const app=readFileSync(new URL('../public/app.mjs',import.meta.url),'utf8'),mobile=readFileSync(new URL('../public/mobile-ui.mjs',import.meta.url),'utf8');
 assert.match(app,/serialSaleField\(i,n\)/);assert.match(app,/working\.original_unit_ids/);assert.match(app,/if\(product.serial_tracked\)filterUnitRows/);
 assert.match(mobile,/form.querySelector\('\[data-entry-serials\]'\)/);assert.match(mobile,/Custos por aparelho/);
 assert.match(app,/row.hidden=!matchesCatalog/);assert.match(app,/data-catalog-search/);
});
test('HTTP: edição, entrada por SN, consulta e saída com sessão/CSRF/loja protegidas',async t=>{
 const db=new Store(),origin='http://127.0.0.1:3999',{server}=application({store:db,origin});await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));t.after(async()=>{await new Promise(resolve=>server.close(resolve));db.close();});
 const reg=db.register({name:'Teste',store_name:'SN HTTP',email:'sn-http@example.test',password:'senha-ficticia-para-teste'}),actor=db.actor(reg.token),base='http://127.0.0.1:'+server.address().port,headers={Cookie:'pdv_session='+reg.token,Origin:origin,'Content-Type':'application/json'};
 const call=(path,data,method=data?'POST':'GET',custom=headers)=>fetch(base+path,{method,headers:custom,...(data?{body:JSON.stringify(data)}:{})});
 let response=await call('/api/products',{name:'PS4',serial_tracked:true});assert.equal(response.status,201);const product=await response.json();
 assert.equal((await call('/api/products/'+product.id,null,'GET',{})).status,401);
 let current=await(await call('/api/products/'+product.id)).json();assert.equal((await call('/api/products/'+product.id,{name:'PS4 Slim',edit_token:current.edit_token},'PUT')).status,200);
 assert.equal((await call('/api/products/'+product.id,{name:'PS4',edit_token:current.edit_token},'PUT')).status,409);
 assert.equal((await call('/api/products/'+product.id,{name:'Forbidden'},'PUT',{...headers,Origin:'https://other.example'})).status,403);
 const data={product_id:product.id,units:[{serial_number:'001',unit_cost_cents:100000},{serial_number:'002',unit_cost_cents:120000}],request_id:randomUUID()};
 const results=await Promise.all([call('/api/stock/entries',data),call('/api/stock/entries',data)]);assert.deepEqual(results.map(r=>r.status).sort(),[200,201]);
 response=await call('/api/products/'+product.id+'/units');assert.equal(response.headers.get('cache-control'),'no-store');const units=await response.json();assert.equal(units.length,2);
 assert.equal((await call('/api/entries',{product_id:product.id,quantity:1,unit_cost_cents:100})).status,400);
 const customer=db.addCustomer(actor,{name:'Cliente'}),sale=await(await call('/api/sales',{customer_id:customer.id,seller_id:actor.id,items:[{product_id:product.id,unit_ids:[units[0].id],quantity:1,unit_price_cents:150000}]})).json();
 assert.equal((await call('/api/sales/'+sale.id+'/confirm',{acknowledge_difference:true,draft_token:sale.draft_token})).status,200);
 const result=await(await call('/api/sales/'+sale.id)).json();assert.equal(result.known_cost_cents,units[0].unit_cost_cents);
 const other=db.actor(db.register({name:'Outro',store_name:'Outra',email:'other-http-sn@example.test',password:'senha-ficticia-para-teste'}).token);assert.throws(()=>db.product(other,product.id),/não encontrado/);
 assert.equal((await call('/serial-ui.mjs')).status,200);assert.deepEqual(db.all('PRAGMA foreign_key_check'),[]);
});
