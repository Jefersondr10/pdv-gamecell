import test from 'node:test';
import assert from 'node:assert/strict';
import { buildRankings, escapeRankingText, formatRankingDay, rankingView } from '../public/ranking-ui.mjs';

const money = value => `R$ ${(value / 100).toFixed(2)}`;
const base = [
  {
    id: 's1', status: 'confirmed', seller_id: 'ana', seller_name: 'Ana', business_date: '2026-09-12',
    total_cents: 30000, profit_cents: 9000,
    items: [
      { product_id: 'p1', description: 'Console', quantity: 1, unit_price_cents: 20000, total_cents: 20000, profit_cents: 6000 },
      { product_id: 'p2', description: 'Controle', quantity: 1, unit_price_cents: 10000, profit_cents: 3000 }
    ]
  },
  {
    id: 's2', status: 'confirmed', seller_id: 'bia', seller_name: 'Bia', business_date: '2026-09-13',
    total_cents: 30000, profit_cents: 7000,
    items: [{ product_id: 'p1', description: 'Console', quantity: 1, unit_price_cents: 30000, total_cents: 30000, profit_cents: 7000 }]
  },
  {
    id: 's3', status: 'confirmed', seller_id: 'carla', seller_name: 'Carla', business_date: '2026-09-13',
    total_cents: 10000, profit_cents: -1000,
    items: [{ product_id: 'p2', description: 'Controle', quantity: 1, unit_price_cents: 10000, total_cents: 10000, profit_cents: -1000 }]
  },
  { id: 'draft', status: 'draft', seller_id: 'ana', seller_name: 'Ana', business_date: '2026-09-13', total_cents: 999999, profit_cents: 999999, items: [] },
  { id: 'cancelled', status: 'cancelled', seller_id: 'ana', seller_name: 'Ana', business_date: '2026-09-13', total_cents: 999999, profit_cents: 999999, items: [] }
];

test('modelo usa somente vendas confirmadas e cria rankings de vendedores, produtos e dias', () => {
  const model = buildRankings(base, { canViewProfit: true });
  assert.deepEqual(model.summary, { sales_count: 3, revenue_cents: 70000, profit_cents: 15000 });
  assert.deepEqual(model.sections.sellers.rows.map(row => [row.position, row.name, row.revenue_cents, row.profit_cents, row.sales_count]), [
    [1, 'Ana', 30000, 9000, 1],
    [1, 'Bia', 30000, 7000, 1],
    [3, 'Carla', 10000, -1000, 1]
  ]);
  assert.deepEqual(model.sections.products.rows.map(row => [row.position, row.name, row.revenue_cents, row.profit_cents, row.sales_count]), [
    [1, 'Console', 50000, 13000, 2],
    [2, 'Controle', 20000, 2000, 2]
  ]);
  assert.deepEqual(model.sections.days.rows.map(row => [row.position, row.name, row.revenue_cents, row.profit_cents, row.sales_count]), [
    [1, '2026-09-13', 40000, 6000, 2],
    [2, '2026-09-12', 30000, 9000, 1]
  ]);
});

test('lucro não aparece sem autorização, mesmo que exista nos objetos recebidos', () => {
  const model = buildRankings(base, { canViewProfit: false });
  assert.equal('profit_cents' in model.summary, false);
  assert.equal(model.sections.sellers.show_profit, false);
  assert.equal('profit_cents' in model.sections.products.rows[0], false);
  const html = rankingView(base, { canViewProfit: false, money });
  assert.doesNotMatch(html, /Lucro|ranking-profit|9000|7000/);
  assert.match(html, /Faturamento/);
  assert.match(html, /Vendas/);
});

test('dados financeiros ausentes ficam a apurar e não são convertidos em zero', () => {
  const sales = [
    { id: 'a', status: 'confirmed', seller_id: '1', seller_name: 'Ana', business_date: '2026-09-13', total_cents: 10000, profit_cents: 3000, items: [{ product_id: 'p', description: 'Produto', total_cents: 10000, profit_cents: 3000 }] },
    { id: 'b', status: 'confirmed', seller_id: '1', seller_name: 'Ana', business_date: '2026-09-13', total_cents: 5000, profit_cents: null, items: [{ product_id: 'p', description: 'Produto', total_cents: 5000, profit_cents: null }] }
  ];
  const model = buildRankings(sales, { canViewProfit: true });
  assert.equal(model.summary.profit_cents, null);
  assert.equal(model.sections.sellers.rows[0].profit_cents, null);
  assert.equal(model.sections.products.rows[0].profit_cents, null);
  const html = rankingView(sales, { canViewProfit: true, money });
  assert.match(html, /Lucro[\s\S]*A apurar/);
  assert.doesNotMatch(html, /Lucro[\s\S]*R\$ 0\.00/);
});

