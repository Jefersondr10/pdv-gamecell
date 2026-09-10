import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {simulateInstallment,simulatePaymentOptions,createCalculatorUI} from '../public/installment-calculator.mjs';
test('calculadora: divisão cobre a taxa real, entrada sem taxa e parcelas iguais',()=>{
 const r=simulateInstallment({amount_cents:100000,entry_cents:20000,basis_points:592,installments:3});
 assert.equal(r.installment_cents,28345);assert.equal(r.card_cents,85035);assert.equal(r.total_cents,105035);assert.equal(r.net_cents,100001);assert.equal(r.fee_cents,5034);
});
test('calculadora: método de acréscimo reproduz a referência do catálogo',()=>{
 const r=simulateInstallment({amount_cents:100000,entry_cents:20000,basis_points:592,installments:3,calculation:'markup'});
 assert.equal(r.installment_cents,28246);assert.equal(r.total_cents,104738);assert.equal(r.net_cents,99722);assert.equal(r.extra_cents,4738);
});
test('calculadora: precisão, taxa zero, centavos e limites para todas as parcelas',()=>{
 for(const amount of [1,101,19999,100000,1000000000])for(const basis of [0,199,249,374,1569,1669,9999])for(let installments=1;installments<=36;installments++){
  try{const r=simulateInstallment({amount_cents:amount,basis_points:basis,installments});assert.equal(r.card_cents,r.installment_cents*installments);assert.equal(r.total_cents,r.card_cents+r.entry_cents);assert.equal(r.net_cents+r.fee_cents,r.total_cents);assert.ok(r.net_cents>=amount);assert.ok(Number.isSafeInteger(r.total_cents));}catch(error){if(!/ultrapassa o limite/.test(error.message))throw error;}
 }
});
test('calculadora: não inventa taxa ausente nem aceita 100%, entrada excessiva ou letras',()=>{
 const good={amount_cents:100000,basis_points:374,installments:1};
 for(const invalid of [{basis_points:undefined},{basis_points:10000},{basis_points:-1},{installments:0},{installments:37},{amount_cents:0},{amount_cents:'100'},{entry_cents:100001},{entry_cents:100000},{calculation:'unknown'}])assert.throws(()=>simulateInstallment({...good,...invalid}));
});
test('calculadora: acesso restrito não lê taxas ou cria dados',()=>{
 let html='';const ui=createCalculatorUI({can:()=>false,page:value=>html=value,empty:(a,b)=>a+b,getState:()=>{throw Error('Não deve consultar taxas');}});ui.render();assert.match(html,/Acesso restrito/);
 const app=readFileSync(new URL('../public/app.mjs',import.meta.url),'utf8'),module=readFileSync(new URL('../public/installment-calculator.mjs',import.meta.url),'utf8');assert.match(app,/v!=='calculator'\|\|can\('costs.view'\)\|\|can\('settings.manage'\)/);assert.doesNotMatch(module,/fetch\(|api\(|localStorage|sessionStorage/);
 const copy=module.slice(module.indexOf('const text=`'));assert.doesNotMatch(copy,/fee_cents|net_cents|basis_points|profit/);
});

test('calculadora: digitação não recria campo e voltar ou atualizar mantém valores',t=>{
 const previous=globalThis.document,nodes=new Map(['#calculator-result','#calculator-options','#calculator-error'].map(k=>[k,{innerHTML:'',textContent:''}]));
 globalThis.document={querySelector:s=>nodes.get(s)};t.after(()=>{if(previous===undefined)delete globalThis.document;else globalThis.document=previous;});
 let html='',renders=0;const state={user:{id:'u'},card_machines:[{id:'m',name:'Máquina',brands:[{id:'b',name:'Visa'}]}],rates:[{id:'r',machine_id:'m',brand_id:'b',brand:'Visa',mode:'credit',installments:3,basis_points:592}]};
 const ui=createCalculatorUI({getState:()=>state,can:()=>true,page:v=>{html=v;renders++;},heading:()=>'',empty:(a,b)=>a+b,field:(l,c)=>c,input:(n,v)=>`<input name="${n}" value="${v}">`,option:(v,l,s)=>`<option value="${v}" ${v===s?'selected':''}>${l}</option>`,esc:String,money:n=>String(n),cents:v=>Math.round(Number(v.replace(',','.'))*100),toast:()=>{}});
 ui.render();const amount={form:{id:'calculator-form'},tagName:'INPUT',name:'amount',value:'1000'};ui.input(amount);ui.input({...amount,name:'entry',value:'200'});assert.equal(renders,1);assert.equal(ui.change(amount),false);
 ui.render();assert.match(html,/name="amount" value="1000"/);assert.match(html,/name="entry" value="200"/);assert.match(nodes.get('#calculator-result').innerHTML,/28345/);
 state.rates[0].basis_points=0;ui.render();assert.match(html,/name="amount" value="1000"/);assert.match(nodes.get('#calculator-result').innerHTML,/26667/);
 state.user.id='other';ui.render();assert.match(html,/name="amount" value=""/);assert.doesNotMatch(html,/name="entry" value="200"/);
});

test('calculadora completa: mostra todas as opções, isola taxa fora do limite e copia texto comercial',async t=>{
 const previous=globalThis.document,nodes=new Map(['#calculator-result','#calculator-error'].map(k=>[k,{innerHTML:'',textContent:''}]));
 globalThis.document={querySelector:s=>nodes.get(s)};t.after(()=>{if(previous===undefined)delete globalThis.document;else globalThis.document=previous;});
 let html='',copied='',details='',toasts=0,authorized=true;const saved=Object.getOwnPropertyDescriptor(navigator,'clipboard');Object.defineProperty(navigator,'clipboard',{configurable:true,value:{writeText:async text=>{copied=text;}}});t.after(()=>{if(saved)Object.defineProperty(navigator,'clipboard',saved);else delete navigator.clipboard;});
 const state={user:{id:'u'},store:{name:'Loja teste'},card_machines:[{id:'m',name:'Máquina',brands:[{id:'b',name:'Visa'}]}],rates:[
  {id:'r1',machine_id:'m',brand_id:'b',brand:'Visa',mode:'credit',installments:1,basis_points:0},
  {id:'r3',machine_id:'m',brand_id:'b',brand:'Visa',mode:'credit',installments:3,basis_points:592},
  {id:'rx',machine_id:'m',brand_id:'b',brand:'Visa',mode:'credit',installments:18,basis_points:9999},
  {id:'rd',machine_id:'m',brand_id:'b',brand:'Visa',mode:'debit',installments:1,basis_points:199}
 ]};
 const ui=createCalculatorUI({getState:()=>state,can:()=>authorized,page:v=>html=v,heading:()=>'',empty:(a,b)=>a+b,field:(l,c)=>c,input:(n,v)=>`<input name="${n}" value="${v}">`,option:(v,l,s)=>`<option value="${v}" ${v===s?'selected':''}>${l}</option>`,esc:String,money:n=>String(n),cents:v=>Math.round(Number(v.replace(',','.'))*100),toast:()=>{toasts++;},showInfo:text=>details=text});
 const change=(name,value)=>ui.change({form:{id:'calculator-form'},tagName:'SELECT',name,value}),enter=(name,value)=>ui.input({form:{id:'calculator-form'},tagName:'INPUT',name,value});
 ui.render();enter('amount','10000000');assert.equal(nodes.get('#calculator-error').textContent,'');assert.match(nodes.get('#calculator-result').innerHTML,/1000000000/);assert.match(nodes.get('#calculator-result').innerHTML,/Indisponível/);
 enter('amount','1000');enter('entry','200');assert.match(nodes.get('#calculator-result').innerHTML,/28345/);assert.doesNotMatch(html,/name="rate"|name="mode"/);
 assert.deepEqual([...nodes.get('#calculator-result').innerHTML.matchAll(/data-installments="(\d+)"/g)].map(m=>Number(m[1])),Array.from({length:18},(_,i)=>i+1));
 await ui.action('calculator-copy');assert.match(copied,/1x de 80000/);assert.match(copied,/3x de 28345 · Total com entrada: 105035/);assert.match(copied,/18x de/);assert.match(copied,/Débito à vista 81625/);assert.equal((copied.match(/Entrada: 20000/g)||[]).length,1);assert.doesNotMatch(copied,/taxa|líquido|lucro|5034|100001|\n2x de/i);
 await ui.action('calculator-details');assert.match(details,/5034/);
 ui.render();assert.match(html,/name="amount" value="1000"/);assert.match(html,/name="entry" value="200"/);
 const before=toasts;navigator.clipboard.writeText=async()=>{throw Error('Clipboard blocked');};await assert.rejects(ui.action('calculator-copy'),/Clipboard blocked/);assert.equal(toasts,before);
 enter('entry','1000');assert.match(nodes.get('#calculator-error').textContent,/entrada menor/);assert.doesNotMatch(nodes.get('#calculator-result').innerHTML,/calculator-copy/);
 await ui.action('calculator-copy');assert.equal(toasts,before);
 enter('entry','0');const originalRates=state.rates;state.rates=[];ui.render();assert.doesNotMatch(nodes.get('#calculator-result').innerHTML,/calculator-copy/);
 state.rates=originalRates;ui.render();authorized=false;await ui.action('calculator-copy');ui.render();assert.match(html,/Acesso restrito/);details='';await ui.action('calculator-details');assert.equal(details,'');
});

test('grade de parcelas: ordena 1 a 18 e usa somente máquina e bandeira selecionadas',()=>{
 const rates=Array.from({length:18},(_,i)=>({machine_id:'m',brand_id:'b',mode:'credit',installments:i+1,basis_points:374+i*20})).reverse();
 rates.unshift({machine_id:'other',brand_id:'b',mode:'credit',installments:1,basis_points:9999},{machine_id:'m',brand_id:'other',mode:'credit',installments:2,basis_points:9999});
 const output=simulatePaymentOptions({rates,machine:'m',brand:'b',amount_cents:100000,entry_cents:20000});
 assert.equal(output.debit,null);assert.equal(output.credit.length,18);
 for(let i=0;i<18;i++){const r=output.credit[i];assert.equal(r.installments,i+1);assert.equal(r.basis_points,374+i*20);assert.ok(r.net_cents>=100000);}
});
test('grade de parcelas: taxa ausente nunca vira zero, débito e crédito são distintos',()=>{
 const rates=[{machine_id:'m',brand_id:'b',mode:'credit',installments:1,basis_points:0},{machine_id:'m',brand_id:'b',mode:'credit',installments:3,basis_points:592},{machine_id:'m',brand_id:'b',mode:'credit',installments:18,basis_points:1669},{machine_id:'m',brand_id:'b',mode:'debit',installments:1,basis_points:199}];
 const r=simulatePaymentOptions({rates,machine:'m',brand:'b',amount_cents:100000,entry_cents:20000});
 assert.equal(r.credit[0].installment_cents,80000);assert.equal(r.credit[1].unavailable,'Taxa não cadastrada');assert.equal(r.credit[1].installment_cents,undefined);assert.equal(r.credit[2].installment_cents,28345);assert.equal(r.credit[17].installment_cents,5335);assert.equal(r.debit.installment_cents,81625);
 assert.throws(()=>simulatePaymentOptions({rates,machine:'m',brand:'b',amount_cents:100000,entry_cents:100000}),/entrada menor/);
 rates[2].basis_points=9999;const high=simulatePaymentOptions({rates,machine:'m',brand:'b',amount_cents:1000000000});assert.equal(high.credit[0].installment_cents,1000000000);assert.equal(high.credit[17].unavailable,'Indisponível');
 rates[0].basis_points=10000;rates[3].basis_points=10000;const invalid=simulatePaymentOptions({rates,machine:'m',brand:'b',amount_cents:100000});assert.equal(invalid.credit[0].unavailable,'Indisponível');assert.equal(invalid.debit.unavailable,'Indisponível');
});
