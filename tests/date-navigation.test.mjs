import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { brazilianDate,isoDate,dateInput,dateValue,normalizeDateFields,dateRange,initDateControls } from '../public/date-control.mjs';
const source=readFileSync(new URL('../public/app.mjs',import.meta.url),'utf8');
test('datas BR: renderiza dia/mês/ano e competência mês/ano sem depender do navegador',()=>{
 assert.equal(brazilianDate('2026-09-07'),'07/09/2026');assert.equal(brazilianDate('2026-09','month'),'09/2026');
 assert.equal(isoDate('07/09/2026'),'2026-09-07');assert.equal(isoDate('09/2026','month'),'2026-09');
 const html=dateInput('due_date','2026-09-07','type="date" required min="2000-01-01" max="2199-12-31"');
 assert.match(html,/type="text"/);assert.match(html,/value="07\/09\/2026"/);assert.match(html,/DD\/MM\/AAAA/);assert.match(html,/data-min-date="2000-01-01"/);assert.doesNotMatch(html,/type="date"/);
});
test('datas BR: datas impossíveis e fora dos limites são rejeitadas',()=>{
 for(const value of ['31/02/2026','29/02/2025','10/13/2026','1/9/2026','2026-09-07','01/01/1999','01/01/2200','ab/09/2026'])assert.throws(()=>isoDate(value));
 assert.equal(isoDate('29/02/2024'),'2024-02-29');assert.equal(isoDate(''),'');assert.throws(()=>isoDate('13/2026','month'));
 assert.throws(()=>dateValue({value:'08/09/2026',dataset:{dateKind:'date',maxDate:'2026-09-07'}}),/permitido/);
});
test('datas BR: normalização do formulário ignora desabilitados e preserva contrato do lote',()=>{
 const el=(name,value,dateKind='date',extra={})=>({name,value,dataset:{dateKind},...extra});
 const fields=[el('from','01/09/2026'),el('to','07/09/2026'),el('month','09/2026','month'),el('ignored','errado','date',{disabled:true}),el('bulk_due_date','15/09/2026')];
 const data=normalizeDateFields({querySelectorAll:()=>fields},{description:'Conta'});
 assert.deepEqual(data,{description:'Conta',from:'2026-09-01',to:'2026-09-07',month:'2026-09'});
 assert.equal(dateValue(fields.at(-1)),'2026-09-15');
});
test('datas BR: máscara, limpar, edição intermediária e validação não invertem dia e mês',()=>{
 const events={};initDateControls({addEventListener:(name,fn)=>events[name]=fn});
 const el={value:'07092026',selectionStart:8,dataset:{dateKind:'date'},setCustomValidity(value){this.error=value;}};
 events.input({target:el});assert.equal(el.value,'07/09/2026');events.blur({target:el});assert.equal(el.error,'');
 el.value='31/02/2026';events.blur({target:el});assert.match(el.error,/válida/);
 el.value='';el.selectionStart=0;events.input({target:el});assert.equal(el.error,'');assert.equal(el.value,'');
 el.value='17/09/2026';el.selectionStart=1;events.input({target:el});assert.equal(el.value,'17/09/2026');
});
test('datas BR: Hoje, Ontem e Este mês incluem limites corretos em ano bissexto',()=>{
 assert.deepEqual(dateRange('today','2026-09-07'),{from:'2026-09-07',to:'2026-09-07'});
 assert.deepEqual(dateRange('yesterday','2026-01-01'),{from:'2025-12-31',to:'2025-12-31'});
 assert.deepEqual(dateRange('month','2024-02-12'),{from:'2024-02-01',to:'2024-02-29'});
 assert.throws(()=>dateRange('invalid','2026-09-07'));
});
test('navegação Cadastro: cinco submenus, máquina fora de configurações e somente um Vender',()=>{
 const nav=source.slice(source.indexOf('const navs='),source.indexOf('function renderAuth()'));
 const context={view:'card-machines',registryMenuOpen:true,expenseMenuOpen:false,productDetailReturnView:'products',can:()=>true,icon:()=>''};
 const html=runInNewContext(nav+'\nnavigation()',context);
 assert.match(html,/data-action="toggle-registry"[^>]+aria-expanded="true" aria-controls="registry-submenu"/);
 for(const [view,label] of [['customers','Clientes'],['products','Produtos'],['suppliers','Fornecedores'],['card-machines','Máquinas de cartão'],['sellers','Vendedores']])assert.match(html,new RegExp('data-view="'+view+'"[^>]*>'+label+'</button>'));
 assert.equal((html.match(/aria-current="page"/g)||[]).length,1);assert.equal((html.match(/>Vender<\/button>/g)||[]).length,1);
 const settings=source.slice(source.indexOf('function renderSettings()'),source.indexOf('function renderSellers()'));
 assert.doesNotMatch(settings,/cardMachinesPanel|Vendedores/);assert.match(settings,/statusCatalogPanel.*pixAccountsPanel/);
 const stock=source.slice(source.indexOf('function renderStock()'),source.indexOf('function supplierCatalogPanel()'));assert.doesNotMatch(stock,/supplierCatalogPanel/);
 const denied=runInNewContext(nav+'\nnavigation()',{...context,can:p=>p!=='users.manage'});assert.doesNotMatch(denied,/data-view="sellers"/);
});
test('identificação na interface: painel opcional escapado sem criar campos obrigatórios',()=>{
 const helper=source.slice(source.indexOf('function itemDetailsFields('),source.indexOf('function renderEditor()'));
 const context={trackedItem:()=>false,esc:v=>String(v).replaceAll('<','&lt;').replaceAll('>','&gt;'),icon:()=>'',field:(l,c)=>l+c};
 const closed=runInNewContext(helper+'\nitemDetailsFields({},0)',context);assert.match(closed,/aria-expanded="false"/);assert.match(closed,/item-details-0"[^>]+hidden/);assert.doesNotMatch(closed,/ required| checked/);
 const open=runInNewContext(helper+'\nitemDetailsFields({serial_number:"<SN>",details:"Azul",share_details:true},1)',context);
 assert.match(open,/aria-expanded="true"/);assert.match(open,/&lt;SN&gt;/);assert.match(open,/data-key="share_details" checked/);
 assert.match(source,/serial_number:i.serial_number\?\?''/);assert.match(source,/item.serial_number='';item.details='';item.share_details=false/);
});
