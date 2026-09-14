import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { syncSaleMobileHeader } from '../public/mobile-ui.mjs';

const source=readFileSync(new URL('../public/mobile-ui.mjs',import.meta.url),'utf8');
const flow=source.slice(source.indexOf('export function saleMobileSteps('),source.indexOf('export function stockMobileSteps('));
const compact=source.slice(source.indexOf('export function compactMobilePage('),source.indexOf("import { dateValue }"));

test('cartão compacto de venda não passa pelo reflow legado de tabelas',()=>{
 const guard=compact.indexOf("if(record.matches('.sale-record-compact'))continue");
 const table=compact.indexOf("record.querySelector('.table-wrap')");
 assert.ok(guard>=0&&guard<table);
 assert.match(compact,/const table=record\.querySelector\('\.table-wrap'\);if\(!table\)continue/);
});

test('editor móvel mantém cliente somente na etapa de dados da venda',()=>{
 assert.doesNotMatch(flow,/flow-customer|append\(customerButton\)|customerSlot/);
 assert.doesNotMatch(flow,/querySelector\('\[data-action="modal-customer"\]'\)/);
 assert.match(flow,/const people=panels\.shift\(\);add\('people','Dados da venda',people\)/);
});

test('editor móvel mantém IMEI, detalhes e custos dentro do próprio produto',()=>{
 assert.match(flow,/body\.append\(item\);add\('item-'\+n,`Produto/);
 assert.doesNotMatch(flow,/add\('item-details-|identification\.hidden=false|item-details-toggle'\)\?\.remove/);
 assert.doesNotMatch(flow,/querySelector\('\.item-entry-costs'\)/);
 // O item inteiro é movido uma única vez, portanto seus controles opcionais e
 // custos continuam irmãos do produto e não são duplicados no assistente.
 assert.equal((flow.match(/body\.append\(item\)/g)||[]).length,1);
});

test('cancelamento do cabeçalho aparece apenas no primeiro passo',()=>{
 const cancel={hidden:null};
 const document={querySelector:selector=>{
  assert.equal(selector,'.sale-editor-heading-actions [data-action="cancel-sale"]');
  return cancel;
 }};
 const root={ownerDocument:document};
 syncSaleMobileHeader(root,'people');assert.equal(cancel.hidden,false);
 for(const key of ['item-0','payments','notes','summary']){
  syncSaleMobileHeader(root,key);assert.equal(cancel.hidden,true);
 }
 assert.doesNotThrow(()=>syncSaleMobileHeader({ownerDocument:{querySelector:()=>null}},'people'));
});

test('Voltar do rodapé continua navegando somente uma etapa',()=>{
 const setupSource=source.slice(source.indexOf('function setup('),source.indexOf('export function syncSaleMobileHeader('));
 assert.match(setupSource,/back\.hidden=index===0/);
 assert.match(setupSource,/back\.addEventListener\('click',\(\)=>show\(index-1\)\)/);
 assert.match(setupSource,/footer\.append\(back,skip,next\)/);
});
