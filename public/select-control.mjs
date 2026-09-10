// Native selects keep form values and validation; this layer supplies the visible control.
const controls = new WeakMap();
let serial = 0, opened = null, observing = false;
const normalized = value => value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
export const matchesSelectSearch = (label, query='') => normalized(String(query)).trim().split(/\s+/).filter(Boolean).every(term=>normalized(String(label)).includes(term));

function fieldName(select) {
  if (select.getAttribute('aria-label')) return select.getAttribute('aria-label');
  const labelled = select.getAttribute('aria-labelledby');
  if (labelled) return labelled.split(/\s+/).map(id => document.getElementById(id)?.textContent ?? '').join(' ').trim();
  const label = select.labels?.[0];
  if (!label) return 'Selecionar opção';
  const copy = label.cloneNode(true);
  copy.querySelectorAll('select,input,textarea,button,small,.select-control').forEach(node => node.remove());
  return copy.textContent.trim() || 'Selecionar opção';
}

function enhance(select) {
  if (controls.has(select) || select.multiple || select.size > 1) return;
  const hadFocus = document.activeElement === select;
  const searchable=select.dataset.search==='product';
  const name = fieldName(select), wrapper = document.createElement('span'), trigger = document.createElement(searchable?'input':'button');
  wrapper.className = 'select-control'+(searchable?' product-search-control':'');
  trigger.type = searchable?'search':'button'; trigger.className = 'select-trigger';
  if(searchable){trigger.placeholder='Buscar por nome ou código';trigger.autocomplete='off';trigger.setAttribute('aria-autocomplete','list');}
  trigger.setAttribute('role', 'combobox'); trigger.setAttribute('aria-haspopup', 'listbox');
  trigger.setAttribute('aria-expanded', 'false'); trigger.setAttribute('aria-label', name);
  if (select.getAttribute('aria-describedby')) trigger.setAttribute('aria-describedby', select.getAttribute('aria-describedby'));
  const caption = document.createElement('span'); caption.className = 'select-value';
  if(!searchable){trigger.append(caption);
  trigger.insertAdjacentHTML('beforeend', '<svg class="select-chevron" viewBox="0 0 20 20" fill="none" aria-hidden="true"><path d="m6 8 4 4 4-4" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>');}
  select.before(wrapper); wrapper.append(select, trigger);
  select.classList.add('select-native'); select.tabIndex = -1; select.setAttribute('aria-hidden', 'true');
  const control = { select, wrapper, trigger, caption, name, searchable, popup: null, options: [], highlighted: -1, typeahead: '', typeTimer: null };
  controls.set(select, control);
  const sync = () => {
    const label = select.selectedOptions[0]?.textContent ?? 'Selecione';
    if (caption.textContent !== label) caption.textContent = label;
    if(searchable&&opened!==control)trigger.value=select.value?label:'';
    if (trigger.disabled !== select.disabled) trigger.disabled = select.disabled;
    trigger.setAttribute('aria-required', String(select.required));
    wrapper.classList.toggle('is-disabled', select.disabled);
    const status = select.classList.contains('status-select'); wrapper.classList.toggle('is-status', status);
    if (status) {
      const style = getComputedStyle(select);
      for (const variable of ['--status-color', '--status-bg', '--status-text']) wrapper.style.setProperty(variable, style.getPropertyValue(variable));
    }
    if (select.disabled && opened === control) close();
  };
  control.sync = sync;
  trigger.addEventListener('click', () => {if(searchable){if(opened!==control){open(control);trigger.select();}}else opened===control?close(true):open(control);});
  if(searchable){
    trigger.addEventListener('input',()=>{const query=trigger.value;if(opened!==control)open(control,query);else renderOptions(control,control.list,query);});
    trigger.addEventListener('blur',()=>{if(opened!==control)control.sync();});
  }
  trigger.addEventListener('keydown', event => keyboard(event, control));
  select.addEventListener('focus', () => trigger.focus());
  select.addEventListener('change', sync);
  select.addEventListener('invalid', event => {
    event.preventDefault(); trigger.setAttribute('aria-invalid', 'true'); trigger.focus(); open(control);
  });
  sync();
  if (hadFocus) trigger.focus();
}

export function closeSelectControls(){close(false);}
function close(restoreFocus = false) {
  const control = opened; if (!control) return;
  opened = null;
  if (control.popup?.matches(':popover-open')) control.popup.hidePopover();
  control.popup?.remove(); control.popup = null; control.search = null;
  control.trigger.setAttribute('aria-expanded', 'false');
  control.trigger.removeAttribute('aria-activedescendant'); control.trigger.removeAttribute('aria-controls');
  control.wrapper.classList.remove('is-open');
  control.sync();
  if (restoreFocus && control.trigger.isConnected) control.trigger.focus();
}

