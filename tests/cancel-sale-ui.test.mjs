import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';
import {cancelSaleButton} from '../public/sales-view.mjs';

const app=readFileSync(new URL('../public/app.mjs',import.meta.url),'utf8');
const esc=x=>String(x).replaceAll('"','&quot;').replaceAll('<','&lt;');
test('cancelar: botão no cabeçalho da edição, só para registros salvos e autorizados',()=>{
 const editor=app.slice(app.indexOf('function renderEditor()'),app.indexOf('function updateSummary()'));
 assert.match(editor.split('<div class="sale-editor">')[0],/cancelSaleButton\(w,\{esc,can\}\)/);
 for(const status of ['confirmed','draft'])assert.match(cancelSaleButton({id:'x',status},{esc,can:()=>true}),/type="button".*data-action="cancel-sale"/);
 for(const sale of [{status:'draft'},{id:'x',status:'cancelled'},{id:'x',status:'unknown'}])assert.equal(cancelSaleButton(sale,{esc,can:()=>true}),'');
 assert.equal(cancelSaleButton({id:'x',status:'confirmed'},{esc,can:()=>false}),'');
});

function context({dirty=true,postError,loadError,unsavedAck=true}={}){
 const draft={id:'test-sale',is_wholesale:true,public_notes:'Edição ainda não salva'};
 const calls=[],checks=new Set(['acknowledge_stock_return','acknowledge_refund_pending']);if(unsavedAck)checks.add('acknowledge_unsaved_changes');
 const ctx={working:draft,workingDirty:dirty,view:'editor',detailSale:{id:'antigo'},detailId:null,state:{},calls,
  FormData:class{has(key){return checks.has(key);}},
  api:async(path,data)=>{calls.push(['post',path,data]);if(postError)throw Error(postError);},
  modal:{close(){calls.push(['close']);}},
  page:html=>calls.push(['page',html]),heading:(title,text)=>title+' '+text,
  cancellationRefreshPending:false,showCancellationRefresh:()=>calls.push(['page','O cancelamento foi registrado. Atualize os dados para continuar.']),
  load:async()=>{calls.push(['load']);if(loadError)throw Error(loadError);},render:()=>calls.push(['render']),toast:text=>calls.push(['toast',text])
 };
 runInNewContext(app.slice(app.indexOf('async function submitSaleCancellation('),app.indexOf('async function openCancelSale(')),ctx);
 const form={dataset:{id:'test-sale',unsaved:String(dirty)}};
 return {ctx,draft,calls,run:()=>ctx.submitSaleCancellation(form,{request_id:'uuid-test',edit_token:'token-test',reason:'Teste fictício'})};
}
test('cancelar: erro no servidor preserva edição, motivo e confirmações',async()=>{
 const {ctx,draft,calls,run}=context({postError:'Venda mudou'});await assert.rejects(run(),/Venda mudou/);
 assert.equal(ctx.working,draft);assert.equal(ctx.workingDirty,true);assert.equal(ctx.view,'editor');assert.equal(calls.length,1);
 assert.equal(calls[0][2].acknowledge_stock_return,true);assert.equal(calls[0][2].acknowledge_refund_pending,true);assert.equal(calls[0][2].reason,'Teste fictício');
 assert.equal(calls[0][2].public_notes,undefined);
});
test('cancelar: alterações não salvas exigem ciência sem gravar a edição',async()=>{
 const {ctx,draft,calls,run}=context({unsavedAck:false});await assert.rejects(run(),/alterações não salvas/);
 assert.equal(calls.length,0);assert.equal(ctx.working,draft);assert.equal(ctx.workingDirty,true);
 const source=app.slice(app.indexOf('async function openCancelSale('),app.indexOf('\nfunction ',app.indexOf('async function openCancelSale(')));
 assert.match(source,/view==='editor'&&working\?\.id===key&&workingDirty/);
 assert.match(source,/name="acknowledge_unsaved_changes" required/);
 assert.doesNotMatch(source,/working\s*=|workingDirty\s*=/);
});
test('cancelar: sucesso sai do editor e busca o detalhe cancelado sem salvar alterações',async()=>{
 const {ctx,calls,run}=context();await run();
 assert.equal(ctx.working,null);assert.equal(ctx.workingDirty,false);assert.equal(ctx.view,'detail');assert.equal(ctx.detailId,'test-sale');assert.equal(ctx.detailSale,null);
 assert.deepEqual(calls.map(c=>c[0]),['post','close','page','load','render','toast']);
 assert.equal(calls.filter(c=>c[0]==='post').length,1);assert.equal(calls[0][1],'/sales/test-sale/cancel');
});
test('cancelar: falha de atualização após sucesso não reapresenta editor cancelado',async()=>{
 const {ctx,calls,run}=context({loadError:'Falha de conexão'});await assert.rejects(run(),/conexão/);
 assert.equal(ctx.working,null);assert.equal(ctx.workingDirty,false);assert.equal(calls.some(c=>c[0]==='render'),false);
 assert.match(app,/function renderAuth\(\) \{\n cancellationRefreshPending=false;/);
 assert.equal(ctx.cancellationRefreshPending,true);assert.match(calls.at(-1)[1],/cancelamento foi registrado.*Atualize/);
 assert.match(app,/if\(cancellationRefreshPending\)\{showCancellationRefresh\(\);return;\}/);
 assert.match(app,/if\(cancellationRefreshPending&&button.dataset.action!=='refresh-after-cancellation'\)/);
});
test('cancelar: Escape funciona antes do envio mas não fecha durante o pedido',()=>{
 const line=app.split('\n').find(line=>line.startsWith("modal.addEventListener('cancel'"));
 for(const busy of [false,true]){
  let handler,prevented=false;
  runInNewContext(line,{busy,machineDraftDirty:false,stockUI:{requestClose:()=>false},financeUI:{requestClose:()=>false},modal:{querySelector:()=>({}),addEventListener:(_event,fn)=>handler=fn}});
  handler({preventDefault(){prevented=true;}});assert.equal(prevented,busy);
 }
});
