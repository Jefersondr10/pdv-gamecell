const LIMIT=100_000_000_000;
const validMoney=value=>Number.isSafeInteger(value)&&value>=0&&value<=LIMIT;
const ceil=(a,b)=>(a+b-1n)/b;
const validInterest=value=>Number.isSafeInteger(value)&&value>=0&&value<10000;
const interestLabel=basisPoints=>(basisPoints/100).toLocaleString('pt-BR',{maximumFractionDigits:2});

export function parseExtraInterest(value='') {
  const text=String(value).trim();
  if(!text)return 0;
  const parts=text.match(/^(?:(\d+)(?:[.,](\d{0,2}))?|[.,](\d{1,2}))$/);
  if(!parts)throw Error('Informe juros adicionais de 0 a 99,99%, com até duas casas decimais.');
  const basisPoints=Number(parts[1]||0)*100+Number((parts[2]??parts[3]??'').padEnd(2,'0'));
  if(!validInterest(basisPoints))throw Error('Informe juros adicionais de 0 a 99,99%, com até duas casas decimais.');
  return basisPoints;
}

// Only a simulation: does not create a sale, payment, or card charge.
export function simulateInstallment({amount_cents,entry_cents=0,basis_points,extra_interest_basis_points=0,installments,calculation='net'}) {
  if(!validMoney(amount_cents)||amount_cents<=0||!validMoney(entry_cents)||entry_cents>=amount_cents)throw Error('Informe um valor maior que zero e uma entrada menor que esse valor.');
  if(!Number.isSafeInteger(basis_points)||basis_points<0||basis_points>=10000)throw Error('Taxa indisponível ou inválida para esta simulação.');
  if(!validInterest(extra_interest_basis_points))throw Error('Juros adicionais inválidos: informe de 0 a 99,99%.');
  const combined_basis_points=basis_points+extra_interest_basis_points;
  if(combined_basis_points>=10000)throw Error('A soma da taxa da máquina e dos juros adicionais deve ser menor que 100%.');
  if(!Number.isSafeInteger(installments)||installments<1||installments>36)throw Error('Quantidade de parcelas inválida.');
  if(!['net','markup'].includes(calculation))throw Error('Forma de cálculo inválida.');
  const financed=BigInt(amount_cents-entry_cents),rate=BigInt(combined_basis_points),machineRate=BigInt(basis_points),count=BigInt(installments);
  const raw=calculation==='net'?ceil(financed*10000n,10000n-rate):financed+(financed*rate+5000n)/10000n;
  const installment=ceil(raw,count),card=installment*count,fee=(card*machineRate+5000n)/10000n,total=card+BigInt(entry_cents);
  if(total>BigInt(LIMIT))throw Error('O total simulado ultrapassa o limite permitido.');
  return {installments,basis_points,extra_interest_basis_points,combined_basis_points,amount_cents,entry_cents,financed_cents:Number(financed),installment_cents:Number(installment),card_cents:Number(card),total_cents:Number(total),fee_cents:Number(fee),net_cents:Number(card-fee)+entry_cents,extra_cents:Number(total)-amount_cents};
}

// Missing or overflowing rates affect only their own row, never the other options.
export function simulatePaymentOptions({rates,machine,brand,amount_cents,entry_cents=0,extra_interest_basis_points=0}) {
  if(!validMoney(amount_cents)||amount_cents<=0||!validMoney(entry_cents)||entry_cents>=amount_cents)throw Error('Informe um valor maior que zero e uma entrada menor que esse valor.');
  if(!validInterest(extra_interest_basis_points))throw Error('Juros adicionais inválidos: informe de 0 a 99,99%.');
  const selected=rates.filter(r=>r.machine_id===machine&&r.brand_id===brand);
  const simulate=(mode,installments)=>{
    const rate=selected.find(r=>r.mode===mode&&r.installments===installments);
    if(!rate)return {mode,installments,unavailable:'Taxa não cadastrada'};
    if(validInterest(rate.basis_points)&&rate.basis_points+extra_interest_basis_points>=10000)return {mode,installments,unavailable:'Taxa total ≥ 100%'};
    try{return {mode,rate,...simulateInstallment({amount_cents,entry_cents,basis_points:rate.basis_points,extra_interest_basis_points,installments})};}
    catch{return {mode,installments,unavailable:'Indisponível'};}
  };
  return {credit:Array.from({length:18},(_,i)=>simulate('credit',i+1)),debit:selected.some(r=>r.mode==='debit'&&r.installments===1)?simulate('debit',1):null};
}

