import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { check, allowed } from './domain.mjs';

export const AUTOMATIC_CANCELLATION_REFUND_NOTE='Valor considerado devolvido no cancelamento; a devolução real já foi concluída.';

export function migrateCancellationStatus(store) {
 const definition=store.get("SELECT sql FROM sqlite_schema WHERE type='table' AND name='sales'").sql;
 if(!/'cancelled'/.test(definition)){
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
}

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
   refund_original_cents:original,refund_completed_cents:original,refunded_cents:original,refund_pending_cents:0,
   refund_state:original===0?'not_required':'completed',settled_automatically:true,
   refund_token:refundToken(row.id,original,refundRows,reversalRows),
   refunds,refund_reversals:refundReversals},
 };
}

export function pendingRefunds(store,actor,{shopWide=false}={}) {
 if(shopWide)check(allowed(actor,'finance.view'),'Acesso não permitido.',403);
 // O cancelamento já encerra integralmente o valor recebido. Mantemos o formato
 // vazio por compatibilidade com clientes antigos, sem criar reserva de caixa.
 return {count:0,total_cents:0,...(shopWide?{token:createHash('sha256').update('[]').digest('hex')}:{items:[]})};
}

export function acknowledgeRefundReserve(store,actor) {
 pendingRefunds(store,actor,{shopWide:true});
 return 0;
}
