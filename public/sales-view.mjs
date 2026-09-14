export function wholesaleBadge(sale) {
 return sale.is_wholesale ? '<span class="wholesale-badge">Atacado</span>' : '';
}

export function saleTiming(sale,{esc,date,time}) {
 const registeredAt=sale.registered_at??sale.created_at;
 const commercialDate=sale.business_date?date(`${sale.business_date}T12:00:00-03:00`):date(registeredAt);
 const hasTimeFormatter=typeof time==='function',registeredTime=hasTimeFormatter?time(registeredAt):'';
 return `<span class="sale-timing" aria-label="Data e hora da venda"><strong>${esc(commercialDate)}</strong>${registeredTime?`<span aria-hidden="true">·</span><span>${esc(registeredTime)}</span>`:''}</span>`;
}

export function sellerRanking(items,{esc,money}) {
 const ranking=Array.isArray(items)?items:[],hasProfit=ranking.some(item=>item.profit_cents!=null),sellerCount=ranking.filter(item=>item.seller_id!=null).length,hasUnassigned=ranking.some(item=>item.seller_id==null);
 const rows=ranking.map(item=>{
  const ranked=Number.isInteger(item.position)&&item.position>0,position=ranked?item.position:null;
  const count=Number.isInteger(item.sales_count)&&item.sales_count>=0?item.sales_count:0,incomplete=Number.isInteger(item.incomplete_sales)&&item.incomplete_sales>0?item.incomplete_sales:0;
  return `<li class="seller-ranking-row${ranked&&position<=3?' seller-ranking-podium':''}${ranked?'':' seller-ranking-unassigned'}"${ranked?` data-rank="${position}"`:''}><span class="seller-ranking-position" ${ranked?`aria-label="${position}º lugar"`:'aria-label="Sem posição"'}>${ranked?`${position}º`:'—'}</span><div class="seller-ranking-identity"><strong>${esc(item.seller_name||'Sem vendedor')}</strong><span>${count} ${count===1?'venda':'vendas'}${incomplete?`<em>${incomplete} a conferir</em>`:''}</span></div><div class="seller-ranking-values"><div><span>Faturamento</span><strong>${money(item.revenue_cents??0)}</strong></div>${item.profit_cents!=null?`<div class="seller-ranking-profit"><span>Lucro apurado</span><strong>${money(item.profit_cents)}</strong></div>`:''}</div></li>`;
 }).join('');
 return `<section class="panel seller-ranking" aria-labelledby="seller-ranking-title"><div class="panel-header"><div><h2 id="seller-ranking-title">Ranking por faturamento</h2><p>Vendedores comparados pelas vendas confirmadas nos mesmos filtros do Dashboard.</p></div><span class="badge">${sellerCount} ${sellerCount===1?'vendedor':'vendedores'}${hasUnassigned?' · cadastro pendente':''}</span></div>${rows?`<ol class="seller-ranking-list${hasProfit?' has-profit':''}">${rows}</ol>`:'<div class="seller-ranking-empty" role="status"><strong>Nenhuma venda confirmada neste filtro</strong><span>Altere o período ou os filtros para comparar os vendedores.</span></div>'}</section>`;
}
export function wholesaleEditor(selected) {
 return `<label class="sale-wholesale sale-wholesale-editor"><input type="checkbox" data-bind="is_wholesale" ${selected?'checked':''} aria-label="Venda de atacado"><span>Atacado</span></label>`;
}
export function wholesaleControl(sale,{esc,can}) {
 const editable=sale.status!=='cancelled'&&can(sale.status==='confirmed'?'sales.edit_confirmed':'sales.edit_draft');
 if(!editable)return wholesaleBadge(sale);
 return `<label class="sale-wholesale"><input type="checkbox" data-sale-wholesale="${esc(sale.id)}" data-previous="${!!sale.is_wholesale}" ${sale.is_wholesale?'checked':''} aria-label="Venda de atacado — venda ${sale.number}"><span>Atacado</span></label>`;
}
export function cancelSaleButton(sale,{esc,can}) {
 return sale.id&&['draft','confirmed'].includes(sale.status)&&can('sales.cancel')?`<button type="button" class="small danger" data-action="cancel-sale" data-id="${esc(sale.id)}">Cancelar venda</button>`:'';
}

