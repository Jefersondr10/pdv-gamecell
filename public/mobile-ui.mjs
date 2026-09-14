// One set of records and controls: compact the existing DOM, never duplicate data.
const disclosure=(label,nodes,cls='compact-disclosure')=>{
 const box=document.createElement('details'),summary=document.createElement('summary');
 box.className=cls;summary.textContent=label;box.append(summary,...nodes);return box;
};
const expandedSales=new Set();
function foldPanel(panel){
 if(!panel)return;
 const header=panel.querySelector('.panel-header'),title=header?.querySelector('h2');if(!title)return;
 const details=disclosure(title.textContent.trim(),[],'compact-disclosure compact-panel');
 panel.before(details);details.append(panel);title.classList.add('compact-redundant-heading');
 if(!header.querySelector('p,.badge,button'))header.classList.add('compact-redundant-heading');
}
function compactExpenses(table){
 if(!table)return;
 const list=document.createElement('div');list.className='compact-expense-list';
 for(const row of table.tBodies[0].rows){
  const cells=[...row.cells];if(cells.length!==6)continue;
  const card=document.createElement('article');card.className='compact-expense';
  const top=document.createElement('div');top.className='compact-record-top';
  const name=cells[0].querySelector('strong');top.append(name,...cells[3].childNodes);
  const meta=document.createElement('div');meta.className='compact-record-meta';
  const due=document.createElement('span');due.textContent='Vence '+cells[2].firstChild.textContent;
  cells[2].firstChild.remove();meta.append(...cells[4].childNodes,due);
  const actions=document.createElement('div');actions.className='compact-record-actions';
  const pay=cells[5].querySelector('[data-action="fin-pay"]');if(pay)actions.append(pay);
  const more=document.createElement('div');more.className='compact-record-more';
  for(const n of [0,1,2,5]){const part=document.createElement('div');part.append(...cells[n].childNodes);more.append(part);}
  actions.append(disclosure('Detalhes e ações',[more]));card.append(top,meta,actions);list.append(card);
 }
 table.closest('.table-wrap').replaceWith(list);
}
let mobileFiltersExpanded=null;
export function rememberMobileFilterState(root){
 const details=root.querySelector('#filter-form .compact-filters');
 if(details)mobileFiltersExpanded=details.open;
}
export function compactMobilePage(root,view){
 if(!window.matchMedia('(max-width: 700px)').matches)return;
 root.classList.add('compact-page');
 if(view==='calculator'||view==='editor')return;
 const heading=root.querySelector('.page-heading p');if(heading)heading.classList.add('compact-redundant-heading');
 const grid=root.querySelector('.metric-grid');
 if(grid){
  const notes=[];
  for(const metric of grid.querySelectorAll('.metric')){
   const note=metric.querySelector('.metric-foot'),label=metric.querySelector('.metric-label');
   if(note){const p=document.createElement('p');p.textContent=label.textContent.trim()+': '+note.textContent;notes.push(p);note.remove();}
  }
  grid.after(disclosure('Entender os valores',notes,'compact-disclosure metric-explanations'));
 }
 const filters=root.querySelector('#filter-form');
 if(filters){
  const fields=[...filters.children].filter(el=>el.matches('.field')&&el.querySelector('select:not([name="date_preset"]):not([name="sale_type"])'));
  const count=fields.filter(el=>el.querySelector('select').value).length;
  const extras=document.createElement('div');extras.className='compact-filter-fields';extras.append(...fields);
  const clear=filters.querySelector('[data-action="clear-filters"]');extras.append(clear);
  const more=disclosure(`Mais filtros${count?' · '+count+' ativo(s)':''}`,[extras],'compact-disclosure compact-filters');
  more.open=mobileFiltersExpanded??count>0;
  filters.append(more);
  const submit=filters.querySelector('[type="submit"]');if(submit)submit.textContent='Buscar';
 }
 if(view==='sales')for(const record of root.querySelectorAll('.sale-record')){
  // New compact sales are already the final mobile representation. The legacy
  // table reflow below is kept only for any older record markup still rendered.
  if(record.matches('.sale-record-compact'))continue;
  const table=record.querySelector('.table-wrap');if(!table)continue;
  const count=[...table.querySelectorAll('tbody tr')].filter(row=>!row.querySelector('td[colspan]')).length;
  const more=disclosure(`${count} ${count===1?'item':'itens'} · Ver produtos e valores`,[table],'compact-disclosure sale-items-disclosure');
  const key=record.querySelector('[data-action="open-sale"]')?.dataset.id;more.open=expandedSales.has(key);more.addEventListener('toggle',()=>{if(more.open)expandedSales.add(key);else expandedSales.delete(key);});
  record.querySelector('.sale-record-footer').before(more);
  const status=record.querySelector('.status-control');if(status){const select=status.querySelector('select');if(select?.value){const badge=document.createElement('span');badge.className='operational-badge';badge.textContent=select.selectedOptions[0].textContent;for(const prop of ['--status-color','--status-bg','--status-text'])badge.style.setProperty(prop,select.style.getPropertyValue(prop));status.before(badge);}more.append(status);}
  const note=record.querySelector('.sale-record-note');if(note)more.append(note);
  for(const p of record.querySelectorAll('.provisional-profit small'))p.textContent='Estimado';
  if(record.querySelector('.provisional-profit')){const hint=document.createElement('p');hint.textContent='Lucro estimado: o pagamento ainda precisa ser conferido. Esse valor não entra no lucro apurado.';more.append(hint);}
 }
 if(view==='stock'){
  const alert=root.querySelector(':scope > .alert');if(alert){const box=disclosure('Sobre saldo e custo',[]);alert.before(box);box.append(alert);}
  root.querySelector('.product-table')?.classList.add('compact-stock-table');
  foldPanel(root.querySelector('.stock-entries-table')?.closest('.panel'));
 }
 if(view.startsWith('expenses')){
  compactExpenses(root.querySelector('.expense-table'));
  const search=root.querySelector('.finance-search');
  if(search){const fields=[...search.children].filter(n=>!n.matches('input[type="search"],button[type="submit"]'));const active=[...search.querySelectorAll('select')].filter(n=>n.value).length;search.append(disclosure(`Mais filtros${active?' · '+active+' ativo(s)':''}`,fields,'compact-disclosure compact-search-details'));}
  if(view==='expenses'){
   for(const details of root.querySelectorAll('.expense-type-details'))details.remove(); // Per-type values remain in Ver contas.
   const categories=root.querySelector('.expense-category-table');
   if(categories){
    const chart=document.createElement('div');chart.className='expense-category-chart';
    for(const row of categories.tBodies[0].rows){const cells=[...row.cells],part=document.createElement('div'),line=document.createElement('div'),meta=document.createElement('span'),bar=document.createElement('meter');
     part.className='expense-category-bar';line.className='compact-record-top';line.append(...cells[0].childNodes,...cells[2].childNodes);
     meta.textContent=cells[1].textContent+' contas · '+cells[3].textContent;bar.min=0;bar.max=100;bar.value=Number(cells[3].textContent.replace('%','').replace(',','.'));bar.setAttribute('aria-label','Participação de '+line.firstChild.textContent);part.append(line,bar,meta);chart.append(part);
    }categories.closest('.table-wrap').replaceWith(chart);
   }
   foldPanel(root.querySelector('.expense-status-row')?.closest('.panel'));
   foldPanel(root.querySelector('.expense-history-table')?.closest('.panel'));
  }
 }
 if(view==='closing'){
  foldPanel(root.querySelector('.finance-columns > .panel:first-child'));
  foldPanel(root.querySelector('.closure-history')?.closest('.panel'));
  const cash=root.querySelector('.finance-columns > .panel'),close=cash?.querySelector('.finance-close-button'),notes=cash?[...cash.querySelectorAll('.finance-explainer,.stat-note')].filter(n=>n!==close?.nextElementSibling):[];
  if(notes.length){const body=cash.querySelector('.panel-body');if(cash.querySelector('.finance-explainer')){const hint=document.createElement('p');hint.className='cash-status';hint.textContent='Caixa livre: a informar no fechamento.';body.prepend(hint);}const box=disclosure('Sobre o caixa',[]);body.append(box);box.append(...notes);}
 }
 for(const text of root.querySelectorAll('.period-help,.finance-footnote')){
  const box=disclosure('Como funciona',[]);text.before(box);box.append(text);
 }
}
import { dateValue } from './date-control.mjs';
import { closeSelectControls } from './select-control.mjs';
const mobile=()=>window.matchMedia('(max-width: 700px)').matches;
const el=(tag,cls,text)=>{const node=document.createElement(tag);if(cls)node.className=cls;if(text)node.textContent=text;return node;};
const focusField=field=>{const trigger=field.closest('.select-control')?.querySelector('.select-trigger');(trigger??field).focus({preventScroll:true});};
export function validateSaleStep(key,w,cents){
 if(key==='people'&&(!w.customer_id||!w.seller_id))throw Error('Selecione cliente e vendedor. Para salvar incompleto, use Ir ao resumo → Salvar rascunho.');
 if(key==='products'&&!w.items.length)throw Error('Adicione um produto. Um rascunho vazio pode ser salvo em Ir ao resumo.');
 if(key.startsWith('item-')&&!key.startsWith('item-details-')){
  const i=w.items[Number(key.slice(5))];
  if(!i.product_id&&!i.description.trim())throw Error('Informe o nome do produto.');
  if(!Number.isInteger(Number(i.quantity))||Number(i.quantity)<1)throw Error('Informe uma quantidade inteira maior que zero.');
  if(cents(i.price)<0)throw Error('O preço não pode ser negativo.');
  if(i.cost?.trim())cents(i.cost);
 }
 if(key.startsWith('payment-')){
  const p=w.payments[Number(key.slice(8))];if(cents(p.amount)<=0)throw Error('Informe o valor pago ou remova este pagamento.');
  if(p.method==='pix'&&!p.pix_account_id&&!(p.saved&&p.original_method==='pix'))throw Error('Selecione uma conta Pix.');
  if(p.method==='card'&&!p.rate_id&&!p.keep_card_rate&&!p.saved)throw Error('Selecione máquina, bandeira, modalidade e parcelas.');
 }
 if(key.startsWith('expense-')){const e=w.expenses[Number(key.slice(8))];if(!e.description.trim()||cents(e.amount)<=0)throw Error('Informe descrição e valor ou remova esta despesa.');}
}
function setup(root,steps,state,validate=()=>{},onStep=()=>{}){
 root.classList.add('mobile-flow');
 const header=el('div','flow-heading'),title=el('h2'),progress=el('span','flow-progress');title.tabIndex=-1;
 const bar=el('progress');bar.max=steps.length;bar.setAttribute('aria-label','Progresso das etapas');header.append(progress,title,bar);root.prepend(header);
 const error=el('p','error');error.setAttribute('role','alert');
 const footer=el('div','flow-navigation');
 const back=el('button','','Voltar'),skip=el('button','subtle','Pular'),next=el('button','primary','Continuar');
 for(const b of [back,skip,next])b.type='button';footer.append(back,skip,next);root.append(error,footer);
 let index=Math.max(0,steps.findIndex(s=>s.key===state.step));
 function show(nextIndex,focus=true){
  closeSelectControls();index=Math.max(0,Math.min(nextIndex,steps.length-1));state.step=steps[index].key;
  for(const [n,s]of steps.entries()){s.node.classList.add('flow-step');s.node.dataset.active=String(n===index);}
  title.textContent=steps[index].title;progress.textContent=`Etapa ${index+1} de ${steps.length}${steps[index].optional?' · Opcional':''}`;bar.value=index+1;
  back.hidden=index===0;skip.hidden=!steps[index].optional;next.hidden=index===steps.length-1;
  onStep(steps[index].key);
  error.textContent='';if(focus){title.focus({preventScroll:true});root.closest('dialog')?.scrollTo(0,0);if(!root.closest('dialog'))window.scrollTo(0,0);}
 }
 function check(s){
  try{
   for(const input of s.node.querySelectorAll('input,select,textarea')){
    if(input.matches(':disabled'))continue;
    input.setCustomValidity('');if(input.dataset.dateKind){try{dateValue(input);}catch(err){input.setCustomValidity(err.message);}}
    if(!input.checkValidity()){focusField(input);throw Error(input.validationMessage);}
   }
   validate(s);return true;
  }catch(err){const target=steps.indexOf(s);if(index!==target)show(target);error.textContent=err.message;return false;}
 }
 back.addEventListener('click',()=>show(index-1));
 next.addEventListener('click',()=>{if(check(steps[index]))show(index+1);});
 // Skipping only changes the current step; never clears values or writes records.
 skip.addEventListener('click',()=>{if(check(steps[index]))show(index+1);});
 root.addEventListener('input',()=>{error.textContent='';});
 root.addEventListener('invalid',event=>{
  if(!mobile())return;const target=steps.findIndex(s=>s.node.contains(event.target));
  if(target>=0){event.preventDefault();show(target);error.textContent=event.target.validationMessage;focusField(event.target);}
 },true);
 show(index,false);
 return {show,check,steps,get index(){return index;}};
}
export function syncSaleMobileHeader(root,key){
 const cancelButton=root?.ownerDocument?.querySelector('.sale-editor-heading-actions [data-action="cancel-sale"]');
 if(cancelButton)cancelButton.hidden=key!=='people';
}
export function saleMobileSteps(root,w,{cents}){
 if(!root||!mobile())return;
 const panels=[...root.firstElementChild.children],summary=root.querySelector('.summary'),steps=[];
 const add=(key,title,node,optional=false)=>{root.append(node);steps.push({key,title,node,optional});};
 const people=panels.shift();add('people','Dados da venda',people);
 const products=panels.shift(),addItem=products.querySelector('[data-action="add-item"]');
 const items=[...products.querySelectorAll('.sale-item')];
 if(!items.length)add('products','Adicionar produto',products);
 for(const [n,item]of items.entries()){
  const basic=el('section','panel flow-item'),body=el('div','panel-body');basic.append(body);
  // Keep the complete product together. Identification, optional details and
  // entry-cost corrections belong to this product, not to a second step.
  body.append(item);add('item-'+n,`Produto ${n+1} de ${items.length}`,basic);
  body.append(n===items.length-1?addItem:addItem.cloneNode(true));
 }
 const payments=panels.shift(),rows=[...payments.querySelectorAll('.editable-payment')],addPayment=payments.querySelector('[data-action="add-payment"]'),alert=payments.querySelector('#payment-alert');
 if(!rows.length)add('payments','Pagamentos',payments,true);
 for(const [n,row]of rows.entries()){
  const panel=el('section','panel'),body=el('div','panel-body');panel.append(body);body.append(row);
  if(n===rows.length-1){body.append(alert);if(addPayment)body.append(addPayment);}
  add('payment-'+n,`Pagamento ${n+1} de ${rows.length}`,panel);
 }
 for(const panel of panels){
  const note=panel.querySelector('[data-bind="public_notes"]'),rows=[...panel.querySelectorAll('.expense-row')],addExpense=panel.querySelector('[data-action="add-expense"]');
  for(const row of rows)row.remove();
  add(note?'notes':'expenses',note?'Observação para o cliente':'Frete e despesas',panel,true);
  rows.forEach((row,n)=>{const part=el('section','panel'),body=el('div','panel-body');body.append(row);part.append(body);add('expense-'+n,`Despesa da venda ${n+1}`,part);});
  addExpense?.addEventListener('click',()=>{w.step='expense-'+w.expenses.length;});
 }
 const reason=summary.querySelector('[data-bind="reason"]');
 if(reason){reason.required=true;const panel=el('section','panel'),body=el('div','panel-body');body.append(reason.closest('.field'));panel.append(body);add('reason','Motivo da alteração',panel);}
 // Detailed accounting guidance stays available without stretching the review step.
 const notes=[...summary.querySelectorAll('.footer-note,.stat-note')].filter(n=>!n.hidden);
 if(notes.length){const info=disclosure('Antes de salvar',[]);summary.querySelector('.panel-body').append(info);info.append(...notes);}
 add('summary','Conferir e salvar',summary);
 // Remove emptied desktop containers; all original inputs remain in the steps above.
 root.firstElementChild.remove();
 // Customer actions stay beside the customer field on the first step. Moving
 // them into the shared heading made them look like duplicated product actions.
 const flow=setup(root,steps,w,step=>validateSaleStep(step.key,w,cents),key=>syncSaleMobileHeader(root,key));
 for(const button of summary.querySelectorAll('[data-action="save-draft"],[data-action="confirm-draft"],[data-action="save-correction"]'))button.addEventListener('click',event=>{
  const draft=button.dataset.action==='save-draft';
  for(const step of steps){if(step.key==='summary'||draft&&['people','products'].includes(step.key))continue;if(!flow.check(step)){event.stopPropagation();return;}}
 });
 // Review is always available so an intentionally incomplete draft can still be saved.
 const review=el('button','small flow-review','Ir ao resumo');review.type='button';review.addEventListener('click',()=>flow.show(steps.length-1));root.querySelector('.flow-heading').append(review);
 root.querySelectorAll('[data-action="add-item"],[data-action="add-payment"]').forEach(button=>button.addEventListener('click',()=>{w.step=button.dataset.action==='add-item'?'item-'+w.items.length:'payment-'+w.payments.length;}));
 root.querySelectorAll('[data-action="remove-item"],[data-action="remove-payment"]').forEach(button=>button.addEventListener('click',()=>{const item=button.dataset.action==='remove-item',rows=item?w.items:w.payments,remaining=rows.length-1;w.step=remaining?(item?'item-':'payment-')+Math.min(Number(button.dataset.index),remaining-1):(item?'products':'payments');}));
 root.querySelectorAll('[data-action="remove-expense"]').forEach(button=>button.addEventListener('click',()=>{const count=w.expenses.length-1;w.step=count?'expense-'+Math.min(Number(button.dataset.index),count-1):'expenses';}));
}
export function stockMobileSteps(form){
 if(!form||!mobile())return;
 const steps=[],add=(key,title,nodes,optional=false)=>{const node=el('section','flow-entry-fields');node.append(...nodes.filter(Boolean));form.append(node);steps.push({key,title,node,optional});};
 const mode=form.querySelector('[name="product_mode"]')?.closest('.fields'),existing=form.querySelector('[data-entry-existing]'),fresh=form.querySelector('[data-entry-new]');
 const qty=form.querySelector('[name="quantity"]')?.closest('.field'),cost=form.querySelector('[name="cost"]')?.closest('.field'),day=form.querySelector('[name="received_date"]')?.closest('.field'),supplier=form.querySelector('[name="supplier_id"]')?.closest('.field'),reason=form.querySelector('[name="reason"]')?.closest('.field');
 const notes=[...form.querySelectorAll(':scope > .footer-note')],actions=form.querySelector(':scope > .actions');
 add('product','Produto',[mode,existing,fresh]);add('entry','Quantidade, custo e aparelhos',[qty,cost,day,form.querySelector('[data-entry-serials]')]);add('supplier','Fornecedor',[supplier],true);
 const review=el('div','flow-entry-review');add('review','Conferir entrada',[review,reason,...notes,actions]);
 const flow=setup(form,steps,{});
 form.noValidate=true;
 const media=window.matchMedia('(max-width: 700px)'),resize=()=>{if(!form.isConnected){media.removeEventListener('change',resize);return;}form.noValidate=media.matches;};media.addEventListener('change',resize);
 form.closest('dialog')?.addEventListener('close',()=>media.removeEventListener('change',resize),{once:true});
 form.addEventListener('submit',event=>{
  if(!mobile())return;
  if(flow.index<steps.length-1){event.preventDefault();event.stopPropagation();if(flow.check(steps[flow.index]))flow.show(flow.index+1);return;}
  for(const step of steps)if(!flow.check(step)){event.preventDefault();event.stopPropagation();return;}
 });
 form.addEventListener('input',()=>updateReview());form.addEventListener('change',()=>updateReview());
 function updateReview(){
  review.replaceChildren();const data=new FormData(form),newProduct=data.get('product_mode')==='new',product=form.querySelector('[name="product_id"]');
  const serials=form.querySelector('[data-entry-serials]'),rows=serials&&!serials.disabled?[...serials.querySelectorAll('[data-entry-unit]')]:[],costLabel=rows.length&&!form.dataset.id?'Custos por aparelho':'Custo por unidade';
  const costValue=rows.length&&!form.dataset.id?rows.map(row=>row.querySelector('[data-entry-serial]').value+' · R$ '+(row.querySelector('[data-unit-cost]').value||'A informar')).join('\n'):data.get('cost')||'Manter custo atual';
  const values=[['Produto',newProduct?data.get('product_name'):product?.selectedOptions[0]?.textContent],['Quantidade',data.get('quantity')],[costLabel,costValue],['Data',data.get('received_date')],['Fornecedor',form.querySelector('[name="supplier_id"]')?.selectedOptions[0]?.textContent]];
  for(const [label,value]of values){const row=el('div','row-stat');row.append(el('span','',label),el('strong','',String(value??'')));review.append(row);}
 }
 // Native final validation opens the owning step through the invalid listener.
 updateReview();return flow;
}
// Reflow the existing, permission-filtered records; never create a second data copy.
export function enhanceMobileTables(scope) {
  for (const table of scope.querySelectorAll('.table-wrap table')) {
    const headings = [...(table.tHead?.rows[0]?.cells ?? [])];
    if (!headings.length || headings.some(cell => cell.colSpan > 1)) continue;
    table.classList.add('mobile-records'); table.setAttribute('role', 'table');
    table.tHead.setAttribute('role', 'rowgroup');
    table.tHead.rows[0].setAttribute('role', 'row');
    headings.forEach(cell => { cell.scope = 'col'; cell.setAttribute('role', 'columnheader'); });
    for (const body of table.tBodies) {
      body.setAttribute('role', 'rowgroup');
      for (const row of body.rows) {
        row.setAttribute('role', 'row');
        for (const [index, cell] of [...row.cells].entries()) {
          cell.setAttribute('role', 'cell');
          cell.dataset.label = headings[index]?.textContent.trim() || 'Ações';
          cell.classList.toggle('mobile-record-wide', index === 0 || !!cell.querySelector('button, .actions, .expense-actions, .row-actions, .status-control') || cell.colSpan > 1);
        }
      }
    }
  }
}

