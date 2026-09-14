import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID, createHash } from 'node:crypto';
import { Store } from '../src/store.mjs';
import { application } from '../src/server.mjs';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, dirname } from 'node:path';

function setup(t){const db=new Store();t.after(()=>db.close());const session=db.register({name:'A',store_name:'Categorias teste',email:'categories@example.test',password:'senha-ficticia-de-teste'});return {db,f:db.finance,actor:db.actor(session.token)};}
const expense=(extra={})=>({description:'Conta teste',kind:'fixed',amount_cents:1500,reference_month:'2026-08',due_date:'2026-08-25',reminder_days:3,...extra});
const create=(x,extra={})=>x.f.saveExpense(x.actor,{...expense(extra),request_id:randomUUID()}).expenses[0];

test('categorias: cadastro, normalização, cor, duplicidade, versão e inativação',t=>{
 const x=setup(t);let c=x.f.saveCategory(x.actor,{name:'  Água   e Energia ',color:'#12abef'});
 assert.equal(c.name,'Água e Energia');assert.equal(c.color,'#12ABEF');assert.equal(c.active,true);
 assert.throws(()=>x.f.saveCategory(x.actor,{name:'ÁGUA E ENERGIA'}),/Já existe/);
 assert.throws(()=>x.f.saveCategory(x.actor,{name:'',color:'#000000'}),/Nome/);
 assert.throws(()=>x.f.saveCategory(x.actor,{name:'Outro',color:'red'}),/Cor/);
 assert.throws(()=>x.f.saveCategory(x.actor,{name:'Outro',active:'false'}),/Situação/);
 c=x.f.saveCategory(x.actor,{name:'Estrutura',color:c.color,active:false,version:c.version},c.id);
 assert.equal(c.version,2);assert.equal(c.active,false);
 assert.throws(()=>x.f.saveCategory(x.actor,{name:'Antigo',version:1},c.id),/outra tela/);
 assert.throws(()=>x.f.saveCategory(x.actor,{name:'estrutura'}),/Já existe/);
 assert.equal(x.f.saveCategory(x.actor,{name:c.name,version:2,active:true},c.id).active,true);
 assert.equal(x.db.get("SELECT COUNT(*) n FROM audit WHERE entity='expense_category'").n,3);
});

test('categorias: isolamento e permissões se aplicam a cadastro, consulta e vínculo',t=>{
 const x=setup(t),c=x.f.saveCategory(x.actor,{name:'Serviços'}),other=x.db.actor(x.db.register({name:'B',store_name:'B',email:'other@example.test',password:'senha-ficticia-de-teste'}).token);
 assert.deepEqual(x.f.categories(other),[]);assert.throws(()=>x.f.saveCategory(other,{name:'Inválida',version:1},c.id),/não encontrada/);
 assert.throws(()=>x.f.saveExpense(other,{...expense({category_id:c.id}),request_id:randomUUID()}),/Categoria não encontrada/);
 for(const permissions of [[],['expenses.view'],['expenses.manage']])assert.throws(()=>x.f.saveCategory({...x.actor,is_owner:false,permissions},{name:'Restrita'}),/Acesso/);
 assert.throws(()=>x.f.categories({...x.actor,is_owner:false,permissions:[]}),/Acesso/);
 assert.equal(x.f.categories({...x.actor,is_owner:false,permissions:['expenses.view']}).length,1);
 const otherExpense=x.f.saveExpense(other,{...expense(),request_id:randomUUID()}).expenses[0];
 assert.throws(()=>x.db.run('INSERT INTO expense_category_links VALUES(?,?,?)',other.tenant_id,otherExpense.id,c.id),/FOREIGN KEY/);
});

test('categorias: snapshot preservado após renomear/inativar; edição mantém categoria antiga',t=>{
 const x=setup(t),c=x.f.saveCategory(x.actor,{name:'Estrutura'}),e=create(x,{category_id:c.id,category:'Texto não confiável'});
 assert.equal(e.category,'Estrutura');assert.equal(e.category_id,c.id);
 x.f.saveCategory(x.actor,{name:'Estrutura nova',active:false,version:1},c.id);
 assert.equal(x.f.expense(x.actor,e.id).category,'Estrutura');
 assert.throws(()=>create(x,{category_id:c.id}),/inativa/);
 const changed=x.f.saveExpense(x.actor,{...expense({description:'Outro nome',category_id:c.id}),version:e.version},e.id).expenses[0];
 assert.equal(changed.category,'Estrutura');assert.equal(changed.category_id,c.id);
 const cleared=x.f.saveExpense(x.actor,{...expense(),category_id:null,version:changed.version},e.id).expenses[0];
 assert.equal(cleared.category_id,null);assert.equal(cleared.category,'');assert.equal(x.f.categories(x.actor)[0].expense_count,0);
});

