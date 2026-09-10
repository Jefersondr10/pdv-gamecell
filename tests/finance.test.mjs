import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { Store } from '../src/store.mjs';
import { application } from '../src/server.mjs';
import { businessDate } from '../src/domain.mjs';
import { validDate, validMonth, monthlyDue, shiftMonth, distributeProfit } from '../src/finance.mjs';

const today=businessDate(),month=shiftMonth(today.slice(0,7),-1);
function setup(t,path=':memory:') {
  const db=new Store(path);t.after(()=>db.close());
  const session=db.register({name:'Administrador',store_name:'Financeiro de teste',email:`${randomUUID()}@example.test`,password:'senha-ficticia-de-teste'}),actor=db.actor(session.token);
  return {db,actor,f:db.finance,session};
}
function expense(x,overrides={}) {
  return x.f.saveExpense(x.actor,{request_id:randomUUID(),description:'Aluguel',kind:'fixed',amount_cents:10000,reference_month:month,due_date:`${month}-05`,...overrides}).expenses[0];
}
function sale(x,overrides={}) {
  const customer=x.db.addCustomer(x.actor,{name:'Cliente fictício'});
  const id=x.db.saveDraft(x.actor,{customer_id:customer.id,seller_id:x.actor.id,items:[{description:'Produto avulso',quantity:1,unit_price_cents:100000,manual_cost_cents:40000}],freight_cents:1000,expenses:[{description:'Embalagem',amount_cents:500}],...overrides}).id;
  const rate=x.db.saveRate(x.actor,{machine:'Máquina fictícia',brand:'Visa',mode:'credit',installments:1,basis_points:400});
  x.db.addPayment(x.actor,id,{request_id:randomUUID(),method:'card',amount_cents:100000,rate_id:rate.id});
  x.db.confirm(x.actor,id,true);
  x.db.run('UPDATE sales SET business_date=? WHERE id=?',`${month}-10`,id);
  return id;
}
function partners(x) {
  return x.f.saveSettings(x.actor,{version:x.f.settings(x.actor).version,reserve_basis_points:2000,partners:[{name:'Sócio A',basis_points:6000},{name:'Sócio B',basis_points:4000}]});
}
function close(x,extra={}) {
  const r=x.f.report(x.actor,month);
  return x.f.closeMonth(x.actor,{month,source_hash:r.result.source_hash,settings_version:r.result.settings_version,...extra});
}

test('financeiro: datas reais, meses e repetição mensal preservam o dia âncora',()=>{
  assert.equal(validDate('2024-02-29'),'2024-02-29');
  for(const date of ['2025-02-29','2026-04-31','2026-2-02','2026-13-01','1999-01-01'])assert.throws(()=>validDate(date));
  assert.throws(()=>validMonth('2026-00'));assert.throws(()=>validMonth('2026-13'));
  assert.equal(monthlyDue('2024-01-31',1),'2024-02-29');
  assert.equal(monthlyDue('2025-01-31',1),'2025-02-28');
  assert.equal(monthlyDue('2025-01-31',2),'2025-03-31');
  assert.equal(shiftMonth('2025-12',1),'2026-01');
});

test('financeiro: parcelas mensais são persistentes, idempotentes e separadas da classificação',t=>{
  const x=setup(t),payload={request_id:randomUUID(),description:'Serviço',kind:'variable',amount_cents:2500,reference_month:'2024-01',due_date:'2024-01-31',repeat_count:3,reminder_days:7};
  const a=x.f.saveExpense(x.actor,payload),b=x.f.saveExpense(x.actor,payload);
  assert.equal(a.expenses.length,3);assert.equal(b.replayed,true);assert.deepEqual(a.expenses.map(e=>e.id),b.expenses.map(e=>e.id));
  assert.deepEqual(a.expenses.map(e=>e.due_date),['2024-01-31','2024-02-29','2024-03-31']);
  assert.equal(x.db.get("SELECT COUNT(*) AS n FROM audit WHERE entity='operating_expense'").n,3);
  assert.throws(()=>x.f.saveExpense(x.actor,{...payload,amount_cents:2501}),/outros valores/);
});

