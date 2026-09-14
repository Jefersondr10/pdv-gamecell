import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';
import {matchesSelectSearch} from '../public/select-control.mjs';
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
test('busca de cliente encontra o nome digitado sem depender de acentos',()=>{
 assert.equal(matchesSelectSearch('João da Silva','joao silva'),true);
 assert.equal(matchesSelectSearch('Maria Oliveira','joao'),false);
 const picker=readFileSync(new URL('../public/select-control.mjs',import.meta.url),'utf8');
 assert.match(picker,/\['product','customer'\]\.includes\(select\.dataset\.search\)/);
 assert.match(picker,/Buscar cliente pelo nome/);
});
test('cliente na venda: seleção pesquisável e novo cadastro continuam disponíveis na edição confirmada',()=>{
 const x=harness(),html=x.ctx.editorCustomerField(x.working);assert.equal((html.match(/data-action="modal-customer"/g)||[]).length,1);
 assert.match(html,/customer-field-heading/);assert.match(html,/type="button"/);assert.match(html,/for="sale-customer"/);assert.match(html,/\+ Novo cliente/);
 assert.match(html,/data-search="customer"/);assert.match(html,/aria-label="Buscar e alterar cliente"/);assert.doesNotMatch(html,/change-sale-customer/);
 x.working.status='confirmed';const confirmed=x.ctx.editorCustomerField(x.working);
 assert.match(confirmed,/data-action="modal-customer"/);assert.match(confirmed,/\+ Novo cliente/);assert.match(confirmed,/data-search="customer"/);
 assert.doesNotMatch(confirmed,/change-sale-customer|>Alterar cliente</);
 const denied=harness({allowed:false}),deniedHtml=denied.ctx.editorCustomerField(denied.working);
 assert.doesNotMatch(deniedHtml,/modal-customer|Novo cliente/);assert.match(deniedHtml,/data-search="customer"/);
 const mobile=readFileSync(new URL('../public/mobile-ui.mjs',import.meta.url),'utf8');
 assert.match(mobile,/add\('people','Dados da venda',people\)/);assert.doesNotMatch(mobile,/customerSlot/);
 assert.match(mobile,/onStep\(steps\[index\]\.key\)/);assert.match(mobile,/syncSaleMobileHeader\(root,key\)/);
 assert.match(mobile,/cancelButton\.hidden=key!=='people'/);
});
test('cliente no cadastro comum: não muda rascunho fora da venda nem duplica o retorno',async()=>{
 const x=harness({view:'customers'});await x.ctx.saveCustomerForm({name:'Novo cliente'});await x.ctx.saveCustomerForm({name:'Novo cliente'});
 assert.equal(x.working.customer_id,'old');assert.equal(x.ctx.state.customers.length,2);assert.equal(x.ctx.workingDirty,false);
});