test('categorias: lote e recorrência mantêm vínculo e reenvio após edição do catálogo não duplica',t=>{
 const x=setup(t),c=x.f.saveCategory(x.actor,{name:'Insumos'}),s=x.f.saveSubcategory(x.actor,{category_id:c.id,name:'Materiais'}),variable=extra=>expense({kind:'variable',category_id:c.id,subcategory_id:s.id,...extra}),data={request_id:randomUUID(),expenses:[variable({}),variable({description:'Segunda'})]};
 const first=x.f.saveVariableBatch(x.actor,data);assert.ok(first.expenses.every(e=>e.category==='Insumos'&&e.category_id===c.id));
 const repeat={...expense({kind:'fixed',category_id:c.id}),repeat_count:3,request_id:randomUUID()};const recurring=x.f.saveExpense(x.actor,repeat);assert.equal(recurring.expenses.length,3);
 x.f.saveCategory(x.actor,{name:'Materiais',version:1,active:false},c.id);
 assert.deepEqual(x.f.saveVariableBatch(x.actor,data).expenses.map(e=>e.id),first.expenses.map(e=>e.id));
 assert.deepEqual(x.f.saveExpense(x.actor,repeat).expenses.map(e=>e.id),recurring.expenses.map(e=>e.id));
 assert.equal(x.f.categories(x.actor)[0].expense_count,5);
 assert.throws(()=>x.f.saveVariableBatch(x.actor,{...data,expenses:[variable({amount_cents:999})]}),/outros valores/);
});

test('categorias: categoria inválida em qualquer linha reverte o lote todo',t=>{
 const x=setup(t),c=x.f.saveCategory(x.actor,{name:'Válida'}),s=x.f.saveSubcategory(x.actor,{category_id:c.id,name:'Detalhe'}),before=['operating_expenses','expense_batches','expense_category_links','audit'].map(table=>x.db.get(`SELECT COUNT(*) n FROM ${table}`).n);
 assert.throws(()=>x.f.saveVariableBatch(x.actor,{request_id:randomUUID(),expenses:[expense({kind:'variable',category_id:c.id,subcategory_id:s.id}),expense({kind:'variable',category_id:randomUUID(),subcategory_id:s.id})]}),/Linha 2: Categoria não encontrada/);
 assert.deepEqual(['operating_expenses','expense_batches','expense_category_links','audit'].map(table=>x.db.get(`SELECT COUNT(*) n FROM ${table}`).n),before);
});

test('categorias: edição antiga preserva vínculo omitido; valores falsy inválidos são rejeitados',t=>{
 const x=setup(t),c=x.f.saveCategory(x.actor,{name:'Estrutura'}),e=create(x,{category_id:c.id});
 x.f.saveCategory(x.actor,{name:'Novo nome',active:false,version:1},c.id);
 const saved=x.f.saveExpense(x.actor,{...expense({description:'Editar sem campo novo'}),version:e.version},e.id).expenses[0];
 assert.equal(saved.category_id,c.id);assert.equal(saved.category,'Estrutura');
 for(const category_id of [false,0,[],{},1])assert.throws(()=>create(x,{category_id}),/Categoria inválida/);
 const cleared=x.f.saveExpense(x.actor,{...expense(),category_id:'',version:saved.version},e.id).expenses[0];assert.equal(cleared.category_id,null);
});

test('categorias: hash legado continua idêntico e classificação não altera fechamento',t=>{
 const x=setup(t),data={...expense({category:'Legada'}),request_id:randomUUID()};
 const clean={description:'Conta teste',kind:'fixed',amount_cents:1500,reference_month:'2026-08',due_date:'2026-08-25',category:'Legada',payee:'',notes:'',reminder_days:3};
 const oldHash=createHash('sha256').update(JSON.stringify({clean,count:1})).digest('hex');
 const e=x.f.saveExpense(x.actor,data).expenses[0];assert.equal(x.db.get('SELECT payload_hash FROM expense_batches WHERE id=?',data.request_id).payload_hash,oldHash);
 const c=x.f.saveCategory(x.actor,{name:'Categoria nova'});create(x,{category_id:c.id});
 const r=x.f.report(x.actor,'2026-08');x.f.closeMonth(x.actor,{month:'2026-08',source_hash:r.result.source_hash,settings_version:r.result.settings_version});
 x.f.saveCategory(x.actor,{name:'Renomeada',active:false,version:1},c.id);
 assert.equal(x.f.report(x.actor,'2026-08').source_changed,false);assert.equal(x.f.saveExpense(x.actor,data).expenses[0].id,e.id);
 const variableCategory=x.f.saveCategory(x.actor,{name:'Variável'}),sub=x.f.saveSubcategory(x.actor,{category_id:variableCategory.id,name:'Detalhe'});
 const oldBulk={request_id:randomUUID(),expenses:[expense({kind:'variable',due_date:'2026-09-10',reference_month:'2026-09',category_id:variableCategory.id,subcategory_id:sub.id})]};
 const bulkClean={description:'Conta teste',kind:'variable',amount_cents:1500,reference_month:'2026-09',due_date:'2026-09-10',paid_date:'2026-09-10',category:'',payee:'',notes:'',reminder_days:0,category_id:variableCategory.id,subcategory_id:sub.id};x.f.saveVariableBatch(x.actor,oldBulk);
 assert.equal(x.db.get('SELECT payload_hash FROM expense_batches WHERE id=?',oldBulk.request_id).payload_hash,createHash('sha256').update(JSON.stringify({operation:'variable_batch',rows:[bulkClean]})).digest('hex'));
});