test('financeiro: pagamento retira lembrete sem abater despesa duas vezes; estorno auditado',t=>{
  const x=setup(t),e=expense(x);
  assert.equal(x.f.reminders(x.actor).count,1);
  const data={action:'pay',paid_date:today,version:e.version,notes:'Conta da loja'};
  const paid=x.f.updateExpenseState(x.actor,e.id,data),again=x.f.updateExpenseState(x.actor,e.id,data);
  assert.equal(paid.version,again.version);assert.equal(x.f.reminders(x.actor).count,0);
  assert.equal(x.f.expenses(x.actor,month).summary.paid_cents,10000);
  assert.equal(x.f.report(x.actor,month).result.result_cents,-10000);
  assert.throws(()=>x.f.updateExpenseState(x.actor,e.id,{...data,notes:'Outra conta'}),/outros dados/);
  const reopened=x.f.updateExpenseState(x.actor,e.id,{action:'reopen',version:paid.version,notes:'Marcação incorreta'});
  assert.equal(reopened.paid_date,null);assert.equal(x.f.reminders(x.actor).count,1);
  assert.equal(x.f.report(x.actor,month).result.result_cents,-10000);
});

test('financeiro: lembretes incluem outros meses e antecedência individual, sem pagas ou canceladas',t=>{
  const x=setup(t);
  expense(x,{reference_month:today.slice(0,7),due_date:today,description:'Hoje'});
  expense(x,{description:'Atrasada',reference_month:month,due_date:`${month}-01`});
  expense(x,{description:'Futuro',reference_month:shiftMonth(today.slice(0,7),1),due_date:`${shiftMonth(today.slice(0,7),1)}-28`,reminder_days:0});
  const r=x.f.reminders(x.actor);assert.equal(r.count,2);assert.equal(r.overdue_count,1);assert.ok(r.items.some(e=>e.state==='today'));
  const e=expense(x,{description:'Cancelar'});x.f.updateExpenseState(x.actor,e.id,{action:'cancel',version:1,notes:'Duplicada'});
  assert.equal(x.f.reminders(x.actor).count,2);
});

test('financeiro: editar protege versão, histórico pago, valores, datas e cancelamento',t=>{
  const x=setup(t),e=expense(x);
  const changed=x.f.saveExpense(x.actor,{...e,version:1,amount_cents:12000},e.id).expenses[0];assert.equal(changed.version,2);
  assert.throws(()=>x.f.saveExpense(x.actor,{...e,version:1},e.id),/outra tela/);
  assert.throws(()=>expense(x,{amount_cents:'100'}));assert.throws(()=>expense(x,{amount_cents:1.5}));assert.throws(()=>expense(x,{amount_cents:-5}));assert.throws(()=>expense(x,{due_date:'2026-02-30'}));
  assert.throws(()=>x.f.updateExpenseState(x.actor,e.id,{action:'pay',version:2,paid_date:'2199-01-01'}),/futuro/);
  x.f.updateExpenseState(x.actor,e.id,{action:'pay',version:2,paid_date:today});
  assert.throws(()=>x.f.saveExpense(x.actor,{...changed,version:3},e.id),/Estorne/);
  assert.throws(()=>x.f.updateExpenseState(x.actor,e.id,{action:'cancel',version:3,notes:'Cancelar'}),/Estorne/);
});

test('financeiro: fórmula desconta custos e despesas uma única vez e divide reserva primeiro',t=>{
  const x=setup(t);sale(x);expense(x);expense(x,{kind:'variable',description:'Energia',amount_cents:5000});partners(x);
  const r=x.f.report(x.actor,month).result;
  assert.equal(r.sales_profit_cents,54500);assert.equal(r.expenses_cents,15000);assert.equal(r.result_cents,39500);
  assert.equal(r.reserve_cents,7900);assert.equal(r.distribution_cents,31600);
  assert.deepEqual(r.partners.map(p=>p.amount_cents),[18960,12640]);
  assert.equal(r.reserve_cents+r.partners.reduce((s,p)=>s+p.amount_cents,0),r.result_cents);
});

