// Renderiza somente a projeção comercial pública. Nunca recebe estado interno.
const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const money=c=>new Intl.NumberFormat('pt-BR',{style:'currency',currency:'BRL'}).format((c??0)/100);
const logo='<div class="receipt-brand"><div class="brand-logo-frame"><img src="/gamecell-logo.png" width="640" height="640" alt="Gamecell — games, celulares e informática" decoding="async"></div></div>';
export function renderReceipt(s) {
 const methods={pix:'Pix',cash:'Dinheiro',card:'Cartão'};
 return `<header class="receipt-head">${logo}<div class="receipt-heading"><div class="eyebrow">Resumo do pedido</div><h1>#${esc(String(s.number).padStart(4,'0'))}</h1><p>${s.date?esc(s.date.split('-').reverse().join('/')):'Rascunho'}</p></div></header>
 <div class="receipt-content"><p class="receipt-store">${esc(s.store)}</p><section class="fields receipt-parties" aria-label="Cliente e vendedor"><div><p class="eyebrow">Cliente</p><h3>${esc(s.customer??'A definir')}</h3></div><div><p class="eyebrow">Vendedor</p><h3>${esc(s.seller??'A definir')}</h3></div></section>
 <span class="badge ${s.status==='confirmed'?'good':''}">${s.status==='confirmed'?'Venda confirmada':'Rascunho — sujeito a alterações'}</span>
 <h2>Produtos</h2><div class="table-wrap" tabindex="0" role="region" aria-label="Produtos do pedido"><table><thead><tr><th>Produto</th><th class="num">Qtd.</th><th class="num">Preço unitário</th><th class="num">Total</th></tr></thead><tbody>${s.items.map(i=>`<tr><td><strong>${esc(i.description)}</strong>${i.serial_number?`<small class="preserve">IMEI / SN: ${esc(i.serial_number)}</small>`:''}${i.details?`<small class="preserve">${esc(i.details)}</small>`:''}</td><td class="num">${esc(i.quantity)}</td><td class="num">${money(i.unit_price_cents)}</td><td class="num strong">${money(i.total_cents)}</td></tr>`).join('')}</tbody></table></div>
 <div class="receipt-total"><span>Total do pedido</span><strong>${money(s.total_cents)}</strong></div>
 <h2>Pagamentos informados</h2><div class="receipt-payments">${s.payments.map(p=>`<div class="row-stat"><span>${methods[p.method]??'Pagamento'}${p.method==='card'?' · '+esc(p.brand)+' · '+esc(p.installments)+'x':''}</span><strong>${money(p.amount_cents)}</strong></div>`).join('')||'<p class="muted">Nenhum pagamento informado.</p>'}</div>
 ${s.pending_cents?`<div class="alert">Saldo pendente: ${money(s.pending_cents)}</div>`:''}${s.excess_cents?'<div class="alert">Os pagamentos informados apresentam diferença. Consulte a loja.</div>':''}
 ${s.notes?`<h2>Observações</h2><p class="preserve">${esc(s.notes)}</p>`:''}
 <footer class="receipt-footer">Resumo comercial. Não substitui documento fiscal.<br>As informações refletem os registros da loja nesta consulta.</footer>
 <div class="actions no-print"><button type="button" class="primary" id="print">Imprimir / salvar em PDF</button></div></div>`;
}
export function renderReceiptError(message) {
 return `<header class="receipt-head">${logo}<div class="receipt-heading"><h1>Pedido indisponível</h1></div></header><div class="receipt-message"><p>${esc(message)}</p><p class="stat-note">Peça à loja um novo link de consulta.</p></div>`;
}
