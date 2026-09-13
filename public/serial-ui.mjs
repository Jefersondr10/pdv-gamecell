export const searchText = value => String(value ?? '').normalize('NFD').replace(/\p{M}/gu, '').toLocaleLowerCase('pt-BR').trim();
export function matchesCatalog(value, query) {
 const text=searchText(value),numbers=text.replace(/\D/g,'');
 return searchText(query).split(/\s+/).filter(Boolean).every(term=>text.includes(term)||/^\d[\d.()\-]+$/.test(term)&&numbers.includes(term.replace(/\D/g,'')));
}
export function unitList(units,{esc,money,costs}) {
 const status={available:'Disponível',sold:'Vendido',removed:'Entrada removida'};
 return `<div class="serial-unit-list">${units.map(u=>`<div class="serial-unit" data-unit-row data-unit-status="${u.status}" data-search-text="${esc(u.serial_number)}"><div><strong>${esc(u.serial_number)}</strong><span class="badge ${u.status==='available'?'good':''}">${status[u.status]}</span></div>${costs?`<strong>${money(u.unit_cost_cents)}</strong>`:''}</div>`).join('')}</div>`;
}
export function unitPicker(units,selected,{esc,money,costs}) {
 return `<div class="stock-search"><label for="unit-query">Buscar SN / IMEI</label><input id="unit-query" type="search" autocomplete="off" placeholder="Digite ou leia o código" maxlength="120"></div><p class="footer-note" data-unit-count role="status">${selected.length} selecionado(s)</p><div class="serial-unit-list serial-picker-list">${units.map(u=>`<label class="serial-unit" data-unit-row data-search-text="${esc(u.serial_number)}"><input type="checkbox" name="unit_ids" value="${esc(u.id)}" ${selected.includes(u.id)?'checked':''}><span>${esc(u.serial_number)}</span>${costs?`<strong>${money(u.unit_cost_cents)}</strong>`:''}</label>`).join('')}</div><p data-unit-empty hidden>Nenhum aparelho encontrado.</p>`;
}
