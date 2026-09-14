import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { application } from '../src/server.mjs';
import { Store } from '../src/store.mjs';

test('HTTP: autenticação, CSRF, payload público e ausência de cookie no JSON',async t=>{
 const store=new Store(),origin='http://127.0.0.1:3999';const{server}=application({store,origin});
 await new Promise(r=>server.listen(0,'127.0.0.1',r));
 t.after(async()=>{await new Promise(r=>server.close(r));store.close();});
 const base='http://127.0.0.1:'+server.address().port;
 let r=await fetch(base+'/api/state');assert.equal(r.status,401);
 r=await fetch(base+'/api/register',{method:'POST',headers:{'Content-Type':'application/json','Origin':'https://outro.example'},body:'{}'});assert.equal(r.status,403);
 r=await fetch(base+'/api/register',{method:'POST',headers:{'Content-Type':'application/json','Origin':origin},body:JSON.stringify({name:'A',store_name:'Teste HTTP',email:'http@example.test',password:'senha-de-teste-456'})});
 assert.equal(r.status,201);const cookie=r.headers.get('set-cookie');assert.match(cookie,/HttpOnly/);assert.match(cookie,/SameSite=Strict/);
 const payload=await r.json();assert.ok(!('token'in payload));
 r=await fetch(base+'/api/state',{headers:{Cookie:cookie.split(';')[0]}});assert.equal(r.status,200);assert.equal((await r.json()).store.name,'Teste HTTP');
 r=await fetch(base+'/api/products',{method:'POST',headers:{Cookie:cookie.split(';')[0],'Content-Type':'text/plain','Origin':origin},body:'{}'});assert.equal(r.status,415);
 r=await fetch(base+'/api/products',{method:'POST',headers:{Cookie:cookie.split(';')[0],'Content-Type':'application/json'},body:'{}'});assert.equal(r.status,403);
 r=await fetch(base+'/api/public/'+'a'.repeat(64));assert.equal(r.status,404);assert.equal(r.headers.get('cache-control'),'no-store');
 r=await fetch(base+'/.env');assert.equal(r.status,404);
});

test('HTTP: pagamento exige UUID e replay idêntico não duplica lançamento', async t => {
 const store=new Store(),origin='http://127.0.0.1:3999';const{server}=application({store,origin});
 await new Promise(r=>server.listen(0,'127.0.0.1',r));
 t.after(async()=>{await new Promise(r=>server.close(r));store.close();});
 const base='http://127.0.0.1:'+server.address().port;
 let r=await fetch(base+'/api/register',{method:'POST',headers:{'Content-Type':'application/json','Origin':origin},body:JSON.stringify({name:'A',store_name:'Teste HTTP',email:'http-idem@example.test',password:'senha-de-teste-456'})});
 assert.equal(r.status,201);const cookie=r.headers.get('set-cookie').split(';')[0];
 const headers={Cookie:cookie,'Content-Type':'application/json',Origin:origin};
 r=await fetch(base+'/api/sales',{method:'POST',headers,body:JSON.stringify({items:[]})});
 assert.equal(r.status,201);const createdSale=await r.json(),saleId=createdSale.id;
 r=await fetch(base+'/api/pix-accounts',{method:'POST',headers,body:JSON.stringify({name:'Pix HTTP'})});
 assert.equal(r.status,201);const pixAccountId=(await r.json()).id;

 r=await fetch(base+`/api/sales/${saleId}/payments`,{method:'POST',headers,body:JSON.stringify({method:'pix',amount_cents:10000})});
 assert.equal(r.status,400);assert.match((await r.json()).error,/request_id.*UUID/);

 const requestId=randomUUID(),payload={request_id:requestId,method:'pix',amount_cents:10000,pix_account_id:pixAccountId};
 r=await fetch(base+`/api/sales/${saleId}/payments`,{method:'POST',headers,body:JSON.stringify(payload)});
 assert.equal(r.status,201);const first=await r.json();assert.equal(first.replayed,false);
 r=await fetch(base+`/api/sales/${saleId}/payments`,{method:'POST',headers,body:JSON.stringify(payload)});
 assert.equal(r.status,200);const replay=await r.json();assert.equal(replay.replayed,true);assert.equal(replay.id,first.id);
 r=await fetch(base+`/api/sales/${saleId}/payments`,{method:'POST',headers,body:JSON.stringify({...payload,amount_cents:10001})});
 assert.equal(r.status,409);

 r=await fetch(base+`/api/sales/${saleId}`,{headers:{Cookie:cookie}});assert.equal(r.status,200);
 const sale=await r.json();assert.equal(sale.payments.length,1);assert.equal(sale.reconciliation.gross_cents,10000);
});

