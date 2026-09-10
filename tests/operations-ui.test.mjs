import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { createStockUI } from '../public/stock-ui.mjs';
import { salesRecords } from '../public/sales-view.mjs';
import { brazilianDate,isoDate } from '../public/date-control.mjs';
const esc=v=>String(v??'').replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;');
const money=v=>`R$ ${(v/100).toFixed(2)}`,value=v=>(v/100).toFixed(2),cents=v=>Math.round(Number(String(v).replace(',','.'))*100);
function harness({costs=true,manage=true}={}){
 let html='',dialog='',attributes='',formId='',calls=[];
 const state={products:[{id:'p',name:'<Produto>'}],suppliers:[{id:'supplier',name:'Fornecedor único'}],stock_entries:[{id:'entry',product_id:'p',product_name:'<Produto>',supplier_id:null,supplier_name:null,version:2,quantity_initial:3,quantity_remaining:1,received_at:'2026-09-07',...(costs?{unit_cost_cents:875}:{})}]};
 const report={store:'<Gamecell>',generated_at:'2026-09-07',totals:{products:1,available_quantity:1,pending_quantity:0,...(costs?{inventory_cost_cents:875}:{})},products:[{id:'p',name:'<Produto>',sku:'A',received_quantity:3,sold_quantity:2,available_quantity:1,pending_quantity:0,stock:1,...(costs?{inventory_cost_cents:875}:{})}]};
 const ui=createStockUI({api:async(path,data,method)=>{calls.push({path,data,method});if(!data&&path.startsWith('/stock/entries/'))return {...state.stock_entries.find(e=>e.id===path.split('/').at(-1))};return report;},getState:()=>state,can:p=>p==='costs.view'?costs:p==='products.manage'?manage:true,
  page:s=>html=s,heading:(a,b,c='')=>`<h1>${a}</h1><p>${b}</p>${c}`,empty:(a,b)=>`${a}${b}`,field:(l,c)=>`<label>${l}${c}</label>`,input:(n,v,e='')=>`<input name="${n}" value="${esc(v)}" ${e}>`,option:(v,l,s)=>`<option value="${esc(v)}"${v===s?' selected':''}>${esc(l)}</option>`,esc,money,value,cents,date:esc,
  showModal:(title,content,id,attrs)=>{dialog=title+content;formId=id;attributes=attrs;},modal:{querySelector:()=>({textContent:''})},icon:()=>''});
 return {ui,state,calls,get html(){return html;},get dialog(){return dialog;},get attributes(){return attributes;},get formId(){return formId;}};
}

test('interface de entrada: novo produto na mesma janela, modo persiste campos e fornecedor só é padrão em nova entrada',()=>{
 const x=harness();x.ui.openEntry();assert.match(x.dialog,/Novo produto — cadastrar nesta entrada/);assert.match(x.dialog,/data-entry-new hidden disabled/);assert.match(x.dialog,/value="supplier" selected/);assert.match(x.attributes,/data-request-id=/);
 const groups={'[data-entry-new]':{hidden:true,disabled:true,savedValue:'Produto digitado'},'[data-entry-existing]':{hidden:false,disabled:false}},form={querySelector:s=>groups[s]};
 assert.equal(x.ui.change({matches:()=>true,value:'new',form}),true);assert.equal(groups['[data-entry-new]'].hidden,false);assert.equal(groups['[data-entry-existing]'].disabled,true);
 x.ui.change({matches:()=>true,value:'existing',form});assert.equal(groups['[data-entry-new]'].savedValue,'Produto digitado');assert.equal(x.ui.dirty(),true);
 x.ui.openEntry('entry');assert.doesNotMatch(x.dialog,/value="supplier" selected/);assert.match(x.dialog,/value="" selected>Sem fornecedor/);assert.match(x.dialog,/Motivo da correção/);
 const restricted=harness({manage:false});restricted.ui.openEntry();assert.doesNotMatch(restricted.dialog,/data-entry-new|Novo produto —/);
});

