const LIMIT=100_000_000_000;
const validMoney=value=>Number.isSafeInteger(value)&&value>=0&&value<=LIMIT;
const ceil=(a,b)=>(a+b-1n)/b;

// Only a simulation: does not create a sale, payment, or card charge.
export function simulateInstallment({amount_cents,entry_cents=0,basis_points,installments,calculation='net'}) {
  if(!validMoney(amount_cents)||amount_cents<=0||!validMoney(entry_cents)||entry_cents>=amount_cents)throw Error('Informe um valor maior que zero e uma entrada menor que esse valor.');
  if(!Number.isSafeInteger(basis_points)||basis_points<0||basis_points>=10000)throw Error('Taxa indisponível ou inválida para esta simulação.');
  if(!Number.isSafeInteger(installments)||installments<1||installments>36)throw Error('Quantidade de parcelas inválida.');
  if(!['net','markup'].includes(calculation))throw Error('Forma de cálculo inválida.');
  const financed=BigInt(amount_cents-entry_cents),rate=BigInt(basis_points),count=BigInt(installments);
  const raw=calculation==='net'?ceil(financed*10000n,10000n-rate):financed+(financed*rate+5000n)/10000n;
  const installment=ceil(raw,count),card=installment*count,fee=(card*rate+5000n)/10000n,total=card+BigInt(entry_cents);
  if(total>BigInt(LIMIT))throw Error('O total simulado ultrapassa o limite permitido.');
  return {installments,basis_points,amount_cents,entry_cents,financed_cents:Number(financed),installment_cents:Number(installment),card_cents:Number(card),total_cents:Number(total),fee_cents:Number(fee),net_cents:Number(card-fee)+entry_cents,extra_cents:Number(total)-amount_cents};
}

// Missing or overflowing rates affect only their own row, never the other options.
export function simulatePaymentOptions({rates,machine,brand,amount_cents,entry_cents=0}) {
  if(!validMoney(amount_cents)||amount_cents<=0||!validMoney(entry_cents)||entry_cents>=amount_cents)throw Error('Informe um valor maior que zero e uma entrada menor que esse valor.');
  const selected=rates.filter(r=>r.machine_id===machine&&r.brand_id===brand);
  const simulate=(mode,installments)=>{
    const rate=selected.find(r=>r.mode===mode&&r.installments===installments);
    if(!rate)return {mode,installments,unavailable:'Taxa não cadastrada'};
    try{return {mode,rate,...simulateInstallment({amount_cents,entry_cents,basis_points:rate.basis_points,installments})};}
    catch{return {mode,installments,unavailable:'Indisponível'};}
  };
  return {credit:Array.from({length:18},(_,i)=>simulate('credit',i+1)),debit:selected.some(r=>r.mode==='debit'&&r.installments===1)?simulate('debit',1):null};
}

