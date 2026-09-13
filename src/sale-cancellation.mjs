import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { check, allowed } from './domain.mjs';

export function migrateCancellationStatus(store) {
 const definition=store.get("SELECT sql FROM sqlite_schema WHERE type='table' AND name='sales'").sql;
 if(/'cancelled'/.test(definition))return;
 const schema=readFileSync(new URL('./schema.sql',import.meta.url),'utf8');
 const create=schema.match(/CREATE TABLE IF NOT EXISTS sales \([\s\S]*?\n\);/)[0].replace('IF NOT EXISTS sales','sales_cancellation_upgrade');
 const quote=name=>'"'+name.replaceAll('"','""')+'"';
 const columns=store.all('PRAGMA table_info(sales)').map(column=>quote(column.name)).join(',');
 const objects=store.all("SELECT sql FROM sqlite_schema WHERE tbl_name='sales' AND type IN ('index','trigger') AND sql IS NOT NULL");
 const foreignKeys=store.get('PRAGMA foreign_keys').foreign_keys;
 const legacyAlter=store.get('PRAGMA legacy_alter_table').legacy_alter_table;
 store.db.exec('PRAGMA foreign_keys=OFF; PRAGMA legacy_alter_table=ON');
 try{
  store.transaction(()=>{
   store.db.exec(create);
   store.db.exec(`INSERT INTO sales_cancellation_upgrade(rowid,${columns}) SELECT rowid,${columns} FROM sales;
    DROP TABLE sales;
    ALTER TABLE sales_cancellation_upgrade RENAME TO sales;`);
   for(const object of objects)store.db.exec(object.sql);
   check(store.all('PRAGMA foreign_key_check').length===0,'Falha de integridade na migração de cancelamentos.');
  });
 }finally{store.db.exec(`PRAGMA legacy_alter_table=${legacyAlter}; PRAGMA foreign_keys=${foreignKeys}`);}
}

const refundState=(original,refunded)=>original===0?'not_required':refunded===0?'pending':refunded===original?'completed':'partial';
const refundToken=(saleId,original,refunds,reversals)=>createHash('sha256').update(JSON.stringify({sale_id:saleId,original_cents:original,
 refunds:refunds.map(refund=>[refund.id,refund.amount_cents,refund.method,refund.refunded_date,refund.created_at]),
 reversals:reversals.map(reversal=>[reversal.id,reversal.refund_id,reversal.reversed_date,reversal.created_at])})).digest('hex');

export function cancelledSale(row,record,refundRows=[],reversalRows=[]) {
 check(record,'Histórico de cancelamento não encontrado.',409);
 const before=JSON.parse(record.snapshot_json);
 const original=before.reconciliation.gross_cents;
 const reversalsByRefund=new Map(reversalRows.map(reversal=>[reversal.refund_id,reversal]));
 const total=refundRows.filter(refund=>!reversalsByRefund.has(refund.id)).reduce((sum,refund)=>sum+BigInt(refund.amount_cents),0n);
 check(total<=BigInt(Number.MAX_SAFE_INTEGER),'O total devolvido ultrapassa o limite de representação exata.');
 const refunded=Number(total);
 check(refunded<=original,'O histórico de devoluções excede o valor recebido da venda.',409);
 const pending=original-refunded;
 const refundReversals=reversalRows.map(reversal=>({id:reversal.id,refund_id:reversal.refund_id,amount_cents:reversal.amount_cents,
  reason:reversal.reason,reversed_date:reversal.reversed_date,created_at:reversal.created_at,
  author_id:reversal.actor_id,author:reversal.author}));
 const projectedReversals=new Map(refundReversals.map(reversal=>[reversal.refund_id,reversal]));
 const refunds=refundRows.map(refund=>{
  const reversal=projectedReversals.get(refund.id)??null;
  return {id:refund.id,amount_cents:refund.amount_cents,method:refund.method,
   refunded_date:refund.refunded_date,notes:refund.notes,created_at:refund.created_at,
   author_id:refund.actor_id,author:refund.author,effective:!reversal,reversed:!!reversal,reversal};
 });
 return {...before,...row,is_wholesale:!!row.is_wholesale,
  items:before.items.map(item=>({...item,pending_cents:0,profit_cents:null,provisional_profit_cents:null})),
  reconciliation:{...before.reconciliation,state:'cancelled',pending_cents:0,excess_cents:0,difference_cents:0},
  profit_cents:null,provisional_profit_cents:null,profit_state:'cancelled',
  cancellation:{created_at:record.created_at,reason:record.reason,author:record.author,
   refund_original_cents:original,refund_completed_cents:refunded,refunded_cents:refunded,refund_pending_cents:pending,
   refund_state:refundState(original,refunded),refund_token:refundToken(row.id,original,refundRows,reversalRows),
   refunds,refund_reversals:refundReversals},
 };
}

export function pendingRefunds(store,actor,{shopWide=false}={}) {
 if(shopWide)check(allowed(actor,'finance.view'),'Acesso não permitido.',403);
 // O retrato do cancelamento permanece imutável; a pendência considera somente o saldo ainda não baixado.
 const scope=shopWide||allowed(actor,'sales.view_all')?'':' AND (s.seller_id=? OR s.created_by=?)';
 const params=scope?[actor.tenant_id,actor.id,actor.id]:[actor.tenant_id];
 const items=store.all(`SELECT * FROM (SELECT s.id,s.number,c.created_at,
  json_extract(c.snapshot_json,'$.customer_name') AS customer_name,
  json_extract(c.snapshot_json,'$.reconciliation.gross_cents') AS original_cents,
  COALESCE((SELECT SUM(r.amount_cents) FROM sale_refunds r
   WHERE r.tenant_id=c.tenant_id AND r.sale_id=c.sale_id AND NOT EXISTS (
    SELECT 1 FROM sale_refund_reversals rr WHERE rr.tenant_id=r.tenant_id AND rr.refund_id=r.id)),0) AS refunded_cents,
  json_extract(c.snapshot_json,'$.reconciliation.gross_cents')-COALESCE((SELECT SUM(r.amount_cents) FROM sale_refunds r
   WHERE r.tenant_id=c.tenant_id AND r.sale_id=c.sale_id AND NOT EXISTS (
    SELECT 1 FROM sale_refund_reversals rr WHERE rr.tenant_id=r.tenant_id AND rr.refund_id=r.id)),0) AS pending_cents
  FROM sale_cancellations c JOIN sales s ON s.tenant_id=c.tenant_id AND s.id=c.sale_id
  WHERE c.tenant_id=? AND s.status='cancelled'${scope}
  ) WHERE pending_cents>0 ORDER BY created_at,number`,...params);
 const total=items.reduce((sum,item)=>sum+BigInt(item.pending_cents),0n);
 check(total<=BigInt(Number.MAX_SAFE_INTEGER),'O total das devoluções ultrapassa o limite de representação exata.');
 return {count:items.length,total_cents:Number(total),...(shopWide?{token:createHash('sha256').update(JSON.stringify(items.map(item=>[item.id,item.pending_cents]))).digest('hex')}:{items})};
}

export function acknowledgeRefundReserve(store,actor,data) {
 const refunds=pendingRefunds(store,actor,{shopWide:true});
 if(refunds.count){
  check(data.acknowledge_refund_reserve===true,'Confirme que separou o dinheiro das devoluções pendentes antes das retiradas.');
  check(data.refunds_token===refunds.token,'As devoluções pendentes mudaram. Atualize e confira o caixa novamente.',409);
 }
 return refunds.total_cents;
}