test('interface de entrada: custo restrito nunca vira zero ao editar; exclusão não exibe custo',async()=>{
 const x=harness({costs:false});x.ui.openEntry('entry');assert.match(x.dialog,/Custo atual restrito/);assert.doesNotMatch(x.dialog,/name="cost" value="0[.,]00"/);
 const form={id:'stock-entry-form',dataset:{id:'entry',version:'2',requestId:'same-request'}};
 await x.ui.submit(form,{quantity:'2',cost:'',supplier_id:'',reason:'Conferir'});let sent=x.calls.at(-1);assert.equal(sent.data.unit_cost_cents,undefined);assert.equal(sent.data.supplier_id,null);assert.equal(sent.data.version,2);assert.equal(sent.method,'PUT');
 await x.ui.submit(form,{quantity:'2',cost:'0,00',supplier_id:'',reason:'Gratuito'});assert.equal(x.calls.at(-1).data.unit_cost_cents,0);
 await x.ui.action('stock-entry-void','entry');assert.doesNotMatch(x.dialog,/R\$|NaN/);assert.match(x.dialog,/name="acknowledge" required/);assert.match(x.dialog,/não faz estorno bancário/);
});

test('interface de entrada: cadastro atômico e reenvio usam a mesma solicitação',async()=>{
 const x=harness(),form={id:'stock-entry-form',dataset:{id:'',version:'1',requestId:'entry-uuid'}},data={product_mode:'new',product_name:'Novo',product_sku:'SKU',product_price:'150,50',quantity:'3',cost:'80,25',supplier_id:'supplier'};
 await x.ui.submit(form,data);await x.ui.submit(form,data);assert.deepEqual(x.calls[0],x.calls[1]);assert.equal(x.calls[0].path,'/stock/entries');assert.deepEqual(x.calls[0].data.new_product,{name:'Novo',sku:'SKU',price_cents:15050});assert.equal(x.calls[0].data.unit_cost_cents,8025);assert.equal(x.calls[0].data.product_id,undefined);
 const table=x.ui.entryTable();assert.match(table,/Histórico de entradas/);assert.match(table,/stock-entry-edit/);assert.match(table,/&lt;Produto&gt;/);assert.doesNotMatch(table,/<Produto>/);
 x.state.stock_entries[0].voided_at='2026-09-07';assert.doesNotMatch(x.ui.entryTable(),/stock-entry-edit|stock-entry-void/);assert.match(x.ui.entryTable(),/Fora do saldo/);
});