export function createCalculatorUI({getState,can,page,heading,empty,field,input,option,esc,money,cents,toast,showInfo}) {
  const fresh=()=>({amount:'',entry:'',machine:'',brand:'',extra_interest:'0'});
  let owner='',draft=fresh(),selected=null,step='form';
  const allowed=()=>can('costs.view')||can('settings.manage');
  const visibleRates=()=>allowed()?(getState()?.rates??[]):[];
  const sameOwner=()=>allowed()&&owner===getState()?.user.id;
  function reset() {owner='';draft=fresh();selected=null;step='form';}
  function currentMachine() {return getState()?.card_machines?.find(m=>m.id===draft.machine);}
  function compute() {
    if(!sameOwner())throw Error('Acesso às taxas indisponível.');
    if(!draft.amount.trim()||!draft.machine||!draft.brand)throw Error('Informe o valor e selecione a máquina e a bandeira.');
    const result=simulatePaymentOptions({rates:visibleRates(),machine:draft.machine,brand:draft.brand,amount_cents:cents(draft.amount),entry_cents:cents(draft.entry),extra_interest_basis_points:parseExtraInterest(draft.extra_interest)});
    if(![...result.credit,result.debit].some(r=>r&&!r.unavailable))throw Error('Nenhuma opção disponível. Confira os valores e as taxas cadastradas.');
    return result;
  }
  function showError(message='') {const error=document.querySelector('#calculator-error');if(error)error.textContent=message;}
  function focusStep(selector) {
    document.querySelector(selector)?.focus?.({preventScroll:true});
    document.defaultView?.scrollTo({top:0,left:0,behavior:'instant'});
  }
  function resultMarkup() {
    const available=[...selected.credit,selected.debit].filter(r=>r&&!r.unavailable),entry=available[0].entry_cents;
    return `<section class="panel calculator-result" aria-label="Resultado da simulação"><div id="calculator-result" class="panel-body"><div class="calculator-result-heading"><h2 id="calculator-result-title" tabindex="-1">Crédito · 1x a 18x</h2></div>${entry?`<p class="calculator-entry-note">Entrada de <strong>${money(entry)}</strong> + uma opção abaixo</p>`:''}<ol class="installment-grid" aria-label="Todas as opções de crédito">${selected.credit.map(r=>`<li class="installment-option ${r.unavailable?'unavailable':''}" data-installments="${r.installments}"><span>${r.installments}x</span><strong>${r.unavailable?'Indisponível':money(r.installment_cents)}</strong></li>`).join('')}</ol>${selected.debit?`<div class="calculator-debit"><span>Débito à vista</span><strong>${selected.debit.unavailable?'Indisponível':money(selected.debit.card_cents)}</strong></div>`:''}<button type="button" data-action="calculator-copy" class="calculator-submit">Copiar todas para WhatsApp</button><p class="calculator-footnote">Simulação · confirme os valores antes de cobrar.</p></div></section>`;
  }
  function render() {
    if(!allowed()){reset();page(empty('Acesso restrito','Peça ao responsável a permissão de visualizar custos e taxas para usar a calculadora.'));return;}
    if(owner!==getState().user.id){reset();owner=getState().user.id;}
    const previousMachine=draft.machine,previousBrand=draft.brand;
    const rates=visibleRates(),machines=(getState().card_machines??[]).filter(m=>rates.some(r=>r.machine_id===m.id));
    if(!machines.some(m=>m.id===draft.machine))draft.machine=machines.length===1?machines[0].id:'';
    const machine=currentMachine(),brands=(machine?.brands??[]).filter(b=>rates.some(r=>r.machine_id===machine.id&&r.brand_id===b.id));
    if(!brands.some(b=>b.id===draft.brand))draft.brand=brands.length===1?brands[0].id:'';
    let error='';
    if(step==='result') {
      try {
        if(previousMachine!==draft.machine||previousBrand!==draft.brand)throw Error('As opções de pagamento mudaram. Confira os dados e simule novamente.');
        selected=compute();
      } catch(err){step='form';selected=null;error=err.message;}
    }
    const actions=step==='result'?'<button type="button" class="small" data-action="calculator-edit">← Alterar dados</button>':'<button type="button" class="small subtle" data-action="calculator-refresh">Atualizar taxas</button>';
    const form=step==='form'?`<section class="panel"><form id="calculator-form" class="panel-body"><div class="calculator-fields">${field('Valor (R$)',input('amount',draft.amount,'required inputmode="decimal" placeholder="0,00"'))}${field('Entrada (R$)',input('entry',draft.entry,'inputmode="decimal" placeholder="0,00"'))}${field('Máquina',`<select name="machine" required>${option('','Selecione',draft.machine)}${machines.map(m=>option(m.id,m.name,draft.machine)).join('')}</select>`)}${field('Bandeira',`<select name="brand" required ${machine?'':'disabled'}>${option('','Selecione',draft.brand)}${brands.map(b=>option(b.id,b.name,draft.brand)).join('')}</select>`)}${field('Juros adicionais (%)',input('extra_interest',draft.extra_interest,'inputmode="decimal" placeholder="0" aria-describedby="calculator-interest-help"'))}<p id="calculator-interest-help" class="calculator-interest-help">Somados à taxa da máquina só nesta simulação. Opcional.</p></div><p class="calculator-method">Valor que a loja quer receber. Entrada opcional.</p><p class="error" role="alert" tabindex="-1" id="calculator-error"></p>${rates.length?'':`<p class="alert">Cadastre as taxas em Cadastro → Máquinas de cartão.</p>`}<button type="submit" class="primary calculator-submit">Simular</button><button type="button" class="small subtle calculator-internal-details" data-action="calculator-details">Detalhes do cálculo</button></form></section>`:'';
    page(`<div class="calculator-page calculator-step calculator-step-${step}">${heading(step==='result'?'Simulação':'Calculadora','',actions)}<div class="calculator-layout">${step==='result'?resultMarkup():form}</div></div>`);
    if(step==='form')showError(error);
  }
  return {render,reset,input(el){
   if(el.form?.id!=='calculator-form')return false;
   if(!sameOwner()){reset();return true;}
   if(step!=='form')return true;
   draft[el.name]=el.value;selected=null;showError();
   if(el.tagName!=='SELECT'&&draft.amount.trim()){try{compute();}catch(err){showError(err.message);}}
   return true;
  },change(el){
   if(el.form?.id!=='calculator-form'||el.tagName!=='SELECT')return false;
   if(!sameOwner()){reset();return true;}
   if(step!=='form')return true;
   draft[el.name]=el.value;selected=null;if(el.name==='machine')draft.brand='';render();return true;
  },submit(){
   if(!sameOwner()){reset();return false;}
   if(step!=='form')return false;
   try{selected=compute();step='result';render();focusStep('#calculator-result-title');return step==='result';}
   catch(err){selected=null;showError(err.message);document.querySelector('#calculator-error')?.focus?.();return false;}
  },async action(action,id){
   if(!allowed()||owner!==getState()?.user.id){reset();return;}
   if(action==='calculator-edit'){step='form';selected=null;render();focusStep('#calculator-form [name="amount"]');return;}
   if(action==='calculator-details'){
    if(step!=='form')return;
    try{selected=compute();showError();}catch(err){selected=null;showError(err.message);return;}
   }
   const available=selected?[...selected.credit,selected.debit].filter(r=>r&&!r.unavailable):[];
   if(action==='calculator-details'&&selected)showInfo?.(`<p>O cálculo soma a taxa da máquina aos juros adicionais informados. A entrada não recebe taxa nem juros. Parcelas iguais são arredondadas para cima em centavos. Nenhuma venda é registrada.</p><div class="calculator-calculation-details">${available.map(r=>`<section><h3>${r.mode==='debit'?'Débito':`${r.installments}x no crédito`}</h3><div class="row-stat"><span>Total com entrada</span><strong>${money(r.total_cents)}</strong></div><div class="row-stat"><span>Taxa da máquina: ${(r.basis_points/100).toLocaleString('pt-BR',{minimumFractionDigits:2})}%</span><strong>${money(r.fee_cents)}</strong></div>${r.extra_interest_basis_points?`<div class="row-stat"><span>Juros adicionais</span><strong>${interestLabel(r.extra_interest_basis_points)}%</strong></div><div class="row-stat"><span>Taxa usada no cálculo</span><strong>${interestLabel(r.combined_basis_points)}%</strong></div>`:''}<div class="row-stat"><span>Líquido + entrada</span><strong>${money(r.net_cents)}</strong></div></section>`).join('')}</div><p>Estimativa sem conexão com a adquirente. Confira as condições antes de cobrar.</p>`);
   // Customer copy contains only payment options and final totals, never internal rates or markups.
   if(action==='calculator-copy'&&step==='result'&&available.length){const first=available[0];const text=`${getState().store.name}\nSimulação de pagamento · ${first.rate.brand||currentMachine()?.brands.find(b=>b.id===draft.brand)?.name||'Cartão'}\n${first.entry_cents?`Entrada: ${money(first.entry_cents)} + uma das opções abaixo\n`:''}${available.map(r=>`${r.mode==='debit'?'Débito à vista':`${r.installments}x de`} ${money(r.mode==='debit'?r.card_cents:r.installment_cents)} · Total${r.entry_cents?' com entrada':''}: ${money(r.total_cents)}`).join('\n')}\nValores sujeitos à confirmação no momento da venda.`;await navigator.clipboard.writeText(text);toast('Todas as opções copiadas, sem custos ou dados internos.');}
  }};
}