function position(control) {
  if (!control.trigger.isConnected) { close(); return; }
  const rect = control.trigger.getBoundingClientRect(), popup = control.popup;
  if (!popup) return;
  if (innerWidth <= 700 && !control.searchable) {
    const viewport=window.visualViewport, width=viewport?.width??innerWidth, height=viewport?.height??innerHeight, left=viewport?.offsetLeft??0, top=viewport?.offsetTop??0;
    popup.style.width=`${Math.max(0,width-24)}px`; popup.style.maxHeight=`${Math.max(0,Math.min(420,height-24))}px`;
    popup.style.left=`${left+12}px`; popup.style.top='auto'; popup.style.bottom=`${Math.max(12,innerHeight-top-height+12)}px`;
    return;
  }
  popup.style.bottom='auto';
  const viewport=window.visualViewport,viewLeft=viewport?.offsetLeft??0,viewTop=viewport?.offsetTop??0,viewWidth=viewport?.width??innerWidth,viewHeight=viewport?.height??innerHeight;
  const width = Math.min(Math.max(rect.width, 230), viewWidth - 24);
  const below = viewTop+viewHeight - rect.bottom - 12, above = rect.top-viewTop - 12;
  const upwards = below < 220 && above > below;
  const height = Math.max(0, Math.min(340, upwards ? above - 6 : below - 6));
  popup.style.width = `${width}px`; popup.style.maxHeight = `${height}px`;
  popup.style.left = `${Math.max(viewLeft+12, Math.min(rect.left, viewLeft+viewWidth - width - 12))}px`;
  popup.style.top = `${upwards ? Math.max(viewTop+12, rect.top - Math.min(popup.scrollHeight, height) - 6) : rect.bottom + 6}px`;
}

function highlight(control, index) {
  if (!control.options.length) {
    control.trigger.removeAttribute('aria-activedescendant');
    control.search?.removeAttribute('aria-activedescendant');
    return;
  }
  control.highlighted = (index + control.options.length) % control.options.length;
  control.options.forEach((option, n) => option.button.classList.toggle('is-highlighted', n === control.highlighted));
  const active = control.options[control.highlighted].button;
  control.trigger.setAttribute('aria-activedescendant', active.id);
  control.search?.setAttribute('aria-activedescendant', active.id);
  active.scrollIntoView({ block: 'nearest' });
}

function choose(control, option) {
  if (control.select.disabled || option.disabled || !control.select.isConnected) return;
  const previous = control.select.value;
  close(true);
  control.select.value = option.value;
  control.trigger.removeAttribute('aria-invalid');
  control.sync();
  if (previous !== control.select.value) {
    control.select.dispatchEvent(new Event('input', { bubbles: true }));
    control.select.dispatchEvent(new Event('change', { bubbles: true }));
  }
}

function renderOptions(control, list, query = '') {
  list.replaceChildren(); control.options = [];
  const filtered = [...control.select.options].filter(option => !option.hidden && !option.disabled && !option.parentElement?.disabled && matchesSelectSearch(option.textContent,query));
  for (const option of filtered) {
    const button = document.createElement('button'); button.type = 'button'; button.className = 'select-option'; button.tabIndex = -1;
    button.id = `select-option-${++serial}`; button.setAttribute('role', 'option');
    button.setAttribute('aria-selected', String(option.selected));
    const label = document.createElement('span'); label.className = 'select-option-label'; label.textContent = option.textContent;
    const check = document.createElement('span'); check.className = 'select-option-check'; check.textContent = option.selected ? '✓' : ''; check.setAttribute('aria-hidden', 'true');
    button.append(label, check);
    button.addEventListener('click', () => choose(control, option));
    list.append(button); control.options.push({ button, option });
  }
  if (!filtered.length) {
    const empty = document.createElement('p'); empty.className = 'select-empty'; empty.textContent = control.searchable?'Nenhum produto encontrado. Tente outro nome ou código.':'Nenhuma opção encontrada.'; empty.setAttribute('role', 'status'); list.append(empty);
  }
  control.highlighted = -1;
  highlight(control, Math.max(0, control.options.findIndex(item => item.option.selected)));
  position(control);
}

