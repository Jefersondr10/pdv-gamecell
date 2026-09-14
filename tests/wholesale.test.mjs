import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdtempSync, rmSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { DatabaseSync } from 'node:sqlite';
import { runInNewContext } from 'node:vm';
import { Store } from '../src/store.mjs';
import { application } from '../src/server.mjs';
import { businessDate, publicSale } from '../src/domain.mjs';
import { wholesaleBadge, wholesaleControl, wholesaleEditor, salesRecords } from '../public/sales-view.mjs';

function setup(t,path=':memory:') {
 const db=new Store(path);t.after(()=>db.close());
 const token=db.register({name:'Pessoa de teste',store_name:'Atacado teste',email:'atacado@example.test',password:'senha-ficticia-de-teste'}).token;
 const actor=db.actor(token),customer=db.addCustomer(actor,{name:'Cliente de teste'}),product=db.addProduct(actor,{name:'Produto de teste',price_cents:10000});
 db.receive(actor,{product_id:product.id,quantity:5,unit_cost_cents:3000});
 return {db,actor,customer,product,token};
}
const draftData=(x,extra={})=>({customer_id:x.customer.id,seller_id:x.actor.id,items:[{product_id:x.product.id,quantity:1,unit_price_cents:10000}],...extra});
function sale(x,extra={},confirmed=false) {
 const id=x.db.saveDraft(x.actor,draftData(x,extra)).id;
 if(confirmed){x.db.addPayment(x.actor,id,{method:'cash',amount_cents:10000,request_id:randomUUID()});x.db.confirm(x.actor,id,true);}
 return id;
}
const toggleData=(x,id,value)=>({is_wholesale:value,edit_token:x.db.sale(x.actor,id).edit_token,request_id:randomUUID()});
const unchanged=s=>{const {is_wholesale,updated_at,...rest}=s;return rest;};
function editData(x,id,extra={}) {
 const s=x.db.sale(x.actor,id);
 return {customer_id:s.customer_id,seller_id:s.seller_id,items:s.items.map(i=>({id:i.id,product_id:i.product_id,description:i.description,quantity:i.quantity,unit_price_cents:i.unit_price_cents})),edit_token:s.edit_token,request_id:randomUUID(),reason:'Conferir identificação de atacado',...extra};
}

test('atacado: padrão desmarcado, criação marcada e omissão preservada na edição',t=>{
 const x=setup(t),normal=sale(x),id=sale(x,{is_wholesale:true});
 assert.equal(x.db.sale(x.actor,normal).is_wholesale,false);assert.equal(x.db.sale(x.actor,id).is_wholesale,true);
 x.db.saveDraft(x.actor, {draft_token:x.db.operations.draftToken(x.actor,id),...(draftData(x))}, id);assert.equal(x.db.sale(x.actor,id).is_wholesale,true);
 x.db.saveDraft(x.actor, {draft_token:x.db.operations.draftToken(x.actor,id),...(draftData(x,{is_wholesale:false,original_is_wholesale:true}))}, id);
 assert.equal(x.db.sale(x.actor,id).is_wholesale,false);
 assert.equal(x.db.snapshot(x.actor).sales.find(s=>s.id===id).is_wholesale,false);
});

test('atacado: tipos inválidos são rejeitados sem registros parciais',t=>{
 const x=setup(t),id=sale(x,{is_wholesale:true}),before=x.db.fullSale(x.actor,id),audit=x.db.all('SELECT * FROM audit');
 for(const value of [null,0,1,'true','false','on',[],{}]) {
  assert.throws(()=>x.db.saveDraft(x.actor, {draft_token:x.db.operations.draftToken(x.actor,id),...(draftData(x,{is_wholesale:value}))}, id),/atacado inválida/);
  assert.throws(()=>x.db.operations.setWholesale(x.actor,id,toggleData(x,id,value)),/atacado inválida/);
 }
 assert.deepEqual(x.db.fullSale(x.actor,id),before);assert.deepEqual(x.db.all('SELECT * FROM audit'),audit);
 assert.throws(()=>x.db.run('UPDATE sales SET is_wholesale=2 WHERE id=?',id),/CHECK/);
});