const detailCents = value => Number.isFinite(Number(value)) ? Number(value) : 0;
const detailProfitTone = value => value == null ? 'pending' : value < 0 ? 'loss' : value > 0 ? 'profit' : 'neutral';
const detailProfitLabel = value => value != null && value < 0 ? 'Prejuízo' : 'Lucro';
const detailItems = sale => Array.isArray(sale.items) ? sale.items : [];
const detailPayments = sale => Array.isArray(sale.payments) ? sale.payments : [];
const detailExpenses = sale => Array.isArray(sale.expenses) ? sale.expenses : [];

function saleDetailNotices(sale,{money,can}) {
 const notices=[],reconciliation=sale.reconciliation??{},reasons=new Set(sale.review?.reasons??[]);
 if(sale.status==='draft')notices.push('A venda ainda é um rascunho. Confirme para baixar o estoque e apurar o resultado.');
 if(detailCents(reconciliation.pending_cents)>0)notices.push(`Falta registrar ${money(reconciliation.pending_cents)} em pagamentos.`);
 else if(detailCents(reconciliation.excess_cents)>0)notices.push(`Os pagamentos estão ${money(reconciliation.excess_cents)} acima do total da venda.`);
 if(reasons.has('pending_cost')){
  if(can('costs.view')){
   const pendingCount=Number.isInteger(sale.pending_cost_quantity)?sale.pending_cost_quantity:detailItems(sale).reduce((sum,item)=>sum+detailCents(item.pending_cost_quantity),0);
   notices.push(pendingCount>0?`${pendingCount} ${pendingCount===1?'item está':'itens estão'} sem custo informado.`:'Há produto sem custo informado.');
  } else notices.push('Há informação interna pendente.');
 }
 const labels={
  missing_customer:'Cliente não informado.',missing_seller:'Vendedor não informado.',missing_business_date:'Data da venda não informada.',
  missing_items:'Nenhum produto informado.',missing_serials:'Há produto controlado sem o IMEI ou SN completo.',missing_pix_account:'Há Pix sem conta identificada.',
  missing_card_details:'Há pagamento em cartão com dados incompletos.',missing_payment_date:'Há pagamento sem data válida.'
 };
 for(const reason of reasons)if(labels[reason])notices.push(labels[reason]);
 if(sale.review?.manual&&!sale.review?.automatic)notices.push('Esta venda foi marcada manualmente para conferência.');
 if(sale.profit_cents==null&&sale.status==='confirmed'&&can('profit.view')&&!notices.length)notices.push('O lucro ainda não pode ser apurado. Revise os dados da venda.');
 if(!notices.length)return '';
 return `<section class="sale-detail-warnings" aria-labelledby="sale-detail-warnings-title"><div class="sale-detail-warnings-heading"><h2 id="sale-detail-warnings-title">Avisos</h2><span>${notices.length}</span></div><ul>${notices.map(message=>`<li>${message}</li>`).join('')}</ul></section>`;
}

function saleDetailSummary(sale,{money,can}) {
 const canCosts=can('costs.view'),canProfit=can('profit.view'),reconciliation=sale.reconciliation??{};
 const directExpenses=detailCents(sale.freight_cents)+detailExpenses(sale).reduce((total,expense)=>total+detailCents(expense.amount_cents),0);
 const allExpenses=directExpenses+detailCents(reconciliation.fee_cents),profitTone=detailProfitTone(sale.profit_cents);
 const metrics=[
  `<div class="sale-detail-metric"><span>Total vendido</span><strong>${money(sale.total_cents)}</strong></div>`,
  `<div class="sale-detail-metric"><span>Pagamento recebido</span><strong>${money(reconciliation.gross_cents)}</strong></div>`
 ];
 if(canCosts)metrics.push(`<div class="sale-detail-metric"><span>Despesas</span><strong>${money(allExpenses)}</strong></div>`);
 if(canProfit)metrics.push(`<div class="sale-detail-metric sale-detail-profit ${profitTone}"><span>${detailProfitLabel(sale.profit_cents)}</span><strong>${sale.profit_cents==null?'Pendente':money(sale.profit_cents)}</strong></div>`);
 return `<section class="sale-detail-summary summary-${metrics.length}" aria-label="Resumo financeiro da venda">${metrics.join('')}</section>`;
}

