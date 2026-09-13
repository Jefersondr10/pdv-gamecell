import { enhanceSelects, initSelectControls, closeSelectControls } from './select-control.mjs';
import { dateInput, normalizeDateFields, dateRange, salesFilterValues, initDateControls, brazilianDate, isoDate } from './date-control.mjs';
import { createStockUI, matchesStockProduct } from './stock-ui.mjs';
import { salesRecords, wholesaleControl, wholesaleEditor, wholesaleBadge, cancelSaleButton, cancelledRecord, refundReminders, cancellationPayments } from './sales-view.mjs';
import { createFinanceUI } from './finance-ui.mjs';
import { mountGoogle } from './google-ui.mjs';
import { enhanceMobileTables, initMobileNavigation, compactMobilePage, rememberMobileFilterState, saleMobileSteps, stockMobileSteps, createPageHistory } from './mobile-ui.mjs';
import { createCalculatorUI } from './installment-calculator.mjs';
import { matchesCatalog, unitList, unitPicker } from './serial-ui.mjs';
import { createSalesFilterController } from './sales-filter-controller.mjs';
import { refundManagement, refundMethodOptions } from './refund-ui.mjs';
let authSettings = { password_registration: true, production: false };
const app = document.querySelector('#app'), modal = document.querySelector('#modal');
const mobileNavigation = initMobileNavigation();
let detailSale=null;
let renderedView=null;
function saoPauloToday(value=new Date()) {
 const parts=new Intl.DateTimeFormat('en-CA',{timeZone:'America/Sao_Paulo',year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(value);
 const values=Object.fromEntries(parts.map(part=>[part.type,part.value]));
 return `${values.year}-${values.month}-${values.day}`;
}
function todayFilter() {const today=saoPauloToday();return {from:today,to:today};}
async function applySalesFilters(data) {
 const next=salesFilterValues(data,saoPauloToday());
 const controls=[...document.querySelectorAll('#filter-form input, #filter-form select, #filter-form button')].map(el=>[el,el.disabled]);
 for(const [el] of controls)el.disabled=true;
 try{
  const nextState=await api('/state?'+new URLSearchParams(next));
  const changed=adoptState(nextState);if(!changed)filter=next;else await load();render();
 }catch(error){if(state)render();throw error;}
 finally{for(const [el,disabled] of controls)el.disabled=disabled;}
}
let cancellationRefreshPending = false;
let state = null, view = 'dashboard', authMode = 'login', working = null, workingDirty = false, pendingDiscardTarget = null, detailId = null, productHistory = null, productDetailReturnView = 'products', filter = todayFilter(), busy = false;
let machineDraft=null, machineDraftDirty=false, expenseMenuOpen=false, registryMenuOpen=false;
let stockSearch='',stockSearchOwner='';
let catalogQueries={customers:'',products:''},catalogOwner='',pickerUnits=[],productCreateContext=null;
let salesRefreshPending=false;
let salesMutationRefreshPending=false;
const pendingWorks=new Map();
let pendingOwner='', sessionEpoch=0, mutationRefreshPending='';
const machineBrandSelections=new Map();
const labels = {
 'sales.edit_confirmed':'Editar vendas confirmadas', 'sales.cancel':'Cancelar vendas', 'sales.refund':'Registrar devoluções realizadas', 'sales.refund_correct':'Corrigir baixas de devolução', 'stock.correct':'Editar e excluir entradas',
 'sales.create':'Criar vendas', 'sales.confirm':'Confirmar vendas', 'sales.edit_draft':'Editar rascunhos',
 'sales.view_all':'Ver todas as vendas', 'sales.assign_seller':'Selecionar outro vendedor', 'sales.change_status':'Alterar status das vendas', 'payments.correct':'Corrigir e remover pagamentos registrados', 'payments.record':'Registrar pagamentos',
 'costs.view':'Visualizar custos e taxas', 'costs.enter':'Informar custos', 'profit.view':'Visualizar lucro',
 'products.manage':'Cadastrar e editar produtos', 'customers.manage':'Cadastrar e editar clientes', 'stock.receive':'Registrar entradas e gerenciar fornecedores',
 'settings.manage':'Configurar status, Pix, máquinas e taxas', 'users.manage':'Gerenciar vendedores', 'sales.share':'Compartilhar vendas',
 'expenses.view':'Consultar despesas e lembretes', 'expenses.manage':'Cadastrar despesas e registrar pagamentos',
 'finance.view':'Consultar fechamento geral e sócios', 'finance.manage':'Configurar sócios, fechar meses e registrar retiradas'
};
const paths = {
 calculator:'M5 3h14v18H5z M8 6h8v4H8z M8 14h1 M12 14h1 M16 14h0 M8 18h1 M12 18h1 M16 18h0',
 grid:'M3 3h7v7H3z M14 3h7v7h-7z M3 14h7v7H3z M14 14h7v7h-7z',
 bag:'M5 7h14l1 14H4L5 7z M9 8V6a3 3 0 0 1 6 0v2',
 box:'M3 7l9-4 9 4v10l-9 4-9-4V7z M3 7l9 4 9-4 M12 11v10 M8 5l9 4',
 users:'M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2 M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8 M20 21v-2a4 4 0 0 0-3-4 M16 3a4 4 0 0 1 0 8',
 stock:'M12 3v12 M7 10l5 5 5-5 M4 15v6h16v-6',
 settings:'M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8 M12 2v3 M12 19v3 M2 12h3 M19 12h3 M5 5l2 2 M17 17l2 2 M5 19l2-2 M17 7l2-2',
 plus:'M12 5v14 M5 12h14', arrow:'M5 12h14 M14 7l5 5-5 5', money:'M3 5h18v14H3z M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8',
 trend:'M3 17l6-6 4 4 8-10 M15 5h6v6', clock:'M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18 M12 7v5l3 2',
 check:'M5 12l4 4L19 6', x:'M6 6l12 12 M6 18L18 6', share:'M18 8a3 3 0 1 0 0-6 3 3 0 0 0 0 6 M6 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6 M18 22a3 3 0 1 0 0-6 3 3 0 0 0 0 6 M9 10l6-4 M9 14l6 4'
};
const icon = name => `<svg class="icon" viewBox="0 0 24 24" aria-hidden="true"><path d="${paths[name] ?? paths.box}"/></svg>`;
const esc = v => String(v ?? '').replace(/[&<>"']/g, c => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[c]));
const money = cents => new Intl.NumberFormat('pt-BR',{style:'currency',currency:'BRL'}).format((cents ?? 0)/100);
const value = c => ((c ?? 0)/100).toFixed(2).replace('.', ',');
const date = v => v ? new Intl.DateTimeFormat('pt-BR',{timeZone:'America/Sao_Paulo',day:'2-digit',month:'short',year:'numeric'}).format(new Date(v)) : '—';
const filterDateLabel = v => /^\d{4}-\d{2}-\d{2}$/.test(v??'') ? `${v.slice(8,10)}/${v.slice(5,7)}/${v.slice(0,4)}` : 'Data não definida';
function dateFilterSummary() {
 if(filter.date_preset==='all')return 'Todos os dias';
 const today=saoPauloToday(), from=filter.from??today, to=filter.to??today;
 if(from===today&&to===today)return 'Hoje';
 if(from===to)return filterDateLabel(from);
 return `${filterDateLabel(from)} a ${filterDateLabel(to)}`;
}
function cents(v) {
 let s = String(v ?? '').trim(); if (!s) return 0;
 if (s.includes(',')) s = s.replace(/\./g,'').replace(',', '.');
 else if (/^\d{1,3}(\.\d{3})+$/.test(s)) s=s.replace(/\./g,'');
 if (!/^\d+(\.\d{0,2})?$/.test(s)) throw Error('Valor inválido. Use, por exemplo, 1000,00.');
 const [a,b=''] = s.split('.'); const n = Number(a)*100+Number(b.padEnd(2,'0'));
 if (!Number.isSafeInteger(n) || n > 100_000_000_000) throw Error('Valor fora do limite.'); return n;
}
const can = p => state?.user.is_owner || state?.user.permissions.includes(p);
const methods = { pix:'Pix', cash:'Dinheiro', card:'Cartão' };
const statusColors = { neutral:'Cinza', blue:'Azul', green:'Verde', amber:'Âmbar', red:'Vermelho', purple:'Roxo' };
const statusHexes={neutral:'#657983',blue:'#3175B9',green:'#23815F',amber:'#AD741B',red:'#B85445',purple:'#7953A8'};
const colorSwatches=['#EF4444','#F97316','#F59E0B','#EAB308','#84CC16','#22C55E','#10B981','#14B8A6','#06B6D4','#0EA5E9','#3B82F6','#6366F1','#8B5CF6','#A855F7','#D946EF','#EC4899','#F43F5E','#7F1D1D','#92400E','#14532D','#1E3A8A','#581C87','#334155','#FFFFFF'];
const paymentRequestId = () => crypto.randomUUID();
const statusBadge = s => `<span class="badge ${s.status==='cancelled'?'bad':s.status==='confirmed'?'good':''}">${s.status==='cancelled'?'Cancelada':s.status==='confirmed'?'Confirmada':'Rascunho'}</span>`;
const paymentBadge = s => s.status==='cancelled'?'':`<span class="badge ${s.reconciliation.state==='matched'?'good':s.reconciliation.state==='overpaid'?'bad':'warn'}">${s.reconciliation.state==='matched'?'Conferido':s.reconciliation.state==='overpaid'?'Acima do total':'Pagamento pendente'}</span>`;
const option = (v, label, selected) => `<option value="${esc(v)}" ${v===selected?'selected':''}>${esc(label)}</option>`;
const field = (label, content, full=false) => `<label class="field ${full?'full':''}">${label}${content}</label>`;
const input = (name, val='', extra='') => /type="(date|month)"/.test(extra)?dateInput(name,val,extra):`<input name="${name}" value="${esc(val)}" ${extra}>`;
const cpfLabel = cpf => String(cpf??'').replace(/^(\d{3})(\d{3})(\d{3})(\d{2})$/,'$1.$2.$3-$4');
const saleStatuses = () => state?.sale_statuses ?? [];
const pixAccounts = () => state?.pix_accounts ?? [];
const activePixAccounts = () => pixAccounts().filter(account=>account.active!==false&&account.active!==0);
const suppliers = () => state?.suppliers ?? [];
const defaultPixAccountId = selected => {const accounts=activePixAccounts();return accounts.some(account=>account.id===selected)?selected:(accounts.length===1?accounts[0].id:'');};
const pixAccountOptions = selected => option('','Selecione a conta Pix',selected)+activePixAccounts().map(account=>option(account.id,account.name,selected)).join('');
const pixAccountSnapshot = payment => payment.pix_account_name || pixAccounts().find(account=>account.id===payment.pix_account_id)?.name || 'Conta Pix não informada';
const costValue = centsValue => centsValue==null?'Pendente':money(centsValue);
const statusHex = color => /^#[0-9a-f]{6}$/i.test(color??'')?color.toUpperCase():(statusHexes[color]??statusHexes.neutral);
function colorInk(hex) {
 const rgb=hex.slice(1).match(/../g).map(n=>parseInt(n,16)/255).map(n=>n<=.04045?n/12.92:((n+.055)/1.055)**2.4),luminance=.2126*rgb[0]+.7152*rgb[1]+.0722*rgb[2];
 return luminance>.179?'#111827':'#FFFFFF';
}
function applyColorStyles(scope=document) {
 for(const node of scope.querySelectorAll('[data-status-color]')){const hex=statusHex(node.dataset.statusColor),ink=colorInk(hex);node.style.setProperty('--status-color',hex);node.style.setProperty('--status-bg',hex);node.style.setProperty('--status-text',ink);}
 for(const node of scope.querySelectorAll('[data-color-swatch]')){const hex=statusHex(node.dataset.colorSwatch);node.style.backgroundColor=hex;node.style.color=colorInk(hex);}
}
const operationalBadge = status => status
 ? `<span class="operational-badge" data-status-color="${statusHex(status.color)}"><span class="status-dot" aria-hidden="true"></span>${esc(status.name)}</span>`
 : '<span class="operational-badge status-neutral"><span class="status-dot" aria-hidden="true"></span>Sem status</span>';
const operationalOptions = selected => option('','Sem status',selected)+saleStatuses().map(s=>option(s.id,s.name,selected)).join('');
function reviewBadge(s) {
 const review=s?.review;
 if(s?.status==='cancelled'||!review?.required)return '';
 const source=review.automatic?(review.manual?'automático + manual':'automático'):'manual';
 return `<span class="badge warn sale-review-badge">A conferir<small>${source}</small></span>`;
}
function saleReviewControl(s, context='lista') {
 if(s.status==='cancelled')return '';
 const review=s.review??{};
 if(!can('sales.change_status'))return reviewBadge(s);
 const source=review.automatic?(review.manual?'automático + manual':'automático'):(review.manual?'manual':'');
 const action=review.manual?'Remover a marcação manual A conferir':review.automatic?'Manter como A conferir manualmente':'Marcar como A conferir';
 return `<label class="sale-review-status${review.required?' is-required':''}${review.automatic?' is-automatic':''}" title="${action}"><input class="sale-review-input" type="checkbox" data-sale-review="${esc(s.id)}" data-previous="${!!review.manual}" ${review.manual?'checked':''} aria-label="${action} — venda #${String(s.number).padStart(4,'0')} no ${esc(context)}"><span class="sale-review-indicator" aria-hidden="true"></span><span>A conferir</span>${source?`<small>${source}</small>`:''}</label>`;
}
function saleReviewEditor(w) {
 if(!can('sales.change_status')){const source=w.review_automatic?(w.review_manual?'automático + manual':'automático'):'manual';return w.review_required?`<span class="badge warn sale-review-badge">A conferir<small>${source}</small></span>`:'';}
 return `<label class="sale-review-status sale-review-editor${w.review_automatic?' is-required is-automatic':''}" title="Sinalizar esta venda para revisão"><input class="sale-review-input" type="checkbox" data-bind="review_manual" ${w.review_manual?'checked':''} aria-label="Marcar esta venda como A conferir"><span class="sale-review-indicator" aria-hidden="true"></span><span>A conferir</span>${w.review_automatic?'<small>automático</small>':''}</label>`;
}
function operationalStatusControl(s, context='lista') {
 if(s.status==='cancelled')return '';
 const selected=s.operational_status?.id??'';
 if(!can('sales.change_status'))return operationalBadge(s.operational_status);
 return `<label class="status-control"><span class="sr-only">Status operacional da venda #${String(s.number).padStart(4,'0')} no ${context}</span><select class="status-select" ${s.operational_status?`data-status-color="${statusHex(s.operational_status.color)}"`:''} data-sale-status="${s.id}" data-previous="${esc(selected)}" aria-label="Alterar status operacional da venda #${String(s.number).padStart(4,'0')}">${operationalOptions(selected)}</select></label>`;
}
function productSummary(s) {
 const items=Array.isArray(s.items)?s.items:[];
 if(!items.length)return '<span class="muted">Produto a definir</span>';
 const first=items[0], more=items.length-1, details=items.map(i=>`${i.description} (${i.quantity})`).join(', ');
 return `<span class="product-summary" title="${esc(details)}"><span>${esc(first.description)}</span>${more?`<small>+ mais ${more} produto${more===1?'':'s'}</small>`:''}</span>`;
}
const totalQuantity = s => (s.items??[]).reduce((sum,item)=>sum+Number(item.quantity||0),0);
function toast(text) { const el=document.querySelector('#toast'); el.textContent=text; el.classList.add('show'); clearTimeout(toast.timer); toast.timer=setTimeout(()=>el.classList.remove('show'),4500); }
async function api(path, data, method='POST') {
 const epoch=sessionEpoch;
 const res=await fetch('/api'+path,{method:data===undefined?'GET':method,headers:{...(data===undefined?{}:{'Content-Type':'application/json'}),...(data!==undefined&&state?.user?.id?{'X-PDV-User':state.user.id}:{})},body:data===undefined?undefined:JSON.stringify(data)});
 const result=await res.json(); if(epoch!==sessionEpoch)throw Error('A sessão mudou. Atualize a tela antes de continuar.'); if(!res.ok){const err=Error(result.error??'Falha na operação.');err.status=res.status;if(res.status===401&&!['/login','/register'].includes(path)&&!path.startsWith('/auth/')){state=null;working=null;workingDirty=false;pendingDiscardTarget=null;detailId=null;productHistory=null;filter=todayFilter();salesFilters.clear();salesMutationRefreshPending=false;salesRefreshPending=false;authMode='login';renderAuth();}throw err;} return result;
}
function clearPrivateWorkspace() {
 sessionEpoch++;
 closeSelectControls();app.innerHTML='<main class="loading" role="status">Carregando sua conta…</main>';
 working=null;workingDirty=false;pendingDiscardTarget=null;detailId=null;detailSale=null;productHistory=null;
 pendingWorks.clear();pendingOwner='';pickerUnits=[];productCreateContext=null;machineDraft=null;machineDraftDirty=false;machineBrandSelections.clear();
 catalogQueries={customers:'',products:''};catalogOwner='';stockSearch='';stockSearchOwner='';view='dashboard';renderedView=null;
 filter=todayFilter();salesFilters.clear();salesMutationRefreshPending=false;salesRefreshPending=false;cancellationRefreshPending=false;mutationRefreshPending='';
 for(const dialog of document.querySelectorAll('dialog')){if(dialog.open)dialog.close();dialog.replaceChildren();}
 financeUI.reset();stockUI.reset();calculatorUI.reset();mobileNavigation.reset();pageHistory.reset();
 const notification=document.querySelector('#toast');notification.textContent='';notification.classList.remove('show');
}
function adoptState(next) {
 const identity=user=>user?JSON.stringify([user.id,user.tenant_id,!!user.is_owner,[...(user.permissions??[])].sort()]):'';
 const changed=!!state&&identity(state.user)!==identity(next.user);
 if(changed)clearPrivateWorkspace();
 state=next;pendingOwner=next.user.id;return changed;
}
async function load() {
 const today=todayFilter();if(filter.date_preset!=='all')filter={...filter,from:filter.from||today.from,to:filter.to||today.to};
 adoptState(await api('/state?'+new URLSearchParams(filter)));salesRefreshPending=false;
 await financeUI.load();
 if(view==='detail'&&detailId)detailSale=await api(`/sales/${detailId}`);
 if(view==='product-detail'&&productHistory)productHistory=await api(`/products/${productHistory.product.id}/history`);
}
async function finishMutation(message) {
 mutationRefreshPending=message;modal.close();
 try{await load();mutationRefreshPending='';render();toast(message);}
 catch(error){
  if(state){mutationRefreshPending=message;render();toast(message+' Atualize os dados para conferir.');return;}
  mutationRefreshPending='';renderAuth();
  app.querySelector('.auth-card')?.insertAdjacentHTML('afterbegin',`<div class="alert warn saved-refresh-warning" role="status"><strong>${esc(message)}</strong><p>A gravação foi concluída, mas a atualização da tela falhou. Entre novamente para conferir os dados e não repita o cadastro.</p></div>`);
 }
}
const navs=[['dashboard','grid','Dashboard'],['new-sale','plus','Vender'],['sales','bag','Vendas'],['calculator','calculator','Calculadora'],['registry-menu','users','Cadastro'],['customers','users','Clientes','registry-menu'],['products','box','Produtos','registry-menu'],['suppliers','stock','Fornecedores','registry-menu'],['card-machines','money','Máquinas de cartão','registry-menu'],['sellers','users','Vendedores','registry-menu'],['stock','stock','Estoque'],['expense-menu','money','Despesas'],['expenses','grid','Dashboard','expense-menu','Dashboard de despesas'],['expenses-fixed','clock','Fixas','expense-menu','Despesas fixas'],['expenses-variable','money','Variáveis','expense-menu','Despesas variáveis'],['expenses-catalogs','settings','Cadastros','expense-menu','Cadastros de despesas'],['closing','trend','Fechamento'],['settings','settings','Configurações']];
const navAllowed=v=>(v!=='calculator'||can('costs.view')||can('settings.manage'))&&(v!=='sellers'||can('users.manage'))&&(v!=='new-sale'||can('sales.create'))&&(!['expense-menu','expenses','expenses-fixed','expenses-variable','expenses-catalogs'].includes(v)||can('expenses.view'))&&(v!=='closing'||can('finance.view'));
function navigation() {
 const renderButton=([v,i,label,parent])=>{const active=view===v||(v==='new-sale'&&view==='editor')||(v==='sales'&&view==='detail')||(view==='product-detail'&&v===productDetailReturnView)||(view==='stock-report'&&v==='stock');return `<button ${v==='new-sale'?'data-action="new-sale"':`data-view="${v}"`} class="${active?'active':''} ${parent?'nav-child':''}" ${active?'aria-current="page"':''}>${icon(i)}${label}</button>`;};
 return navs.filter(([v,,,parent])=>!parent&&navAllowed(v)).map(entry=>{
  const children=navs.filter(([v,,,parent])=>parent===entry[0]&&navAllowed(v));
  if(!children.length)return renderButton(entry);
  const expenses=entry[0]==='expense-menu',open=expenses?expenseMenuOpen:registryMenuOpen,action=expenses?'toggle-expenses':'toggle-registry',id=expenses?'expense-submenu':'registry-submenu',active=children.some(([v])=>v===view)||(view==='product-detail'&&!expenses&&productDetailReturnView==='products');
  return `<div class="nav-category"><button type="button" data-action="${action}" class="nav-parent ${active?'section-active':''}" aria-expanded="${open}" aria-controls="${id}">${icon(entry[1])}<span>${entry[2]}</span><span class="nav-chevron" aria-hidden="true">${icon('arrow')}</span></button><div id="${id}" class="nav-submenu" role="group" aria-label="Submenus de ${expenses?'despesas':'cadastro'}" ${open?'':'hidden'}>${children.map(renderButton).join('')}</div></div>`;
 }).join('');
}
function renderAuth() {
 clearPrivateWorkspace();
 mobileNavigation.reset();
 if(!authSettings.password_registration)authMode='login';
 const reg=authMode==='register';document.title=`${reg?'Criar loja':'Entrar'} · Gamecell PDV`;
 app.innerHTML=`<div class="auth"><section class="auth-presentation"><div class="brand"><div class="brand-logo-frame"><img src="/gamecell-logo.png" width="640" height="640" alt="Gamecell — games, celulares e informática" decoding="async"></div><span class="brand-caption">Gestão da loja</span></div><h1>Venda simples.<br>Resultado claro.</h1><p>Produtos, estoque e pagamentos no mesmo lugar. Sem misturar o preço da venda com o que a máquina desconta.</p><div class="auth-tags"><span>Estoque FIFO</span><span>Pagamentos divididos</span><span>Lojas independentes</span></div></section><section class="auth-panel"><div class="auth-card"><div class="eyebrow">PDV GAMECELL</div><h2>${reg?'Crie sua loja':'Acesse sua operação'}</h2><p>${reg?'Cada novo cadastro principal cria uma loja independente.':'Entre com seu e-mail de administrador ou vendedor.'}</p><form id="auth-form">${reg?field('Seu nome',input('name','','required autocomplete="name"'))+field('Nome da loja',input('store_name','','required')):''}${field('E-mail',input('email','','type="email" required autocomplete="username"'))}${field('Senha',input('password','','type="password" required minlength="12" maxlength="128" autocomplete="'+(reg?'new-password':'current-password')+'"'))}<p class="error" id="auth-error" role="alert"></p><button class="primary" type="submit">${reg?'Criar loja':'Entrar'} ${icon('arrow')}</button></form><div class="auth-toggle">${reg?'Já tem uma conta?':'Primeiro acesso?'} <button data-action="auth-toggle" class="subtle">${reg?'Entrar':'Criar uma loja'}</button></div><p class="auth-hint">VERSÃO DE VALIDAÇÃO LOCAL<br>Use apenas dados fictícios. E-mail de verificação, recuperação de senha e publicação ainda não estão habilitados.</p></div></section></div>`;
 prepareOnlineAuth();
}
function prepareOnlineAuth() {
 const card=app.querySelector('.auth-card');if(!card)return;
 if(authSettings.production){card.querySelector('.auth-hint').textContent='Acesso protegido. Cada loja possui seus próprios dados e permissões.';card.querySelector('h2 + p').textContent='Donos entram com Google. A equipe usa o acesso criado pelo responsável da loja.';}
 if(!authSettings.password_registration)card.querySelector('.auth-toggle')?.remove();
 if(authSettings.google_client_id){
  const container=document.createElement('section');container.className='google-login';
  const form=card.querySelector('#auth-form');card.insertBefore(container,form);
  const details=document.createElement('details');details.className='team-login';
  const summary=document.createElement('summary');summary.textContent='Acesso de vendedores e usuários';details.append(summary);form.replaceWith(details);details.append(form);
  mountGoogle(container,{api,onSuccess:async()=>{filter=todayFilter();productHistory=null;await load();view='dashboard';render();}});
 }
}
function sidebarMarkup() {
 return `<aside class="sidebar" id="app-navigation" aria-label="Menu da loja">
  <div class="sidebar-heading"><div class="brand"><div class="brand-logo-frame"><img src="/gamecell-logo.png" width="640" height="640" alt="Gamecell — games, celulares e informática" decoding="async"></div></div><div class="mobile-drawer-heading"><button type="button" class="subtle mobile-close" data-mobile-close aria-label="Fechar menu">${icon('x')}</button></div></div>
  <nav class="nav" aria-label="Navegação principal">${navigation()}</nav>
  <div class="sidebar-bottom"><button class="subtle" data-action="logout">Sair da conta ${icon('arrow')}</button></div>
 </aside>`;
}
function render() {
 rememberMobileFilterState(app);
 const navigationWasOpen=mobileNavigation.reset(),routeChanged=renderedView!==view;renderedView=view;
 if(!state){renderAuth();return;}
 if(pendingOwner!==state.user.id){clearPrivateWorkspace();pendingOwner=state.user.id;}
 pageHistory.record(state.user.id,currentPageRoute());
 if(['customers','products','suppliers','card-machines','sellers'].includes(view)||(view==='product-detail'&&productDetailReturnView==='products')){registryMenuOpen=true;expenseMenuOpen=false;}
 else if(view.startsWith('expenses')){expenseMenuOpen=true;registryMenuOpen=false;}
 const currentNav=navs.find(n=>n[0]===view),pageTitle=currentNav?.[4]??currentNav?.[2]??(view==='stock-report'?'Relatório de estoque':view==='editor'?'Venda':view==='detail'?'Detalhes da venda':'Detalhes do produto');document.title=`${pageTitle} · Gamecell PDV`;
 app.innerHTML=`<div class="layout">${sidebarMarkup()}<div class="navigation-backdrop" data-mobile-close aria-hidden="true"></div><div class="main"><header class="topbar"><div class="topbar-inner"><button type="button" class="mobile-menu-toggle" data-mobile-menu aria-controls="app-navigation" aria-expanded="false" aria-label="Abrir menu"><svg class="icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M4 6h16 M4 12h16 M4 18h16"/></svg><span>Menu</span></button><div class="breadcrumbs">${esc(state.store.name)} &nbsp;/&nbsp; <b>${pageTitle}</b></div><div class="topbar-actions"><div class="user"><span class="avatar">${esc(state.user.name.slice(0,1).toUpperCase())}</span><div>${esc(state.user.name)}<small>${state.user.is_owner?'Administrador':'Vendedor'}</small></div><button class="subtle small" data-action="logout" aria-label="Sair">Sair</button></div></div></div></header><main class="content" id="main-content" tabindex="-1">${authSettings.production?'':'<div class="version-banner">Ambiente de teste · dados separados da sua loja online.</div>'}<div id="page"></div></main></div></div>`;
 mobileNavigation.sync();
 if(mutationRefreshPending){page(heading('Registro salvo','A atualização da tela não foi concluída.')+`<div class="alert"><p>${esc(mutationRefreshPending)} Não cadastre novamente. Consulte os dados atualizados para continuar.</p><button type="button" class="primary" data-action="refresh-after-save">Atualizar dados</button></div>`);return;}
 if(cancellationRefreshPending){showCancellationRefresh();return;}
 if(salesMutationRefreshPending){page(heading('Alteração salva','Precisamos atualizar os dados antes de mostrar os totais.')+'<div class="alert"><p>A alteração da venda foi salva, mas a consulta falhou. Atualize para continuar; não é necessário salvar novamente.</p><button type="button" class="primary" data-action="refresh-sales">Atualizar dados</button></div>');return;}
 if(view==='dashboard') renderDashboard(); else if(view==='sales') renderSales();else if(view==='calculator')calculatorUI.render(); else if(view==='editor') renderEditor(); else if(view==='detail') renderDetail(); else if(view==='products') renderProducts(); else if(view==='product-detail') renderProductDetail(); else if(view==='customers') renderCustomers(); else if(view==='stock') renderStock();else if(view==='stock-report')stockUI.reportPage();else if(view==='suppliers')page(heading('Fornecedores','Cadastros para identificar as compras e entradas da loja.')+supplierCatalogPanel());else if(view==='card-machines')page(heading('Máquinas de cartão','Máquina, bandeiras e taxas por parcela em um só cadastro.')+cardMachinesPanel());else if(view==='sellers')renderSellers(); else if(view==='expenses')financeUI.expensesPage('');else if(view==='expenses-fixed')financeUI.expensesPage('fixed');else if(view==='expenses-variable')financeUI.expensesPage('variable');else if(view==='expenses-catalogs')financeUI.expensesPage('catalogs');else if(view==='closing')financeUI.closingPage();else renderSettings();
 if(navigationWasOpen||routeChanged){document.querySelector('#main-content')?.focus({preventScroll:true});window.scrollTo({top:0,left:0,behavior:'instant'});}
}
const page = html => {const target=document.querySelector('#page');target.dataset.screen=view;target.innerHTML=html;applyColorStyles(target);enhanceSelects(target);enhanceMobileTables(target);compactMobilePage(target,view);};
function heading(title, subtitle, button='') {return `<div class="page-heading"><div><div class="eyebrow">GESTÃO DA LOJA</div><h1>${title}</h1><p>${subtitle}</p></div>${button}</div>`;}
function filters() {
 const today=todayFilter(), from=filter.from??today.from, to=filter.to??today.to, summary=dateFilterSummary();
 const preset=filter.date_preset==='all'?'all':['today','yesterday','month'].find(p=>{const r=dateRange(p,today.from);return r.from===from&&r.to===to;})??'period';
 const typeLabel=filter.sale_type==='wholesale'?'Atacado':filter.sale_type==='retail'?'Varejo':'Atacado e varejo';
 const reviewLabel=filter.review==='required'?'Somente A conferir':filter.review==='clear'?'Somente conferidas':'Todas as conferências';
 return `<form id="filter-form" class="filters sales-filters" data-filter-owner="${esc(state.user.id)}" aria-label="Filtrar vendas">
 <label class="field sales-query">Buscar venda<input name="q" type="search" maxlength="120" value="${esc(filter.q??'')}" placeholder="Nº da venda, cliente ou produto" aria-label="Buscar por número da venda, cliente, produto ou vendedor" autocomplete="off"></label>
 <label class="field sales-date-filter">Data<select name="date_preset" data-date-preset aria-label="Período das vendas">${option('today','Hoje',preset)}${option('yesterday','Ontem',preset)}${option('month','Este mês',preset)}${option('period','Escolher período',preset)}${option('all','Todos os dias',preset)}</select></label>
 <label class="field sales-type-filter">Tipo de venda<select name="sale_type" aria-label="Filtrar atacado ou varejo">${option('','Todas',filter.sale_type)}${option('wholesale','Atacado',filter.sale_type)}${option('retail','Varejo',filter.sale_type)}</select></label>
 <div id="sales-period-range" class="sales-period-range" ${preset==='period'?'':'hidden'}>${field('De',input('from',from,`type="date" required ${preset==='period'?'':'disabled'}`))}${field('Até',input('to',to,`type="date" required ${preset==='period'?'':'disabled'}`))}</div>
 ${field('Vendedor',`<select name="seller_id" aria-label="Filtrar vendedor">${option('','Todos os vendedores',filter.seller_id)}${state.users.map(u=>option(u.id,u.name,filter.seller_id)).join('')}</select>`)}
 ${field('Status',`<select name="operational_status_id" aria-label="Filtrar status operacional">${option('','Todos os status',filter.operational_status_id)}${saleStatuses().map(s=>option(s.id,s.name,filter.operational_status_id)).join('')}</select>`)}
 ${field('Conferência',`<select name="review" aria-label="Filtrar vendas a conferir">${option('','Todas',filter.review)}${option('required','A conferir',filter.review)}${option('clear','Sem pendências',filter.review)}</select>`)}
 ${field('Situação',`<select name="status" aria-label="Filtrar situação da venda">${option('','Todas as situações',filter.status)}${option('confirmed','Confirmadas',filter.status)}${option('draft','Rascunhos',filter.status)}${option('cancelled','Canceladas',filter.status)}</select>`)}
 <button class="small" type="submit">Buscar</button><button class="small subtle" type="button" data-action="clear-filters">Limpar</button><p class="error sales-filter-error" role="alert"></p></form>
 <p class="applied-sales-period" role="status">Período aplicado: ${esc(summary)} · ${esc(typeLabel)} · ${esc(reviewLabel)} · ${state.sales.length} ${state.sales.length===1?'registro encontrado':'registros encontrados'}${filter.q?` · Busca: “${esc(filter.q)}”`:''}</p>`;
}
function empty(title, description) {return `<div class="empty">${icon('bag')}<h3>${title}</h3><p>${description}</p></div>`;}
function saleTable(sales, compact=false) {
 if(!sales.length)return empty('Nenhuma venda por aqui','Crie uma venda ou ajuste os filtros para começar.');
 if(compact)return `<div class="table-wrap"><table class="sales-table sales-table-compact"><thead><tr><th>Venda / cliente</th><th>Status</th><th>Situação</th><th class="num">Valor</th><th><span class="sr-only">Ações</span></th></tr></thead><tbody>${sales.map(s=>`<tr><td class="sale-identity"><strong>#${String(s.number).padStart(4,'0')}</strong><span>${esc(s.customer_name??'Cliente a definir')}</span><small>${date(s.business_date?`${s.business_date}T12:00:00-03:00`:s.created_at)}</small></td><td>${operationalBadge(s.operational_status)}${reviewBadge(s)}</td><td>${statusBadge(s)}</td><td class="num strong">${money(s.total_cents)}</td><td><button class="small subtle" data-action="open-sale" data-id="${s.id}" aria-label="Abrir venda #${String(s.number).padStart(4,'0')}">Abrir ${icon('arrow')}</button></td></tr>`).join('')}</tbody></table></div>`;
 return `<div class="table-wrap" tabindex="0" role="region" aria-label="Histórico de vendas"><table class="sales-table sales-table-full"><thead><tr><th>Venda / cliente</th><th>Produto(s)</th><th class="num">Quantidade</th><th class="num">Valor total</th><th>Status operacional</th><th>Situação da venda</th><th><span class="sr-only">Ações</span></th></tr></thead><tbody>${sales.map(s=>`<tr><td class="sale-identity"><strong>#${String(s.number).padStart(4,'0')}</strong><span>${esc(s.customer_name??'Cliente a definir')}</span><small>${esc(s.seller_name??'Vendedor a definir')} · ${date(s.business_date?`${s.business_date}T12:00:00-03:00`:s.created_at)}</small></td><td>${productSummary(s)}</td><td class="num strong">${totalQuantity(s)} un.</td><td class="num strong">${money(s.total_cents)}</td><td>${operationalStatusControl(s)}</td><td><div class="technical-state">${statusBadge(s)}${paymentBadge(s)}</div></td><td><button class="small subtle" data-action="open-sale" data-id="${s.id}" aria-label="Abrir venda #${String(s.number).padStart(4,'0')}">Abrir ${icon('arrow')}</button></td></tr>`).join('')}</tbody></table></div>`;
}
function statusCatalogPanel() {
 const statuses=saleStatuses(), manage=can('settings.manage');
 return `<section class="panel status-catalog" aria-labelledby="status-catalog-title"><div class="panel-header"><div><h2 id="status-catalog-title">Status das vendas</h2><p>Organize as etapas internas sem alterar a confirmação ou os valores da venda.</p></div>${manage?`<button class="small" data-action="modal-sale-status">${icon('plus')} Cadastrar status</button>`:''}</div><div class="panel-body"><div class="builtin-sale-states"><span class="badge">Rascunho</span><span class="badge good">Confirmada</span><span class="badge bad">Cancelada</span><span class="badge warn">A conferir</span><small>“A conferir” pode ser marcado manualmente e também aparece automaticamente quando falta pagamento, custo ou outro dado obrigatório.</small></div>${statuses.length?`<div class="status-catalog-list" role="list">${statuses.map(s=>`<div class="status-catalog-item" role="listitem">${operationalBadge(s)}${manage?`<button class="small subtle" data-action="modal-sale-status" data-id="${s.id}" aria-label="Editar status ${esc(s.name)}">Editar</button>`:''}</div>`).join('')}</div>`:`<p class="muted status-empty">Nenhum status operacional cadastrado.${manage?' Cadastre um para organizar etapas como separação e entrega.':''}</p>`}</div></section>`;
}
function metric(label,v,note,i,featured=false) {return `<div class="metric ${featured?'featured':''}"><div class="metric-label">${label}${icon(i)}</div><div class="metric-value">${v}</div><div class="metric-foot">${note}</div></div>`;}
function reviewMetric(value) {return `<button type="button" class="metric metric-action" data-action="show-review-sales"><span class="metric-label">Vendas para conferir${icon('bag')}</span><span class="metric-value">${value}</span><span class="metric-foot">Pendência automática ou marcação manual · abrir vendas</span></button>`;}
function renderDashboard() {
 const d=state.dashboard, c=state.sales.filter(s=>s.status==='confirmed');
 page(heading('Sua operação, em dia.','Acompanhe as vendas e o resultado real de cada operação.')+filters()+refundReminders(state.refunds_pending,{esc,money})+
 `<div class="metric-grid">${metric('Faturamento',money(d.revenue_cents),`${d.sales_count} ${d.sales_count===1?'venda confirmada':'vendas confirmadas'} no filtro`,'money')}${can('profit.view')?metric('Lucro apurado',money(d.profit_cents),'Somente vendas conferidas e com custo completo','trend',true):metric('Pagamentos registrados',money(d.gross_cents),'Valores brutos, antes das taxas','money',true)}${metric('A receber',money(d.pending_cents),'Diferença entre a venda e os pagamentos','clock')}${reviewMetric(String(d.incomplete_sales))}</div>
 ${financeUI.remindersPanel(state.expense_reminders,true)}<div class="panel"><div class="panel-header"><div><h2>Vendas recentes</h2><p>Rascunhos e vendas confirmadas, sem perder o histórico.</p></div><button class="small subtle" data-view="sales">Ver todas ${icon('arrow')}</button></div>${saleTable(state.sales.slice(0,5),true)}</div>
 <div class="two-col"><div class="panel"><div class="panel-header"><h2>Conferência dos pagamentos</h2><span class="badge">Valores brutos</span></div><div class="panel-body"><div class="row-stat"><span>Conferidos com o total da venda</span><span class="badge good">${c.filter(s=>s.reconciliation.state==='matched').length} ${c.filter(s=>s.reconciliation.state==='matched').length===1?'venda':'vendas'}</span></div><div class="row-stat"><span>Pagamento abaixo do total</span><strong>${money(d.pending_cents)}</strong></div><div class="row-stat"><span>Pagamento acima do total</span><strong class="${d.excess_cents?'negative':''}">${money(d.excess_cents)}</strong></div><p class="stat-note">As taxas de cartão não geram saldo a receber. Valores informados a mais não são somados ao faturamento.</p></div></div><div class="panel"><div class="panel-header"><h2>Atenção ao estoque</h2><span class="badge">Loja inteira</span></div><div class="panel-body">${state.products.filter(p=>p.stock<0).slice(0,4).map(p=>`<div class="row-stat"><span>${esc(p.name)}</span><span class="badge bad">${p.stock} un.</span></div>`).join('')||'<p class="muted">Nenhum produto com saldo negativo.</p>'}<p class="stat-note">Vendas sem saldo são permitidas. A entrada posterior resolve o custo pendente pelo FIFO, com histórico.</p><button class="small subtle" data-view="stock">Consultar estoque ${icon('arrow')}</button></div></div></div>`);
}
function renderSales() {
 page(heading('Vendas','Consulte e gerencie cada venda do período selecionado.')+filters()+refundReminders(state.refunds_pending,{esc,money})+
 salesRecords(state.sales,{esc,money,date,can,statusBadge,paymentBadge,operationalStatusControl,reviewControl:saleReviewControl,empty}));
}
const productNameButton = (product,origin) => `<button class="link-button" data-action="open-product" data-id="${product.id}" data-origin="${origin}" aria-label="Abrir histórico do produto ${esc(product.name)}">${esc(product.name)}</button>`;
function catalogSearch(kind,label,placeholder) {
 if(catalogOwner!==state.user.id){catalogQueries={customers:'',products:''};catalogOwner=state.user.id;}
 return `<form class="stock-search" role="search" data-catalog-search="${kind}"><label for="catalog-query">${label}</label><div><input id="catalog-query" type="search" value="${esc(catalogQueries[kind])}" placeholder="${placeholder}" maxlength="120" autocomplete="off"><button type="button" data-action="clear-catalog-search">Limpar</button></div><small data-catalog-count role="status"></small></form>`;
}
function updateCatalogResults() {
 const form=document.querySelector('[data-catalog-search]');if(!form)return;
 const query=form.querySelector('input').value;catalogQueries[form.dataset.catalogSearch]=query;
 const rows=[...document.querySelectorAll('[data-catalog-row]')];let visible=0;
 for(const row of rows){row.hidden=!matchesCatalog(row.dataset.searchText,query);if(!row.hidden)visible++;}
 form.querySelector('[data-catalog-count]').textContent=`${visible} de ${rows.length} cadastros`;
 document.querySelector('[data-catalog-empty]')?.toggleAttribute('hidden',visible>0||!rows.length);
}
function renderProducts() {
 const costs=can('costs.view'), actions=can('products.manage')?`<button class="primary" data-action="modal-product">${icon('plus')} Novo produto</button>`:'';
 page(heading('Produtos','Cadastro, saldo e aparelhos identificados.',actions)+catalogSearch('products','Buscar produto','Nome ou código / SKU')+`<div class="panel">${state.products.length?`<div class="table-wrap"><table class="product-table"><thead><tr><th>Produto</th><th>SKU</th><th class="num">Preço sugerido</th><th class="num">Estoque</th>${costs?'<th class="num">Custo FIFO</th><th class="num">Último custo</th>':''}</tr></thead><tbody>${state.products.map(p=>`<tr data-catalog-row data-search-text="${esc(p.name+' '+p.sku)}"><td class="strong">${productNameButton(p,'products')}${p.serial_tracked?'<small>Controle por SN / IMEI</small>':''}${can('products.manage')?`<button class="small" data-action="edit-product" data-id="${p.id}" aria-label="Editar produto ${esc(p.name)}">Editar</button>`:''}</td><td>${esc(p.sku||'—')}</td><td class="num">${money(p.price_cents)}</td><td class="num"><span class="badge ${p.stock<0?'bad':p.stock>0?'good':''}">${p.stock} un.</span></td>${costs?`<td class="num">${costValue(p.fifo_cost_cents)}</td><td class="num">${costValue(p.last_cost_cents)}</td>`:''}</tr>`).join('')}</tbody></table></div>`:empty('Cadastre seu primeiro produto','Produtos avulsos podem ser vendidos sem entrar neste cadastro.')}<p class="panel-body" data-catalog-empty hidden>Nenhum produto encontrado.</p></div>`);updateCatalogResults();
}
function renderCustomers() {
 const manage=can('customers.manage');
 page(heading('Clientes','Dados de contato e identificação dos seus clientes.',manage?`<button class="primary" data-action="modal-customer">${icon('plus')} Novo cliente</button>`:'')+catalogSearch('customers','Buscar cliente','Nome, telefone, CPF ou e-mail')+`<div class="panel">${state.customers.length?`<div class="table-wrap"><table><thead><tr><th>Nome</th><th>Telefone</th><th>E-mail</th>${manage?'<th>Ações</th>':''}</tr></thead><tbody>${state.customers.map(c=>`<tr data-catalog-row data-search-text="${esc(c.name+' '+c.phone+' '+c.email+' '+(c.cpf??''))}"><td class="strong">${esc(c.name)}${c.cpf?`<small>CPF ${esc(cpfLabel(c.cpf))}</small>`:''}</td><td>${esc(c.phone||'—')}</td><td>${esc(c.email||'—')}</td>${manage?`<td><button type="button" class="small" data-action="edit-customer" data-id="${esc(c.id)}" aria-label="Editar cliente ${esc(c.name)}">Editar</button></td>`:''}</tr>`).join('')}</tbody></table></div>`:empty('Nenhum cliente cadastrado','Cadastre apenas o nome e complete os outros dados depois.')}<p class="panel-body" data-catalog-empty hidden>Nenhum cliente encontrado.</p></div>`);updateCatalogResults();
}
function renderStock() {
 if(stockSearchOwner!==state.user.id){stockSearch='';stockSearchOwner=state.user.id;}
 const receive=can('stock.receive'), actions=`<div class="actions"><button data-action="stock-report">Relatório de estoque</button>${receive&&can('costs.enter')?`<button class="primary" data-action="modal-entry">${icon('plus')} Registrar entrada</button>`:''}</div>`;
 page(heading('Estoque e entradas','As entradas mais antigas são consumidas primeiro. Abra o produto para consultar seu histórico.',actions)+`<form id="stock-search-form" class="stock-search" role="search" aria-label="Pesquisar no estoque"><label for="stock-query">Buscar produto</label><div><input id="stock-query" name="query" type="search" value="${esc(stockSearch)}" placeholder="Nome ou código/SKU" maxlength="120" autocomplete="off"><button type="button" class="small subtle" data-action="clear-stock-search">Limpar</button></div></form><div class="alert">Produtos sem controle por SN / IMEI podem ser vendidos sem entrada. O saldo ficará negativo e o resultado será marcado como custo pendente, nunca como custo zero.</div><div class="panel"><div class="panel-header"><h2>Saldo por produto</h2><span class="badge">FIFO</span></div><div id="stock-results">${stockBalanceMarkup()}</div></div>`+stockUI.entryTable());
}
function stockBalanceMarkup() {
 const costs=can('costs.view'),products=state.products.filter(p=>matchesStockProduct(p,stockSearch));
 return `<p class="stock-result-count" role="status">${products.length} de ${state.products.length} produtos${stockSearch.trim()?' · busca no saldo':''}</p>`+(products.length?`<div class="table-wrap"><table class="product-table compact-stock-table"><thead><tr><th>Produto</th><th class="num">Saldo</th><th>Situação</th>${costs?'<th class="num">Custo FIFO</th><th class="num">Último custo</th>':''}</tr></thead><tbody>${products.map(p=>`<tr><td class="strong">${productNameButton(p,'stock')}${p.sku?`<small class="stock-sku">SKU: ${esc(p.sku)}</small>`:''}</td><td class="num">${p.stock} un.</td><td><span class="badge ${p.stock<0?'bad':p.stock>0?'good':''}">${p.stock<0?'Entrada e custo pendentes':p.stock>0?'Disponível':'Sem saldo'}</span></td>${costs?`<td class="num">${costValue(p.fifo_cost_cents)}</td><td class="num">${costValue(p.last_cost_cents)}</td>`:''}</tr>`).join('')}</tbody></table></div>`:state.products.length?empty('Nenhum produto encontrado','Tente outro nome ou código, ou limpe a busca.'):empty('Nenhum produto cadastrado','Cadastre um produto para registrar sua primeira entrada.'));
}
function updateStockResults() {
 const target=document.querySelector('#stock-results');if(!target)return;
 target.innerHTML=stockBalanceMarkup();enhanceMobileTables(target);
}
function supplierCatalogPanel() {
 const list=suppliers(), receive=can('stock.receive');
 return `<section class="panel catalog-panel" aria-labelledby="supplier-catalog-title"><div class="panel-header"><div><h2 id="supplier-catalog-title">Fornecedores</h2><p>Associe cada entrada ao fornecedor para manter o histórico organizado.</p></div>${receive?`<button class="small" data-action="modal-supplier">${icon('plus')} Cadastrar fornecedor</button>`:''}</div>${list.length?`<div class="table-wrap"><table><thead><tr><th>Fornecedor</th><th>Telefone</th><th>E-mail</th><th><span class="sr-only">Ações</span></th></tr></thead><tbody>${list.map(s=>`<tr><td class="strong">${esc(s.name)}</td><td>${esc(s.phone||'—')}</td><td>${esc(s.email||'—')}</td><td>${receive?`<button class="small subtle" data-action="modal-supplier" data-id="${s.id}" aria-label="Editar fornecedor ${esc(s.name)}">Editar</button>`:''}</td></tr>`).join('')}</tbody></table></div>`:empty('Nenhum fornecedor cadastrado',receive?'Cadastre um fornecedor para identificá-lo nas próximas entradas.':'Os fornecedores aparecerão aqui quando forem cadastrados.')}</section>`;
}
function pixAccountsPanel() {
 const accounts=pixAccounts(), manage=can('settings.manage');
 return `<section class="panel catalog-panel" aria-labelledby="pix-catalog-title"><div class="panel-header"><div><h2 id="pix-catalog-title">Contas Pix</h2><p>Escolha em qual conta cada pagamento Pix foi recebido.</p></div>${manage?`<button class="small" data-action="modal-pix-account">${icon('plus')} Cadastrar conta Pix</button>`:''}</div>${accounts.length?`<div class="table-wrap"><table><thead><tr><th>Nome da conta</th><th>Situação</th><th><span class="sr-only">Ações</span></th></tr></thead><tbody>${accounts.map(account=>`<tr><td class="strong">${esc(account.name)}</td><td><span class="badge ${account.active?'good':''}">${account.active?'Ativa':'Inativa'}</span></td><td>${manage?`<button class="small subtle" data-action="modal-pix-account" data-id="${account.id}" aria-label="Editar conta Pix ${esc(account.name)}">Editar</button>`:''}</td></tr>`).join('')}</tbody></table></div>`:empty('Nenhuma conta Pix cadastrada',manage?'Cadastre uma conta antes de registrar recebimentos por Pix.':'Peça a um administrador para cadastrar uma conta Pix.')}</section>`;
}
function renderSettings() { page(heading('Configurações','Acessos da equipe, status das vendas e contas para recebimentos Pix.')+(can('users.manage')?'<section class="panel"><div class="panel-header"><div><h2>Usuários e vendedores</h2><p>Crie os logins da equipe e defina suas permissões nesta loja.</p></div><button class="small" data-view="sellers">Gerenciar acessos</button></div></section>':'')+statusCatalogPanel()+pixAccountsPanel()); }
function renderSellers() {
 if(!can('users.manage')){page(empty('Acesso restrito','Peça ao administrador acesso ao cadastro de vendedores.'));return;}
 page(heading('Vendedores','Gerencie os acessos e as permissões da equipe.')+`<div class="panel"><div class="panel-header"><div><h2>Vendedores e permissões</h2><p>Cada usuário acessa somente o que você autorizar.</p></div>${can('users.manage')?'<button class="small" data-action="modal-user">+ Novo vendedor</button>':''}</div><div class="table-wrap"><table><thead><tr><th>Nome</th><th>Perfil</th><th></th></tr></thead><tbody>${state.users.map(u=>`<tr><td class="strong">${esc(u.name)}${u.email?`<small>${esc(u.email)}</small>`:''}</td><td><span class="badge ${u.is_owner?'good':''}">${u.is_owner?'Administrador':'Vendedor'}</span></td><td>${can('users.manage')&&!u.is_owner&&u.id!==state.user.id?`<button class="small subtle" data-action="modal-permissions" data-id="${u.id}">Permissões</button>`:''}</td></tr>`).join('')}</tbody></table></div></div>`);
}
const cardMachines=()=>state?.card_machines??[];
const machineRates=(machineId,brandId)=>state.rates.filter(r=>r.machine_id===machineId&&(!brandId||r.brand_id===brandId));
function machineRateSummary(machine,brandId) {
 const rates=machineRates(machine.id,brandId),debit=rates.find(r=>r.mode==='debit'),credit=rates.filter(r=>r.mode==='credit').sort((a,b)=>a.installments-b.installments),percent=r=>r?.basis_points===undefined?'Restrita':value(r.basis_points)+'%';
 return `<div class="machine-rate-summary"><div class="debit-summary"><span>Débito à vista</span><strong>${debit?percent(debit):'Não cadastrado'}</strong></div>${credit.length?`<div class="compact-rate-heading">Crédito <span>Taxa por quantidade de parcelas</span></div><div class="compact-rate-grid">${credit.map(r=>`<div><span>${r.installments}x</span><strong>${percent(r)}</strong></div>`).join('')}</div>`:'<p class="muted machine-no-rates">Sem taxas de crédito nesta bandeira.</p>'}</div>`;
}
function cardMachinesPanel() {
 const machines=cardMachines(),manage=can('settings.manage');
 return `<section class="panel machines-panel"><div class="panel-header"><div><h2>Máquinas de cartão</h2><p>Escolha a máquina e a bandeira para consultar as taxas.</p></div>${manage?'<button class="small" data-action="modal-card-machine">+ Nova máquina</button>':''}</div><div class="machine-catalog">${machines.length?machines.map(machine=>{const selected=machine.brands.some(b=>b.id===machineBrandSelections.get(machine.id))?machineBrandSelections.get(machine.id):machine.brands[0]?.id??'';machineBrandSelections.set(machine.id,selected);return `<article class="machine-card"><div class="machine-card-heading"><div class="machine-identity">${icon('money')}<div><h3>${esc(machine.name)}</h3><small>${machine.brands.length} bandeira${machine.brands.length===1?'':'s'}</small></div></div>${manage?`<button class="small" data-action="modal-card-machine" data-id="${machine.id}">Editar máquina e taxas</button>`:''}</div><div class="machine-brand-bar">${field('Bandeira',`<select data-machine-brand="${machine.id}" aria-label="Bandeira da máquina ${esc(machine.name)}">${machine.brands.map(b=>option(b.id,b.name,selected)).join('')}</select>`)}</div><div data-machine-summary="${machine.id}">${machineRateSummary(machine,selected)}</div></article>`;}).join(''):empty('Cadastre sua primeira máquina','Dê um nome à máquina e cadastre as taxas de cada bandeira.')}</div></section>`;
}
function renderProductDetail() {
 const history=productHistory, product=history?.product;
 if(!product){view=productDetailReturnView;render();return;}
 const costs=can('costs.view'), entries=history.entries??[], sales=history.sales??[], backLabel=productDetailReturnView==='stock'?'Estoque':'Produtos';
 page(heading(esc(product.name),`${product.sku?`SKU ${esc(product.sku)} · `:''}Histórico de entradas e vendas.`,`<div class="actions"><button data-action="product-back">Voltar para ${backLabel}</button>${can('products.manage')?`<button data-action="edit-product" data-id="${product.id}">Editar produto</button>`:''}</div>`)+
 `<div class="detail-grid product-detail-metrics ${product.serial_tracked?'serial-product-metrics':''}">${metric('Preço sugerido',money(product.price_cents),'Valor atual do cadastro','money')}${metric('Saldo atual',`${product.stock} un.`,product.stock<0?'Entrada pendente':'Estoque disponível','box')}${costs?metric('Custo FIFO',costValue(product.fifo_cost_cents),'Próximo lote disponível','stock'):metric('Movimentações',String(entries.length+sales.length),'Entradas e vendas registradas','clock')}${costs?metric('Último custo',costValue(product.last_cost_cents),'Entrada mais recente','trend'):''}</div>
 ${product.serial_tracked?serialProductPanel(history):''}<section class="panel"><div class="panel-header"><div><h2>Histórico de entradas</h2><p>Custos e unidades recebidas.</p></div><span class="badge">${entries.length} registros</span></div>${entries.length?`<div class="table-wrap"><table class="history-table"><thead><tr><th>Recebida em</th><th>Fornecedor</th><th class="num">Quantidade</th><th class="num">Restante</th>${costs?'<th class="num">Custo unitário</th>':''}</tr></thead><tbody>${entries.map(entry=>`<tr><td>${date(entry.received_at)}${entry.voided_at?'<small class="negative">Entrada excluída</small>':''}</td><td class="strong">${esc(entry.supplier_name||'Sem fornecedor')}</td><td class="num">${entry.quantity_initial} un.</td><td class="num">${entry.quantity_remaining} un.${can('stock.correct')&&can('stock.receive')&&can('costs.enter')&&!entry.voided_at?`<button class="small" data-action="stock-entry-edit" data-id="${entry.id}">Editar entrada</button>`:''}</td>${costs?`<td class="num">${costValue(entry.unit_cost_cents)}</td>`:''}</tr>`).join('')}</tbody></table></div>`:empty('Nenhuma entrada registrada','Quando houver uma entrada, ela aparecerá aqui com quantidade e fornecedor.')}</section>
 <section class="panel"><div class="panel-header"><div><h2>Vendas deste produto</h2><p>Vendas confirmadas que seu usuário pode consultar.</p></div><span class="badge">${sales.length} registros</span></div>${sales.length?`<div class="table-wrap"><table class="history-table"><thead><tr><th>Venda</th><th>Cliente</th><th>Vendedor</th><th>Data</th><th class="num">Quantidade</th><th class="num">Preço unit.</th><th class="num">Total</th><th>Situação</th></tr></thead><tbody>${sales.map(s=>`<tr><td class="strong">#${String(s.number).padStart(4,'0')}</td><td>${esc(s.customer_name||'Cliente a definir')}</td><td>${esc(s.seller_name||'Vendedor a definir')}</td><td>${s.business_date?filterDateLabel(s.business_date):date(s.created_at)}</td><td class="num">${s.quantity} un.</td><td class="num">${money(s.unit_price_cents)}</td><td class="num strong">${money(s.total_cents)}</td><td><span class="badge good">Confirmada</span></td></tr>`).join('')}</tbody></table></div>`:empty('Nenhuma venda confirmada deste produto','Abra Vender no menu lateral para iniciar uma venda.')}</section>`);if(product.serial_tracked)filterUnitRows(document.querySelector('#page'),'','available');
}
function productForm(product={},saleIndex=null) {
 productCreateContext=saleIndex===null?null:{work:working,item:working.items[saleIndex],owner:state.user.id};
 showModal(product.id?'Editar produto':'Novo produto',`<div class="fields">${field('Nome do produto',input('name',product.name??'','required maxlength="200"'),true)}${field('SKU (opcional)',input('sku',product.sku??'','maxlength="80"'))}${field('Preço sugerido',moneyInput(input('price',value(product.price_cents??0),'inputmode="decimal" required')))}</div><label class="check-field"><input type="checkbox" name="serial_tracked" ${product.serial_tracked?'checked':''}> Controlar por SN / IMEI</label><p class="footer-note">Para aparelhos como PS4 e celulares. Cada unidade tem seu número e custo. Cadastrar o produto não registra uma entrada. Estoque antigo não é duplicado; identifique os números reais nas entradas.</p>${product.id?input('edit_token',product.edit_token,'type="hidden"'):''}`,'product-form',`data-id="${product.id??''}"`);
}
function serialProductPanel(history) {
 const units=history.units??[],available=units.filter(u=>u.status==='available').length,unidentified=Math.max(0,history.product.stock-available);
 return `<section class="panel"><div class="panel-header"><h2>Aparelhos · ${available} disponíveis</h2></div><div class="panel-body"><div class="fields">${field('Buscar SN / IMEI','<input type="search" id="product-unit-query" placeholder="Digite o número" maxlength="120">')}${field('Mostrar','<select id="product-unit-status"><option value="available">Em estoque</option><option value="all">Todos</option><option value="sold">Vendidos</option><option value="removed">Entradas removidas</option></select>')}</div>${unidentified?`<p class="footer-note">${unidentified} unidade(s) antiga(s) sem SN / IMEI. Use Editar entrada para identificá-las sem aumentar o estoque.</p>`:''}${unitList(units,{esc,money,costs:can('costs.view')})}<p data-unit-empty hidden>Nenhum aparelho encontrado.</p></div></section>`;
}
function filterUnitRows(root,query,status='all') {
 let count=0;
 for(const row of root.querySelectorAll('[data-unit-row]')){row.hidden=!matchesCatalog(row.dataset.searchText,query)||(status!=='all'&&row.dataset.unitStatus!==status);if(!row.hidden)count++;}
 root.querySelector('[data-unit-empty]')?.toggleAttribute('hidden',count>0);
}
function trackedItem(item) {
 return !!item.tracks_serials||!!state.products.find(p=>p.id===item.product_id)?.serial_tracked&&!(working.status==='confirmed'&&item.id&&!item.tracks_serials);
}
function serialSaleField(item,index) {
 if(!trackedItem(item)&&!state.products.find(p=>p.id===item.product_id)?.serial_tracked)return '';
 const ids=item.unit_ids??[];
 return `<div class="serial-sale-field"><button type="button" class="small" data-action="select-sale-units" data-index="${index}">Escolher SN / IMEI · ${ids.length} selecionado(s)</button><small class="preserve">${esc(item.serial_number||'Selecione os aparelhos que sairão do estoque.')}</small></div>`;
}
async function openUnitPicker(index) {
 const item=working.items[index],owner=state.user.id,work=working;
 const units=await api(`/products/${item.product_id}/units`);
 if(state?.user.id!==owner||working!==work)return;
 const selected=item.unit_ids??[],other=new Set(working.items.filter(i=>i!==item).flatMap(i=>i.unit_ids??[])),original=new Set(working.original_unit_ids??[]);
 pickerUnits=units.filter(u=>!other.has(u.id)&&(u.status==='available'||u.status==='sold'&&original.has(u.id)));
 showModal('Escolher aparelhos',unitPicker(pickerUnits,selected,{esc,money,costs:can('costs.view')}),'sale-units-form',`data-index="${index}"`);
 modal.querySelector('[type="submit"]').textContent='Usar aparelhos selecionados';
}
function makeWorking(s=null) {
 const operationalStatusId=s?.operational_status?.id??'';
 return {server_base:s?JSON.parse(JSON.stringify(s)):null,server_conflict:false,updated_at:s?.updated_at,id:s?.id??null,created_by:s?.created_by??state.user.id,status:s?.status??'draft',number:s?.number,edit_token:s?.edit_token,draft_token:s?.draft_token,correction_request_id:crypto.randomUUID(),reason:'',business_date:brazilianDate(s?.business_date??saoPauloToday()),entry_costs:{},customer_id:s?.customer_id??'',seller_id:s?.seller_id??state.user.id,original_seller_id:s?.seller_id??null,original_seller_name:s?.seller_name??'',
 is_wholesale:!!s?.is_wholesale,original_is_wholesale:!!s?.is_wholesale,review_manual:!!s?.review?.manual,original_review_manual:!!s?.review?.manual,review_automatic:!!s?.review?.automatic,review_required:!!s?.review?.required,operational_status_id:operationalStatusId,original_operational_status_id:operationalStatusId,
 freight:s?.freight_cents!==undefined?value(s.freight_cents):'0,00', public_notes:s?.public_notes??'',
 original_unit_ids:s?s.items.flatMap(i=>i.unit_ids??[]):[],
 items:s?s.items.map(i=>({...i,original_unit_ids:[...(i.unit_ids??[])],price:value(i.unit_price_cents),cost:i.manual_cost_cents!=null?value(i.manual_cost_cents):'',manual_cost_known:'manual_cost_cents' in i})):[],
 payments:s?s.payments.map(p=>({...p,amount:value(p.amount_cents),saved:true,original_method:p.method,original_pix_account_id:p.pix_account_id??null,original_pix_account_name:p.pix_account_name??null,keep_card_rate:p.method==='card',paid_date:brazilianDate(saoPauloToday(new Date(p.created_at)))})):[],
 expenses:s?.expenses?.map(e=>({...e,amount:value(e.amount_cents)}))??[]};
}
function reconcileWorking(cached,latest) {
 // Rebase only a classification change. A newer token must never authorize
 // overwriting changes to items, people, payments or other sale information.
 const comparable=sale=>JSON.stringify(Object.fromEntries(Object.entries(sale).filter(([key])=>!['is_wholesale','review_manual','review','updated_at','edit_token','draft_token','customer_name','seller_name','store_name'].includes(key)).sort(([a],[b])=>a.localeCompare(b))));
 if(!cached.server_base||cached.id!==latest.id||comparable(cached.server_base)!==comparable(latest)){
  cached.server_conflict=true;return cached;
 }
 if(!!latest.is_wholesale!==cached.original_is_wholesale)cached.is_wholesale=!!latest.is_wholesale;
 cached.original_is_wholesale=!!latest.is_wholesale;
 if(!!latest.review?.manual!==cached.original_review_manual)cached.review_manual=!!latest.review?.manual;
 cached.original_review_manual=!!latest.review?.manual;cached.review_automatic=!!latest.review?.automatic;cached.review_required=!!latest.review?.required;
 if(cached.edit_token!==latest.edit_token||cached.draft_token!==latest.draft_token)cached.correction_request_id=crypto.randomUUID();
 for(const key of ['edit_token','draft_token','updated_at','number','created_by'])cached[key]=latest[key];
 cached.original_seller_id=latest.seller_id??null;cached.original_seller_name=latest.seller_name??'';
 cached.server_base=JSON.parse(JSON.stringify(latest));cached.server_conflict=false;
 return cached;
}
async function restoreWorking(cached,latest=null) {
 if(!cached.id)return cached;
 if(!latest){const epoch=sessionEpoch;await load();if(epoch!==sessionEpoch)throw Error('A sessão ou as permissões mudaram. Abra a venda novamente.');latest=await api(`/sales/${encodeURIComponent(cached.id)}`);}
 return reconcileWorking(cached,latest);
}
function workingConflictNotice(w) {
 return w.server_conflict?`<section class="alert working-conflict" role="alert"><strong>Esta venda mudou em outra tela.</strong><p>Seu preenchimento foi mantido, mas não pode substituir a venda atual. Confira os dados antes de continuar.</p><div class="actions"><button type="button" class="small" data-action="open-sale" data-id="${esc(w.id)}">Ver venda registrada</button><button type="button" class="small" data-action="review-current-sale">Conferir versão atual</button></div></section>`:'';
}
function workKey(work) {return work.id?'sale:'+work.id:(work.local_key??=crypto.randomUUID());}
function rememberWorking() {
 if(!working||!workingDirty)return;
 const key=workKey(working);forgetWorking(working);pendingWorks.delete(key);pendingWorks.set(key,working);
}
function forgetWorking(work) {for(const [key,entry] of pendingWorks)if(entry===work)pendingWorks.delete(key);}
function currentPageRoute() {
 return {view,...(view==='editor'&&working?{workKey:workKey(working),saleId:working.id}:{}),
 ...(view==='detail'?{saleId:detailId}:{}),...(view==='product-detail'?{productId:productHistory?.product.id,origin:productDetailReturnView}:{})};
}
async function navigateHistory(route) {
 rememberWorking();
 const next=route?.view??'dashboard',cached=route?.workKey&&pendingWorks.get(route.workKey);
 if(next==='editor'&&cached){working=await restoreWorking(cached);workingDirty=true;view='editor';}
 else if(next==='editor'&&route.saleId){await load();working=makeWorking(await api(`/sales/${encodeURIComponent(route.saleId)}`));workingDirty=false;view=working.status==='cancelled'?'sales':'editor';}
 else if(next==='detail'&&route.saleId){detailSale=await api(`/sales/${encodeURIComponent(route.saleId)}`);detailId=route.saleId;working=null;workingDirty=false;view='detail';}
 else if(next==='product-detail'&&route.productId){productHistory=await api(`/products/${encodeURIComponent(route.productId)}/history`);productDetailReturnView=route.origin==='stock'?'stock':'products';working=null;workingDirty=false;view=next;}
 else {working=null;workingDirty=false;view=navs.some(n=>n[0]===next&&!['new-sale','registry-menu','expense-menu'].includes(next))&&navAllowed(next)?next:'dashboard';}
 render();
}
function startSale(productId='',fresh=false) {
 if(!can('sales.create'))return;
 rememberWorking();
 if(!productId&&!fresh&&pendingWorks.size){
  showModal('Vendas em andamento',`<p>Continue um preenchimento ou inicie outra venda. Os anteriores ficam guardados nesta aba até você sair da conta ou recarregar.</p><div class="pending-sales">${[...pendingWorks].reverse().map(([key,w])=>`<div class="pending-sale"><button type="button" data-action="resume-work" data-id="${esc(key)}"><strong>${w.id?'Venda #'+String(w.number).padStart(4,'0'):'Nova venda'}${w.status==='confirmed'?' · edição':''}</strong><span>${esc(state.customers?.find(c=>c.id===w.customer_id)?.name??'Cliente a definir')} · ${w.items.length} item(ns)</span><b>Retomar →</b></button><button type="button" class="small subtle danger" data-action="discard-work" data-id="${esc(key)}">Descartar preenchimento</button></div>`).join('')}</div><button type="button" class="primary" data-action="fresh-sale">+ Iniciar nova venda</button>`,'pending-sales-form');
  modal.querySelector('form > .actions').remove();return;
 }
 working=makeWorking();
 const product=state.products.find(p=>p.id===productId);
 if(product)working.items.push({product_id:product.id,description:product.name,quantity:1,price:value(product.price_cents),cost:'',manual_cost_known:true});
 workingDirty=false;productHistory=null;view='editor';render();
}
function editorNumbers() {
 const total=working.items.reduce((s,i)=>s+cents(i.price)*Number(i.quantity||0),0);
 let gross=0, fees=0;
 for(const p of working.payments){const amount=cents(p.amount);gross+=amount;const rate=state.rates.find(r=>r.id===p.rate_id),basis=p.saved&&p.keep_card_rate?p.basis_points:rate?.basis_points;fees+=p.method==='card'?Number((BigInt(amount)*BigInt(basis??0)+5000n)/10000n):0;}
 return {total,gross,fees,diff:gross-total};
}
function normalizeCardSelection(payment) {
 const rates=state.rates,previous=rates.find(r=>r.id===payment.rate_id);
 if(previous&&!payment.machine_id)Object.assign(payment,{machine_id:previous.machine_id,brand_id:previous.brand_id,mode:previous.mode});
 const machines=cardMachines().filter(machine=>rates.some(r=>r.machine_id===machine.id));
 if(!machines.some(machine=>machine.id===payment.machine_id))payment.machine_id=machines.length===1?machines[0].id:'';
 const brands=(machines.find(machine=>machine.id===payment.machine_id)?.brands??[]).filter(brand=>rates.some(r=>r.machine_id===payment.machine_id&&r.brand_id===brand.id));
 if(!brands.some(brand=>brand.id===payment.brand_id))payment.brand_id=brands.length===1?brands[0].id:'';
 const brandRates=rates.filter(r=>r.machine_id===payment.machine_id&&r.brand_id===payment.brand_id),modes=['debit','credit'].filter(mode=>brandRates.some(r=>r.mode===mode));
 if(!modes.includes(payment.mode))payment.mode=modes.length===1?modes[0]:'';
 const available=brandRates.filter(r=>r.mode===payment.mode).sort((a,b)=>a.installments-b.installments);
 if(!available.some(r=>r.id===payment.rate_id))payment.rate_id=available.length===1?available[0].id:'';
 return {machines,brands,modes,available};
}
function changeCardSelection(payment,key,next) {
 payment[key]=next;
 if(key==='machine_id'){payment.brand_id='';payment.mode='';payment.rate_id='';}
 if(key==='brand_id'){payment.mode='';payment.rate_id='';}
 if(key==='mode')payment.rate_id='';
 normalizeCardSelection(payment);
}
function cardPaymentFields(payment,index=null) {
 const {machines,brands,modes,available}=normalizeCardSelection(payment),attrs=key=>index===null?`name="${key}" data-modal-card="${key}"`:`data-card-payment="${index}" data-card-select="${key}"`,selected=state.rates.find(r=>r.id===payment.rate_id);
 return `<div class="card-payment-fields ${index===null?'full-field':'payment-rate'}">${field('Máquina',`<select ${attrs('machine_id')} required>${option('','Selecione a máquina',payment.machine_id)}${machines.map(m=>option(m.id,m.name,payment.machine_id)).join('')}</select>`)}${field('Bandeira',`<select ${attrs('brand_id')} ${brands.length?'required':'disabled'}>${option('','Selecione a bandeira',payment.brand_id)}${brands.map(b=>option(b.id,b.name,payment.brand_id)).join('')}</select>`)}${field('Modalidade',`<select ${attrs('mode')} ${modes.length?'required':'disabled'}>${option('','Selecione',payment.mode)}${modes.map(mode=>option(mode,mode==='debit'?'Débito':'Crédito',payment.mode)).join('')}</select>`)}${field('Parcelas',`<select ${attrs('rate_id')} ${available.length?'required':'disabled'}>${option('','Selecione',payment.rate_id)}${available.map(r=>option(r.id,r.mode==='debit'?'À vista':`${r.installments}x`,payment.rate_id)).join('')}</select>`)}${!machines.length?'<small class="card-rate-note">Cadastre uma máquina e suas taxas em Cadastro → Máquinas de cartão.</small>':selected?.basis_points!==undefined?`<small class="card-rate-note">Taxa desta opção: <strong>${value(selected.basis_points)}%</strong></small>`:''}</div>`;
}
function paymentAccountField(payment,index) {
 if(payment.saved&&!paymentEditable(payment)){
  const description=payment.method==='card'?`${payment.machine} · ${payment.brand} · ${payment.installments}x`:payment.method==='pix'?pixAccountSnapshot(payment):'Dinheiro registrado';
  return `<label class="field payment-rate">${payment.method==='card'?'Máquina / bandeira / parcelas':payment.method==='pix'?'Conta Pix':'Identificação'}<input disabled value="${esc(description)}"></label>`;
 }
 if(payment.saved&&payment.method==='card'&&payment.keep_card_rate){
  return `<div class="field payment-rate"><span>Cartão registrado</span><p class="payment-original">${esc(payment.machine)} · ${esc(payment.brand)} · ${payment.installments}x${payment.basis_points!==undefined?' · '+value(payment.basis_points)+'%':''}</p><button type="button" class="small" data-action="change-saved-card" data-index="${index}">Alterar máquina, bandeira ou parcelas</button><small>Sem alterar o cartão, a taxa original é mantida.</small></div>`;
 }
 if(payment.method==='card')return cardPaymentFields(payment,index);
 if(payment.method==='pix'){
  if(payment.saved&&payment.original_method==='pix'){
   const accounts=activePixAccounts(),original=payment.original_pix_account_id??'',selected=payment.pix_account_id??'',options=accounts.map(a=>option(a.id,a.name,selected)).join('');
   return `<label class="field payment-rate">Conta Pix<select data-payment="${index}" data-key="pix_account_id">${accounts.some(a=>a.id===original)?'':option(original,payment.original_pix_account_name||'Sem conta no registro original',selected)}${options}</select></label>`;
  }
  const accounts=activePixAccounts();payment.pix_account_id=defaultPixAccountId(payment.pix_account_id);
  return `<label class="field payment-rate">Conta Pix<select data-payment="${index}" data-key="pix_account_id" ${accounts.length?'required':'disabled'}>${accounts.length?pixAccountOptions(payment.pix_account_id):'<option>Cadastre uma conta Pix em Configurações</option>'}</select>${accounts.length?'':'<small class="field-guidance">Nenhuma conta Pix ativa. Cadastre uma em Configurações antes de salvar.</small>'}</label>`;
 }
 return '<label class="field payment-rate">Identificação<input disabled value="Dinheiro · sem conta ou taxa"></label>';
}
function paymentEditable(payment){return !payment.saved||working.status==='confirmed'&&can('payments.correct');}
function changePaymentMethod(payment,method){
 payment.method=method;payment.keep_card_rate=payment.saved&&method==='card'&&payment.original_method==='card';payment.rate_id='';
 if(method==='pix'&&!(payment.saved&&payment.original_method==='pix'))payment.pix_account_id=defaultPixAccountId(payment.pix_account_id);
}
function editorSellerOptions(w){
 const original=w.original_seller_id,missing=original&&!state.users.some(u=>u.id===original);
 return option('','Selecione o vendedor',w.seller_id)+(missing?option(original,`${w.original_seller_name||'Vendedor original'} (inativo)`,w.seller_id):'')+state.users.filter(u=>u.id===state.user.id||u.id===original||can('sales.assign_seller')).map(u=>option(u.id,u.name,w.seller_id)).join('');
}
function paymentEditorRows(){
 return working.payments.map((p,n)=>`<section class="editable-payment"><div class="payment-row"><label class="field payment-method">Forma<select data-payment="${n}" data-key="method" ${paymentEditable(p)?'':'disabled'}>${Object.entries(methods).map(([v,l])=>option(v,l,p.method)).join('')}</select></label>${paymentAccountField(p,n)}<label class="field payment-value">Valor pago<input inputmode="decimal" data-payment="${n}" data-key="amount" value="${esc(p.amount)}" ${paymentEditable(p)?'':'disabled'}></label>${paymentEditable(p)?`<button class="subtle danger delete" data-action="remove-payment" data-index="${n}" aria-label="Remover pagamento ${n+1}">${icon('x')}</button>`:'<span class="badge good">Registrado</span>'}</div>${working.status==='confirmed'?`<label class="field payment-date">Data do pagamento<input data-date-kind="date" inputmode="numeric" maxlength="10" placeholder="DD/MM/AAAA" data-payment="${n}" data-key="paid_date" value="${esc(p.paid_date??brazilianDate(saoPauloToday()))}" ${paymentEditable(p)?'':'disabled'}></label>`:''}</section>`).join('');
}
function entryCostsFields(item,index){
 if(!item.product_id||working.status!=='confirmed'||!can('stock.correct')||!can('stock.receive')||!can('costs.enter')||!can('costs.view'))return '';
 const entries=state.stock_entries.filter(e=>e.product_id===item.product_id&&!e.voided_at);
 return `<details class="item-entry-costs" ${item.costs_open?'open':''}><summary>Corrigir custo nas entradas deste produto</summary><p>O custo vem das entradas. A alteração será salva junto com a venda e também poderá afetar outras vendas que usaram o mesmo lote.</p>${entries.length?entries.map(e=>field(`Entrada ${date(e.received_at)} · ${e.quantity_initial} un. · ${esc(e.supplier_name||'Sem fornecedor')}`,`<input inputmode="decimal" data-entry-cost="${e.id}" data-item-cost-index="${index}" value="${esc(working.entry_costs[e.id]?.value??value(e.unit_cost_cents))}" aria-label="Custo unitário da entrada de ${esc(e.product_name)}">`)).join(''):'<p>Nenhuma entrada ativa. Registre uma entrada no menu Estoque para informar o custo.</p>'}</details>`;
}
function itemDetailsFields(item,index) {
 const open=item.details_open??!!(item.serial_number||item.details);
 return `<button type="button" class="small item-details-toggle" data-action="item-details" data-index="${index}" aria-expanded="${open}" aria-controls="item-details-${index}">${icon('plus')} IMEI / SN e detalhes <span class="badge">Opcional</span></button><div id="item-details-${index}" class="item-details-fields" ${open?'':'hidden'}><div class="fields">${field('IMEI ou número de série (SN)',`<textarea rows="2" data-item="${index}" data-key="serial_number" maxlength="1000" ${trackedItem(item)?'readonly':''} placeholder="Digite ou cole a identificação. Para mais de uma unidade, use uma linha por aparelho.">${esc(item.serial_number??'')}</textarea>`)}${field('Detalhes do produto',`<textarea rows="2" data-item="${index}" data-key="details" maxlength="2000" placeholder="Ex.: cor, armazenamento, condição ou acessórios.">${esc(item.details??'')}</textarea>`)}</div><label class="check-field"><input type="checkbox" data-item="${index}" data-key="share_details" ${item.share_details?'checked':''}> Mostrar a identificação e os detalhes no pedido do cliente</label><p class="footer-note">Sem marcar, estas informações ficam apenas no sistema. ${trackedItem(item)?'A saída usa os aparelhos selecionados e seus respectivos custos.':'Este campo é uma observação e não altera o estoque.'}</p></div>`;
}
function editorSaleDate(w) {
 return field('Data da venda',`<input data-bind="business_date" data-date-kind="date" inputmode="numeric" maxlength="10" placeholder="DD/MM/AAAA" autocomplete="off" required data-max-date="${saoPauloToday()}" aria-label="Data da venda (DD/MM/AAAA)" aria-describedby="sale-date-hint" value="${esc(w.business_date)}"><small id="sale-date-hint">Hoje por padrão. Altere para registrar em outro dia.</small>`,true);
}
function editorCustomerField(w) {
 return `<div class="field full editor-customer-field"><div class="customer-field-heading"><label for="sale-customer">Cliente</label><span class="customer-create-slot">${can('customers.manage')?'<button type="button" class="small customer-create" data-action="modal-customer">+ Novo cliente</button>':''}</span></div><select id="sale-customer" data-bind="customer_id">${option('','Selecione o cliente',w.customer_id)}${state.customers.map(c=>option(c.id,c.name,w.customer_id)).join('')}</select></div>`;
}
function editorSaleStatusField(w) {
 const operational=can('sales.change_status')?`<select data-bind="operational_status_id" aria-labelledby="editor-status-label" aria-describedby="editor-status-hint">${operationalOptions(w.operational_status_id)}</select>`:operationalBadge(saleStatuses().find(s=>s.id===w.operational_status_id));
 return `<div class="field sale-editor-status-field"><span id="editor-status-label">Status da venda</span><div class="sale-editor-status-line">${operational}${saleReviewEditor(w)}</div><small id="editor-status-hint">O status operacional acompanha o andamento. “A conferir” apenas sinaliza uma revisão e não muda a confirmação.</small></div>`;
}
async function saveCustomerForm(data,form) {
 const key=form?.dataset.id;
 const customer=await api(key?`/customers/${key}`:'/customers',data,key?'PUT':'POST');
 state.customers=[...state.customers.filter(c=>c.id!==customer.id),customer].sort((a,b)=>a.name.localeCompare(b.name,'pt-BR'));
 if(!key&&view==='editor'&&working){working.customer_id=customer.id;workingDirty=true;}
 if(key){
  salesRefreshPending=true;
  for(const sale of state.sales??[])if(sale.customer_id===customer.id&&sale.status!=='cancelled')sale.customer_name=customer.name;
  if(detailSale?.customer_id===customer.id&&detailSale.status!=='cancelled')detailSale.customer_name=customer.name;
 }
 modal.close();render();toast(key?'Dados do cliente atualizados.':view==='editor'?'Cliente cadastrado e selecionado nesta venda.':'Cliente cadastrado.');
}
function moneyInput(html) { return `<span class="money-input"><span aria-hidden="true">R$</span>${html}</span>`; }
function saleItemMarkup(i,n) {
 const product=i.product_id,tracked=trackedItem(i),nameId='sale-item-name-'+n;
 return `<div class="sale-item"><div class="item-row">
 <div class="field item-product"><div class="product-field-heading"><label for="sale-product-${n}">Produto</label>${can('products.manage')?`<button type="button" class="small subtle" data-action="create-sale-product" data-index="${n}">+ Cadastrar novo produto</button>`:''}</div>
 <select id="sale-product-${n}" data-item="${n}" data-key="product_id" data-search="product" aria-label="Buscar produto no estoque">${option('','Produto avulso — sem cadastro',product??'')}${state.products.map(p=>option(p.id,p.name+(p.sku?' · '+p.sku:'')+' · saldo '+p.stock,product)).join('')}</select>
 <label class="item-name-label" for="${nameId}">${product?'Descrição nesta venda':'Nome do produto avulso'}</label><input id="${nameId}" class="avulso-field" aria-label="${product?'Descrição nesta venda':'Nome do produto avulso'}" data-item="${n}" data-key="description" maxlength="200" value="${esc(i.description)}">
 ${product?'':'<small>Só nesta venda. Para incluir no catálogo, use Cadastrar novo produto.</small>'}${serialSaleField(i,n)}</div>
 <div class="item-values"><label class="field item-quantity"><span>Qtd.</span><input type="number" min="1" step="1" data-item="${n}" data-key="quantity" value="${i.quantity}" ${tracked?'readonly aria-label="Quantidade de aparelhos selecionados"':''}></label>
 <label class="field item-price"><span>Preço unitário</span>${moneyInput(`<input aria-label="Preço unitário em reais" inputmode="decimal" data-item="${n}" data-key="price" value="${esc(i.price)}">`)}</label>
 <label class="field item-cost"><span>Custo interno</span>${product?`<input disabled value="${tracked?'Por SN':'FIFO'}">`:can('costs.enter')?moneyInput(`<input aria-label="Custo interno em reais" inputmode="decimal" placeholder="Pendente" data-item="${n}" data-key="cost" value="${esc(i.cost)}">`):'<input disabled value="Restrito">'}</label></div>
 <button type="button" class="subtle danger delete" data-action="remove-item" data-index="${n}" aria-label="Remover produto">${icon('x')}<span>Remover produto</span></button></div>${entryCostsFields(i,n)}${itemDetailsFields(i,n)}</div>`;
}
function selectCatalogProduct(item,p) {
 item.product_id=p?.id??null;item.description=p?.name??'';item.cost='';item.manual_cost_known=true;
 item.serial_number='';item.details='';item.share_details=false;item.details_open=false;item.unit_ids=[];item.original_unit_ids=[];item.tracks_serials=!!p?.serial_tracked;
 if(p){item.price=value(p.price_cents);if(p.serial_tracked)item.quantity=1;}
}
async function saveProductForm(data,form) {
 const key=form.dataset.id,context=productCreateContext,owner=state.user.id;
 const product=await api(key?`/products/${key}`:'/products',{name:data.name,sku:data.sku,price_cents:cents(data.price),serial_tracked:new FormData(form).has('serial_tracked'),...(key?{edit_token:data.edit_token}:{})},key?'PUT':'POST');
 if(state?.user.id!==owner)return;
 const previous=state.products.find(p=>p.id===product.id);
 state.products=[...state.products.filter(p=>p.id!==product.id),{stock:0,...previous,...product}].sort((a,b)=>a.name.localeCompare(b.name,'pt-BR'));
 if(!key&&context&&context.owner===owner&&working===context.work&&working.items.includes(context.item)){selectCatalogProduct(context.item,product);workingDirty=true;}
 if(view==='product-detail'&&productHistory?.product.id===product.id)productHistory=await api(`/products/${product.id}/history`);
 modal.close();render();toast(key?'Produto atualizado.':context?'Produto cadastrado e selecionado na venda.':'Produto cadastrado.');
}
function renderEditor() {
 const w=working;
page(workingConflictNotice(w)+heading(w.status==='confirmed'?`Editar venda #${String(w.number).padStart(4,'0')}`:w.id?'Editar rascunho':'Nova venda','Preço da venda e pagamentos são informados separadamente.',`<div class="actions"><button data-view="sales">Voltar</button>${cancelSaleButton(w,{esc,can})}</div>`)+`<div class="sale-editor"><div><section class="panel"><div class="panel-body"><div class="section-title"><h2><span class="step">1</span>Cliente, vendedor e status</h2></div><div class="sale-editor-flags">${wholesaleEditor(w.is_wholesale)}</div><div class="fields">${editorSaleDate(w)}${editorCustomerField(w)}${field('Vendedor',`<select data-bind="seller_id">${editorSellerOptions(w)}</select>`)}${editorSaleStatusField(w)}</div></div></section>
 <section class="panel"><div class="panel-body"><div class="section-title"><div><h2><span class="step">2</span>Produtos da venda</h2><p>Selecione um produto cadastrado ou adicione um avulso.</p></div></div><div>${w.items.map(saleItemMarkup).join('')||`<p class="muted payment-hint">${w.status==='confirmed'?'Adicione pelo menos um produto para salvar a correção.':'Ainda não há produtos. O rascunho pode ser salvo assim.'}</p>`}</div><button class="small" data-action="add-item">${icon('plus')} Adicionar produto</button></div></section>
 <section class="panel"><div class="panel-body"><div class="section-title"><div><h2><span class="step">3</span>Pagamentos</h2><p>Confira os valores brutos, contas e cartões utilizados.</p></div></div><div id="payment-alert" role="status" aria-live="polite"></div>${paymentEditorRows()}${can('payments.record')?'<button class="small" data-action="add-payment">+ Adicionar pagamento</button>':''}${w.status==='confirmed'?'<p class="footer-note">Correções e remoções só serão gravadas em Salvar alterações, com histórico. Não há cobrança nem estorno bancário automático.</p>':''}</div></section>
 ${can('costs.view')?`<section class="panel"><div class="panel-body"><div class="section-title"><div><h2>Frete e outras despesas</h2><p>Somente despesas da loja. Não aparecem para o cliente.</p></div></div><div class="fields">${field('Frete pago pela loja',`<input data-bind="freight" inputmode="decimal" value="${esc(w.freight)}" ${can('costs.enter')?'':'disabled'}>`)}</div>${w.expenses.map((e,n)=>`<div class="payment-row expense-row"><label class="field payment-rate">Descrição<input data-expense="${n}" data-key="description" value="${esc(e.description)}" ${can('costs.enter')?'':'disabled'}></label><label class="field payment-value">Valor<input inputmode="decimal" data-expense="${n}" data-key="amount" value="${esc(e.amount)}" ${can('costs.enter')?'':'disabled'}></label>${can('costs.enter')?`<button class="subtle danger delete" data-action="remove-expense" data-index="${n}" aria-label="Remover despesa">${icon('x')}</button>`:''}</div>`).join('')}${can('costs.enter')?'<button class="small subtle" data-action="add-expense">+ Outra despesa</button>':'<p class="footer-note">Seu usuário pode consultar estas despesas, mas não alterá-las.</p>'}</div></section>`:''}
 <section class="panel"><div class="panel-body">${field('Observação para o cliente',`<textarea rows="3" data-bind="public_notes" maxlength="2000">${esc(w.public_notes)}</textarea>`)}<p class="footer-note">Este campo aparece no compartilhamento. Não inclua custos ou informações internas.</p></div></section></div>
 <aside class="panel summary"><div class="panel-header"><h2>Resumo da venda</h2><span class="badge">${w.status==='confirmed'?'Correção':'Rascunho'}</span></div><div class="panel-body"><div id="editor-summary"></div><div class="summary-actions">${w.status==='confirmed'?`${field('Motivo da edição',`<textarea data-bind="reason" rows="3" maxlength="500" placeholder="Explique o que está corrigindo.">${esc(w.reason)}</textarea>`)}<button class="primary" data-action="save-correction">Salvar alterações</button><p class="footer-note">Produtos, datas, custos, despesas e pagamentos podem ser corrigidos conforme suas permissões. O histórico é preservado; estoque e lucro serão recalculados. Mudanças em meses fechados são bloqueadas.</p>`:`<button class="primary" data-action="confirm-draft" ${can('sales.confirm')?'':'disabled'}>${icon('check')} Confirmar venda</button><button data-action="save-draft">Salvar rascunho</button>`}</div><p class="footer-note" ${w.status==='confirmed'?'hidden':''}>Rascunhos não baixam estoque. Pagamentos novos são registrados ao salvar. Após confirmar, podem ser corrigidos pela edição da venda. A confirmação permite pagamento pendente e estoque negativo, com aviso.</p><p class="error" id="editor-error" role="alert"></p></div></aside></div>`);
 updateSummary();
 saleMobileSteps(document.querySelector('.sale-editor'),w,{cents});
}
function updateSummary() {
 try{
  const n=editorNumbers(), alert=document.querySelector('#payment-alert'), error=document.querySelector('#editor-error');
  if(!alert)return;
  if(error)error.textContent='';
 alert.className=`alert ${n.diff===0?'good':n.diff>0?'bad':''}`;
 alert.textContent=n.diff===0?'Os pagamentos conferem com o total da venda.':n.diff<0?`Pagamento abaixo do total: faltam ${money(-n.diff)}.`:`Pagamento acima do total: diferença de ${money(n.diff)}. Verifique os valores.`;
 document.querySelector('#editor-summary').innerHTML=`<div class="summary-total"><div class="eyebrow">TOTAL DA VENDA ${wholesaleBadge(working)}</div><div class="metric-value">${money(n.total)}</div><p class="muted">${working.items.reduce((s,i)=>s+Number(i.quantity||0),0)} produtos</p></div><div class="row-stat"><span>Pagamentos brutos</span><strong>${money(n.gross)}</strong></div>${can('costs.view')?`<div class="row-stat"><span>Taxas do cartão</span><strong>${money(n.fees)}</strong></div><div class="row-stat"><span>Líquido registrado</span><strong>${money(n.gross-n.fees)}</strong></div>`:''}<div class="row-stat"><span>${n.diff>0?'Informado a mais':'Falta registrar'}</span><strong>${money(Math.abs(n.diff))}</strong></div><p class="stat-note">${can('profit.view')?'O resultado será apurado após confirmar a venda e identificar os custos FIFO.':'As informações financeiras seguem suas permissões.'}</p>`;
 }catch(e){document.querySelector('#editor-error').textContent=e.message;}
}
function renderDetail() {
 const s=detailSale?.id===detailId?detailSale:state.sales.find(s=>s.id===detailId); if(!s){view='sales';render();return;}
 if(s.status==='cancelled'){page(heading(`Venda #${String(s.number).padStart(4,'0')} · Cancelada`,'Histórico preservado. Não entra nos totais de vendas ou lucro.',`<button data-view="sales">Voltar às vendas</button>`)+cancelledRecord(s,{esc,money,date,statusBadge,showDetails:false})+refundManagement(s,{esc,money,date,can})+cancellationPayments(s,{esc,money})+`<section class="panel"><div class="panel-body"><h2>Cancelamento</h2><p>${date(s.cancellation.created_at)} · ${esc(s.cancellation.author)}</p><p class="preserve">${esc(s.cancellation.reason)}</p><p class="muted">Se havia baixa de estoque, ela foi desfeita. Rascunhos e produtos avulsos não movimentam estoque.</p><p class="muted">Confira taxas, frete e despesas não recuperados do pedido cancelado antes do fechamento.</p></div></section>`);return;}
 page(heading(`Venda #${String(s.number).padStart(4,'0')}`,`${esc(s.customer_name??'Cliente a definir')} · ${esc(s.seller_name??'Vendedor a definir')} · ${date(s.business_date?`${s.business_date}T12:00:00-03:00`:s.created_at)}`,`<div class="actions"><button data-view="sales">Voltar às vendas</button>${cancelSaleButton(s,{esc,can})}${((s.status==='draft'&&can('sales.edit_draft'))||(s.status==='confirmed'&&can('sales.edit_confirmed')))?`<button data-action="edit-sale" data-id="${s.id}">Editar venda</button>`:''}${can('sales.share')?`<button class="primary" data-action="share-sale" data-id="${s.id}">${icon('share')} Compartilhar</button>`:''}</div>`)+
 `<div class="sale-state-strip" role="group" aria-label="Status da venda"><div class="sale-state-field"><span>Status operacional</span>${operationalStatusControl(s,'detalhe')}</div><div class="sale-state-field sale-state-summary"><span>Status da venda</span><div class="sale-state-values">${statusBadge(s)}${paymentBadge(s)}${saleReviewControl(s,'detalhe')}</div></div></div><div class="actions detail-badges">${wholesaleControl(s,{esc,can})}<span class="badge ${s.profit_state==='complete'?'good':'warn'}">${s.profit_state==='complete'?'Resultado completo':s.profit_state==='pending_cost'?'Custo pendente':s.profit_state==='draft'?'Ainda não confirmada':'Resultado provisório'}</span></div><br>
 <div class="detail-grid">${metric('Total vendido',money(s.total_cents),'Preço informado na venda','money')}${metric('Pagamento bruto',money(s.reconciliation.gross_cents),'Antes das taxas','money')}${can('profit.view')?metric('Lucro apurado',s.profit_cents===null?'Pendente':money(s.profit_cents),s.provisional_profit_cents!==null&&s.profit_cents===null?`Provisório: ${money(s.provisional_profit_cents)}`:'Frete, despesas e taxas descontados','trend',true):metric('Saldo pendente',money(s.reconciliation.pending_cents),'Diferença de pagamentos','clock')}</div>
 <div class="panel"><div class="panel-header"><h2>Produtos vendidos</h2></div><div class="table-wrap"><table><thead><tr><th>Produto</th><th class="num">Quantidade</th><th class="num">Preço unit.</th><th class="num">Total</th>${can('costs.view')?'<th class="num">Custo do item</th>':''}</tr></thead><tbody>${s.items.map(i=>`<tr><td class="strong">${((s.status==='confirmed'&&can('sales.edit_confirmed'))||(s.status==='draft'&&can('sales.edit_draft')))?`<button class="link-button" data-action="edit-sale" data-id="${s.id}" data-item-id="${i.id}" aria-label="Editar produto ${esc(i.description)}">${esc(i.description)}</button>`:esc(i.description)}<small>${i.product_id?(i.tracks_serials?'Produto cadastrado · custo por aparelho':'Produto cadastrado · FIFO'):'Avulso · sem movimentação de estoque'}</small>${i.serial_number?`<small class="preserve">IMEI / SN: ${esc(i.serial_number)}</small>`:''}${i.details?`<small class="preserve">${esc(i.details)}</small>`:''}${i.serial_number||i.details?`<small>${i.share_details?'Incluído no pedido do cliente':'Somente no sistema'}</small>`:''}</td><td class="num">${i.quantity}</td><td class="num">${money(i.unit_price_cents)}</td><td class="num">${money(i.quantity*i.unit_price_cents)}</td>${can('costs.view')?`<td class="num">${i.pending_cost_quantity?'Pendente':money(i.cost_cents)}</td>`:''}</tr>`).join('')}</tbody></table></div></div>
 <div class="panel"><div class="panel-header"><h2>Pagamentos registrados</h2>${can('payments.record')?`<button class="small" data-action="modal-payment" data-id="${s.id}">+ Registrar pagamento</button>`:''}</div>${s.payments.length?`<div class="table-wrap"><table><thead><tr><th>Forma</th><th>Detalhes</th><th class="num">Valor bruto</th>${can('costs.view')?'<th class="num">Taxa</th><th class="num">Líquido</th>':''}</tr></thead><tbody>${s.payments.map(p=>`<tr><td class="strong">${methods[p.method]}</td><td>${p.method==='card'?esc(`${p.machine} · ${p.brand} · ${p.installments}x`):p.method==='pix'?esc(pixAccountSnapshot(p)):'—'}</td><td class="num">${money(p.amount_cents)}</td>${can('costs.view')?`<td class="num">${money(p.fee_cents)}</td><td class="num">${money(p.amount_cents-p.fee_cents)}</td>`:''}</tr>`).join('')}</tbody></table></div>`:empty('Nenhum pagamento registrado','A venda pode continuar pendente e receber pagamentos depois.')}</div>
 ${can('costs.view')?`<div class="panel"><div class="panel-body"><div class="row-stat"><span>Frete pago pela loja</span><strong>${money(s.freight_cents)}</strong></div>${s.expenses.map(e=>`<div class="row-stat"><span>${esc(e.description)}</span><strong>${money(e.amount_cents)}</strong></div>`).join('')}</div></div>`:''}<div class="panel"><div class="panel-body"><h3>Observação para o cliente</h3><p class="preserve muted">${esc(s.public_notes||'Nenhuma observação.')}</p></div></div>${s.corrections?.length?`<section class="panel"><div class="panel-header"><h2>Histórico de correções</h2></div><div class="panel-body">${s.corrections.map(c=>`<div class="correction-record"><strong>${date(c.created_at)} · ${esc(c.author)}</strong><p>${esc(c.reason)}</p></div>`).join('')}</div></section>`:''}<p class="footer-note">A edição permite corrigir os lançamentos, sem cobrar ou estornar no banco. Para cancelar, use Cancelar venda e confirme o retorno dos produtos. O sistema não realiza estorno bancário.</p>`);
}
function showCancellationRefresh() {
 page(heading('Venda cancelada','O cancelamento foi registrado. Atualize os dados para continuar.',`<button data-action="refresh-after-cancellation">Atualizar dados</button>`));
}
async function submitSaleCancellation(form,data) {
 const fields=new FormData(form),key=form.dataset.id;
 if(form.dataset.unsaved==='true'&&!fields.has('acknowledge_unsaved_changes'))throw Error('Confirme que as alterações não salvas não serão aplicadas.');
 await api(`/sales/${key}/cancel`,{request_id:data.request_id,edit_token:data.edit_token,reason:data.reason,acknowledge_stock_return:new FormData(form).has('acknowledge_stock_return'),acknowledge_refund_pending:new FormData(form).has('acknowledge_refund_pending')});
 // Preserve the draft on dismissal or request failure; clear it only after success.
 for(const [pendingKey,entry] of pendingWorks)if(entry.id===key)pendingWorks.delete(pendingKey);
 if(working?.id===key){working=null;workingDirty=false;}
 modal.close();detailId=key;detailSale=null;view='detail';
 page(heading('Venda cancelada','O cancelamento foi registrado. Atualizando o histórico…'));
 try{await load();cancellationRefreshPending=false;render();}
 catch(error){if(state){cancellationRefreshPending=true;showCancellationRefresh();}throw error;}
 toast('Venda cancelada. Histórico preservado e estoque atualizado.');
}

async function openCancelSale(key) {
 if(!can('sales.cancel'))throw Error('Você não tem permissão para cancelar vendas.');
 const s=await api(`/sales/${key}`);
 if(s.status==='cancelled')throw Error('Esta venda já está cancelada.');
 const refund=s.reconciliation.gross_cents;
 const unsaved=(view==='editor'&&working?.id===key&&workingDirty)||pendingWorks.has('sale:'+key);
 showModal(`Cancelar venda #${String(s.number).padStart(4,'0')}`,`<p><strong>${esc(s.customer_name||'Cliente a definir')} · ${money(s.total_cents)}</strong></p>${unsaved?'<label class="check-field cancellation-ack"><input type="checkbox" name="acknowledge_unsaved_changes" required>Entendi que minhas alterações não salvas não serão aplicadas. Vou cancelar a venda já registrada.</label>':''}<p>A venda ficará no histórico como <strong>Cancelada</strong>, fora dos totais de vendas e lucro. Se havia baixa de estoque, ela será desfeita. Rascunhos e produtos avulsos não movimentam estoque. Esta ação não pode ser desfeita.</p>${refund>0?`<div class="refund-cancel-notice"><strong>Devolução pendente: ${money(refund)}</strong><p>Todo o valor recebido ficará a devolver ao cliente, sem descontar taxas. Não haverá estorno bancário automático.</p></div><label class="check-field cancellation-ack"><input type="checkbox" name="acknowledge_refund_pending" required>Entendi que ${money(refund)} ficará como devolução pendente.</label>`:''}<input type="hidden" name="request_id" value="${paymentRequestId()}"><input type="hidden" name="edit_token" value="${esc(s.edit_token)}">${field('Motivo do cancelamento','<textarea name="reason" required maxlength="500" rows="3" placeholder="Ex.: cliente desistiu da compra"></textarea>',true)}<label class="check-field cancellation-ack"><input type="checkbox" name="acknowledge_stock_return" required>Confirmo que os produtos não saíram da loja ou já foram devolvidos. Se a venda é avulsa, não há movimentação de estoque.</label>`,'cancel-sale-form',`data-id="${esc(key)}" data-unsaved="${unsaved}"`);
 const submit=modal.querySelector('[type="submit"]');submit.textContent='Confirmar cancelamento';submit.className='danger';modal.querySelector('form [data-action="close-modal"]').textContent='Voltar';
}
async function openRefundModal(key) {
 if(!can('sales.refund'))throw Error('Você não tem permissão para registrar devoluções.');
 const s=await api(`/sales/${key}`),cancellation=s.cancellation;
 if(s.status!=='cancelled'||!cancellation)throw Error('Somente uma venda cancelada pode registrar devolução.');
 if(cancellation.refund_pending_cents<=0)throw Error('Esta devolução já foi concluída.');
 const today=saoPauloToday(),cancelledOn=saoPauloToday(new Date(cancellation.created_at));
 showModal('Registrar devolução realizada',`<div class="refund-modal-balance"><span>Falta devolver ao cliente</span><strong>${money(cancellation.refund_pending_cents)}</strong></div><p class="refund-modal-guidance">Use esta tela <strong>depois</strong> que o dinheiro tiver sido devolvido ao cliente. O sistema apenas registra a baixa; ele não faz Pix nem estorno no cartão.</p><input type="hidden" name="request_id" value="${paymentRequestId()}"><input type="hidden" name="refund_token" value="${esc(cancellation.refund_token)}"><div class="fields">${field('Valor que já foi devolvido',`<span class="money-input"><span>R$</span><input name="amount" value="${esc(value(cancellation.refund_pending_cents))}" inputmode="decimal" autocomplete="off" required></span>`,true)}${field('Meio usado',`<select name="method">${refundMethodOptions('pix',esc)}</select>`)}${field('Data da devolução',input('refunded_date',today,`type="date" required min="${cancelledOn}" max="${today}"`))}${field('Observação (opcional)','<textarea name="notes" maxlength="1000" rows="2" placeholder="Ex.: devolvido para a mesma conta Pix"></textarea>',true)}</div><label class="check-field cancellation-ack"><input type="checkbox" name="acknowledge_refund_completed" required>Confirmo que este valor já foi realmente devolvido ao cliente fora do sistema.</label>`,'refund-form',`data-id="${esc(key)}"`);
 const submit=modal.querySelector('[type="submit"]');submit.textContent='Registrar como devolvido';
 modal.querySelector('form [data-action="close-modal"]').textContent='Voltar';
}
async function openRefundCorrectionModal(key,refundKey) {
 if(!can('sales.refund_correct'))throw Error('Você não tem permissão para corrigir baixas de devolução.');
 const s=await api(`/sales/${key}`),cancellation=s.cancellation;
 if(s.status!=='cancelled'||!cancellation)throw Error('Somente uma venda cancelada pode corrigir uma devolução.');
 const refund=cancellation.refunds?.find(item=>item.id===refundKey);
 if(!refund)throw Error('Baixa de devolução não encontrada.');
 if(refund.reversed)throw Error('Esta baixa já foi corrigida.');
 const today=saoPauloToday();
 showModal('Corrigir baixa de devolução',`<div class="refund-modal-balance"><span>Valor que voltará a ficar pendente</span><strong>${money(refund.amount_cents)}</strong></div><p class="refund-modal-guidance">Use somente quando a baixa tiver sido <strong>lançada por engano</strong>. A correção mantém o histórico e faz o valor voltar a aparecer como pendente. Ela não cobra o cliente, não recupera um Pix e não desfaz estorno de cartão.</p><input type="hidden" name="request_id" value="${paymentRequestId()}"><input type="hidden" name="refund_token" value="${esc(cancellation.refund_token)}"><div class="fields">${field('Data da correção',input('reversed_date',today,`type="date" required min="${esc(refund.refunded_date)}" max="${today}"`))}${field('Motivo da correção','<textarea name="reason" maxlength="500" rows="3" required placeholder="Ex.: baixa registrada no pedido errado"></textarea>',true)}</div><label class="check-field cancellation-ack"><input type="checkbox" name="acknowledge_refund_reversal" required>Confirmo que estou corrigindo somente o registro. O valor voltará a ficar pendente neste pedido.</label>`,'refund-reversal-form',`data-id="${esc(key)}" data-refund-id="${esc(refundKey)}"`);
 const submit=modal.querySelector('[type="submit"]');submit.textContent='Confirmar correção';submit.className='danger';
 modal.querySelector('form [data-action="close-modal"]').textContent='Voltar';
}
function showModal(title, contents, formId='generic-form', formData='') {
 modal.classList.toggle('machine-modal',formId==='card-machine-form');
 modal.classList.toggle('compact-dialog',['discard-form','pending-sales-form','pending-conflict-form','share-create-form','share-form','refund-form','refund-reversal-form'].includes(formId));
 modal.innerHTML=`<div class="modal-header"><h2 id="modal-title">${title}</h2><button class="subtle small" data-action="close-modal" aria-label="Fechar">${icon('x')}</button></div><form id="${formId}" ${formData} class="modal-content">${contents}<p class="error" id="modal-error" role="alert"></p><div class="actions"><button type="button" data-action="close-modal">Cancelar</button><button class="primary" type="submit">Salvar</button></div></form>`;
 applyColorStyles(modal);
 enhanceSelects(modal);
 if(formId==='stock-entry-form')stockMobileSteps(modal.querySelector('form'));
 if(formId==='sale-status-form')modal.querySelector('[data-status-preview-name]').textContent=modal.querySelector('[name="name"]').value||'Seu status';
 if(!modal.open)modal.showModal();
}
function askToDiscard(target) {
 pendingDiscardTarget=target;
 showModal(target==='logout'?'Sair e descartar preenchimentos?':'Descartar alterações?',`<p>${target==='logout'?'Há vendas com alterações guardadas nesta aba. Sair da conta descarta todos esses preenchimentos. Para mantê-los, continue no sistema e salve cada venda.':'Esta venda possui alterações não salvas. Continuar irá descartá-las.'}</p>`,'discard-form');
 modal.querySelector('[type="submit"]').textContent=target==='logout'?'Descartar e sair':'Descartar alterações';
 modal.querySelector('form [data-action="close-modal"]').textContent='Continuar no sistema';
}
function permissionFields(selected=[]) {return `<div class="permission-grid">${state.permissions.filter(p=>can(p)).map(p=>`<label><input type="checkbox" name="permissions" value="${p}" ${selected.includes(p)?'checked':''}>${labels[p]}</label>`).join('')}</div>`;}
function statusColorPalette(selected='neutral') {
 const hex=statusHex(selected);
 return `<fieldset class="status-palette"><legend>Paleta de cores</legend><p class="palette-guidance">Escolha uma cor abaixo ou abra o seletor para usar qualquer cor.</p><input type="hidden" name="color" value="${hex}"><div class="color-swatch-grid" role="group" aria-label="Cores sugeridas">${colorSwatches.map(color=>`<button type="button" class="color-swatch" data-action="status-swatch" data-color-swatch="${color}" aria-label="Usar cor ${color}" aria-pressed="${color===hex}" title="${color}">${icon('check')}</button>`).join('')}</div><div class="custom-color-controls"><label class="native-color-label"><input type="color" value="${hex}" data-status-picker aria-label="Abrir paleta completa de cores"><span>Escolher outra cor<small>Paleta completa</small></span></label>${field('Código da cor',`<input value="${hex}" data-status-hex maxlength="7" pattern="#[0-9a-fA-F]{6}" aria-label="Código hexadecimal da cor" autocomplete="off" spellcheck="false">`)}</div><div class="status-preview-row"><span>Prévia</span><span class="operational-badge" data-status-preview data-status-color="${hex}"><span class="status-dot" aria-hidden="true"></span><span data-status-preview-name>Seu status</span></span></div></fieldset>`;
}
function updateStatusPalette(color) {
 if(!/^#[0-9a-f]{6}$/i.test(color))return;
 const hex=color.toUpperCase();modal.querySelector('[name="color"]').value=hex;modal.querySelector('[data-status-picker]').value=hex;modal.querySelector('[data-status-hex]').value=hex;modal.querySelector('[data-status-hex]').setCustomValidity('');
 modal.querySelector('[data-status-preview]').dataset.statusColor=hex;
 for(const button of modal.querySelectorAll('[data-color-swatch]'))button.setAttribute('aria-pressed',String(button.dataset.colorSwatch===hex));
 applyColorStyles(modal);
}
function freshMachineBrand(){return {name:'',debit:'',credit:Array.from({length:36},()=> '')};}
function openMachineModal(key) {
 const machine=cardMachines().find(m=>m.id===key);
 machineDraft={id:machine?.id,name:machine?.name??'',selected:0,brands:machine?machine.brands.map(brand=>{const rates=machineRates(machine.id,brand.id),debit=rates.find(r=>r.mode==='debit');return {id:brand.id,name:brand.name,debit:debit?value(debit.basis_points):'',credit:Array.from({length:36},(_,n)=>{const rate=rates.find(r=>r.mode==='credit'&&r.installments===n+1);return rate?value(rate.basis_points):'';})};}):[freshMachineBrand()]};
 if(!machineDraft.brands.length)machineDraft.brands.push(freshMachineBrand());
 machineDraft.selected=Math.max(0,machineDraft.brands.findIndex(brand=>brand.id===machineBrandSelections.get(machine?.id)));
 machineDraftDirty=false;renderMachineModal();
}
function renderMachineModal() {
 const draft=machineDraft,brand=draft.brands[draft.selected],rateInputs=(start,end)=>Array.from({length:end-start},(_,i)=>{const n=start+i;return `<label class="rate-edit-cell"><span>${n+1}x</span><input inputmode="decimal" data-credit-installment="${n}" value="${esc(brand.credit[n])}" placeholder="—" aria-label="Taxa de crédito ${n+1} parcelas em porcentagem"><span>%</span></label>`;}).join('');
 showModal(draft.id?'Editar máquina e taxas':'Cadastrar máquina de cartão',`<div class="fields">${field('Nome da máquina',`<input data-machine-name value="${esc(draft.name)}" placeholder="Ex.: Máquina do balcão" required maxlength="80" autocomplete="off">`,true)}</div><div class="machine-editor-brand"><label class="field">Bandeiras desta máquina<select data-machine-edit-brand>${draft.brands.map((b,index)=>option(String(index),b.name||'Nova bandeira',String(draft.selected))).join('')}</select></label><button type="button" class="small" data-action="add-machine-brand">+ Bandeira</button></div><section class="brand-rate-editor"><div class="fields">${field('Nome da bandeira',`<input data-brand-name value="${esc(brand.name)}" placeholder="Ex.: Visa / Mastercard" required maxlength="80" autocomplete="off">`)}${field('Débito à vista (%)',`<input inputmode="decimal" data-debit-rate value="${esc(brand.debit)}" placeholder="Não disponível">`)}</div><div class="compact-rate-heading">Crédito <span>Preencha a taxa (%) de cada parcela</span></div><div class="rate-edit-grid">${rateInputs(0,18)}</div><details class="extra-installments" ${brand.credit.slice(18).some(rate=>rate!=='')?'open':''}><summary>Mais parcelas: 19x a 36x</summary><div class="rate-edit-grid">${rateInputs(18,36)}</div></details></section><p class="footer-note">Taxa em branco deixa a opção indisponível. Use 0,00 para taxa zero. Todas as bandeiras são salvas juntas; os pagamentos anteriores mantêm suas taxas.</p><div class="machine-discard" hidden><p>Há alterações não salvas nesta máquina. Deseja descartá-las?</p><div class="actions"><button type="button" data-action="keep-machine-editing">Continuar editando</button><button type="button" class="danger" data-action="discard-machine">Descartar alterações</button></div></div>`,'card-machine-form');
 modal.querySelector('[type="submit"]').textContent='Salvar máquina e taxas';
 modal.querySelector('[data-brand-name]').maxLength=40;
 modal.querySelector('[data-brand-name]').required=false;
}
function machinePayload() {
 if(!machineDraft.name.trim())throw Error('Informe o nome da máquina.');
 return {name:machineDraft.name.trim(),brands:machineDraft.brands.filter(brand=>brand.id||brand.name.trim()||brand.debit.trim()||brand.credit.some(rate=>rate.trim())).map((brand,index)=>{if(!brand.name.trim())throw Error(`Informe o nome da bandeira ${index+1}.`);const parse=amount=>{const rate=cents(amount);if(rate>10000)throw Error('A taxa deve estar entre 0,00% e 100,00%.');return rate;};return {...(brand.id?{id:brand.id}:{}),name:brand.name.trim(),debit_basis_points:brand.debit.trim()===''?null:parse(brand.debit),credit_rates:brand.credit.flatMap((rate,n)=>rate.trim()===''?[]:[{installments:n+1,basis_points:parse(rate)}])};})};
}
function requestModalClose() {
 if(busy)return;
 if(stockUI.requestClose())return;
 if(financeUI.requestClose())return;
 if(modal.querySelector('#card-machine-form')&&machineDraftDirty){const warning=modal.querySelector('.machine-discard');warning.hidden=false;warning.querySelector('button').focus();return;}
 modal.close();
}
function openPaymentModal(key,values={}) {
 const method=values.method??'pix', requestId=values.request_id??paymentRequestId(), amount=values.amount??'', accounts=activePixAccounts(), pixAccountId=defaultPixAccountId(values.pix_account_id);
 let conditional='';
 if(method==='pix')conditional=field('Conta Pix',accounts.length?`<select name="pix_account_id" required>${pixAccountOptions(pixAccountId)}</select>`:`<select disabled><option>Cadastre uma conta Pix em Configurações</option></select><small class="field-guidance">Nenhuma conta Pix ativa. Cadastre uma em Configurações antes de salvar este pagamento.</small>`,true);
 if(method==='card')conditional=cardPaymentFields(values);
 if(method==='cash')conditional='<div class="alert good full-field">Dinheiro não precisa de conta ou taxa.</div>';
 showModal('Registrar pagamento',`<input type="hidden" name="request_id" value="${esc(requestId)}"><div class="fields">${field('Forma',`<select name="method" data-modal-payment-method>${Object.entries(methods).map(([code,label])=>option(code,label,method)).join('')}</select>`)}${field('Valor bruto pago',input('amount',amount,'required inputmode="decimal"'))}${conditional}</div><p class="footer-note">Este registro informa um pagamento já recebido; não efetua cobranças. Correções podem ser feitas em Editar venda, conforme as permissões do usuário. Não realiza estorno bancário.</p>`,'payment-form',`data-id="${key}"`);
 if(method==='pix'&&!accounts.length)modal.querySelector('[type="submit"]').disabled=true;
}
function customerFormFields(customer={}) {
 return `${customer.edit_token?`<input type="hidden" name="edit_token" value="${esc(customer.edit_token)}">`:''}<div class="fields">${field('Nome',input('name',customer.name??'','required maxlength="200" autocomplete="name"'),true)}${field('CPF (opcional)',input('cpf',cpfLabel(customer.cpf??''),'inputmode="numeric" maxlength="14" placeholder="000.000.000-00" autocomplete="off"'))}${field('Telefone (opcional)',input('phone',customer.phone??'','type="tel" maxlength="40" autocomplete="tel"'))}${field('E-mail (opcional)',input('email',customer.email??'','type="email" maxlength="254" autocomplete="email"'),true)}</div>`;
}
async function openCustomerEditor(key) {
 if(!can('customers.manage'))return;
 const customer=await api(`/customers/${key}`);
 showModal('Editar cliente',customerFormFields(customer),'customer-form',`data-id="${esc(customer.id)}"`);
}
function openModal(type,key) {
 if(type==='product')productForm();
 if(type==='customer'&&can('customers.manage'))showModal('Novo cliente',customerFormFields(),'customer-form');
 if(type==='sale-status'&&can('settings.manage')){const s=saleStatuses().find(s=>s.id===key);showModal(s?'Editar status':'Cadastrar status',`<div class="fields">${field('Nome do status',input('name',s?.name??'','required maxlength="60" autocomplete="off"'),true)}</div>${statusColorPalette(s?.color??'neutral')}<p class="footer-note">Este status serve para acompanhar a operação. Ele não confirma, cancela ou altera os valores da venda.</p>`,'sale-status-form',s?`data-id="${s.id}"`:'');}
 if(type==='entry')stockUI.openEntry();
 if(type==='supplier'&&can('stock.receive')){const supplier=suppliers().find(s=>s.id===key);showModal(supplier?'Editar fornecedor':'Cadastrar fornecedor',`<div class="fields">${field('Nome',input('name',supplier?.name??'','required maxlength="120"'),true)}${field('Telefone (opcional)',input('phone',supplier?.phone??'','type="tel" maxlength="40"'))}${field('E-mail (opcional)',input('email',supplier?.email??'','type="email" maxlength="254"'))}</div><p class="footer-note">Os dados atualizados serão usados nas próximas entradas. O histórico preserva o nome registrado na época.</p>`,'supplier-form',supplier?`data-id="${supplier.id}"`:'');}
 if(type==='pix-account'&&can('settings.manage')){const account=pixAccounts().find(a=>a.id===key),inactive=account&&(account.active===false||account.active===0);showModal(account?'Editar conta Pix':'Cadastrar conta Pix',`<div class="fields">${field('Nome da conta',input('name',account?.name??'','required maxlength="80" autocomplete="off"'),true)}</div><label class="check-field"><input type="checkbox" name="active" ${inactive?'':'checked'}>Conta disponível para novos pagamentos Pix</label><p class="footer-note">Pagamentos já registrados preservam o nome da conta usado no momento do recebimento.</p>`,'pix-account-form',account?`data-id="${account.id}"`:'');}
 if(type==='card-machine'&&can('settings.manage'))openMachineModal(key);
 if(type==='user')showModal('Novo vendedor',`<div class="fields">${field('Nome',input('name','','required'),true)}${field('E-mail de acesso',input('email','','type="email" required'))}${field('Senha de acesso',input('password','','type="password" minlength="12" maxlength="128" required autocomplete="new-password"'))}</div><p class="footer-note">O vendedor será vinculado a esta loja. Não será criada uma nova loja.</p><h3>Permissões</h3>${permissionFields(['sales.create','sales.confirm','sales.edit_draft','payments.record','sales.share'])}`,'user-form');
 if(type==='permissions'){const u=state.users.find(u=>u.id===key);showModal('Permissões de '+esc(u.name),permissionFields(u.permissions),'permissions-form',`data-id="${key}"`);}
 if(type==='payment')openPaymentModal(key);
}
function salePaymentPayload(payment){
 if(payment.saved&&!paymentEditable(payment))return {id:payment.id};
 const payload={...(payment.saved?{id:payment.id}:{}),method:payment.method,amount_cents:cents(payment.amount)};
 if(payload.amount_cents<=0)throw Error('Informe um valor maior que zero em cada pagamento.');
 if(payment.method==='card'&&!(payment.saved&&payment.keep_card_rate)){
  if(!payment.rate_id)throw Error('Selecione máquina, bandeira e parcelas.');payload.rate_id=payment.rate_id;
 }
 if(payment.method==='pix'){
  if(!payment.pix_account_id&&!(payment.saved&&payment.original_method==='pix'))throw Error('Selecione a conta Pix.');payload.pix_account_id=payment.pix_account_id||null;
 }
 if(payment.paid_date!==undefined){payload.paid_date=isoDate(payment.paid_date);if(!payload.paid_date)throw Error('Informe a data do pagamento.');}
 return payload;
}
async function saveWorking(confirm) {
 const w=working;
 if(w.server_conflict)throw Error('Esta venda mudou em outra tela. Seu preenchimento está guardado; use Conferir versão atual antes de salvar.');
 if(confirm||w.status==='confirmed')for(const item of w.items)if(trackedItem(item)&&(item.unit_ids??[]).length!==Number(item.quantity))throw Error('Escolha um SN / IMEI para cada aparelho vendido.');
 if(w.status==='confirmed'&&!w.reason.trim())throw Error('Informe o motivo da edição.');
 const saleDate=w.business_date===undefined?undefined:isoDate(w.business_date);
 if(saleDate!==undefined&&!saleDate)throw Error('Informe a data da venda.');
 if(saleDate&&saleDate>saoPauloToday())throw Error('A data da venda não pode estar no futuro.');
 const data={...(w.draft_token?{draft_token:w.draft_token}:{}),...(saleDate===undefined?{}:{business_date:saleDate}),customer_id:w.customer_id||null,seller_id:w.seller_id||null,public_notes:w.public_notes,is_wholesale:w.is_wholesale,original_is_wholesale:w.original_is_wholesale,
 items:w.items.map(i=>({...(i.id?{id:i.id}:{}), product_id:i.product_id||null,description:i.description,quantity:Number(i.quantity),unit_price_cents:cents(i.price),serial_number:i.serial_number??'',details:i.details??'',share_details:!!i.share_details,...(i.unit_ids?{unit_ids:i.unit_ids}:{}),
 ...(!i.product_id&&can('costs.enter')&&(i.cost!==''||i.manual_cost_known)?{manual_cost_cents:i.cost===''?null:cents(i.cost)}:{})}))};
 if(can('sales.change_status')&&w.review_manual!==w.original_review_manual)data.review_manual=!!w.review_manual;
 if(can('costs.enter')&&can('costs.view'))Object.assign(data,{freight_cents:cents(w.freight),expenses:w.expenses.map(e=>({description:e.description,amount_cents:cents(e.amount)}))});
 const paymentData=w.status==='confirmed'?[]:w.payments.filter(p=>!p.saved).map(p=>({local:p,data:{request_id:p.request_id,method:p.method,amount_cents:cents(p.amount),...(p.method==='card'?{rate_id:p.rate_id}:{}),...(p.method==='pix'?{pix_account_id:p.pix_account_id}: {})}}));
 for(const {data:p} of paymentData){if(p.amount_cents<=0)throw Error('Informe um valor maior que zero em cada pagamento.');if(p.method==='card'&&!p.rate_id)throw Error('Selecione máquina, bandeira e parcelas.');if(p.method==='pix'&&!p.pix_account_id)throw Error('Cadastre e selecione uma conta Pix antes de salvar o pagamento.');}
 const transfersAccess=w.id&&w.created_by&&w.created_by!==state.user.id&&!can('sales.view_all')&&w.seller_id!==state.user.id;
 if(w.status!=='confirmed'&&transfersAccess&&(confirm||paymentData.length||w.operational_status_id!==w.original_operational_status_id||w.review_manual!==w.original_review_manual))throw Error('Ao transferir esta venda você deixará de ter acesso a ela. Salve os pagamentos e o status primeiro, mantendo o vendedor atual. Depois altere somente o vendedor e use Salvar rascunho; o novo vendedor poderá confirmar a venda.');
 let result;
 if(w.status==='confirmed'){
  data.payments=w.payments.map(salePaymentPayload);
  const products=new Set(w.items.map(i=>i.product_id).filter(Boolean));
  if(Object.values(w.entry_costs??{}).some(e=>products.has(e.product_id)&&!e.value.trim()))throw Error('Informe o custo da entrada. Para retirar uma entrada do estoque, use Excluir entrada.');
  const entryCosts=Object.entries(w.entry_costs??{}).filter(([,e])=>products.has(e.product_id)&&cents(e.value)!==e.original_cost).map(([id,e])=>({id,version:e.version,unit_cost_cents:cents(e.value)}));
  if(entryCosts.length)data.entry_costs=entryCosts;
  const difference=editorNumbers().diff;
  if(difference!==0&&!await confirmAction('O novo total não confere com os pagamentos registrados. Deseja salvar a venda com essa diferença?'))return;
  if(can('sales.change_status')&&w.operational_status_id!==w.original_operational_status_id)data.operational_status_id=w.operational_status_id||null;
  result=await api(`/sales/${w.id}/edit`,{...data,edit_token:w.edit_token,request_id:w.correction_request_id,reason:w.reason,acknowledge_difference:true},'PUT');
 }else result=await api(w.id?`/sales/${w.id}`:'/sales',data,w.id?'PUT':'POST');w.id=result.id;if(w.status!=='confirmed'){w.original_is_wholesale=w.is_wholesale;w.original_review_manual=w.review_manual;w.draft_token=result.draft_token;result.item_ids?.forEach((id,n)=>{w.items[n].id=id;});}
 if(result.access_lost){forgetWorking(w);working=null;workingDirty=false;detailId=null;detailSale=null;view='sales';await finishMutation('Venda transferida e salva. Ela agora está disponível ao novo vendedor e aos administradores.');return;}
 if(w.status!=='confirmed'&&can('sales.change_status')&&w.operational_status_id!==w.original_operational_status_id){await api(`/sales/${w.id}/status`,{operational_status_id:w.operational_status_id||null},'PUT');w.original_operational_status_id=w.operational_status_id;}
 for(const {local,data:p} of paymentData){const result=await api(`/sales/${w.id}/payments`,p);Object.assign(local,{saved:true,id:result.id});}
 if(confirm){const s=await api(`/sales/${w.id}`);if(s.draft_token!==w.draft_token)throw Error('A venda mudou em outra tela. Reabra e confira antes de confirmar.');const ok=s.reconciliation.state==='matched'||await confirmAction(`${s.reconciliation.state==='underpaid'?'Faltam pagamentos de':'Foi registrado a mais'} ${money(Math.abs(s.reconciliation.difference_cents))}. Confirmar a venda mesmo assim?`,'Manter como rascunho');
  if(ok)await api(`/sales/${w.id}/confirm`,{acknowledge_difference:true,draft_token:w.draft_token});else toast('Rascunho salvo. A venda não foi confirmada.');}
 forgetWorking(w);working=null;workingDirty=false;detailId=w.id;view='detail';await finishMutation(w.status==='confirmed'?'Venda corrigida. Estoque, pagamentos e resultado atualizados.':confirm?'Venda salva. Consulte a situação abaixo.':'Rascunho salvo.');
}
async function shareSale(key) {
 const result=await api(`/sales/${key}/share`,{});const url=result.url;
 showModal('Compartilhar com o cliente',`<div class="share-brand-preview"><div class="brand-logo-frame"><img src="/gamecell-logo.png" width="640" height="640" alt="Gamecell — games, celulares e informática" decoding="async"></div></div><p class="share-brand-note">O pedido inclui a logo da Gamecell na consulta e na impressão.</p><div class="alert good">Esta versão não contém custos, taxas internas, frete da loja, líquido da máquina ou lucro.</div>${field('Link de consulta (válido por 7 dias)',input('share_url',url,'readonly'),true)}<div class="actions"><a class="button" href="${esc(url)}" target="_blank" rel="noopener noreferrer">Abrir / imprimir PDF</a><a class="button" href="https://wa.me/?text=${encodeURIComponent('Confira sua venda: '+url)}" target="_blank" rel="noopener noreferrer">WhatsApp</a><a class="button" href="mailto:?subject=${encodeURIComponent('Sua venda — '+state.store.name)}&body=${encodeURIComponent('Confira sua venda: '+url)}">E-mail</a></div><p class="footer-note">Gerar outro link invalida o anterior. ${authSettings.production?'':'Na prévia local, o endereço só abre no computador onde o servidor está rodando. '} O botão E-mail abre seu aplicativo, não envia automaticamente.</p>`,'share-form');
 modal.querySelector('[type="submit"]').textContent='Copiar link';
}
function confirmShare(key) {
 showModal('Gerar novo link?',`<div class="alert">Ao continuar, qualquer link anterior desta venda deixará de funcionar. O novo link será válido por 7 dias.</div><p class="footer-note">O cliente verá somente o resumo comercial, sem custos, taxas internas, despesas, líquido ou lucro.</p>`,'share-create-form',`data-id="${key}"`);
 modal.querySelector('[type="submit"]').textContent='Gerar novo link';
}
function numericInputKind(el) {
 if(!(el instanceof HTMLInputElement))return '';
 if(el.name==='cpf')return 'cpf';
 if(el.dataset.key==='quantity'||el.name==='quantity'||el.type==='number')return 'integer';
 return el.inputMode==='decimal'?'decimal':'';
}
function numericTextAllowed(kind,text){return (kind==='integer'?/^\d*$/:kind==='cpf'?/^[\d.\-]*$/:/^[\d.,]*$/).test(text);}
function rejectNumericText(event,kind){event.preventDefault();toast(kind==='cpf'?'Use somente os números do CPF.':kind==='integer'?'Informe a quantidade somente com números inteiros.':'Use somente números e vírgula ou ponto para os centavos.');}
initDateControls();
document.addEventListener('beforeinput',e=>{const kind=numericInputKind(e.target);if(kind&&e.data&&!numericTextAllowed(kind,e.data))rejectNumericText(e,kind);});
document.addEventListener('paste',e=>{const kind=numericInputKind(e.target),text=e.clipboardData?.getData('text');if(kind&&text!==undefined&&!numericTextAllowed(kind,text))rejectNumericText(e,kind);});
document.addEventListener('keydown',e=>{const kind=numericInputKind(e.target);if(kind==='integer'&&!e.ctrlKey&&!e.metaKey&&!e.altKey&&['e','E','+','-','.',','].includes(e.key))rejectNumericText(e,kind);});
document.addEventListener('focusin',e=>{if(numericInputKind(e.target))e.target.dataset.numericPrevious=e.target.value;});
modal.addEventListener('cancel',e=>{if(busy){e.preventDefault();return;}if(stockUI.requestClose()){e.preventDefault();return;}if(financeUI.requestClose()){e.preventDefault();return;}if(machineDraftDirty&&modal.querySelector('#card-machine-form')){e.preventDefault();requestModalClose();}});
modal.addEventListener('close',()=>{productCreateContext=null;machineDraft=null;machineDraftDirty=false;financeUI.resetModal();stockUI.resetModal();modal.classList.remove('machine-modal');});
document.addEventListener('input', e=>{
 const el=e.target;
 if(calculatorUI.input(el))return;
 if(el.closest?.('[data-catalog-search]')){updateCatalogResults();return;}
 if(el.id==='unit-query'){filterUnitRows(modal,el.value);return;}
 if(el.id==='product-unit-query'){filterUnitRows(document.querySelector('#page'),el.value,document.querySelector('#product-unit-status').value);return;}
 if(el.form?.id==='sale-units-form'){modal.querySelector('[data-unit-count]').textContent=`${modal.querySelectorAll('[name="unit_ids"]:checked').length} selecionado(s)`;return;}
 if(el.form?.id==='stock-search-form'){stockSearch=el.value;updateStockResults();return;}
 const kind=numericInputKind(el);
 if(kind){if(!numericTextAllowed(kind,el.value)){el.value=el.dataset.numericPrevious??'';toast('O campo aceita somente números.');return;}if(kind==='cpf'){const digits=el.value.replace(/\D/g,'').slice(0,11);el.value=digits.replace(/^(\d{3})(\d)/,'$1.$2').replace(/^(\d{3})\.(\d{3})(\d)/,'$1.$2.$3').replace(/(\d{3})\.(\d{3})\.(\d{3})(\d)/,'$1.$2.$3-$4');}el.dataset.numericPrevious=el.value;}
 financeUI.input(el);stockUI.input(el);
 if(el.dataset.entryCost){
  const lot=state.stock_entries.find(e=>e.id===el.dataset.entryCost);if(!lot)return;
  working.entry_costs[lot.id]={value:el.value,version:lot.version,original_cost:lot.unit_cost_cents,product_id:lot.product_id};
  working.items[Number(el.dataset.itemCostIndex)].costs_open=true;workingDirty=true;
  document.querySelectorAll(`[data-entry-cost="${lot.id}"]`).forEach(input=>{if(input!==el)input.value=el.value;});return;
 }
 if(el.form?.id==='card-machine-form'){
  const brand=machineDraft.brands[machineDraft.selected];
  if(el.dataset.machineName!==undefined)machineDraft.name=el.value;
  if(el.dataset.brandName!==undefined){brand.name=el.value;modal.querySelector('[data-machine-edit-brand]').selectedOptions[0].textContent=el.value||'Nova bandeira';}
  if(el.dataset.debitRate!==undefined)brand.debit=el.value;
  if(el.dataset.creditInstallment!==undefined)brand.credit[Number(el.dataset.creditInstallment)]=el.value;
  if(el.tagName==='INPUT')machineDraftDirty=true;
  return;
 }
 if(el.form?.id==='sale-status-form'){
  if(el.dataset.statusPicker!==undefined)updateStatusPalette(el.value);
  if(el.dataset.statusHex!==undefined){if(/^#[0-9a-f]{6}$/i.test(el.value))updateStatusPalette(el.value);else el.setCustomValidity('Use uma cor no formato #RRGGBB.');}
  if(el.name==='name')modal.querySelector('[data-status-preview-name]').textContent=el.value||'Seu status';
  return;
 }
 if(view!=='editor')return;
 if(!el.matches('[data-bind],[data-item],[data-payment],[data-expense],[data-card-payment]'))return;
 if(el.dataset.bind)working[el.dataset.bind]=el.type==='checkbox'?el.checked:el.value;
 if(el.dataset.item!==undefined){const i=working.items[Number(el.dataset.item)];if(el.dataset.key!=='product_id')i[el.dataset.key]=el.type==='checkbox'?el.checked:el.value;if(el.dataset.key==='cost')i.manual_cost_known=true;}
 if(el.dataset.payment!==undefined)working.payments[Number(el.dataset.payment)][el.dataset.key]=el.value;
 if(el.dataset.expense!==undefined)working.expenses[Number(el.dataset.expense)][el.dataset.key]=el.value;
 workingDirty=true;
 updateSummary();
});
document.addEventListener('change',async e=>{
 const el=e.target;
 if(el.id==='product-unit-status'){filterUnitRows(document.querySelector('#page'),document.querySelector('#product-unit-query').value,el.value);return;}
 if(calculatorUI.change(el)){const control=document.querySelector(`#calculator-form [name="${el.name}"]`);(control?.closest('.select-control')?.querySelector('button')??control)?.focus();return;}
 if(el.matches('[data-expense-period]')){const group=el.form.querySelector('.period-month'),custom=el.value==='month',input=group.querySelector('input');group.hidden=!custom;input.disabled=!custom;input.setCustomValidity('');if(custom)input.focus();return;}
 if(stockUI.change(el)){enhanceSelects(modal);return;}
 const classification=financeUI.change(el);if(classification){enhanceSelects(modal);const next=classification.scope.querySelector(`[name="${classification.name}"]`);(next?.closest('.select-control')?.querySelector('button')??next)?.focus();return;}
 if(el.dataset.datePreset!==undefined){
  const range=document.querySelector('#sales-period-range'),period=el.value==='period';range.hidden=!period;
  for(const input of range.querySelectorAll('input')){input.disabled=!period;input.setCustomValidity('');}
  if(period){range.querySelector('input').focus();return;}
  el.form.dataset.filterFocus=el.name;salesFilters.request(el.form,{automatic:true});
  return;
 }
 if(el.form?.id==='filter-form'){
  el.form.dataset.filterFocus=el.name;
  if(el.matches('select,[data-date-kind]'))salesFilters.request(el.form,{automatic:true});
  return;
 }
 if(el.dataset.machineBrand!==undefined){const machine=cardMachines().find(m=>m.id===el.dataset.machineBrand);machineBrandSelections.set(machine.id,el.value);document.querySelector(`[data-machine-summary="${machine.id}"]`).innerHTML=machineRateSummary(machine,el.value);return;}
 if(el.dataset.machineEditBrand!==undefined){machineDraft.selected=Number(el.value);renderMachineModal();modal.querySelector('[data-machine-edit-brand]').focus();return;}
 if(el.dataset.modalCard!==undefined){const form=el.form,values=Object.fromEntries(new FormData(form)),key=el.dataset.modalCard;changeCardSelection(values,key,el.value);openPaymentModal(form.dataset.id,values);modal.querySelector(`[data-modal-card="${key}"]`)?.focus();return;}
 if(el.dataset.modalPaymentMethod!==undefined){const form=el.form,values=Object.fromEntries(new FormData(form));openPaymentModal(form.dataset.id,{...values,method:el.value});modal.querySelector('[name="method"]')?.focus();return;}
 if(el.dataset.saleWholesale!==undefined){
  const previous=el.dataset.previous==='true',key=el.dataset.saleWholesale;
  if(busy){el.checked=previous;return;}
  const sale=view==='detail'&&detailSale?.id===key?detailSale:state.sales.find(s=>s.id===key);
  if(!sale){el.checked=previous;toast('Atualize a lista de vendas.');return;}
  const selected=el.checked;let saved=false;busy=true;el.disabled=true;
  try{
   await api(`/sales/${key}/wholesale`,{is_wholesale:selected,edit_token:sale.edit_token,request_id:crypto.randomUUID()},'PUT');
   saved=true;el.dataset.previous=String(selected);
   await load();if(detailId===key)detailSale=await api(`/sales/${key}`);
   render();toast(selected?'Venda marcada como atacado.':'Marcação de atacado removida.');
  }catch(err){
   el.checked=el.dataset.previous==='true';
   if(saved&&state){salesMutationRefreshPending=true;salesFilters.clear();render();toast('Alteração salva. Atualize os dados para conferir os totais.');}
   else toast(err.message);
  }
  finally{busy=false;if(el.isConnected)el.disabled=false;}
  return;
 }
 if(el.dataset.saleStatus!==undefined){
  if(busy){el.value=el.dataset.previous??'';return;}
  let saved=false;busy=true;el.disabled=true;
  try{await api(`/sales/${el.dataset.saleStatus}/status`,{operational_status_id:el.value||null},'PUT');saved=true;el.dataset.previous=el.value;await load();render();toast('Status da venda atualizado.');}
  catch(err){
   el.value=el.dataset.previous??'';
   if(saved&&state){salesMutationRefreshPending=true;salesFilters.clear();render();toast('Status salvo. Atualize os dados para conferir os totais.');}
   else toast(err.message);
  }finally{busy=false;if(el.isConnected)el.disabled=false;}return;
 }
 if(el.dataset.saleReview!==undefined){
  const previous=el.dataset.previous==='true',key=el.dataset.saleReview;
  if(busy){el.checked=previous;return;}
  const sale=view==='detail'&&detailSale?.id===key?detailSale:state.sales.find(s=>s.id===key);
  if(!sale){el.checked=previous;toast('Atualize a lista de vendas.');return;}
  const selected=el.checked;let saved=false;busy=true;el.disabled=true;
  try{await api(`/sales/${key}/review`,{review_manual:selected,edit_token:sale.edit_token},'PUT');saved=true;el.dataset.previous=String(selected);await load();if(detailId===key)detailSale=await api(`/sales/${key}`);render();toast(selected?'Venda marcada para conferir.':'Marcação manual removida.');}
  catch(err){el.checked=el.dataset.previous==='true';if(saved&&state){salesMutationRefreshPending=true;salesFilters.clear();render();toast('Marcação salva. Atualize os dados para conferir os totais.');}else toast(err.message);}
  finally{busy=false;if(el.isConnected)el.disabled=false;}return;
 }
 if(view!=='editor')return;
 if(el.dataset.cardPayment!==undefined){const index=Number(el.dataset.cardPayment),key=el.dataset.cardSelect;changeCardSelection(working.payments[index],key,el.value);workingDirty=true;renderEditor();document.querySelector(`[data-card-payment="${index}"][data-card-select="${key}"]`)?.focus();return;}
 if(el.dataset.bind){working[el.dataset.bind]=el.type==='checkbox'?el.checked:el.value;workingDirty=true;updateSummary();}
 if(el.dataset.item!==undefined&&el.dataset.key==='product_id'){const item=working.items[Number(el.dataset.item)],p=state.products.find(p=>p.id===el.value);if(item.product_id!==(el.value||null)){item.serial_number='';item.details='';item.share_details=false;item.details_open=false;item.unit_ids=[];item.original_unit_ids=[];item.tracks_serials=!!p?.serial_tracked;if(p?.serial_tracked)item.quantity=1;}item.product_id=el.value||null;item.description=p?.name??'';item.cost='';item.manual_cost_known=true;if(p)item.price=value(p.price_cents);workingDirty=true;renderEditor();}
 if(el.dataset.payment!==undefined&&el.dataset.key==='method'){changePaymentMethod(working.payments[Number(el.dataset.payment)],el.value);workingDirty=true;renderEditor();}
});
function confirmAction(message,cancelLabel='Voltar e conferir') {
 return new Promise(resolve=>{
  const dialog=document.createElement('dialog');dialog.className='compact-dialog confirmation-dialog';
  dialog.setAttribute('aria-labelledby','confirmation-title');
  dialog.innerHTML=`<div class="modal-header"><h2 id="confirmation-title">Conferir pagamento</h2></div><div class="modal-content"><p>${esc(message)}</p><div class="actions"><button type="button" data-confirm="no">${esc(cancelLabel)}</button><button type="button" class="primary" data-confirm="yes">Confirmar mesmo assim</button></div></div>`;
  let accepted=false;
  dialog.addEventListener('click',event=>{const button=event.target.closest('[data-confirm]');if(button){accepted=button.dataset.confirm==='yes';dialog.close();}});
  dialog.addEventListener('close',()=>{dialog.remove();resolve(accepted);},{once:true});
  document.body.append(dialog);dialog.showModal();dialog.querySelector('button').focus();
 });
}
document.addEventListener('click',async e=>{
 const button=e.target.closest('[data-action],[data-view]');if(!button||busy)return;
 if(mutationRefreshPending&&!['refresh-after-save','logout','close-modal'].includes(button.dataset.action)){toast('Registro salvo. Atualize os dados para continuar.');return;}
 if(cancellationRefreshPending&&button.dataset.action!=='refresh-after-cancellation'){toast('Atualize os dados para continuar. O cancelamento já foi registrado.');return;}
 if(salesMutationRefreshPending&&button.dataset.action!=='refresh-sales'&&button.dataset.action!=='logout'&&button.dataset.action!=='close-modal'){toast('A alteração já foi salva. Atualize os dados para continuar.');return;}
 if(button.dataset.view){
  rememberWorking();
  if(salesRefreshPending&&['dashboard','sales'].includes(button.dataset.view)){
   busy=true;
   try{adoptState(await api('/state?'+new URLSearchParams(filter)));salesRefreshPending=false;}
   catch(err){toast(err.message);return;}
   finally{busy=false;}
  }
  salesFilters.clear();working=null;workingDirty=false;view=button.dataset.view;if(view.startsWith('expenses'))expenseMenuOpen=true;render();return;
 }
 const a=button.dataset.action, key=button.dataset.id,n=Number(button.dataset.index);
 try{
 if(a==='refresh-after-save'){busy=true;await load();mutationRefreshPending='';render();}
 else if(a==='resume-work'){const cached=pendingWorks.get(key);if(!cached)throw Error('Este preenchimento não está mais disponível.');busy=true;working=await restoreWorking(cached);workingDirty=true;view='editor';modal.close();render();}
 else if(a==='review-current-sale'){if(!working?.id)return;showModal('Abrir a versão atual da venda?',`<p>Seu preenchimento continua guardado. Se abrir a versão atual, as alterações ainda não salvas deste preenchimento serão descartadas. A venda registrada não será alterada.</p>`,'pending-conflict-form',`data-id="${esc(working.id)}"`);modal.querySelector('[type="submit"]').textContent='Descartar preenchimento e abrir atual';}
 else if(a==='discard-work'){askToDiscard('work:'+key);}
 else if(a==='fresh-sale'){modal.close();startSale('',true);}
 else if(a==='refresh-sales'){busy=true;await load();salesMutationRefreshPending=false;render();}
 else if(a==='refresh-after-cancellation'){busy=true;await load();cancellationRefreshPending=false;render();}
 else if(a==='retry-session'){await bootstrap();}
 else if(a==='auth-toggle'){authMode=authMode==='login'?'register':'login';renderAuth();}
 else if(a==='calculator-refresh'){busy=true;await load();render();toast('Taxas atualizadas.');}
 else if(a.startsWith('calculator-')){await calculatorUI.action(a,key);}
 else if(a==='clear-catalog-search'){document.querySelector('#catalog-query').value='';updateCatalogResults();document.querySelector('#catalog-query').focus();}
 else if(a==='edit-product'){busy=true;productForm(await api(`/products/${key}`));}
 else if(a==='create-sale-product'){if(!can('products.manage'))return;const item=working.items[n];productForm(item.product_id?{}:{name:item.description,price_cents:cents(item.price)},n);}
 else if(a==='select-sale-units'){busy=true;await openUnitPicker(n);}
 else if(a==='clear-stock-search'){stockSearch='';const query=document.querySelector('#stock-query');query.value='';updateStockResults();query.focus();}
 else if(a==='toggle-registry'){registryMenuOpen=!registryMenuOpen;if(registryMenuOpen)expenseMenuOpen=false;document.querySelector('.nav').innerHTML=navigation();document.querySelector('[data-action="toggle-registry"]').focus();}
 else if(a==='toggle-expenses'){expenseMenuOpen=!expenseMenuOpen;if(expenseMenuOpen)registryMenuOpen=false;document.querySelector('.nav').innerHTML=navigation();document.querySelector('[data-action="toggle-expenses"]').focus();}
 else if(a.startsWith('stock-')){busy=true;const result=await stockUI.action(a,key,button);if(result?.view){view=result.view;render();}}
 else if(a.startsWith('fin-')){busy=true;const result=await financeUI.action(a,key,button);if(result?.view){view=result.view;expenseMenuOpen=true;render();}}
 else if(a==='logout'){if(workingDirty||pendingWorks.size){askToDiscard('logout');return;}salesFilters.clear();await api('/logout',{});salesMutationRefreshPending=false;salesRefreshPending=false;state=null;working=null;workingDirty=false;detailSale=null;detailId=null;productHistory=null;filter=todayFilter();render();}
 else if(a==='new-sale'){if(!can('sales.create'))return;startSale();}
 else if(a==='edit-customer'){busy=true;await openCustomerEditor(key);}
 else if(a==='open-product'){busy=true;button.disabled=true;productDetailReturnView=button.dataset.origin==='stock'?'stock':'products';productHistory=await api(`/products/${key}/history`);view='product-detail';render();if(productHistory.product.serial_tracked)filterUnitRows(document.querySelector('#page'),'','available');}
 else if(a==='product-back'){productHistory=null;view=productDetailReturnView;render();}
 else if(a==='open-sale'){busy=true;detailSale=await api(`/sales/${key}`);detailId=key;view='detail';render();}
 else if(a==='cancel-sale'){busy=true;await openCancelSale(key);}
 else if(a==='record-refund'){busy=true;await openRefundModal(key);}
 else if(a==='reverse-refund'){busy=true;await openRefundCorrectionModal(key,button.dataset.refundId);}
 else if(a==='edit-sale'){busy=true;rememberWorking();await load();const latest=await api(`/sales/${key}`);const cached=pendingWorks.get('sale:'+key);working=cached?await restoreWorking(cached,latest):makeWorking(latest);workingDirty=!!cached;view='editor';const index=working.items.findIndex(i=>i.id===button.dataset.itemId);if(index>=0)working.step='item-'+index;render();if(index>=0)document.querySelector(`[data-item="${index}"][data-key="description"]`)?.focus();}
 else if(a==='change-saved-card'){const p=working.payments[n];if(!paymentEditable(p))return;p.keep_card_rate=false;p.rate_id='';p.machine_id='';p.brand_id='';p.mode='';workingDirty=true;renderEditor();}
 else if(a==='add-item'){working.items.push({product_id:null,description:'',quantity:1,price:'0,00',cost:'',manual_cost_known:true});workingDirty=true;renderEditor();}
 else if(a==='item-details'){const item=working.items[n];item.details_open=!(item.details_open??!!(item.serial_number||item.details));renderEditor();document.querySelector(`[data-action="item-details"][data-index="${n}"]`)?.focus();}
 else if(a==='remove-item'){working.items.splice(n,1);workingDirty=true;renderEditor();}
 else if(a==='add-payment'){working.payments.push({request_id:paymentRequestId(),method:'pix',amount:'0,00',rate_id:'',pix_account_id:defaultPixAccountId(''),paid_date:brazilianDate(saoPauloToday())});workingDirty=true;renderEditor();}
 else if(a==='remove-payment'){if(!paymentEditable(working.payments[n]))return;working.payments.splice(n,1);workingDirty=true;renderEditor();}
 else if(a==='add-expense'){working.expenses.push({description:'',amount:'0,00'});workingDirty=true;renderEditor();}
 else if(a==='remove-expense'){working.expenses.splice(n,1);workingDirty=true;renderEditor();}
 else if(a==='clear-filters'){salesFilters.clear();busy=true;await applySalesFilters({date_preset:'today'});}
 else if(a==='show-review-sales'){salesFilters.clear();const previous={...filter};filter={...filter,review:'required'};busy=true;try{await load();view='sales';render();}catch(error){filter=previous;throw error;}}
 else if(a==='status-swatch'){updateStatusPalette(button.dataset.colorSwatch);}
 else if(a==='add-machine-brand'){machineDraft.brands.push(freshMachineBrand());machineDraft.selected=machineDraft.brands.length-1;machineDraftDirty=true;renderMachineModal();modal.querySelector('[data-brand-name]').focus();}
 else if(a==='keep-machine-editing'){modal.querySelector('.machine-discard').hidden=true;modal.querySelector('[data-machine-name]').focus();}
 else if(a==='discard-machine'){machineDraftDirty=false;modal.close();}
 else if(a==='close-modal'){requestModalClose();}
 else if(a.startsWith('modal-'))openModal(a.slice(6),key);
 else if(a==='share-sale'){confirmShare(key);}
 else if(a==='save-draft'||a==='confirm-draft'||a==='save-correction'){busy=true;button.disabled=true;await saveWorking(a==='confirm-draft');}
 }catch(err){const error=document.querySelector('#editor-error');if(error)error.textContent=err.message;toast(err.message);}
 finally{busy=false;button.disabled=false;if(a.startsWith('fin-')){enhanceSelects(modal);financeUI.afterAction();}}
});
document.addEventListener('submit',async e=>{
 if(e.target.id==='calculator-form'){e.preventDefault();calculatorUI.submit();return;}
 if(e.target.id==='stock-search-form'){e.preventDefault();updateStockResults();return;}
 if(e.target.matches('[data-catalog-search]')){e.preventDefault();updateCatalogResults();return;}
 if(e.target.id==='filter-form'){e.preventDefault();salesFilters.request(e.target);return;}
 e.preventDefault();if(busy)return;const form=e.target,d=Object.fromEntries(new FormData(form)),button=form.querySelector('[type="submit"]');busy=true;if(button)button.disabled=true;
 try{
 normalizeDateFields(form,d);
 if(form.id==='auth-form'){await api(authMode==='login'?'/login':'/register',d);filter=todayFilter();productHistory=null;await load();view='dashboard';render();}
 else if(form.id.startsWith('stock-')){const result=await stockUI.submit(form,d);await finishMutation(result.message);}
 else if(form.id.startsWith('fin-')){const result=await financeUI.submit(form,d);if(!result.local){if(result.view){view=result.view;if(view.startsWith('expenses'))expenseMenuOpen=true;}await finishMutation(result.message);}}
 else if(form.id==='cancel-sale-form'){await submitSaleCancellation(form,d);}
 else if(form.id==='refund-form'){
  const result=await api(`/sales/${form.dataset.id}/refunds`,{request_id:d.request_id,refund_token:d.refund_token,amount_cents:cents(d.amount),method:d.method,refunded_date:d.refunded_date,notes:d.notes,acknowledge_refund_completed:new FormData(form).has('acknowledge_refund_completed')});
  detailId=form.dataset.id;detailSale=null;view='detail';
  await finishMutation(result.refund_pending_cents===0?'Devolução concluída. O histórico foi preservado.':`Devolução registrada. Ainda falta devolver ${money(result.refund_pending_cents)}.`);
 }
 else if(form.id==='refund-reversal-form'){
  const result=await api(`/sales/${form.dataset.id}/refunds/${form.dataset.refundId}/reversal`,{request_id:d.request_id,refund_token:d.refund_token,reason:d.reason,reversed_date:d.reversed_date,acknowledge_refund_reversal:new FormData(form).has('acknowledge_refund_reversal')});
  detailId=form.dataset.id;detailSale=null;view='detail';
  await finishMutation(`Baixa corrigida. ${money(result.amount_cents)} voltou a aparecer como valor a devolver.`);
 }
 else if(form.id==='filter-form'){await applySalesFilters(d);}
 else if(form.id==='sale-units-form'){const item=working.items[Number(form.dataset.index)],ids=new FormData(form).getAll('unit_ids');if(!ids.length)throw Error('Selecione pelo menos um aparelho.');item.unit_ids=ids;item.tracks_serials=true;item.quantity=ids.length;item.serial_number=pickerUnits.filter(u=>ids.includes(u.id)).map(u=>u.serial_number).join('\n');workingDirty=true;modal.close();renderEditor();}
 else if(form.id==='customer-form'){await saveCustomerForm(d,form);}
 else if(form.id==='product-form'){await saveProductForm(d,form);}
 else if(form.id==='pending-conflict-form'){const latest=await api(`/sales/${encodeURIComponent(form.dataset.id)}`);if(working?.id!==latest.id)throw Error('O preenchimento mudou. Abra a venda novamente.');forgetWorking(working);working=makeWorking(latest);workingDirty=false;modal.close();if(latest.status==='cancelled'){detailSale=latest;detailId=latest.id;working=null;view='detail';}else view='editor';render();}
 else if(form.id==='share-form'){await navigator.clipboard.writeText(d.share_url);toast('Link copiado.');modal.close();}
 else if(form.id==='share-create-form'){await shareSale(form.dataset.id);}
 else if(form.id==='discard-form'){const target=pendingDiscardTarget;if(target==='logout'){await api('/logout',{});state=null;renderAuth();}else if(target?.startsWith('work:')){const cached=pendingWorks.get(target.slice(5));forgetWorking(cached);if(working===cached){working=null;workingDirty=false;}pendingDiscardTarget=null;modal.close();view=working?'editor':'sales';render();}else{pendingDiscardTarget=null;modal.close();forgetWorking(working);working=null;workingDirty=false;if(target==='new-sale')startSale('',true);else{view=target||'sales';render();}}}
 else{
 let result;
 if(form.id==='sale-status-form'){const key=form.dataset.id;result=await api(key?`/sale-statuses/${key}`:'/sale-statuses',{name:d.name,color:d.color},key?'PUT':'POST');}
 if(form.id==='pix-account-form'){const key=form.dataset.id;result=await api(key?`/pix-accounts/${key}`:'/pix-accounts',{name:d.name,active:new FormData(form).has('active')},key?'PUT':'POST');}
 if(form.id==='supplier-form'){const key=form.dataset.id;result=await api(key?`/suppliers/${key}`:'/suppliers',{name:d.name,email:d.email,phone:d.phone},key?'PUT':'POST');}
 if(form.id==='entry-form')result=await api('/entries',{product_id:d.product_id,supplier_id:d.supplier_id||null,quantity:Number(d.quantity),unit_cost_cents:cents(d.cost)});
 if(form.id==='card-machine-form'){const key=machineDraft.id;result=await api(key?`/card-machines/${key}`:'/card-machines',machinePayload(),key?'PUT':'POST');machineDraftDirty=false;}
 if(form.id==='user-form')result=await api('/users',{...d,permissions:new FormData(form).getAll('permissions')});
 if(form.id==='permissions-form')result=await api(`/users/${form.dataset.id}/permissions`,{permissions:new FormData(form).getAll('permissions')},'PUT');
 if(form.id==='payment-form'){if(d.method==='pix'&&!d.pix_account_id)throw Error('Cadastre e selecione uma conta Pix antes de salvar o pagamento.');result=await api(`/sales/${form.dataset.id}/payments`,{request_id:d.request_id,method:d.method,amount_cents:cents(d.amount),...(d.method==='card'?{rate_id:d.rate_id}:{}),...(d.method==='pix'?{pix_account_id:d.pix_account_id}: {})});}
 await finishMutation(result?.resolved_quantity?`Entrada salva. Custo de ${result.resolved_quantity} unidade(s) regularizado.`:'Registro salvo.');
 }
 }catch(err){const target=form.querySelector('.error');if(target?.isConnected)target.textContent=err.message;else toast(err.message);}
 finally{busy=false;if(button)button.disabled=false;}
});
window.addEventListener('beforeunload',e=>{if(workingDirty||pendingWorks.size||machineDraftDirty||financeUI.dirty()||stockUI.dirty()){e.preventDefault();e.returnValue='';}});
window.matchMedia('(max-width: 700px)').addEventListener('change',event=>{if(view==='editor'&&working)renderEditor();const form=modal.querySelector('#stock-entry-form');if(event.matches&&form&&!form.classList.contains('mobile-flow'))stockMobileSteps(form);});
const salesFilters=createSalesFilterController({
 apply:applySalesFilters,isBusy:()=>busy,setBusy:value=>{busy=value;},today:saoPauloToday,
 isCurrent:form=>!!state&&!salesMutationRefreshPending&&!cancellationRefreshPending&&form.dataset.filterOwner===state.user.id&&['dashboard','sales'].includes(view),
 onError:error=>{const target=document.querySelector('#filter-form .error');if(target)target.textContent=error.message;else toast(error.message);},
 onSuccess:form=>{
  salesRefreshPending=false;
  const name=form?.dataset.filterFocus;
  if(!name)return;
  const control=document.querySelector(`#filter-form [name="${name}"]`);
  (control?.closest('.select-control')?.querySelector('button')??control)?.focus({preventScroll:true});
 }
});
const stockUI=createStockUI({api,getState:()=>state,can,page,heading,empty,field,input,option,esc,money,value,cents,date,showModal,modal,icon});
const calculatorUI=createCalculatorUI({getState:()=>state,can,page,heading,empty,field,input,option,esc,money,cents,toast,showInfo:html=>{showModal('Detalhes do cálculo',html,'calculator-info-form');modal.querySelector('[type="submit"]').remove();}});
const financeUI=createFinanceUI({api,getState:()=>state,can,page,heading,metric,empty,field,input,option,esc,money,value,cents,dateLabel:filterDateLabel,today:saoPauloToday,showModal,modal,icon});
const pageHistory=createPageHistory({history:window.history,onNavigate:async route=>{busy=true;try{await navigateHistory(route);}finally{busy=false;}},
 isBlocked:()=>busy||modal.open,onBlocked:()=>{if(modal.open&&!busy)requestModalClose();},
 onError:error=>toast(error.message)});
window.addEventListener('popstate',event=>{pageHistory.pop(event.state);});
window.addEventListener('pagehide',()=>{closeSelectControls();document.body.style.visibility='hidden';});
window.addEventListener('pageshow',async event=>{
 if(!event.persisted){document.body.style.visibility='';return;}
 try{
  adoptState(await api('/state?'+new URLSearchParams(filter)));await financeUI.load();render();
 }catch(error){if(error.status!==401)showLoadError(error);}
 finally{document.body.style.visibility='';}
});
function showLoadError(error) {
 if(modal.open)modal.close();modal.replaceChildren();
 app.innerHTML=`<main class="auth-panel"><section class="auth-card"><h1>Não foi possível carregar</h1><p>Sua sessão não foi encerrada por esta falha. Verifique a conexão e tente novamente.</p><button class="primary" data-action="retry-session">Tentar novamente</button><p class="error">${esc(error.message)}</p></section></main>`;
}
async function bootstrap() {
 try{
  authSettings=await api('/auth/options?metadata=1');await load();
  if(!await pageHistory.restore(state.user.id))render();
 }catch(error){if(error.status===401){if(!app.querySelector('.auth'))renderAuth();}else showLoadError(error);}
}
initSelectControls();
await bootstrap();