test('atacado: marcar pela lista é auditado, idempotente e não altera valores, pagamentos ou FIFO',t=>{
 const x=setup(t),id=sale(x,{},true),before=x.db.fullSale(x.actor,id),month=businessDate().slice(0,7);
 const tables=['sale_items','payments','payment_requests','payment_changes','allocations','lots','sale_fifo_order'];
 const rows=tables.map(table=>x.db.all('SELECT * FROM '+table)),hash=x.db.finance.calculate(x.actor,month).source_hash;
 const payload=toggleData(x,id,true);
 assert.equal(x.db.operations.setWholesale(x.actor,id,payload).replayed,false);
 assert.equal(x.db.operations.setWholesale(x.actor,id,payload).replayed,true);
 assert.throws(()=>x.db.operations.setWholesale(x.actor,id,{...payload,is_wholesale:false}),/outros dados/);
 assert.deepEqual(unchanged(x.db.fullSale(x.actor,id)),unchanged(before));
 assert.deepEqual(tables.map(table=>x.db.all('SELECT * FROM '+table)),rows);
 assert.equal(x.db.finance.calculate(x.actor,month).source_hash,hash);
 const changes=x.db.all("SELECT data_json FROM audit WHERE action='wholesale_changed'");
 assert.equal(changes.length,1);assert.deepEqual(JSON.parse(changes[0].data_json),{before:false,after:true});
 assert.equal(x.db.sale(x.actor,id).is_wholesale,true);assert.equal(publicSale(x.db.fullSale(x.actor,id)).is_wholesale,undefined);
 x.db.operations.setWholesale(x.actor,id,toggleData(x,id,false));assert.equal(x.db.sale(x.actor,id).is_wholesale,false);
});

test('atacado: token obsoleto, falha de auditoria e formulário antigo não sobrescrevem a marcação',t=>{
 const x=setup(t),id=sale(x),stale=toggleData(x,id,false);
 x.db.operations.setWholesale(x.actor,id,toggleData(x,id,true));
 assert.throws(()=>x.db.operations.setWholesale(x.actor,id,stale),/venda mudou/);
 assert.throws(()=>x.db.saveDraft(x.actor, {draft_token:x.db.operations.draftToken(x.actor,id),...(draftData(x,{is_wholesale:false,original_is_wholesale:false}))}, id),/outra tela/);
 const before=x.db.fullSale(x.actor,id),requests=x.db.all('SELECT * FROM operation_requests'),audit=x.db.audit;
 x.db.audit=()=>{throw Error('falha de auditoria');};
 assert.throws(()=>x.db.operations.setWholesale(x.actor,id,toggleData(x,id,false)),/falha de auditoria/);x.db.audit=audit;
 assert.deepEqual(x.db.fullSale(x.actor,id),before);assert.deepEqual(x.db.all('SELECT * FROM operation_requests'),requests);
});

test('atacado: editar pedido confirmado marca, preserva na omissão e permite desmarcar',t=>{
 const x=setup(t),id=sale(x,{},true),before=x.db.fullSale(x.actor,id);
 const data=editData(x,id,{is_wholesale:true,original_is_wholesale:false});
 x.db.operations.editSale(x.actor,id,data);assert.equal(x.db.operations.editSale(x.actor,id,data).replayed,true);
 assert.equal(x.db.sale(x.actor,id).is_wholesale,true);assert.deepEqual(x.db.fullSale(x.actor,id).payments,before.payments);
 x.db.operations.editSale(x.actor,id,editData(x,id));assert.equal(x.db.sale(x.actor,id).is_wholesale,true);
 x.db.operations.editSale(x.actor,id,editData(x,id,{is_wholesale:false,original_is_wholesale:true}));assert.equal(x.db.sale(x.actor,id).is_wholesale,false);
 const change=JSON.parse(x.db.all("SELECT data_json FROM audit WHERE action='confirmed_corrected' ORDER BY rowid")[0].data_json);
 assert.equal(change.before.is_wholesale,false);assert.equal(change.after.is_wholesale,true);
});

test('atacado: permissões separadas e isolamento entre lojas continuam obrigatórios',t=>{
 const x=setup(t),draft=sale(x),confirmed=sale(x,{},true),denied={...x.actor,is_owner:false,permissions:[]};
 for(const id of [draft,confirmed])assert.throws(()=>x.db.operations.setWholesale(denied,id,toggleData(x,id,true)),/Acesso/);
 const editor={...denied,permissions:['sales.edit_draft']};
 x.db.operations.setWholesale(editor,draft,toggleData(x,draft,true));
 assert.throws(()=>x.db.operations.setWholesale(editor,confirmed,toggleData(x,confirmed,true)),/Acesso/);
 const other=x.db.actor(x.db.register({name:'Outra',store_name:'Outra loja',email:'outra-atacado@example.test',password:'senha-ficticia-de-teste'}).token);
 assert.throws(()=>x.db.operations.setWholesale(other,draft,toggleData(x,draft,false)),/encontrad/);
 assert.equal(x.db.sale(denied,draft).is_wholesale,true);
});