function saleDetailProductCards(sale,{esc,money,can}) {
 const canCosts=can('costs.view'),canProfit=can('profit.view');
 const editable=(sale.status==='confirmed'&&can('sales.edit_confirmed'))||(sale.status==='draft'&&can('sales.edit_draft'));
 const cards=detailItems(sale).map(item=>{
  const profitTone=detailProfitTone(item.profit_cents),valueCount=2+Number(canCosts)+Number(canProfit);
  const name=`<div class="sale-detail-product-title"><h3 class="sale-detail-product-heading">${editable?`<button class="link-button sale-detail-product-name" data-action="edit-sale" data-id="${esc(sale.id)}" data-item-id="${esc(item.id)}" aria-label="Editar produto ${esc(item.description)}">${esc(item.description)}</button>`:`<span class="sale-detail-product-name">${esc(item.description)}</span>`}</h3><strong class="sale-detail-product-quantity">${esc(item.quantity)}x</strong></div>`;
  const identifiers=[item.serial_number?`<span class="sale-detail-serial">IMEI / SN: ${esc(item.serial_number)}</span>`:'',item.details?`<span>${esc(item.details)}</span>`:''].filter(Boolean).join('');
  return `<article class="sale-detail-product"><header>${name}${identifiers?`<div class="sale-detail-product-meta">${identifiers}</div>`:''}</header><dl class="sale-detail-values values-${valueCount}"><div><dt>Preço unit.</dt><dd>${money(item.unit_price_cents)}</dd></div><div><dt>Total</dt><dd>${money(detailCents(item.total_cents)||detailCents(item.quantity)*detailCents(item.unit_price_cents))}</dd></div>${canCosts?`<div><dt>Custo</dt><dd>${item.pending_cost_quantity?'Pendente':money(item.cost_cents)}</dd></div>`:''}${canProfit?`<div class="${profitTone}"><dt>${detailProfitLabel(item.profit_cents)}</dt><dd>${item.profit_cents==null?'Pendente':money(item.profit_cents)}</dd></div>`:''}</dl></article>`;
 }).join('');
 return `<section class="panel sale-detail-section sale-detail-products" aria-labelledby="sale-products-title"><div class="panel-header"><h2 id="sale-products-title">Produtos vendidos</h2><span class="badge">${detailItems(sale).length}</span></div>${cards?`<div class="sale-detail-product-list">${cards}</div>`:'<div class="sale-detail-empty">Nenhum produto informado.</div>'}</section>`;
}

function saleDetailPaymentCards(sale,{esc,money,can}) {
 const canCosts=can('costs.view'),payments=detailPayments(sale);
 const cards=payments.map(payment=>{
  const method=payment.method==='pix'?'Pix':payment.method==='cash'?'Dinheiro':payment.method==='card'?'Cartão':'Pagamento';
  const detail=payment.method==='pix'?(payment.pix_account_name||'Conta não informada'):payment.method==='card'?[payment.machine,payment.brand,payment.installments?`${payment.installments}x`:''].filter(Boolean).join(' · '):'';
  const fee=detailCents(payment.fee_cents),net=detailCents(payment.amount_cents)-fee;
  return `<article class="sale-detail-payment"><header><strong>${method}</strong>${detail?`<span>${esc(detail)}</span>`:''}</header><dl class="sale-detail-payment-values${canCosts?' has-costs':''}"><div><dt>Recebido</dt><dd>${money(payment.amount_cents)}</dd></div>${canCosts?`<div><dt>Taxa</dt><dd>${money(fee)}</dd></div><div><dt>Líquido</dt><dd>${money(net)}</dd></div>`:''}</dl></article>`;
 }).join('');
 return `<section class="panel sale-detail-section sale-detail-payments" aria-labelledby="sale-payments-title"><div class="panel-header"><h2 id="sale-payments-title">Pagamentos</h2>${can('payments.record')?`<button class="small" data-action="modal-payment" data-id="${esc(sale.id)}">+ Registrar</button>`:''}</div>${cards?`<div class="sale-detail-payment-list">${cards}</div>`:'<div class="sale-detail-empty">Nenhum pagamento registrado.</div>'}</section>`;
}

function saleDetailCosts(sale,{esc,money,can}) {
 if(!can('costs.view'))return '';
 const expenses=detailExpenses(sale),freight=detailCents(sale.freight_cents),total=freight+expenses.reduce((sum,expense)=>sum+detailCents(expense.amount_cents),0);
 if(total===0&&!expenses.length)return '';
 return `<section class="panel sale-detail-section sale-detail-costs" aria-labelledby="sale-costs-title"><div class="panel-header"><h2 id="sale-costs-title">Frete e despesas</h2><strong>${money(total)}</strong></div><div class="sale-detail-cost-groups"><div><h3>Frete</h3><div class="sale-detail-cost-row"><span>Pago pela loja</span><strong>${money(freight)}</strong></div></div><div><h3>Outras despesas</h3>${expenses.length?expenses.map(expense=>`<div class="sale-detail-cost-row"><span>${esc(expense.description||'Despesa')}</span><strong>${money(expense.amount_cents)}</strong></div>`).join(''):'<p class="muted">Nenhuma.</p>'}</div></div></section>`;
}

