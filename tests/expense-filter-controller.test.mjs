import test from 'node:test';
import assert from 'node:assert/strict';
import { createExpenseFilterController } from '../public/expense-filter-controller.mjs';

const settle=async()=>{await Promise.resolve();await Promise.resolve();};

function harness({busy=false,current=true,normalize=(_form,data)=>data,applyOverride}={}) {
 const calls=[],errors=[],successes=[],timers=new Map();let nextTimer=1;
 const controller=createExpenseFilterController({
  apply:async(form,data)=>{calls.push({id:form.id,data:{...data}});await applyOverride?.(form,data);},
  isBusy:()=>busy,
  setBusy:value=>{busy=value;},
  isCurrent:()=>current,
  snapshot:form=>({...form.values}),
  normalize,
  onError:error=>errors.push(error.message),
  onSuccess:(_form,data,focusName)=>successes.push({data:{...data},focusName}),
  schedule:(callback,delay)=>{const id=nextTimer++;timers.set(id,{callback,delay});return id;},
  cancel:id=>timers.delete(id)
 });
 const runTimer=async()=>{const entry=[...timers.entries()][0];assert.ok(entry,'timer esperado');timers.delete(entry[0]);entry[1].callback();await settle();return entry[1].delay;};
 return {controller,calls,errors,successes,timers,runTimer,setBusy:value=>{busy=value;},setCurrent:value=>{current=value;}};
}

test('filtros de despesas: busca aguarda a digitação e aplica somente o valor mais recente',async()=>{
 const x=harness(),form={id:'fin-expense-list-filter',isConnected:true,values:{search:'m'}};
 assert.equal(x.controller.request(form,{delay:280,focusName:'search'}),true);
 form.values.search='material';x.controller.request(form,{delay:280,focusName:'search'});
 assert.equal(x.calls.length,0);assert.equal(x.timers.size,1);
 assert.equal(await x.runTimer(),280);
 assert.deepEqual(x.calls,[{id:form.id,data:{search:'material'}}]);
 assert.deepEqual(x.successes,[{data:{search:'material'},focusName:'search'}]);
});

test('filtros de despesas: mudança imediata preserva a última intenção enquanto outra ação termina',async()=>{
 const x=harness({busy:true}),form={id:'fin-expense-list-period',isConnected:true,values:{period:'current'}};
 x.controller.request(form,{focusName:'period'});
 form.values.period='all';x.controller.request(form,{focusName:'period'});
 assert.equal(x.calls.length,0);assert.equal(x.timers.size,1);
 x.setBusy(false);assert.equal(await x.runTimer(),40);
 assert.deepEqual(x.calls,[{id:form.id,data:{period:'all'}}]);
});

test('filtros de despesas: uma consulta ativa conclui antes da próxima e não restaura foco antigo',async()=>{
 let releaseFirst;const firstDone=new Promise(resolve=>{releaseFirst=resolve;}),x=harness({applyOverride:async(_form,data)=>{if(data.period==='current')await firstDone;}});
 const form={id:'fin-expense-list-period',isConnected:true,values:{period:'current'}};
 x.controller.request(form,{focusName:'period'});await settle();assert.equal(x.calls.length,1);
 form.values.period='all';x.controller.request(form,{focusName:'period'});await settle();assert.equal(x.calls.length,1);
 releaseFirst();await settle();await settle();
 assert.deepEqual(x.calls.map(call=>call.data.period),['current','all']);
 assert.equal(x.successes.length,1);assert.equal(x.successes[0].data.period,'all');
});

test('filtros de despesas: formulário antigo, limpeza e valor inválido não aplicam estado atrasado',async()=>{
 const x=harness({normalize:(_form,data)=>{if(data.period==='month'&&!data.month)throw Error('Informe um mês válido.');}}),form={id:'fin-expenses-month',isConnected:true,values:{period:'month',month:''}};
 assert.equal(x.controller.request(form),false);assert.deepEqual(x.errors,['Informe um mês válido.']);assert.equal(x.calls.length,0);
 form.values={period:'all'};x.controller.request(form,{delay:280});x.controller.clear();assert.equal(x.timers.size,0);
 await settle();assert.equal(x.calls.length,0);
 form.isConnected=false;assert.equal(x.controller.request(form),false);
 form.isConnected=true;x.setCurrent(false);assert.equal(x.controller.request(form),false);
});
