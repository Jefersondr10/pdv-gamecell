import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Store } from '../src/store.mjs';
import { publicSale } from '../src/domain.mjs';
import { renderReceipt } from '../public/receipt-view.mjs';

function setup(t,file) {
 const db=new Store(file);t.after(()=>{try{db.close();}catch(e){if(e.code!=='ERR_INVALID_STATE')throw e;}});
 const actor=db.actor(db.register({name:'Teste',store_name:'Itens teste',email:'items@example.test',password:'senha-ficticia-de-teste'}).token);
 const product=db.addProduct(actor,{name:'Aparelho',price_cents:10000}),customer=db.addCustomer(actor,{name:'Cliente'});
 return {db,actor,product,customer};
}
const plain=(extra={})=>({description:'Avulso',quantity:1,unit_price_cents:10000,manual_cost_cents:4000,...extra});
const save=(x,items)=>x.db.saveDraft(x.actor,{items,customer_id:x.customer.id,seller_id:x.actor.id}).id;
const payload=items=>items.map(({id,product_id,description,quantity,unit_price_cents})=>({id,product_id,description,quantity,unit_price_cents}));

test('identificação: trocar produto não herda IMEI ou divulgação do aparelho anterior',t=>{
 const x=setup(t),p2=x.db.addProduct(x.actor,{name:'Outro aparelho',price_cents:10000});
 const id=save(x,[plain({product_id:x.product.id,serial_number:'ANTIGO',details:'Preto',share_details:true})]);
 let item=x.db.sale(x.actor,id).items[0];
 x.db.saveDraft(x.actor,{items:[{...payload([item])[0],product_id:p2.id}]},id);item=x.db.sale(x.actor,id).items[0];
 assert.equal(item.serial_number,'');assert.equal(item.details,'');assert.equal(item.share_details,false);
 x.db.saveDraft(x.actor,{items:[{...payload([item])[0],serial_number:'NOVO',share_details:true}]},id);item=x.db.sale(x.actor,id).items[0];
 x.db.saveDraft(x.actor,{items:[{...payload([item])[0],product_id:null,description:'Avulso'}]},id);
 assert.equal(x.db.sale(x.actor,id).items[0].serial_number,'');assert.equal(x.db.sale(x.actor,id).items[0].share_details,false);
});

