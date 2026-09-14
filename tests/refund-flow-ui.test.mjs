import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const app=readFileSync(new URL('../public/app.mjs',import.meta.url),'utf8');
const source=(from,to)=>{const start=app.indexOf(from),end=app.indexOf(to,start+from.length);assert.ok(start>=0&&end>start);return app.slice(start,end);};

test('cancelamento na interface: detalhe cancelado não oferece gestão manual de devolução',()=>{
 const detail=source('function renderDetail()', 'function showCancellationRefresh()');
 assert.match(detail,/cancelledSaleDetailView\(s,\{esc,money,date,time,icon\}\)/);
 assert.doesNotMatch(detail,/refundManagement|cancellationPayments|record-refund|reverse-refund/);
 assert.doesNotMatch(app,/from ['"]\.\/refund-ui\.mjs['"]|data-action="(?:record-refund|reverse-refund)"|id=['"]refund-(?:form|reversal-form)['"]/);
});

test('cancelamento na interface: envio não informa pendência e confirma atualização dos valores',()=>{
 const submit=source('async function submitSaleCancellation(', 'async function openCancelSale(');
 assert.match(submit,/\/sales\/\$\{key\}\/cancel/);
 assert.match(submit,/acknowledge_stock_return:new FormData\(form\)\.has\('acknowledge_stock_return'\)/);
 assert.match(submit,/Venda cancelada\. Estoque e valores atualizados\./);
 assert.doesNotMatch(submit,/acknowledge_refund_pending|refund_token|refund_pending_cents/);
});
