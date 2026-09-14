import test from 'node:test';
import assert from 'node:assert/strict';
import {cancelledRecord,cancelledSaleDetailView} from '../public/sales-view.mjs';

const esc=value=>String(value??'').replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;');
const helpers={esc,money:value=>`R$ ${value}`,date:value=>String(value??'').slice(0,10),time:()=> '14:30',icon:()=>'<svg></svg>',statusBadge:()=>''};
const sale={id:'sale-1',number:7,status:'cancelled',customer_name:'Cliente teste',seller_name:'Vendedor teste',total_cents:1000,created_at:'2026-09-13T17:30:00.000Z',items:[{description:'Console',quantity:1,unit_price_cents:1000,total_cents:1000}],reconciliation:{gross_cents:1000},cancellation:{created_at:'2026-09-13T18:00:00.000Z',reason:'Cliente desistiu',refund_original_cents:1000,refund_completed_cents:1000,refund_pending_cents:0,refund_state:'completed'}};

test('cancelamento UI: card inteiro abre pelo botão sobreposto e resume o estorno',()=>{
 const html=cancelledRecord(sale,helpers);
 assert.match(html,/class="sale-record-overview"><button type="button" class="sale-record-open-button" data-action="open-sale" data-id="sale-1"/);
 assert.match(html,/<small>Venda<\/small><strong>R\$ 1000<\/strong>/);
 assert.match(html,/<small>Recebido<\/small><strong>R\$ 1000<\/strong>/);
 assert.match(html,/<small>Estornado<\/small><strong>R\$ 1000<\/strong>/);
 assert.match(html,/Vendedor teste/);
 assert.doesNotMatch(html,/A devolver|Devolução pendente|record-refund|reverse-refund|estorno bancário/i);
});

test('cancelamento UI: detalhe mostra Venda, Recebido e Estornado sem nova tarefa ao usuário',()=>{
 const html=cancelledSaleDetailView(sale,helpers);
 assert.match(html,/aria-label="Resumo da venda cancelada"/);
 assert.match(html,/<span>Venda cancelada<\/span><strong>R\$ 1000<\/strong>/);
 assert.match(html,/<span>Recebido<\/span><strong>R\$ 1000<\/strong>/);
 assert.match(html,/<span>Estornado<\/span><strong>R\$ 1000<\/strong>/);
 assert.match(html,/Estoque e valores foram estornados no sistema/);
 assert.doesNotMatch(html,/A devolver|Falta devolver|Devolução ao cliente|Registrar devolução|record-refund|reverse-refund|estorno bancário/i);
});
