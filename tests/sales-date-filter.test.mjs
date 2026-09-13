import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { salesFilterValues,normalizeDateFields } from '../public/date-control.mjs';
import { Store } from '../src/store.mjs';
const app=readFileSync(new URL('../public/app.mjs',import.meta.url),'utf8');
const storeSource=readFileSync(new URL('../src/store.mjs',import.meta.url),'utf8');

test('filtro vendas: presets preservam vendedor/status, dispensam datas antigas e não mudam entrada',()=>{
 const input={date_preset:'month',from:'antigo',to:'antigo',seller_id:'seller',status:'cancelled',operational_status_id:''},before={...input};
 assert.deepEqual(salesFilterValues(input,'2024-02-29'),{from:'2024-02-01',to:'2024-02-29',seller_id:'seller',status:'cancelled'});assert.deepEqual(input,before);
 assert.deepEqual(salesFilterValues({date_preset:'yesterday'},'2026-01-01'),{from:'2025-12-31',to:'2025-12-31'});
 assert.deepEqual(salesFilterValues({date_preset:'today'},'2026-09-08'),{from:'2026-09-08',to:'2026-09-08'});
});

test('filtro vendas: período exige duas datas brasileiras reais e ordenadas',()=>{
 const data={date_preset:'period',from:'08/09/2026',to:'10/09/2026'};
 const form={querySelectorAll:()=>['from','to'].map(name=>({name,value:data[name],dataset:{dateKind:'date'}}))};
 normalizeDateFields(form,data);assert.deepEqual(salesFilterValues(data,'2026-09-08'),{from:'2026-09-08',to:'2026-09-10'});
 for(const invalid of [{from:'',to:''},{from:'2026-09-08',to:''},{from:'2026-09-10',to:'2026-09-08'},{from:'2026-02-30',to:'2026-03-01'},{from:'08/09/2026',to:'10/09/2026'}])assert.throws(()=>salesFilterValues({date_preset:'period',...invalid},'2026-09-08'));
});

test('filtro vendas: todos os dias remove limites antigos, preserva tipo/busca e não altera origem',()=>{
 const original={date_preset:'all',from:'2026-09-08',to:'2026-09-08',sale_type:'wholesale',q:'  João  ',seller_id:''};
 const copy={...original};
 assert.deepEqual(salesFilterValues(original,'2026-09-13'),{date_preset:'all',sale_type:'wholesale',q:'João'});
 assert.deepEqual(original,copy);
});

test('filtro vendas: onchange consulta presets automaticamente e aguarda período personalizado',async()=>{
 const start=app.indexOf(' if(el.dataset.datePreset!==undefined)'),end=app.indexOf(' if(el.dataset.',start+4);
 assert.ok(start>=0&&end>start);const source=app.slice(start,end);
 for(const preset of ['today','yesterday','month','all','period']){
  let submits=0,focused=false;const inputs=[0,1].map(()=>({disabled:false,setCustomValidity(){},focus(){focused=true;}}));
  const range={hidden:false,querySelectorAll:()=>inputs,querySelector:()=>inputs[0]},el={name:'date_preset',dataset:{datePreset:''},value:preset,form:{dataset:{},querySelector:()=>range}};
  await runInNewContext(`(async()=>{${source}})()`,{el,busy:true,salesFilters:{request(form,options){assert.equal(form,el.form);assert.equal(options.automatic,true);submits++;}},document:{querySelector:()=>range}});
  assert.equal(submits,preset==='period'?0:1);assert.equal(range.hidden,preset!=='period');assert.equal(inputs[0].disabled,preset!=='period');assert.equal(focused,preset==='period');
 }
});

