import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { Store } from '../src/store.mjs';
import { application } from '../src/server.mjs';
import { businessDate } from '../src/domain.mjs';
import { shiftMonth } from '../src/finance.mjs';

function setup(t) {
  const db=new Store();t.after(()=>db.close());
  const session=db.register({name:'Administrador',store_name:'Variáveis teste',email:`${randomUUID()}@example.test`,password:'senha-ficticia-de-teste'}),actor=db.actor(session.token);
  const category=db.finance.saveCategory(actor,{name:'Compras',applicability:'variable'});
  const subcategory=db.finance.saveSubcategory(actor,{category_id:category.id,name:'Mercadorias',applicability:'variable'});
  return {db,actor,f:db.finance,category,subcategory};
}
const payload=(x,extra={})=>({amount_cents:2590,category_id:x.category.id,subcategory_id:x.subcategory.id,...extra});

test('variável: uma data, tipo implícito e campos opcionais geram lançamento já pago sem lembrete',t=>{
  const x=setup(t),today=businessDate();
  const saved=x.f.saveVariableBatch(x.actor,{request_id:randomUUID(),expenses:[payload(x)]}).expenses[0];
  assert.equal(saved.kind,'variable');assert.equal(saved.description,'');assert.equal(saved.expense_date,today);
  assert.equal(saved.reference_month,today.slice(0,7));assert.equal(saved.due_date,today);assert.equal(saved.paid_date,today);assert.equal(saved.reminder_days,0);
  assert.equal(saved.category,'Compras');assert.equal(saved.subcategory,'Mercadorias');assert.equal(saved.payee,'');assert.equal(saved.notes,'');
  const month=x.f.expenses(x.actor,today.slice(0,7));assert.equal(month.summary.variable_cents,2590);assert.equal(month.summary.paid_cents,2590);assert.equal(month.summary.open_cents,0);
  assert.equal(x.f.reminders(x.actor).count,0);
});

test('variável: data informada define pagamento e competência; aliases conflitantes e futuro são recusados',t=>{
  const x=setup(t),month=shiftMonth(businessDate().slice(0,7),-1),expenseDate=`${month}-12`;
  const direct=x.f.saveExpense(x.actor,{request_id:randomUUID(),...payload(x,{date:expenseDate})}).expenses[0];
  assert.equal(direct.kind,'variable');assert.equal(direct.expense_date,expenseDate);
  const saved=x.f.saveVariableBatch(x.actor,{request_id:randomUUID(),expenses:[payload(x,{expense_date:expenseDate,description:'Compra',payee:'Fornecedor',notes:'Nota interna'})]}).expenses[0];
  assert.deepEqual([saved.expense_date,saved.due_date,saved.paid_date,saved.reference_month],[expenseDate,expenseDate,expenseDate,month]);
  assert.equal(saved.description,'Compra');assert.equal(saved.payee,'Fornecedor');assert.equal(saved.notes,'Nota interna');
  assert.throws(()=>x.f.saveVariableBatch(x.actor,{request_id:randomUUID(),expenses:[payload(x,{expense_date:expenseDate,due_date:businessDate()})]}),/somente uma data/);
  assert.throws(()=>x.f.saveVariableBatch(x.actor,{request_id:randomUUID(),expenses:[payload(x,{expense_date:'2199-01-01'})]}),/futuro/);
});

test('variável: categoria e subcategoria são obrigatórias e o lote falha inteiro na linha inválida',t=>{
  const x=setup(t),before=x.db.get('SELECT COUNT(*) AS n FROM operating_expenses').n;
  assert.throws(()=>x.f.saveExpense(x.actor,null),/Despesa inválida/);
  assert.throws(()=>x.f.saveVariableBatch(x.actor,null),/Despesa inválida/);
  for(const invalid of [{category_id:null},{subcategory_id:null},{category_id:randomUUID()},{subcategory_id:randomUUID()}]){
    assert.throws(()=>x.f.saveVariableBatch(x.actor,{request_id:randomUUID(),expenses:[payload(x),payload(x,invalid)]}),/Linha 2:/);
    assert.equal(x.db.get('SELECT COUNT(*) AS n FROM operating_expenses').n,before);
  }
  assert.throws(()=>x.f.saveVariableBatch(x.actor,{request_id:randomUUID(),expenses:[payload(x,{kind:'fixed'})]}),/somente despesas variáveis/);
});

