import { renderReceipt, renderReceiptError } from './receipt-view.mjs';
const target=document.querySelector('#receipt');
try {
 const token=location.pathname.split('/').pop(),response=await fetch('/api/public/'+token),sale=await response.json();
 if(!response.ok)throw Error(sale.error);
 document.title=`Pedido ${sale.number} · ${sale.store}`;
 target.innerHTML=renderReceipt(sale);
 document.querySelector('#print').addEventListener('click',()=>window.print());
} catch(error) {
 target.setAttribute('role','alert');
 target.innerHTML=renderReceiptError(error.message||'Não foi possível abrir o pedido.');
}
