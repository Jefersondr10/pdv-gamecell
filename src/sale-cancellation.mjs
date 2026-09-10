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

export function cancelledSale(row,record) {
 check(record,'Histórico de cancelamento não encontrado.',409);
 const before=JSON.parse(record.snapshot_json);
 return {...before,...row,is_wholesale:!!row.is_wholesale,
  items:before.items.map(item=>({...item,pending_cents:0,profit_cents:null,provisional_profit_cents:null})),
  reconciliation:{...before.reconciliation,state:'cancelled',pending_cents:0,excess_cents:0,difference_cents:0},
  profit_cents:null,provisional_profit_cents:null,profit_state:'cancelled',
  cancellation:{created_at:record.created_at,reason:record.reason,author:record.author,
   refund_pending_cents:before.reconciliation.gross_cents,
   refund_state:before.reconciliation.gross_cents>0?'pending':'not_required'},
 };
}

export function pendingRefunds(store,actor,{shopWide=false}={}) {
 if(shopWide)check(allowed(actor,'finance.view'),'Acesso não permitido.',403);
 // The cancellation snapshot is immutable through the API. A pending refund never means money was returned.
 const scope=shopWide||allowed(actor,'sales.view_all')?'':' AND (s.seller_id=? OR s.created_by=?)';
 const params=scope?[actor.tenant_id,actor.id,actor.id]:[actor.tenant_id];
 const items=store.all(`SELECT s.id,s.number,c.created_at,
  json_extract(c.snapshot_json,'$.customer_name') AS customer_name,
  json_extract(c.snapshot_json,'$.reconciliation.gross_cents') AS pending_cents
  FROM sale_cancellations c JOIN sales s ON s.tenant_id=c.tenant_id AND s.id=c.sale_id
  WHERE c.tenant_id=? AND s.status='cancelled'${scope}
  AND json_extract(c.snapshot_json,'$.reconciliation.gross_cents')>0
  ORDER BY c.created_at,s.number`,...params);
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
