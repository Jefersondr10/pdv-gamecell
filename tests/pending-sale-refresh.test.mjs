import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';
import {randomUUID} from 'node:crypto';
import {Store} from '../src/store.mjs';
import {businessDate} from '../src/domain.mjs';
import {brazilianDate,isoDate} from '../public/date-control.mjs';

const app=readFileSync(new URL('../public/app.mjs',import.meta.url),'utf8');
function part(start,end){
 const first=app.indexOf(start),last=app.indexOf(end,first+start.length);
 assert.ok(first>=0&&last>first,`Trecho não encontrado: ${start}`);return app.slice(first,last);
}
const plain=value=>JSON.parse(JSON.stringify(value));
const cents=value=>Math.round(Number(String(value??0).replace(',','.'))*100);
function setup(t,{confirmed=false,marked=false}={}){
 const db=new Store();t.after(()=>db.close());
 const actor=db.actor(db.register({name:'Pessoa fictícia',store_name:'Loja fictícia',email:'pending-refresh@example.test',password:'senha-ficticia-para-teste'}).token);
 const customer=db.addCustomer(actor,{name:'Cliente fictício'});
 const created=db.saveDraft(actor,{customer_id:customer.id,seller_id:actor.id,is_wholesale:marked,items:[{description:'Produto avulso',quantity:1,unit_price_cents:10000,manual_cost_cents:6000}]});
 if(confirmed){db.addPayment(actor,created.id,{method:'cash',amount_cents:10000,request_id:randomUUID()});db.confirm(actor,created.id,true);}
 const calls=[],ctx={crypto:{randomUUID},state:db.snapshot(actor),sessionEpoch:0,pendingWorks:new Map(),working:null,workingDirty:false,view:'sales',busy:false,
  can:()=>true,cents,value:amount=>(amount/100).toFixed(2).replace('.',','),brazilianDate,isoDate,saoPauloToday:businessDate,
  esc:value=>String(value??'').replaceAll('<','&lt;'),money:String,render(){},toast(){},modal:{close(){}},
  document:{querySelector:()=>null},trackedItem:()=>false,editorNumbers:()=>({diff:0}),paymentEditable:()=>true,confirmAction:async()=>true,
  finishMutation:async()=>{},load:async()=>{ctx.state=db.snapshot(actor);},
  api:async(path,data)=>{calls.push({path,data});const key=path.split('/')[2];if(path.endsWith('/edit'))return db.operations.editSale(actor,key,data);if(data)return db.saveDraft(actor,data,key);return db.sale(actor,key);}
 };
 runInNewContext(part('function makeWorking(','function startSale(')+part('function salePaymentPayload(','async function shareSale('),ctx);
 const before=db.sale(actor,created.id),cached=ctx.makeWorking(before);
 cached.items[0].price='120,00';cached.items[0].quantity=2;cached.items[0].details='Detalhe ainda não salvo';cached.public_notes='Observação ainda não salva';cached.reason='Conferir preço';cached.step='item-0';
 ctx.pendingWorks.set('sale:'+created.id,cached);
 const toggle=flag=>db.operations.setWholesale(actor,created.id,{is_wholesale:flag,edit_token:db.sale(actor,created.id).edit_token,request_id:randomUUID()});
 return {db,actor,id:created.id,ctx,cached,before,calls,toggle};
}
async function open(x,action){
 const {ctx,id}=x;ctx.button={dataset:{}};
 if(action==='history'){await ctx.navigateHistory({view:'editor',workKey:'sale:'+id,saleId:id});return;}
 ctx.a=action;ctx.key=action==='resume-work'?'sale:'+id:id;
 const source=action==='edit-sale'?part(" else if(a==='edit-sale')"," else if(a==='change-saved-card')"):part(" else if(a==='resume-work')"," else if(a==='review-current-sale')");
 await runInNewContext(`(async()=>{${source.replace('else if','if')}})()`,ctx);
}

for(const confirmed of [false,true])for(const marked of [false,true])for(const action of ['edit-sale','resume-work','history']){
 test(`preenchimento: ${confirmed?'confirmada':'rascunho'}, atacado ${marked} → ${!marked}, ${action} mantém campos e atualiza versão`,async t=>{
  const x=setup(t,{confirmed,marked}),local=plain(x.cached),request=x.cached.correction_request_id;
  x.toggle(!marked);const latest=x.db.sale(x.actor,x.id);await open(x,action);
  assert.equal(x.ctx.working,x.cached);assert.equal(x.ctx.workingDirty,true);assert.equal(x.ctx.view,'editor');
  assert.equal(x.cached.server_conflict,false);assert.equal(x.cached.is_wholesale,!marked);assert.equal(x.cached.original_is_wholesale,!marked);
  for(const key of ['edit_token','draft_token','updated_at','number','created_by'])assert.equal(x.cached[key],latest[key]);
  assert.notEqual(x.cached.correction_request_id,request);assert.deepEqual(plain(x.cached.server_base),plain(latest));
  for(const key of ['items','payments','entry_costs','public_notes','reason','step','customer_id','seller_id','business_date','freight','expenses'])assert.deepEqual(plain(x.cached[key]),local[key],key);
  await x.ctx.saveWorking(false);
  const saved=x.db.sale(x.actor,x.id);assert.equal(saved.is_wholesale,!marked);assert.equal(saved.items[0].unit_price_cents,12000);assert.equal(saved.items[0].quantity,2);assert.equal(saved.public_notes,local.public_notes);
 });
}

