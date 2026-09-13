import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {simulateInstallment,simulatePaymentOptions,createCalculatorUI,parseExtraInterest} from '../public/installment-calculator.mjs';

function calculatorHarness(t,state) {
 const previous=globalThis.document,nodes=new Map(['#calculator-result','#calculator-error','#calculator-result-title','#calculator-form [name="amount"]'].map(k=>[k,{innerHTML:'',textContent:'',focus(){}}]));
 globalThis.document={querySelector:s=>nodes.get(s)??null};t.after(()=>{if(previous===undefined)delete globalThis.document;else globalThis.document=previous;});
 const saved=Object.getOwnPropertyDescriptor(navigator,'clipboard');
 const output={html:'',copied:'',details:'',renders:0,copies:0,toasts:0,authorized:true};
 Object.defineProperty(navigator,'clipboard',{configurable:true,value:{writeText:async text=>{output.copied=text;output.copies++;}}});
 t.after(()=>{if(saved)Object.defineProperty(navigator,'clipboard',saved);else delete navigator.clipboard;});
 const ui=createCalculatorUI({getState:()=>state,can:()=>output.authorized,page:v=>{output.html=v;output.renders++;nodes.get('#calculator-error').textContent='';},heading:(title,subtitle,action='')=>`<h1>${title}</h1>${action}`,empty:(a,b)=>a+b,field:(l,c)=>`<label>${l}${c}</label>`,input:(n,v,a)=>`<input name="${n}" value="${v}" ${a}>`,option:(v,l,s)=>`<option value="${v}" ${v===s?'selected':''}>${l}</option>`,esc:String,money:String,cents:v=>Math.round(Number(v.replace(',','.'))*100),toast:()=>output.toasts++,showInfo:text=>output.details=text});
 const enter=(name,value)=>ui.input({form:{id:'calculator-form'},tagName:'INPUT',name,value});
 const change=(name,value)=>ui.change({form:{id:'calculator-form'},tagName:'SELECT',name,value});
 return {ui,output,enter,change,nodes,errorText:()=>output.html+' '+nodes.get('#calculator-error').textContent};
}

function assertCustomerResult(html) {
 assert.doesNotMatch(html,/<form\b|<input\b|<select\b|Juros adicionais|%|Atualizar taxas|calculator-details|Detalhes|Máquina interna/i);
 assert.match(html,/calculator-edit/);
 assert.deepEqual([...html.matchAll(/data-installments="(\d+)"/g)].map(m=>Number(m[1])),Array.from({length:18},(_,i)=>i+1));
}
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
 const copy=module.slice(module.indexOf("if(action==='calculator-copy'"));assert.doesNotMatch(copy,/fee_cents|net_cents|basis_points|profit|interestLabel|interestNote|Juros adicionais/);
});

test('calculadora em etapas: digitação preserva campos; Simular abre somente o resultado e Alterar dados restaura o formulário',async t=>{
 const state={user:{id:'u'},card_machines:[{id:'m',name:'Máquina',brands:[{id:'b',name:'Visa'}]}],rates:[{id:'r',machine_id:'m',brand_id:'b',brand:'Visa',mode:'credit',installments:3,basis_points:592}]};
 const {ui,output,enter}=calculatorHarness(t,state);
 ui.render();assert.match(output.html,/id="calculator-form"/);assert.match(output.html,/>Simular</);assert.doesNotMatch(output.html,/data-installments=|calculator-copy|calculator-edit/);
 const amount={form:{id:'calculator-form'},tagName:'INPUT',name:'amount',value:'1000'};ui.input(amount);enter('entry','200');assert.equal(output.renders,1);assert.equal(ui.change(amount),false);
 assert.doesNotMatch(output.html,/data-installments=|calculator-copy/);
 ui.render();assert.match(output.html,/name="amount" value="1000"/);assert.match(output.html,/name="entry" value="200"/);assert.doesNotMatch(output.html,/data-installments=/);
 assert.equal(ui.submit(),true);assertCustomerResult(output.html);assert.match(output.html,/28345/);
 ui.render();assertCustomerResult(output.html);assert.match(output.html,/28345/);
 state.rates[0].basis_points=0;ui.render();assertCustomerResult(output.html);assert.match(output.html,/26667/);
 await ui.action('calculator-edit');assert.match(output.html,/id="calculator-form"/);assert.match(output.html,/name="amount" value="1000"/);assert.match(output.html,/name="entry" value="200"/);assert.doesNotMatch(output.html,/data-installments=|calculator-copy/);
 state.user.id='other';ui.render();assert.match(output.html,/name="amount" value=""/);assert.doesNotMatch(output.html,/name="entry" value="200"/);
});