test('financeiro: divisão conserva centavos e prejuízo não vira retirada',t=>{
  const x=setup(t);partners(x);expense(x);
  const r=x.f.report(x.actor,month).result;assert.equal(r.result_cents,-10000);assert.equal(r.distribution_cents,0);assert.equal(r.reserve_cents,0);
  const split=distributeProfit(1,0,[{id:'a',basis_points:5000},{id:'b',basis_points:5000}]);assert.deepEqual(split.partners.map(p=>p.amount_cents),[1,0]);
  for(let n=1;n<200;n++){const s=distributeProfit(n,1755,[{id:'a',basis_points:3333},{id:'b',basis_points:3333},{id:'c',basis_points:3334}]);assert.equal(s.reserve_cents+s.partners.reduce((v,p)=>v+p.amount_cents,0),n);}
});

test('financeiro: cadastro de sócios exige soma exata, versão e identidades únicas',t=>{
  const x=setup(t);assert.equal(x.f.settings(x.actor).reserve_basis_points,10000);
  assert.throws(()=>x.f.saveSettings(x.actor,{version:0,reserve_basis_points:1000,partners:[]}),/100%/);
  assert.throws(()=>x.f.saveSettings(x.actor,{version:0,reserve_basis_points:1000,partners:[{name:'A',basis_points:5000}]}),/100%/);
  assert.throws(()=>x.f.saveSettings(x.actor,{version:0,reserve_basis_points:1000,partners:[{name:'A',basis_points:5000},{name:'a',basis_points:5000}]}),/repetidos/);
  const s=partners(x);assert.throws(()=>x.f.saveSettings(x.actor,{...s,version:0}),/outra tela/);
});

test('financeiro: custo ou pagamento pendente impede fechamento; mês atual é só prévia',t=>{
  const x=setup(t);sale(x,{items:[{description:'Sem custo',quantity:1,unit_price_cents:100000,manual_cost_cents:null}]});
  assert.equal(x.f.report(x.actor,month).result.incomplete_sales.length,1);assert.throws(()=>close(x),/pendentes/);
  assert.throws(()=>x.f.closeMonth(x.actor,{month:today.slice(0,7)}),/já encerrados/);
  const y=setup(t);sale(y,{items:[{description:'Diferença',quantity:1,unit_price_cents:200000,manual_cost_cents:40000}]});assert.throws(()=>close(y),/pendentes/);
});

test('financeiro: fechamento é único, detecta concorrência e preserva fotografia e percentuais',t=>{
  const x=setup(t);sale(x);partners(x);const initial=x.f.report(x.actor,month);
  expense(x);assert.throws(()=>x.f.closeMonth(x.actor,{month,source_hash:initial.result.source_hash,settings_version:initial.result.settings_version}),/mudaram/);
  const a=close(x),b=close(x);assert.equal(a.closure_id,b.closure_id);
  const old=a.result.partners;
  const current=x.f.settings(x.actor);x.f.saveSettings(x.actor,{version:current.version,reserve_basis_points:10000,partners:[]});
  assert.deepEqual(x.f.report(x.actor,month).result.partners,old);
  assert.equal(x.db.get('SELECT COUNT(*) AS n FROM finance_closures').n,1);
  assert.throws(()=>expense(x),/já foi fechado/);
});

test('financeiro: mês fechado protege despesas, mas permite quitar sem mudar fotografia',t=>{
  const x=setup(t),e=expense(x);const c=close(x);
  assert.throws(()=>x.f.saveExpense(x.actor,{...e,amount_cents:20000},e.id),/já foi fechado/);
  assert.throws(()=>x.f.updateExpenseState(x.actor,e.id,{action:'cancel',version:1,notes:'Teste'}),/já foi fechado/);
  x.f.updateExpenseState(x.actor,e.id,{action:'pay',version:1,paid_date:today});
  const r=x.f.report(x.actor,month);assert.equal(r.source_changed,false);assert.equal(r.result.result_cents,c.result.result_cents);
});