test('visual entrega três abas acessíveis, posições e métricas compactas', () => {
  const html = rankingView(base, { active: 'products', canViewProfit: true, money });
  assert.match(html, /class="ranking-page ranking-gold"/);
  assert.match(html, /role="tablist"/);
  assert.match(html, /data-ranking-tab="sellers">Vendedores/);
  assert.match(html, /data-ranking-tab="products">Produtos/);
  assert.match(html, /data-ranking-tab="days">Dias/);
  assert.match(html, /id="ranking-tab-products"[^>]*aria-selected="true"/);
  assert.doesNotMatch(html, /id="ranking-panel-products"[^>]*hidden/);
  assert.match(html, /id="ranking-panel-sellers"[^>]*hidden/);
  assert.equal((html.match(/data-rank="1"/g) ?? []).length >= 3, true);
  assert.match(html, /<dt>Faturamento<\/dt>/);
  assert.match(html, /<dt>Lucro<\/dt>/);
  assert.match(html, /<dt>Vendas<\/dt>/);
});

test('posição muda de verdade entre faturamento, lucro e número de vendas', () => {
  const sales = [
    { id: 'a1', status: 'confirmed', seller_id: 'ana', seller_name: 'Ana', business_date: '2026-09-13', total_cents: 6000, profit_cents: 500, items: [] },
    { id: 'a2', status: 'confirmed', seller_id: 'ana', seller_name: 'Ana', business_date: '2026-09-13', total_cents: 5000, profit_cents: 500, items: [] },
    { id: 'b1', status: 'confirmed', seller_id: 'bia', seller_name: 'Bia', business_date: '2026-09-13', total_cents: 10000, profit_cents: 4000, items: [] }
  ];
  const sellerPanel = html => html.slice(html.indexOf('id="ranking-panel-sellers"'), html.indexOf('id="ranking-panel-products"'));
  const revenue = sellerPanel(rankingView(sales, { metric: 'revenue', canViewProfit: true, money }));
  const profit = sellerPanel(rankingView(sales, { metric: 'profit', canViewProfit: true, money }));
  const count = sellerPanel(rankingView(sales, { metric: 'sales', canViewProfit: true, money }));
  assert.ok(revenue.indexOf('Ana') < revenue.indexOf('Bia'));
  assert.ok(profit.indexOf('Bia') < profit.indexOf('Ana'));
  assert.ok(count.indexOf('Ana') < count.indexOf('Bia'));
  assert.match(profit, /ranking-position-1[^>]*[^]*Bia/);
});

test('nomes são escapados e datas inválidas não ganham um dia inventado', () => {
  const sales = [{
    id: 'x', status: 'confirmed', seller_id: null, seller_name: '<img src=x>', business_date: 'data ruim',
    total_cents: 1000, items: [{ description: '<script>alert(1)</script>', total_cents: 1000 }]
  }];
  const html = rankingView(sales, { active: 'products', money });
  assert.match(html, /&lt;script&gt;alert\(1\)&lt;\/script&gt;/);
  assert.doesNotMatch(html, /<script>|<img/);
  assert.equal(formatRankingDay('2026-09-13'), '13/09/2026');
  assert.equal(formatRankingDay('13/09/2026'), 'Sem data');
  assert.equal(escapeRankingText(`<&>"'`), '&lt;&amp;&gt;&quot;&#39;');
  const model = buildRankings(sales);
  assert.deepEqual(model.sections.days.rows.map(row => [row.position, row.name]), [[null, 'Sem data']]);
});

test('estado vazio não cria linhas nem valores financeiros fictícios', () => {
  const model = buildRankings(undefined, { canViewProfit: true });
  assert.deepEqual(model.summary, { sales_count: 0, revenue_cents: 0 });
  assert.deepEqual(model.sections.sellers.rows, []);
  assert.deepEqual(model.sections.products.rows, []);
  assert.deepEqual(model.sections.days.rows, []);
  const html = rankingView(undefined, { canViewProfit: true, money });
  assert.equal((html.match(/Nenhuma venda confirmada neste filtro\./g) ?? []).length, 3);
  assert.doesNotMatch(html, /<li class="ranking-row/);
  assert.doesNotMatch(html, /Lucro/);
});