export function saleDetailView(sale,{esc,money,date,time,can,icon,statusBadge,operationalStatusControl}) {
 const number=String(sale.number).padStart(4,'0'),editable=(sale.status==='confirmed'&&can('sales.edit_confirmed'))||(sale.status==='draft'&&can('sales.edit_draft'));
 const notes=sale.public_notes?`<details class="panel compact-disclosure sale-detail-disclosure"><summary>Observação para o cliente</summary><p class="preserve">${esc(sale.public_notes)}</p></details>`:'';
 const corrections=sale.corrections?.length?`<details class="panel compact-disclosure sale-detail-disclosure"><summary>Histórico de correções · ${sale.corrections.length}</summary>${sale.corrections.map(correction=>`<div class="correction-record"><strong>${date(correction.created_at)} · ${esc(correction.author)}</strong><p>${esc(correction.reason)}</p></div>`).join('')}</details>`:'';
 const cancel=cancelSaleButton(sale,{esc,can});
 const exceptionalState=sale.status==='draft'?statusBadge(sale):'';
 return `<div class="sale-detail-page"><header class="sale-detail-header"><button type="button" class="sale-detail-icon-button sale-detail-back" data-view="sales" aria-label="Voltar às vendas" title="Voltar às vendas">${icon('arrow')}</button><div class="sale-detail-heading"><div class="sale-detail-title-line"><h1>Venda <span>#${esc(number)}</span></h1><div class="sale-detail-header-actions">${editable?`<button type="button" class="small" data-action="edit-sale" data-id="${esc(sale.id)}">Editar</button>`:''}${can('sales.share')?`<button type="button" class="sale-detail-icon-button primary" data-action="share-sale" data-id="${esc(sale.id)}" aria-label="Compartilhar venda #${esc(number)}" title="Compartilhar">${icon('share')}</button>`:''}</div></div><div class="sale-detail-party"><strong>${esc(sale.customer_name||'Cliente a definir')}</strong><span>${esc(sale.seller_name||'Vendedor a definir')}</span>${saleTiming(sale,{esc,date,time})}</div><div class="sale-detail-flags">${exceptionalState}${wholesaleControl(sale,{esc,can})}</div></div></header><section class="sale-detail-status" aria-labelledby="sale-status-title"><h2 id="sale-status-title">Status</h2><div>${operationalStatusControl(sale,'detalhe')}</div></section>${saleDetailSummary(sale,{money,can})}${saleDetailNotices(sale,{money,can})}${saleDetailProductCards(sale,{esc,money,can})}${saleDetailPaymentCards(sale,{esc,money,can})}${saleDetailCosts(sale,{esc,money,can})}${notes}${corrections}${cancel?`<section class="sale-detail-cancel"><strong>Cancelar venda</strong>${cancel}</section>`:''}</div>`;
}