test('HTTP: cadastra, edita, atribui e filtra status operacional', async t => {
 const store=new Store(),origin='http://127.0.0.1:3999';const{server}=application({store,origin});
 await new Promise(r=>server.listen(0,'127.0.0.1',r));
 t.after(async()=>{await new Promise(r=>server.close(r));store.close();});
 const base='http://127.0.0.1:'+server.address().port;
 let r=await fetch(base+'/api/register',{method:'POST',headers:{'Content-Type':'application/json','Origin':origin},body:JSON.stringify({name:'A',store_name:'Teste status',email:'http-status@example.test',password:'senha-de-teste-456'})});
 assert.equal(r.status,201);const cookie=r.headers.get('set-cookie').split(';')[0];
 const headers={Cookie:cookie,'Content-Type':'application/json',Origin:origin};

 r=await fetch(base+'/api/sale-statuses',{method:'POST',headers,body:JSON.stringify({name:'Em separação',color:'amber'})});
 assert.equal(r.status,201);const status=await r.json();assert.equal(status.color,'amber');
 r=await fetch(base+'/api/sales',{method:'POST',headers,body:JSON.stringify({items:[]})});
 assert.equal(r.status,201);const createdSale=await r.json(),saleId=createdSale.id;
 r=await fetch(base+`/api/sales/${saleId}/status`,{method:'PUT',headers,body:JSON.stringify({operational_status_id:status.id})});
 assert.equal(r.status,200);let sale=await r.json();
 assert.equal(sale.status,'draft');assert.equal(sale.operational_status_id,status.id);assert.equal(sale.operational_status.name,'Em separação');

 r=await fetch(base+`/api/state?operational_status_id=${status.id}`,{headers:{Cookie:cookie}});
 assert.equal(r.status,200);let state=await r.json();assert.equal(state.sales.length,1);assert.equal(state.sale_statuses.length,2);
 r=await fetch(base+`/api/sale-statuses/${status.id}`,{method:'PUT',headers,body:JSON.stringify({name:'Pronto',color:'green'})});
 assert.equal(r.status,200);assert.equal((await r.json()).name,'Pronto');
 r=await fetch(base+`/api/sales/${saleId}`,{headers:{Cookie:cookie}});sale=await r.json();assert.equal(sale.operational_status.name,'Pronto');

 r=await fetch(base+'/api/sale-statuses',{method:'POST',headers,body:JSON.stringify({name:'Outro',color:'orange'})});
 assert.equal(r.status,400);
 r=await fetch(base+`/api/sales/${saleId}/status`,{method:'PUT',headers,body:JSON.stringify({operational_status_id:null})});
 assert.equal(r.status,200);assert.equal((await r.json()).operational_status,null);
});

