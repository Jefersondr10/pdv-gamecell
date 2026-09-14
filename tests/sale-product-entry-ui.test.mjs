import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';
const source=readFileSync(new URL('../public/app.mjs',import.meta.url),'utf8');
const helpers=source.slice(source.indexOf('function moneyInput('),source.indexOf('function renderEditor()'));
const esc=s=>String(s??'').replaceAll('<','&lt;').replaceAll('"','&quot;');
function setup({fail=false,allowed=true}={}) {
 const item={description:'Controle',quantity:2,price:'199,90',cost:'90',unit_ids:[]},work={items:[item],payments:[{amount:'20,00'}],step:'item-0'},calls=[];
 const ctx={working:work,workingDirty:false,productCreateContext:{work,item,owner:'u'},state:{user:{id:'u'},products:[]},view:'editor',can:()=>allowed,
  trackedItem:()=>false,esc,icon:()=>'',option:()=>'',serialSaleField:()=>'',entryCostsFields:()=>'',itemDetailsFields:()=>'',value:n=>(n/100).toFixed(2).replace('.',','),cents:s=>Math.round(Number(s.replace(',','.'))*100),
  FormData:class{has(){return false;}},api:async(path,data)=>{calls.push({path,data});if(fail)throw Error('Falha');return {id:'new',name:data.name,price_cents:data.price_cents,sku:data.sku,serial_tracked:false};},
  modal:{close:()=>calls.push('close')},render:()=>calls.push('render'),toast:m=>calls.push(m)};
 runInNewContext(helpers,ctx);return {ctx,item,work,calls};
}
test('produto na venda: cadastrar seleciona retorno e mantém etapa, quantidade e pagamento',async()=>{
 const x=setup();await x.ctx.saveProductForm({name:'Controle',sku:'PS4',price:'199,90'},{dataset:{id:''}});
 assert.equal(x.ctx.working,x.work);assert.equal(x.item.product_id,'new');assert.equal(x.item.quantity,2);assert.equal(x.work.step,'item-0');assert.equal(x.work.payments[0].amount,'20,00');
 assert.equal(x.ctx.state.products[0].stock,0);assert.equal(x.calls[0].data.price_cents,19990);assert.equal(x.ctx.workingDirty,true);
});
test('produto na venda: falha mantém formulário e pedido; retorno tardio não troca outra venda',async()=>{
 const x=setup({fail:true}),before=structuredClone(x.item);
 await assert.rejects(x.ctx.saveProductForm({name:'Controle',sku:'',price:'199,90'},{dataset:{}}),/Falha/);
 assert.deepEqual(x.item,before);assert.equal(x.calls.length,1);
 const y=setup();y.ctx.working={items:[],step:'people'};await y.ctx.saveProductForm({name:'Controle',price:'199,90'},{dataset:{}});
 assert.equal(y.item.product_id,undefined);assert.equal(y.ctx.working.items.length,0);
});
test('tela da venda: produto é único, avulso é explícito e detalhes ficam na mesma etapa',()=>{
 const x=setup(),html=x.ctx.saleItemMarkup(x.item,0);
 assert.match(html,/Produto desta venda/);assert.match(source,/Produto avulso — sem cadastro/);assert.match(html,/Nome do produto avulso/);assert.doesNotMatch(html,/Nome neste pedido/);
 const catalogHtml=x.ctx.saleItemMarkup({...x.item,product_id:'catalogo'},0);
 assert.doesNotMatch(catalogHtml,/Nome do produto avulso|Nome exibido no pedido|Nome neste pedido/);
 assert.doesNotMatch(html,/Cadastrar novo produto|create-sale-product/);
 assert.match(html,/item-values/);assert.match(html,/aria-hidden="true">R\$/);assert.match(html,/value="199,90"/);assert.doesNotMatch(html,/value="R\$/);
 assert.doesNotMatch(setup({allowed:false}).ctx.saleItemMarkup(x.item,0),/data-action="create-sale-product"/);
 assert.match(source,/\$\{entryCostsFields\(i,n\)\}\$\{itemDetailsFields\(i,n\)\}/);
 const detailsSource=source.slice(source.indexOf('function itemDetailsFields('),source.indexOf('function editorSaleDate('));
 assert.match(detailsSource,/IMEI ou número de série \(SN\)/);assert.doesNotMatch(detailsSource,/Nome exibido no pedido|Nome neste pedido/);
 assert.match(source,/Adicionar outro produto/);
 const mobile=readFileSync(new URL('../public/mobile-ui.mjs',import.meta.url),'utf8');
 assert.match(mobile,/body\.append\(item\);add\('item-'\+n/);
 assert.match(mobile,/body\.append\(n===items.length-1\?addItem:addItem\.cloneNode\(true\)\)/);
 assert.doesNotMatch(mobile,/add\('item-details-'/);assert.doesNotMatch(mobile,/customerSlot/);
});
