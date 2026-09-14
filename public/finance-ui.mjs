import { dateValue } from './date-control.mjs';
export function refundCashNotice(refunds,money) {
 return refunds?.count?`<aside class="refund-cancel-notice"><strong>${money(refunds.total_cents)} em devoluções pendentes</strong><p>Todos os períodos. Separe este valor antes das retiradas. O caixa precisa ser conferido novamente; nada foi descontado ou estornado automaticamente.</p><p>Confira também taxas, frete e despesas de pedidos cancelados que não foram recuperados. Canceladas não entram no lucro das vendas.</p></aside>`:'';
}
function refundReserveFields(refunds,esc,money) {
 return refunds?.count?`${refundCashNotice(refunds,money)}<input type="hidden" name="refunds_token" value="${esc(refunds.token)}"><label class="finance-confirm"><input type="checkbox" name="acknowledge_refund_reserve" required>Conferi o caixa e separei o dinheiro das devoluções pendentes antes das retiradas.</label>`:'';
}
export function createFinanceUI({api,getState,can,page,heading,metric,empty,field,input,option,esc,money,value,cents,dateLabel,today,showModal,modal,icon}) {
  let loadGeneration=0;
  let expenseMonth=today().slice(0,7), closingMonth=expenseMonth, expenseData=null, report=null, userIdentity=null;
  let modalDirty=false, expenseSection='', expenseAllData=null, dashboardAll=false;
  const listFilters={fixed:{month:'',status:'',search:'',category:''},variable:{month:'',status:'',search:'',category:''}};
  const kinds={fixed:'Fixa',variable:'Variável'}, states={paid:'Paga',overdue:'Atrasada',today:'Vence hoje',open:'A pagar',cancelled:'Cancelada'};
  const currentIdentity=()=>{const current=getState(),user=current?.user;return user?JSON.stringify([current.store?.id??'',user.id,!!user.is_owner,[...(user.permissions??[])].sort()]):'';};
  const badge=e=>`<span class="badge ${e.state==='paid'?'good':e.state==='overdue'?'bad':e.state==='today'?'warn':''}">${states[e.state]}</span>`;
  const percent=bp=>`${value(bp)}%`;
  const button=(action,label,key='',className='small')=>`<button type="button" class="${className}" data-action="fin-${action}" data-id="${esc(key)}">${label}</button>`;
  const expenseDateInput=(name,date,extra='')=>input(name,date,`type="date" ${extra}`).replace(/aria-label="[^"]+"/,'aria-label="Data da despesa (DD/MM/AAAA)"');
  const monthLabel=month=>new Intl.DateTimeFormat('pt-BR',{month:'long',year:'numeric',timeZone:'UTC'}).format(new Date(`${month}-01T12:00:00Z`));
  const categories=()=>expenseAllData?.categories??[];
  const subcategories=()=>expenseAllData?.subcategories??[];
  const scopeLabel=scope=>scope==='fixed'?'Somente fixas':scope==='variable'?'Somente variáveis':'Fixas e variáveis';
  const accepts=(scope,kind)=>!scope||scope==='both'||scope===kind;
  const scopeField=(selected='both',parent='both')=>field('Válida para',`<select name="applicability" required>${[['both','Fixas e variáveis'],['fixed','Somente fixas'],['variable','Somente variáveis']].filter(([v])=>parent==='both'||v===parent||v===selected).map(([v,l])=>option(v,l,selected)).join('')}</select>`);
  function categorySelect(name,selected='',legacy='',kind='',required=false) {
    const emptyLabel=required?'Selecione a categoria':'Sem categoria';
    return `<select name="${name}" ${required?'required aria-required="true"':''}>${option('',emptyLabel,selected||(!legacy?'':'legacy'))}${!required&&!selected&&legacy?option('legacy',`${legacy} (registro anterior)`,'legacy'):''}${categories().filter(c=>(c.active&&(!kind||accepts(c.applicability,kind)))||c.id===selected).map(c=>option(c.id,`${c.name}${c.active?'':' (inativa)'}`,selected)).join('')}</select>`;
  }
  function categoryFilter(selected='') {
    const legacy=[...new Set((expenseAllData?.rows??[]).filter(e=>!e.category_id&&e.category).map(e=>e.category))].sort((a,b)=>a.localeCompare(b,'pt-BR'));
    return `<select name="category" aria-label="Filtrar categoria">${option('','Todas as categorias',selected)}${option('none','Sem categoria',selected)}${categories().map(c=>option(c.id,`${c.name}${c.active?'':' (inativa)'}`,selected)).join('')}${legacy.map(name=>option(`legacy:${name}`,`${name} (registro anterior)`,selected)).join('')}</select>`;
  }
  const matchesCategory=(e,filter)=>!filter||(filter==='none'?!e.category_id&&!e.category:filter.startsWith('legacy:')?!e.category_id&&e.category===filter.slice(7):e.category_id===filter);
  function classificationFields(kind,categoryId='',legacy='',subId='',required=kind==='variable'||kind==='bulk') {
    const prefix=kind==='bulk'?'bulk_':'',type=kind==='bulk'?'variable':kind;
    const children=subcategories().filter(c=>c.category_id===categoryId&&((c.active&&accepts(c.applicability,type))||c.id===subId));
    return `<div class="expense-classification full" data-expense-classification>${field(required?'Categoria *':'Categoria (opcional)',categorySelect(prefix+'category_id',categoryId,legacy,type,required))}${field(required?'Subcategoria *':'Subcategoria (opcional)',`<select name="${prefix}subcategory_id" ${required?'required aria-required="true"':''} ${!categoryId?'disabled':''}>${option('',required?(categoryId?'Selecione a subcategoria':'Escolha a categoria primeiro'):'Sem subcategoria',subId)}${children.map(c=>option(c.id,c.name+(c.active?'':' (inativa)'),subId)).join('')}</select>${required?'':`<small>${categoryId?'Selecione um detalhamento da categoria.':'Escolha uma categoria primeiro.'}</small>`}`)}</div>`;
  }
  function refreshClassification(element) {
    const form=element.form;if(!form||!['fin-expense-form','fin-bulk-form'].includes(form.id))return false;
    if(!['kind','category_id','bulk_category_id'].includes(element.name))return false;
    const bulk=form.id==='fin-bulk-form',scope=bulk?element.closest('[data-bulk-row]'):form,prefix=bulk?'bulk_':'',old=bulk?null:findExpense(form.dataset.id);
    const kind=bulk?'variable':form.dataset.kind||form.querySelector('[name="kind"]')?.value||'fixed';
    let categoryId=scope.querySelector(`[name="${prefix}category_id"]`).value,subId=scope.querySelector(`[name="${prefix}subcategory_id"]`)?.value??'';
    const category=categories().find(c=>c.id===categoryId),kept=old?.category_id===categoryId&&old?.kind===kind;
    if(categoryId!=='legacy'&&(!category||(!kept&&(!category.active||!accepts(category.applicability,kind))))){categoryId='';subId='';}
    const sub=subcategories().find(c=>c.id===subId);
    if(!sub||sub.category_id!==categoryId||(!(kept&&old?.subcategory_id===subId)&&(!sub.active||!accepts(sub.applicability,kind))))subId='';
    const target=scope.querySelector('[data-expense-classification]');
    target.outerHTML=classificationFields(bulk?'bulk':kind,categoryId==='legacy'?'':categoryId,categoryId==='legacy'?old?.category??'':'',subId,kind==='variable');
    modalDirty=true;return {scope,name:element.name==='kind'?'kind':prefix+'category_id'};
  }
  function categoryPage() {
    const rows=categories(),manage=can('expenses.manage');
    page(heading('Cadastros de despesas','Categorias e subcategorias, com uso separado por tipo de despesa.',manage?button('category-new',`${icon('plus')} Nova categoria`,'','primary'):'')+
      `<section class="panel"><div class="panel-header"><div><h2>Categorias e subcategorias</h2><p>${rows.filter(c=>c.active).length} ${rows.filter(c=>c.active).length===1?'categoria ativa':'categorias ativas'} · ${subcategories().filter(c=>c.active).length} ${subcategories().filter(c=>c.active).length===1?'subcategoria ativa':'subcategorias ativas'}</p></div></div>${rows.length?`<div class="expense-category-catalog">${rows.map(c=>`<article class="expense-category-card"><div><span class="operational-badge" data-status-color="${esc(c.color)}">${esc(c.name)}</span><span class="badge ${c.active?'good':''}">${c.active?'Ativa':'Inativa'}</span></div><p><strong>${scopeLabel(c.applicability)}</strong> · ${c.expense_count} ${c.expense_count===1?'despesa vinculada':'despesas vinculadas'}</p>${manage?button('category-edit','Editar categoria',c.id):''}<div class="subcategory-catalog"><h3>Subcategorias</h3>${subcategories().filter(sub=>sub.category_id===c.id).map(sub=>`<div class="subcategory-row"><div><strong>${esc(sub.name)}</strong><small>${scopeLabel(sub.applicability)} · ${sub.active?'Ativa':'Inativa'} · ${sub.expense_count} ${sub.expense_count===1?'despesa':'despesas'}</small></div>${manage?button('subcategory-edit','Editar',sub.id,'small subtle'):''}</div>`).join('')||'<p class="muted">Nenhuma subcategoria cadastrada.</p>'}${manage&&c.active?button('subcategory-new','+ Nova subcategoria',c.id):''}</div></article>`).join('')}</div>`:empty('Nenhuma categoria cadastrada','Use Nova categoria para organizar suas despesas.')}</section><p class="finance-footnote">Defina se cada cadastro vale para fixas, variáveis ou ambas. A subcategoria respeita os tipos permitidos na categoria. Inativar preserva históricos; renomear não altera os nomes registrados nas despesas anteriores.</p>`);
  }
  function openSubcategory(key='',categoryId='') {
    const sub=key?subcategories().find(c=>c.id===key):null;if(key&&!sub)throw Error('Atualize as subcategorias.');
    const category=categories().find(c=>c.id===(sub?.category_id||categoryId));if(!category)throw Error('Selecione uma categoria.');
    modalDirty=false;
    showModal(sub?'Editar subcategoria':'Nova subcategoria',`<div class="finance-modal-summary"><strong>${esc(category.name)}</strong><span>${scopeLabel(category.applicability)}</span></div><input type="hidden" name="category_id" value="${category.id}"><div class="fields">${field('Nome da subcategoria',input('name',sub?.name??'','required maxlength="100" placeholder="Ex.: energia elétrica"'),true)}${scopeField(sub?.applicability??category.applicability??'both',category.applicability??'both')}</div><label class="check-field"><input type="checkbox" name="active" ${sub?.active===false?'':'checked'}> Subcategoria disponível para novos lançamentos</label><p class="footer-note">A subcategoria pertence a esta categoria. Inativar não apaga despesas anteriores.</p>`,'fin-subcategory-form',`data-id="${sub?.id??''}" data-version="${sub?.version??0}"`);
  }
  function openCategory(key='') {
    const c=key?categories().find(c=>c.id===key):null;if(key&&!c)throw Error('Atualize as categorias.');modalDirty=false;
    showModal(c?'Editar categoria':'Nova categoria',`<div class="fields">${field('Nome da categoria',input('name',c?.name??'','required maxlength="100" placeholder="Ex.: Estrutura"'),true)}${field('Cor da categoria',input('color',c?.color??'#9756F4','type="color" required'))}${scopeField(c?.applicability??'both')}</div><label class="check-field"><input type="checkbox" name="active" ${c?.active===false?'':'checked'}> Categoria disponível para novos lançamentos</label><p class="footer-note">Escolha os tipos de despesas em que a categoria estará disponível. Desmarque para inativar, sem apagar nenhum histórico.</p>`,'fin-category-form',`data-id="${c?.id??''}" data-version="${c?.version??0}"`);
  }
  function selectedPeriod(data) {
    const month=data.period==='all'?'':data.period==='current'?today().slice(0,7):data.month;
    if((data.period==='month'&&!month)||(month&&!/^(20|21)\d{2}-(0[1-9]|1[0-2])$/.test(month)))throw Error('Informe um mês válido no formato MM/AAAA.');
    return month||'';
  }
  function expensePeriodForm(id,month,kind='') {
    const current=today().slice(0,7),preset=!month?'all':month===current?'current':'month';
    const scope=kind||'dashboard',owner=getState()?.user?.id??'';
    return `<form id="${id}" class="finance-period period-picker" data-expense-period-form="${esc(scope)}" data-expense-filter-owner="${esc(owner)}">${field('Período',`<select name="period" data-expense-period aria-label="Período das despesas">${option('all','Todos os meses',preset)}${option('current','Este mês',preset)}${option('month','Escolher mês',preset)}</select>`)}<div class="period-month" ${preset==='month'?'':'hidden'}>${field(kind==='variable'?'Mês do pagamento':'Mês de referência',input('month',month||current,`type="month" min="2000-01" max="2199-12" required ${preset==='month'?'':'disabled'}`))}</div><p class="period-help">${kind==='variable'?'Filtra pela data em que o gasto foi pago e lançado.':'Mês em que a despesa entra no resultado da loja, independentemente do dia do pagamento.'}</p></form>`;
  }
  function monthForm(which,month) {
    return `<form id="fin-${which}-month" class="finance-period">${field('Mês de referência',input('month',month,'type="month" min="2000-01" max="2199-12" required'))}<button type="submit">Consultar mês</button><span class="muted">${esc(monthLabel(month))}</span></form>`;
  }
  function remindersPanel(data,compact=false) {
    if(!data)return '';
    return `<section class="panel expense-reminders"><div class="panel-header"><div><h2>${icon('clock')} Lembretes de despesas</h2><p>Contas atrasadas e próximas do vencimento, de todos os meses.</p></div><span class="badge ${data.overdue_count?'bad':data.count?'warn':'good'}">${data.count} ${data.count===1?'lembrete':'lembretes'}</span></div><div class="panel-body">${data.count?`<div class="reminder-list">${data.items.slice(0,compact?4:undefined).map(e=>`<div class="reminder-item"><div><strong>${esc(e.description)}</strong><span>${dateLabel(e.due_date)} · ${e.days_until_due<0?`${-e.days_until_due} dia(s) em atraso`:e.days_until_due===0?'Vence hoje':`Em ${e.days_until_due} dia(s)`}</span></div><strong>${money(e.amount_cents)}</strong>${badge(e)}${can('expenses.manage')&&!compact?button('pay','Registrar pagamento',e.id):''}</div>`).join('')}</div>`:'<p class="muted">Nenhuma conta pendente dentro da antecedência configurada.</p>'}${compact?'<button class="small subtle" data-view="expenses">Ver despesas e vencimentos →</button>':'<p class="stat-note">Os lembretes aparecem ao acessar ou atualizar o sistema. Não há envio automático por WhatsApp, e-mail ou celular.</p>'}</div></section>`;
  }
  function variableExpenseList(rows) {
    if(!rows.length)return empty('Nenhum gasto nesta seleção','Lance uma despesa variável paga ou ajuste o período e os filtros.');
    return `<div class="variable-expense-list">${rows.map(e=>{const title=e.description?.trim()||e.subcategory?.trim()||e.category?.trim()||e.payee?.trim()||'Despesa variável',recordedDate=e.expense_date||e.paid_date||e.due_date;return `<article class="variable-expense-card"><div class="variable-expense-card-head"><div><strong>${esc(title)}</strong><span class="badge ${e.voided_at?'bad':e.paid_date?'good':'warn'}">${e.voided_at?'Cancelada':e.paid_date?'Paga':'Cadastro anterior · revisar'}</span></div><strong class="variable-expense-amount">${money(e.amount_cents)}</strong></div><dl class="variable-expense-meta"><div><dt>Data</dt><dd>${dateLabel(recordedDate)}</dd></div><div><dt>Categoria</dt><dd>${esc([e.category,e.subcategory].filter(Boolean).join(' › ')||'Cadastro anterior sem categoria')}</dd></div>${e.payee?`<div><dt>Favorecido</dt><dd>${esc(e.payee)}</dd></div>`:''}${e.description&&e.description.trim()!==title?`<div><dt>Descrição</dt><dd>${esc(e.description)}</dd></div>`:''}${e.notes?`<div class="variable-expense-note"><dt>Observação</dt><dd>${esc(e.notes)}</dd></div>`:''}</dl>${can('expenses.manage')&&!e.voided_at&&!e.month_closed?`<div class="expense-actions">${button('edit','Editar',e.id,'small')}${button('cancel','Cancelar',e.id,'small subtle danger')}</div>`:e.month_closed?'<span class="badge">Mês fechado · protegido</span>':''}</article>`;}).join('')}</div>`;
  }
  function expenseTable(rows,kind='fixed') {
    if(kind==='variable')return variableExpenseList(rows);
    if(!rows.length)return empty('Nenhuma despesa nesta seleção','Cadastre uma conta ou ajuste o mês e os filtros.');
    return `<div class="table-wrap" tabindex="0" role="region" aria-label="Lista de despesas"><table class="expense-table"><thead><tr><th>Despesa / favorecido</th><th>Tipo</th><th>Vencimento</th><th class="num">Valor</th><th>Situação</th><th>Ações</th></tr></thead><tbody>${rows.map(e=>`<tr><td><strong>${esc(e.description)}</strong><small>${esc([e.category,e.subcategory,e.payee].filter(Boolean).join(' · ')||'Sem categoria ou favorecido')}</small>${e.notes?`<small class="expense-notes">${esc(e.notes)}</small>`:''}</td><td><span class="badge">${kinds[e.kind]}</span></td><td>${dateLabel(e.due_date)}${e.reference_month?`<small>Referência: ${esc(monthLabel(e.reference_month))}${e.month_closed?' · Fechada':''}</small>`:''}${e.paid_date?`<small>Pago em ${dateLabel(e.paid_date)}</small>${e.payment_note?`<small class="expense-notes">${esc(e.payment_note)}</small>`:''}`:''}</td><td class="num strong">${money(e.amount_cents)}</td><td>${badge(e)}</td><td><div class="expense-actions">${can('expenses.manage')&&!e.voided_at?(e.paid_date?button('reopen','Estornar registro',e.id,'small subtle'):button('pay','Pagar',e.id,'small primary')+(e.month_closed?'':button('edit','Editar',e.id)+button('cancel','Cancelar',e.id,'small subtle danger'))):'—'}</div></td></tr>`).join('')}</tbody></table></div>`;
  }
  function expenseSearchForm(current,formId='fin-expense-list-filter',kind='fixed') {
    return `<form id="${formId}" class="finance-search" data-expense-list-filter="${esc(kind)}" data-expense-filter-owner="${esc(getState()?.user?.id??'')}">${input('search',current.search,`type="search" placeholder="${kind==='variable'?'Buscar categoria, favorecido ou descrição':'Buscar descrição, categoria ou favorecido'}" aria-label="Buscar despesas"`)}${categoryFilter(current.category)}${kind==='variable'?'':`<select name="status" aria-label="Situação da despesa">${[['','Todas as situações'],['pending','A pagar (todas)'],['overdue','Atrasadas'],['today','Vencem hoje'],['paid','Pagas'],['cancelled','Canceladas']].map(([v,l])=>option(v,l,current.status)).join('')}</select>`}${button('list-clear','Limpar filtros','','small subtle')}</form>`;
  }
  function expensesPage(section=expenseSection) {
    expenseSection=section;
    if(!can('expenses.view')||!expenseData){page(empty('Acesso restrito','Você precisa de permissão para consultar as despesas.'));return;}
    if(section==='catalogs'){categoryPage();return;}
    if(section){expenseListPage(section);return;}
    expenseDashboard();
  }
  function summarize(rows) {
    const active=rows.filter(e=>!e.voided_at&&e.state!=='cancelled'),sum=predicate=>active.filter(predicate).reduce((s,e)=>s+e.amount_cents,0);
    return {rows:active,count:active.length,total:sum(()=>true),paid:sum(e=>!!e.paid_date),open:sum(e=>!e.paid_date),overdue:sum(e=>e.state==='overdue'),fixed:sum(e=>e.kind==='fixed'),variable:sum(e=>e.kind==='variable'),cancelled:rows.length-active.length};
  }
  const share=(amount,total)=>`${(total?amount/total*100:0).toLocaleString('pt-BR',{maximumFractionDigits:1})}%`;
  function expenseTypeCard(type,s,total) {
    const label=type==='fixed'?'Fixas':'Variáveis';
    const details=type==='variable'?`<div class="expense-type-details variable-expense-type-details"><div><span>Registrado como pago</span><strong>${money(s.paid)}</strong></div>${s.open?`<div><span>Cadastro anterior a revisar</span><strong>${money(s.open)}</strong></div>`:''}</div>`:`<div class="expense-type-details"><div><span>Pago</span><strong>${money(s.paid)}</strong></div><div><span>A pagar</span><strong>${money(s.open)}</strong></div><div><span>Em atraso</span><strong>${money(s.overdue)}</strong></div></div>`;
    return `<section class="panel expense-type-card"><div class="panel-header"><h2>${icon(type==='fixed'?'clock':'money')} ${label}</h2><span class="badge">${s.count} ${s.count===1?(type==='variable'?'lançamento':'conta'):(type==='variable'?'lançamentos':'contas')}</span></div><div class="panel-body"><div class="expense-type-total"><strong>${money(s.total)}</strong><span>${share(s.total,total)} das despesas</span></div>${details}<button type="button" class="small" data-action="fin-drill-type" data-id="${type}">Ver ${type==='variable'?'lançamentos':'contas fixas'} ${icon('arrow')}</button></div></section>`;
  }
  function expenseDashboard() {
    const d=dashboardAll?expenseAllData:expenseData,s=summarize(d.rows),period=dashboardAll?'Todos os meses':monthLabel(expenseMonth);
    const categoryGroups=new Map();
    for(const e of s.rows){const label=categories().find(c=>c.id===e.category_id)?.name||e.category?.trim()||'Sem categoria',key=e.category_id?`id:${e.category_id}`:`text:${label}`;if(!categoryGroups.has(key))categoryGroups.set(key,{label,rows:[]});categoryGroups.get(key).rows.push(e);}
    const grouped=[...categoryGroups.values()].map(({label,rows})=>({label,...summarize(rows)})).sort((a,b)=>b.total-a.total||a.label.localeCompare(b.label,'pt-BR'));
    const statusRows=[['paid','Pagas','good'],['overdue','Atrasadas','bad'],['today','Vencem hoje','warn'],['open','A vencer','']].map(([state,label,color])=>{const rows=s.rows.filter(e=>e.state===state);return `<div class="expense-status-row"><span class="badge ${color}">${label}</span><span>${rows.length} ${rows.length===1?'conta':'contas'}</span><strong>${money(rows.reduce((sum,e)=>sum+e.amount_cents,0))}</strong></div>`;}).join('');
    const months=new Map();
    for(const e of expenseAllData?.rows??[]){if(!months.has(e.reference_month))months.set(e.reference_month,[]);months.get(e.reference_month).push(e);}
    const history=[...months].sort(([a],[b])=>b.localeCompare(a)).slice(0,6);
    page(heading('Dashboard de despesas','Visão completa das contas da loja. Cadastre e gerencie cada tipo nos submenus Fixas e Variáveis.')+
      expensePeriodForm('fin-expenses-month',dashboardAll?'':expenseMonth)+
      `<div class="expense-visual"><div><strong>${share(s.paid,s.total)} pago</strong><span>${share(s.open,s.total)} a pagar</span></div><meter min="0" max="${s.total||1}" value="${s.paid}" aria-label="Proporção das despesas pagas"></meter><div><span>${money(s.paid)}</span><span>${money(s.open)}</span></div></div>`+
      `<div class="finance-status"><span>${s.count} contas consideradas · ${s.cancelled} canceladas fora dos totais</span>${!dashboardAll&&d.closed?'<span class="badge good">Mês fechado · valores protegidos</span>':''}<span>Valores pelo mês de referência, não pela data do pagamento.</span></div>`+
      `<div class="metric-grid">${metric('Total de despesas',money(s.total),'Fixas + variáveis no período','money')}${metric('Já pago',money(s.paid),'Contas do período com pagamento registrado','check')}${metric('Falta pagar',money(s.open),'Inclui atrasadas, hoje e a vencer','clock',true)}${metric('Em atraso',money(s.overdue),'Parte do valor que falta pagar','clock')}</div>`+
      `<div class="expense-type-grid">${expenseTypeCard('fixed',summarize(d.rows.filter(e=>e.kind==='fixed')),s.total)}${expenseTypeCard('variable',summarize(d.rows.filter(e=>e.kind==='variable')),s.total)}</div>`+
      `<div class="expense-dashboard-columns"><section class="panel"><div class="panel-header"><div><h2>Situação das contas</h2><p>Quantidade e valor no período selecionado.</p></div></div><div class="panel-body">${statusRows}<p class="stat-note">Pagas + atrasadas + vencem hoje + a vencer = total do período.</p></div></section><section class="panel"><div class="panel-header"><div><h2>Despesas por categoria</h2><p>Onde estão concentrados os gastos deste período.</p></div></div>${grouped.length?`<div class="table-wrap" tabindex="0" role="region" aria-label="Despesas por categoria"><table class="expense-category-table"><thead><tr><th>Categoria</th><th class="num">Contas</th><th class="num">Total</th><th class="num">Participação</th></tr></thead><tbody>${grouped.map(c=>`<tr><td>${esc(c.label)}</td><td class="num">${c.count}</td><td class="num strong">${money(c.total)}</td><td class="num">${share(c.total,s.total)}</td></tr>`).join('')}</tbody></table></div>`:empty('Nenhuma despesa no período','As categorias aparecem aqui conforme as contas são cadastradas.')}</section></div>`+
      remindersPanel(d.reminders)+
      `<section class="panel"><div class="panel-header"><div><h2>Histórico por mês</h2><p>Até 6 meses mais recentes cadastrados, inclusive futuras. Independente do filtro acima.</p></div></div>${history.length?`<div class="table-wrap" tabindex="0" role="region" aria-label="Histórico mensal das despesas"><table class="expense-history-table"><thead><tr><th>Mês de referência</th><th class="num">Fixas</th><th class="num">Variáveis</th><th class="num">Total</th><th class="num">Pago</th><th class="num">A pagar</th><th></th></tr></thead><tbody>${history.map(([month,rows])=>{const m=summarize(rows);return `<tr><td>${esc(monthLabel(month))}</td><td class="num">${money(m.fixed)}</td><td class="num">${money(m.variable)}</td><td class="num strong">${money(m.total)}</td><td class="num">${money(m.paid)}</td><td class="num">${money(m.open)}</td><td>${button('dashboard-month','Ver mês',month)}</td></tr>`;}).join('')}</tbody></table></div>`:empty('Sem histórico de despesas','Cadastre suas contas nos submenus Fixas e Variáveis.')}</section>`+
      `<p class="finance-footnote">Não repita aqui custos de produtos, taxas, frete ou despesas já lançadas na venda. Eles já estão descontados no lucro das vendas.${can('finance.view')?' Para conferir lucro, despesas e retiradas dos sócios, abra <button type="button" class="link-button" data-view="closing">Fechamento</button>.':''}</p>`);
  }
  function expenseListPage(section) {
    const f=listFilters[section],type=section==='fixed'?'fixas':'variáveis',all=(expenseAllData?.rows??[]).filter(e=>e.kind===section),inPeriod=all.filter(e=>!f.month||e.reference_month===f.month);
    const rows=inPeriod.filter(e=>matchesCategory(e,f.category)&&(section==='variable'||!f.status||e.state===f.status||(f.status==='pending'&&!e.paid_date&&!e.voided_at))&&(!f.search||`${e.description??''} ${e.payee??''} ${e.category??''} ${e.subcategory??''}`.toLocaleLowerCase('pt-BR').includes(f.search.toLocaleLowerCase('pt-BR'))));
    const total=predicate=>rows.filter(e=>!e.voided_at&&predicate(e)).reduce((s,e)=>s+e.amount_cents,0);
    const variable=section==='variable',legacyCount=rows.filter(e=>!e.voided_at&&!e.paid_date).length,metrics=variable?`<div class="metric-grid variable-expense-metrics">${metric('Total lançado',money(total(()=>true)),legacyCount?`${legacyCount} cadastro(s) anterior(es) precisam de revisão`:'Gastos registrados como pagos no período','money')}${metric('Lançamentos',String(rows.filter(e=>!e.voided_at).length),'Sem registros cancelados','check')}</div>`:`<div class="metric-grid">${metric(`Total de ${type}`,money(total(()=>true)),'Sem contas canceladas','money')}${metric('Já pago',money(total(e=>!!e.paid_date)),'No período selecionado','check')}${metric('Falta pagar',money(total(e=>!e.paid_date)),'Contas em aberto','clock',true)}${metric('Em atraso',money(total(e=>e.state==='overdue')),'Vencidas e não pagas','clock')}</div>`;
    page(heading(`Despesas ${type}`,variable?'Gastos que já foram pagos e estão sendo lançados no controle.':`Todas as contas ${type} cadastradas, com histórico de pagamentos.`,can('expenses.manage')?`<div class="actions ${variable?'expense-primary-actions':''}">${button('new',`${icon('plus')} ${variable?'Lançar despesa':'Nova despesa'}`)}${variable?button('bulk',`${icon('plus')} Cadastrar várias`,'','primary'):''}</div>`:'')+
      expensePeriodForm('fin-expense-list-period',f.month,section)+metrics+`<section class="panel"><div class="panel-header"><div><h2>${variable?'Gastos pagos':'Lista de despesas fixas'}</h2><p>${variable?'Cada registro abaixo corresponde a uma despesa já paga.':`O mês de referência aparece junto do vencimento. Meses fechados mantêm seus valores protegidos.`}</p></div><span class="badge">${rows.length} ${rows.length===1?'registro':'registros'}</span></div><div class="expense-toolbar">${expenseSearchForm(f,'fin-expense-list-filter',section)}</div>${expenseTable(rows,section)}</section>`);
  }
  function partnerTable(r) {
    const parts=r.result.partners;
    if(!parts.length)return empty('Nenhum sócio cadastrado','Abra Sócios e divisão para informar os nomes, participações e a parcela que fica na loja.');
    return `<div class="table-wrap" tabindex="0" role="region" aria-label="Divisão do lucro entre sócios"><table><thead><tr><th>Sócio</th><th class="num">Participação</th><th class="num">Direito à retirada</th><th class="num">Já retirado</th><th class="num">A retirar</th><th></th></tr></thead><tbody>${parts.map(p=>{const paid=r.withdrawals.filter(w=>w.partner_id===p.id).reduce((s,w)=>s+w.amount_cents,0),remaining=p.amount_cents-paid;return `<tr><td class="strong">${esc(p.name)}</td><td class="num">${percent(p.basis_points)}</td><td class="num">${money(p.amount_cents)}</td><td class="num">${money(paid)}</td><td class="num strong">${money(remaining)}</td><td>${r.closed&&!r.source_changed&&can('finance.manage')&&remaining>0?button('withdraw','Registrar retirada',p.id):''}</td></tr>`;}).join('')}</tbody></table></div>`;
  }
  function closingPage() {
    if(!can('finance.view')||!report){page(empty('Acesso restrito','Você precisa de permissão para consultar o fechamento.'));return;}
    const r=report,d=r.result,negative=d.result_cents<0;
    page(heading('Fechamento geral','Resultado da loja e divisão do lucro por mês.',can('finance.manage')?button('partners',`${icon('users')} Sócios e divisão`,'','primary'):'')+
      refundCashNotice(r.refunds_pending,money)+monthForm('closing',closingMonth)+`<div class="finance-status"><span class="badge ${r.closed?'good':'warn'}">${r.closed?'Fechamento registrado':'Prévia · mês ainda aberto'}</span><span>${r.closed?'Valores e participações preservados no fechamento.':'Todos os vendedores e status de vendas confirmadas estão incluídos.'}</span></div>`+
      (r.source_changed?'<div class="alert bad">Houve movimentação nas vendas depois deste fechamento. Os valores registrados abaixo foram preservados. Será necessário revisar a diferença antes de uma nova distribuição; esta versão ainda não registra ajustes de fechamento.</div>':'')+
      (d.incomplete_sales.length?`<div class="alert bad"><strong>${d.incomplete_sales.length} venda(s) impedem o fechamento.</strong> Há custo ou pagamento pendente em ${d.incomplete_sales.map(s=>`#${String(s.number).padStart(4,'0')}`).join(', ')}. O resultado abaixo considera somente o lucro já apurado e ainda não é definitivo.</div>`:'')+
      `<div class="metric-grid">${metric('Lucro das vendas',money(d.sales_profit_cents),`${d.sales_count} vendas confirmadas · custos e taxas já abatidos`,'trend')}${metric('Despesas da loja',money(d.expenses_cents),'Fixas e variáveis da competência, pagas ou não','money')}${metric(negative?'Prejuízo do mês':'Resultado após despesas',money(d.result_cents),negative?'Não há lucro para distribuir':'Base para a divisão do lucro','trend',true)}${metric('Lucro reservado à loja',money(d.reserve_cents),`${percent(d.reserve_basis_points)} do resultado positivo`,'box')}</div>`+
      `<div class="finance-columns"><section class="panel"><div class="panel-header"><h2>Como o resultado foi calculado</h2></div><div class="panel-body"><div class="row-stat"><span>Lucro apurado das vendas</span><strong>${money(d.sales_profit_cents)}</strong></div><div class="row-stat"><span>− Despesas fixas</span><strong>${money(d.fixed_cents)}</strong></div><div class="row-stat"><span>− Despesas variáveis</span><strong>${money(d.variable_cents)}</strong></div><div class="row-stat finance-result"><span>${negative?'Prejuízo':'Resultado líquido'}</span><strong class="${negative?'negative':''}">${money(d.result_cents)}</strong></div><div class="row-stat"><span>Parcela que fica na loja</span><strong>${money(d.reserve_cents)}</strong></div><div class="row-stat"><span>Total destinado aos sócios</span><strong>${money(d.distribution_cents)}</strong></div><p class="stat-note">Primeiro é separada a reserva da loja. O restante é dividido entre os sócios, cujas participações somam 100%. Retiradas não são descontadas novamente como despesa. Confira e registre em Despesas os gastos não recuperados de pedidos cancelados, mesmo sem pagamento recebido; esses pedidos não integram o cálculo acima.</p></div></section>
      <section class="panel"><div class="panel-header"><h2>Caixa após as retiradas</h2></div><div class="panel-body">${r.closed?`<div class="row-stat"><span>Caixa livre informado no fechamento</span><strong>${d.cash_available_cents==null?'Não informado':money(d.cash_available_cents)}</strong></div><div class="row-stat"><span>Retiradas já registradas</span><strong>${money(r.withdrawn_cents)}</strong></div><div class="row-stat"><span>Ainda a retirar pelos sócios</span><strong>${money(r.remaining_withdrawals_cents)}</strong></div><div class="row-stat finance-result"><span>Após todas as retiradas previstas</span><strong>${r.cash_after_planned_cents==null?'A conferir':money(r.cash_after_planned_cents)}</strong></div>`:`<p class="finance-explainer">Lucro não é o mesmo que dinheiro disponível. Ao fechar, você pode informar o caixa livre que conferiu, já separando o dinheiro das contas e demais obrigações.</p><div class="row-stat"><span>Retiradas planejadas</span><strong>${money(d.distribution_cents)}</strong></div><p class="stat-note">Sem esse saldo informado, mostramos a reserva do lucro, mas não inventamos um saldo bancário.</p>`}<p class="stat-note">Projeção com o saldo informado naquele momento, sem conexão bancária. Movimentações posteriores e liquidação de cartões não são acompanhadas automaticamente.</p>${!r.closed&&can('finance.manage')?`<button class="primary finance-close-button" data-action="fin-close" ${d.incomplete_sales.length||closingMonth>=today().slice(0,7)?'disabled':''}>Conferir e fechar mês</button>${closingMonth>=today().slice(0,7)?'<p class="stat-note">O mês atual é uma prévia. O fechamento será liberado quando o mês terminar.</p>':''}`:''}</div></section></div>`+
      `<section class="panel"><div class="panel-header"><div><h2>Retiradas dos sócios</h2><p>${r.closed?'Participações utilizadas neste fechamento.':'Prévia da divisão. Registre o fechamento antes de lançar retiradas.'}</p></div><span class="badge">${money(d.distribution_cents)} no total</span></div>${partnerTable(r)}</section>`+
      (r.withdrawals.length?`<section class="panel"><div class="panel-header"><h2>Histórico de retiradas</h2></div><div class="table-wrap"><table><thead><tr><th>Sócio</th><th>Data</th><th class="num">Valor</th><th>Observação</th></tr></thead><tbody>${r.withdrawals.map(w=>`<tr><td>${esc(d.partners.find(p=>p.id===w.partner_id)?.name??'Sócio')}</td><td>${dateLabel(w.paid_date)}</td><td class="num">${money(w.amount_cents)}</td><td>${esc(w.notes||'—')}</td></tr>`).join('')}</tbody></table></div></section>`:'')+
      `<section class="panel"><div class="panel-header"><h2>Meses fechados</h2></div><div class="panel-body closure-history">${r.history.length?r.history.map(c=>button('history',esc(monthLabel(c.reference_month)),c.reference_month)).join(''):'<p class="muted">Os fechamentos registrados aparecerão aqui.</p>'}</div></section>`);
  }
  function openExpense(key='') {
    const e=key?findExpense(key):null;
    if(key&&!e)throw Error('Atualize a lista de despesas.');
    modalDirty=false;
    const defaultMonth=listFilters[expenseSection]?.month||expenseMonth,selectedKind=e?.kind||expenseSection||'fixed';
    if(selectedKind==='variable'){
      const expenseDate=e?.expense_date||e?.paid_date||e?.due_date||today();
      showModal(e?'Editar despesa variável':'Lançar despesa variável',`<div class="variable-expense-intro"><span class="badge good">Gasto já pago</span><p>Registre aqui um gasto que já foi pago.</p></div><div class="variable-expense-fields">${field('Data',expenseDateInput('expense_date',expenseDate,`required min="2000-01-01" max="${today()}"`))}${field('Descrição (opcional)',input('description',e?.description??'','maxlength="200" placeholder="Ex.: material de limpeza"'))}${field('Valor (R$)',input('amount',e?value(e.amount_cents):'','required inputmode="decimal" placeholder="0,00" autocomplete="off"'),true)}${classificationFields('variable',e?.category_id??'',e?.category??'',e?.subcategory_id??'',true)}${field('Favorecido (opcional)',input('payee',e?.payee??'','maxlength="150" placeholder="Ex.: nome da loja"'))}${field('Observação (opcional)',`<textarea name="notes" rows="2" maxlength="2000" placeholder="Detalhes úteis deste gasto">${esc(e?.notes??'')}</textarea>`)}</div>`, 'fin-expense-form',`data-id="${e?.id??''}" data-version="${e?.version??0}" data-request-id="${crypto.randomUUID()}" data-kind="variable"`);
      modal.classList?.add('variable-expense-modal');
      modal.querySelector('[type="submit"]').textContent=e?'Salvar alteração':'Salvar despesa paga';
      return;
    }
    showModal(e?'Editar despesa fixa':'Nova despesa fixa',`<div class="fields">${field('Descrição',input('description',e?.description??'','required maxlength="200" placeholder="Ex.: aluguel da loja"'),true)}${field('Valor (R$)',input('amount',e?value(e.amount_cents):'','required inputmode="decimal" placeholder="0,00"'))}${field('Mês de referência',input('reference_month',e?.reference_month??(listFilters[expenseSection]?.month||expenseMonth),'type="month" min="2000-01" max="2199-12" required'))}${field('Vencimento',input('due_date',e?.due_date??`${defaultMonth}-${String(Math.min(Number(today().slice(8)),new Date(Number(defaultMonth.slice(0,4)),Number(defaultMonth.slice(5)),0).getDate())).padStart(2,'0')}`,'type="date" required min="2000-01-01" max="2199-12-31"'))}${classificationFields('fixed',e?.category_id??'',e?.category??'',e?.subcategory_id??'')}${field('Favorecido / fornecedor (opcional)',input('payee',e?.payee??'','maxlength="150"'))}${field('Lembrar quantos dias antes?',input('reminder_days',e?.reminder_days??3,'type="number" min="0" max="30" required'))}${e?'':field('Repetir mensalmente',`<select name="repeat_count">${[[1,'Não repetir'],[3,'Por 3 meses'],[6,'Por 6 meses'],[12,'Por 12 meses'],[24,'Por 24 meses']].map(([n,l])=>option(String(n),l,'1')).join('')}</select>`)}${field('Observações (opcional)',`<textarea name="notes" rows="3" maxlength="2000">${esc(e?.notes??'')}</textarea>`,true)}</div><p class="footer-note">O mês de referência define quando a despesa entra no resultado. O vencimento é a data limite para pagar. Repetir gera uma conta por mês, sem pagar automaticamente. Cada ocorrência pode ser editada separadamente.</p>`, 'fin-expense-form',`data-id="${e?.id??''}" data-version="${e?.version??0}" data-request-id="${crypto.randomUUID()}" data-kind="fixed"`);
  }
  function findExpense(key) { return expenseData?.rows.find(e=>e.id===key)??expenseAllData?.rows.find(e=>e.id===key)??expenseData?.reminders.items.find(e=>e.id===key); }
  function bulkRow(expenseDate=today()) {
    return `<fieldset class="expense-bulk-row" data-bulk-row><legend>Despesa <span data-bulk-number></span></legend><div class="variable-bulk-required">${field('Data',expenseDateInput('bulk_expense_date',expenseDate,`required min="2000-01-01" max="${today()}"`))}${field('Valor (R$)',input('bulk_amount','','required inputmode="decimal" placeholder="0,00" autocomplete="off"'))}${button('bulk-remove',icon('x'),'','small subtle danger')}${classificationFields('bulk','','','',true)}</div><details class="bulk-extra"><summary>Adicionar descrição, favorecido ou observação</summary><div class="variable-bulk-optional">${field('Descrição (opcional)',input('bulk_description','','maxlength="200" placeholder="Ex.: material de limpeza"'))}${field('Favorecido (opcional)',input('bulk_payee','','maxlength="150"'))}${field('Observação (opcional)',`<textarea name="bulk_notes" rows="2" maxlength="2000"></textarea>`,true)}</div></details></fieldset>`;
  }
  function updateBulkSummary() {
    const rows=[...modal.querySelectorAll('[data-bulk-row]')];
    rows.forEach((row,i)=>{row.querySelector('[data-bulk-number]').textContent=String(i+1);const remove=row.querySelector('[data-action="fin-bulk-remove"]');remove.disabled=rows.length===1;remove.setAttribute('aria-label',`Remover despesa ${i+1}`);});
    modal.querySelector('[data-action="fin-bulk-add"]').disabled=rows.length>=50;
    const summary=modal.querySelector('#expense-bulk-summary');
    try {const total=rows.reduce((s,row)=>s+cents(row.querySelector('[name="bulk_amount"]').value),0);summary.textContent=`${rows.length} despesa(s) · Total: ${money(total)}`;}catch{summary.textContent=`${rows.length} despesa(s) · Confira os valores digitados.`;}
  }
  function openBulk() {
    modalDirty=false;
    showModal('Cadastrar várias despesas variáveis',`<div class="variable-expense-intro"><span class="badge good">Gastos já pagos</span><p>Informe a data, o valor, a categoria e a subcategoria de cada gasto.</p></div><div id="expense-bulk-rows">${bulkRow()}</div><div class="bulk-footer">${button('bulk-add',`${icon('plus')} Adicionar despesa`)}<strong id="expense-bulk-summary" role="status" aria-live="polite"></strong></div><p class="footer-note">Até 50 lançamentos por cadastro. Todos serão registrados como pagos. Se uma linha estiver incorreta, nenhuma será salva.</p>`,'fin-bulk-form',`data-request-id="${crypto.randomUUID()}" data-default-date="${today()}"`);
    modal.classList.add('expense-bulk-modal');
    modal.querySelector('[type="submit"]').textContent='Salvar todas as despesas';
    updateBulkSummary();
  }
  function openState(action,key) {
    const e=findExpense(key);if(!e)throw Error('Atualize a lista de despesas.');
    modalDirty=false;
    const title={pay:'Registrar pagamento',reopen:'Estornar registro do pagamento',cancel:'Cancelar despesa'}[action];
    const expenseLabel=e.description?.trim()||e.subcategory?.trim()||e.category?.trim()||e.payee?.trim()||'Despesa variável';
    showModal(title,`<div class="finance-modal-summary"><strong>${esc(expenseLabel)}</strong><span>${money(e.amount_cents)}</span></div>${action==='pay'?field('Data do pagamento',input('paid_date',today(),`type="date" required max="${today()}"`)):''}${field(action==='pay'?'Conta utilizada / observação (opcional)':'Motivo obrigatório',`<textarea name="notes" rows="3" maxlength="1000" ${action==='pay'?'':'required'}></textarea>`)}<p class="footer-note">${action==='pay'?'Confirme somente se esta conta já foi paga. Este botão não transfere dinheiro.':action==='reopen'?'Remove a marcação de pago e devolve a conta aos lembretes.':'O registro será preservado no histórico como cancelado e deixará de abater o resultado.'}</p>`, 'fin-expense-state',`data-id="${key}" data-version="${e.version}" data-operation="${action}"`);
    modal.querySelector('[type="submit"]').textContent=action==='pay'?'Confirmar pagamento':action==='reopen'?'Estornar registro':'Cancelar despesa';
  }
  function partnerRow(p={id:crypto.randomUUID(),name:'',basis_points:null}) {
    return `<div class="finance-partner-row" data-partner-row data-id="${esc(p.id)}">${field('Nome do sócio',input('partner_name',p.name,'required maxlength="100"'))}${field('Participação (%)',input('partner_percentage',p.basis_points==null?'':value(p.basis_points),'required inputmode="decimal" placeholder="0,00"'))}${button('remove-partner',`${icon('x')} Remover`,'','small subtle danger')}</div>`;
  }
  function openPartners() {
    modalDirty=false;
    const s=report.settings;
    showModal('Sócios e divisão do lucro',`${field('Percentual do lucro que fica na loja (%)',input('reserve',value(s.reserve_basis_points),'required inputmode="decimal"'))}<p class="finance-explainer">O restante será dividido entre os sócios abaixo. A soma das participações deve ser 100%. Sem sócios, ajuste a reserva acima para 100%, mantendo todo o lucro na loja.</p><div id="finance-partners">${s.partners.map(partnerRow).join('')}</div>${button('add-partner',`${icon('plus')} Adicionar sócio`)}<p class="footer-note">Esses percentuais são definidos por você. Alterações afetam somente prévias e novos fechamentos; não mudam retiradas de meses já fechados.</p>`,'fin-settings-form',`data-version="${s.version}"`);
  }
  function openClose() {
    modalDirty=false;
    const d=report.result;
    showModal('Conferir fechamento',`${refundReserveFields(report.refunds_pending,esc,money)}<div class="finance-modal-summary"><strong>${esc(monthLabel(closingMonth))}</strong><span>${money(d.result_cents)}</span></div><div class="row-stat"><span>Lucro reservado à loja</span><strong>${money(d.reserve_cents)}</strong></div><div class="row-stat"><span>Total destinado aos sócios</span><strong>${money(d.distribution_cents)}</strong></div>${field('Caixa livre conferido por você (R$, opcional)',input('cash','','inputmode="decimal" placeholder="Deixe vazio se não conferiu o saldo" aria-describedby="finance-cash-preview"'))}<p class="finance-explainer">Informe somente o dinheiro disponível depois de separar contas, obrigações e outros valores que não podem ser retirados. Não preencha com o faturamento.</p><div id="finance-cash-preview" class="alert good" role="status" aria-live="polite">Sem saldo informado, o caixa após retiradas ficará como “A conferir”.</div><label class="finance-confirm"><input type="checkbox" name="acknowledge" required> Conferi as vendas, despesas e participações. Sei que o fechamento preservará esses valores e não poderá ser reaberto nesta versão.</label><p class="footer-note">${closingMonth===today().slice(0,7)?'Este mês ainda está em andamento. Vendas posteriores serão sinalizadas como diferença, sem alterar o fechamento. ':''}Fechar não paga despesas nem transfere dinheiro aos sócios.</p>`,'fin-close-form');
    modal.querySelector('[type="submit"]').textContent='Registrar fechamento';
  }
  function openWithdrawal(key) {
    modalDirty=false;
    const p=report.result.partners.find(p=>p.id===key),paid=report.withdrawals.filter(w=>w.partner_id===key).reduce((s,w)=>s+w.amount_cents,0);
    showModal('Registrar retirada do sócio',`${refundReserveFields(report.refunds_pending,esc,money)}<div class="finance-modal-summary"><strong>${esc(p.name)}</strong><span>${money(p.amount_cents-paid)} a retirar</span></div><div class="fields">${field('Valor retirado (R$)',input('amount',value(p.amount_cents-paid),'required inputmode="decimal"'))}${field('Data da retirada',input('paid_date',today(),`type="date" required max="${today()}"`))}${field('Observação (opcional)',`<textarea name="notes" rows="2" maxlength="1000"></textarea>`,true)}</div><p class="footer-note">Registre somente um valor que já foi entregue ao sócio. Não há transferência bancária. Nesta versão, uma retirada registrada não pode ser estornada pela interface.</p>`,'fin-withdrawal-form',`data-id="${key}" data-request-id="${crypto.randomUUID()}"`);
  }
  return {
    reset(){loadGeneration++;userIdentity=null;expenseData=expenseAllData=report=null;modalDirty=false;},
    async load(selection={}) {
      const nextIdentity=currentIdentity();if(userIdentity!==nextIdentity){userIdentity=nextIdentity;expenseMonth=closingMonth=today().slice(0,7);expenseSection='';dashboardAll=false;expenseData=expenseAllData=report=null;for(const f of Object.values(listFilters))Object.assign(f,{month:'',status:'',search:'',category:''});}
      const requestedExpenseMonth=selection.expenseMonth??expenseMonth,requestedClosingMonth=selection.closingMonth??closingMonth;
      const generation=++loadGeneration;
      const [expenses,closing,all]=await Promise.all([can('expenses.view')?api(`/expenses?month=${requestedExpenseMonth}`):null,can('finance.view')?api(`/finance?month=${requestedClosingMonth}`):null,can('expenses.view')?api('/expenses?month=all'):null]);
      if(generation!==loadGeneration||currentIdentity()!==nextIdentity)return false;
      expenseMonth=requestedExpenseMonth;closingMonth=requestedClosingMonth;expenseData=expenses;report=closing;expenseAllData=all;return true;
    },expensesPage,closingPage,remindersPanel,
    afterAction(){if(modal.querySelector('#fin-bulk-form'))updateBulkSummary();},
    async action(action,key,element) {
      if(action==='fin-new')openExpense();
      if(action==='fin-subcategory-new')openSubcategory('',key);
      if(action==='fin-subcategory-edit')openSubcategory(key);
      if(action==='fin-category-new')openCategory();
      if(action==='fin-category-edit')openCategory(key);
      if(action==='fin-bulk')openBulk();
      if(action==='fin-bulk-add'){const form=modal.querySelector('#fin-bulk-form');if(form.querySelectorAll('[data-bulk-row]').length>=50)return;modal.querySelector('#expense-bulk-rows').insertAdjacentHTML('beforeend',bulkRow(form.dataset.defaultDate));modalDirty=true;updateBulkSummary();modal.querySelector('#expense-bulk-rows').lastElementChild.querySelector('input').focus();}
      if(action==='fin-bulk-remove'){if(modal.querySelectorAll('[data-bulk-row]').length<=1)return;const row=element.closest('[data-bulk-row]'),next=row.nextElementSibling??row.previousElementSibling;row.remove();modalDirty=true;updateBulkSummary();next?.querySelector('input')?.focus();}
      if(action==='fin-dashboard-all'){if(!await this.load())return;dashboardAll=true;expensesPage('');}
      if(action==='fin-dashboard-month'){if(!await this.load({expenseMonth:key}))return;dashboardAll=false;expensesPage('');}
      if(action==='fin-drill-type'){Object.assign(listFilters[key],{month:dashboardAll?'':expenseMonth,status:'',search:'',category:''});return {view:`expenses-${key}`};}
      if(action==='fin-all-months'){if(!await this.load())return;listFilters[expenseSection].month='';expensesPage();}
      if(action==='fin-list-clear'){Object.assign(listFilters[expenseSection],{month:'',status:'',search:'',category:''});expensesPage();}
      if(action==='fin-edit')openExpense(key);
      if(['fin-pay','fin-reopen','fin-cancel'].includes(action))openState(action.slice(4),key);
      if(action==='fin-partners')openPartners();
      if(action==='fin-add-partner'){modal.querySelector('#finance-partners').insertAdjacentHTML('beforeend',partnerRow());modal.querySelector('#finance-partners').lastElementChild.querySelector('input').focus();modalDirty=true;}
      if(action==='fin-remove-partner'){const row=element.closest('[data-partner-row]'),next=row.nextElementSibling??row.previousElementSibling;row.remove();modalDirty=true;(next?.querySelector('input')??modal.querySelector('[data-action="fin-add-partner"]'))?.focus();}
      if(action==='fin-discard'){modalDirty=false;modal.close();}
      if(action==='fin-keep'){modal.querySelector('#finance-discard').remove();modal.querySelector('input:not([type="hidden"]):not(:disabled),textarea:not(:disabled),button:not(:disabled)').focus();}
      if(action==='fin-close')openClose();
      if(action==='fin-withdraw')openWithdrawal(key);
      if(action==='fin-history'){if(!await this.load({closingMonth:key}))return;closingPage();}
    },
    change:refreshClassification,
    input(element) {
      if(element.form?.id.startsWith('fin-')&&modal.contains(element))modalDirty=true;
      if(element.form?.id==='fin-bulk-form')updateBulkSummary();
      if(element.form?.id==='fin-close-form'&&element.name==='cash'){
        const target=modal.querySelector('#finance-cash-preview');
        try {const remaining=element.value.trim()?cents(element.value)-report.result.distribution_cents:null;
          target.classList.toggle('bad',remaining!==null&&remaining<0);target.classList.toggle('good',remaining===null||remaining>=0);
          element.setCustomValidity(remaining!==null&&remaining<0?'Caixa insuficiente para as retiradas previstas.':'');
          if(remaining!==null&&remaining<0){element.setAttribute('aria-invalid','true');target.setAttribute('role','alert');target.setAttribute('aria-live','assertive');}
          else{element.removeAttribute('aria-invalid');target.setAttribute('role','status');target.setAttribute('aria-live','polite');}
          target.textContent=remaining===null?'Sem saldo informado, o caixa após retiradas ficará como “A conferir”.':remaining<0?`Caixa insuficiente: faltam ${money(-remaining)} para as retiradas previstas.`:`Caixa projetado após todas as retiradas: ${money(remaining)}.`;
        }catch{element.setCustomValidity('Informe um valor monetário válido.');element.setAttribute('aria-invalid','true');target.classList.add('bad');target.classList.remove('good');target.setAttribute('role','alert');target.setAttribute('aria-live','assertive');target.textContent='Informe um valor monetário válido.';}
      }
    },
    dirty:()=>modalDirty,
    resetModal(){modalDirty=false;modal.classList?.remove('expense-bulk-modal','variable-expense-modal');},
    requestClose() {
      if(!modalDirty||!modal.querySelector('form[id^="fin-"]'))return false;
      if(!modal.querySelector('#finance-discard'))modal.querySelector('form').insertAdjacentHTML('beforeend',`<div id="finance-discard" class="alert"><strong>Há alterações não salvas.</strong><p>Deseja continuar preenchendo ou descartar?</p><div class="actions">${button('keep','Continuar preenchendo')}${button('discard','Descartar alterações','','small danger')}</div></div>`);
      modal.querySelector('#finance-discard button').focus();return true;
    },
    async submit(form,d) {
      if(form.id==='fin-subcategory-form'){
        const key=form.dataset.id;await api(key?`/expense-subcategories/${key}`:'/expense-subcategories',{...d,active:d.active==='on',version:Number(form.dataset.version)},key?'PUT':'POST');return {message:'Subcategoria salva.',view:'expenses-catalogs'};
      }
      if(form.id==='fin-category-form'){
        const key=form.dataset.id;await api(key?`/expense-categories/${key}`:'/expense-categories',{name:d.name,color:d.color,applicability:d.applicability,active:d.active==='on',version:Number(form.dataset.version)},key?'PUT':'POST');
        return {message:'Categoria salva.',view:'expenses-catalogs'};
      }
      if(form.id==='fin-expense-list-period'){const month=selectedPeriod(d);if(!await this.load())return {local:true};listFilters[expenseSection].month=month;expensesPage();return {local:true};}
      if(form.id==='fin-expense-list-filter'){Object.assign(listFilters[expenseSection],{status:expenseSection==='variable'?'':d.status,search:d.search.trim(),category:d.category??''});expensesPage();return {local:true};}
      if(form.id==='fin-bulk-form') {
        const rows=[...form.querySelectorAll('[data-bulk-row]')];
        if(!rows.length||rows.length>50)throw Error('Informe de 1 a 50 despesas.');
        const expenses=rows.map((row,i)=>{
          const v=name=>dateValue(row.querySelector(`[name="bulk_${name}"]`));
          try {const expenseDate=v('expense_date'),amountText=v('amount'),categoryId=v('category_id'),subcategoryId=v('subcategory_id');if(!expenseDate||!amountText||!categoryId||!subcategoryId)throw Error('Preencha data, valor, categoria e subcategoria.');const amount=cents(amountText);if(amount<=0)throw Error('O valor deve ser maior que zero.');return {expense_date:expenseDate,description:v('description').trim(),amount_cents:amount,category_id:categoryId,subcategory_id:subcategoryId,payee:v('payee').trim(),notes:v('notes').trim(),kind:'variable'};}catch(error){throw Error(`Linha ${i+1}: ${error.message}`);}
        });
        const result=await api('/expenses/batch',{request_id:form.dataset.requestId,expenses});
        Object.assign(listFilters.variable,{month:'',status:'',search:'',category:''});
        return {message:`${result.expenses.length} despesas variáveis salvas.`,view:'expenses-variable'};
      }
      if(form.id==='fin-expenses-month'){const selected=selectedPeriod(d);if(!await this.load({expenseMonth:selected||expenseMonth}))return {local:true};dashboardAll=!selected;expensesPage('');return {local:true};}
      if(form.id==='fin-closing-month'){if(!await this.load({closingMonth:d.month}))return {local:true};closingPage();return {local:true};}
      if(form.id==='fin-expense-form') {
        const key=form.dataset.id;
        if(form.dataset.kind==='variable'){
          if(!d.expense_date||!d.category_id||!d.subcategory_id)throw Error('Preencha data, categoria e subcategoria.');
          const amount=cents(d.amount);if(amount<=0)throw Error('O valor deve ser maior que zero.');
          const result=await api(key?`/expenses/${key}`:'/expenses',{expense_date:d.expense_date,description:(d.description??'').trim(),amount_cents:amount,category_id:d.category_id,subcategory_id:d.subcategory_id,payee:(d.payee??'').trim(),notes:(d.notes??'').trim(),kind:'variable',request_id:form.dataset.requestId,version:Number(form.dataset.version)},key?'PUT':'POST');
          return {message:`${result.expenses.length} despesa(s) variável(is) salva(s).`};
        }
        const legacy=d.category_id==='legacy'?findExpense(key)?.category??'':'',result=await api(key?`/expenses/${key}`:'/expenses',{...d,kind:'fixed',category_id:d.category_id==='legacy'?null:d.category_id||null,subcategory_id:d.subcategory_id||null,category:legacy,amount_cents:cents(d.amount),reminder_days:Number(d.reminder_days),repeat_count:Number(d.repeat_count??1),request_id:form.dataset.requestId,version:Number(form.dataset.version)},key?'PUT':'POST');
        return {message:`${result.expenses.length} despesa(s) salva(s).`};
      }
      if(form.id==='fin-expense-state')await api(`/expenses/${form.dataset.id}/state`,{...d,action:form.dataset.operation,version:Number(form.dataset.version)});
      if(form.id==='fin-settings-form')await api('/finance/settings',{version:Number(form.dataset.version),reserve_basis_points:cents(d.reserve),partners:[...form.querySelectorAll('[data-partner-row]')].map(row=>({id:row.dataset.id,name:row.querySelector('[name="partner_name"]').value,basis_points:cents(row.querySelector('[name="partner_percentage"]').value)}))},'PUT');
      if(form.id==='fin-close-form'){const cash=d.cash.trim()?cents(d.cash):null;if(cash!==null&&cash<report.result.distribution_cents)throw Error('O caixa livre informado não cobre as retiradas previstas. Confira o saldo ou aumente a reserva da loja.');await api('/finance/close',{month:closingMonth,source_hash:report.result.source_hash,settings_version:report.result.settings_version,cash_available_cents:cash,refunds_token:d.refunds_token,acknowledge_refund_reserve:new FormData(form).has('acknowledge_refund_reserve')});}
      if(form.id==='fin-withdrawal-form')await api(`/finance/${report.closure_id}/withdrawals`,{partner_id:form.dataset.id,request_id:form.dataset.requestId,amount_cents:cents(d.amount),paid_date:d.paid_date,notes:d.notes,refunds_token:d.refunds_token,acknowledge_refund_reserve:new FormData(form).has('acknowledge_refund_reserve')});
      return {message:form.id==='fin-close-form'?'Fechamento registrado. Os valores foram preservados.':form.id==='fin-withdrawal-form'?'Retirada registrada.':'Registro salvo.'};
    }
  };
}