test('financeiro: retiradas parciais, idempotência, saldo e caixa conferido',t=>{
  const x=setup(t);sale(x);expense(x,{amount_cents:15000});partners(x);
  assert.throws(()=>close(x,{cash_available_cents:1000}),/não cobre/);
  const c=close(x,{cash_available_cents:100000});assert.equal(c.cash_after_planned_cents,68400);
  const payload={request_id:randomUUID(),partner_id:c.result.partners[0].id,amount_cents:5000,paid_date:today,notes:'Retirada fictícia'};
  const a=x.f.withdraw(x.actor,c.closure_id,payload),b=x.f.withdraw(x.actor,c.closure_id,payload);assert.equal(a.id,b.id);
  const r=x.f.report(x.actor,month);assert.equal(r.withdrawn_cents,5000);assert.equal(r.remaining_withdrawals_cents,26600);assert.equal(r.cash_after_recorded_cents,95000);assert.equal(r.result.result_cents,39500);
  assert.throws(()=>x.f.withdraw(x.actor,c.closure_id,{...payload,amount_cents:5001}),/outros dados/);
  assert.throws(()=>x.f.withdraw(x.actor,c.closure_id,{...payload,request_id:randomUUID(),amount_cents:13961}),/ultrapassa/);
  assert.equal(x.db.get('SELECT COUNT(*) AS n FROM profit_withdrawals').n,1);
});

test('financeiro: alteração posterior de venda sinaliza fonte e bloqueia novas retiradas',t=>{
  const x=setup(t),saleId=sale(x);partners(x);const c=close(x);
  x.db.addPayment(x.actor,saleId,{request_id:randomUUID(),method:'cash',amount_cents:1});
  const r=x.f.report(x.actor,month);assert.equal(r.source_changed,true);assert.equal(r.result.result_cents,c.result.result_cents);
  assert.throws(()=>x.f.withdraw(x.actor,c.closure_id,{request_id:randomUUID(),partner_id:c.result.partners[0].id,amount_cents:1,paid_date:today}),/mudaram após/);
});

test('financeiro: reserva sem saldo informado não é saldo bancário',t=>{
  const x=setup(t);sale(x);const c=close(x);
  assert.equal(c.result.reserve_cents,54500);assert.equal(c.cash_after_planned_cents,null);assert.equal(c.cash_after_recorded_cents,null);assert.equal(c.result.cash_available_cents,null);
});

test('financeiro: isolamento entre lojas e permissões de leitura, escrita e agregado',t=>{
  const x=setup(t),e=expense(x);sale(x);partners(x);const c=close(x);
  const other=x.db.actor(x.db.register({name:'Outro',store_name:'Outra loja',email:'other-finance@example.test',password:'senha-ficticia-de-teste'}).token);
  assert.equal(x.f.expenses(other,month).rows.length,0);assert.equal(x.f.report(other,month).result.sales_count,0);
  assert.throws(()=>x.f.updateExpenseState(other,e.id,{action:'pay',version:1,paid_date:today}),/não encontrada/);
  assert.throws(()=>x.f.withdraw(other,c.closure_id,{request_id:randomUUID(),partner_id:c.result.partners[0].id,amount_cents:1,paid_date:today}),/não encontrado/);
  const user=x.db.addUser(x.actor,{name:'Restrito',email:'restricted-finance@example.test',password:'senha-ficticia-de-teste',permissions:[]});
  let restricted=x.db.actor(x.db.login({email:'restricted-finance@example.test',password:'senha-ficticia-de-teste'}).token);
  assert.ok(!('expense_reminders' in x.db.snapshot(restricted)));
  for(const run of [()=>x.f.expenses(restricted),()=>x.f.report(restricted),()=>x.f.saveExpense(restricted,{})])assert.throws(run,/Acesso/);
  x.db.updatePermissions(x.actor,user.id,{permissions:['expenses.view','finance.view']});restricted={...restricted,permissions:['expenses.view','finance.view']};
  assert.equal(x.f.expenses(restricted,month).rows.length,1);assert.equal(x.f.report(restricted,month).result.sales_count,1);assert.equal(x.db.listSales(restricted).length,0);
  assert.throws(()=>x.f.updateExpenseState(restricted,e.id,{action:'pay',version:1,paid_date:today}),/Acesso/);
  assert.throws(()=>x.f.saveSettings(restricted,{}),/Acesso/);
});

