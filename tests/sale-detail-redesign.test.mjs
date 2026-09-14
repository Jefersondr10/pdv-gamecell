import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { cancelledSaleDetailView, saleDetailView } from '../public/sales-view.mjs';

const css=readFileSync(new URL('../public/brand.css',import.meta.url),'utf8');
const esc=value=>String(value??'').replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;');
const money=value=>`R$ ${(Number(value??0)/100).toFixed(2).replace('.',',')}`;
const baseSale=()=>({
 id:'sale-1',number:4,status:'confirmed',customer_name:'<Cliente>',seller_name:'<Vendedor>',business_date:'2026-09-13',registered_at:'2026-09-13T17:35:00.000Z',is_wholesale:true,edit_token:'token',
 total_cents:200000,freight_cents:1000,profit_cents:null,provisional_profit_cents:49999,profit_state:'pending_cost',pending_cost_quantity:1,
 review:{manual:false,automatic:true,required:true,reasons:['payment_mismatch','pending_cost','missing_pix_account']},
 reconciliation:{state:'underpaid',gross_cents:150000,pending_cents:50000,excess_cents:0,fee_cents:0},
 items:[{id:'item-1',description:'<PlayStation 4>',quantity:2,unit_price_cents:100000,total_cents:200000,cost_cents:70000,pending_cost_quantity:1,profit_cents:null,provisional_profit_cents:49999,serial_number:'SN-1\nSN-2',details:'Com controle'}],
 payments:[{id:'pay-1',method:'pix',amount_cents:150000,fee_cents:0,pix_account_name:'<Conta principal>'}],
 expenses:[{description:'<Embalagem>',amount_cents:500}],public_notes:'<Entregar hoje>',corrections:[{created_at:'2026-09-13T18:00:00Z',author:'<Admin>',reason:'<Ajuste>'}]
});
const helpers=(permission=()=>true)=>({
 esc,money,date:()=> '13/09/2026',time:()=> '14:35',can:permission,icon:name=>`<svg data-icon="${name}"></svg>`,
 statusBadge:()=>'<span class="badge good">Confirmada</span>',operationalStatusControl:()=>'<select aria-label="Status"><option>A conferir</option></select>'
});

