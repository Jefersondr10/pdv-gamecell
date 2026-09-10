import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {validateSaleStep} from '../public/mobile-ui.mjs';
const cents=v=>{if(!/^\d*(?:,\d{1,2})?$/.test(String(v)))throw Error('Valor inválido');return Math.round(Number(String(v).replace(',','.'))*100);};
const draft=()=>({customer_id:'c',seller_id:'s',items:[{product_id:'p',description:'',quantity:1,price:'0,00',cost:''}],payments:[],expenses:[]});
test('etapas: preço zero e nome do catálogo continuam válidos; avulso precisa de nome',()=>{
 const w=draft();assert.doesNotThrow(()=>validateSaleStep('item-0',w,cents));
 w.items[0].product_id=null;assert.throws(()=>validateSaleStep('item-0',w,cents),/nome/);
 w.items[0].description='Brinde';assert.doesNotThrow(()=>validateSaleStep('item-0',w,cents));
 for(const quantity of [0,-1,1.5,'abc']){w.items[0].quantity=quantity;assert.throws(()=>validateSaleStep('item-0',w,cents),/quantidade/);}
});
test('etapas: dados comerciais e produto obrigatórios para avançar, resumo permite rascunho',()=>{
 const w=draft();w.customer_id='';w.items=[];
 assert.throws(()=>validateSaleStep('people',w,cents),/cliente/);assert.throws(()=>validateSaleStep('products',w,cents),/produto/);
 assert.doesNotThrow(()=>validateSaleStep('summary',w,cents));
});
test('etapas opcionais não limpam identificação, observação, frete nem pagamentos',()=>{
 const w={...draft(),public_notes:'Observação',freight:'10',payments:[],items:[{...draft().items[0],serial_number:'SN-123',share_details:false}]},before=structuredClone(w);
 for(const key of ['item-details-0','payments','expenses','notes'])validateSaleStep(key,w,cents);
 assert.deepEqual(w,before);
});
test('etapas de pagamento mantêm Pix legado, taxa fotografada e rejeitam linha nova incompleta',()=>{
 const w=draft();w.payments=[{method:'pix',amount:'10',saved:true,original_method:'pix'}];assert.doesNotThrow(()=>validateSaleStep('payment-0',w,cents));
 w.payments[0].saved=false;assert.throws(()=>validateSaleStep('payment-0',w,cents),/Pix/);
 w.payments[0]={method:'card',amount:'10',saved:true,keep_card_rate:true};assert.doesNotThrow(()=>validateSaleStep('payment-0',w,cents));
 w.payments[0].saved=false;w.payments[0].keep_card_rate=false;assert.throws(()=>validateSaleStep('payment-0',w,cents),/máquina/);
 w.payments[0].rate_id='r';assert.doesNotThrow(()=>validateSaleStep('payment-0',w,cents));w.payments[0].amount='0';assert.throws(()=>validateSaleStep('payment-0',w,cents),/valor pago/);
});
test('etapas de despesas não deixam linha vazia avançar silenciosamente',()=>{
 const w=draft();w.expenses=[{description:'',amount:'0'}];assert.throws(()=>validateSaleStep('expense-0',w,cents),/descrição/);
 w.expenses[0]={description:'Entrega',amount:'12,50'};assert.doesNotThrow(()=>validateSaleStep('expense-0',w,cents));
});
test('compactação usa registros existentes e navegação não faz gravações',()=>{
 const ui=readFileSync(new URL('../public/mobile-ui.mjs',import.meta.url),'utf8'),app=readFileSync(new URL('../public/app.mjs',import.meta.url),'utf8');
 assert.doesNotMatch(ui,/fetch\(|api\(|localStorage|sessionStorage|saveWorking\(/);
 assert.match(ui,/form\.noValidate=true/);assert.match(ui,/for\(const step of steps\)if\(!flow\.check\(step\)\)/);
 assert.match(ui,/td\[colspan\]/);assert.match(ui,/--status-color/);assert.match(ui,/expandedSales/);
 assert.match(app,/target\.dataset\.screen=view/);assert.doesNotMatch(app,/target\.dataset\.view=view/);
 assert.match(app,/working\.step='item-'\+index;render\(\)/);
});