export function initMobileNavigation(doc = document, win = window) {
  const viewport = win.matchMedia('(max-width: 1024px)');
  let opened = false;
  const find = selector => doc.querySelector(selector);
  const focusables = () => [...(find('#app-navigation')?.querySelectorAll('button:not(:disabled), a[href]') ?? [])]
    .filter(node => !node.closest('[hidden]') && node.getClientRects().length);
  function sync() {
    const sidebar = find('#app-navigation'), main = find('.main'), toggle = find('[data-mobile-menu]');
    if (!sidebar) { opened = false; doc.body.classList.remove('navigation-open'); return; }
    const isOpen = viewport.matches && opened;
    doc.body.classList.toggle('navigation-open', isOpen);
    sidebar.inert = viewport.matches && !isOpen;
    if (main) main.inert = isOpen;
    toggle?.setAttribute('aria-expanded', String(isOpen));
    if (isOpen) { sidebar.setAttribute('role', 'dialog'); sidebar.setAttribute('aria-modal', 'true'); }
    else { sidebar.removeAttribute('role'); sidebar.removeAttribute('aria-modal'); }
  }
  function close(restoreFocus = true) {
    const wasOpen = opened; opened = false; sync();
    if (wasOpen && restoreFocus) find('[data-mobile-menu]')?.focus({ preventScroll: true });
  }
  doc.addEventListener('click', event => {
    if (event.target.closest('[data-mobile-menu]')) {
      opened = !opened; sync();
      if (opened) focusables()[0]?.focus({ preventScroll: true });
    } else if (event.target.closest('[data-mobile-close]')) close();
  });
  doc.addEventListener('keydown', event => {
    // Nested dialogs/selects own Escape first; don't discard their form.
    if (!opened || event.defaultPrevented || find('dialog[open]') || find('.select-popover')) return;
    if (event.key === 'Escape') { event.preventDefault(); close(); }
    if (event.key === 'Tab') {
      const items = focusables(), first = items[0], last = items.at(-1);
      if (event.shiftKey && (doc.activeElement === first || !items.includes(doc.activeElement))) { event.preventDefault(); last?.focus(); }
      else if (!event.shiftKey && (doc.activeElement === last || !items.includes(doc.activeElement))) { event.preventDefault(); first?.focus(); }
    }
  });
  viewport.addEventListener('change', () => {
    const focusWasInNav = find('#app-navigation')?.contains(doc.activeElement);
    close(false);
    if (viewport.matches && focusWasInNav) find('[data-mobile-menu]')?.focus({ preventScroll: true });
    if (!viewport.matches && focusWasInNav && !doc.activeElement.getClientRects().length) (find('#app-navigation [aria-current="page"]') ?? find('#main-content'))?.focus({ preventScroll: true });
  });
  return { sync, close, reset() { const wasOpen=opened; close(false); return wasOpen; } };
}
// Only route identifiers enter history; forms and commercial data stay in memory.
export function createPageHistory({history,onNavigate,isBlocked=()=>false,onBlocked=()=>{},onError=()=>{}}) {
 let owner='',current=null,restoring=false,reverting=false;
 const valid=s=>s?.kind==='gamecell-page'&&s.owner===owner&&Number.isInteger(s.index);
 const write=(route,index)=>({kind:'gamecell-page',owner,index,route});
 return {
  record(user,route) {
   if(!user){owner='';current=null;return;}
   if(owner!==user){owner=user;current=write(route,0);history.replaceState(current,'');return;}
   if(current&&JSON.stringify(current.route)===JSON.stringify(route))return;
   current=write(route,restoring?(current?.index??0):(current?.index??0)+1);
   history[restoring?'replaceState':'pushState'](current,'');
  },
  reset(){owner='';current=null;history.replaceState(null,'');},
  async pop(target) {
   if(reverting){reverting=false;return;}
   if(!owner)return;
   if(isBlocked()){
    const delta=valid(target)?current.index-target.index:0;
    if(delta){reverting=true;history.go(delta);}else history.pushState(current,'');
    onBlocked();return;
   }
   if(!valid(target)){target=write({view:'dashboard'},0);history.replaceState(target,'');}
   current=target;restoring=true;
   try{await onNavigate(target.route);}catch(error){onError(error);}finally{restoring=false;}
  },
  async restore(user) {
   const saved=history.state;
   owner=user;
   if(!valid(saved)){owner='';current=null;return false;}
   current=saved;restoring=true;
   try{await onNavigate(saved.route);return true;}catch(error){onError(error);return false;}finally{restoring=false;}
  },
 };
}
