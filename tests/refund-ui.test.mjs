import test from 'node:test';
import assert from 'node:assert/strict';
import {refundManagement,refundMethodOptions} from '../public/refund-ui.mjs';

const esc=value=>String(value??'').replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;');
const helpers={esc,money:value=>`R$ ${value}`,date:value=>String(value??'').slice(0,10),can:permission=>['sales.refund','sales.refund_correct'].includes(permission)};

test('devolução UI: pedido cancelado mostra saldo claro e ação somente para quem pode registrar',()=>{
 const sale={id:'sale-1',status:'cancelled',cancellation:{refund_original_cents:1000,refund_completed_cents:250,refund_pending_cents:750,refund_state:'partial',refunds:[]}};
 const html=refundManagement(sale,helpers);
 assert.match(html,/Devolução ao cliente/);assert.match(html,/Recebido/);assert.match(html,/Já devolvido/);assert.match(html,/Falta devolver/);
 assert.match(html,/R\$ 1000/);assert.match(html,/R\$ 250/);assert.match(html,/R\$ 750/);assert.match(html,/Parcial/);
 assert.match(html,/data-action="record-refund"/);assert.match(html,/não faz Pix nem estorno automaticamente/);
 assert.doesNotMatch(refundManagement(sale,{...helpers,can:()=>false}),/data-action="record-refund"/);
 assert.equal(refundManagement({...sale,status:'confirmed'},helpers),'');
});

test('devolução UI: conclusão conserva histórico auditável e escapa textos',()=>{
 const sale={id:'sale-1',status:'cancelled',cancellation:{refund_original_cents:1000,refund_completed_cents:1000,refund_pending_cents:0,refund_state:'completed',refunds:[{id:'refund-1',method:'pix',refunded_date:'2026-09-13',created_at:'2026-09-13T15:00:00Z',amount_cents:1000,notes:'<Conta>',author:'<Pessoa>',effective:true,reversed:false}]}};
 const html=refundManagement(sale,helpers);
 assert.match(html,/Concluída/);assert.match(html,/Todo o valor recebido/);assert.match(html,/Ver histórico · 1/);
 assert.doesNotMatch(html,/record-refund|<Conta>|<Pessoa>/);assert.match(html,/&lt;Conta&gt;|&lt;Pessoa&gt;/);
 assert.match(html,/data-action="reverse-refund"/);assert.match(html,/data-refund-id="refund-1"/);assert.match(html,/Registrado em 2026-09-13/);
});

test('devolução UI: baixa corrigida permanece visível sem permitir nova correção',()=>{
 const sale={id:'sale-1',status:'cancelled',cancellation:{refund_original_cents:1000,refund_completed_cents:0,refund_pending_cents:1000,refund_state:'pending',refunds:[{id:'refund-1',method:'cash',refunded_date:'2026-09-12',created_at:'2026-09-12T15:00:00Z',amount_cents:1000,author:'Pessoa',reversed:true,effective:false,reversal:{reversed_date:'2026-09-13',reason:'<Pedido errado>',author:'<Gestor>'}}]}};
 const html=refundManagement(sale,helpers);
 assert.match(html,/Baixa corrigida/);assert.match(html,/&lt;Pedido errado&gt;/);assert.match(html,/&lt;Gestor&gt;/);assert.match(html,/text-decoration|refund-history-reversed/);
 assert.doesNotMatch(html,/data-action="reverse-refund"/);
});

test('devolução UI: meios permitidos aparecem no formulário',()=>{
 const html=refundMethodOptions('card',esc);
 for(const label of ['Pix','Dinheiro','Cartão','Outro meio'])assert.match(html,new RegExp(label));
 assert.match(html,/value="card" selected/);
});
