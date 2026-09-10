import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { enhanceMobileTables,initMobileNavigation } from '../public/mobile-ui.mjs';

function element(text='',interactive=false) {
 const classes=new Set();return {textContent:text,colSpan:1,dataset:{},attrs:{},inert:false,visible:true,children:[],classList:{add:x=>classes.add(x),remove:x=>classes.delete(x),toggle:(x,v)=>v?classes.add(x):classes.delete(x),contains:x=>classes.has(x)},setAttribute(k,v){this.attrs[k]=v;},removeAttribute(k){delete this.attrs[k];},querySelector:()=>interactive?{}:null,closest(){return null;},getClientRects(){return this.visible?[{}]:[];}};
}
test('mobile: mesma tabela e valores, rótulos por coluna, controles sem duplicação',()=>{
 const headers=['Produto','Qtd.','Recebido','Lucro',''].map(x=>element(x));
 const cells=[element('<Produto>'),element('2'),element('R$ 42,00'),element('Pendente'),element('Editar',true)];
 const row={cells,setAttribute:element().setAttribute,attrs:{}},body={rows:[row],setAttribute:element().setAttribute,attrs:{}},table=element();
 table.tHead={rows:[{cells:headers,attrs:{},setAttribute:element().setAttribute}],attrs:{},setAttribute:element().setAttribute};table.tBodies=[body];
 const scope={querySelectorAll:()=>[table]};enhanceMobileTables(scope);enhanceMobileTables(scope);
 assert.equal(row.cells.length,5);assert.equal(cells[0].textContent,'<Produto>');assert.equal(cells[3].dataset.label,'Lucro');assert.equal(cells[4].dataset.label,'Ações');assert.equal(cells[2].textContent,'R$ 42,00');
 assert.equal(cells[0].classList.contains('mobile-record-wide'),true);assert.equal(cells[4].classList.contains('mobile-record-wide'),true);assert.equal(cells[2].classList.contains('mobile-record-wide'),false);assert.equal(table.attrs.role,'table');assert.equal(headers[2].scope,'col');
});
function navHarness() {
 const listeners={},media={matches:true,addEventListener(type,fn){this.change=fn;}},doc={activeElement:null,body:element(),addEventListener(type,fn){listeners[type]=fn;}};
 const toggle=element(),sidebar=element(),main=element(),close=element(),active=element(),last=element(),hidden=element();hidden.visible=false;
 const nodes={'#app-navigation':sidebar,'.main':main,'[data-mobile-menu]':toggle,'#main-content':main,'#app-navigation [aria-current="page"]':active};
 doc.querySelector=selector=>nodes[selector]??null;sidebar.querySelectorAll=()=>[close,active,hidden,last];sidebar.contains=node=>[close,active,last,hidden].includes(node);
 for(const node of [toggle,sidebar,main,close,active,last,hidden])node.focus=()=>doc.activeElement=node;
 const nav=initMobileNavigation(doc,{matchMedia:()=>media});nav.sync();
 const click=selector=>listeners.click({target:{closest:value=>value===selector?{}:null}});
 const key=(value,extra={})=>{let prevented=false;listeners.keydown({key:value,preventDefault(){prevented=true;},...extra});return prevented;};
 return {nav,doc,media,sidebar,main,toggle,close,active,last,click,key,nodes};
}
test('mobile: drawer isolado, Tab circular, Escape restaura foco sem mudar formulário',()=>{
 const x=navHarness();assert.equal(x.sidebar.inert,true);x.click('[data-mobile-menu]');assert.equal(x.sidebar.inert,false);assert.equal(x.main.inert,true);assert.equal(x.sidebar.attrs['aria-modal'],'true');assert.equal(x.doc.activeElement,x.close);
 assert.equal(x.key('Tab',{shiftKey:true}),true);assert.equal(x.doc.activeElement,x.last);x.key('Tab');assert.equal(x.doc.activeElement,x.close);
 x.key('Escape');assert.equal(x.main.inert,false);assert.equal(x.sidebar.inert,true);assert.equal(x.toggle.attrs['aria-expanded'],'false');assert.equal(x.doc.activeElement,x.toggle);
});
test('mobile: diálogo e picker recebem Escape antes do menu; backdrop fecha',()=>{
 const x=navHarness();x.click('[data-mobile-menu]');x.nodes['dialog[open]']={};assert.equal(x.key('Escape'),false);assert.equal(x.main.inert,true);delete x.nodes['dialog[open]'];x.nodes['.select-popover']={};assert.equal(x.key('Escape'),false);delete x.nodes['.select-popover'];x.click('[data-mobile-close]');assert.equal(x.main.inert,false);
});
test('mobile: resize devolve foco visível e não deixa desktop inerte',()=>{
 const x=navHarness();x.click('[data-mobile-menu]');x.close.visible=false;x.media.matches=false;x.media.change();assert.equal(x.doc.activeElement,x.active);assert.equal(x.sidebar.inert,false);assert.equal(x.main.inert,false);assert.equal(x.sidebar.attrs['aria-modal'],undefined);
 x.media.matches=true;x.media.change();assert.equal(x.doc.activeElement,x.toggle);assert.equal(x.sidebar.inert,true);
});
test('mobile: CSS de reflow só em tela, 44px de toque e ações acessíveis',()=>{
 const css=readFileSync(new URL('../public/brand.css',import.meta.url),'utf8'),app=readFileSync(new URL('../public/app.mjs',import.meta.url),'utf8'),server=readFileSync(new URL('../src/server.mjs',import.meta.url),'utf8'),picker=readFileSync(new URL('../public/select-control.mjs',import.meta.url),'utf8');
 assert.match(css,/@media screen and \(max-width: 700px\)/);assert.match(css,/\.table-wrap>\.mobile-records[^}]*min-width: 0/);assert.match(css,/\.sidebar \.nav[^}]*flex-direction: column/);assert.match(css,/min-height: 44px/);assert.match(app,/enhanceMobileTables\(target\)/);assert.match(server,/'\/mobile-ui.mjs'/);assert.match(picker,/event.target.closest\('\.select-mobile-heading'\)\) return/);assert.match(picker,/visualViewport\?\.addEventListener\('resize'/);
 assert.ok(picker.indexOf("event.key === 'Tab' && isOpen")<picker.indexOf("event.target.closest('.select-mobile-heading')"));
 assert.doesNotMatch(css,/transition: transform \.2s ease, visibility/);
 assert.match(app,/<button data-view="sales">Voltar às vendas<\/button>/);
});