test('detalhe da venda: cabeçalho e status são compactos e cancelamento fica por último',()=>{
 const html=saleDetailView(baseSale(),helpers());
 assert.match(html,/class="sale-detail-title-line"><h1>Venda <span>#0004<\/span><\/h1>/);
 assert.match(html,/data-action="edit-sale"[^>]*>Editar<\/button>/);
 assert.match(html,/data-action="share-sale"[^>]*aria-label="Compartilhar venda #0004"[^>]*><svg data-icon="share"><\/svg><\/button>/);
 assert.doesNotMatch(html,/>Compartilhar<\/button>|>Voltar às vendas<\/button>/);
 assert.equal((html.match(/<h2 id="sale-status-title">Status<\/h2>/g)??[]).length,1);
 assert.doesNotMatch(html,/Status operacional|Confirmada<\/span>/);
 assert.match(html,/sale-detail-flags[^>]*>[\s\S]*Atacado/);
 assert.ok(html.lastIndexOf('data-action="cancel-sale"')>html.lastIndexOf('Histórico de correções'));
 assert.match(html,/sale-detail-cancel[\s\S]*Cancelar venda/);
});

test('detalhe da venda: resumo e avisos não exibem lucro provisório',()=>{
 const html=saleDetailView(baseSale(),helpers());
 assert.match(html,/summary-4/);
 assert.match(html,/Total vendido[\s\S]*Pagamento recebido[\s\S]*Despesas[\s\S]*Pendente/);
 assert.doesNotMatch(html,/sale-detail-summary[\s\S]*?<small>/);
 assert.match(html,/Falta registrar R\$ 500,00 em pagamentos/);
 assert.match(html,/1 item está sem custo informado/);
 assert.match(html,/Há Pix sem conta identificada/);
 assert.doesNotMatch(html,/49[.,]999|Provisório/i);
});

test('detalhe da venda: produto, Pix e frete usam linhas curtas e escapam os dados',()=>{
 const html=saleDetailView(baseSale(),helpers());
 assert.match(html,/&lt;PlayStation 4&gt;/);assert.doesNotMatch(html,/<PlayStation 4>/);
 assert.match(html,/sale-detail-product-title[\s\S]*sale-detail-product-name[\s\S]*sale-detail-product-quantity">2x<\/strong>/);
 assert.match(html,/sale-detail-product-meta[\s\S]*IMEI \/ SN: SN-1/);
 assert.match(html,/values-4[\s\S]*Preço unit\.[\s\S]*Total[\s\S]*Custo[\s\S]*Lucro/);
 assert.match(html,/sale-detail-payment[\s\S]*<strong>Pix<\/strong><span>&lt;Conta principal&gt;<\/span>/);
 assert.match(html,/sale-detail-payment-values has-costs[\s\S]*Recebido[\s\S]*Taxa[\s\S]*Líquido/);
 assert.match(html,/Frete e despesas[\s\S]*Pago pela loja[\s\S]*&lt;Embalagem&gt;/);
 assert.doesNotMatch(html,/<table|<thead|<th>/);
});

test('detalhe da venda: lucro e prejuízo recebem cores sem furar permissões',()=>{
 const profitable={...baseSale(),profit_cents:30000,profit_state:'complete',pending_cost_quantity:0,review:{manual:false,automatic:false,required:false,reasons:[]},reconciliation:{state:'matched',gross_cents:200000,pending_cents:0,excess_cents:0,fee_cents:1000},items:[{...baseSale().items[0],pending_cost_quantity:0,cost_cents:169000,profit_cents:30000}]};
 let html=saleDetailView(profitable,helpers());
 assert.match(html,/sale-detail-profit profit[\s\S]*R\$ 300,00/);
 assert.match(html,/sale-detail-values values-4[\s\S]*class="profit"/);
 const loss={...profitable,profit_cents:-1500,items:[{...profitable.items[0],profit_cents:-1500}]};
 html=saleDetailView(loss,helpers());
 assert.match(html,/sale-detail-profit loss[\s\S]*Prejuízo[\s\S]*R\$ -15,00/);
 assert.match(html,/class="loss"><dt>Prejuízo/);
 const restricted=saleDetailView(baseSale(),helpers(()=>false));
 assert.match(restricted,/Há informação interna pendente/);
 assert.doesNotMatch(restricted,/Taxa<\/dt>|Líquido|Custo<\/dt>|sale-detail-profit|Frete e despesas|data-action="edit-sale"|data-action="cancel-sale"/);
 assert.doesNotMatch(restricted,/700,00|499,99|sem custo informado/i);
 const profitOnly=saleDetailView(baseSale(),helpers(permission=>permission==='profit.view'));
 assert.match(profitOnly,/informação interna pendente/);
 assert.doesNotMatch(profitOnly,/Falta informar custo|sem custo informado/i);
});

test('detalhe da venda: CSS mantém quatro totais e quatro valores do produto na mesma linha móvel',()=>{
 assert.match(css,/\.sale-detail-summary\.summary-4\s*\{[^}]*grid-template-columns:repeat\(4,minmax\(0,1fr\)\)/);
 assert.match(css,/\.sale-detail-values\.values-4\s*\{[^}]*grid-template-columns:repeat\(4,minmax\(0,1fr\)\)/);
 assert.match(css,/@media screen and \(max-width:700px\)[\s\S]*\.sale-detail-summary\.summary-3,\.sale-detail-summary\.summary-4\s*\{[^}]*grid-template-columns:repeat\(4,minmax\(0,1fr\)\)/);
 assert.match(css,/\.sale-detail-profit\.profit\s*\{[^}]*background:[^}]*#e4f6ed/);
 assert.match(css,/\.sale-detail-profit\.loss\s*\{[^}]*background:[^}]*#ffebed/);
});

test('detalhe da venda: controles móveis mantêm área de toque e texto legível',()=>{
 const detailCss=css.slice(css.indexOf('/* Venda: detalhe enxuto'));
 const mobile=detailCss.slice(detailCss.indexOf('@media screen and (max-width:700px)'));
 assert.match(mobile,/\.sale-detail-icon-button\s*\{[^}]*width:44px;[^}]*height:44px;[^}]*min-width:44px/);
 assert.match(mobile,/\.sale-detail-header-actions>\.small\s*\{[^}]*min-height:44px/);
 assert.match(mobile,/\.sale-detail-status \.status-select,\.sale-detail-status \.select-trigger\s*\{[^}]*min-height:44px/);
 assert.match(mobile,/\.sale-detail-section>\.panel-header \.small\s*\{[^}]*min-height:44px/);
 assert.match(mobile,/\.sale-detail-cancel>\.danger\s*\{[^}]*min-height:44px/);
 assert.match(mobile,/\.sale-detail-back\s*\{[^}]*display:none/);
 assert.match(mobile,/\.sale-detail-product-quantity\s*\{[^}]*min-width:30px;[^}]*min-height:24px/);
});

