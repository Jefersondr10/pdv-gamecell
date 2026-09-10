import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {application} from '../src/server.mjs';
import {Store} from '../src/store.mjs';
import {installMobilePreview} from '../scripts/mobile-preview-shell.mjs';

async function fixture(t,preview,options){
 const store=new Store(':memory:'),origin='http://127.0.0.1:3999',{server}=application({store,origin});
 if(preview)installMobilePreview(server,options);
 await new Promise(r=>server.listen(0,'127.0.0.1',r));
 t.after(async()=>{await new Promise(r=>server.close(r));store.close();});
 return {base:`http://127.0.0.1:${server.address().port}`,origin};
}
test('prévia: moldura fixa só no QA; app normal mantém bloqueio de iframe',async t=>{
 const qa=await fixture(t,true),normal=await fixture(t,false);
 for(const path of ['/mobile-preview','/mobile-preview.css','/mobile-preview.mjs'])assert.equal((await fetch(qa.base+path)).status,200);
 const wrapper=await fetch(qa.base+'/mobile-preview');assert.match(wrapper.headers.get('content-security-policy'),/frame-src 'self'/);assert.match(await wrapper.text(),/<iframe[^>]+src="\/"/);
 const framed=await fetch(qa.base+'/');assert.equal(framed.headers.get('x-frame-options'),'SAMEORIGIN');assert.match(framed.headers.get('content-security-policy'),/frame-ancestors 'self'/);assert.match(framed.headers.get('content-security-policy'),/frame-src 'none'/);
 const protectedPage=await fetch(normal.base+'/');assert.equal(protectedPage.headers.get('x-frame-options'),'DENY');assert.match(protectedPage.headers.get('content-security-policy'),/frame-ancestors 'none'/);assert.equal((await fetch(normal.base+'/mobile-preview')).status,404);
 assert.doesNotMatch(readFileSync(new URL('../Dockerfile',import.meta.url),'utf8'),/mobile-preview|COPY scripts \.\/scripts/);
});
test('prévia: sessões de portas diferentes não substituem uma à outra',async t=>{
 const first=await fixture(t,true,{cookieName:'pdv_mobile_preview_session_3013'}),second=await fixture(t,true,{cookieName:'pdv_mobile_preview_session_3014'});
 const cookies=[];
 for(const env of [first,second]){
  const response=await fetch(env.base+'/api/register',{method:'POST',headers:{'Content-Type':'application/json',Origin:env.origin},body:JSON.stringify({name:'Teste',store_name:'Prévia',email:'preview@example.test',password:'senha-ficticia-de-teste'})});
  assert.equal(response.status,201);cookies.push(response.headers.get('set-cookie').split(';')[0]);
 }
 assert.match(cookies[0],/^pdv_mobile_preview_session_3013=/);assert.match(cookies[1],/^pdv_mobile_preview_session_3014=/);
 for(const [index,env] of [first,second].entries()){
  assert.equal((await fetch(env.base+'/api/state',{headers:{Cookie:cookies.join('; ')}})).status,200);
  assert.equal((await fetch(env.base+'/api/state',{headers:{Cookie:cookies[1-index]}})).status,401);
 }
 assert.throws(()=>installMobilePreview({}, {cookieName:'pdv_session'}),/Cookie/);
});
test('prévia: cookie exclusivo, autenticação e origem continuam obrigatórias',async t=>{
 const {base,origin}=await fixture(t,true);
 assert.equal((await fetch(base+'/api/state')).status,401);
 const payload=JSON.stringify({name:'Teste',store_name:'Prévia',email:'preview@example.test',password:'senha-ficticia-de-teste'});
 assert.equal((await fetch(base+'/api/register',{method:'POST',headers:{'Content-Type':'application/json',Origin:'https://outro.test'},body:payload})).status,403);
 const registered=await fetch(base+'/api/register',{method:'POST',headers:{'Content-Type':'application/json',Origin:origin},body:payload});assert.equal(registered.status,201);
 const cookie=registered.headers.get('set-cookie');assert.match(cookie,/^pdv_mobile_preview_session=/);assert.match(cookie,/HttpOnly; SameSite=Strict/);
 assert.equal((await fetch(base+'/api/state',{headers:{Cookie:cookie.split(';')[0]}})).status,200);
 assert.equal((await fetch(base+'/api/state',{headers:{Cookie:cookie.split(';')[0].replace('pdv_mobile_preview_session=','pdv_session=')}})).status,401);
 const script=readFileSync(new URL('../scripts/mobile-preview.mjs',import.meta.url),'utf8');assert.doesNotMatch(script,/\.src\s*=|reload\(|innerHTML|setTimeout|setInterval/);assert.match(script,/device\.dataset\.deviceSize/);
});