test('identificação: catálogo e avulso guardam texto sem afetar custo ou estoque',t=>{
 const x=setup(t);x.db.receive(x.actor,{product_id:x.product.id,quantity:2,unit_cost_cents:5000});
 const id=save(x,[plain({product_id:x.product.id,serial_number:'001234567890123',details:'Azul 128 GB'}),plain({serial_number:'SN-A001\nSN-A002',quantity:2})]);
 const draft=x.db.sale(x.actor,id);assert.equal(draft.items[0].serial_number,'001234567890123');assert.equal(draft.items[1].serial_number,'SN-A001\nSN-A002');
 assert.equal(draft.items[0].share_details,false);assert.equal(x.db.snapshot(x.actor).products[0].stock,2);
 x.db.confirm(x.actor,id,true);const sale=x.db.sale(x.actor,id);
 assert.equal(sale.known_cost_cents,13000);assert.equal(x.db.snapshot(x.actor).products[0].stock,1);assert.equal(sale.items[0].details,'Azul 128 GB');
 assert.throws(()=>x.db.saveDraft(x.actor,{items:[]},id),/confirmada/);
});
test('identificação: editar preserva omitidos, reordena e limpa valores explicitamente',t=>{
 const x=setup(t),id=save(x,[plain({serial_number:'SN1',details:'Primeiro',share_details:true}),plain({serial_number:'SN2'})]);
 let sale=x.db.sale(x.actor,id);const items=payload(sale.items).reverse();
 x.db.saveDraft(x.actor,{items},id);sale=x.db.sale(x.actor,id);
 assert.deepEqual(sale.items.map(i=>i.serial_number),['SN2','SN1']);assert.equal(sale.items[1].share_details,true);
 x.db.saveDraft(x.actor,{items:[{...payload(sale.items)[1],serial_number:null,details:'',share_details:false}]},id);
 assert.equal(x.db.sale(x.actor,id).items[0].serial_number,'');assert.equal(x.db.get('SELECT COUNT(*) n FROM sale_item_details').n,0);
});
test('identificação: privacidade padrão e inclusão explícita no pedido, sempre escapada',t=>{
 const x=setup(t),id=save(x,[plain({serial_number:'INTERNO-01',details:'Segredo'}),plain({serial_number:'<SN & 02>',details:'<script>alert(1)</script>',share_details:true})]);
 const publicData=publicSale(x.db.fullSale(x.actor,id)),json=JSON.stringify(publicData),html=renderReceipt(publicData);
 assert.doesNotMatch(json,/INTERNO|Segredo|manual_cost|share_details/);assert.equal(publicData.items[1].serial_number,'<SN & 02>');
 assert.match(html,/&lt;SN &amp; 02&gt;/);assert.match(html,/&lt;script&gt;/);assert.doesNotMatch(html,/<script>|INTERNO/);
});
test('identificação: limites, tipos, IDs repetidos e dados de outra venda são rejeitados atomicamente',t=>{
 const x=setup(t),id=save(x,[plain({serial_number:'PRESERVADO'})]),item=x.db.sale(x.actor,id).items[0];
 for(const extra of [{serial_number:123},{details:{}},{serial_number:'a'.repeat(1001)},{details:'a'.repeat(2001)},{share_details:'true'}])assert.throws(()=>x.db.saveDraft(x.actor,{items:[{...plain({id:item.id}),...extra}]},id));
 assert.throws(()=>x.db.saveDraft(x.actor,{items:[plain({id:item.id}),plain({id:item.id})]},id),/repita/);
 const second=save(x,[plain()]);assert.throws(()=>x.db.saveDraft(x.actor,{items:[plain({id:item.id})]},second),/nesta venda/);
 assert.equal(x.db.sale(x.actor,id).items[0].serial_number,'PRESERVADO');
});
test('identificação: permissões de venda não dependem de consultar ou informar custo',t=>{
 const x=setup(t),id=save(x,[plain({serial_number:'SN-01'})]),item=x.db.sale(x.actor,id).items[0],restricted={...x.actor,is_owner:false,permissions:['sales.edit_draft']};
 x.db.saveDraft(restricted,{items:[{...payload([item])[0],details:'Conferido'}]},id);
 const visible=x.db.sale(restricted,id);assert.equal(visible.items[0].details,'Conferido');assert.equal(visible.items[0].manual_cost_cents,undefined);
 const other=x.db.actor(x.db.register({name:'Outra',store_name:'Outra',email:'other-items@example.test',password:'senha-ficticia-de-teste'}).token);
 assert.throws(()=>x.db.sale(other,id),/não encontrado/);assert.throws(()=>x.db.run('INSERT INTO sale_item_details VALUES(?,?,?,?,?)',other.tenant_id,item.id,'X','',0),/FOREIGN KEY/);
});
test('identificação: migração aditiva preserva linhas antigas e persiste após reabertura',t=>{
 const folder=mkdtempSync(join(tmpdir(),'pdv-item-details-'));
 const file=join(folder,'db.sqlite'),x=setup(t,file),id=save(x,[plain()]),before=x.db.all('SELECT * FROM sale_items');
 x.db.db.exec('DROP TABLE sale_item_details');x.db.close();
 const db=new Store(file);t.after(()=>{try{db.close();}catch(e){if(e.code!=='ERR_INVALID_STATE')throw e;}});assert.deepEqual(db.all('SELECT * FROM sale_items'),before);
 const item=db.sale(x.actor,id).items[0];db.saveDraft(x.actor,{items:[{...payload([item])[0],serial_number:'SN-PERSISTE'}]},id);db.close();
 const again=new Store(file);t.after(()=>{try{again.close();}catch(e){if(e.code!=='ERR_INVALID_STATE')throw e;}});assert.equal(again.sale(x.actor,id).items[0].serial_number,'SN-PERSISTE');assert.deepEqual(again.all('PRAGMA foreign_key_check'),[]);
 again.close();rmSync(folder,{recursive:true,force:true});
});
