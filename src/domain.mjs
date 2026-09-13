/** Valores monetários são sempre inteiros em centavos. Taxas: pontos-base (4% = 400). */
export class AppError extends Error {
  constructor(message, status = 400) { super(message); this.status = status; }
}
export function check(condition, message, status = 400) {
  if (!condition) throw new AppError(message, status);
}
export function integer(value, name, min = 0, max = 100_000_000_000) {
  check(Number.isSafeInteger(value) && value >= min && value <= max,
    `${name} deve ser inteiro entre ${min} e ${max}.`);
  return value;
}
export function text(value, name, max = 200, required = true) {
  const result = typeof value === 'string' ? value.trim() : '';
  check((!required || result.length > 0) && result.length <= max, `${name} inválido.`);
  return result;
}
export function feeCents(amount, basisPoints) {
  integer(amount, 'Pagamento'); integer(basisPoints, 'Taxa', 0, 10_000);
  // Arredondamento half-up de cada parte de pagamento, sem ponto flutuante.
  return Number((BigInt(amount) * BigInt(basisPoints) + 5_000n) / 10_000n);
}
export function sumMoney(values) {
  const result = values.reduce((sum, value) => sum + integer(value, 'Valor'), 0);
  return integer(result, 'Total');
}
export function reconcile(total, payments) {
  integer(total, 'Total da venda');
  const gross = sumMoney(payments.map(p => p.amount_cents));
  const fees = sumMoney(payments.map(p => p.fee_cents ?? 0));
  const difference = gross - total;
  return { total_cents: total, gross_cents: gross, fee_cents: fees,
    net_cents: gross - fees, difference_cents: difference,
    pending_cents: Math.max(0, -difference), excess_cents: Math.max(0, difference),
    state: difference === 0 ? 'matched' : difference < 0 ? 'underpaid' : 'overpaid' };
}
export function saleTotal(items) {
  return sumMoney(items.map(item => {
    integer(item.quantity, 'Quantidade', 1, 1_000_000);
    integer(item.unit_price_cents, 'Preço unitário');
    return integer(item.quantity * item.unit_price_cents, 'Total do item');
  }));
}
/** Preserva a ordem FIFO recebida do repositório, sem alterar os lotes originais. */
export function planFIFO(lots, quantity) {
  integer(quantity, 'Quantidade', 1, 1_000_000);
  let remaining = quantity; const allocations = [];
  for (const lot of lots) {
    integer(lot.quantity_remaining, 'Saldo do lote', 0, 1_000_000);
    integer(lot.unit_cost_cents, 'Custo unitário');
    const taken = Math.min(remaining, lot.quantity_remaining);
    if (taken) allocations.push({ lot_id: lot.id, quantity: taken, unit_cost_cents: lot.unit_cost_cents });
    remaining -= taken;
    if (!remaining) break;
  }
  if (remaining) allocations.push({ lot_id: null, quantity: remaining, unit_cost_cents: null });
  return { allocations, pending_quantity: remaining,
    known_cost_cents: sumMoney(allocations.filter(a => a.unit_cost_cents !== null).map(a => a.quantity * a.unit_cost_cents)) };
}
export const PERMISSIONS = [
  'sales.edit_confirmed', 'stock.correct', 'payments.correct',
  'sales.create', 'sales.confirm', 'sales.edit_draft', 'sales.view_all', 'sales.assign_seller',
  'sales.change_status', 'sales.cancel', 'sales.refund', 'sales.refund_correct',
  'payments.record', 'costs.view', 'costs.enter', 'profit.view',
  'products.manage', 'customers.manage', 'stock.receive', 'settings.manage', 'users.manage', 'sales.share',
  'expenses.view', 'expenses.manage', 'finance.view', 'finance.manage'
];

/** Largest-remainder allocation in cents; totals are conserved and item order is stable. */
export function apportion(amount,items) {
 integer(amount,'Valor a distribuir');if(!items.length)return [];
 let weights=items.map(i=>BigInt(i.quantity)*BigInt(i.unit_price_cents));
 if(weights.every(w=>w===0n))weights=items.map(i=>BigInt(i.quantity));
 const denominator=weights.reduce((s,w)=>s+w,0n);
 const parts=weights.map((w,index)=>({index,amount:Number(BigInt(amount)*w/denominator),rest:BigInt(amount)*w%denominator}));
 let left=amount-parts.reduce((s,p)=>s+p.amount,0);
 const order=[...parts].sort((a,b)=>a.rest===b.rest?(items[a.index].ordinal??a.index)-(items[b.index].ordinal??b.index)||String(items[a.index].id??'').localeCompare(String(items[b.index].id??'')):a.rest>b.rest?-1:1);
 for(const part of order)if(left-->0)part.amount++;
 return parts.map(p=>p.amount);
}
export function itemFinancials(items,reconciliation,freight,expenses,provisionalProfit) {
 const total=saleTotal(items),received=apportion(Math.min(total,reconciliation.gross_cents),items),
  fees=apportion(reconciliation.fee_cents,items),shipping=apportion(freight,items),other=apportion(expenses,items);
 return items.map((item,index)=>{
  const sold=item.quantity*item.unit_price_cents,profit=provisionalProfit===null?null:sold-item.cost_cents-fees[index]-shipping[index]-other[index];
  return {...item,total_cents:sold,received_cents:received[index],pending_cents:sold-received[index],fee_share_cents:fees[index],
   freight_share_cents:shipping[index],expense_share_cents:other[index],provisional_profit_cents:profit,
   profit_cents:reconciliation.state==='matched'?profit:null};
 });
}
export function allowed(actor, permission) { return !!actor.is_owner || actor.permissions.includes(permission); }
export function requirePermission(actor, permission) { check(allowed(actor, permission), 'Acesso não permitido.', 403); }
export function businessDate(date = new Date()) {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(date);
  const v = Object.fromEntries(parts.map(p => [p.type, p.value]));
  return `${v.year}-${v.month}-${v.day}`;
}
/** Projeção pública por lista permitida. Nunca reutilizar o JSON financeiro interno. */
export function publicSale(sale) {
  return {
    store: sale.store_name, number: sale.number, status: sale.status,
    date: sale.business_date, customer: sale.customer_name, seller: sale.seller_name,
    items: sale.items.map(i => ({ description: i.description, quantity: i.quantity,
      unit_price_cents: i.unit_price_cents, total_cents: i.quantity * i.unit_price_cents,
      ...(i.share_details === true ? {serial_number:i.serial_number,details:i.details} : {}) })),
    total_cents: sale.total_cents,
    payments: sale.payments.map(p => ({ method: p.method, amount_cents: p.amount_cents,
      brand: p.method === 'card' ? p.brand : null, installments: p.method === 'card' ? p.installments : null })),
    gross_paid_cents: sale.reconciliation.gross_cents,
    pending_cents: sale.reconciliation.pending_cents,
    excess_cents: sale.reconciliation.excess_cents,
    notes: sale.public_notes
  };
}
