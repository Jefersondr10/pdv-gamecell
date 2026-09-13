import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';
import {Store} from '../src/store.mjs';
import {application} from '../src/server.mjs';
const app=readFileSync(new URL('../public/app.mjs',import.meta.url),'utf8');
const part=(from,to)=>app.slice(app.indexOf(from),app.indexOf(to,app.indexOf(from)+from.length));
function setup(t){
 const db=new Store(':memory:');t.after(()=>db.close());
 const actor=db.actor(db.register({name:'Auditoria',store_name:'Teste isolado',email:'audit@example.test',password:'senha-ficticia-da-auditoria'}).token);
 const customer=db.addCustomer(actor,{name:'Cliente fictício'}),product=db.addProduct(actor,{name:'PS4',serial_tracked:true});
 const data={customer_id:customer.id,seller_id:actor.id,items:[{description:'Avulso',quantity:1,unit_price_cents:1000,manual_cost_cents:500}]};
 return {db,actor,customer,product,data};
}
test('revisão: rascunho obsoleto, token ausente e de outra venda não sobrescrevem dados',t=>{
 const {db,actor,data}=setup(t),first=db.saveDraft(actor,data),other=db.saveDraft(actor,data);
 const changed=db.saveDraft(actor,{...data,draft_token:first.draft_token,public_notes:'Aba A'},first.id);
 const before=db.sale(actor,first.id),audit=db.all('SELECT * FROM audit');
 for(const draft_token of [undefined,first.draft_token,other.draft_token]){
  assert.throws(()=>db.saveDraft(actor,{...data,draft_token,public_notes:'Aba B'},first.id),{status:409});
  assert.deepEqual(db.sale(actor,first.id),before);assert.deepEqual(db.all('SELECT * FROM audit'),audit);
 }
 assert.notEqual(changed.draft_token,first.draft_token);
 assert.deepEqual(changed.item_ids,before.items.map(i=>i.id));
});
test('revisão: token opaco de rascunho funciona sem permissão de visualizar custos',t=>{
 const {db,actor,data}=setup(t),sale=db.saveDraft(actor,data);
 const restricted={...actor,is_owner:false,permissions:['sales.edit_draft','sales.view_all']},visible=db.sale(restricted,sale.id);
 assert.equal(visible.items[0].manual_cost_cents,undefined);assert.match(visible.draft_token,/^[a-f0-9]{64}$/);
 db.saveDraft(restricted,{items:visible.items,customer_id:visible.customer_id,seller_id:visible.seller_id,draft_token:visible.draft_token},sale.id);
 assert.equal(db.fullSale(actor,sale.id).items[0].manual_cost_cents,500);
});
test('revisão: confirmar exige a versão conferida e repetir sucesso não confirma duas vezes',t=>{
 const {db,actor,data}=setup(t),sale=db.saveDraft(actor,data);
 const updated=db.saveDraft(actor,{...data,items:[{...data.items[0],quantity:2}],draft_token:sale.draft_token},sale.id);
 assert.throws(()=>db.confirm(actor,sale.id,true,sale.draft_token),{status:409});
 assert.equal(db.sale(actor,sale.id).status,'draft');
 db.confirm(actor,sale.id,true,updated.draft_token);
 assert.equal(db.confirm(actor,sale.id,true,updated.draft_token).already_confirmed,true);
});
test('revisão: custo serial excedente reverte confirmação e mantém sistema consultável',t=>{
 const {db,actor,product,customer}=setup(t);
 db.operations.receive(actor,{product_id:product.id,request_id:randomUUID(),units:['A','B'].map(serial_number=>({serial_number,unit_cost_cents:100_000_000_000}))});
 const units=db.serials.units(actor,product.id),sale=db.saveDraft(actor,{customer_id:customer.id,seller_id:actor.id,items:[{product_id:product.id,quantity:2,unit_ids:units.map(u=>u.id),unit_price_cents:100}]});
 const before=db.all('SELECT * FROM lots'),audit=db.all('SELECT * FROM audit');
 assert.throws(()=>db.confirm(actor,sale.id,true),/Total|Valor/);
 assert.equal(db.sale(actor,sale.id).status,'draft');assert.doesNotThrow(()=>db.snapshot(actor));
 assert.deepEqual(db.all('SELECT * FROM lots'),before);assert.deepEqual(db.all('SELECT * FROM audit'),audit);assert.equal(db.all('SELECT * FROM allocations').length,0);
});
test('revisão: editar entrada serial não cria saldo sem aparelhos identificados',t=>{
 const {db,actor,product}=setup(t);
 const entry=db.operations.receive(actor,{product_id:product.id,request_id:randomUUID(),units:[{serial_number:'A',unit_cost_cents:100}]});
 const old=db.operations.entries(actor)[0],data={quantity:3,version:old.version,request_id:randomUUID(),reason:'Conferir'};
 assert.throws(()=>db.operations.updateEntry(actor,entry.id,data),/cada unidade/);
 assert.throws(()=>db.operations.updateEntry(actor,entry.id,{...data,request_id:randomUUID(),quantity:1,units:[]}),/identificação/);
 assert.equal(db.products(actor)[0].stock,1);
 db.operations.updateEntry(actor,entry.id,{...data,request_id:randomUUID(),quantity:2,units:[...old.units,{serial_number:'B'}]});
 assert.equal(db.products(actor)[0].stock,2);assert.equal(db.serials.units(actor,product.id).length,2);
});
test('revisão HTTP: aba de outra conta não grava e confirmação sem versão é recusada',async t=>{
 const {db,actor,data}=setup(t),origin='http://127.0.0.1:3998',{server}=application({store:db,origin});
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));t.after(()=>new Promise(resolve=>server.close(resolve)));
 const base='http://127.0.0.1:'+server.address().port,headers={Origin:origin,'Content-Type':'application/json'};
 const auth=await fetch(base+'/api/login',{method:'POST',headers,body:JSON.stringify({email:'audit@example.test',password:'senha-ficticia-da-auditoria'})});
 headers.Cookie=auth.headers.get('set-cookie').split(';')[0];
 const response=await fetch(base+'/api/products',{method:'POST',headers:{...headers,'X-PDV-User':'other-account'},body:JSON.stringify({name:'Não criar'})});
 assert.equal(response.status,409);assert.equal(db.products(actor).length,1);
 const sale=db.saveDraft(actor,data);
 const noVersion=await fetch(base+'/api/sales/'+sale.id+'/confirm',{method:'POST',headers,body:JSON.stringify({acknowledge_difference:true})});
 assert.equal(noVersion.status,409);assert.equal(db.sale(actor,sale.id).status,'draft');
 const good=await fetch(base+'/api/sales/'+sale.id+'/confirm',{method:'POST',headers,body:JSON.stringify({acknowledge_difference:true,draft_token:sale.draft_token})});
 assert.equal(good.status,200);
});
test('revisão: troca de conta limpa modais, preenchimentos, buscas e caches privados',()=>{
 const calls=[],dialog={open:true,html:'CPF e custo privados',close(){this.open=false;},replaceChildren(){this.html='';}};
 const context={sessionEpoch:0,app:{innerHTML:'Dados da conta anterior'},closeSelectControls:()=>calls.push('selects'),state:{user:{id:'A'}},working:{private:true},workingDirty:true,pendingWorks:new Map([['a',{}]]),machineBrandSelections:new Map([['a',1]]),
  todayFilter:()=>({from:'today'}),salesFilters:{clear(){}},financeUI:{reset:()=>calls.push('finance')},stockUI:{reset:()=>calls.push('stock')},calculatorUI:{reset:()=>calls.push('calculator')},mobileNavigation:{reset(){}},pageHistory:{reset:()=>calls.push('history')},
  document:{querySelectorAll:()=>[dialog],querySelector:()=>({textContent:'secret',classList:{remove(){}}})}};
 runInNewContext(part('function clearPrivateWorkspace()', 'async function load()'),context);
 assert.equal(context.adoptState({user:{id:'B'}}),true);
 assert.equal(context.working,null);assert.equal(context.pendingWorks.size,0);assert.equal(context.pickerUnits.length,0);assert.equal(context.productCreateContext,null);
 assert.equal(dialog.open,false);assert.equal(dialog.html,'');assert.equal(context.view,'dashboard');assert.equal(context.sessionEpoch,1);
 assert.deepEqual(calls,['selects','finance','stock','calculator','history']);assert.doesNotMatch(context.app.innerHTML,/Dados da conta anterior/);
 assert.equal(context.adoptState({user:{id:'B'}}),false);assert.equal(context.sessionEpoch,1);
});
test('revisão: consulta de sessão antiga não aplica resposta após mudança de conta',async()=>{
 let resolve;const response=new Promise(r=>resolve=r),context={sessionEpoch:0,state:{user:{id:'A'}},fetch:()=>response};
 runInNewContext(part('async function api(', 'function clearPrivateWorkspace()'),context);
 const pending=context.api('/state');context.sessionEpoch++;resolve({ok:true,json:async()=>({user:{id:'A'}})});
 await assert.rejects(pending,/sessão mudou/);
});
test('revisão: gravação concluída com consulta falha bloqueia recadastro e mantém aviso visível',async()=>{
 const calls=[],context={state:{},mutationRefreshPending:'',modal:{close:()=>calls.push('close')},load:async()=>{throw Error('Offline');},render:()=>calls.push('render'),toast:text=>calls.push(text)};
 runInNewContext(part('async function finishMutation(', 'const navs='),context);
 await context.finishMutation('Despesa salva.');
 assert.equal(context.mutationRefreshPending,'Despesa salva.');assert.ok(calls.includes('render'));assert.match(calls.at(-1),/Despesa salva.*Atualize/);
 context.load=async()=>{};await context.finishMutation('Despesa salva.');assert.equal(context.mutationRefreshPending,'');
 assert.match(app,/mutationRefreshPending&&!.*'close-modal'/);
});
test('revisão: gravação concluída continua explícita quando a sessão expira antes da atualização',async()=>{
 let warning='',renderedAuth=false;
 const context={state:null,mutationRefreshPending:'',modal:{close(){}},load:async()=>{throw Error('Sessão expirada');},renderAuth:()=>{renderedAuth=true;},esc:value=>String(value),app:{querySelector:()=>({insertAdjacentHTML:(_position,html)=>warning=html})}};
 runInNewContext(part('async function finishMutation(', 'const navs='),context);
 await context.finishMutation('Despesa salva.');
 assert.equal(renderedAuth,true);assert.equal(context.mutationRefreshPending,'');assert.match(warning,/Despesa salva/);assert.match(warning,/gravação foi concluída/);assert.match(warning,/não repita o cadastro/);
});
test('revisão: preenchimento recebe ID sem duplicar cache e logout verifica pendências fora do editor',()=>{
 const work={local_key:'local',items:[]},context={working:work,workingDirty:true,pendingWorks:new Map()};
 runInNewContext(part('function workKey(', 'function currentPageRoute('),context);
 context.rememberWorking();work.id='saved';context.rememberWorking();
 assert.equal(context.pendingWorks.size,1);assert.equal(context.pendingWorks.get('sale:saved'),work);
 assert.match(app,/if\(workingDirty\|\|pendingWorks.size\)\{askToDiscard\('logout'\)/);
 assert.match(app,/if\(entry.id===key\)pendingWorks.delete\(pendingKey\)/);
 assert.match(app,/modal.addEventListener\('cancel',e=>\{if\(busy\)/);
 assert.doesNotMatch(app,/window.confirm\(/);
});

test('revisão: reatribuição autorizada preserva a gravação e retira somente o acesso futuro',t=>{
 const {db,actor,data}=setup(t);
 const seller=db.addUser(actor,{name:'Vendedor A',email:'seller-a@example.test',password:'senha-ficticia-auditoria',permissions:['sales.edit_draft','sales.edit_confirmed','sales.assign_seller','sales.change_status']});
 seller.tenant_id=actor.tenant_id;
 const target=db.addUser(actor,{name:'Vendedor B',email:'seller-b@example.test',password:'senha-ficticia-auditoria',permissions:[]});
 const draft=db.saveDraft(actor,{...data,seller_id:seller.id}),visible=db.sale(seller,draft.id);
 const result=db.saveDraft(seller,{customer_id:visible.customer_id,seller_id:target.id,items:visible.items,draft_token:visible.draft_token},draft.id);
 assert.equal(result.access_lost,true);assert.equal(db.sale(actor,draft.id).seller_id,target.id);assert.throws(()=>db.sale(seller,draft.id),{status:404});
 const confirmed=db.saveDraft(actor,{...data,seller_id:seller.id});db.confirm(actor,confirmed.id,true);
 const before=db.sale(seller,confirmed.id),payload={customer_id:before.customer_id,seller_id:target.id,items:before.items,operational_status_id:null,payments:[],edit_token:before.edit_token,reason:'Transferência autorizada',request_id:randomUUID(),acknowledge_difference:true};
 const correction=db.operations.editSale(seller,confirmed.id,payload);
 assert.equal(correction.access_lost,true);assert.equal(db.sale(actor,confirmed.id).seller_id,target.id);
 assert.throws(()=>db.sale(seller,confirmed.id),{status:404});
 assert.deepEqual(db.operations.editSale(seller,confirmed.id,payload),{...correction,replayed:true});
});

test('revisão: transferência sem acesso não ignora pagamentos nem tenta abrir detalhe inacessível',async()=>{
 const requests=[],work={id:'sale',created_by:'owner',seller_id:'B',status:'draft',reason:'',public_notes:'',items:[],payments:[{amount:'10',method:'cash'}],expenses:[],operational_status_id:'',original_operational_status_id:''};
 const context={working:work,state:{user:{id:'A'}},can:()=>false,cents:Number,isoDate:x=>x,saoPauloToday:()=>'',trackedItem:()=>false,api:async(...args)=>{requests.push(args);return{id:'sale',access_lost:true};},forgetWorking:()=>{},finishMutation:async()=>{}};
 runInNewContext(part('async function saveWorking(', 'async function shareSale('),context);
 await assert.rejects(context.saveWorking(false),/Salve os pagamentos/);assert.equal(requests.length,0);
 work.payments=[];await context.saveWorking(false);assert.equal(requests.length,1);assert.equal(context.view,'sales');assert.equal(context.working,null);
});

test('revisão: confirmações não esticam até preencher o celular e contagem distingue registros de faturamento',()=>{
 const css=readFileSync(new URL('../public/brand.css',import.meta.url),'utf8');
 assert.match(css,/dialog\.compact-dialog\{height:fit-content!important;min-height:0!important/);
 assert.match(app,/registro encontrado/);assert.doesNotMatch(app,/Situação técnica/);
});
