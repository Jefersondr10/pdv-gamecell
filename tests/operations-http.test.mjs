import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { application } from '../src/server.mjs';
import { Store } from '../src/store.mjs';

test('HTTP operações: novas entradas, edição, exclusão, venda, CSV, permissões e reenvios',async t=>{
 const db=new Store(),origin='http://127.0.0.1:3999',{server}=application({store:db,origin});
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));t.after(async()=>{await new Promise(resolve=>server.close(resolve));db.close();});
 const base='http://127.0.0.1:'+server.address().port;
 async function register(email){const r=await fetch(base+'/api/register',{method:'POST',headers:{Origin:origin,'Content-Type':'application/json'},body:JSON.stringify({name:'Teste',store_name:'Loja HTTP',email,password:'senha-ficticia-de-teste'})});assert.equal(r.status,201);return r.headers.get('set-cookie').split(';')[0];}
 const cookie=await register('operations-http@example.test'),headers={Cookie:cookie,Origin:origin,'Content-Type':'application/json'};
 async function call(path,data,method=data?'POST':'GET',h=headers){return fetch(base+'/api'+path,{method,headers:h,...(data?{body:JSON.stringify(data)}:{})});}
 async function json(path,data,method,expected=200){const r=await call(path,data,method),v=await r.json();assert.equal(r.status,expected,JSON.stringify(v));return v;}
 for(const path of ['/stock/report','/stock/report.csv'])assert.equal((await call(path,null,'GET',{})).status,401);
 const actor=db.actor(cookie.split('=')[1]),data={new_product:{name:'Produto HTTP',sku:'H-1',price_cents:1000},quantity:4,unit_cost_cents:250,request_id:randomUUID()};
 assert.equal((await call('/stock/entries',data,'POST',{Cookie:cookie,'Content-Type':'application/json'})).status,403);
 const responses=await Promise.all([call('/stock/entries',data),call('/stock/entries',data)]);assert.deepEqual(responses.map(r=>r.status).sort(),[200,201]);
 const [entry,replay]=await Promise.all(responses.map(r=>r.json()));assert.equal(entry.id,replay.id);assert.equal(db.all('SELECT * FROM lots').length,1);
 assert.equal((await call('/stock/entries',{...data,quantity:5})).status,409);
 const customer=db.addCustomer(actor,{name:'Cliente'}),saleId=db.saveDraft(actor,{customer_id:customer.id,seller_id:actor.id,items:[{product_id:entry.product_id,quantity:1,unit_price_cents:1000}]}).id;
 db.addPayment(actor,saleId,{method:'cash',amount_cents:1000,request_id:randomUUID()});db.confirm(actor,saleId,true);
 await json('/stock/entries/'+entry.id,{quantity:4,unit_cost_cents:275,version:1,reason:'Custo corrigido',request_id:randomUUID()},'PUT');
 const sale=await json('/sales/'+saleId),edit={customer_id:customer.id,seller_id:actor.id,items:sale.items.map(i=>({id:i.id,product_id:i.product_id,quantity:2,unit_price_cents:1000})),reason:'Quantidade corrigida',edit_token:sale.edit_token,request_id:randomUUID(),acknowledge_difference:true};
 assert.equal((await call('/sales/'+saleId+'/edit',edit,'PUT',{...headers,Origin:'https://outro.example'})).status,403);
 const edited=await json('/sales/'+saleId+'/edit',edit,'PUT');assert.equal(edited.id,saleId);assert.equal((await json('/sales/'+saleId+'/edit',edit,'PUT')).replayed,true);
 const saved=await json('/sales/'+saleId);assert.equal(saved.items[0].received_cents,1000);assert.equal(saved.items[0].pending_cents,1000);assert.deepEqual(saved.payments,sale.payments);
 const denied=db.addUser(actor,{name:'Sem acesso',email:'ops-denied@example.test',password:'senha-ficticia-de-teste',permissions:[]});
 let login=await call('/login',{email:denied.email,password:'senha-ficticia-de-teste'}),deniedCookie=login.headers.get('set-cookie').split(';')[0],deniedHeaders={...headers,Cookie:deniedCookie};
 assert.equal((await call('/sales/'+saleId+'/edit',{...edit,request_id:randomUUID()},'PUT',deniedHeaders)).status,403);
 assert.equal((await call('/stock/entries/'+entry.id+'/void',{version:2,reason:'Duplicada',request_id:randomUUID()},'POST',deniedHeaders)).status,403);
 const restrictedReport=await call('/stock/report',null,'GET',deniedHeaders);assert.doesNotMatch(JSON.stringify(await restrictedReport.json()),/cost_cents/);
 let csv=await call('/stock/report.csv',null,'GET',deniedHeaders);assert.equal(csv.status,200);assert.match(csv.headers.get('content-type'),/text\/csv/);assert.equal(csv.headers.get('cache-control'),'no-store');assert.doesNotMatch(await csv.text(),/Custo do estoque disponível \(R\$\)|275/);
 const otherCookie=await register('ops-other-http@example.test'),otherHeaders={...headers,Cookie:otherCookie};
 assert.equal((await call('/sales/'+saleId+'/edit',{...edit,request_id:randomUUID()},'PUT',otherHeaders)).status,404);
 assert.equal((await call('/stock/entries/'+entry.id,{quantity:1,version:2,reason:'Teste',request_id:randomUUID()},'PUT',otherHeaders)).status,404);
 assert.equal((await(await call('/stock/report',null,'GET',otherHeaders)).json()).products.length,0);
 const voidData={version:2,reason:'Entrada duplicada',request_id:randomUUID()};await json('/stock/entries/'+entry.id+'/void',voidData);assert.equal((await json('/stock/entries/'+entry.id+'/void',voidData)).replayed,true);
 assert.equal((await json('/stock/report')).products[0].stock,-2);assert.ok((await json('/state')).stock_entries[0].voided_at);
 assert.deepEqual(db.all('PRAGMA foreign_key_check'),[]);
});