test('relatório de estoque: tela, download e impressão; custos seguem permissão',async()=>{
 const x=harness();assert.equal((await x.ui.action('stock-report')).view,'stock-report');x.ui.reportPage();assert.match(x.html,/\/api\/stock\/report.csv" download/);assert.match(x.html,/stock-report-print/);assert.match(x.html,/&lt;Gamecell&gt;/);assert.match(x.html,/R\$ 8.75/);assert.match(x.html,/não uma posição de data passada/);
 const restricted=harness({costs:false});await restricted.ui.action('stock-report');restricted.ui.reportPage();assert.doesNotMatch(restricted.html,/<th[^>]*>Custo do estoque|R\$|NaN/);
 const css=readFileSync(new URL('../public/brand.css',import.meta.url),'utf8');assert.match(css,/\.entry-product-fields\[hidden\]\s*\{\s*display:\s*none !important/);assert.match(css,/body:has\(\.stock-report-page\) \.sidebar/);assert.match(css,/\.report-sheet thead \{ display: table-header-group/);assert.match(css,/--panel-inset/);
});

test('vendas: blocos separados, recebido e lucro por item, totais, edição e texto escapado',()=>{
 const item={description:'<Produto>',quantity:2,unit_price_cents:1000,total_cents:2000,received_cents:2000,pending_cents:0,profit_cents:800,serial_number:'<SN>'},sale={id:'sale',number:1,status:'confirmed',customer_name:'<Cliente>',seller_name:'Teste',items:[item],total_cents:2000,profit_cents:800,reconciliation:{gross_cents:2000,pending_cents:0,excess_cents:0}};
 const helpers={esc,money,date:()=>'',can:()=>true,statusBadge:()=>'',paymentBadge:()=>'',operationalStatusControl:()=>'',empty:()=>''};
 const html=salesRecords([sale,{...sale,id:'s2',number:2,status:'draft',items:[]}],helpers);assert.equal((html.match(/<article class="sale-record"/g)||[]).length,2);assert.match(html,/Recebido/);assert.match(html,/Lucro do item/);assert.match(html,/Lucro da venda/);assert.match(html,/proporcionalmente/);assert.match(html,/data-action="edit-sale"/);assert.match(html,/&lt;Cliente&gt;/);assert.doesNotMatch(html,/<Produto>|<SN>|Recebido¹|item²/);
 const hidden=salesRecords([sale],{...helpers,can:()=>false});assert.doesNotMatch(hidden,/Lucro do item|Lucro da venda|R\$ 8.00|edit-sale/);assert.match(hidden,/Recebido/);
});

test('editor confirmado: preserva custo omitido e pagamentos; salva status na mesma operação',async()=>{
 const app=readFileSync(new URL('../public/app.mjs',import.meta.url),'utf8'),source=app.slice(app.indexOf('function salePaymentPayload('),app.indexOf('async function shareSale('));
 const calls=[],working={id:'sale',status:'confirmed',reason:'Correção',edit_token:'opaque',correction_request_id:'same-uuid',customer_id:'c',seller_id:'u',public_notes:'',items:[{id:'i',product_id:null,description:'Avulso',quantity:1,price:'10,00',cost:'',manual_cost_known:false}],payments:[{saved:true,amount:'10,00'}],operational_status_id:'s',original_operational_status_id:''};
 const context={working,workingDirty:true,can:p=>p!=='costs.view',paymentEditable:()=>false,cents,editorNumbers:()=>({diff:0}),api:async(path,data,method)=>{calls.push({path,data,method});return{id:'sale'};},load:async()=>{},render:()=>{},toast:()=>{},money,view:'editor',detailId:null,detailSale:null};
 await runInNewContext(`${source}\nsaveWorking(false)`,context);assert.equal(calls.length,2);assert.equal(calls[0].path,'/sales/sale/edit');assert.equal(calls[0].data.items[0].manual_cost_cents,undefined);assert.equal(calls[0].data.payments.length,1);assert.equal(calls[0].data.payments[0].amount_cents,undefined);assert.equal(calls[0].data.freight_cents,undefined);assert.equal(calls[0].data.operational_status_id,'s');assert.equal(calls[1].path,'/sales/sale');assert.equal(context.view,'detail');assert.equal(context.workingDirty,false);
 context.workingDirty=true;context.view='editor';context.api=async()=>{throw Error('Atualize antes de editar');};await assert.rejects(()=>runInNewContext(`${source}\nsaveWorking(false)`,context),/Atualize/);assert.equal(context.workingDirty,true);assert.equal(context.view,'editor');
});

test('editor completo: Pix histórico mantém a opção original e vendedor inativo não exige nova atribuição',()=>{
 const app=readFileSync(new URL('../public/app.mjs',import.meta.url),'utf8'),make=app.slice(app.indexOf('function makeWorking('),app.indexOf('function startSale(')),helpers=app.slice(app.indexOf('function paymentAccountField('),app.indexOf('function paymentEditorRows('));
 const state={user:{id:'u'},users:[{id:'u',name:'Atual'}]},sale={id:'s',status:'confirmed',seller_id:'old-seller',seller_name:'Antigo',business_date:'2026-08-31',items:[],payments:[{id:'p',method:'pix',pix_account_id:'old',pix_account_name:'Conta histórica',amount_cents:1000,created_at:'2026-09-01T01:30:00Z'}]},option=(v,l,s)=>`<option value="${esc(v)}"${v===s?' selected':''}>${esc(l)}</option>`;
 const context={state,sale,value,brazilianDate,crypto:{randomUUID:()=> 'uuid'},saoPauloToday:d=>d?'2026-08-31':'2026-09-07',can:()=>true,esc,option,activePixAccounts:()=>[{id:'new',name:'Conta ativa'}],defaultPixAccountId:()=> 'new'};
 runInNewContext(`${make}\n${helpers}\nworking=makeWorking(sale);p=working.payments[0];changePaymentMethod(p,'cash');changePaymentMethod(p,'pix');html=paymentAccountField(p,0);sellers=editorSellerOptions(working);`,context);
 assert.equal(context.p.pix_account_id,'old');assert.equal(context.p.paid_date,'31/08/2026');assert.match(context.html,/value="old" selected/);assert.match(context.sellers,/value="old-seller" selected>Antigo \(inativo\)/);
 context.p.pix_account_id='new';runInNewContext('html=paymentAccountField(p,0)',context);assert.match(context.html,/value="old">Conta histórica/);assert.match(context.html,/value="new" selected/);
 context.p.original_pix_account_id=null;context.p.original_pix_account_name=null;context.p.pix_account_id=null;runInNewContext("changePaymentMethod(p,'cash');changePaymentMethod(p,'pix');html=paymentAccountField(p,0)",context);assert.equal(context.p.pix_account_id,null);assert.match(context.html,/value="" selected>Sem conta/);
});

test('editor completo: pagamentos enviam taxa explícita só quando alterada, com data validada',()=>{
 const app=readFileSync(new URL('../public/app.mjs',import.meta.url),'utf8'),source=app.slice(app.indexOf('function salePaymentPayload('),app.indexOf('async function saveWorking(')),context={paymentEditable:()=>true,cents,isoDate};runInNewContext(source,context);
 const card={saved:true,id:'p',method:'card',original_method:'card',keep_card_rate:true,amount:'100,00',paid_date:'31/08/2026'};
 let payload=context.salePaymentPayload(card);assert.equal(payload.amount_cents,10000);assert.equal(payload.paid_date,'2026-08-31');assert.equal(payload.rate_id,undefined);
 assert.throws(()=>context.salePaymentPayload({...card,keep_card_rate:false}),/máquina/);payload=context.salePaymentPayload({...card,keep_card_rate:false,rate_id:'new-rate'});assert.equal(payload.rate_id,'new-rate');
 payload=context.salePaymentPayload({...card,method:'pix',original_method:'pix',pix_account_id:null});assert.equal(payload.pix_account_id,null);assert.throws(()=>context.salePaymentPayload({...card,method:'pix'}),/conta Pix/);
 for(const paid_date of ['', '31/02/2026','texto'])assert.throws(()=>context.salePaymentPayload({...card,paid_date}));
 context.paymentEditable=()=>false;payload=context.salePaymentPayload({...card,amount:'0,00'});assert.deepEqual(JSON.parse(JSON.stringify(payload)),{id:'p'});
});

test('editor completo: clique no produto busca venda atual e foca o nome; nova data do pagamento fica fixa',async()=>{
 const app=readFileSync(new URL('../public/app.mjs',import.meta.url),'utf8'),start=app.indexOf("else if(a==='edit-sale')"),end=app.indexOf('else if',start+10),source=app.slice(start,end).replace('else if','if');
 const calls=[],latest={id:'sale',edit_token:'fresh',items:[{id:'i'}]},context={a:'edit-sale',key:'sale',button:{dataset:{itemId:'i'}},load:async()=>calls.push('load'),api:async path=>{calls.push(path);return latest;},makeWorking:s=>s,render:()=>calls.push('render'),document:{querySelector:selector=>({focus:()=>calls.push(selector)})}};
 await runInNewContext(`(async()=>{${source}})()`,context);assert.equal(context.working.edit_token,'fresh');assert.equal(context.view,'editor');assert.deepEqual(calls,['load','/sales/sale','render','[data-item="0"][data-key="description"]']);
 assert.match(app,/pix_account_id:defaultPixAccountId\(''\),paid_date:brazilianDate\(saoPauloToday\(\)\)/);
 const css=readFileSync(new URL('../public/brand.css',import.meta.url),'utf8');assert.match(css,/\[data-action="change-saved-card"\].*white-space: normal/);
});