test('menu compacto: somente logo, navegação, fechar e sair; aviso de teste permanece fora da lateral',()=>{
 const source=readFileSync(new URL('../public/app.mjs',import.meta.url),'utf8');
 const definition=source.slice(source.indexOf('function sidebarMarkup()'),source.indexOf('function render()'));
 const html=runInNewContext(`${definition};sidebarMarkup()`,{icon:()=>'',navigation:()=>'<button>Produtos</button>'});
 assert.match(html,/gamecell-logo\.png/);assert.match(html,/aria-label="Fechar menu"/);assert.match(html,/aria-label="Navegação principal"/);assert.match(html,/Produtos/);assert.equal((html.match(/data-action="logout"/g)||[]).length,1);
 assert.doesNotMatch(html,/Ambiente de teste|Sistema online|Loja independente|Gestão da loja|SUA OPERAÇÃO|sidebar-bottom[^]*<p>/);
 assert.match(source,/class="version-banner">Ambiente de teste/);
});
test('menu compacto: abre um grupo por vez e não recria os campos da página',()=>{
 const source=readFileSync(new URL('../public/app.mjs',import.meta.url),'utf8');
 const run=(action,registryMenuOpen,expenseMenuOpen)=>{
  const body=source.match(new RegExp(`else if\\(a==='${action}'\\)\\{([^\\r\\n]+)\\}`))[1],queries=[];
  const scope={registryMenuOpen,expenseMenuOpen,navigation:()=>'<nav>Atualizado</nav>',document:{querySelector:selector=>{queries.push(selector);return {focus(){}};}}};
  const result=runInNewContext(`${body};({registryMenuOpen,expenseMenuOpen})`,scope);
  assert.deepEqual(queries,['.nav',`[data-action="${action}"]`]);return result;
 };
 const registry=run('toggle-registry',false,true);assert.equal(registry.registryMenuOpen,true);assert.equal(registry.expenseMenuOpen,false);
 const expenses=run('toggle-expenses',true,false);assert.equal(expenses.registryMenuOpen,false);assert.equal(expenses.expenseMenuOpen,true);
 const closed=run('toggle-expenses',false,true);assert.equal(closed.registryMenuOpen,false);assert.equal(closed.expenseMenuOpen,false);
});