test('financeiro: módulo é aditivo e dados persistem após reabrir',t=>{
  const dir=mkdtempSync(join(tmpdir(),'pdv-finance-'));t.after(()=>rmSync(dir,{recursive:true,force:true}));const path=join(dir,'test.sqlite');
  let db=new Store(path);const reg=db.register({name:'A',store_name:'Persistência',email:'persistent-finance@example.test',password:'senha-ficticia-de-teste'}),actor=db.actor(reg.token);
  const customer=db.addCustomer(actor,{name:'Preservar'});db.close();
  // Simulate the previous schema with its existing store data, not the user's database.
  const legacy=new DatabaseSync(path);legacy.exec('DROP TABLE profit_withdrawals; DROP TABLE finance_closures; DROP TABLE finance_settings; DROP TABLE operating_expenses; DROP TABLE expense_batches;');legacy.close();
  db=new Store(path);const x={db,actor:db.actor(reg.token),f:db.finance};const e=expense(x);db.close();
  db=new Store(path);assert.equal(db.finance.expenses(db.actor(reg.token),month).rows[0].id,e.id);assert.equal(db.get('SELECT name FROM customers WHERE id=?',customer.id).name,'Preservar');assert.deepEqual(db.all('PRAGMA foreign_key_check'),[]);db.close();
});

test('financeiro HTTP: rotas autenticadas, CSRF, persistência, edição, fechamento e ativos',async t=>{
  const store=new Store(),origin='http://127.0.0.1:3999',{server}=application({store,origin});await new Promise(r=>server.listen(0,'127.0.0.1',r));
  t.after(async()=>{await new Promise(r=>server.close(r));store.close();});const base=`http://127.0.0.1:${server.address().port}`;
  assert.equal((await fetch(base+'/api/finance')).status,401);
  for(const path of ['/finance-ui.mjs','/finance.css'])assert.equal((await fetch(base+path)).status,200);
  const registered=await fetch(base+'/api/register',{method:'POST',headers:{Origin:origin,'Content-Type':'application/json'},body:JSON.stringify({name:'A',store_name:'Finance HTTP',email:'http-finance@example.test',password:'senha-ficticia-de-teste'})});
  const headers={Origin:origin,'Content-Type':'application/json',Cookie:registered.headers.get('set-cookie').split(';')[0]};
  const payload={request_id:randomUUID(),description:'Conta HTTP',kind:'fixed',amount_cents:2500,reference_month:month,due_date:`${month}-10`};
  assert.equal((await fetch(base+'/api/expenses',{method:'POST',headers:{...headers,Origin:'https://evil.example'},body:JSON.stringify(payload)})).status,403);
  let res=await fetch(base+'/api/expenses',{method:'POST',headers,body:JSON.stringify(payload)});assert.equal(res.status,201);const e=(await res.json()).expenses[0];
  res=await fetch(base+`/api/expenses/${e.id}`,{method:'PUT',headers,body:JSON.stringify({...payload,version:1,amount_cents:3000})});assert.equal(res.status,200);
  res=await fetch(base+`/api/expenses/${e.id}/state`,{method:'POST',headers,body:JSON.stringify({action:'pay',version:2,paid_date:today})});assert.equal(res.status,200);
  const report=await (await fetch(base+`/api/finance?month=${month}`,{headers})).json();assert.equal(report.result.result_cents,-3000);
  res=await fetch(base+'/api/finance/close',{method:'POST',headers,body:JSON.stringify({month,source_hash:report.result.source_hash,settings_version:0})});assert.equal(res.status,201);
  assert.equal((await res.json()).closed,true);
  assert.equal((await fetch(base+'/api/expenses?month=invalid',{headers})).status,400);
});
