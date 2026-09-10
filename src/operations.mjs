import { randomUUID,randomBytes,createHash,createHmac } from 'node:crypto';
import { check,integer,text,allowed,requirePermission,planFIFO,businessDate } from './domain.mjs';
import { validDate } from './finance.mjs';
import { correctPayments,editedTimestamp } from './payment-corrections.mjs';
const now=()=>new Date().toISOString();
const digest=value=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
const aggregate=values=>{const total=values.reduce((sum,value)=>sum+BigInt(value),0n);check(total<=BigInt(Number.MAX_SAFE_INTEGER),'O total do relatório excede a capacidade de representação exata. Consulte um conjunto menor de dados.');return Number(total);};
const requestId=value=>{check(typeof value==='string'&&/^[a-f0-9]{8}-[a-f0-9]{4}-[1-5][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i.test(value),'Identificador da operação inválido.');return value.toLowerCase();};
export class Operations {
 constructor(store){
  this.s=store;this.editSecret=randomBytes(32);
  // Legacy confirmations retain timestamp order; allocation insertion order disambiguates stock sales.
  this.s.transaction(()=>{
   for(const sale of this.s.all(`SELECT s.id,s.tenant_id FROM sales s WHERE s.status='confirmed'
    AND NOT EXISTS(SELECT 1 FROM sale_fifo_order o WHERE o.tenant_id=s.tenant_id AND o.sale_id=s.id)
    ORDER BY s.confirmed_at,COALESCE((SELECT MIN(a.rowid) FROM allocations a JOIN sale_items i ON i.tenant_id=a.tenant_id AND i.id=a.item_id WHERE i.tenant_id=s.tenant_id AND i.sale_id=s.id),s.rowid),s.rowid`))this.recordOrder(sale,sale.id);
  });
 }
 recordOrder(actor,key){this.s.run('INSERT OR IGNORE INTO sale_fifo_order VALUES(?,?,(SELECT COALESCE(MAX(sequence),0)+1 FROM sale_fifo_order WHERE tenant_id=?))',actor.tenant_id,key,actor.tenant_id);}
 request(actor,operation,key,data,perform){
  const id=requestId(data.request_id),hash=digest({operation,key,data});
  return this.s.transaction(()=>{
   const old=this.s.get('SELECT * FROM operation_requests WHERE tenant_id=? AND request_id=?',actor.tenant_id,id);
   if(old){check(old.payload_hash===hash,'Solicitação já utilizada com outros dados.',409);return {...JSON.parse(old.result_json),replayed:true};}
   const result=perform();
   this.s.run('INSERT INTO operation_requests VALUES(?,?,?,?,?)',actor.tenant_id,id,hash,JSON.stringify(result),now());
   return {...result,replayed:false};
  });
 }
 guardClosures(actor,perform){
  const internal={...actor,is_owner:true};
  const closed=this.s.all('SELECT reference_month FROM finance_closures WHERE tenant_id=?',actor.tenant_id)
   .map(c=>({month:c.reference_month,hash:this.s.finance.calculate(internal,c.reference_month).source_hash}));
  const result=perform();
  check(closed.every(c=>this.s.finance.calculate(internal,c.month).source_hash===c.hash),
   'Esta alteração mudaria o resultado de um mês já fechado. Nenhuma alteração foi salva.',409);
  return result;
 }
 entries(actor,includeCosts=allowed(actor,'costs.view')){
  return this.s.all(`SELECT l.*,p.name AS product_name,p.sku,COALESCE(es.version,1) AS version,es.voided_at,es.reason
   FROM lots l JOIN products p ON p.tenant_id=l.tenant_id AND p.id=l.product_id
   LEFT JOIN stock_entry_state es ON es.tenant_id=l.tenant_id AND es.lot_id=l.id
   WHERE l.tenant_id=? ORDER BY l.received_at DESC,l.rowid DESC`,actor.tenant_id).map(e=>{e.received_date=businessDate(new Date(e.received_at));if(!includeCosts)delete e.unit_cost_cents;return e;});
 }
 receive(actor,data){
  requirePermission(actor,'stock.receive');requirePermission(actor,'costs.enter');
  if(data.new_product)requirePermission(actor,'products.manage');
  return this.request(actor,'receive','',data,()=>this.guardClosures(actor,()=>{
   check(!(data.product_id&&data.new_product),'Escolha produto existente ou novo produto.');
   let productId=data.product_id;
   if(data.new_product){check(typeof data.new_product==='object'&&!Array.isArray(data.new_product),'Novo produto inválido.');productId=this.s.addProduct(actor,data.new_product).id;}
   const received=this.s.receive(actor,{...data,product_id:productId});
   if(data.received_date!==undefined){
    const lot=this.s.get('SELECT received_at FROM lots WHERE tenant_id=? AND id=?',actor.tenant_id,received.id);
    this.s.run('UPDATE lots SET received_at=? WHERE tenant_id=? AND id=?',editedTimestamp(data.received_date,lot.received_at),actor.tenant_id,received.id);
    this.rebuildProduct(actor,productId);
   }
   const final=this.s.get('SELECT quantity_initial,quantity_remaining FROM lots WHERE tenant_id=? AND id=?',actor.tenant_id,received.id);
   return {...received,quantity_remaining:final.quantity_remaining,consumed_quantity:final.quantity_initial-final.quantity_remaining,product_id:productId};
  }));
 }
 updateEntry(actor,key,data,remove=false){
  requirePermission(actor,'stock.receive');requirePermission(actor,'costs.enter');requirePermission(actor,'stock.correct');
  return this.request(actor,remove?'entry_void':'entry_edit',key,data,()=>this.guardClosures(actor,()=>{
   const old=this.entries(actor,true).find(e=>e.id===key);check(old,'Entrada não encontrada.',404);check(!old.voided_at,'Esta entrada já foi excluída.',409);
   check(data.version===old.version,'Entrada alterada em outra tela. Atualize antes de salvar.',409);
   const reason=text(data.reason,'Motivo da alteração',500);
   const quantity=remove?old.quantity_initial:integer(data.quantity,'Quantidade',1,1000000),cost=remove||data.unit_cost_cents===undefined?old.unit_cost_cents:integer(data.unit_cost_cents,'Custo');
   check(!(data.product_id&&data.new_product),'Escolha um produto existente ou novo.');
   let productId=old.product_id;
   if(!remove){
    if(data.new_product){requirePermission(actor,'products.manage');productId=this.s.addProduct(actor,data.new_product).id;}
    else if(data.product_id!==undefined){check(typeof data.product_id==='string','Produto inválido.');productId=this.s.scoped('products',data.product_id,actor).id;}
   }
   const receivedAt=remove?old.received_at:editedTimestamp(data.received_date,old.received_at);
   let supplierId=old.supplier_id,supplierName=old.supplier_name;
   if(!remove&&data.supplier_id!==undefined){
    check(data.supplier_id===null||data.supplier_id===''||typeof data.supplier_id==='string','Fornecedor inválido.');
    supplierId=data.supplier_id||null; supplierName=supplierId===old.supplier_id?old.supplier_name:supplierId?this.s.scoped('suppliers',supplierId,actor).name:null;
   }
   const affected=[...new Set([old.product_id,productId])],before=affected.flatMap(p=>this.productCosts(actor,p)),at=now();
   this.s.run('UPDATE lots SET product_id=?,received_at=?,quantity_initial=?,unit_cost_cents=?,supplier_id=?,supplier_name=? WHERE tenant_id=? AND id=?',productId,receivedAt,quantity,cost,supplierId,supplierName,actor.tenant_id,key);
   this.s.run(`INSERT INTO stock_entry_state VALUES(?,?,?,?,?,?) ON CONFLICT(tenant_id,lot_id) DO UPDATE SET version=excluded.version,voided_at=excluded.voided_at,reason=excluded.reason,updated_at=excluded.updated_at`,actor.tenant_id,key,old.version+1,remove?at:null,reason,at);
   for(const product of affected)this.rebuildProduct(actor,product);
   const after=this.entries(actor,true).find(e=>e.id===key),costs=affected.flatMap(p=>this.productCosts(actor,p));
   this.s.audit(actor,'lot',key,remove?'voided':'corrected',{reason,before:old,after,allocations_before:before,allocations_after:costs});
   return {id:key,version:after.version,removed:remove};
  }));
 }
 productCosts(actor,productId){
  return this.s.all(`SELECT a.item_id,a.lot_id,a.quantity,a.unit_cost_cents FROM allocations a JOIN sale_items i ON i.tenant_id=a.tenant_id AND i.id=a.item_id
   WHERE i.tenant_id=? AND i.product_id=? ORDER BY a.item_id,a.lot_id,a.quantity,a.unit_cost_cents`,actor.tenant_id,productId);
 }
 rebuildProduct(actor,productId){
  const lots=this.s.all(`SELECT l.* FROM lots l WHERE l.tenant_id=? AND l.product_id=?
   AND NOT EXISTS(SELECT 1 FROM stock_entry_state es WHERE es.tenant_id=l.tenant_id AND es.lot_id=l.id AND es.voided_at IS NOT NULL)
   ORDER BY l.received_at,l.rowid`,actor.tenant_id,productId).map(l=>({...l,quantity_remaining:l.quantity_initial}));
  const items=this.s.all(`SELECT i.* FROM sale_items i JOIN sales s ON s.tenant_id=i.tenant_id AND s.id=i.sale_id
   JOIN sale_fifo_order o ON o.tenant_id=s.tenant_id AND o.sale_id=s.id
   WHERE i.tenant_id=? AND i.product_id=? AND s.status='confirmed' ORDER BY o.sequence,i.ordinal`,actor.tenant_id,productId);
  for(const item of items){
   const plan=planFIFO(lots,item.quantity).allocations;
   const previous=this.s.all('SELECT lot_id,quantity,unit_cost_cents FROM allocations WHERE tenant_id=? AND item_id=?',actor.tenant_id,item.id);
   const normalize=rows=>rows.map(r=>JSON.stringify(r)).sort();
   if(JSON.stringify(normalize(previous))!==JSON.stringify(normalize(plan))){
    this.s.run('DELETE FROM allocations WHERE tenant_id=? AND item_id=?',actor.tenant_id,item.id);
    for(const a of plan)this.s.run('INSERT INTO allocations VALUES(?,?,?,?,?,?)',randomUUID(),actor.tenant_id,item.id,a.lot_id,a.quantity,a.unit_cost_cents);
   }
   for(const a of plan)if(a.lot_id)lots.find(l=>l.id===a.lot_id).quantity_remaining-=a.quantity;
  }
  this.s.run('UPDATE lots SET quantity_remaining=0 WHERE tenant_id=? AND product_id=?',actor.tenant_id,productId);
  for(const lot of lots)this.s.run('UPDATE lots SET quantity_remaining=? WHERE tenant_id=? AND id=?',lot.quantity_remaining,actor.tenant_id,lot.id);
 }
 editToken(sale){
  const {share_hash,share_expires,store_name,customer_name,seller_name,...data}=sale;
  return createHmac('sha256',this.editSecret).update(JSON.stringify(data)).digest('hex');
 }
 setWholesale(actor,key,data){
  const sale=this.s.saleAccess(actor,key);
  requirePermission(actor,(sale.status==='confirmed'||(sale.status==='cancelled'&&sale.confirmed_at))?'sales.edit_confirmed':'sales.edit_draft');
  check(typeof data.is_wholesale==='boolean','Marcação de venda de atacado inválida.');
  return this.request(actor,'sale_wholesale',key,data,()=>{
   const before=this.s.fullSale(actor,key);
   check(before.status!=='cancelled','Venda cancelada não pode ser editada.',409);
   check(data.edit_token===this.editToken(before),'A venda mudou. Atualize antes de alterar a marcação de atacado.',409);
   if(before.status==='confirmed')check(!this.s.get('SELECT id FROM finance_closures WHERE tenant_id=? AND reference_month=?',actor.tenant_id,before.business_date.slice(0,7)),
    'O mês desta venda já foi fechado. A edição está protegida.',409);
   if(before.is_wholesale!==data.is_wholesale){
    this.s.run('UPDATE sales SET is_wholesale=?,updated_at=? WHERE tenant_id=? AND id=?',Number(data.is_wholesale),now(),actor.tenant_id,key);
    this.s.audit(actor,'sale',key,'wholesale_changed',{before:before.is_wholesale,after:data.is_wholesale});
   }
   return {id:key,is_wholesale:data.is_wholesale};
  });
 }
 cancelSale(actor,key,data){
  requirePermission(actor,'sales.cancel');this.s.saleAccess(actor,key);
  return this.request(actor,'sale_cancel',key,data,()=>this.guardClosures(actor,()=>{
   const before=this.s.fullSale(actor,key);
   check(before.status!=='cancelled','Esta venda já está cancelada.',409);
   check(data.edit_token===this.editToken(before),'A venda mudou. Atualize antes de cancelar.',409);
   if(before.status==='confirmed')check(!this.s.get('SELECT id FROM finance_closures WHERE tenant_id=? AND reference_month=?',actor.tenant_id,before.business_date.slice(0,7)),
    'O mês desta venda já foi fechado. O cancelamento está protegido.',409);
   const reason=text(data.reason,'Motivo do cancelamento',500);
   check(data.acknowledge_stock_return===true,'Confirme a devolução dos produtos ao estoque.');
   const refund=before.reconciliation.gross_cents;
   check(refund===0||data.acknowledge_refund_pending===true,'Confirme que o valor recebido ficará como devolução pendente. Nenhum estorno bancário será realizado.');
   const at=now();
   this.s.run('INSERT INTO sale_cancellations VALUES(?,?,?,?,?,?)',actor.tenant_id,key,actor.id,reason,at,JSON.stringify(before));
   this.s.run("UPDATE sales SET status='cancelled',updated_at=?,share_hash=NULL,share_expires=NULL WHERE tenant_id=? AND id=?",at,actor.tenant_id,key);
   this.s.run('DELETE FROM allocations WHERE tenant_id=? AND item_id IN (SELECT id FROM sale_items WHERE tenant_id=? AND sale_id=?)',actor.tenant_id,actor.tenant_id,key);
   for(const productId of new Set(before.items.map(item=>item.product_id).filter(Boolean)))this.rebuildProduct(actor,productId);
   this.s.audit(actor,'sale',key,'cancelled',{reason,previous_status:before.status,refund_pending_cents:refund});
   return {id:key,cancelled:true,refund_pending_cents:refund};
  }));
 }
 editSale(actor,key,data){
  requirePermission(actor,'sales.edit_confirmed');
  this.s.saleAccess(actor,key);
  return this.request(actor,'sale_edit',key,data,()=>this.guardClosures(actor,()=>{
   const before=this.s.fullSale(actor,key);check(before.status==='confirmed','Esta venda não está confirmada.',409);
   check(data.edit_token===this.editToken(before),'A venda, os pagamentos ou os custos mudaram. Atualize antes de editar.',409);
   check(!this.s.get('SELECT id FROM finance_closures WHERE tenant_id=? AND reference_month=?',actor.tenant_id,before.business_date.slice(0,7)),
    'O mês desta venda já foi fechado. A edição está protegida.',409);
   const reason=text(data.reason,'Motivo da alteração',500);
   const saleDate=data.business_date===undefined?before.business_date:validDate(data.business_date);
   check(saleDate<=businessDate(),'A data de uma venda finalizada não pode estar no futuro.');
   check(!this.s.get('SELECT id FROM finance_closures WHERE tenant_id=? AND reference_month=?',actor.tenant_id,saleDate.slice(0,7)),
    'O mês da nova data está fechado. Escolha uma data de mês aberto.',409);
   check(data.customer_id&&data.seller_id,'Escolha cliente e vendedor.');check(Array.isArray(data.items)&&data.items.length,'A venda confirmada precisa ter pelo menos um produto.');
   check(data.items.every(i=>i&&typeof i==='object'&&!Array.isArray(i)),'Item inválido.');
   const products=new Set([...before.items,...data.items].map(i=>i.product_id).filter(Boolean));
   for(const productId of products)this.s.scoped('products',productId,actor);
   if(data.entry_costs!==undefined){
    check(Array.isArray(data.entry_costs)&&data.entry_costs.length<=100,'Custos de entrada inválidos.');const seen=new Set();
    for(const correction of data.entry_costs){
     check(correction&&typeof correction==='object'&&!seen.has(correction.id),'Entrada de custo repetida ou inválida.');seen.add(correction.id);
     const lot=this.entries(actor,true).find(e=>e.id===correction.id&&!e.voided_at);check(lot&&products.has(lot.product_id),'A entrada de custo não pertence aos produtos desta venda.',404);
     integer(correction.unit_cost_cents,'Custo');
     this.updateEntry(actor,lot.id,{quantity:lot.quantity_initial,unit_cost_cents:correction.unit_cost_cents,version:correction.version,reason,request_id:randomUUID()});
    }
   }
   this.s.run('DELETE FROM allocations WHERE tenant_id=? AND item_id IN (SELECT id FROM sale_items WHERE tenant_id=? AND sale_id=?)',actor.tenant_id,actor.tenant_id,key);
   this.s.run("UPDATE sales SET status='draft' WHERE tenant_id=? AND id=?",actor.tenant_id,key);
   this.s.saveDraft({...actor,permissions:[...actor.permissions,'sales.edit_draft']},data,key);
   this.s.run("UPDATE sales SET status='confirmed',business_date=? WHERE tenant_id=? AND id=?",saleDate,actor.tenant_id,key);
   if(data.operational_status_id!==undefined)this.s.setOperationalStatus(actor,key,{operational_status_id:data.operational_status_id});
   for(const productId of products)this.rebuildProduct(actor,productId);
   correctPayments(this.s,actor,key,data.payments,reason);
   const after=this.s.fullSale(actor,key);
   check(after.reconciliation.state==='matched'||data.acknowledge_difference===true,'Há diferença entre o novo total e os pagamentos. Confirme que deseja manter a diferença.',409);
   this.s.audit(actor,'sale',key,'confirmed_corrected',{reason,before,after});
   return {id:key,updated:true};
  }));
 }
 report(actor){
  const costs=allowed(actor,'costs.view'),entries=this.entries(actor,true).filter(e=>!e.voided_at);
  const products=this.s.products(actor).map(p=>{
   const lots=entries.filter(e=>e.product_id===p.id),received=lots.reduce((s,l)=>s+l.quantity_initial,0),available=lots.reduce((s,l)=>s+l.quantity_remaining,0),pending=available-p.stock;
   const result={id:p.id,name:p.name,sku:p.sku,received_quantity:received,sold_quantity:received-p.stock,available_quantity:available,pending_quantity:pending,stock:p.stock,price_cents:p.price_cents};
   if(costs)Object.assign(result,{fifo_cost_cents:p.fifo_cost_cents,last_cost_cents:p.last_cost_cents,inventory_cost_cents:aggregate(lots.map(l=>BigInt(l.quantity_remaining)*BigInt(l.unit_cost_cents)))});
   return result;
  });
  return {store:this.s.get('SELECT name FROM tenants WHERE id=?',actor.tenant_id).name,generated_at:now(),products,
   totals:{products:products.length,available_quantity:products.reduce((s,p)=>s+p.available_quantity,0),pending_quantity:products.reduce((s,p)=>s+p.pending_quantity,0),
    ...(costs?{inventory_cost_cents:aggregate(products.map(p=>p.inventory_cost_cents))}:{})}};
 }
 reportCsv(actor){
  const report=this.report(actor),costs=allowed(actor,'costs.view');
  const cell=value=>{let s=String(value??'');if(typeof value==='string'&&/^[\s]*[=+@-]/.test(s))s="'"+s;return '"'+s.replaceAll('"','""')+'"';};
  const decimal=cents=>{const amount=BigInt(cents);return `${amount/100n},${String(amount%100n).padStart(2,'0')}`;};
  const rows=[['Loja',report.store],['Gerado em',report.generated_at],['Posição atual; quantidade pendente não é valorizada.'],
   ['Produto','SKU','Entradas ativas','Saídas vendidas','Disponível','Custo pendente (un.)','Saldo',...(costs?['Custo do estoque disponível (R$)']:[])],
   ...report.products.map(p=>[p.name,p.sku,p.received_quantity,p.sold_quantity,p.available_quantity,p.pending_quantity,p.stock,...(costs?[decimal(p.inventory_cost_cents)]:[])])];
  return '\uFEFF'+rows.map(row=>row.map(cell).join(';')).join('\r\n');
 }
}
