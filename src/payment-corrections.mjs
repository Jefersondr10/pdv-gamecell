import { randomUUID } from 'node:crypto';
import { check,integer,requirePermission,feeCents,sumMoney,businessDate } from './domain.mjs';
import { validDate } from './finance.mjs';

export function editedTimestamp(day,original=new Date().toISOString()) {
 if(day===undefined)return original;
 validDate(day);
 check(day<=businessDate(),'A data de uma entrada ou pagamento realizado não pode estar no futuro.');
 return day===businessDate(new Date(original))?original:new Date(`${day}T12:00:00-03:00`).toISOString();
}
const fields=['method','amount_cents','machine','brand','mode','installments','basis_points','fee_cents','created_at','pix_account_id','pix_account_name'];
const snapshot=p=>Object.fromEntries(fields.map(k=>[k,p[k]]));

// Originals and their idempotency requests remain immutable. Only effective leaves count.
export function correctPayments(store,actor,saleId,data,reason) {
 if(data===undefined)return;
 check(Array.isArray(data)&&data.length<=100,'Informe até 100 pagamentos.');
 const before=store.effectivePayments(actor,saleId),seen=new Set();
 const plans=data.map(input=>{
  check(input&&typeof input==='object'&&!Array.isArray(input),'Pagamento inválido.');
  if(input.rate_id!==undefined)check(typeof input.rate_id==='string'&&input.rate_id.length<=80,'Taxa inválida.');
  if(input.pix_account_id!==undefined&&input.pix_account_id!==null)check(typeof input.pix_account_id==='string'&&input.pix_account_id.length<=80,'Conta Pix inválida.');
  const old=input.id?before.find(p=>p.id===input.id):null;
  check(!input.id||old,'Pagamento não encontrado nesta venda ou já corrigido.',409);
  check(!input.id||!seen.has(input.id),'Pagamento repetido na edição.');if(input.id)seen.add(input.id);
  const method=input.method??old?.method,amount=integer(input.amount_cents??old?.amount_cents,'Pagamento',1);
  check(['cash','pix','card'].includes(method),'Forma de pagamento inválida.');
  check(input.rate_id===undefined||method==='card','Taxa somente em pagamento por cartão.');
  check(input.pix_account_id===undefined||method==='pix','Conta somente em pagamento Pix.');
  let rate=null,account=null;
  if(method==='card'){
   if(input.rate_id!==undefined){rate=store.scoped('rates',input.rate_id,actor);check(rate.active,'Taxa inativa.');}
   else {check(old?.method==='card','Selecione máquina, bandeira e parcelas.');rate=old;}
  }
  if(method==='pix'){
   if(old?.method==='pix'&&(input.pix_account_id===undefined||input.pix_account_id===old.pix_account_id))account={id:old.pix_account_id,name:old.pix_account_name};
   else {check(input.pix_account_id,'Selecione a conta Pix.');account=store.scoped('pix_accounts',input.pix_account_id,actor);check(account.active,'Conta Pix inativa.');}
  }
  const basis=rate?.basis_points??0,fee=old&&method===old.method&&amount===old.amount_cents&&input.rate_id===undefined?old.fee_cents:feeCents(amount,basis);
  const next={method,amount_cents:amount,machine:rate?.machine??null,brand:rate?.brand??null,mode:rate?.mode??null,installments:rate?.installments??null,basis_points:basis,fee_cents:fee,created_at:editedTimestamp(input.paid_date,old?.created_at),pix_account_id:account?.id??null,pix_account_name:account?.name??null};
  const changed=!old||JSON.stringify(snapshot(old))!==JSON.stringify(next);
  if(changed)requirePermission(actor,old?'payments.correct':'payments.record');
  return {old,next,changed};
 });
 const removed=before.filter(p=>!seen.has(p.id));if(removed.length)requirePermission(actor,'payments.correct');
 sumMoney(plans.map(p=>p.next.amount_cents));
 for(const plan of plans){
  if(!plan.changed)continue;
  const key=randomUUID(),p=plan.next;
  // The deferred replacement FK permits the insert trigger to verify a legacy Pix snapshot.
  if(plan.old)store.run('INSERT INTO payment_changes VALUES(?,?,?,?,?,?,?)',actor.tenant_id,saleId,plan.old.id,key,reason,actor.id,new Date().toISOString());
  store.run(`INSERT INTO payments(id,tenant_id,sale_id,method,amount_cents,machine,brand,mode,installments,basis_points,fee_cents,created_at,pix_account_id,pix_account_name) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,key,actor.tenant_id,saleId,...fields.map(k=>p[k]));
  store.audit(actor,'payment',plan.old?.id??key,plan.old?'corrected':'recorded_in_sale_edit',{sale_id:saleId,reason,before:plan.old,after:{id:key,...p}});
 }
 for(const old of removed){
  store.run('INSERT INTO payment_changes VALUES(?,?,?,?,?,?,?)',actor.tenant_id,saleId,old.id,null,reason,actor.id,new Date().toISOString());
  store.audit(actor,'payment',old.id,'removed_from_sale',{sale_id:saleId,reason,before:old});
 }
}