test('calculadora completa: mostra todas as opções, isola taxa fora do limite e copia texto comercial',async t=>{
 const state={user:{id:'u'},store:{name:'Loja teste'},card_machines:[{id:'m',name:'Máquina',brands:[{id:'b',name:'Visa'}]}],rates:[
  {id:'r1',machine_id:'m',brand_id:'b',brand:'Visa',mode:'credit',installments:1,basis_points:0},
  {id:'r3',machine_id:'m',brand_id:'b',brand:'Visa',mode:'credit',installments:3,basis_points:592},
  {id:'rx',machine_id:'m',brand_id:'b',brand:'Visa',mode:'credit',installments:18,basis_points:9999},
  {id:'rd',machine_id:'m',brand_id:'b',brand:'Visa',mode:'debit',installments:1,basis_points:199}
 ]};
 const {ui,output,enter,errorText}=calculatorHarness(t,state);
 ui.render();enter('amount','10000000');await ui.action('calculator-copy');assert.equal(output.copies,0);assert.equal(ui.submit(),true);assertCustomerResult(output.html);assert.match(output.html,/1000000000/);assert.match(output.html,/Indisponível/);
 await ui.action('calculator-edit');enter('amount','1000');enter('entry','200');assert.equal(ui.submit(),true);assert.match(output.html,/28345/);assertCustomerResult(output.html);
 await ui.action('calculator-copy');assert.match(output.copied,/1x de 80000/);assert.match(output.copied,/3x de 28345 · Total com entrada: 105035/);assert.match(output.copied,/18x de/);assert.match(output.copied,/Débito à vista 81625/);assert.equal((output.copied.match(/Entrada: 20000/g)||[]).length,1);assert.doesNotMatch(output.copied,/taxa|líquido|lucro|5034|100001|\n2x de/i);
 await ui.action('calculator-details');assert.equal(output.details,'');
 const before=output.toasts;navigator.clipboard.writeText=async()=>{throw Error('Clipboard blocked');};await assert.rejects(ui.action('calculator-copy'),/Clipboard blocked/);assert.equal(output.toasts,before);
 await ui.action('calculator-edit');assert.match(output.html,/name="amount" value="1000"/);assert.match(output.html,/name="entry" value="200"/);
 await ui.action('calculator-details');assert.match(output.details,/5034/);assert.match(output.html,/id="calculator-form"/);assert.doesNotMatch(output.html,/data-installments=/);
 enter('entry','1000');assert.equal(ui.submit(),false);assert.match(errorText(),/entrada menor/);assert.doesNotMatch(output.html,/calculator-copy|data-installments=/);
 await ui.action('calculator-copy');assert.equal(output.toasts,before);
 enter('entry','0');assert.equal(ui.submit(),true);const originalRates=state.rates;state.rates=[];ui.render();assert.match(output.html,/id="calculator-form"/);assert.doesNotMatch(output.html,/calculator-copy|data-installments=/);
 state.rates=originalRates;ui.render();assert.equal(ui.submit(),true);output.authorized=false;await ui.action('calculator-copy');ui.render();assert.match(output.html,/Acesso restrito/);output.details='';await ui.action('calculator-details');assert.equal(output.details,'');
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

test('juros adicionais: vazio e zero preservam resultados; vírgula e ponto têm precisão de dois decimais',()=>{
 for(const [value,expected] of [['',0],['  ',0],['0',0],['0,00',0],['1',100],['1,15',115],['1.15',115],['0,29',29],[',5',50],['.5',50],['1,',100],['99.99',9999]])assert.equal(parseExtraInterest(value),expected);
 for(const value of ['-1','1e2','1%','1.000','1,234','1,2.3','abc',',','.','100','100,01','Infinity',null])assert.throws(()=>parseExtraInterest(value),/juros adicionais/i);
 const base={amount_cents:100000,entry_cents:20000,basis_points:592,installments:3};
 assert.deepEqual(simulateInstallment({...base,extra_interest_basis_points:parseExtraInterest('')}),simulateInstallment(base));
 assert.equal(simulateInstallment({...base,extra_interest_basis_points:0}).total_cents,105035);
});

test('juros adicionais: soma 1 ponto percentual sem taxar entrada ou alterar a taxa da máquina',()=>{
 const r=simulateInstallment({amount_cents:100000,entry_cents:20000,basis_points:592,extra_interest_basis_points:100,installments:3});
 assert.equal(r.basis_points,592);assert.equal(r.extra_interest_basis_points,100);assert.equal(r.combined_basis_points,692);
 assert.equal(r.financed_cents,80000);assert.equal(r.installment_cents,28650);assert.equal(r.total_cents,105950);
 assert.equal(r.card_cents,85950);assert.equal(r.fee_cents,5088);assert.equal(r.net_cents,100862);
 assert.equal(r.net_cents+r.fee_cents,r.total_cents);
 // Rounding and the machine fee remain exact at the maximum accepted amount.
 const large=simulateInstallment({amount_cents:98_999_999_990,basis_points:0,extra_interest_basis_points:100,installments:18});
 assert.equal(large.card_cents,99_999_999_990);assert.equal(large.fee_cents,0);
 assert.throws(()=>simulateInstallment({amount_cents:99_000_000_000,basis_points:0,extra_interest_basis_points:100,installments:18}),/ultrapassa o limite/);
});

test('juros adicionais: rejeita inválidos e soma de 100%, mantendo outras opções disponíveis',()=>{
 const base={amount_cents:100000,basis_points:592,installments:3};
 for(const value of [-1,1.5,10000,'100',NaN,Infinity,null])assert.throws(()=>simulateInstallment({...base,extra_interest_basis_points:value}),/Juros adicionais/);
 assert.throws(()=>simulateInstallment({...base,extra_interest_basis_points:9408}),/menor que 100%/);
 const rates=Object.freeze([
  Object.freeze({machine_id:'m',brand_id:'b',mode:'credit',installments:1,basis_points:0}),
  Object.freeze({machine_id:'m',brand_id:'b',mode:'credit',installments:3,basis_points:592}),
  Object.freeze({machine_id:'m',brand_id:'b',mode:'credit',installments:18,basis_points:9900}),
  Object.freeze({machine_id:'m',brand_id:'b',mode:'debit',installments:1,basis_points:199})
 ]);
 const before=structuredClone(rates),options=simulatePaymentOptions({rates,machine:'m',brand:'b',amount_cents:100000,entry_cents:20000,extra_interest_basis_points:100});
 assert.equal(options.credit.length,18);assert.equal(options.credit[2].installment_cents,28650);
 assert.equal(options.credit[17].unavailable,'Taxa total ≥ 100%');assert.equal(options.credit[1].unavailable,'Taxa não cadastrada');
 assert.equal(options.debit.combined_basis_points,299);assert.equal(options.debit.installment_cents,82466);
 assert.deepEqual(rates,before);
 assert.throws(()=>simulatePaymentOptions({rates,machine:'m',brand:'b',amount_cents:100000,extra_interest_basis_points:-1}),/Juros adicionais/);
});

test('juros adicionais em etapas: cálculo privado só no formulário; resultado e cópia mostram valores finais',async t=>{
 const state={user:{id:'u'},store:{name:'Loja teste'},card_machines:[{id:'m',name:'Máquina interna',brands:[{id:'b',name:'Visa'}]}],rates:Object.freeze([
  Object.freeze({id:'r3',machine_id:'m',brand_id:'b',brand:'Visa',mode:'credit',installments:3,basis_points:592}),
  Object.freeze({id:'r18',machine_id:'m',brand_id:'b',brand:'Visa',mode:'credit',installments:18,basis_points:9900})
 ])};
 const original=structuredClone(state);
 const {ui,output,enter,errorText}=calculatorHarness(t,state);
 ui.render();assert.match(output.html,/Juros adicionais \(%\)/);assert.match(output.html,/Somados à taxa da máquina só nesta simulação/);assert.match(output.html,/name="extra_interest" value="0"/);assert.match(output.html,/aria-describedby="calculator-interest-help"/);
 enter('amount','1000');enter('entry','200');enter('extra_interest','1');assert.equal(output.renders,1);
 assert.doesNotMatch(output.html,/data-installments=|calculator-copy/);
 await ui.action('calculator-details');assert.match(output.details,/Taxa da máquina: 5,92%/);assert.match(output.details,/5088/);assert.match(output.details,/Juros adicionais/);assert.match(output.details,/6,92%/);assert.match(output.details,/100862/);
 output.details='';assert.equal(ui.submit(),true);assertCustomerResult(output.html);assert.match(output.html,/28650/);assert.match(output.html,/Indisponível/);
 await ui.action('calculator-copy');assert.match(output.copied,/3x de 28650 · Total com entrada: 105950/);
 assert.doesNotMatch(output.copied,/juros|adicionais|%|taxa|líquido|lucro|custo|Máquina interna|5088|100862|5,92|6,92|18x de/i);
 await ui.action('calculator-details');assert.equal(output.details,'');
 await ui.action('calculator-edit');assert.match(output.html,/name="extra_interest" value="1"/);assert.match(output.html,/name="entry" value="200"/);
 enter('extra_interest','1,15');assert.equal(ui.submit(),true);assertCustomerResult(output.html);await ui.action('calculator-copy');assert.doesNotMatch(output.copied,/juros|adicionais|%/i);assert.match(output.copied,/3x de 28696 · Total com entrada: 106088/);
 await ui.action('calculator-edit');enter('extra_interest','-1');assert.equal(ui.submit(),false);assert.match(errorText(),/juros adicionais/i);assert.doesNotMatch(output.html,/calculator-copy|data-installments=/);
 const before=output.copies;await ui.action('calculator-copy');assert.equal(output.copies,before);
 enter('extra_interest','');assert.equal(ui.submit(),true);assert.match(output.html,/28345/);await ui.action('calculator-copy');assert.doesNotMatch(output.copied,/Juros adicionais/);
 assert.deepEqual(state,original);
 await ui.action('calculator-edit');enter('extra_interest','2');state.user.id='other';ui.render();assert.match(output.html,/name="extra_interest" value="0"/);assert.match(output.html,/name="amount" value=""/);
});

test('simulação para cliente: copia 1 a 18 e débito com acréscimo nos valores, sem divulgar juros internos',async t=>{
 const rates=[...Array.from({length:18},(_,i)=>({machine_id:'m',brand_id:'b',brand:'Visa',mode:'credit',installments:i+1,basis_points:374+i*20})),{machine_id:'m',brand_id:'b',brand:'Visa',mode:'debit',installments:1,basis_points:199}];
 const state={user:{id:'u'},store:{name:'Loja teste'},card_machines:[{id:'m',name:'Máquina interna',brands:[{id:'b',name:'Visa'}]}],rates};
 const original=structuredClone(state);
 const {ui,output,enter}=calculatorHarness(t,state);
 ui.render();enter('amount','1000');
 for(const entry of ['0','200'])for(const interest of ['0','1','1,15']){
  await ui.action('calculator-edit');enter('entry',entry);enter('extra_interest',interest);assert.equal(ui.submit(),true);assertCustomerResult(output.html);await ui.action('calculator-copy');
  const options=simulatePaymentOptions({rates,machine:'m',brand:'b',amount_cents:100000,entry_cents:Number(entry)*100,extra_interest_basis_points:parseExtraInterest(interest)});
  assert.deepEqual([...output.copied.matchAll(/^(\d+)x de /gm)].map(m=>Number(m[1])),Array.from({length:18},(_,i)=>i+1));
  for(const r of [...options.credit,options.debit])assert.ok(output.copied.includes(`${r.mode==='debit'?'Débito à vista':`${r.installments}x de`} ${r.installment_cents} · Total${r.entry_cents?' com entrada':''}: ${r.total_cents}`));
  assert.equal(output.copied.includes('Entrada: 20000'),entry==='200');
  assert.doesNotMatch(output.copied,/juros|adicionais|acréscimo|%|taxa|líquido|lucro|custo|Máquina interna/i);
 }
 assert.deepEqual(state,original);
});

test('etapas: seleção de máquina exige bandeira válida e preserva valores sem simular automaticamente',async t=>{
 const state={user:{id:'u'},store:{name:'Loja teste'},card_machines:[{id:'m',name:'Primeira',brands:[{id:'b',name:'Visa'}]},{id:'m2',name:'Segunda',brands:[{id:'b2',name:'Mastercard'},{id:'b3',name:'Outra'}]}],rates:[{machine_id:'m',brand_id:'b',mode:'credit',installments:1,basis_points:374},{machine_id:'m2',brand_id:'b2',mode:'credit',installments:1,basis_points:499},{machine_id:'m2',brand_id:'b3',mode:'credit',installments:1,basis_points:599}]};
 const {ui,output,enter,change}=calculatorHarness(t,state);
 ui.render();enter('amount','1000');enter('entry','200');enter('extra_interest','1');assert.equal(ui.submit(),false);
 change('machine','m');assert.doesNotMatch(output.html,/data-installments=/);assert.equal(ui.submit(),true);assertCustomerResult(output.html);
 await ui.action('calculator-edit');change('machine','m2');assert.match(output.html,/name="amount" value="1000"/);assert.match(output.html,/name="entry" value="200"/);assert.match(output.html,/name="extra_interest" value="1"/);
 assert.equal(ui.submit(),false);assert.doesNotMatch(output.html,/data-installments=|calculator-copy/);
 change('brand','b2');assert.doesNotMatch(output.html,/data-installments=/);assert.equal(ui.submit(),true);assertCustomerResult(output.html);assert.match(output.html,/85098/);
});

test('etapas: nenhuma opção válida mantém formulário; invalidação das taxas retira resultado e cópia antiga',async t=>{
 const state={user:{id:'u'},store:{name:'Loja teste'},card_machines:[{id:'m',name:'Máquina',brands:[{id:'b',name:'Visa'}]}],rates:[{machine_id:'m',brand_id:'b',mode:'credit',installments:1,basis_points:9900}]};
 const {ui,output,enter,errorText}=calculatorHarness(t,state);
 ui.render();enter('amount','1000');enter('extra_interest','1');assert.equal(ui.submit(),false);assert.match(output.html,/id="calculator-form"/);assert.doesNotMatch(output.html,/calculator-copy|data-installments=/);assert.match(errorText(),/taxa|opç|simula/i);
 enter('extra_interest','0');assert.equal(ui.submit(),true);await ui.action('calculator-copy');const before=output.copies;
 state.rates[0].basis_points=10000;ui.render();assert.match(output.html,/id="calculator-form"/);assert.doesNotMatch(output.html,/data-installments=|calculator-copy/);await ui.action('calculator-copy');assert.equal(output.copies,before);
 state.rates[0].basis_points=0;ui.render();assert.equal(ui.submit(),true);ui.reset();ui.render();assert.match(output.html,/name="amount" value=""/);assert.match(output.html,/name="extra_interest" value="0"/);assert.doesNotMatch(output.html,/data-installments=|calculator-copy/);
});

test('etapas: troca de usuário ou perda de permissão impede copiar resultado anterior',async t=>{
 const state={user:{id:'u'},store:{name:'Loja teste'},card_machines:[{id:'m',name:'Máquina',brands:[{id:'b',name:'Visa'}]}],rates:[{machine_id:'m',brand_id:'b',mode:'credit',installments:1,basis_points:0}]};
 const {ui,output,enter}=calculatorHarness(t,state);
 ui.render();enter('amount','1000');assert.equal(ui.submit(),true);state.user.id='other';await ui.action('calculator-copy');assert.equal(output.copies,0);ui.render();assert.match(output.html,/name="amount" value=""/);
 enter('amount','2000');assert.equal(ui.submit(),true);output.authorized=false;await ui.action('calculator-copy');assert.equal(output.copies,0);ui.render();assert.match(output.html,/Acesso restrito/);assert.doesNotMatch(output.html,/calculator-copy|data-installments=/);
});
