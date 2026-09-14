import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdtempSync,rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Store } from '../src/store.mjs';
import { application } from '../src/server.mjs';

function setup(t,file) {const db=new Store(file);t.after(()=>{try{db.close();}catch(e){if(e.code!=='ERR_INVALID_STATE')throw e;}});const actor=db.actor(db.register({name:'Teste',store_name:'Subcategorias teste',email:'subs@example.test',password:'senha-ficticia-de-teste'}).token);return {db,f:db.finance,actor};}

test('HTTP: subcategorias, escopo, detalhes por item e datas mantêm contratos autenticados',async t=>{
 const db=new Store(),origin='http://127.0.0.1:3999',{server}=application({store:db,origin});
 await new Promise(r=>server.listen(0,'127.0.0.1',r));t.after(async()=>{await new Promise(r=>server.close(r));db.close();});
 const base=`http://127.0.0.1:${server.address().port}`;
 assert.equal((await fetch(base+'/api/expense-subcategories')).status,401);
 const reg=await fetch(base+'/api/register',{method:'POST',headers:{Origin:origin,'Content-Type':'application/json'},body:JSON.stringify({name:'Teste',store_name:'HTTP',email:'sub-http@example.test',password:'senha-ficticia-de-teste'})});
 const headers={Origin:origin,'Content-Type':'application/json',Cookie:reg.headers.get('set-cookie').split(';')[0]};
 const send=(path,data,method='POST',extra={})=>fetch(base+path,{method,headers:{...headers,...extra},body:JSON.stringify(data)});
 const c=await(await send('/api/expense-categories',{name:'Estrutura',applicability:'fixed'})).json();
 assert.equal((await send('/api/expense-subcategories',{category_id:c.id,name:'Energia'},'POST',{Origin:'https://invalid.example'})).status,403);
 let response=await send('/api/expense-subcategories',{category_id:c.id,name:'Energia',applicability:'fixed'});assert.equal(response.status,201);const sub=await response.json();
 response=await send('/api/expenses',{...expense({kind:'variable',category_id:c.id,subcategory_id:sub.id}),request_id:randomUUID()});assert.equal(response.status,400);
 response=await send('/api/expenses',{...expense({kind:'fixed',category_id:c.id,subcategory_id:sub.id}),request_id:randomUUID()});assert.equal(response.status,201);
 const list=await(await fetch(base+'/api/expenses?month=all',{headers})).json();assert.equal(list.rows[0].subcategory,'Energia');assert.equal(list.rows[0].due_date,'2026-08-15');assert.equal(list.subcategories[0].applicability,'fixed');
 response=await send(`/api/expense-subcategories/${sub.id}`,{name:'Renomeada',version:sub.version,active:false},'PUT');assert.equal(response.status,200);
 response=await send('/api/sales',{items:[{description:'Avulso',quantity:1,unit_price_cents:1000,serial_number:'000SN',details:'Azul',share_details:false}]});assert.equal(response.status,201);const sale=await response.json();
 const saved=await(await fetch(base+`/api/sales/${sale.id}`,{headers})).json();assert.equal(saved.items[0].serial_number,'000SN');assert.equal(saved.items[0].share_details,false);
 const asset=await fetch(base+'/date-control.mjs');assert.equal(asset.status,200);assert.match(asset.headers.get('content-type'),/javascript/);assert.equal(asset.headers.get('cache-control'),'no-store');
});
const expense=(extra={})=>({description:'Conta',kind:'fixed',amount_cents:1000,reference_month:'2026-08',due_date:'2026-08-15',...extra});
const create=(x,extra={})=>x.f.saveExpense(x.actor,{...expense(extra),request_id:randomUUID()}).expenses[0];
const category=(x,extra={})=>x.f.saveCategory(x.actor,{name:'Categoria',...extra});
const subcategory=(x,c,extra={})=>x.f.saveSubcategory(x.actor,{category_id:c.id,name:'Subcategoria',...extra});