test('detalhe cancelado: cabeçalho, totais e produtos ficam compactos',()=>{
 const sale={
  ...baseSale(),status:'cancelled',is_wholesale:false,
  cancellation:{created_at:'2026-09-13T18:00:00.000Z',author:'<Gestor>',reason:'<Pedido cancelado>',refund_original_cents:150000,refund_completed_cents:150000,refund_pending_cents:0}
 };
 const html=cancelledSaleDetailView(sale,{...helpers(),icon:name=>`<svg data-icon="${name}"></svg>`});
 assert.match(html,/sale-cancelled-header[\s\S]*Venda <span>#0004<\/span>[\s\S]*&lt;Cliente&gt;/);
 assert.match(html,/sale-timing[\s\S]*13\/09\/2026[\s\S]*14:35/);
 assert.match(html,/badge bad">Cancelada<\/span>/);
 assert.match(html,/cancelled-detail-summary[\s\S]*Venda cancelada[\s\S]*Recebido[\s\S]*Estornado/);
 assert.doesNotMatch(html,/Falta devolver|A devolver|Devolvido/);
 assert.match(html,/sale-detail-product-title[\s\S]*&lt;PlayStation 4&gt;[\s\S]*sale-detail-product-quantity">2x<\/strong>/);
 assert.match(html,/Cancelada em 13\/09\/2026[\s\S]*&lt;Gestor&gt;[\s\S]*&lt;Pedido cancelado&gt;/);
 assert.match(html,/Venda fora dos totais\. Estoque e valores foram estornados no sistema\./);
 assert.doesNotMatch(html,/>Voltar às vendas<\/button>|<table|<thead/);
 assert.match(css,/@media screen and \(max-width:700px\)[\s\S]*\.sale-detail-back\s*\{[^}]*display:none/);
 assert.match(css,/\.sale-cancellation-note\s*\{[^}]*display:grid[^}]*padding:11px 14px/);
});

test('detalhe da venda: valores monetários não quebram em 320px',()=>{
 const narrow=css.slice(css.indexOf('@media screen and (max-width:360px)'));
 assert.match(narrow,/\.sale-detail-summary\.summary-4\s*\{[^}]*gap:3px/);
 assert.match(narrow,/\.sale-detail-metric\s*\{[^}]*padding-inline:2px/);
 assert.match(narrow,/\.sale-detail-metric>strong\s*\{[^}]*font-size:\.6875rem;[^}]*white-space:nowrap;[^}]*overflow-wrap:normal/);
 assert.match(narrow,/\.sale-detail-values\s*\{[^}]*gap:0/);
 assert.match(narrow,/\.sale-detail-values>div\s*\{[^}]*padding-left:2px/);
 assert.match(narrow,/\.sale-detail-values dd\s*\{[^}]*font-size:\.6875rem;[^}]*white-space:nowrap;[^}]*overflow-wrap:normal/);
});
