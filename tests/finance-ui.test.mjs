import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { createFinanceUI } from '../public/finance-ui.mjs';

test('subcategorias na interface: catálogo, aplicação por tipo e edição no formulário',async()=>{
 const categories=[{id:'cat-both',name:'Estrutura',active:true,applicability:'both',color:'#123456'},{id:'cat-fixed',name:'Só fixas',active:true,applicability:'fixed'}];
 const subcategories=[{id:'sub-fixed',category_id:'cat-both',name:'Aluguel',active:true,applicability:'fixed',version:1},{id:'sub-variable',category_id:'cat-both',name:'Material',active:true,applicability:'variable',version:2}];
 const rows=[{id:'e',description:'Compra',kind:'variable',category_id:'cat-both',category:'Estrutura',subcategory_id:'sub-variable',subcategory:'Material antigo',state:'open',amount_cents:1000,due_date:'2026-09-06'}];
 const x=harness({categories,subcategories,rows});await x.ui.load();x.ui.expensesPage('catalogs');
 assert.match(x.html,/Nova subcategoria/);assert.match(x.html,/Somente fixas/);assert.match(x.html,/Somente variáveis/);
 x.ui.expensesPage('variable');await x.ui.action('fin-new');assert.doesNotMatch(x.dialog,/value="cat-fixed"/);
 await x.ui.action('fin-edit','e');assert.match(x.dialog,/value="sub-variable" selected/);assert.doesNotMatch(x.dialog,/value="sub-fixed"/);
 await x.ui.action('fin-subcategory-edit','sub-variable');assert.match(x.dialog,/name="category_id" value="cat-both"/);
 const result=await x.ui.submit({id:'fin-subcategory-form',dataset:{id:'sub-variable',version:'2'}},{name:'Material novo',category_id:'cat-both',applicability:'variable',active:'on'});
 assert.equal(result.view,'expenses-catalogs');assert.deepEqual(x.calls.at(-1).data,{name:'Material novo',category_id:'cat-both',applicability:'variable',active:true,version:2});
});
test('subcategorias na interface: mudar tipo limpa classificação incompatível sem refazer formulário',async()=>{
 const x=harness({categories:[{id:'cat',name:'Fixa',applicability:'fixed',active:true}],subcategories:[{id:'sub',category_id:'cat',name:'Sub fixa',applicability:'fixed',active:true}]});await x.ui.load();
 const target={outerHTML:''},values={kind:'variable',category_id:'cat',subcategory_id:'sub'};
 const form={id:'fin-expense-form',dataset:{id:''},querySelector:selector=>selector==='[data-expense-classification]'?target:{value:values[selector.match(/name="([^"]+)"/)[1]]}};
 const result=x.ui.change({name:'kind',form});
 assert.equal(result.scope,form);assert.equal(result.name,'kind');assert.doesNotMatch(target.outerHTML,/value="cat"|value="sub"/);assert.match(target.outerHTML,/name="subcategory_id" disabled/);assert.equal(x.ui.dirty(),true);
});
test('lote na interface: datas brasileiras e subcategorias são enviadas em ISO com IDs',async()=>{
 const x=harness();await x.ui.load();
 const data={description:'Compra',amount:'10.00',due_date:'07/09/2026',reference_month:'09/2026',category_id:'cat',subcategory_id:'sub',payee:'',notes:''};
 const row={querySelector:selector=>{const name=selector.match(/bulk_(\w+)/)[1];return {value:data[name],dataset:name==='due_date'?{dateKind:'date'}:name==='reference_month'?{dateKind:'month'}:{}};}};
 await x.ui.submit({id:'fin-bulk-form',dataset:{requestId:'id'},querySelectorAll:()=>[row]},{reminder_days:'3'});
 assert.equal(x.calls.at(-1).data.expenses[0].due_date,'2026-09-07');assert.equal(x.calls.at(-1).data.expenses[0].reference_month,'2026-09');assert.equal(x.calls.at(-1).data.expenses[0].subcategory_id,'sub');
});

function harness({permissions=['expenses.view','expenses.manage','finance.view','finance.manage'],closed=false,sourceChanged=false,rows=[],categories=[],subcategories=[],reminders={count:0,overdue_count:0,items:[]},modal={querySelector:()=>({textContent:''})}}={}) {
  let html='',dialog='',calls=[];const session={user:{id:'test'}};
  rows=rows.map(e=>({reference_month:'2026-09',...e}));
  const today=()=> '2026-09-06',money=n=>`R$ ${n/100}`,value=n=>(n/100).toFixed(2),esc=v=>String(v??'').replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;'),
    expense={month:'2026-09',rows,closed:false,summary:{total_cents:1000,fixed_cents:1000,variable_cents:0,paid_cents:0,open_cents:1000,overdue_cents:0},reminders,categories,subcategories},
    report={closed,source_changed:sourceChanged,closure_id:'closure',result:{partners:[{id:'partner-a',name:'<Sócio>',basis_points:10000,amount_cents:800}],reserve_basis_points:2000,reserve_cents:200,distribution_cents:800,settings_version:0,source_hash:'source',result_cents:1000,sales_profit_cents:2000,expenses_cents:1000,fixed_cents:1000,variable_cents:0,incomplete_sales:[],sales_count:1,cash_available_cents:null},withdrawals:[],withdrawn_cents:0,remaining_withdrawals_cents:800,cash_after_planned_cents:null,settings:{version:0,partners:[],reserve_basis_points:10000},history:[]};
  const ui=createFinanceUI({api:async(path,data)=>{calls.push({path,data});if(data&&path.startsWith('/expenses'))return {expenses:[{id:'e',...data}]};if(path.startsWith('/expenses')){const month=path.split('month=')[1];return {...expense,month,rows:month==='all'?rows:rows.filter(e=>e.reference_month===month)};}return report;},getState:()=>session,can:p=>permissions.includes(p),page:s=>html=s,
    heading:(a,b,c='')=>`<h1>${a}</h1><p>${b}</p>${c}`,metric:(a,b)=>`<section>${a}: ${b}</section>`,empty:(a,b)=>`<h3>${a}</h3><p>${b}</p>`,field:(l,c)=>`<label>${l}${c}</label>`,input:(name,v,extra)=>`<input name="${name}" value="${esc(v)}" ${extra}>`,option:(v,l,s)=>`<option value="${v}" ${v===s?'selected':''}>${l}</option>`,esc,money,value,cents:v=>Math.round(Number(v)*100),dateLabel:esc,today,showModal:(title,content)=>dialog=`${title}${content}`,modal,icon:()=>''});
  return {ui,get html(){return html;},get dialog(){return dialog;},calls,report,session};
}

test('remover linhas financeiras preserva foco e não remove a última despesa',async()=>{
 let focused='',rows=[];
 const add={focus(){focused='add';}},summary={textContent:''};
 const modal={querySelectorAll:()=>rows,querySelector:s=>s==='#expense-bulk-summary'?summary:add};
 const makeRow=id=>({nextElementSibling:null,previousElementSibling:null,querySelector:s=>s==='input'?{focus(){focused=id;}}:{value:'1',setAttribute(){}},remove(){rows=rows.filter(r=>r!==this);}});
 const x=harness({modal}),a=makeRow('first'),b=makeRow('last');rows=[a,b];a.nextElementSibling=b;b.previousElementSibling=a;
 await x.ui.action('fin-bulk-remove','',{closest:()=>a});assert.equal(focused,'last');assert.equal(rows.length,1);assert.equal(x.ui.dirty(),true);
 await x.ui.action('fin-bulk-remove','',{closest:()=>b});assert.equal(rows.length,1);
 b.previousElementSibling=null;await x.ui.action('fin-remove-partner','',{closest:()=>b});assert.equal(rows.length,0);assert.equal(focused,'add');
 rows=[a,b];await x.ui.action('fin-remove-partner','',{closest:()=>a});assert.equal(focused,'last');
});

test('interface financeira: telas com nomes claros, valores e fonte escapada, sem acesso adicional',async()=>{
  const x=harness({rows:[{id:'e',description:'<script>alert(1)</script>',category:'<Categoria>',payee:'Fornecedor',kind:'fixed',amount_cents:1000,due_date:'2026-09-06',state:'today',notes:''}]});
  await x.ui.load();x.ui.expensesPage();assert.match(x.html,/<h1>Dashboard de despesas/);assert.match(x.html,/Lembretes de despesas/);assert.match(x.html,/Fixas/);assert.match(x.html,/Variáveis/);assert.match(x.html,/&lt;Categoria&gt;/);assert.doesNotMatch(x.html,/<Categoria>/);
  x.ui.expensesPage('fixed');assert.match(x.html,/&lt;script&gt;/);assert.doesNotMatch(x.html,/<script>/);
  x.ui.closingPage();assert.match(x.html,/<h1>Fechamento geral/);assert.match(x.html,/Lucro reservado à loja/);assert.match(x.html,/&lt;Sócio&gt;/);assert.match(x.html,/fin-close" disabled/);assert.match(x.html,/mês terminar/);
  const restricted=harness({permissions:[]});await restricted.ui.load();restricted.ui.expensesPage();assert.match(restricted.html,/Acesso restrito/);assert.equal(restricted.calls.length,0);
});

test('período de despesas: seleção única, mês condicional e filtros independentes',async()=>{
 const x=harness({rows:[{id:'a',description:'Atual',kind:'fixed',amount_cents:1000,state:'open'},{id:'b',description:'Anterior',reference_month:'2026-08',kind:'fixed',amount_cents:2000,state:'open'}]});
 await x.ui.load();x.ui.expensesPage('fixed');assert.equal((x.html.match(/>Todos os meses</g)||[]).length,1);assert.doesNotMatch(x.html,/Competência \(opcional\)|Aplicar período/);
 await x.ui.submit({id:'fin-expense-list-period'},{period:'current'});assert.match(x.html,/Atual/);assert.doesNotMatch(x.html,/Anterior/);assert.match(x.html,/value="current" selected/);
 await x.ui.submit({id:'fin-expense-list-period'},{period:'month',month:'2026-08'});assert.match(x.html,/Anterior/);assert.doesNotMatch(x.html,/Atual/);assert.doesNotMatch(x.html,/class="period-month" hidden/);
 await assert.rejects(x.ui.submit({id:'fin-expense-list-period'},{period:'month',month:''}),/mês válido/);
 x.ui.expensesPage('variable');assert.match(x.html,/value="all" selected/);x.ui.closingPage();assert.match(x.html,/name="month" value="2026-09"/);
 await x.ui.submit({id:'fin-expenses-month'},{period:'all'});assert.match(x.html,/Total de despesas: R\$ 30/);await x.ui.submit({id:'fin-expenses-month'},{period:'current'});assert.match(x.html,/Total de despesas: R\$ 10/);
});

test('interface financeira: fechamento passado habilita conferência; fonte alterada não libera retirada',async()=>{
  const x=harness();await x.ui.load();await x.ui.submit({id:'fin-closing-month'},{month:'2026-08'});assert.match(x.html,/fin-close" >Conferir/);
  const closed=harness({closed:true,sourceChanged:true});await closed.ui.load();closed.ui.closingPage();assert.match(closed.html,/movimentação nas vendas/);assert.doesNotMatch(closed.html,/data-action="fin-withdraw"/);assert.match(closed.html,/A conferir/);
});

test('interface financeira: listas de tipo/situação e cadastro usam o contrato esperado',async()=>{
  const x=harness({rows:[{id:'e',description:'Energia',kind:'variable',amount_cents:1000,due_date:'2026-09-06',state:'open',notes:''}]});await x.ui.load();
  x.ui.expensesPage('fixed');assert.match(x.html,/Nenhuma despesa nesta seleção/);
  await x.ui.action('fin-new','');assert.match(x.dialog,/Mês de referência/);assert.match(x.dialog,/repeat_count/);assert.match(x.dialog,/data|Vencimento/);
  const saved=await x.ui.submit({id:'fin-expense-form',dataset:{id:'e',version:'2',requestId:'req'}},{description:'Energia',amount:'25.50',reminder_days:'3',reference_month:'2026-09',due_date:'2026-09-10',kind:'variable'});
  assert.match(saved.message,/salva/);
  const sent=x.calls.at(-1);assert.equal(sent.path,'/expenses/e');assert.equal(sent.data.amount_cents,2550);assert.equal(sent.data.version,2);
});

test('interface financeira: mostra observação do pagamento sem executar conteúdo',async()=>{
  const x=harness({rows:[{id:'e',description:'Aluguel',kind:'fixed',amount_cents:1000,due_date:'2026-09-06',paid_date:'2026-09-06',state:'paid',notes:'',payment_note:'<Banco & conta>'}]});
  await x.ui.load();x.ui.expensesPage('fixed');assert.match(x.html,/Pago em 2026-09-06/);assert.match(x.html,/&lt;Banco &amp; conta&gt;/);
});

test('interface financeira: menus respeitam permissões e os ativos são declarados',()=>{
  const app=readFileSync(new URL('../public/app.mjs',import.meta.url),'utf8');
  assert.match(app,/parent===entry\[0\]&&navAllowed\(v\)/);assert.match(app,/\['expense-menu','expenses','expenses-fixed','expenses-variable','expenses-catalogs'\]\.includes\(v\)\|\|can\('expenses.view'\)/);assert.match(app,/v!=='closing'\|\|can\('finance.view'\)/);
  assert.match(app,/role="group" aria-label="Submenus de/);assert.match(app,/financeUI\.afterAction\(\)/);
  assert.match(app,/financeUI\.requestClose\(\)/);assert.match(app,/financeUI\.dirty\(\)/);
  assert.match(readFileSync(new URL('../public/index.html',import.meta.url),'utf8'),/href="\/finance.css"/);
});

test('interface despesas: submenus incluem todos os meses e filtros são independentes',async()=>{
 const x=harness({rows:[{id:'fixed-old',description:'Aluguel antigo',kind:'fixed',amount_cents:1000,reference_month:'2026-08',due_date:'2026-08-06',state:'open',month_closed:true},{id:'variable-old',description:'Limpeza antiga',kind:'variable',amount_cents:2000,reference_month:'2026-08',due_date:'2026-08-06',state:'paid',paid_date:'2026-08-06',month_closed:true},{id:'variable-new',description:'Embalagens novas',kind:'variable',amount_cents:3000,reference_month:'2026-09',due_date:'2026-09-06',state:'open',month_closed:false}]});
 await x.ui.load();assert.ok(x.calls.some(c=>c.path==='/expenses?month=all'));
 x.ui.expensesPage('variable');assert.match(x.html,/Despesas variáveis/);assert.match(x.html,/Todos os meses/);assert.match(x.html,/Limpeza antiga/);assert.match(x.html,/Embalagens novas/);assert.doesNotMatch(x.html,/Aluguel antigo/);assert.match(x.html,/Cadastrar várias/);
 await x.ui.submit({id:'fin-expense-list-period'},{month:'2026-09'});assert.doesNotMatch(x.html,/Limpeza antiga/);assert.match(x.html,/Embalagens novas/);
 x.ui.expensesPage('fixed');assert.match(x.html,/Aluguel antigo/);assert.doesNotMatch(x.html,/Embalagens novas/);assert.doesNotMatch(x.html,/data-action="fin-edit" data-id="fixed-old"/);assert.match(x.html,/data-action="fin-pay" data-id="fixed-old"/);
});

test('interface despesas: novo cadastro respeita tipo do submenu e mês, sem afetar fechamento',async()=>{
 const x=harness();await x.ui.load();x.ui.expensesPage('variable');await x.ui.action('fin-new','');assert.match(x.dialog,/<option value="variable" selected>/);assert.doesNotMatch(x.dialog,/<option value="fixed" selected>/);
 await x.ui.submit({id:'fin-expense-list-period'},{month:'2026-08'});await x.ui.action('fin-new','');assert.match(x.dialog,/name="reference_month" value="2026-08"/);
 x.ui.expensesPage('fixed');await x.ui.action('fin-new','');assert.match(x.dialog,/<option value="fixed" selected>/);
 x.ui.closingPage();assert.match(x.html,/name="month" value="2026-09"/);
});

test('interface despesas: lote envia linhas distintas e conserva UUID em reenvios',async()=>{
 const x=harness();await x.ui.load();
 const makeRow=values=>({querySelector:selector=>({value:values[selector.match(/bulk_(\w+)/)[1]]??''})});
 const values=[{description:'Limpeza',amount:'12.50',due_date:'2026-09-10',reference_month:'2026-09'},{description:'Conserto',amount:'35.75',due_date:'2026-10-05',reference_month:'2026-10',payee:'Oficina'}];
 const form={id:'fin-bulk-form',dataset:{requestId:'stable-request'},querySelectorAll:()=>values.map(makeRow)};
 const result=await x.ui.submit(form,{reminder_days:'5'});assert.equal(result.view,'expenses-variable');
 const first=x.calls.at(-1);assert.equal(first.path,'/expenses/batch');assert.equal(first.data.request_id,'stable-request');assert.deepEqual(first.data.expenses.map(e=>e.amount_cents),[1250,3575]);assert.ok(first.data.expenses.every(e=>e.kind==='variable'&&e.reminder_days===5));assert.equal(first.data.expenses[1].reference_month,'2026-10');
 await x.ui.submit(form,{reminder_days:'5'});assert.equal(x.calls.at(-1).data.request_id,first.data.request_id);
 const callCount=x.calls.length;values[1].description='';await assert.rejects(()=>x.ui.submit(form,{reminder_days:'5'}),/Linha 2/);assert.equal(x.calls.length,callCount);
});

test('navegação: Despesas é um pai recolhível com quatro filhos e uma única página ativa',()=>{
 const app=readFileSync(new URL('../public/app.mjs',import.meta.url),'utf8');
 const source=app.slice(app.indexOf('const navs='),app.indexOf('function renderAuth()'));
 const context={view:'expenses-variable',expenseMenuOpen:false,registryMenuOpen:false,can:()=>true,icon:()=>'',productDetailReturnView:'products'};
 const html=runInNewContext(`${source}\nnavigation()`,context);
 assert.match(html,/data-action="toggle-expenses"[^>]+aria-expanded="false" aria-controls="expense-submenu"/);
 assert.match(html,/id="expense-submenu"[^>]+hidden/);
 assert.doesNotMatch(html,/data-view="expense-menu"/);
 assert.match(html,/data-view="expenses"[^>]*>Dashboard<\/button>/);
 assert.match(html,/data-view="expenses-fixed"[^>]*>Fixas<\/button>/);
 assert.match(html,/data-view="expenses-variable"[^>]*aria-current="page"[^>]*>Variáveis<\/button>/);
 assert.match(html,/data-view="expenses-catalogs"[^>]*>Cadastros<\/button>/);
 assert.equal((html.match(/aria-current="page"/g)||[]).length,1);
 const expanded=runInNewContext(`${source}\nnavigation()`,{...context,expenseMenuOpen:true});
 assert.match(expanded,/aria-expanded="true"/);assert.doesNotMatch(expanded,/id="expense-submenu"[^>]+hidden/);
 const denied=runInNewContext(`${source}\nnavigation()`,{...context,can:p=>p!=='expenses.view'});
 assert.doesNotMatch(denied,/toggle-expenses|expense-submenu|data-view="expenses/);
 const toggle=app.match(/else if\(a==='toggle-expenses'\)\{([^\n]+)/)[1];assert.match(toggle,/\.nav'\)\.innerHTML=navigation\(\)/);assert.doesNotMatch(toggle,/\brender\(/);assert.match(toggle,/\.focus\(\)/);
 assert.match(readFileSync(new URL('../public/finance.css',import.meta.url),'utf8'),/\.nav-submenu\[hidden\]\{display:none!important\}/);
});

test('dashboard de despesas: totais, tipos, situações e categorias excluem canceladas',async()=>{
 const x=harness({rows:[
  {id:'a',kind:'fixed',amount_cents:10000,state:'paid',paid_date:'2026-09-01',category:'Estrutura'},
  {id:'b',kind:'fixed',amount_cents:2000,state:'overdue',category:'Estrutura'},
  {id:'c',kind:'variable',amount_cents:3000,state:'today',category:'<Serviços>'},
  {id:'d',kind:'variable',amount_cents:4000,state:'open',category:''},
  {id:'e',kind:'variable',amount_cents:90000,state:'cancelled',voided_at:'2026-09-01',category:'Não contar'}
 ]});await x.ui.load();x.ui.expensesPage('');
 assert.match(x.html,/Total de despesas: R\$ 190<\/section>/);assert.match(x.html,/Já pago: R\$ 100<\/section>/);assert.match(x.html,/Falta pagar: R\$ 90<\/section>/);assert.match(x.html,/Em atraso: R\$ 20<\/section>/);
 assert.match(x.html,/4 contas consideradas · 1 canceladas fora dos totais/);assert.doesNotMatch(x.html,/Não contar|R\$ 900/);
 assert.match(x.html,/Estrutura<\/td><td class="num">2<\/td><td class="num strong">R\$ 120/);
 assert.match(x.html,/&lt;Serviços&gt;/);assert.doesNotMatch(x.html,/<Serviços>/);assert.match(x.html,/Sem categoria/);
 assert.match(x.html,/Vencem hoje<\/span><span>1 conta<\/span><strong>R\$ 30/);assert.match(x.html,/A vencer<\/span><span>1 conta<\/span><strong>R\$ 40/);
 assert.match(x.html,/data-action="fin-drill-type" data-id="fixed"/);assert.doesNotMatch(x.html,/fin-expense-filter|fin-kind|data-action="fin-new"/);
});

test('dashboard de despesas: todos os meses e detalhamento respeitam período, listas e troca de usuário',async()=>{
 const x=harness({rows:[{id:'a',description:'Setembro',kind:'fixed',amount_cents:1000,state:'open'},{id:'b',description:'Agosto',reference_month:'2026-08',kind:'fixed',amount_cents:2000,state:'open'}]});
 await x.ui.load();x.ui.expensesPage('');assert.match(x.html,/Total de despesas: R\$ 10<\/section>/);
 await x.ui.action('fin-dashboard-all');assert.match(x.html,/Total de despesas: R\$ 30<\/section>/);
 let result=await x.ui.action('fin-drill-type','fixed');assert.equal(result.view,'expenses-fixed');x.ui.expensesPage('fixed');assert.match(x.html,/Setembro/);assert.match(x.html,/Agosto/);
 x.ui.expensesPage('');await x.ui.action('fin-dashboard-month','2026-08');assert.match(x.html,/Total de despesas: R\$ 20<\/section>/);
 result=await x.ui.action('fin-drill-type','fixed');x.ui.expensesPage('fixed');assert.equal(result.view,'expenses-fixed');assert.match(x.html,/Agosto/);assert.doesNotMatch(x.html,/Setembro/);
 x.ui.closingPage();assert.match(x.html,/name="month" value="2026-09"/);
 await x.ui.action('fin-dashboard-all');await x.ui.submit({id:'fin-expenses-month'},{month:'2026-09'});assert.match(x.html,/Total de despesas: R\$ 10<\/section>/);
 await x.ui.action('fin-dashboard-all');x.session.user.id='another-user';await x.ui.load();x.ui.expensesPage('');assert.match(x.html,/Total de despesas: R\$ 10<\/section>/);
 x.ui.expensesPage('fixed');assert.match(x.html,/value="all" selected/);assert.match(x.html,/class="period-month" hidden/);assert.match(x.html,/name="month"[^>]+disabled/);
});

test('dashboard de despesas: vazio sem dados inventados e lembretes globais com permissão somente consulta',async()=>{
 const x=harness({permissions:['expenses.view'],reminders:{count:1,overdue_count:1,items:[{id:'past',description:'<Conta anterior>',state:'overdue',due_date:'2026-08-01',amount_cents:4000,days_until_due:-36}]}});
 await x.ui.load();x.ui.expensesPage('');
 assert.match(x.html,/Total de despesas: R\$ 0<\/section>/);assert.match(x.html,/Nenhuma despesa no período/);assert.match(x.html,/Sem histórico de despesas/);assert.match(x.html,/0% das despesas/);assert.doesNotMatch(x.html,/NaN|Infinity/);
 assert.match(x.html,/de todos os meses/);assert.match(x.html,/&lt;Conta anterior&gt;/);assert.match(x.html,/R\$ 40/);assert.doesNotMatch(x.html,/data-action="fin-pay"|data-action="fin-bulk"|data-view="closing"/);
 assert.ok(x.calls.every(c=>c.path.startsWith('/expenses')));
});

test('dashboard de despesas: histórico limita seis competências e mostra totais mensais conferíveis',async()=>{
 const rows=Array.from({length:8},(_,i)=>({id:String(i),kind:i%2?'fixed':'variable',state:'open',reference_month:`2026-${String(i+1).padStart(2,'0')}`,amount_cents:(i+1)*1000}));
 const x=harness({rows});await x.ui.load();x.ui.expensesPage('');
 const table=x.html.match(/<table class="expense-history-table">([\s\S]*?)<\/table>/)[1];
 assert.equal((table.match(/data-action="fin-dashboard-month"/g)||[]).length,6);
 assert.match(table,/data-id="2026-08"/);assert.doesNotMatch(table,/data-id="2026-02"|data-id="2026-01"/);
 assert.match(table,/<td>agosto de 2026<\/td><td class="num">R\$ 80<\/td><td class="num">R\$ 0<\/td><td class="num strong">R\$ 80<\/td><td class="num">R\$ 0<\/td><td class="num">R\$ 80/);
});

test('cadastros de despesas: catálogo escapado, edição com versão, cor e situação',async()=>{
 const c={id:'cat-a',name:'<Estrutura>',color:'#9756F4',active:true,version:2,expense_count:4};
 const x=harness({categories:[c]});await x.ui.load();x.ui.expensesPage('catalogs');
 assert.match(x.html,/Cadastros de despesas/);assert.match(x.html,/&lt;Estrutura&gt;/);assert.match(x.html,/4 despesas vinculadas/);assert.match(x.html,/Nova categoria/);
 await x.ui.action('fin-category-edit','cat-a');assert.match(x.dialog,/name="color" value="#9756F4" type="color"/);
 const result=await x.ui.submit({id:'fin-category-form',dataset:{id:c.id,version:'2'}},{name:'Nova',color:'#22D5E8',applicability:'fixed'});
 assert.equal(result.view,'expenses-catalogs');assert.equal(x.calls.at(-1).path,'/expense-categories/cat-a');assert.deepEqual(x.calls.at(-1).data,{name:'Nova',color:'#22D5E8',applicability:'fixed',active:false,version:2});
 const restricted=harness({permissions:['expenses.view'],categories:[c]});await restricted.ui.load();restricted.ui.expensesPage('catalogs');assert.doesNotMatch(restricted.html,/fin-category-new|fin-category-edit/);
});

test('categorias na interface: seletor ativo, filtro por ID e texto legado preservado',async()=>{
 const categories=[{id:'active',name:'Categoria atual',active:true,color:'#9756F4'},{id:'inactive',name:'Antiga',active:false,color:'#9756F4'}];
 const rows=[{id:'a',description:'Vinculada',category_id:'active',category:'Nome fotografado',kind:'variable',amount_cents:1000,state:'open'},{id:'b',description:'Sem vínculo',category:'Texto legado',kind:'variable',amount_cents:2000,state:'open'},{id:'c',description:'Categoria inativa',category_id:'inactive',category:'Antiga',kind:'variable',amount_cents:3000,state:'open'}];
 const x=harness({categories,rows});await x.ui.load();x.ui.expensesPage('variable');await x.ui.action('fin-new');assert.match(x.dialog,/value="active"/);assert.doesNotMatch(x.dialog,/value="inactive"/);
 await x.ui.action('fin-edit','c');assert.match(x.dialog,/value="inactive" selected/);
 await x.ui.submit({id:'fin-expense-list-filter'},{search:'',status:'',category:'active'});assert.match(x.html,/Vinculada/);assert.doesNotMatch(x.html,/<strong>Sem vínculo/);assert.match(x.html,/Total de variáveis: R\$ 10/);
 await x.ui.action('fin-list-clear');assert.match(x.html,/<strong>Sem vínculo/);
 await x.ui.action('fin-edit','b');assert.match(x.dialog,/value="legacy" selected/);
 await x.ui.submit({id:'fin-expense-form',dataset:{id:'b',version:'1'}},{description:'Sem vínculo',kind:'variable',amount:'20',reminder_days:'3',category_id:'legacy'});assert.equal(x.calls.at(-1).data.category,'Texto legado');assert.equal(x.calls.at(-1).data.category_id,null);
});

test('dashboard agrupa uma categoria renomeada pelo ID sem dividir valores históricos',async()=>{
 const x=harness({categories:[{id:'cat',name:'Atual',active:true}],rows:[{category_id:'cat',category:'Anterior',kind:'fixed',amount_cents:1000,state:'open'},{category_id:'cat',category:'Atual',kind:'fixed',amount_cents:2000,state:'open'}]});await x.ui.load();x.ui.expensesPage('');
 assert.match(x.html,/Atual<\/td><td class="num">2<\/td><td class="num strong">R\$ 30/);
 assert.doesNotMatch(x.html,/>Anterior<\/td>/);
});
