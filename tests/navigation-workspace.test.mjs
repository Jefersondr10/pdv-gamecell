import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';
import {createPageHistory} from '../public/mobile-ui.mjs';
const app=readFileSync(new URL('../public/app.mjs',import.meta.url),'utf8');
const part=(a,b)=>app.slice(app.indexOf(a),app.indexOf(b,app.indexOf(a)+a.length));
function historyHarness() {
 const entries=[null],calls=[],views=[];let cursor=0,blocked=false;
 const history={get state(){return entries[cursor];},replaceState(s){entries[cursor]=s;calls.push('replace');},pushState(s){entries.splice(++cursor);entries.push(s);calls.push('push');},go(n){cursor+=n;calls.push('go:'+n);}};
 const router=createPageHistory({history,onNavigate:async route=>views.push(route.view),isBlocked:()=>blocked,onBlocked:()=>calls.push('blocked')});
 return {entries,calls,views,history,router,set blocked(value){blocked=value;},async back(){await router.pop(entries[--cursor]);}};
}
test('Voltar: login inicial é substituído; navegação volta pelas páginas sem criar novas entradas',async()=>{
 const x=historyHarness();assert.equal(await x.router.restore('user'),false);
 x.router.record('user',{view:'dashboard'});assert.equal(x.entries.length,1);
 x.router.record('user',{view:'sales'});x.router.record('user',{view:'sales'});x.router.record('user',{view:'products'});
 assert.equal(x.entries.length,3);await x.back();await x.back();assert.deepEqual(x.views,['sales','dashboard']);assert.equal(x.entries.length,3);
});
test('Voltar: rota anterior à sessão ou de outro usuário nunca reapresenta login ou dados privados',async()=>{
 const x=historyHarness();x.router.record('owner',{view:'dashboard'});
 await x.router.pop({kind:'gamecell-page',owner:'other',index:0,route:{view:'login'}});
 assert.deepEqual(x.views,['dashboard']);assert.equal(x.history.state.owner,'owner');
 x.router.reset();assert.equal(x.history.state,null);await x.router.pop(x.entries[0]);assert.equal(x.views.length,1);
});
test('Voltar: restauração não duplica histórico e formulário aberto impede perda silenciosa',async()=>{
 const x=historyHarness();x.router.record('user',{view:'dashboard'});x.router.record('user',{view:'products'});
 assert.equal(await x.router.restore('user'),true);assert.equal(x.entries.length,2);
 x.blocked=true;await x.back();assert.ok(x.calls.includes('go:1'));assert.ok(x.calls.includes('blocked'));assert.equal(x.history.state.route.view,'products');
});
test('menu: mantém preenchimento em memória e Vender retoma os mesmos itens, valores e etapa',()=>{
 const working={local_key:'draft',items:[{description:'PS4',price:'1600,00',unit_ids:['sn']}],payments:[{amount:'100'}],step:'item-0'};
 const ctx={working,workingDirty:true,pendingWorks:new Map(),state:{products:[]},can:()=>true,render(){},productHistory:null,esc:String,modal:{querySelector:()=>({remove(){}})},showModal(title,html){ctx.dialog=html;}};
 runInNewContext(part('function workKey(', 'function editorNumbers('),ctx);
 ctx.rememberWorking();assert.equal(ctx.pendingWorks.get('draft'),working);
 ctx.working=null;ctx.workingDirty=false;ctx.startSale();assert.equal(ctx.working,null);assert.match(ctx.dialog,/Retomar/);assert.match(ctx.dialog,/Iniciar nova venda/);assert.equal(ctx.pendingWorks.get('draft').step,'item-0');
 assert.deepEqual(ctx.pendingWorks.get('draft').items[0].unit_ids,['sn']);ctx.forgetWorking(working);assert.equal(ctx.pendingWorks.size,0);
 const navigation=part(' if(button.dataset.view){',' const a=button.dataset.action');
 assert.match(navigation,/rememberWorking\(\)/);assert.doesNotMatch(navigation,/askToDiscard|logout/);
 assert.match(app,/pendingWorks\.size\|\|machineDraftDirty/);
});
test('sessão: erro de rede/servidor mostra nova tentativa, nunca login falso; 401 continua protegido',async()=>{
 for(const status of [undefined,500,401]){
  const calls=[],error=Object.assign(Error('Teste'),{status}),ctx={api:async()=>{throw error;},load:async()=>{},app:{querySelector:()=>null},renderAuth:()=>calls.push('login'),showLoadError:()=>calls.push('retry')};
  runInNewContext(part('async function bootstrap()', 'initSelectControls();'),ctx);await ctx.bootstrap();
  assert.deepEqual(calls,[status===401?'login':'retry']);
 }
 assert.match(app,/window\.addEventListener\('pageshow'/);assert.match(app,/adoptState\(await api\('\/state\?'/);
});
