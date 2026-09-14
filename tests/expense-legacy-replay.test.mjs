import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { businessDate } from '../src/domain.mjs';
import { monthlyDue, shiftMonth } from '../src/finance.mjs';
import { Store } from '../src/store.mjs';

const digest=value=>createHash('sha256').update(JSON.stringify(value)).digest('hex');

function setup(t) {
  const db=new Store();t.after(()=>db.close());
  const session=db.register({name:'Responsável',store_name:'Replay legado',email:`legacy-${randomUUID()}@example.test`,password:'senha-ficticia-de-teste'});
  const actor=db.actor(session.token),finance=db.finance;
  const category=finance.saveCategory(actor,{name:'Compras',applicability:'variable'});
  const subcategory=finance.saveSubcategory(actor,{category_id:category.id,name:'Acessórios',applicability:'variable'});
  return {db,actor,finance,category,subcategory};
}

function seedLegacyBatch(x,{requestId,payloadHash,rows}) {
  const at='2026-01-01T12:00:00.000Z',ids=[];
  x.db.transaction(()=>{
    x.db.run('INSERT INTO expense_batches VALUES(?,?,?,?)',requestId,x.actor.tenant_id,payloadHash,at);
    rows.forEach((row,ordinal)=>{
      const id=randomUUID();ids.push(id);
      x.db.run(`INSERT INTO operating_expenses(id,tenant_id,batch_id,ordinal,description,kind,amount_cents,reference_month,due_date,category,payee,notes,reminder_days,created_at,updated_at)
        VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,id,x.actor.tenant_id,requestId,ordinal,row.description,'variable',row.amount_cents,row.reference_month,row.due_date,row.stored_category??row.category,row.payee,row.notes,row.reminder_days,at,at);
      if(row.category_id)x.finance.linkExpenseCategory(x.actor,id,row.category_id,{subcategory_id:row.subcategory_id,subcategory:x.subcategory.name});
    });
  });
  return ids;
}

test('replay legado do lote reconhece exatamente o hash anterior, mesmo sem classificação e apó fechamento',t=>{
  const x=setup(t),month=shiftMonth(businessDate().slice(0,7),-1),requestId=randomUUID();
  const input={request_id:requestId,expenses:[
    {description:'  Material antigo  ',amount_cents:1225,reference_month:month,due_date:`${month}-08`,category:'  Sem cadastro  ',payee:'  Fornecedor A  ',notes:'  Compra original  ',reminder_days:7},
    {description:'Frete',kind:'variable',amount_cents:2050,reference_month:month,due_date:`${month}-09`,category_id:x.category.id.toUpperCase(),subcategory_id:x.subcategory.id.toUpperCase()}
  ]};
  const legacyRows=[
    {description:'Material antigo',kind:'variable',amount_cents:1225,reference_month:month,due_date:`${month}-08`,category:'Sem cadastro',payee:'Fornecedor A',notes:'Compra original',reminder_days:7},
    {description:'Frete',kind:'variable',amount_cents:2050,reference_month:month,due_date:`${month}-09`,category:'',payee:'',notes:'',reminder_days:3,category_id:x.category.id,subcategory_id:x.subcategory.id,stored_category:x.category.name}
  ];
  const ids=seedLegacyBatch(x,{requestId,payloadHash:digest({operation:'variable_batch',rows:legacyRows.map(({stored_category,...row})=>row)}),rows:legacyRows});
  const report=x.finance.report(x.actor,month);
  x.finance.closeMonth(x.actor,{month,source_hash:report.result.source_hash,settings_version:report.result.settings_version});
  const before={batches:x.db.get('SELECT COUNT(*) total FROM expense_batches').total,expenses:x.db.get('SELECT COUNT(*) total FROM operating_expenses').total,audit:x.db.get('SELECT COUNT(*) total FROM audit').total};

  const replay=x.finance.saveVariableBatch(x.actor,input);
  assert.equal(replay.replayed,true);
  assert.deepEqual(replay.expenses.map(row=>row.id),ids);
  assert.deepEqual({batches:x.db.get('SELECT COUNT(*) total FROM expense_batches').total,expenses:x.db.get('SELECT COUNT(*) total FROM operating_expenses').total,audit:x.db.get('SELECT COUNT(*) total FROM audit').total},before);
  assert.throws(()=>x.finance.saveVariableBatch(x.actor,{...input,expenses:[{...input.expenses[0],amount_cents:1226},input.expenses[1]]}),error=>error.status===409&&/outros valores/.test(error.message));
  assert.throws(()=>x.finance.saveVariableBatch(x.actor,{...input,request_id:randomUUID()}),/Selecione uma categoria/);
});

test('replay legado individual preserva repeat_count antigo e recusa qualquer alteração relevante',t=>{
  const x=setup(t),month=shiftMonth(businessDate().slice(0,7),-3),requestId=randomUUID(),count=3;
  const input={request_id:requestId,description:'  Despesa recorrente  ',kind:'variable',amount_cents:3190,reference_month:month,due_date:`${month}-28`,category:'  Administrativo  ',payee:'  Prestador  ',notes:'  Contrato antigo  ',reminder_days:5,repeat_count:count};
  const clean={description:'Despesa recorrente',kind:'variable',amount_cents:3190,reference_month:month,due_date:`${month}-28`,category:'Administrativo',payee:'Prestador',notes:'Contrato antigo',reminder_days:5};
  const rows=Array.from({length:count},(_,index)=>({...clean,reference_month:shiftMonth(month,index),due_date:monthlyDue(clean.due_date,index)}));
  const ids=seedLegacyBatch(x,{requestId,payloadHash:digest({clean,count}),rows});

  const replay=x.finance.saveExpense(x.actor,input);
  assert.equal(replay.replayed,true);
  assert.deepEqual(replay.expenses.map(row=>row.id),ids);
  assert.deepEqual(replay.expenses.map(row=>row.reference_month),rows.map(row=>row.reference_month));
  assert.throws(()=>x.finance.saveExpense(x.actor,{...input,notes:'Outro contrato'}),error=>error.status===409&&/outros valores/.test(error.message));
  assert.throws(()=>x.finance.saveExpense(x.actor,{...input,kind:undefined}),error=>error.status===409&&/outros valores/.test(error.message));
  assert.throws(()=>x.finance.saveExpense(x.actor,{...input,expense_date:input.due_date,category_id:x.category.id,subcategory_id:x.subcategory.id,repeat_count:1}),error=>error.status===409&&/outros valores/.test(error.message));
});

test('replay legado continua isolado por loja e não flexibiliza uma gravação nova',t=>{
  const x=setup(t),month=shiftMonth(businessDate().slice(0,7),-1),requestId=randomUUID();
  const legacyInput={request_id:requestId,expenses:[{description:'Legada',kind:'variable',amount_cents:900,reference_month:month,due_date:`${month}-11`}]};
  const legacyRow={description:'Legada',kind:'variable',amount_cents:900,reference_month:month,due_date:`${month}-11`,category:'',payee:'',notes:'',reminder_days:3};
  seedLegacyBatch(x,{requestId,payloadHash:digest({operation:'variable_batch',rows:[legacyRow]}),rows:[legacyRow]});

  const second=x.db.actor(x.db.register({name:'Outra',store_name:'Outra loja',email:`other-${randomUUID()}@example.test`,password:'senha-ficticia-de-teste'}).token);
  const category=x.finance.saveCategory(second,{name:'Compras',applicability:'variable'}),subcategory=x.finance.saveSubcategory(second,{category_id:category.id,name:'Diversos',applicability:'variable'});
  const created=x.finance.saveVariableBatch(second,{request_id:requestId,expenses:[{description:'Nova',amount_cents:900,expense_date:`${month}-11`,category_id:category.id,subcategory_id:subcategory.id}]});
  assert.equal(created.replayed,false);
  assert.equal(x.db.get('SELECT COUNT(*) total FROM expense_batches WHERE id=?',requestId).total,2);
  assert.equal(x.finance.expenses(x.actor,'all').rows.length,1);
  assert.equal(x.finance.expenses(second,'all').rows.length,1);
  assert.throws(()=>x.finance.saveVariableBatch(x.actor,{...legacyInput,request_id:randomUUID()}),/Selecione uma categoria/);
});
