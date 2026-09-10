import test from 'node:test';
import assert from 'node:assert/strict';
import {matchesStockProduct} from '../public/stock-ui.mjs';

test('busca no estoque: nome, SKU, acentos e vários termos sem alterar cadastro',()=>{
 const product=Object.freeze({name:'Câmera de Ação',sku:'CAM-001',stock:-2,fifo_cost_cents:null});
 for(const query of ['camera','AÇÃO','cam-001',' câmera   001 ','','   '])assert.equal(matchesStockProduct(product,query),true,query);
 for(const query of ['celular','CAM-002','camera telefone','<script>'])assert.equal(matchesStockProduct(product,query),false,query);
 assert.equal(product.stock,-2);assert.equal(product.fifo_cost_cents,null);
});
test('busca no estoque: cadastro sem SKU e consulta sem resultados',()=>{
 const products=Object.freeze([Object.freeze({name:'Cabo USB'}),Object.freeze({name:'Smartphone',sku:'TESTE-001'})]);
 assert.equal(products.filter(p=>matchesStockProduct(p,'usb')).length,1);
 assert.equal(products.filter(p=>matchesStockProduct(p,'ausente')).length,0);
 assert.equal(products.filter(p=>matchesStockProduct(p,'')).length,2);
 assert.equal(products.length,2);assert.equal(matchesStockProduct({},'x'),false);
});
