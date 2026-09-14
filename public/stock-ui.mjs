export function matchesStockProduct(product,query='') {
 const normalize=value=>String(value??'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLocaleLowerCase('pt-BR');
 const terms=normalize(query).trim().split(/\s+/).filter(Boolean),text=normalize(`${product.name??''} ${product.sku??''}`);
 return terms.every(term=>text.includes(term));
}

export function createStockUI({api,getState,can,page,heading,empty,field,input,option,esc,money,value,cents,date,showModal,modal,icon}) {
 let dirty=false,report=null;
 const entries=()=>getState()?.stock_entries??[],state=()=>getState();
 const button=(action,label,key='',cls='small')=>`<button type="button" class="${cls}" data-action="stock-${action}" data-id="${esc(key)}">${label}</button>`;
 function entryTable(){
  const list=entries(),costs=can('costs.view'),correct=can('stock.correct')&&can('stock.receive')&&can('costs.enter');
  return `<section class="panel"><div class="panel-header"><div><h2>Histórico de entradas</h2><p>Entradas excluídas ficam identificadas para manter o histórico.</p></div><span class="badge">${list.length} registros</span></div>${list.length?`<div class="table-wrap" tabindex="0" role="region" aria-label="Histórico de entradas"><table class="stock-entries-table"><thead><tr><th>Produto / fornecedor</th><th>Entrada</th><th class="num">Quantidade</th>${costs?'<th class="num">Custo unitário</th><th class="num">Custo total</th>':''}<th>Situação</th><th>Ações</th></tr></thead><tbody>${list.map(e=>`<tr class="${e.voided_at?'entry-voided':''}"><td><strong>${esc(e.product_name)}</strong><small>${esc(e.supplier_name||'Sem fornecedor')}</small>${e.units?.length?`<small class="preserve">${e.units.map(u=>esc(u.serial_number)).join(' · ')}</small>`:''}${e.reason?`<small class="preserve">${esc(e.reason)}</small>`:''}</td><td>${date(e.received_at)}</td><td class="num"><strong>${e.quantity_initial} un.</strong><small>${e.voided_at?'Fora do saldo':e.quantity_remaining+' disponíveis'}</small></td>${costs?`<td class="num">${money(e.unit_cost_cents)}</td><td class="num">${money(e.quantity_initial*e.unit_cost_cents)}</td>`:''}<td><span class="badge ${e.voided_at?'bad':'good'}">${e.voided_at?'Excluída':'Ativa'}</span></td><td><div class="row-actions">${correct&&!e.voided_at?button('entry-edit','Editar',e.id)+button('entry-void','Excluir',e.id,'small subtle danger'):'—'}</div></td></tr>`).join('')}</tbody></table></div>`:empty('Nenhuma entrada registrada','Use Registrar entrada para receber um produto, mesmo que ainda não esteja cadastrado.')}</section>`;
 }
 function serialRow(unit={},editing=false){
  return `<div class="serial-entry-row" data-entry-unit data-unit-id="${esc(unit.id??'')}">${field('SN / IMEI',input('unit_serial',unit.serial_number??'','data-entry-serial required maxlength="120" autocomplete="off" placeholder="Digite ou leia o número"'))}${editing?'':field('Custo (R$)',input('unit_cost','','data-unit-cost required inputmode="decimal" placeholder="0,00"'))}<button type="button" class="small subtle danger" data-action="stock-remove-unit" aria-label="Remover aparelho" ${unit.sold?'disabled':''}>×</button></div>`;
 }
 function syncSerialFields(form){
  if(!form?.querySelector?.('[data-entry-serials]'))return;
  const editing=!!form.dataset.id,isNew=form.querySelector('[name="product_mode"]').value==='new';
  const tracked=isNew?form.querySelector('[name="product_serial_tracked"]')?.checked:!!state().products.find(p=>p.id===form.querySelector('[name="product_id"]').value)?.serial_tracked;
  const group=form.querySelector('[data-entry-serials]');group.hidden=!tracked;group.disabled=!tracked;
  if(tracked&&!editing&&!group.querySelector('[data-entry-unit]'))group.querySelector('[data-entry-unit-rows]').innerHTML=serialRow();
  const quantity=form.querySelector('[name="quantity"]'),cost=form.querySelector('[name="cost"]');
  quantity.readOnly=tracked&&!editing;
  if(tracked&&!editing)quantity.value=group.querySelectorAll('[data-entry-unit]').length;
  cost.disabled=tracked&&!editing;cost.closest('.field').hidden=tracked&&!editing;
  form.dispatchEvent(new Event('change',{bubbles:true}));
  group.querySelector('[data-entry-unit-count]').textContent=`${group.querySelectorAll('[data-entry-unit]').length} aparelho(s) identificado(s)`;
 }
 function openEntry(key=''){
  const e=entries().find(e=>e.id===key);if(key&&!e)throw Error('Atualize o histórico de entradas.');
  if(!can('stock.receive')||!can('costs.enter'))throw Error('Seu usuário não pode registrar entradas.');
  if(e&&!can('stock.correct'))throw Error('Seu usuário não pode corrigir entradas.');
  dirty=false;
  const suppliers=state().suppliers??[],supplierId=e?(e.supplier_id??''):(suppliers.length===1?suppliers[0].id:'');
  const selected=e?.product_id??'',day=e?.received_date??new Intl.DateTimeFormat('en-CA',{timeZone:'America/Sao_Paulo',year:'numeric',month:'2-digit',day:'2-digit'}).format(e?new Date(e.received_at):new Date());
  const productFields=`<div class="fields">${field('Produto',`<select name="product_mode" data-stock-mode>${option('existing','Produto já cadastrado','existing')}${can('products.manage')?option('new','Novo produto — cadastrar nesta entrada','existing'):''}</select>`,true)}</div>
   <fieldset class="entry-product-fields" data-entry-existing><legend class="sr-only">Produto já cadastrado</legend>${field('Buscar produto no estoque',`<select name="product_id" data-search="product" aria-label="Buscar produto no estoque" required>${option('','Selecione um produto',selected)}${state().products.map(p=>option(p.id,p.name+(p.sku?' · '+p.sku:''),selected)).join('')}</select>`)}</fieldset>
   ${can('products.manage')?`<fieldset class="entry-product-fields fields" data-entry-new hidden disabled><legend class="sr-only">Dados do novo produto</legend>${field('Nome do novo produto',input('product_name','','required maxlength="200"'),true)}${field('Código / SKU (opcional)',input('product_sku','','maxlength="80"'))}${field('Preço sugerido de venda (R$)',input('product_price','','required inputmode="decimal" placeholder="0,00"'))}<label class="check-field full-field"><input type="checkbox" name="product_serial_tracked"> Controlar por SN / IMEI</label><p class="footer-note full-field">O produto e a entrada serão salvos juntos. Se houver erro, nenhum dos dois será criado.</p></fieldset>`:''}`;
  showModal(e?'Editar entrada completa':'Registrar entrada',`${productFields}<div class="fields">
   ${field('Data da entrada',input('received_date',day,'type="date" required'),true)}
   ${field('Fornecedor (opcional)',`<select name="supplier_id">${option('','Sem fornecedor',supplierId)}${suppliers.map(s=>option(s.id,s.name,supplierId)).join('')}</select>`,true)}
   ${field('Quantidade recebida',input('quantity',e?.quantity_initial??1,'type="number" min="1" step="1" required'))}
   ${field(e&&!can('costs.view')?'Novo custo (opcional; vazio mantém o atual)':'Custo por unidade (R$)',input('cost',e&&can('costs.view')?value(e.unit_cost_cents):'',`${e?'':'required '}inputmode="decimal" placeholder="${e&&!can('costs.view')?'Custo atual restrito':'0,00'}"`))}
   ${e?field('Motivo da correção',`<textarea name="reason" rows="2" maxlength="500" required></textarea>`,true):''}</div>
   <fieldset class="entry-product-fields" data-entry-serials hidden disabled><legend>SN / IMEI dos aparelhos</legend><p class="footer-note">${e?'Identifique as unidades ainda disponíveis. Isso não cria estoque. Todas usam o custo desta entrada.':'Um número por aparelho, com seu custo de compra.'}</p><div data-entry-unit-rows>${(e?.units??[]).map(u=>serialRow(u,!!e)).join('')}</div><p data-entry-unit-count class="footer-note" role="status"></p><button type="button" class="small" data-action="stock-add-unit">+ Adicionar aparelho</button></fieldset>
   <p class="footer-note">${e?'Trocar produto, data, quantidade ou custo recalcula o estoque e as vendas afetadas. Alterações em meses fechados são protegidas.':'Entradas anteriores são usadas primeiro no custo. Fornecedores podem ser cadastrados em Cadastro → Fornecedores.'}</p>`,'stock-entry-form',`data-id="${e?.id??''}" data-version="${e?.version??1}" data-request-id="${crypto.randomUUID()}"`);
  syncSerialFields(modal.querySelector("#stock-entry-form"));
 }
 function openVoid(key){
  const e=entries().find(e=>e.id===key);if(!e)throw Error('Atualize o histórico.');dirty=false;
  showModal('Excluir entrada',`<div class="finance-modal-summary"><strong>${esc(e.product_name)}</strong><span>${e.quantity_initial} un.${can('costs.view')?' · '+money(e.unit_cost_cents)+' cada':''}</span></div><div class="alert">Esta entrada deixará de compor o estoque. Vendas que usam estas unidades poderão ficar com custo pendente ou receber o custo de outro lote.</div>${field('Motivo da exclusão',`<textarea name="reason" rows="3" maxlength="500" required></textarea>`)}<label class="check-field"><input type="checkbox" name="acknowledge" required> Conferi o produto e a quantidade desta entrada.</label><p class="footer-note">O histórico é preservado. Esta ação não exclui o produto nem suas vendas. Não há reativação pela interface nesta etapa.</p>`,'stock-void-form',`data-id="${key}" data-version="${e.version}" data-request-id="${crypto.randomUUID()}"`);
  modal.querySelector('[type="submit"]').textContent='Excluir esta entrada';
 }
 function reportPage(){
  if(!report){page(empty('Relatório indisponível','Volte para Estoque e gere o relatório novamente.'));return;}
  const costs=can('costs.view'),r=report;
  page(`<div class="stock-report-page">${heading('Relatório de estoque','Posição atual dos produtos e do estoque disponível.',`<div class="actions no-print"><button data-view="stock">Voltar ao estoque</button><a class="button" href="/api/stock/report.csv" download>Baixar CSV</a>${button('report-print','Imprimir / salvar PDF','','primary')}</div>`)}<section class="report-sheet"><div class="report-heading"><div class="report-brand brand-logo-frame"><img src="/gamecell-logo.png" width="640" height="640" alt="Gamecell" decoding="async"></div><div class="report-store"><h2>${esc(r.store)}</h2><p>Gerado em ${new Intl.DateTimeFormat('pt-BR',{timeZone:'America/Sao_Paulo',dateStyle:'short',timeStyle:'short'}).format(new Date(r.generated_at))}</p></div><span class="badge">Posição atual</span></div><div class="report-summary"><div><span>Produtos</span><strong>${r.totals.products}</strong></div><div><span>Unidades disponíveis</span><strong>${r.totals.available_quantity}</strong></div><div><span>Saídas com custo pendente</span><strong>${r.totals.pending_quantity}</strong></div>${costs?`<div><span>Custo do estoque disponível</span><strong>${money(r.totals.inventory_cost_cents)}</strong></div>`:''}</div><div class="table-wrap"><table><thead><tr><th>Produto / SKU</th><th class="num">Entradas</th><th class="num">Vendidas</th><th class="num">Disponível</th><th class="num">Pendente</th><th class="num">Saldo</th>${costs?'<th class="num">Custo do estoque</th>':''}</tr></thead><tbody>${r.products.map(p=>`<tr><td><strong>${esc(p.name)}</strong><small>${esc(p.sku||'Sem SKU')}</small></td><td class="num">${p.received_quantity}</td><td class="num">${p.sold_quantity}</td><td class="num">${p.available_quantity}</td><td class="num">${p.pending_quantity}</td><td class="num ${p.stock<0?'negative':''}">${p.stock}</td>${costs?`<td class="num">${money(p.inventory_cost_cents)}</td>`:''}</tr>`).join('')}</tbody></table></div><p class="footer-note">Entradas excluídas não compõem os totais. O custo do estoque soma as unidades restantes de cada lote pelo seu custo real. Saídas sem entrada ficam pendentes e não recebem custo estimado. Este relatório representa a consulta atual, não uma posição de data passada.</p></section></div>`);
 }
 return {entryTable,openEntry,reportPage,dirty:()=>dirty,
  reset(){dirty=false;report=null;},
  resetModal(){dirty=false;},
  input(el){if(el.form?.id.startsWith('stock-'))dirty=true;},
  change(el){
   if(!el.form||(el.form.id&&el.form.id!=='stock-entry-form')||!el.matches?.('[data-stock-mode],[name="product_id"],[name="product_serial_tracked"]'))return false;
   const form=el.form,isNew=(form.querySelector('[name="product_mode"]')?.value??el.value)==='new';
   for(const [selector,active] of [['[data-entry-new]',isNew],['[data-entry-existing]',!isNew]]){const group=form.querySelector(selector);if(group){group.hidden=!active;group.disabled=!active;}}
   syncSerialFields(form);dirty=true;return true;
  },
  requestClose(){if(!dirty||!modal.querySelector('form[id^="stock-"]'))return false;if(!modal.querySelector('#stock-discard'))modal.querySelector('form').insertAdjacentHTML('beforeend',`<div class="alert" id="stock-discard"><p>Há alterações não salvas. Deseja continuar ou descartar?</p><div class="actions">${button('keep','Continuar preenchendo')}${button('discard','Descartar','','danger')}</div></div>`);modal.querySelector('#stock-discard button').focus();return true;},
  async action(action,key,button){
   if(action==='stock-add-unit'){const form=modal.querySelector('#stock-entry-form'),rows=form.querySelector('[data-entry-unit-rows]');if(rows.children.length>=200)throw Error('Limite de 200 aparelhos por entrada.');rows.insertAdjacentHTML('beforeend',serialRow({},!!form.dataset.id));syncSerialFields(form);dirty=true;rows.lastElementChild.querySelector('input').focus();}
   if(action==='stock-remove-unit'){const form=modal.querySelector('#stock-entry-form');button.closest('[data-entry-unit]').remove();syncSerialFields(form);dirty=true;}

   if(action==='stock-entry-edit'||action==='stock-entry-void'){
    const fresh=await api(`/stock/entries/${key}`),index=entries().findIndex(e=>e.id===key);
    if(index>=0)state().stock_entries[index]=fresh;else state().stock_entries.push(fresh);
   }
   if(action==='stock-entry-edit')openEntry(key);if(action==='stock-entry-void')openVoid(key);
   if(action==='stock-report'){report=await api('/stock/report');return {view:'stock-report'};}
   if(action==='stock-report-print')window.print();
   if(action==='stock-discard'){dirty=false;modal.close();}
   if(action==='stock-keep'){modal.querySelector('#stock-discard').remove();[...modal.querySelectorAll('input,select,textarea,.select-trigger')].find(el=>!el.disabled&&el.getClientRects().length&&!el.classList.contains('select-native'))?.focus();}
  },
  async submit(form,d){
   const key=form.dataset.id,common={version:Number(form.dataset.version),request_id:form.dataset.requestId,reason:d.reason};
   if(form.id==='stock-void-form'){await api(`/stock/entries/${key}/void`,common);return {message:'Entrada excluída do saldo. O histórico foi preservado.'};}
   const data={...common,supplier_id:d.supplier_id||null,quantity:Number(d.quantity),...(d.received_date?{received_date:d.received_date}:{})};
   if(!key||d.cost?.trim())data.unit_cost_cents=cents(d.cost);
   if(d.product_mode==='new')data.new_product={name:d.product_name,sku:d.product_sku,price_cents:cents(d.product_price),...(d.product_serial_tracked?{serial_tracked:true}:{})};else if(d.product_id)data.product_id=d.product_id;
   const serials=form.querySelector?.('[data-entry-serials]');
   if(serials&&!serials.disabled){
    data.units=[...serials.querySelectorAll('[data-entry-unit]')].map(row=>({
     ...(row.dataset.unitId?{id:row.dataset.unitId}:{}),serial_number:row.querySelector('[data-entry-serial]').value,
     ...(!key?{unit_cost_cents:cents(row.querySelector('[data-unit-cost]').value)}:{})
    }));
    if(!key){data.quantity=data.units.length;delete data.unit_cost_cents;}
   }
   await api(key?`/stock/entries/${key}`:'/stock/entries',data,key?'PUT':'POST');
   return {message:key?'Entrada corrigida. Estoque e custos atualizados.':data.new_product?'Produto e entrada registrados.':'Entrada registrada.'};
  }
 };
}