test('HTTP: categorias gravam pelo contrato autenticado e preservam ativos públicos seguros',async t=>{
 const store=new Store(),origin='http://127.0.0.1:3999',{server}=application({store,origin});await new Promise(r=>server.listen(0,'127.0.0.1',r));t.after(async()=>{await new Promise(r=>server.close(r));store.close();});
 const base=`http://127.0.0.1:${server.address().port}`;
 assert.equal((await fetch(base+'/api/expense-categories')).status,401);
 const reg=await fetch(base+'/api/register',{method:'POST',headers:{Origin:origin,'Content-Type':'application/json'},body:JSON.stringify({name:'A',store_name:'HTTP cats',email:'http-cat@example.test',password:'senha-ficticia-de-teste'})});
 const headers={Origin:origin,'Content-Type':'application/json',Cookie:reg.headers.get('set-cookie').split(';')[0]};
 const send=(path,data,method='POST',extra={})=>fetch(base+path,{method,headers:{...headers,...extra},body:JSON.stringify(data)});
 assert.equal((await send('/api/expense-categories',{name:'Inválida'},'POST',{Origin:'https://invalid.example'})).status,403);
 let response=await send('/api/expense-categories',{name:'HTTP categoria',color:'#22D5E8'});assert.equal(response.status,201);const c=await response.json();
 response=await send(`/api/expense-categories/${c.id}`,{name:'HTTP renomeada',version:c.version,active:false},'PUT');assert.equal(response.status,200);
 const list=await(await fetch(base+'/api/expenses?month=all',{headers})).json();assert.equal(list.categories[0].name,'HTTP renomeada');assert.equal(list.categories[0].active,false);
 for(const [path,mime] of [['/brand.css','text/css'],['/receipt-view.mjs','text/javascript'],['/gamecell-logo.png','image/png']]){const r=await fetch(base+path);assert.equal(r.status,200);assert.ok(r.headers.get('content-type').startsWith(mime));assert.equal(r.headers.get('cache-control'),'no-store');if(mime==='image/png')assert.deepEqual([...new Uint8Array(await r.arrayBuffer()).slice(0,8)],[137,80,78,71,13,10,26,10]);}
 assert.equal((await fetch(base+'/finance-schema.sql')).status,404);
});

test('categorias: migração aditiva preserva registros antigos e novos vínculos persistem',()=>{
 const directory=mkdtempSync(join(tmpdir(),'pdv-category-test-')),path=join(directory,'test.sqlite');let db;
 try {
  db=new Store(path);const session=db.register({name:'A',store_name:'Migração',email:'persist@example.test',password:'senha-ficticia-de-teste'}),actor=db.actor(session.token);
  const e=db.finance.saveExpense(actor,{...expense({category:'Texto anterior'}),request_id:randomUUID()}).expenses[0];
  const before=JSON.stringify(db.all('SELECT * FROM operating_expenses'));
  db.db.exec('DROP TABLE expense_category_links; DROP TABLE expense_categories;');db.close();db=new Store(path);
  assert.equal(JSON.stringify(db.all('SELECT * FROM operating_expenses')),before);assert.deepEqual(db.finance.categories(actor),[]);assert.equal(db.finance.expense(actor,e.id).category,'Texto anterior');
  const c=db.finance.saveCategory(actor,{name:'Persistente'}),newExpense=db.finance.saveExpense(actor,{...expense({category_id:c.id}),request_id:randomUUID()}).expenses[0];db.close();db=new Store(path);
  assert.equal(db.finance.categories(actor)[0].name,'Persistente');assert.equal(db.finance.expense(actor,newExpense.id).category_id,c.id);assert.equal(db.finance.categories(actor)[0].expense_count,1);assert.equal(db.get('PRAGMA integrity_check').integrity_check,'ok');assert.deepEqual(db.all('PRAGMA foreign_key_check'),[]);
 } finally {db?.close();assert.equal(dirname(resolve(directory)),resolve(tmpdir()));assert.ok(directory.startsWith(join(tmpdir(),'pdv-category-test-')));rmSync(directory,{recursive:true,force:true});}
});