test('variável: replay normalizado não duplica, mudança financeira conflita e replay continua apó fechamento',t=>{
  const x=setup(t),month=shiftMonth(businessDate().slice(0,7),-1),expenseDate=`${month}-10`,requestId=randomUUID();
  const data={request_id:requestId,expenses:[payload(x,{expense_date:expenseDate,description:'Peça'})]};
  const first=x.f.saveVariableBatch(x.actor,data),again=x.f.saveVariableBatch(x.actor,data);
  assert.equal(again.replayed,true);assert.equal(again.expenses[0].id,first.expenses[0].id);assert.equal(x.db.get('SELECT COUNT(*) AS n FROM operating_expenses').n,1);
  assert.throws(()=>x.f.saveVariableBatch(x.actor,{...data,expenses:[payload(x,{expense_date:expenseDate,description:'Peça',amount_cents:2591})]}),/outros valores/);
  const report=x.f.report(x.actor,month);x.f.closeMonth(x.actor,{month,source_hash:report.result.source_hash,settings_version:report.result.settings_version});
  assert.equal(x.f.saveVariableBatch(x.actor,data).expenses[0].id,first.expenses[0].id);
});

test('variável paga pode ser editada com versão, mas não muda de tipo nem atravessa mês fechado',t=>{
  const x=setup(t),firstMonth=shiftMonth(businessDate().slice(0,7),-2),secondMonth=shiftMonth(businessDate().slice(0,7),-1);
  let row=x.f.saveVariableBatch(x.actor,{request_id:randomUUID(),expenses:[payload(x,{expense_date:`${firstMonth}-08`,description:'Original'})]}).expenses[0];
  row=x.f.saveExpense(x.actor,{version:row.version,expense_date:`${secondMonth}-09`,description:'Corrigida',amount_cents:3100,category_id:x.category.id,subcategory_id:x.subcategory.id,payee:'Loja A',notes:'Conferida'},row.id).expenses[0];
  assert.equal(row.kind,'variable');assert.equal(row.state,undefined);assert.equal(row.description,'Corrigida');assert.equal(row.amount_cents,3100);assert.equal(row.paid_date,`${secondMonth}-09`);assert.equal(row.reference_month,secondMonth);assert.equal(row.reminder_days,0);
  assert.throws(()=>x.f.saveExpense(x.actor,{...row,version:1},row.id),/outra tela/);
  assert.throws(()=>x.f.saveExpense(x.actor,{...row,kind:'fixed',version:row.version},row.id),/tipo.*não pode ser alterado/i);
  const report=x.f.report(x.actor,secondMonth);x.f.closeMonth(x.actor,{month:secondMonth,source_hash:report.result.source_hash,settings_version:report.result.settings_version});
  assert.throws(()=>x.f.saveExpense(x.actor,{...row,amount_cents:3200,version:row.version},row.id),/fechado/);
});

test('variável não usa pagar ou estornar; cancelamento direto é auditado e retira do fechamento',t=>{
  const x=setup(t),month=shiftMonth(businessDate().slice(0,7),-1);
  const row=x.f.saveVariableBatch(x.actor,{request_id:randomUUID(),expenses:[payload(x,{expense_date:`${month}-11`})]}).expenses[0];
  assert.throws(()=>x.f.updateExpenseState(x.actor,row.id,{action:'pay',version:row.version,paid_date:row.paid_date}),/não usam esta ação/);
  assert.throws(()=>x.f.updateExpenseState(x.actor,row.id,{action:'reopen',version:row.version,notes:'Teste'}),/não usam esta ação/);
  const cancelled=x.f.updateExpenseState(x.actor,row.id,{action:'cancel',version:row.version,notes:'Lançamento duplicado'});
  assert.ok(cancelled.voided_at);assert.equal(cancelled.paid_date,null);assert.equal(x.f.expenses(x.actor,month).summary.variable_cents,0);
  const audit=x.db.get("SELECT data_json FROM audit WHERE entity='operating_expense' AND entity_id=? AND action='cancel'",row.id);
  assert.equal(JSON.parse(audit.data_json).before.paid_date,`${month}-11`);
});

