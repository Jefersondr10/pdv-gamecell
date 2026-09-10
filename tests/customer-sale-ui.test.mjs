import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';
const app=readFileSync(new URL('../public/app.mjs',import.meta.url),'utf8');
const source=app.slice(app.indexOf('function editorCustomerField('),app.indexOf('function renderEditor('));
function harness({allowed=true,fail=false,view='editor'}={}){
 const items=[{description:'Produto',quantity:2,serial_number:'SN-001'}],payments=[{amount:'30,00'}],calls=[];
 const working={customer_id:'old',items,payments,step:'payment-0'},customer={id:'new',name:'Novo cliente',cpf:'',email:'',phone:''};
 const ctx={state:{customers:[{id:'old',name:'Anterior'}]},working,workingDirty:false,view,
  can:()=>allowed,option:(id,name,selected)=>`<option value="${id}" ${id===selected?'selected':''}>${name}</option>`,
  api:async(path,data)=>{calls.push({path,data});if(fail)throw Error('Falha de cadastro');return customer;},
  modal:{close:()=>calls.push('close')},render:()=>calls.push('render'),toast:text=>calls.push(text),
  load:()=>{throw Error('Cadastro não deve depender da recarga financeira');}
 };
 runInNewContext(source,ctx);return {ctx,calls,items,payments,working,customer};
}
test('cliente na venda: somente nome, seleciona retorno e mantém etapa, produtos e pagamentos',async()=>{
 const x=harness();await x.ctx.saveCustomerForm({name:'Novo cliente'});
 assert.equal(x.ctx.working,x.working);assert.equal(x.working.items,x.items);assert.equal(x.working.payments,x.payments);assert.equal(x.working.step,'payment-0');
 assert.equal(x.working.customer_id,'new');assert.equal(x.ctx.workingDirty,true);assert.ok(x.ctx.state.customers.includes(x.customer));
 assert.deepEqual(x.calls.slice(0,3),[{path:'/customers',data:{name:'Novo cliente'}},'close','render']);assert.match(x.calls.at(-1),/selecionado nesta venda/);
});
test('cliente na venda: erro não fecha o formulário nem altera a venda',async()=>{
 const x=harness({fail:true});await assert.rejects(x.ctx.saveCustomerForm({name:'Teste'}),/Falha/);
 assert.equal(x.working.customer_id,'old');assert.equal(x.ctx.workingDirty,false);assert.equal(x.calls.length,1);assert.equal(x.ctx.state.customers.length,1);
});
test('cliente na venda: botão único junto ao campo e permissão preservada',()=>{
 const x=harness(),html=x.ctx.editorCustomerField(x.working);assert.equal((html.match(/data-action="modal-customer"/g)||[]).length,1);
 assert.match(html,/customer-field-heading/);assert.match(html,/type="button"/);assert.match(html,/for="sale-customer"/);
 const denied=harness({allowed:false});assert.doesNotMatch(denied.ctx.editorCustomerField(denied.working),/modal-customer/);
 const mobile=readFileSync(new URL('../public/mobile-ui.mjs',import.meta.url),'utf8');assert.match(mobile,/key==='people'\?customerSlot:root.querySelector\('\.flow-heading'\)/);assert.match(mobile,/onStep\(steps\[index\]\.key\)/);
});
test('cliente no cadastro comum: não muda rascunho fora da venda nem duplica o retorno',async()=>{
 const x=harness({view:'customers'});await x.ctx.saveCustomerForm({name:'Novo cliente'});await x.ctx.saveCustomerForm({name:'Novo cliente'});
 assert.equal(x.working.customer_id,'old');assert.equal(x.ctx.state.customers.length,2);assert.equal(x.ctx.workingDirty,false);
});
