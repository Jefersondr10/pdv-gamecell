import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';
import {matchesSelectSearch} from '../public/select-control.mjs';
const source=readFileSync(new URL('../public/select-control.mjs',import.meta.url),'utf8');
test('busca produto: nome, SKU, acentos e termos fora de ordem',()=>{
 for(const query of ['','camera','ABC-42','azul camera','  256   abc '])assert.equal(matchesSelectSearch('Câmera Azul 256 GB · ABC-42 · saldo 2',query),true);
 assert.equal(matchesSelectSearch('Câmera Azul · ABC-42','verde'),false);
 const app=readFileSync(new URL('../public/app.mjs',import.meta.url),'utf8'),stock=readFileSync(new URL('../public/stock-ui.mjs',import.meta.url),'utf8');
 assert.match(app,/data-key="product_id" data-search="product"/);assert.match(stock,/name="product_id" data-search="product"/);
 assert.match(app,/p\.sku\?/);assert.match(stock,/p\.sku\?/);
});
function harness(){
 const doc={activeElement:null,querySelectorAll:()=>[],listeners:{},addEventListener(k,fn){(this.listeners[k]??=[]).push(fn);},emit(k,target){for(const fn of this.listeners[k]??[])fn({target});}};
 class Node{
  constructor(tag='div'){this.tagName=tag.toUpperCase();this.attrs={};this.dataset={};this.children=[];this.listeners={};this.style={};this.value='';this.disabled=false;this.isConnected=true;this.textContent='';const classes=new Set();this.classList={add:x=>classes.add(x),remove:x=>classes.delete(x),toggle:(x,v)=>v?classes.add(x):classes.delete(x),contains:x=>classes.has(x)};}
  setAttribute(k,v){this.attrs[k]=String(v);}getAttribute(k){return this.attrs[k]??null;}removeAttribute(k){delete this.attrs[k];}
  append(...nodes){for(const n of nodes){n.parentElement=this;this.children.push(n);}}before(node){this.wrapper=node;}remove(){this.isConnected=false;}
  replaceChildren(...nodes){this.children=[];this.append(...nodes);}insertAdjacentHTML(){}
  addEventListener(k,f){(this.listeners[k]??=[]).push(f);}emit(k,extra={}){for(const f of this.listeners[k]??[])f({target:this,preventDefault(){},stopPropagation(){},...extra});}
  dispatchEvent(e){this.events??=[];this.events.push(e.type);this.emit(e.type);}
  focus(){doc.activeElement=this;doc.emit('focusin',this);}select(){this.selectedText=true;}closest(){return null;}querySelectorAll(){return [];}scrollIntoView(){}
  contains(node){return node===this||this.children.some(child=>child.contains(node));}
  getBoundingClientRect(){return {left:12,top:100,bottom:144,width:290};}showPopover(){this.open=true;}hidePopover(){this.open=false;}matches(){return !!this.open;}
 }
 doc.createElement=tag=>new Node(tag);doc.body=new Node('body');
 const native=new Node('select');native.dataset.search='product';native.setAttribute('aria-label','Buscar produto');
 native.options=[['','Produto avulso'],['p1','Câmera azul · SKU-42 · saldo 2'],['p2','Cabo USB · CABO-01 · saldo 0']].map(([value,text])=>{const n=new Node('option');n.value=value;n.textContent=text;n.parentElement=native;Object.defineProperty(n,'selected',{get:()=>native.value===n.value});return n;});
 Object.defineProperty(native,'selectedOptions',{get:()=>native.options.filter(n=>n.selected)});
 const ctx={document:doc,window:{addEventListener(){},visualViewport:{width:390,height:430,offsetLeft:0,offsetTop:0,addEventListener(){}}},MutationObserver:class{observe(){}},innerWidth:390,innerHeight:844,Event:class{constructor(type){this.type=type;}},setTimeout,clearTimeout,native};
 runInNewContext(source.replaceAll('export ', '')+'\nenhance(native);initSelectControls();function inspect(){return controls.get(native);}',ctx);
 return {native,control:ctx.inspect(),doc};
}
test('busca produto: barra editável com poucos produtos, filtra sem selecionar automaticamente',()=>{
 const x=harness();assert.equal(x.control.trigger.tagName,'INPUT');assert.equal(x.control.trigger.type,'search');assert.equal(x.control.trigger.placeholder,'Buscar por nome ou código');
 x.control.trigger.value='sku-42';x.control.trigger.emit('input');assert.equal(x.native.value,'');assert.equal(x.control.options.length,1);assert.equal(x.control.options[0].option.value,'p1');
 assert.equal(x.control.search,x.control.trigger);assert.ok(Number.parseFloat(x.control.popup.style.maxHeight)<=280);
 x.control.options[0].button.emit('click');assert.equal(x.native.value,'p1');assert.deepEqual(x.native.events,['input','change']);assert.match(x.control.trigger.value,/SKU-42/);
});
test('busca produto: Escape e busca sem resultado mantêm seleção e campos nativos',()=>{
 const x=harness();x.control.trigger.value='cabo';x.control.trigger.emit('input');x.control.options[0].button.emit('click');
 x.control.trigger.value='inexistente';x.control.trigger.emit('input');assert.equal(x.control.options.length,0);assert.equal(x.native.value,'p2');
 assert.match(x.control.list.children[0].textContent,/Nenhum produto encontrado/);x.control.trigger.emit('keydown',{key:'Escape'});
 assert.equal(x.control.popup,null);assert.equal(x.native.value,'p2');assert.match(x.control.trigger.value,/CABO-01/);
});
test('busca produto: digitação de espaço não escolhe opção; Enter e avulso preservam contrato',()=>{
 const x=harness();x.control.trigger.value='camera azul';x.control.trigger.emit('input');x.control.trigger.emit('keydown',{key:' '});assert.equal(x.native.value,'');
 x.control.trigger.emit('keydown',{key:'Enter'});assert.equal(x.native.value,'p1');
 x.control.trigger.value='avulso';x.control.trigger.emit('input');x.control.trigger.emit('keydown',{key:'Enter'});assert.equal(x.native.value,'');assert.equal(x.control.trigger.value,'');
});
test('busca produto: próximo campo do teclado móvel fecha busca sem trocar seleção',()=>{
 const x=harness();x.control.trigger.value='cabo';x.control.trigger.emit('input');x.control.options[0].button.emit('click');
 const events=x.native.events.length;x.control.trigger.value='outra pesquisa';x.control.trigger.emit('input');
 x.doc.createElement('input').focus();assert.equal(x.control.popup,null);assert.equal(x.native.value,'p2');assert.match(x.control.trigger.value,/CABO-01/);assert.equal(x.native.events.length,events);
});
