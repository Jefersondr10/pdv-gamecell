const TABS = Object.freeze([
  Object.freeze({ key: 'sellers', label: 'Vendedores', title: 'Ranking de vendedores' }),
  Object.freeze({ key: 'products', label: 'Produtos', title: 'Ranking de produtos' }),
  Object.freeze({ key: 'days', label: 'Dias', title: 'Ranking por dia' })
]);

const own = (value, key) => value != null && Object.prototype.hasOwnProperty.call(value, key);
const list = value => Array.isArray(value) ? value : [];
const cents = value => Number.isSafeInteger(value) ? value : null;
const label = (value, fallback) => typeof value === 'string' && value.trim() ? value.trim() : fallback;
const saleKey = (sale, index) => sale?.id == null ? `sale-index:${index}` : `sale:${String(sale.id)}`;

export function escapeRankingText(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

export function formatRankingMoney(value) {
  if (cents(value) == null) return 'A apurar';
  return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(value / 100);
}

export function formatRankingDay(value) {
  const match = typeof value === 'string' && /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  return match ? `${match[3]}/${match[2]}/${match[1]}` : 'Sem data';
}

function itemRevenue(item) {
  const total = cents(item?.total_cents);
  if (total != null) return total;
  const quantity = cents(item?.quantity), unitPrice = cents(item?.unit_price_cents);
  if (quantity == null || quantity < 0 || unitPrice == null) return null;
  const calculated = quantity * unitPrice;
  return Number.isSafeInteger(calculated) ? calculated : null;
}

function bucket(key, name, rankable = true) {
  return {
    key, name, rankable, sale_keys: new Set(), revenue_cents: 0,
    revenue_complete: true, profit_cents: 0, profit_complete: true
  };
}

function add(bucketValue, key, revenue, profit, profitProvided) {
  bucketValue.sale_keys.add(key);
  if (revenue == null) bucketValue.revenue_complete = false;
  else bucketValue.revenue_cents += revenue;
  if (!profitProvided || profit == null) bucketValue.profit_complete = false;
  else bucketValue.profit_cents += profit;
}

function finish(rows, showProfit) {
  const collator = new Intl.Collator('pt-BR', { sensitivity: 'base', numeric: true });
  const ordered = [...rows.values()].map(value => ({
    key: value.key,
    name: value.name,
    rankable: value.rankable,
    sales_count: value.sale_keys.size,
    revenue_cents: value.revenue_complete ? value.revenue_cents : null,
    ...(showProfit ? { profit_cents: value.profit_complete ? value.profit_cents : null } : {})
  })).sort((left, right) =>
    Number(!left.rankable) - Number(!right.rankable) ||
    Number(left.revenue_cents == null) - Number(right.revenue_cents == null) ||
    (right.revenue_cents ?? 0) - (left.revenue_cents ?? 0) ||
    right.sales_count - left.sales_count ||
    collator.compare(left.name, right.name) ||
    String(left.key).localeCompare(String(right.key))
  );

  let ranked = 0, previousRevenue = null, previousPosition = 0;
  return ordered.map(row => {
    if (!row.rankable || row.revenue_cents == null) return { ...row, position: null };
    ranked += 1;
    const position = previousRevenue === row.revenue_cents ? previousPosition : ranked;
    previousRevenue = row.revenue_cents;
    previousPosition = position;
    return { ...row, position };
  });
}

export function buildRankings(sales, { canViewProfit = false } = {}) {
  const confirmed = list(sales).filter(sale => sale?.status === 'confirmed');
  const saleProfitProvided = confirmed.some(sale => own(sale, 'profit_cents'));
  const itemProfitProvided = confirmed.some(sale => list(sale.items).some(item => own(item, 'profit_cents')));
  const showSaleProfit = canViewProfit === true && saleProfitProvided;
  const showItemProfit = canViewProfit === true && itemProfitProvided;
  const sellers = new Map(), products = new Map(), days = new Map();
  let revenue = 0, revenueComplete = true, profit = 0, profitComplete = true;

  confirmed.forEach((sale, saleIndex) => {
    const key = saleKey(sale, saleIndex), saleRevenue = cents(sale.total_cents);
    const saleProfit = cents(sale.profit_cents), hasSaleProfit = own(sale, 'profit_cents');
    if (saleRevenue == null) revenueComplete = false;
    else revenue += saleRevenue;
    if (showSaleProfit) {
      if (!hasSaleProfit || saleProfit == null) profitComplete = false;
      else profit += saleProfit;
    }

    const sellerId = sale.seller_id == null ? null : String(sale.seller_id);
    const sellerName = label(sale.seller_name, 'Sem vendedor');
    const sellerMapKey = sellerId == null ? `unassigned:${sellerName}` : `seller:${sellerId}`;
    if (!sellers.has(sellerMapKey)) sellers.set(sellerMapKey, bucket(sellerMapKey, sellerName, sellerId != null));
    add(sellers.get(sellerMapKey), key, saleRevenue, saleProfit, hasSaleProfit);

    const businessDate = typeof sale.business_date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(sale.business_date)
      ? sale.business_date : null;
    const dayMapKey = businessDate == null ? 'day:unknown' : `day:${businessDate}`;
    if (!days.has(dayMapKey)) days.set(dayMapKey, bucket(dayMapKey, businessDate ?? 'Sem data', businessDate != null));
    add(days.get(dayMapKey), key, saleRevenue, saleProfit, hasSaleProfit);

    list(sale.items).forEach((item, itemIndex) => {
      const productId = item?.product_id == null ? null : String(item.product_id);
      const productName = label(item?.description ?? item?.product_name, 'Produto sem identificação');
      const productMapKey = productId != null
        ? `product:${productId}`
        : productName !== 'Produto sem identificação'
          ? `item-name:${productName.toLocaleLowerCase('pt-BR')}`
          : `item-unknown:${saleIndex}:${itemIndex}`;
      if (!products.has(productMapKey)) products.set(productMapKey, bucket(productMapKey, productName, productName !== 'Produto sem identificação'));
      add(products.get(productMapKey), key, itemRevenue(item), cents(item?.profit_cents), own(item, 'profit_cents'));
    });
  });

  return {
    summary: {
      sales_count: confirmed.length,
      revenue_cents: revenueComplete ? revenue : null,
      ...(showSaleProfit ? { profit_cents: profitComplete ? profit : null } : {})
    },
    sections: {
      sellers: { show_profit: showSaleProfit, rows: finish(sellers, showSaleProfit) },
      products: { show_profit: showItemProfit, rows: finish(products, showItemProfit) },
      days: { show_profit: showSaleProfit, rows: finish(days, showSaleProfit) }
    }
  };
}

function valueMarkup(value, formatter, esc) {
  return value == null
    ? '<strong class="ranking-value-pending">A apurar</strong>'
    : `<strong>${esc(formatter(value))}</strong>`;
}

function rowMarkup(row, { esc, money, day, showProfit, kind }) {
  const ranked = Number.isInteger(row.position) && row.position > 0;
  const position = ranked ? `${row.position}º` : '—';
  const positionClass = ranked && row.position <= 3 ? ` ranking-position-${row.position}` : '';
  const name = kind === 'days' ? day(row.name) : row.name;
  return `<li class="ranking-row${ranked ? '' : ' ranking-row-unranked'}"${ranked ? ` data-rank="${row.position}"` : ''}>`+
    `<span class="ranking-position${positionClass}" aria-label="${ranked ? `${row.position}º lugar` : 'Sem posição'}">${position}</span>`+
    `<strong class="ranking-name">${esc(name)}</strong>`+
    `<dl class="ranking-values"><div><dt>Faturamento</dt><dd>${valueMarkup(row.revenue_cents, money, esc)}</dd></div>`+
    `${showProfit ? `<div class="ranking-profit${row.profit_cents == null ? ' pending' : row.profit_cents < 0 ? ' loss' : ' profit'}"><dt>Lucro</dt><dd>${valueMarkup(row.profit_cents, money, esc)}</dd></div>` : ''}`+
    `<div><dt>Vendas</dt><dd><strong>${row.sales_count}</strong></dd></div></dl></li>`;
}

function metricValue(row, metric) {
  if (metric === 'sales') return Number.isSafeInteger(row.sales_count) ? row.sales_count : null;
  if (metric === 'profit') return cents(row.profit_cents);
  return cents(row.revenue_cents);
}

function rowsRankedBy(rows, metric) {
  const collator = new Intl.Collator('pt-BR', { sensitivity: 'base', numeric: true });
  const ordered = rows.map(row => ({ ...row, position: null })).sort((left, right) =>
    Number(!left.rankable) - Number(!right.rankable) ||
    Number(metricValue(left, metric) == null) - Number(metricValue(right, metric) == null) ||
    (metricValue(right, metric) ?? 0) - (metricValue(left, metric) ?? 0) ||
    (right.revenue_cents ?? 0) - (left.revenue_cents ?? 0) ||
    right.sales_count - left.sales_count ||
    collator.compare(left.name, right.name) ||
    String(left.key).localeCompare(String(right.key))
  );
  let ranked = 0, previous = null, previousPosition = 0;
  return ordered.map(row => {
    const value = metricValue(row, metric);
    if (!row.rankable || value == null) return row;
    ranked += 1;
    const position = previous === value ? previousPosition : ranked;
    previous = value;
    previousPosition = position;
    return { ...row, position };
  });
}

function sectionMarkup(tab, section, active, metric, dependencies) {
  const isActive = active === tab.key;
  const effectiveMetric = metric === 'profit' && !section.show_profit ? 'revenue' : metric;
  const rows = rowsRankedBy(section.rows, effectiveMetric).map(row => rowMarkup(row, { ...dependencies, showProfit: section.show_profit, kind: tab.key })).join('');
  return `<section id="ranking-panel-${tab.key}" class="ranking-panel ranking-panel-${tab.key}" role="tabpanel" aria-labelledby="ranking-tab-${tab.key}"${isActive ? '' : ' hidden'}>`+
    `<header><h2>${tab.title}</h2><span class="ranking-count">${section.rows.length}</span></header>`+
    `${rows ? `<ol class="ranking-list">${rows}</ol>` : '<p class="ranking-empty" role="status">Nenhuma venda confirmada neste filtro.</p>'}</section>`;
}

export function rankingView(sales, {
  active = 'sellers', metric = 'revenue', canViewProfit = false,
  esc = escapeRankingText, money = formatRankingMoney, day = formatRankingDay, filtersMarkup = ''
} = {}) {
  const selected = TABS.some(tab => tab.key === active) ? active : 'sellers';
  const model = buildRankings(sales, { canViewProfit });
  // Keep the available ranking choices stable for authorized users, including
  // periods with no confirmed sales. The empty summary still omits profit so
  // it never invents a financial value merely to render this control.
  const showProfitMetric = canViewProfit === true;
  const selectedMetric = ['revenue', 'sales', ...(showProfitMetric ? ['profit'] : [])].includes(metric) ? metric : 'revenue';
  const summaryProfit = own(model.summary, 'profit_cents')
    ? `<div class="ranking-summary-profit"><span>Lucro</span>${valueMarkup(model.summary.profit_cents, money, esc)}</div>` : '';
  const tabs = TABS.map(tab => `<button id="ranking-tab-${tab.key}" type="button" role="tab" aria-controls="ranking-panel-${tab.key}" aria-selected="${selected === tab.key}" tabindex="${selected === tab.key ? '0' : '-1'}" data-ranking-tab="${tab.key}">${tab.label}</button>`).join('');
  const metrics = [{ key: 'revenue', label: 'Faturamento' }, ...(showProfitMetric ? [{ key: 'profit', label: 'Lucro' }] : []), { key: 'sales', label: 'Nº de vendas' }]
    .map(item => `<button type="button" class="${selectedMetric === item.key ? 'active' : ''}" aria-pressed="${selectedMetric === item.key}" data-ranking-metric="${item.key}">${item.label}</button>`).join('');
  const panels = TABS.map(tab => sectionMarkup(tab, model.sections[tab.key], selected, selectedMetric, { esc, money, day })).join('');
  return `<div class="ranking-page ranking-gold"><header class="ranking-heading"><div><span class="ranking-kicker">Desempenho</span><h1>Ranking da loja</h1><p>Comparação das vendas confirmadas nos filtros atuais.</p></div></header>`+
    `${filtersMarkup}`+
    `<section class="ranking-summary" aria-label="Resumo do ranking"><div><span>Faturamento</span>${valueMarkup(model.summary.revenue_cents, money, esc)}</div>${summaryProfit}<div><span>Vendas</span><strong>${model.summary.sales_count}</strong></div></section>`+
    `<div class="ranking-controls"><div class="ranking-tabs" role="tablist" aria-label="Tipo de ranking">${tabs}</div><div class="ranking-metrics" aria-label="Ordenar ranking por"><span>Ordenar por</span>${metrics}</div></div>${panels}</div>`;
}