test('lembretes ignoram variável legada aberta sem alterar o registro',t=>{
  const x=setup(t),today=businessDate();
  const fixed=x.f.saveExpense(x.actor,{request_id:randomUUID(),description:'Fixa',kind:'fixed',amount_cents:1000,reference_month:today.slice(0,7),due_date:today}).expenses[0];
  x.db.run("UPDATE operating_expenses SET kind='variable' WHERE tenant_id=? AND id=?",x.actor.tenant_id,fixed.id);
  const before=x.f.expense(x.actor,fixed.id);assert.equal(before.paid_date,null);
  assert.equal(x.f.reminders(x.actor).count,0);
  const after=x.f.expense(x.actor,fixed.id);assert.equal(after.paid_date,null);assert.equal(after.due_date,today);
});

test('variável: permissões, loja e HTTP preservam isolamento e o contrato simplificado',async t=>{
  const store=new Store(),origin='http://127.0.0.1:3999',{server}=application({store,origin});await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  t.after(async()=>{await new Promise(resolve=>server.close(resolve));store.close();});
  const base=`http://127.0.0.1:${server.address().port}`;
  const register=async(name,email)=>{const response=await fetch(base+'/api/register',{method:'POST',headers:{Origin:origin,'Content-Type':'application/json'},body:JSON.stringify({name,store_name:`Loja ${name}`,email,password:'senha-ficticia-de-teste'})});return {headers:{Origin:origin,'Content-Type':'application/json',Cookie:response.headers.get('set-cookie').split(';')[0]}};};
  const first=await register('A',`${randomUUID()}@example.test`),second=await register('B',`${randomUUID()}@example.test`);
  const send=(session,path,data,method='POST')=>fetch(base+path,{method,headers:session.headers,body:JSON.stringify(data)});
  const category=await(await send(first,'/api/expense-categories',{name:'Compras',applicability:'variable'})).json();
  const subcategory=await(await send(first,'/api/expense-subcategories',{category_id:category.id,name:'Peças',applicability:'variable'})).json();
  const response=await send(first,'/api/expenses/batch',{request_id:randomUUID(),expenses:[{amount_cents:1000,category_id:category.id,subcategory_id:subcategory.id}]});
  assert.equal(response.status,201);const saved=(await response.json()).expenses[0];assert.equal(saved.paid_date,businessDate());assert.equal(saved.expense_date,businessDate());
  assert.equal((await(await fetch(base+'/api/expenses?month=all',{headers:first.headers})).json()).rows.length,1);
  assert.equal((await(await fetch(base+'/api/expenses?month=all',{headers:second.headers})).json()).rows.length,0);
  const foreignEdit=await send(second,`/api/expenses/${saved.id}`,{version:saved.version,expense_date:businessDate(),amount_cents:1100,category_id:category.id,subcategory_id:subcategory.id},'PUT');assert.equal(foreignEdit.status,404);
  const edit=await send(first,`/api/expenses/${saved.id}`,{version:saved.version,kind:'variable',expense_date:businessDate(),description:'Corrigida',amount_cents:1100,category_id:category.id,subcategory_id:subcategory.id},'PUT');assert.equal(edit.status,200);const edited=(await edit.json()).expenses[0];assert.equal(edited.amount_cents,1100);assert.equal(edited.paid_date,businessDate());
  const reopen=await send(first,`/api/expenses/${saved.id}/state`,{action:'reopen',version:edited.version,notes:'Não permitido'});assert.equal(reopen.status,409);
  const cancel=await send(first,`/api/expenses/${saved.id}/state`,{action:'cancel',version:edited.version,notes:'Duplicada'});assert.equal(cancel.status,200);assert.ok((await cancel.json()).voided_at);
  const forbidden=await send(second,'/api/expenses/batch',{request_id:randomUUID(),expenses:[{amount_cents:1000,category_id:category.id,subcategory_id:subcategory.id}]});assert.equal(forbidden.status,404);
  const csrf=await fetch(base+'/api/expenses/batch',{method:'POST',headers:{...first.headers,Origin:'https://invalid.example'},body:JSON.stringify({request_id:randomUUID(),expenses:[]})});assert.equal(csrf.status,403);
});
