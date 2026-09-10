import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { Store } from '../src/store.mjs';
import { application } from '../src/server.mjs';

function setup(t) {const db=new Store();t.after(()=>db.close());const session=db.register({name:'A',store_name:'Lotes teste',email:'batch@example.test',password:'senha-ficticia-de-teste'});return {db,actor:db.actor(session.token),f:db.finance};}
const row=(description='Conta',extra={})=>({description,kind:'variable',amount_cents:1500,reference_month:'2026-08',due_date:'2026-08-25',reminder_days:3,...extra});
const counts=x=>['expense_batches','operating_expenses','audit'].map(table=>x.db.get(`SELECT COUNT(*) AS n FROM ${table}`).n);
function close(x,month='2026-08') {const r=x.f.report(x.actor,month);return x.f.closeMonth(x.actor,{month,source_hash:r.result.source_hash,settings_version:r.result.settings_version});}

test('lote de variáveis: grava linhas independentes, ordem, competência e lembretes',t=>{
 const x=setup(t),data={request_id:randomUUID(),expenses:[row('Material',{amount_cents:1225}),row('Frete fornecedor',{amount_cents:2050,reference_month:'2026-09',due_date:'2026-09-15',payee:'Fornecedor A'})]};
 const saved=x.f.saveVariableBatch(x.actor,data);assert.equal(saved.expenses.length,2);assert.deepEqual(saved.expenses.map(e=>e.description),['Material','Frete fornecedor']);
 assert.deepEqual(saved.expenses.map(e=>e.kind),['variable','variable']);assert.ok(saved.expenses.every(e=>!e.paid_date));assert.deepEqual(saved.expenses.map(e=>e.ordinal),[0,1]);
 assert.equal(x.f.expenses(x.actor,'2026-08').summary.variable_cents,1225);assert.equal(x.f.expenses(x.actor,'2026-09').summary.variable_cents,2050);assert.equal(x.f.expenses(x.actor,'all').rows.length,2);
});

test('lote de variáveis: valida todas as linhas antes de gravar e informa o número do erro',t=>{
 const x=setup(t),before=counts(x);
 for(const bad of [null,[],5,row(''),row('Valor',{amount_cents:0}),row('Letras',{amount_cents:'12'}),row('Data',{due_date:'2026-02-31'}),row('Fixa',{kind:'fixed'}),row('Repetida',{repeat_count:12})]) {
  assert.throws(()=>x.f.saveVariableBatch(x.actor,{request_id:randomUUID(),expenses:[row('Válida'),bad]}),/Linha 2:/);assert.deepEqual(counts(x),before);
 }
 for(const expenses of [[],Array.from({length:51},()=>row()),{},null])assert.throws(()=>x.f.saveVariableBatch(x.actor,{request_id:randomUUID(),expenses}),/1 a 50/);
});

test('lote de variáveis: até 50 linhas, inclusive contas de mesmo conteúdo legítimas',t=>{
 const x=setup(t);const r=x.f.saveVariableBatch(x.actor,{request_id:randomUUID(),expenses:Array.from({length:50},()=>row())});
 assert.equal(r.expenses.length,50);assert.equal(new Set(r.expenses.map(e=>e.id)).size,50);assert.equal(x.f.expenses(x.actor,'all').summary.total_cents,75000);
});

test('lote de variáveis: mês fechado impede lote inteiro e replay após fechar mantém IDs',t=>{
 const x=setup(t),data={request_id:randomUUID(),expenses:[row('A'),row('B')]};const first=x.f.saveVariableBatch(x.actor,data);close(x);const before=counts(x);
 const replay=x.f.saveVariableBatch(x.actor,data);assert.equal(replay.replayed,true);assert.deepEqual(replay.expenses.map(e=>e.id),first.expenses.map(e=>e.id));assert.deepEqual(counts(x),before);
 assert.throws(()=>x.f.saveVariableBatch(x.actor,{request_id:randomUUID(),expenses:[row('Mês aberto',{reference_month:'2026-09'}),row('Fechado')]}),/Linha 2:.*fechado/);assert.deepEqual(counts(x),before);
});

test('lote de variáveis: rollback cobre falha na segunda inserção e auditoria',t=>{
 const x=setup(t),before=counts(x);x.db.db.exec("CREATE TRIGGER fail_batch_test BEFORE INSERT ON operating_expenses WHEN NEW.ordinal=1 BEGIN SELECT RAISE(ABORT,'failure on second row'); END;");
 assert.throws(()=>x.f.saveVariableBatch(x.actor,{request_id:randomUUID(),expenses:[row('Primeira'),row('Segunda')]}),/failure/);assert.deepEqual(counts(x),before);
});