export function createCalculatorUI({getState,can,page,heading,empty,field,input,option,esc,money,cents,toast,showInfo}) {
  const fresh=()=>({amount:'',entry:'',machine:'',brand:''});
  let owner='',draft=fresh(),selected=null;
  const allowed=()=>can('costs.view')||can('settings.manage');
  const visibleRates=()=>allowed()?(getState()?.rates??[]):[];
  function reset() {owner='';draft=fresh();selected=null;}
  function currentMachine() {return getState()?.card_machines?.find(m=>m.id===draft.machine);}
  function render() {
    if(!allowed()){reset();page(empty('Acesso restrito','Peça ao responsável a permissão de visualizar custos e taxas para usar a calculadora.'));return;}
    if(owner!==getState().user.id){reset();owner=getState().user.id;}
    const rates=visibleRates(),machines=(getState().card_machines??[]).filter(m=>rates.some(r=>r.machine_id===m.id));
    if(!machines.some(m=>m.id===draft.machine))draft.machine=machines.length===1?machines[0].id:'';
    const machine=currentMachine(),brands=(machine?.brands??[]).filter(b=>rates.some(r=>r.machine_id===machine.id&&r.brand_id===b.id));
    if(!brands.some(b=>b.id===draft.brand))draft.brand=brands.length===1?brands[0].id:'';
    page(`<div class="calculator-page">${heading('Calculadora','',`<button type="button" class="small subtle" data-action="calculator-refresh">Atualizar taxas</button>`)}<div class="calculator-layout"><section class="panel"><form id="calculator-form" class="panel-body"><div class="calculator-fields">${field('Valor (R$)',input('amount',draft.amount,'required inputmode="decimal" placeholder="0,00"'))}${field('Entrada (R$)',input('entry',draft.entry,'inputmode="decimal" placeholder="0,00"'))}${field('Máquina',`<select name="machine" required>${option('','Selecione',draft.machine)}${machines.map(m=>option(m.id,m.name,draft.machine)).join('')}</select>`)}${field('Bandeira',`<select name="brand" required ${machine?'':'disabled'}>${option('','Selecione',draft.brand)}${brands.map(b=>option(b.id,b.name,draft.brand)).join('')}</select>`)}</div><p class="calculator-method">Valor que a loja quer receber. Entrada opcional.</p><p class="error" role="alert" id="calculator-error"></p>${rates.length?'':`<p class="alert">Cadastre as taxas em Cadastro → Máquinas de cartão.</p>`}</form></section><section class="panel calculator-result" aria-label="Resultado da simulação"><div id="calculator-result"></div></section></div></div>`);
    calculate(false);
  }
  function calculate(showError=true) {
    const result=document.querySelector('#calculator-result'),error=document.querySelector('#calculator-error');
    selected=null;error.textContent='';
    try {
      if(!allowed())throw Error('Acesso às taxas indisponível.');
      const amount=cents(draft.amount),entry=cents(draft.entry);
      if(!draft.amount.trim()||!draft.machine||!draft.brand){if(showError)throw Error('Informe o valor e selecione a máquina e a bandeira.');result.innerHTML='<p class="calculator-placeholder">Preencha o valor para ver de 1x a 18x.</p>';return;}
      selected=simulatePaymentOptions({rates:visibleRates(),machine:draft.machine,brand:draft.brand,amount_cents:amount,entry_cents:entry});
      const available=[...selected.credit,selected.debit].filter(r=>r&&!r.unavailable);
      result.innerHTML=`<div class="panel-body"><div class="calculator-result-heading"><strong>Crédito · 1x a 18x</strong><button type="button" class="small subtle" data-action="calculator-details">Detalhes</button></div>${entry?`<p class="calculator-entry-note">Entrada de <strong>${money(entry)}</strong> + uma opção abaixo</p>`:''}<ol class="installment-grid" aria-label="Todas as opções de crédito">${selected.credit.map(r=>`<li class="installment-option ${r.unavailable?'unavailable':''}" data-installments="${r.installments}"><span>${r.installments}x</span><strong>${r.unavailable?esc(r.unavailable):money(r.installment_cents)}</strong></li>`).join('')}</ol>${selected.debit?`<div class="calculator-debit"><span>Débito à vista</span><strong>${selected.debit.unavailable?esc(selected.debit.unavailable):money(selected.debit.card_cents)}</strong></div>`:''}${available.length?'<button type="button" data-action="calculator-copy" class="calculator-submit">Copiar todas para WhatsApp</button>':'<p class="calculator-footnote">Cadastre taxas válidas para simular.</p>'}<p class="calculator-footnote">Simulação · confirme os valores antes de cobrar.</p></div>`;
    } catch(err){result.innerHTML='<p class="calculator-placeholder">Confira os valores para simular.</p>';if(showError)error.textContent=err.message;}
  }
  return {render,reset,input(el){if(el.form?.id!=='calculator-form')return false;draft[el.name]=el.value;if(el.tagName!=='SELECT')calculate(!!draft.amount.trim());return true;},change(el){if(el.form?.id!=='calculator-form'||el.tagName!=='SELECT')return false;draft[el.name]=el.value;if(el.name==='machine')draft.brand='';render();return true;},submit(){calculate(true);},async action(action,id){
   if(!allowed()||owner!==getState()?.user.id){reset();return;}
   const available=selected?[...selected.credit,selected.debit].filter(r=>r&&!r.unavailable):[];
   if(action==='calculator-details'&&selected)showInfo?.(`<p>O cartão cobre o desconto da máquina. A entrada não recebe taxa. Parcelas iguais são arredondadas para cima em centavos. Nenhuma venda é registrada.</p><div class="calculator-calculation-details">${available.map(r=>`<section><h3>${r.mode==='debit'?'Débito':`${r.installments}x no crédito`}</h3><div class="row-stat"><span>Total com entrada</span><strong>${money(r.total_cents)}</strong></div><div class="row-stat"><span>Taxa: ${(r.basis_points/100).toLocaleString('pt-BR',{minimumFractionDigits:2})}%</span><strong>${money(r.fee_cents)}</strong></div><div class="row-stat"><span>Líquido + entrada</span><strong>${money(r.net_cents)}</strong></div></section>`).join('')}</div><p>Estimativa sem conexão com a adquirente. Confira as condições antes de cobrar.</p>`);
   if(action==='calculator-copy'&&available.length){const first=available[0];const text=`${getState().store.name}\nSimulação de pagamento · ${first.rate.brand||currentMachine()?.brands.find(b=>b.id===draft.brand)?.name||'Cartão'}\n${first.entry_cents?`Entrada: ${money(first.entry_cents)} + uma das opções abaixo\n`:''}${available.map(r=>`${r.mode==='debit'?'Débito à vista':`${r.installments}x de`} ${money(r.mode==='debit'?r.card_cents:r.installment_cents)} · Total${r.entry_cents?' com entrada':''}: ${money(r.total_cents)}`).join('\n')}\nValores sujeitos à confirmação no momento da venda.`;await navigator.clipboard.writeText(text);toast('Todas as opções copiadas, sem taxas ou dados internos.');}
  }};
}
