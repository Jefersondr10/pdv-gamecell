// The user sees Brazilian dates; requests keep the ISO contract used by the database.
const escape=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
export function brazilianDate(value,kind='date') {
 if(!value)return '';
 return kind==='month' ? `${value.slice(5,7)}/${value.slice(0,4)}` : `${value.slice(8,10)}/${value.slice(5,7)}/${value.slice(0,4)}`;
}
export function isoDate(value,kind='date') {
 const raw=String(value??'').trim();if(!raw)return '';
 const parts=raw.split('/'),month=kind==='month';
 if(!(month?/^\d{2}\/\d{4}$/:/^\d{2}\/\d{2}\/\d{4}$/).test(raw))throw Error(month?'Use mês/ano, por exemplo 09/2026.':'Use dia/mês/ano, por exemplo 07/09/2026.');
 const iso=month?`${parts[1]}-${parts[0]}`:`${parts[2]}-${parts[1]}-${parts[0]}`;
 const check=month?iso+'-01':iso,d=new Date(check+'T12:00:00Z');
 if(check<'2000-01-01'||check>'2199-12-31'||Number.isNaN(d.getTime())||d.toISOString().slice(0,10)!==check)throw Error('Informe uma data válida entre 2000 e 2199.');
 return iso;
}
export function dateInput(name,value,extra) {
 const kind=extra.includes('type="month"')?'month':'date',hint=kind==='month'?'MM/AAAA':'DD/MM/AAAA';
 const attrs=extra.replace(/type="(?:date|month)"/,'type="text"').replace(/\b(min|max)="([^"]+)"/g,'data-$1-date="$2"');
 return `<input name="${escape(name)}" value="${escape(brazilianDate(value,kind))}" ${attrs} data-date-kind="${kind}" inputmode="numeric" autocomplete="off" placeholder="${hint}" maxlength="${kind==='month'?7:10}" aria-label="${escape(name==='received_date'?'Data da entrada':name==='business_date'?'Data da venda':name==='month'?'Mês de referência':name.includes('due_date')?'Vencimento':name.includes('reference_month')?'Mês de referência':name==='paid_date'?'Data do pagamento ou retirada':name==='from'?'Data inicial':'Data final')} (${hint})"><small class="date-format-hint">${kind==='month'?'Mês / ano':'Dia / mês / ano'}</small>`;
}
export function dateValue(element) {
 if(!element?.dataset?.dateKind)return element?.value??'';
 const value=isoDate(element.value,element.dataset.dateKind),{minDate,maxDate}=element.dataset;
 if(value&&((minDate&&value<minDate)||(maxDate&&value>maxDate)))throw Error(`Data fora do período permitido${maxDate?' (até '+brazilianDate(maxDate,element.dataset.dateKind)+')':''}.`);
 return value;
}
export function normalizeDateFields(form,data) {
 for(const el of form.querySelectorAll('[data-date-kind]'))if(!el.disabled&&!el.name.startsWith('bulk_'))data[el.name]=dateValue(el);
 return data;
}
export function dateRange(preset,today) {
 if(preset==='today')return {from:today,to:today};
 if(preset==='yesterday'){const d=new Date(today+'T12:00:00Z');d.setUTCDate(d.getUTCDate()-1);const day=d.toISOString().slice(0,10);return {from:day,to:day};}
 if(preset==='month'){const [y,m]=today.split('-').map(Number);return {from:today.slice(0,7)+'-01',to:new Date(Date.UTC(y,m,0)).toISOString().slice(0,10)};}
 throw Error('Período inválido.');
}
export function salesFilterValues(data,today) {
 const {date_preset,...filters}=data;
 if(Object.hasOwn(filters,'sale_status')){
  const selected=String(filters.sale_status??'');
  delete filters.sale_status;delete filters.review;delete filters.operational_status_id;
  if(selected==='__review__')filters.review='required';
  else if(selected==='__review_clear__')filters.review='clear';
  else if(selected){filters.operational_status_id=selected;filters.review='clear';}
 }
 if(date_preset==='period'){
  if(!filters.from||!filters.to)throw Error('Informe a data inicial e a data final.');
  for(const key of ['from','to'])if(!/^\d{4}-\d{2}-\d{2}$/.test(filters[key])||isoDate(brazilianDate(filters[key]))!==filters[key])throw Error('Informe uma data válida.');
  if(filters.from>filters.to)throw Error('A data inicial não pode ser posterior à data final.');
 }else if(date_preset==='all'){
  delete filters.from;delete filters.to;filters.date_preset='all';
 }else Object.assign(filters,dateRange(date_preset,today));
 if(filters.q!==undefined)filters.q=String(filters.q).trim();
 return Object.fromEntries(Object.entries(filters).filter(([,value])=>value));
}
export function initDateControls(root=document) {
 root.addEventListener('input',event=>{
  const el=event.target;if(!el.dataset?.dateKind)return;
  const digits=el.value.replace(/\D/g,'').slice(0,el.dataset.dateKind==='month'?6:8);
  const masked=el.dataset.dateKind==='month'?digits.replace(/^(\d{2})(\d)/,'$1/$2'):digits.replace(/^(\d{2})(\d)/,'$1/$2').replace(/^(\d{2})\/(\d{2})(\d)/,'$1/$2/$3');
  // Preserve mid-string edits; apply the mask while entering an unformatted date.
  if(!el.value.includes('/')||el.selectionStart===el.value.length)el.value=masked;
  el.setCustomValidity('');
 });
 root.addEventListener('blur',event=>{const el=event.target;if(!el.dataset?.dateKind)return;try{dateValue(el);el.setCustomValidity('');}catch(error){el.setCustomValidity(error.message);}},true);
}