function context(api){
 const controls=[{disabled:false},{disabled:true}],state={marker:'anterior'},filter={from:'2026-09-08',to:'2026-09-08'};
 const ctx={document:{querySelectorAll:()=>controls},state,filter,salesFilterValues,saoPauloToday:()=> '2026-09-08',URLSearchParams,api,renders:0,render(){ctx.renders++;}};
 ctx.adoptState=next=>{ctx.state=next;};
 runInNewContext(app.slice(app.indexOf('async function applySalesFilters('),app.indexOf('\nlet state =')),ctx);return {ctx,controls,state,filter};
}
test('filtro vendas: consulta e dados são aplicados juntos, controles ficam bloqueados durante espera',async()=>{
 let resolve,query;const response=new Promise(r=>resolve=r),x=context(path=>{query=path;return response;});
 const pending=x.ctx.applySalesFilters({date_preset:'month',seller_id:'v1'});
 assert.equal(x.controls.every(el=>el.disabled),true);assert.equal(x.ctx.state,x.state);assert.equal(x.ctx.filter,x.filter);
 resolve({marker:'novo'});await pending;
 assert.match(query,/from=2026-09-01/);assert.match(query,/to=2026-09-30/);assert.match(query,/seller_id=v1/);
 assert.equal(x.ctx.state.marker,'novo');assert.equal(x.ctx.filter.from,'2026-09-01');assert.equal(x.ctx.renders,1);assert.deepEqual(x.controls.map(el=>el.disabled),[false,true]);
});
test('filtro vendas: falha restaura interface coerente, inválido não consulta e 401 não ressuscita sessão',async()=>{
 const x=context(async()=>{throw Error('conexão');});
 await assert.rejects(x.ctx.applySalesFilters({date_preset:'month'}),/conexão/);assert.equal(x.ctx.state,x.state);assert.equal(x.ctx.filter,x.filter);assert.equal(x.ctx.renders,1);
 let calls=0;const invalid=context(async()=>calls++);await assert.rejects(invalid.ctx.applySalesFilters({date_preset:'period',from:'',to:''}));assert.equal(calls,0);assert.equal(invalid.ctx.renders,0);assert.equal(invalid.controls[0].disabled,false);
 const unauth=context(async()=>{unauth.ctx.state=null;throw Error('sessão expirada');});await assert.rejects(unauth.ctx.applySalesFilters({date_preset:'month'}),/sessão/);assert.equal(unauth.ctx.state,null);assert.equal(unauth.ctx.renders,0);
 assert.match(app,/a==='clear-filters'.*applySalesFilters\(\{date_preset:'today'\}\)/);
 assert.match(app,/Período aplicado: \$\{esc\(summary\)\}/);
});

test('filtro vendas: servidor usa data comercial e limites inclusivos em São Paulo',t=>{
 const db=new Store(':memory:');t.after(()=>db.close());const actor=db.actor(db.register({name:'Teste',store_name:'Filtro',email:'filtro@example.test',password:'senha-ficticia-de-teste'}).token);
 const records=[['2026-09-08T02:59:59Z',null],['2026-09-08T03:00:00Z',null],['2026-09-09T02:59:59Z',null],['2026-09-09T03:00:00Z',null],['2026-09-20T12:00:00Z','2026-09-08']].map(([at,date])=>{
  const id=db.saveDraft(actor,{items:[]}).id;db.run('UPDATE sales SET created_at=?,business_date=? WHERE id=?',at,date,id);return id;
 });
 db.migrateLegacyBusinessDates();
 const ids=db.listSales(actor,{from:'2026-09-08',to:'2026-09-08'}).map(s=>s.id).sort();assert.deepEqual(ids,[records[1],records[2],records[4]].sort());
 assert.deepEqual(db.listSales(actor,{from:'2026-09-07',to:'2026-09-07'}).map(s=>s.id),[records[0]]);
 const listQuery=storeSource.slice(storeSource.indexOf('  listSales('),storeSource.indexOf('  snapshot(',storeSource.indexOf('  listSales(')));
 assert.doesNotMatch(listQuery,/COALESCE\(business_date/);
 assert.match(listQuery,/AND business_date\$\{operator\}\?/);
});