test('HTTP: catálogos Pix e fornecedor alimentam pagamento, entrada e histórico', async t => {
 const store=new Store(),origin='http://127.0.0.1:3999';const{server}=application({store,origin});
 await new Promise(r=>server.listen(0,'127.0.0.1',r));
 t.after(async()=>{await new Promise(r=>server.close(r));store.close();});
 const base='http://127.0.0.1:'+server.address().port;
 let r=await fetch(base+'/api/register',{method:'POST',headers:{'Content-Type':'application/json','Origin':origin},body:JSON.stringify({name:'A',store_name:'Teste catálogos',email:'http-catalogs@example.test',password:'senha-de-teste-456'})});
 assert.equal(r.status,201);const registered=await r.json(),cookie=r.headers.get('set-cookie').split(';')[0];
 const headers={Cookie:cookie,'Content-Type':'application/json',Origin:origin};

 r=await fetch(base+'/api/pix-accounts',{method:'POST',headers,body:JSON.stringify({name:'Pix balcão'})});
 assert.equal(r.status,201);const pix=await r.json();assert.equal(pix.active,true);
 r=await fetch(base+'/api/suppliers',{method:'POST',headers,body:JSON.stringify({name:'Fornecedor HTTP',email:'compras@example.test'})});
 assert.equal(r.status,201);const supplier=await r.json();
 r=await fetch(base+'/api/products',{method:'POST',headers,body:JSON.stringify({name:'Produto HTTP',price_cents:10000})});
 assert.equal(r.status,201);const product=await r.json();
 r=await fetch(base+'/api/customers',{method:'POST',headers,body:JSON.stringify({name:'Cliente HTTP'})});
 assert.equal(r.status,201);const customer=await r.json();
 r=await fetch(base+'/api/entries',{method:'POST',headers,body:JSON.stringify({product_id:product.id,supplier_id:supplier.id,quantity:2,unit_cost_cents:4000})});
 assert.equal(r.status,201);assert.equal((await r.json()).supplier_name,'Fornecedor HTTP');
 r=await fetch(base+'/api/sales',{method:'POST',headers,body:JSON.stringify({customer_id:customer.id,seller_id:registered.user.id,items:[{product_id:product.id,quantity:1,unit_price_cents:10000}]})});
 assert.equal(r.status,201);const createdSale=await r.json(),saleId=createdSale.id;
 r=await fetch(base+`/api/sales/${saleId}/payments`,{method:'POST',headers,body:JSON.stringify({request_id:randomUUID(),method:'pix',amount_cents:10000,pix_account_id:pix.id})});
 assert.equal(r.status,201);
 r=await fetch(base+`/api/sales/${saleId}/confirm`,{method:'POST',headers,body:JSON.stringify({draft_token:createdSale.draft_token})});assert.equal(r.status,200);

 r=await fetch(base+`/api/pix-accounts/${pix.id}`,{method:'PUT',headers,body:JSON.stringify({name:'Pix novo nome',active:false})});
 assert.equal(r.status,200);assert.equal((await r.json()).active,false);
 r=await fetch(base+`/api/suppliers/${supplier.id}`,{method:'PUT',headers,body:JSON.stringify({name:'Fornecedor renomeado'})});
 assert.equal(r.status,200);
 r=await fetch(base+`/api/products/${product.id}/history`,{headers:{Cookie:cookie}});
 assert.equal(r.status,200);const history=await r.json();
 assert.equal(history.entries[0].supplier_name,'Fornecedor HTTP');assert.equal(history.entries[0].unit_cost_cents,4000);
 assert.equal(history.sales.length,1);assert.equal(history.sales[0].sale_id,saleId);
 r=await fetch(base+`/api/sales/${saleId}`,{headers:{Cookie:cookie}});const sale=await r.json();
 assert.equal(sale.payments[0].pix_account_name,'Pix balcão');
 r=await fetch(base+'/api/state',{headers:{Cookie:cookie}});const state=await r.json();
 assert.equal(state.pix_accounts[0].name,'Pix novo nome');assert.equal(state.pix_accounts[0].active,false);
 assert.equal(state.suppliers[0].name,'Fornecedor renomeado');
 assert.equal(state.products[0].fifo_cost_cents,4000);assert.equal(state.products[0].last_cost_cents,4000);
});
