import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { renderReceipt, renderReceiptError } from '../public/receipt-view.mjs';
const read=file=>readFileSync(new URL('../public/'+file,import.meta.url),'utf8');
const sale={number:42,store:'Loja <Teste>',date:'2026-09-07',customer:'Cliente <&>',seller:'Vendedor',status:'confirmed',items:[{description:'<Produto>',quantity:2,unit_price_cents:1000,total_cents:2000}],payments:[{method:'card',brand:'Visa <&>',installments:2,amount_cents:1000}],total_cents:2000,pending_cents:1000,notes:'<script>alert(1)</script>'};

test('pedido com marca: logo real, emissor, valores e avisos comerciais escapados',()=>{
 const html=renderReceipt(sale);
 assert.match(html,/<img src="\/gamecell-logo.png" width="640" height="640" alt="Gamecell/);assert.match(html,/Loja &lt;Teste&gt;/);assert.match(html,/#0042/);assert.match(html,/07\/09\/2026/);assert.match(html,/Cliente &lt;&amp;&gt;/);assert.match(html,/&lt;Produto&gt;/);assert.match(html,/Visa &lt;&amp;&gt; · 2x/);assert.match(html,/Saldo pendente/);assert.match(html,/Não substitui documento fiscal/);assert.match(html,/class="actions no-print"/);assert.match(html,/&lt;script&gt;/);assert.doesNotMatch(html,/<script>/);
 const draft=renderReceipt({...sale,status:'draft',date:null,payments:[],pending_cents:0,excess_cents:100});assert.match(draft,/sujeito a alterações/);assert.match(draft,/Nenhum pagamento informado/);assert.match(draft,/apresentam diferença/);
});

test('pedido com marca: renderer não expõe propriedades extras internas e erro mantém identidade',()=>{
 const html=renderReceipt({...sale,cost_cents:999,profit_cents:888,cpf:'cpf-secreto',expenses:[{description:'Despesa secreta'}],payments:[{...sale.payments[0],fee_cents:77,machine:'Máquina secreta',pix_account_name:'Conta secreta'}]});
 assert.doesNotMatch(html,/cpf-secreto|Despesa secreta|Máquina secreta|Conta secreta|cost_cents|profit_cents|fee_cents/);
 const error=renderReceiptError('<erro>');assert.match(error,/gamecell-logo.png/);assert.match(error,/&lt;erro&gt;/);assert.doesNotMatch(error,/<erro>/);
 assert.doesNotMatch(read('share.mjs'),/\/api\/state|\/api\/sales/);assert.match(read('share.mjs'),/\/api\/public\//);
});

test('identidade global: tema por último, logo válida, impressão e proteção de status',()=>{
 const css=read('brand.css'),index=read('index.html'),share=read('share.html');
 assert.ok(index.indexOf('/brand.css')>index.indexOf('/finance.css'));assert.ok(share.indexOf('/brand.css')>share.indexOf('/style.css'));
 assert.equal((read('app.mjs').match(/<img src="\/gamecell-logo.png"/g)||[]).length,3);
 const png=readFileSync(new URL('../public/gamecell-logo.png',import.meta.url));assert.deepEqual([...png.subarray(0,8)],[137,80,78,71,13,10,26,10]);assert.equal(png.readUInt32BE(16),640);assert.equal(png.readUInt32BE(20),640);
 assert.match(css,/\.topbar-inner[^}]+max-width: 1600px/);assert.match(css,/@media print/);assert.match(css,/print-color-adjust: exact/);assert.match(css,/\.select-control\.is-status \.select-trigger\[aria-expanded="true"\] \.select-chevron \{ color: currentColor; \}/);
 assert.doesNotMatch(css,/--status-(?:color|bg|text)\s*:/);assert.match(css,/\.payment-row:has\(\.card-payment-fields\)>\.delete \{ grid-column: 2/);
});

test('identidade: pares principais de texto mantêm contraste AA',()=>{
 const luminance=hex=>{const rgb=hex.match(/\w\w/g).map(v=>parseInt(v,16)/255).map(v=>v<=.04045?v/12.92:((v+.055)/1.055)**2.4);return rgb[0]*.2126+rgb[1]*.7152+rgb[2]*.0722;};
 for(const [fg,bg] of [['182238','FFFFFF'],['5D687B','FFFFFF'],['FFFFFF','086B83'],['08232E','2DD5E8'],['B9C4D8','0C101B'],['C0CCE2','292044'],['53617A','FFFFFF']]){const a=luminance(fg),b=luminance(bg);assert.ok((Math.max(a,b)+.05)/(Math.min(a,b)+.05)>=4.5,`${fg}/${bg}`);}
});