test('HTTP edição completa: entrada atual, novo produto, data e pagamentos substituídos sem reenvio duplicado',async t=>{
 const db=new Store(),origin='http://127.0.0.1:3999',{server}=application({store:db,origin});
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));t.after(async()=>{await new Promise(resolve=>server.close(resolve));db.close();});const base='http://127.0.0.1:'+server.address().port;
 const registration=db.register({name:'Editor',store_name:'Edição HTTP',email:'full-http@example.test',password:'senha-ficticia-de-teste'}),actor=db.actor(registration.token),headers={Cookie:'pdv_session='+registration.token,Origin:origin,'Content-Type':'application/json'};
 // Usa o cookie emitido pelo servidor, sem depender do nome configurado.
 const login=await fetch(base+'/api/login',{method:'POST',headers:{Origin:origin,'Content-Type':'application/json'},body:JSON.stringify({email:'full-http@example.test',password:'senha-ficticia-de-teste'})});headers.Cookie=login.headers.get('set-cookie').split(';')[0];
 async function call(path,data,method=data?'PUT':'GET',override=headers){return fetch(base+'/api'+path,{method,headers:override,...(data?{body:JSON.stringify(data)}:{})});}
 async function json(path,data,method,expected=200){const response=await call(path,data,method),body=await response.json();assert.equal(response.status,expected,JSON.stringify(body));return body;}
 const product=db.addProduct(actor,{name:'Original',price_cents:1000}),customer=db.addCustomer(actor,{name:'Cliente'}),entry=db.operations.receive(actor,{product_id:product.id,quantity:3,unit_cost_cents:200,request_id:randomUUID()});
 assert.equal((await call('/stock/entries/'+entry.id,null,'GET',{})).status,401);const current=await json('/stock/entries/'+entry.id);assert.equal(current.version,1);assert.equal(current.product_id,product.id);
 const changed=await json('/stock/entries/'+entry.id,{new_product:{name:'Correto',sku:'NOVO',price_cents:1200},quantity:2,unit_cost_cents:300,received_date:'2026-08-01',reason:'Produto e data corretos',version:current.version,request_id:randomUUID()});
 const fresh=await json('/stock/entries/'+entry.id);assert.equal(fresh.version,2);assert.equal(fresh.product_name,'Correto');assert.equal(fresh.received_date,'2026-08-01');assert.notEqual(fresh.product_id,product.id);
 const id=db.saveDraft(actor,{customer_id:customer.id,seller_id:actor.id,items:[{product_id:fresh.product_id,quantity:1,unit_price_cents:1200}]}).id,request={method:'cash',amount_cents:1200,request_id:randomUUID()};db.addPayment(actor,id,request);db.confirm(actor,id,true);const before=await json('/sales/'+id),pix=db.savePixAccount(actor,{name:'Conta HTTP'});
 const edit={customer_id:customer.id,seller_id:actor.id,items:[{id:before.items[0].id,product_id:fresh.product_id,description:'Produto editado',quantity:2,unit_price_cents:1300}],payments:[{id:before.payments[0].id,method:'pix',pix_account_id:pix.id,amount_cents:2600,paid_date:'2026-08-02'}],business_date:'2026-08-02',reason:'Conferência final',edit_token:before.edit_token,request_id:randomUUID()};
 assert.equal((await call('/sales/'+id+'/edit',edit,'PUT',{...headers,Origin:'https://outro.example'})).status,403);
 await json('/sales/'+id+'/edit',edit);assert.equal((await json('/sales/'+id+'/edit',edit)).replayed,true);const after=await json('/sales/'+id);assert.equal(after.items[0].description,'Produto editado');assert.equal(after.items[0].received_cents,2600);assert.equal(after.profit_cents,2000);assert.equal(after.business_date,'2026-08-02');assert.equal(after.payments[0].method,'pix');assert.equal(after.payments[0].pix_account_id,pix.id);assert.equal(db.all('SELECT * FROM payments').length,2);assert.equal(db.all('SELECT * FROM payment_changes').length,1);
 assert.equal((await json('/sales/'+id+'/payments',request,'POST')).replayed,true);assert.equal((await json('/sales/'+id)).payments.length,1);
 const malformed={...edit,edit_token:after.edit_token,request_id:randomUUID(),payments:[{id:after.payments[0].id,paid_date:'31/02/2026'}]};assert.equal((await call('/sales/'+id+'/edit',malformed)).status,400);assert.equal(db.fullSale(actor,id).payments[0].id,after.payments[0].id);
 const another=db.register({name:'Outra',store_name:'Outra',email:'full-http-other@example.test',password:'senha-ficticia-de-teste'}),otherActor=db.actor(another.token);assert.equal(db.operations.entries(otherActor).length,0);assert.deepEqual(db.all('PRAGMA foreign_key_check'),[]);
});