function open(control,query='') {
  if (control.select.disabled || !control.select.isConnected) return;
  close();
  document.querySelectorAll('.date-filter[open]').forEach(details => { details.open = false; });
  const popup = document.createElement('div'); popup.className = 'select-popover'; popup.setAttribute('popover', 'manual');
  const header=document.createElement('div');header.className='select-mobile-heading';
  const title=document.createElement('strong');title.textContent=control.name;
  const dismiss=document.createElement('button');dismiss.type='button';dismiss.textContent='Fechar';dismiss.setAttribute('aria-label','Fechar opções');dismiss.addEventListener('click',()=>close(true));
  header.append(title,dismiss);popup.append(header);
  const list = document.createElement('div'); list.id = `select-list-${++serial}`; list.className = 'select-options'; list.setAttribute('role', 'listbox'); list.setAttribute('aria-label', control.name);
  let search=control.searchable?control.trigger:null;
  if (!control.searchable && control.select.options.length > 8) {
    search = document.createElement('input'); search.type = 'search'; search.className = 'select-search';
    search.placeholder = 'Buscar opção…'; search.setAttribute('aria-label', `Buscar em ${control.name}`); search.autocomplete = 'off';
    search.setAttribute('role', 'combobox'); search.setAttribute('aria-autocomplete', 'list');
    search.setAttribute('aria-expanded', 'true'); search.setAttribute('aria-controls', list.id);
    search.addEventListener('input', () => renderOptions(control, list, search.value));
    popup.append(search);
  }
  popup.append(list); (control.select.closest('dialog[open]') ?? document.body).append(popup);
  control.popup = popup; control.search = search; control.list=list; opened = control;
  if(control.searchable&&query)control.trigger.value=query;
  control.trigger.setAttribute('aria-expanded', 'true'); control.trigger.setAttribute('aria-controls', list.id); control.wrapper.classList.add('is-open');
  popup.addEventListener('keydown', event => keyboard(event, control));
  popup.showPopover(); renderOptions(control, list,query);
  if (search) search.focus();
}

function keyboard(event, control) {
  const isOpen = opened === control;
  if (event.key === 'Escape' && isOpen) { event.preventDefault(); event.stopPropagation(); close(true); return; }
  if (event.key === 'Tab' && isOpen) { close(true); return; }
  if (event.target.closest('.select-mobile-heading')) return;
  if(control.searchable&&['Home','End'].includes(event.key))return;
  if (['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) {
    event.preventDefault();
    if (!isOpen) { open(control); if (event.key === 'ArrowUp') highlight(control, control.options.length - 1); return; }
    highlight(control, event.key === 'Home' ? 0 : event.key === 'End' ? control.options.length - 1 : control.highlighted + (event.key === 'ArrowDown' ? 1 : -1));
    return;
  }
  if (event.key === 'Enter' || (event.key === ' ' && event.target === control.trigger&&!control.searchable)) {
    event.preventDefault();
    if (!isOpen) open(control);
    else if (control.options[control.highlighted]) choose(control, control.options[control.highlighted].option);
    return;
  }
  if (!control.searchable&&event.target === control.trigger && event.key.length === 1 && !event.ctrlKey && !event.metaKey && !event.altKey) {
    event.preventDefault(); if (!isOpen) open(control);
    control.typeahead += normalized(event.key); clearTimeout(control.typeTimer);
    const match = control.options.findIndex(item => normalized(item.option.textContent).startsWith(control.typeahead));
    if (match >= 0) highlight(control, match);
    control.typeTimer = setTimeout(() => { control.typeahead = ''; }, 650);
  }
}

export function enhanceSelects(scope = document) {
  if (opened && !opened.select.isConnected) close();
  for (const select of scope.querySelectorAll('select')) { enhance(select); controls.get(select)?.sync(); }
}

export function initSelectControls() {
  if (observing) return; observing = true;
  const observer = new MutationObserver(records => {
    const relevant = records.some(record => record.target instanceof HTMLSelectElement || record.target instanceof HTMLOptionElement ||
      [...record.addedNodes].some(node => node.nodeType === 1 && (node.matches('select') || node.querySelector('select'))));
    if (relevant || (opened && !opened.select.isConnected)) enhanceSelects();
  });
  observer.observe(document.body, { childList: true, subtree: true, characterData: true, attributes: true, attributeFilter: ['disabled', 'required', 'selected', 'label', 'style', 'class'] });
  document.addEventListener('pointerdown', event => { if (opened && !opened.popup?.contains(event.target) && !opened.trigger.contains(event.target)) close(); });
  document.addEventListener('focusin', event => { if (opened && !opened.wrapper.contains(event.target) && !opened.popup?.contains(event.target)) close(); });
  document.addEventListener('close', event => { if (opened?.select.closest('dialog') === event.target) close(); }, true);
  document.addEventListener('keydown', event => { if (event.key === 'Escape' && opened) { event.preventDefault(); event.stopPropagation(); close(true); } }, true);
  document.addEventListener('scroll', event => { if (opened && !opened.popup?.contains(event.target)) { if(innerWidth<=700)position(opened);else close(); } }, true);
  window.addEventListener('resize', () => { if (opened) position(opened); });
  window.visualViewport?.addEventListener('resize', () => { if(opened)position(opened); });
  window.visualViewport?.addEventListener('scroll', () => { if(opened)position(opened); });
  enhanceSelects();
}