test('atacado: mês fechado impede alterações pela lista e pelo editor completo',t=>{
 const x=setup(t),id=sale(x,{},true);
 x.db.run("UPDATE sales SET business_date='2026-08-10' WHERE id=?",id);
 const result=x.db.finance.report(x.actor,'2026-08').result;
 x.db.finance.closeMonth(x.actor,{month:'2026-08',source_hash:result.source_hash,settings_version:result.settings_version});
 const before=x.db.fullSale(x.actor,id);
 assert.throws(()=>x.db.operations.setWholesale(x.actor,id,toggleData(x,id,true)),/fechado/);
 assert.throws(()=>x.db.operations.editSale(x.actor,id,editData(x,id,{is_wholesale:true})),/fechado/);
 assert.deepEqual(x.db.fullSale(x.actor,id),before);
});

test('atacado: migração aditiva mantém vendas antigas e classificação persiste ao reabrir',t=>{
 const dir=mkdtempSync(join(tmpdir(),'pdv-wholesale-'));t.after(()=>rmSync(dir,{recursive:true,force:true}));
 const path=join(dir,'pdv.sqlite');let db=new Store(path);
 const token=db.register({name:'Legado',store_name:'Legado',email:'legacy-wholesale@example.test',password:'senha-ficticia-de-teste'}).token;
 let actor=db.actor(token);const id=db.saveDraft(actor,{items:[]}).id;db.close();
 const legacy=new DatabaseSync(path);legacy.exec('ALTER TABLE sales DROP COLUMN is_wholesale');
 const old=legacy.prepare('SELECT * FROM sales').all();legacy.close();
 db=new Store(path);actor=db.actor(token);assert.equal(db.sale(actor,id).is_wholesale,false);
 assert.deepEqual(db.all('SELECT * FROM sales').map(({is_wholesale,...row})=>row),old.map(row=>({...row})));
 db.operations.setWholesale(actor,id,{is_wholesale:true,edit_token:db.sale(actor,id).edit_token,request_id:randomUUID()});db.close();
 db=new Store(path);try{assert.equal(db.sale(db.actor(token),id).is_wholesale,true);assert.deepEqual(db.all('PRAGMA foreign_key_check'),[]);}finally{db.close();}
});

test('HTTP atacado: salvar, marcar e editar usam o servidor e exigem sessão/origem válidas',async t=>{
 const x=setup(t),origin='http://127.0.0.1:3999',{server}=application({store:x.db,origin});
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));t.after(()=>new Promise(resolve=>server.close(resolve)));
 const base='http://127.0.0.1:'+server.address().port,headers={Cookie:'pdv_session='+x.token,Origin:origin,'Content-Type':'application/json'};
 const call=(path,data,h=headers)=>fetch(base+'/api'+path,{method:'PUT',headers:h,body:JSON.stringify(data)});
 const created=await fetch(base+'/api/sales',{method:'POST',headers,body:JSON.stringify(draftData(x,{is_wholesale:true}))});assert.equal(created.status,201);const {id}=await created.json();
 let response=await call('/sales/'+id,{...draftData(x,{is_wholesale:false,original_is_wholesale:true}),draft_token:x.db.operations.draftToken(x.actor,id)});assert.equal(response.status,200);
 const payload=toggleData(x,id,true),path='/sales/'+id+'/wholesale';
 assert.equal((await call(path,payload,{'Content-Type':'application/json',Origin:origin})).status,401);
 assert.equal((await call(path,payload,{...headers,Origin:'https://outro.example'})).status,403);
 const responses=await Promise.all([call(path,payload),call(path,payload)]);assert.deepEqual(responses.map(r=>r.status),[200,200]);
 const values=await Promise.all(responses.map(r=>r.json()));assert.deepEqual(values.map(v=>v.replayed).sort(),[false,true]);
 const read=await fetch(base+'/api/sales/'+id,{headers});assert.equal((await read.json()).is_wholesale,true);
 assert.equal((await call(path,{...toggleData(x,id,false),is_wholesale:'false'})).status,400);
 assert.equal((await call(path,{...payload,is_wholesale:false,request_id:randomUUID()})).status,409);
});

