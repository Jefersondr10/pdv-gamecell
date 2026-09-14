const refundLabels={
 pending:'Pendente',
 partial:'Parcial',
 completed:'Concluída',
 not_required:'Sem devolução'
};

const methodLabels={pix:'Pix',cash:'Dinheiro',card:'Cartão',other:'Outro meio'};

function refundAmounts(sale) {
 const cancellation=sale?.cancellation??{};
 const pending=Number(cancellation.refund_pending_cents??0);
 const completed=Number(cancellation.refund_completed_cents??0);
 const original=Number(cancellation.refund_original_cents??(pending+completed));
 return {cancellation,original,completed,pending};
}

export function refundManagement(sale,{esc,money,date,can}) {
 const {cancellation,original,completed,pending}=refundAmounts(sale);
 if(sale?.status!=='cancelled'||original<=0)return '';
 const state=cancellation.refund_state??(pending<=0?'completed':completed>0?'partial':'pending');
 const history=Array.isArray(cancellation.refunds)?cancellation.refunds:[];
 const action=pending>0&&can('sales.refund')
  ? `<button type="button" class="primary small" data-action="record-refund" data-id="${esc(sale.id)}">Registrar devolução realizada</button>`
  : '';
 const guidance=pending>0
  ? '<p class="refund-guidance">Devolva ao cliente pelo meio combinado e depois registre aqui. O sistema não faz Pix nem estorno automaticamente.</p>'
  : '<p class="refund-guidance refund-complete-message">Todo o valor recebido já foi marcado como devolvido.</p>';
 const records=history.length?`<details class="refund-history"><summary>Ver histórico · ${history.length}</summary><ul>${history.map(item=>{
  const reversed=item.reversed&&item.reversal,correction=reversed
   ? `<div class="refund-correction-note"><span class="badge">Baixa corrigida</span><small>${date(`${item.reversal.reversed_date}T12:00:00-03:00`)} · ${esc(item.reversal.reason)} · por ${esc(item.reversal.author??'Usuário')}</small></div>`
   : can('sales.refund_correct')?`<button type="button" class="small subtle refund-correct-button" data-action="reverse-refund" data-id="${esc(sale.id)}" data-refund-id="${esc(item.id)}">Corrigir registro</button>`:'';
  return `<li class="${reversed?'refund-history-reversed':''}"><div><strong>${esc(methodLabels[item.method]??'Outro meio')} · devolução informada em ${date(`${item.refunded_date}T12:00:00-03:00`)}</strong>${item.notes?`<small>${esc(item.notes)}</small>`:''}<small>Registrado em ${date(item.created_at)} por ${esc(item.author??'Usuário')}</small>${correction}</div><strong>${money(item.amount_cents)}</strong></li>`;
 }).join('')}</ul></details>`:'';
 return `<section class="panel refund-management" aria-label="Devolução ao cliente"><div class="panel-header"><div><h2>Devolução ao cliente</h2></div><span class="badge ${state==='completed'?'good':'warn'}">${esc(refundLabels[state]??'Pendente')}</span></div><div class="panel-body"><div class="refund-summary"><div><span>Recebido</span><strong>${money(original)}</strong></div><div><span>Devolvido</span><strong>${money(completed)}</strong></div><div class="${pending>0?'refund-due':'refund-done'}"><span>A devolver</span><strong>${money(pending)}</strong></div></div>${guidance}${action}${records}</div></section>`;
}

export function refundMethodOptions(selected='pix',esc=value=>String(value??'')) {
 return Object.entries(methodLabels).map(([value,label])=>`<option value="${esc(value)}" ${value===selected?'selected':''}>${esc(label)}</option>`).join('');
}