test('preenchimento: marcar apenas no editor continua marcado ao retomar sem alteração remota',async t=>{
 const x=setup(t);x.cached.is_wholesale=true;const request=x.cached.correction_request_id;await open(x,'resume-work');
 assert.equal(x.cached.is_wholesale,true);assert.equal(x.cached.original_is_wholesale,false);assert.equal(x.cached.correction_request_id,request);assert.equal(x.cached.server_conflict,false);
 await x.ctx.saveWorking(false);assert.equal(x.db.sale(x.actor,x.id).is_wholesale,true);
});

test('preenchimento: mudanças remotas nos itens não ganham token novo nem são sobrescritas',async t=>{
 const x=setup(t),local=plain(x.cached);
 x.db.saveDraft(x.actor,{customer_id:x.before.customer_id,seller_id:x.actor.id,items:x.before.items.map(item=>({...item,unit_price_cents:15000})),draft_token:x.before.draft_token},x.id);
 x.toggle(true);await open(x,'edit-sale');
 assert.equal(x.cached.server_conflict,true);assert.deepEqual(plain(x.cached.items),local.items);assert.equal(x.cached.public_notes,local.public_notes);
 assert.equal(x.cached.edit_token,local.edit_token);assert.equal(x.cached.draft_token,local.draft_token);assert.equal(x.cached.original_is_wholesale,local.original_is_wholesale);
 assert.match(x.ctx.workingConflictNotice(x.cached),/Conferir versão atual/);
 const count=x.calls.length;await assert.rejects(x.ctx.saveWorking(false),/mudou em outra tela/);assert.equal(x.calls.length,count);
 assert.equal(x.db.sale(x.actor,x.id).items[0].unit_price_cents,15000);
});

test('preenchimento: pagamento novo e cancelamento remoto exigem decisão explícita',async t=>{
 const x=setup(t,{confirmed:true}),token=x.cached.edit_token,local=plain(x.cached.items);
 x.db.addPayment(x.actor,x.id,{method:'cash',amount_cents:1000,request_id:randomUUID()});await open(x,'resume-work');
 assert.equal(x.cached.server_conflict,true);assert.equal(x.cached.edit_token,token);assert.deepEqual(plain(x.cached.items),local);
 const sale=x.db.sale(x.actor,x.id);x.db.operations.cancelSale(x.actor,x.id,{edit_token:sale.edit_token,request_id:randomUUID(),reason:'Cancelamento fictício',acknowledge_stock_return:true,acknowledge_refund_pending:true});
 await open(x,'history');assert.equal(x.cached.server_conflict,true);assert.deepEqual(plain(x.cached.items),local);assert.equal(x.cached.status,'confirmed');
 await assert.rejects(x.ctx.saveWorking(false),/mudou em outra tela/);
});

test('preenchimento: base ausente ou identidade alterada nunca libera tokens cegamente',async t=>{
 const x=setup(t);x.cached.server_base=null;x.toggle(true);const token=x.cached.draft_token;
 await open(x,'resume-work');assert.equal(x.cached.server_conflict,true);assert.equal(x.cached.draft_token,token);
 x.ctx.load=async()=>{x.ctx.sessionEpoch++;};const before=plain(x.cached);
 await assert.rejects(x.ctx.restoreWorking(x.cached),/sessão ou as permissões mudaram/);assert.deepEqual(plain(x.cached),before);
});

test('preenchimento: versão atual só substitui campos após confirmar descarte e mantém outras pendências',async t=>{
 const x=setup(t);x.cached.server_conflict=true;x.ctx.working=x.cached;
 const other={id:'outro',items:[{description:'Não apagar'}]};x.ctx.pendingWorks.set('sale:outro',other);
 x.toggle(true);x.ctx.form={id:'pending-conflict-form',dataset:{id:x.id}};
 const source=part(" else if(form.id==='pending-conflict-form')"," else if(form.id==='share-form')");
 await runInNewContext(`(async()=>{${source.replace('else if','if')}})()`,x.ctx);
 assert.equal(x.ctx.pendingWorks.has('sale:'+x.id),false);assert.equal(x.ctx.pendingWorks.get('sale:outro'),other);
 assert.notEqual(x.ctx.working,x.cached);assert.equal(x.ctx.working.items[0].price,'100,00');assert.equal(x.ctx.working.is_wholesale,true);assert.equal(x.ctx.working.server_conflict,false);assert.equal(x.ctx.workingDirty,false);
});