export function cancelledSaleDetailView(sale,{esc,money,date,time,icon}) {
 const number=String(sale.number).padStart(4,'0'),cancellation=sale.cancellation??{},items=detailItems(sale);
 const received=detailCents(cancellation.refund_original_cents??sale.reconciliation?.gross_cents),reversed=detailCents(cancellation.refund_completed_cents??received);
 const products=items.map(item=>`<article class="sale-detail-product cancelled-detail-product"><header><div class="sale-detail-product-title"><h3 class="sale-detail-product-heading"><span class="sale-detail-product-name">${esc(item.description||'Produto sem nome')}</span></h3><strong class="sale-detail-product-quantity">${esc(item.quantity)}x</strong></div>${item.serial_number?`<div class="sale-detail-product-meta"><span class="sale-detail-serial">IMEI / SN: ${esc(item.serial_number)}</span></div>`:''}</header><dl class="sale-detail-values values-2"><div><dt>Preço unit.</dt><dd>${money(item.unit_price_cents)}</dd></div><div><dt>Total</dt><dd>${money(detailCents(item.total_cents)||detailCents(item.quantity)*detailCents(item.unit_price_cents))}</dd></div></dl></article>`).join('');
 return `<header class="sale-detail-header sale-cancelled-header"><button type="button" class="sale-detail-icon-button sale-detail-back" data-view="sales" aria-label="Voltar às vendas" title="Voltar às vendas">${icon('arrow')}</button><div class="sale-detail-heading"><div class="sale-detail-title-line"><h1>Venda <span>#${esc(number)}</span></h1></div><div class="sale-detail-party"><strong>${esc(sale.customer_name||'Cliente a definir')}</strong><span>${esc(sale.seller_name||'Vendedor a definir')}</span>${saleTiming(sale,{esc,date,time})}</div><div class="sale-detail-flags"><span class="badge bad">Cancelada</span>${wholesaleBadge(sale)}</div></div></header><section class="sale-detail-summary summary-3 cancelled-detail-summary" aria-label="Resumo da venda cancelada"><div class="sale-detail-metric"><span>Venda cancelada</span><strong>${money(sale.total_cents)}</strong></div><div class="sale-detail-metric"><span>Recebido</span><strong>${money(received)}</strong></div><div class="sale-detail-metric profit"><span>Estornado</span><strong>${money(reversed)}</strong></div></section><section class="panel sale-detail-section sale-detail-products" aria-labelledby="cancelled-products-title"><div class="panel-header"><h2 id="cancelled-products-title">Produtos do pedido</h2><span class="badge">${items.length}</span></div>${products?`<div class="sale-detail-product-list">${products}</div>`:'<div class="sale-detail-empty">Nenhum produto informado.</div>'}</section><section class="sale-cancellation-note" aria-label="Informações do cancelamento"><div><strong>Cancelada em ${date(cancellation.created_at)}</strong>${cancellation.author?`<span>por ${esc(cancellation.author)}</span>`:''}</div>${cancellation.reason?`<p class="preserve">${esc(cancellation.reason)}</p>`:''}<small>Venda fora dos totais. Estoque e valores foram estornados no sistema.</small></section>`;
}
export function refundBadge(sale,money) {
 const cancellation=sale.cancellation??{},amount=cancellation.refund_pending_cents??0,original=cancellation.refund_original_cents??amount;
 if(original<=0)return '';
 return amount>0?`<span class="badge warn refund-pending-badge">Falta devolver · ${money(amount)}</span>`:'<span class="badge good refund-completed-badge">Devolução concluída</span>';
}
export function refundReminders(summary,{esc,money}) {
 if(!summary?.count)return '';
 return `<details class="refund-reminders"><summary><span>Valores a devolver · ${summary.count}</span><strong>${money(summary.total_cents)}</strong></summary><p>Este lembrete considera <strong>todos os períodos e tipos de venda</strong>, independentemente dos filtros da tela. Abra o pedido, devolva o valor ao cliente pelo meio combinado e use <strong>Registrar devolução realizada</strong>. O sistema não movimenta banco ou cartão automaticamente.</p><ul>${summary.items.map(item=>`<li><button class="link-button" data-action="open-sale" data-id="${esc(item.id)}">#${String(item.number).padStart(4,'0')} · ${esc(item.customer_name||'Cliente a definir')}</button><strong>${money(item.pending_cents)}</strong></li>`).join('')}</ul></details>`;
}
export function cancellationPayments(s,{esc,money}) {
 if(!s.payments?.length)return '';
 const methods={cash:'Dinheiro',pix:'Pix',card:'Cartão'};
 return `<details class="compact-disclosure cancellation-payments"><summary>Pagamentos recebidos · ${money(s.reconciliation.gross_cents)}</summary><p>Histórico preservado. O cancelamento sozinho não devolve o dinheiro ao cliente.</p><ul>${s.payments.map(p=>`<li><span>${methods[p.method]}${p.method==='pix'?` · ${esc(p.pix_account_name||'Conta não informada')}`:p.method==='card'?` · ${esc(p.machine)} · ${esc(p.brand)} · ${p.installments}x`:''}</span><strong>${money(p.amount_cents)}</strong></li>`).join('')}</ul><p>Taxas do cartão, frete e despesas do pedido não são estornados automaticamente. Confira esses custos antes de fechar o mês.</p></details>`;
}
export function cancelledRecord(s,{esc,money,date,time,statusBadge,showDetails=true}) {
 const cancellation=s.cancellation??{},received=detailCents(cancellation.refund_original_cents??s.reconciliation?.gross_cents),reversed=detailCents(cancellation.refund_completed_cents??received);
 const metrics=[['Venda',money(s.total_cents),''],['Recebido',money(received),''],['Estornado',money(reversed),'profit']];
 return `<article class="sale-record sale-record-compact sale-record-cancelled" aria-label="Venda ${esc(s.number)} cancelada"><div class="sale-record-overview"><button type="button" class="sale-record-open-button" data-action="open-sale" data-id="${esc(s.id)}" aria-label="Abrir venda #${String(s.number).padStart(4,'0')} de ${esc(s.customer_name||'cliente a definir')}"></button><span class="sale-record-compact-identity"><span class="sale-number">#${String(s.number).padStart(4,'0')}</span><span><strong>${esc(s.customer_name||'Cliente a definir')}</strong><span class="sale-record-meta-line">${saleTiming(s,{esc,date,time})}${wholesaleBadge(s)}</span></span></span><span class="sale-record-compact-values values-${metrics.length}">${metrics.map(([label,value,tone])=>`<span class="${tone}"><small>${label}</small><strong>${value}</strong></span>`).join('')}</span></div><footer class="sale-record-compact-footer"><span class="badge bad">Cancelada</span><span class="sale-record-seller-badge" title="Vendedor: ${esc(s.seller_name||'Não informado')}">${esc(s.seller_name||'Sem vendedor')}</span>${showDetails?'<span class="sale-record-open-hint">Abrir pedido →</span>':''}</footer></article>`;
}
export function salesRecords(sales,{esc,money,date,time,can,statusBadge,paymentBadge,operationalStatusControl,empty}) {
 if(!sales.length)return empty('Nenhuma venda nesta seleção','Ajuste os filtros ou abra Vender no menu lateral.');
 const alerts=s=>{
  const items=[];
  if(s.status==='draft')items.push(statusBadge(s));
  if(s.reconciliation?.state&&s.reconciliation.state!=='matched')items.push(paymentBadge(s));
  return items.length?`<div class="sale-record-alerts" aria-label="Avisos da venda">${items.join('')}</div>`:'';
 };
 const record=s=>{
  if(s.status==='cancelled')return cancelledRecord(s,{esc,money,date,time,statusBadge});
  const direct=detailCents(s.freight_cents)+detailExpenses(s).reduce((sum,item)=>sum+detailCents(item.amount_cents),0),cost=detailCents(s.known_cost_cents)+detailCents(s.reconciliation?.fee_cents)+direct;
  const metrics=[['Venda',money(s.total_cents),'']];
  if(can('costs.view'))metrics.push(['Custo total',s.pending_cost_quantity>0?'Pendente':money(cost),s.pending_cost_quantity>0?'pending':'']);
  if(can('profit.view'))metrics.push([detailProfitLabel(s.profit_cents),s.profit_cents==null?'Pendente':money(s.profit_cents),detailProfitTone(s.profit_cents)]);
  return `<article class="sale-record sale-record-compact" aria-label="Venda ${esc(s.number)}"><div class="sale-record-overview"><button type="button" class="sale-record-open-button" data-action="open-sale" data-id="${esc(s.id)}" aria-label="Abrir venda #${String(s.number).padStart(4,'0')} de ${esc(s.customer_name||'cliente a definir')}"></button><span class="sale-record-compact-identity"><span class="sale-number">#${String(s.number).padStart(4,'0')}</span><span><strong>${esc(s.customer_name||'Cliente a definir')}</strong><span class="sale-record-meta-line">${saleTiming(s,{esc,date,time})}${wholesaleControl(s,{esc,can})}</span></span></span><span class="sale-record-compact-values values-${metrics.length}">${metrics.map(([label,value,tone])=>`<span class="${tone}"><small>${label}</small><strong>${value}</strong></span>`).join('')}</span></div><footer class="sale-record-compact-footer"><div class="sale-record-compact-status" aria-label="Status da venda">${operationalStatusControl(s,'histórico')}</div><span class="sale-record-seller-badge" title="Vendedor: ${esc(s.seller_name||'Não informado')}">${esc(s.seller_name||'Sem vendedor')}</span>${alerts(s)}<span class="sale-record-open-hint">Abrir pedido →</span></footer></article>`;
 };
 return `<div class="sales-records sales-records-compact">${sales.map(record).join('')}</div>`;
}
