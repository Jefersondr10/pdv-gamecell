import { randomUUID } from 'node:crypto';
import { check, text, integer, allowed, planFIFO, sumMoney } from './domain.mjs';

const serial = value => {
 check(typeof value === 'string', 'Informe o SN ou IMEI de cada unidade.');
 const number = text(value.normalize('NFKC'), 'SN / IMEI', 120);
 check(!/[\r\n\t\x00-\x1f\x7f]/.test(number), 'Use um único SN ou IMEI por unidade.');
 return { number, key: number.toUpperCase() };
};

// Side tables leave legacy catalog, lot quantities and historic allocations untouched.
export class SerialInventory {
 constructor(store) { this.s = store; }
 entryUnits(actor, lotId, includeInactive=false) {
  return this.s.all(`SELECT u.id,u.serial_number,EXISTS(SELECT 1 FROM sale_item_units x
   JOIN sale_items i ON i.tenant_id=x.tenant_id AND i.id=x.item_id
   JOIN sales s ON s.tenant_id=i.tenant_id AND s.id=i.sale_id
   WHERE x.tenant_id=u.tenant_id AND x.unit_id=u.id AND s.status='confirmed') AS sold
   FROM inventory_units u WHERE u.tenant_id=? AND u.lot_id=? AND (? OR u.active=1) ORDER BY u.rowid`, actor.tenant_id, lotId,Number(includeInactive));
 }
 units(actor, productId) {
  this.s.scoped('products', productId, actor);
  const rows = this.s.all(`SELECT u.id,u.serial_number,l.id AS lot_id,l.unit_cost_cents,l.received_at,
   CASE WHEN u.active=0 OR es.voided_at IS NOT NULL THEN 'removed'
    WHEN EXISTS(SELECT 1 FROM sale_item_units x JOIN sale_items i ON i.tenant_id=x.tenant_id AND i.id=x.item_id
     JOIN sales s ON s.tenant_id=i.tenant_id AND s.id=i.sale_id
     WHERE x.tenant_id=u.tenant_id AND x.unit_id=u.id AND s.status='confirmed') THEN 'sold' ELSE 'available' END AS status
   FROM inventory_units u JOIN lots l ON l.tenant_id=u.tenant_id AND l.id=u.lot_id
   LEFT JOIN stock_entry_state es ON es.tenant_id=l.tenant_id AND es.lot_id=l.id
   WHERE l.tenant_id=? AND l.product_id=? ORDER BY l.received_at DESC,u.rowid`, actor.tenant_id, productId);
  return rows.map(row => { if (!allowed(actor, 'costs.view')) delete row.unit_cost_cents; return row; });
 }
 setEntryUnits(actor, lot, values) {
  check(Array.isArray(values) && values.length <= 200, 'Informe até 200 números por entrada.');
  const old = this.entryUnits(actor, lot.id,true), seen = new Set(), keys = new Set();
  const clean = values.map(value => {
   check(value && typeof value === 'object' && !Array.isArray(value), 'Unidade inválida.');
   const normalized = serial(value.serial_number);
   const previous = value.id ? old.find(u => u.id === value.id) : old.find(u => serial(u.serial_number).key === normalized.key);
   check(!value.id || previous, 'Unidade não pertence a esta entrada.', 404);
   const id = previous?.id ?? randomUUID();
   check(!seen.has(id) && !keys.has(normalized.key), 'SN / IMEI repetido nesta entrada.');
   seen.add(id); keys.add(normalized.key);
   const duplicate = this.s.get('SELECT id FROM inventory_units WHERE tenant_id=? AND serial_key=?', actor.tenant_id, normalized.key);
   check(!duplicate || duplicate.id === id, 'Este SN / IMEI já está cadastrado nesta loja.', 409);
   check(!previous?.sold || previous.serial_number === normalized.number, 'Este aparelho já foi vendido. Corrija a seleção na venda antes de alterar seu SN / IMEI.', 409);
   return { id, serial_number: normalized.number, serial_key: normalized.key };
  });
  const removed = old.filter(u => !seen.has(u.id));
  check(!removed.some(u => u.sold), 'Não é possível remover uma unidade vendida. Edite ou cancele a venda primeiro.', 409);
  const anonymousUsed = this.s.get(`SELECT COALESCE(SUM(a.quantity),0) AS quantity FROM allocations a
   JOIN sale_items i ON i.tenant_id=a.tenant_id AND i.id=a.item_id JOIN sales s ON s.tenant_id=i.tenant_id AND s.id=i.sale_id
   WHERE a.tenant_id=? AND a.lot_id=? AND s.status='confirmed'
   AND NOT EXISTS(SELECT 1 FROM sale_item_tracking t WHERE t.tenant_id=i.tenant_id AND t.item_id=i.id)`, actor.tenant_id, lot.id).quantity;
  check(clean.length <= lot.quantity_initial - anonymousUsed, 'Identifique somente as unidades disponíveis desta entrada. As unidades já vendidas sem SN preservam o histórico.', 409);
  for (const unit of removed) this.s.run('UPDATE inventory_units SET active=0 WHERE tenant_id=? AND id=?', actor.tenant_id, unit.id);
  for (const unit of clean) this.s.run(`INSERT INTO inventory_units(id,tenant_id,lot_id,serial_number,serial_key,active) VALUES(?,?,?,?,?,1)
   ON CONFLICT(tenant_id,id) DO UPDATE SET serial_number=excluded.serial_number,serial_key=excluded.serial_key,active=1`, unit.id, actor.tenant_id, lot.id, unit.serial_number, unit.serial_key);
 }
 normalizeItem(actor, item, product, original, legacyConfirmed) {
  integer(item.quantity, 'Quantidade', 1, 1000000);
  const preserveLegacy = legacyConfirmed && original && !original.tracks_serials && original.product_id === product?.id
   && Number(item.quantity) <= original.quantity && (!item.unit_ids || item.unit_ids.length === 0);
  const tracked = !!product && (!!original?.tracks_serials || !!product.serial_tracked && !preserveLegacy);
  let ids = item.unit_ids === undefined ? (original?.product_id === product?.id ? original?.unit_ids ?? [] : []) : item.unit_ids;
  check(Array.isArray(ids) && ids.length <= 200 && ids.every(id => typeof id === 'string'), 'Seleção de SN / IMEI inválida.');
  check(new Set(ids).size === ids.length, 'Não selecione o mesmo aparelho duas vezes.');
  check(tracked || !ids.length, 'Ative o controle por SN / IMEI no cadastro deste produto.');
  check(ids.length <= Number(item.quantity), 'A quantidade não pode ser menor que os aparelhos selecionados.');
  const units = ids.map(id => {
   const unit = this.s.get(`SELECT u.*,l.product_id,es.voided_at FROM inventory_units u
    JOIN lots l ON l.tenant_id=u.tenant_id AND l.id=u.lot_id
    LEFT JOIN stock_entry_state es ON es.tenant_id=l.tenant_id AND es.lot_id=l.id WHERE u.tenant_id=? AND u.id=?`, actor.tenant_id, id);
   check(unit && unit.product_id === product?.id, 'SN / IMEI não pertence ao produto selecionado.', 404);
   check(unit.active && !unit.voided_at, 'A entrada deste aparelho foi removida. Escolha outra unidade.', 409);
   return unit;
  });
  return { tracks_serials: tracked, unit_ids: ids, ...(tracked ? { serial_number: units.map(u => u.serial_number).join('\n') } : {}) };
 }
 saveItem(actor, item) {
  if (!item.tracks_serials) return;
  this.s.run('INSERT INTO sale_item_tracking VALUES(?,?)', actor.tenant_id, item.id);
  for (const unitId of item.unit_ids) this.s.run('INSERT INTO sale_item_units VALUES(?,?,?)', actor.tenant_id, item.id, unitId);
 }
 enrichItem(actor, item) {
  const tracked = !!this.s.get('SELECT 1 FROM sale_item_tracking WHERE tenant_id=? AND item_id=?', actor.tenant_id, item.id);
  if (!tracked) return item;
  const units = this.s.all(`SELECT u.id,u.serial_number FROM sale_item_units x JOIN inventory_units u
   ON u.tenant_id=x.tenant_id AND u.id=x.unit_id WHERE x.tenant_id=? AND x.item_id=? ORDER BY x.rowid`, actor.tenant_id, item.id);
  return { ...item, tracks_serials: true, unit_ids: units.map(u => u.id), serial_number: units.map(u => u.serial_number).join('\n') };
 }
 // All active units are reserved from anonymous FIFO, including units not yet sold.
 plan(actor, item, lots, usedUnits) {
  const tracked = !!this.s.get('SELECT 1 FROM sale_item_tracking WHERE tenant_id=? AND item_id=?', actor.tenant_id, item.id);
  if (!tracked) return planFIFO(lots.map(l => ({ ...l, quantity_remaining: l.anonymous_remaining })), item.quantity).allocations;
  const units = this.s.all(`SELECT u.id,u.lot_id,u.active FROM sale_item_units x JOIN inventory_units u
   ON u.tenant_id=x.tenant_id AND u.id=x.unit_id WHERE x.tenant_id=? AND x.item_id=? ORDER BY x.rowid`, actor.tenant_id, item.id);
  check(units.length === item.quantity, 'Escolha um SN / IMEI para cada unidade vendida.', 409);
  const grouped = new Map();
  for (const unit of units) {
   const lot = lots.find(l => l.id === unit.lot_id);
   check(lot && unit.active && !usedUnits.has(unit.id), 'Um dos aparelhos selecionados não está disponível. Atualize e escolha outro SN / IMEI.', 409);
   usedUnits.add(unit.id);
   const allocation = grouped.get(lot.id) ?? { lot_id: lot.id, quantity: 0, unit_cost_cents: lot.unit_cost_cents };
   allocation.quantity++; grouped.set(lot.id, allocation);
  }
  const allocations=[...grouped.values()];
  sumMoney(allocations.map(a=>a.quantity*a.unit_cost_cents));
  return allocations;
 }
}