const esc=value=>String(value??'').replaceAll('&','&amp;').replaceAll('"','&quot;').replaceAll('<','&lt;');
test('interface atacado: checkbox compacto acompanha a data e permanece acessível na lista',()=>{
 assert.match(wholesaleEditor(true),/type="checkbox" data-bind="is_wholesale" checked/);
 assert.doesNotMatch(wholesaleEditor(false),/checked/);assert.match(wholesaleEditor(false),/Venda de atacado/);
 const record={id:'venda',number:1,status:'draft',is_wholesale:true,items:[],reconciliation:{gross_cents:0,pending_cents:0}};
 assert.match(wholesaleControl(record,{esc,can:()=>true}),/aria-label="Venda de atacado — venda 1"/);
 assert.equal(wholesaleControl(record,{esc,can:()=>false}),wholesaleBadge(record));
 const html=salesRecords([record],{esc,money:String,date:String,time:()=>'',can:()=>true,statusBadge:()=>'',paymentBadge:()=>'',operationalStatusControl:()=>'',empty:()=>''});
 assert.match(html,/sale-record-meta-line[^]*sale-timing[^]*data-sale-wholesale="venda"/);
 assert.ok(html.indexOf('data-sale-wholesale="venda"')<html.indexOf('sale-record-compact-values'));
 assert.doesNotMatch(html,/sale-record-compact-footer[^]*data-sale-wholesale/);
 const app=readFileSync(new URL('../public/app.mjs',import.meta.url),'utf8');
 const editor=app.slice(app.indexOf('function renderEditor()'),app.indexOf('function updateSummary()'));
 assert.match(editor,/sale-editor-core-fields[^]*\$\{editorSaleDate\(w\)\}\$\{wholesaleEditor\(w\.is_wholesale\)\}\$\{editorCustomerField\(w\)\}/);
 assert.match(app,/is_wholesale:w.is_wholesale,original_is_wholesale:w.original_is_wholesale/);
 assert.equal((app.match(/working\[el\.dataset\.bind\]=el\.type==='checkbox'\?el\.checked:el\.value/g)||[]).length,2);
 const mobile=readFileSync(new URL('../public/mobile-ui.mjs',import.meta.url),'utf8');assert.doesNotMatch(mobile,/sale-wholesale|data-sale-wholesale/);
 const css=readFileSync(new URL('../public/brand.css',import.meta.url),'utf8');assert.match(css,/\.sale-wholesale \{[^}]*min-height:32px/);assert.match(css,/\.sale-wholesale input\[type="checkbox"\] \{[^}]*width:15px/);assert.match(css,/sale-wholesale:has\(input:focus-visible\)/);
});

test('interface atacado: estado inicial e edição mantêm o booleano e valor original',()=>{
 const app=readFileSync(new URL('../public/app.mjs',import.meta.url),'utf8'),source=app.slice(app.indexOf('function makeWorking('),app.indexOf('function startSale('));
 const ctx={state:{user:{id:'u'}},crypto:{randomUUID},brazilianDate:x=>x,saoPauloToday:()=>businessDate(),value:String};runInNewContext(source,ctx);
 assert.equal(ctx.makeWorking().is_wholesale,false);
 for(const marked of [true,false]){const result=ctx.makeWorking({is_wholesale:marked,items:[],payments:[]});assert.equal(result.is_wholesale,marked);assert.equal(result.original_is_wholesale,marked);}
});

test('interface atacado: sucesso sai do editor antes de atualizar e não repete a correção',async()=>{
 const app=readFileSync(new URL('../public/app.mjs',import.meta.url),'utf8'),source=app.slice(app.indexOf('async function saveWorking('),app.indexOf('async function shareSale('));
 const sent=[],working={id:'s',status:'confirmed',reason:'Classificar',is_wholesale:true,original_is_wholesale:false,correction_request_id:randomUUID(),edit_token:'token',items:[],payments:[],entry_costs:{}};
 let attempts=0;
 const ctx={finishMutation:async()=>{},forgetWorking:()=>{},working,can:()=>false,editorNumbers:()=>({diff:0}),salePaymentPayload:x=>x,api:async(path,data)=>{if(data)sent.push(JSON.parse(JSON.stringify(data)));return {id:'s'};},load:async()=>{if(attempts++===0)throw Error('Falha de conexão');},render:()=>{},toast:()=>{}};
 runInNewContext(source,ctx);await ctx.saveWorking(false);assert.equal(working.original_is_wholesale,false);
 assert.equal(ctx.working,null);assert.equal(ctx.view,'detail');assert.equal(sent.length,1);
});

test('interface atacado: alteração na lista usa token atual da lista e não detalhe antigo',async()=>{
 const app=readFileSync(new URL('../public/app.mjs',import.meta.url),'utf8'),start=app.indexOf(' if(el.dataset.saleWholesale!==undefined){'),source=app.slice(start,app.indexOf(' if(el.dataset.saleStatus!==undefined){',start));
 const sent=[],el={dataset:{saleWholesale:'s',previous:'false'},checked:true,isConnected:true};
 const ctx={el,busy:false,view:'sales',detailId:null,detailSale:{id:'s',edit_token:'velho'},state:{sales:[{id:'s',edit_token:'atual'}]},crypto:{randomUUID},load:async()=>{},render:()=>{},toast:()=>{},api:async(path,payload)=>sent.push({path,payload})};
 await runInNewContext(`(async()=>{${source}})()`,ctx);
 assert.equal(sent[0].payload.edit_token,'atual');assert.equal(sent[0].payload.is_wholesale,true);assert.equal(ctx.busy,false);assert.equal(el.disabled,false);
});