test('subcategorias: CRUD, nomes por categoria, versão e escopo compatível',t=>{
 const x=setup(t),c=category(x,{applicability:'both'}),fixed=category(x,{name:'Fixas',applicability:'fixed'});
 let sub=subcategory(x,c,{name:'  Energia   elétrica ',applicability:'fixed'});
 assert.equal(sub.name,'Energia elétrica');assert.equal(sub.applicability,'fixed');
 assert.throws(()=>subcategory(x,c,{name:'ENERGIA ELÉTRICA'}),/Já existe/);
 assert.ok(subcategory(x,fixed,{name:sub.name}));assert.throws(()=>subcategory(x,fixed,{name:'Inválida',applicability:'variable'}),/respeitar/);
 assert.throws(()=>x.f.saveSubcategory(x.actor,{name:'Movida',category_id:fixed.id,version:1},sub.id),/mover/);
 sub=x.f.saveSubcategory(x.actor,{name:'Novo nome',version:1,active:false},sub.id);assert.equal(sub.version,2);assert.equal(sub.active,false);
 assert.throws(()=>x.f.saveSubcategory(x.actor,{name:'Conflito',version:1},sub.id),/outra tela/);
 assert.throws(()=>subcategory(x,c,{active:'false'}),/Situação/);
});
test('subcategorias: somente fixas, somente variáveis e ambas são validadas no servidor',t=>{
 const x=setup(t),both=category(x),cf=category(x,{name:'F',applicability:'fixed'}),cv=category(x,{name:'V',applicability:'variable'});
 const cfSub=subcategory(x,cf,{name:'Fixa'}),sf=subcategory(x,both,{name:'F',applicability:'fixed'}),sv=subcategory(x,both,{name:'V',applicability:'variable'}),sb=subcategory(x,both,{name:'B'});
 assert.throws(()=>create(x,{kind:'variable',category_id:cf.id,subcategory_id:cfSub.id}),/tipo/);assert.throws(()=>create(x,{kind:'fixed',category_id:cv.id}),/tipo/);
 assert.throws(()=>create(x,{kind:'variable',category_id:both.id,subcategory_id:sf.id}),/tipo/);assert.throws(()=>create(x,{kind:'fixed',category_id:both.id,subcategory_id:sv.id}),/tipo/);
 for(const kind of ['fixed','variable'])assert.equal(create(x,{kind,category_id:both.id,subcategory_id:sb.id}).subcategory,'B');
 assert.equal(create(x,{kind:'fixed',category_id:cf.id}).kind,'fixed');
});
test('subcategorias: categoria errada, outra loja e permissão insuficiente não são aceitas',t=>{
 const x=setup(t),c=category(x),otherCategory=category(x,{name:'Outra'}),sub=subcategory(x,c),e=create(x,{category_id:otherCategory.id});
 assert.throws(()=>create(x,{category_id:otherCategory.id,subcategory_id:sub.id}),/nesta categoria/);
 assert.throws(()=>create(x,{subcategory_id:sub.id}),/Selecione a categoria/);
 assert.throws(()=>x.db.run('INSERT INTO expense_subcategory_links VALUES(?,?,?,?,?)',x.actor.tenant_id,e.id,otherCategory.id,sub.id,'Inválido'),/FOREIGN KEY/);
 const other=x.db.actor(x.db.register({name:'Outra',store_name:'Outra loja',email:'other-subs@example.test',password:'senha-ficticia-de-teste'}).token);
 assert.deepEqual(x.f.subcategories(other),[]);assert.throws(()=>x.f.saveSubcategory(other,{name:'X',category_id:c.id}),/Categoria não encontrada/);
 for(const permissions of [[],['expenses.view'],['expenses.manage']])assert.throws(()=>x.f.saveSubcategory({...x.actor,is_owner:false,permissions},{name:'X',category_id:c.id}),/Acesso/);
});
test('subcategorias: fotografia e vínculo são preservados após renomear, inativar e restringir',t=>{
 const x=setup(t),c=category(x,{color:'#123ABC'}),s=subcategory(x,c),variable=extra=>expense({kind:'variable',...extra}),e=create(x,{kind:'variable',category_id:c.id,subcategory_id:s.id});
 x.f.saveSubcategory(x.actor,{name:'Nome atual',version:1,active:false,applicability:'fixed'},s.id);
 const edited=x.f.saveCategory(x.actor,{name:'Nova categoria',version:1,active:false,applicability:'fixed'},c.id);
 const kept=x.f.saveCategory(x.actor,{name:edited.name,version:2},c.id);assert.equal(kept.color,'#123ABC');assert.equal(kept.active,false);assert.equal(kept.applicability,'fixed');
 const saved=x.f.saveExpense(x.actor,{...variable({}),version:e.version},e.id).expenses[0];assert.equal(saved.category,'Categoria');assert.equal(saved.subcategory,'Subcategoria');assert.equal(saved.subcategory_id,s.id);
 assert.throws(()=>create(x,{category_id:c.id,subcategory_id:s.id}),/inativa/);
 assert.throws(()=>x.f.saveExpense(x.actor,{...expense({kind:'fixed'}),version:saved.version},saved.id),/tipo/);
});
test('subcategorias: limpar subcategoria mantém categoria; mudar ou limpar categoria remove dependente',t=>{
 const x=setup(t),c=category(x),c2=category(x,{name:'Outra'}),s=subcategory(x,c);
 let e=create(x,{category_id:c.id,subcategory_id:s.id});
 e=x.f.saveExpense(x.actor,{...expense(),subcategory_id:null,version:e.version},e.id).expenses[0];assert.equal(e.category_id,c.id);assert.equal(e.subcategory_id,null);
 e=x.f.saveExpense(x.actor,{...expense({category_id:c.id,subcategory_id:s.id}),version:e.version},e.id).expenses[0];
 e=x.f.saveExpense(x.actor,{...expense({category_id:c2.id}),version:e.version},e.id).expenses[0];assert.equal(e.subcategory_id,null);assert.equal(e.category_id,c2.id);
 e=x.f.saveExpense(x.actor,{...expense({category_id:null}),version:e.version},e.id).expenses[0];assert.equal(e.category_id,null);
 assert.deepEqual(x.db.all('PRAGMA foreign_key_check'),[]);
});
test('subcategorias: tipos inválidos, lote atômico e recorrência fixa idempotente',t=>{
 const x=setup(t),c=category(x),s=subcategory(x,c);
 for(const invalid of [false,0,{},[]])assert.throws(()=>create(x,{category_id:c.id,subcategory_id:invalid}),/Subcategoria inválida/);
 const before=x.db.get('SELECT COUNT(*) n FROM audit').n;
 assert.throws(()=>x.f.saveVariableBatch(x.actor,{request_id:randomUUID(),expenses:[expense({kind:'variable',category_id:c.id,subcategory_id:s.id}),expense({kind:'variable',category_id:c.id,subcategory_id:randomUUID()})]}),/Linha 2/);
 assert.equal(x.db.get('SELECT COUNT(*) n FROM operating_expenses').n,0);assert.equal(x.db.get('SELECT COUNT(*) n FROM audit').n,before);
 const data={...expense({kind:'fixed',category_id:c.id,subcategory_id:s.id}),request_id:randomUUID(),repeat_count:3};
 const result=x.f.saveExpense(x.actor,data);assert.equal(result.expenses.length,3);assert.ok(result.expenses.every(e=>e.subcategory==='Subcategoria'));
 x.f.saveSubcategory(x.actor,{name:'Alterada',version:1,active:false},s.id);
 assert.deepEqual(x.f.saveExpense(x.actor,data).expenses.map(e=>e.id),result.expenses.map(e=>e.id));assert.throws(()=>x.f.saveExpense(x.actor,{...data,subcategory_id:null}),/outros valores/);
});
test('subcategorias: mudança de catálogo não altera hash ou fotografia de fechamento',t=>{
 const x=setup(t),c=category(x),s=subcategory(x,c);create(x,{category_id:c.id,subcategory_id:s.id});
 const preview=x.f.report(x.actor,'2026-08');x.f.closeMonth(x.actor,{month:'2026-08',source_hash:preview.result.source_hash,settings_version:preview.result.settings_version});
 const before=x.db.all('SELECT * FROM finance_closures');
 x.f.saveSubcategory(x.actor,{name:'Novo',active:false,version:1},s.id);x.f.saveCategory(x.actor,{name:'Novo',applicability:'fixed',version:1},c.id);
 assert.equal(x.f.report(x.actor,'2026-08').source_changed,false);assert.deepEqual(x.db.all('SELECT * FROM finance_closures'),before);
});
test('subcategorias: restringir categoria exige compatibilidade das subcategorias ativas',t=>{
 const x=setup(t),c=category(x),s=subcategory(x,c);
 assert.throws(()=>x.f.saveCategory(x.actor,{name:c.name,version:1,applicability:'fixed'},c.id),/subcategorias ativas/);
 x.f.saveSubcategory(x.actor,{name:s.name,version:1,applicability:'fixed'},s.id);
 assert.equal(x.f.saveCategory(x.actor,{name:c.name,version:1,applicability:'fixed'},c.id).applicability,'fixed');
});
test('subcategorias: esquema aditivo preserva banco anterior e reabre com vínculos',t=>{
 const folder=mkdtempSync(join(tmpdir(),'pdv-subcategories-')),file=join(folder,'db.sqlite'),x=setup(t,file);
 const c=category(x),e=create(x,{category_id:c.id}),before=x.db.all('SELECT * FROM operating_expenses'),cats=x.db.all('SELECT * FROM expense_categories');
 x.db.db.exec('DROP TABLE expense_subcategory_links; DROP TABLE expense_subcategories; DROP TABLE expense_category_scopes');x.db.close();
 const db=new Store(file);t.after(()=>{try{db.close();}catch(e){if(e.code!=='ERR_INVALID_STATE')throw e;}});assert.deepEqual(db.all('SELECT * FROM operating_expenses'),before);assert.deepEqual(db.all('SELECT * FROM expense_categories'),cats);assert.equal(db.finance.categories(x.actor)[0].applicability,'both');
 const s=db.finance.saveSubcategory(x.actor,{category_id:c.id,name:'Persistente'});db.finance.saveExpense(x.actor,{...expense({category_id:c.id,subcategory_id:s.id}),version:e.version},e.id);db.close();
 const reopened=new Store(file);t.after(()=>{try{reopened.close();}catch(e){if(e.code!=='ERR_INVALID_STATE')throw e;}});assert.equal(reopened.finance.expense(x.actor,e.id).subcategory,'Persistente');assert.deepEqual(reopened.all('PRAGMA foreign_key_check'),[]);reopened.close();rmSync(folder,{recursive:true,force:true});
});