test('lote de variáveis: reenvios não duplicam e UUID não admite alteração nem outro fluxo',t=>{
 const x=setup(t),data={request_id:randomUUID(),expenses:[row('A'),row('B')]};const initial=x.f.saveVariableBatch(x.actor,data);const before=counts(x);
 assert.equal(x.f.saveVariableBatch(x.actor,data).replayed,true);assert.deepEqual(counts(x),before);
 assert.throws(()=>x.f.saveVariableBatch(x.actor,{...data,expenses:[row('B'),row('A')]}),/outros valores/);
 assert.throws(()=>x.f.saveExpense(x.actor,{...row('A'),request_id:data.request_id}),/outros valores/);
 const edited={...initial.expenses[0],description:'Nome corrigido'};x.f.saveExpense(x.actor,edited,edited.id);
 assert.equal(x.f.saveVariableBatch(x.actor,data).expenses[0].description,'Nome corrigido');
 const otherKey=randomUUID();x.f.saveExpense(x.actor,{...row('Individual'),request_id:otherKey});
 assert.throws(()=>x.f.saveVariableBatch(x.actor,{request_id:otherKey,expenses:[row('Individual')]}),/outros valores/);
});

test('despesas de todos os meses: proteção é por linha, sem afetar outros meses ou tipos',t=>{
 const x=setup(t);x.f.saveExpense(x.actor,{...row('Fixa antiga',{kind:'fixed'}),request_id:randomUUID()});close(x);
 x.f.saveVariableBatch(x.actor,{request_id:randomUUID(),expenses:[row('Variável atual',{reference_month:'2026-09'})]});
 const all=x.f.expenses(x.actor,'all');assert.equal(all.rows.length,2);assert.equal(all.rows.find(e=>e.kind==='fixed').month_closed,true);assert.equal(all.rows.find(e=>e.kind==='variable').month_closed,false);
 assert.equal(x.f.expenses(x.actor,'2026-09').rows.length,1);assert.throws(()=>x.f.expenses(x.actor,'everything'),/Mês inválido/);
});

test('despesas de todos os meses: totais não herdam o limite de uma despesa individual',t=>{
 const x=setup(t);for(const m of ['2026-07','2026-08'])x.f.saveExpense(x.actor,{...row('Conta',{amount_cents:100_000_000_000,reference_month:m}),request_id:randomUUID()});
 const all=x.f.expenses(x.actor,'all');assert.equal(all.summary.total_cents,200_000_000_000);assert.equal(all.reminders.total_cents,200_000_000_000);
});

test('lote de variáveis: permissões, UUID e consultas isolados por loja',t=>{
 const x=setup(t),data={request_id:randomUUID(),expenses:[row('Uma conta')]};x.f.saveVariableBatch(x.actor,data);
 const other=x.db.actor(x.db.register({name:'B',store_name:'Outra loja',email:'batch-other@example.test',password:'senha-ficticia-de-teste'}).token);
 assert.equal(x.f.expenses(other,'all').rows.length,0);const r=x.f.saveVariableBatch(other,data);assert.equal(r.replayed,false);assert.equal(x.f.expenses(other,'all').rows.length,1);
 for(const permissions of [[],['expenses.view'],['expenses.manage']])assert.throws(()=>x.f.saveVariableBatch({...x.actor,is_owner:false,permissions},data),/Acesso/);
 assert.throws(()=>x.f.expenses({...x.actor,is_owner:false,permissions:[]},'all'),/Acesso/);
});

test('HTTP lote: gravação atômica, reenvio concorrente, lista all, CSRF e erros controlados',async t=>{
 const store=new Store(),origin='http://127.0.0.1:3999',{server}=application({store,origin});await new Promise(r=>server.listen(0,'127.0.0.1',r));t.after(async()=>{await new Promise(r=>server.close(r));store.close();});
 const base=`http://127.0.0.1:${server.address().port}`,reg=await fetch(base+'/api/register',{method:'POST',headers:{Origin:origin,'Content-Type':'application/json'},body:JSON.stringify({name:'A',store_name:'Batch HTTP',email:'batch-http@example.test',password:'senha-ficticia-de-teste'})});
 const headers={Origin:origin,'Content-Type':'application/json',Cookie:reg.headers.get('set-cookie').split(';')[0]},data={request_id:randomUUID(),expenses:[row('A'),row('B')]};
 const send=(payload,extra={})=>fetch(base+'/api/expenses/batch',{method:'POST',headers:{...headers,...extra},body:JSON.stringify(payload)});
 assert.equal((await send(data,{Origin:'https://invalid.example'})).status,403);
 let r=await send({...data,expenses:[row('A'),null]});assert.equal(r.status,400);assert.match((await r.json()).error,/Linha 2/);
 const responses=await Promise.all([send(data),send(data)]);assert.deepEqual(responses.map(r=>r.status).sort(),[200,201]);const bodies=await Promise.all(responses.map(r=>r.json()));assert.deepEqual(bodies[0].expenses.map(e=>e.id),bodies[1].expenses.map(e=>e.id));
 r=await fetch(base+'/api/expenses?month=all',{headers});assert.equal(r.status,200);const all=await r.json();assert.equal(all.rows.length,2);assert.equal(typeof all.rows[0].month_closed,'boolean');
});
