import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { DatabaseSync } from 'node:sqlite';
import { Store } from '../src/store.mjs';
import { GoogleAuth } from '../src/google-auth.mjs';
import { configuration, clientAddress, AuthLimiter } from '../src/config.mjs';
import { migrateGoogleUsers } from '../src/google-store.mjs';
import { application } from '../src/server.mjs';

const clientId = '123-test.apps.googleusercontent.com';
const identity = (sub = 'one', email = 'owner@example.test') => ({ sub, email, name: 'Responsável' });
const localUser = { name: 'Local', email: 'owner@example.test', password: 'Strong-local-password', store_name: 'Loja local' };
function claims(nonce, changes = {}) { return { ...identity(), iss: 'https://accounts.google.com', aud: clientId, email_verified: true, nonce, exp: Date.now()/1000+3600, iat: Date.now()/1000, ...changes }; }

test('produção: valida configuração antes de abrir/criar banco', () => {
  const dir = mkdtempSync(join(tmpdir(), 'pdv-config-'));
  try {
    const dbPath=join(dir,'pdv.sqlite'), db=new DatabaseSync(dbPath);db.close();
    const env={NODE_ENV:'production',APP_ORIGIN:'https://example.test',DB_PATH:dbPath,GOOGLE_CLIENT_ID:clientId};
    assert.equal(configuration(env,'24.16.0').production,true);
    for(const delta of [{APP_ORIGIN:'http://example.test'},{APP_ORIGIN:'https://example.test/path'},{APP_ORIGIN:'https://user:pass@example.test'},{DB_PATH:'relative.sqlite'},{DB_PATH:join(dir,'missing.sqlite')},{PORT:'NaN'},{PORT:'0'},{PORT:'65536'},{GOOGLE_CLIENT_ID:''},{HOST:'0.0.0.0'},{TRUSTED_PROXY_IP:'172.16.1.2, 1.2.3.4'}]) assert.throws(()=>configuration({...env,...delta},'24.16.0'));
    assert.throws(()=>configuration(env,'22.13.0'));
    assert.equal(existsSync(join(dir,'missing.sqlite')),false);
    assert.equal(configuration({...env,HOST:'0.0.0.0',CONTAINER_ISOLATED:'true',TRUSTED_PROXY_IP:'172.16.1.2'},'24.16.0').host,'0.0.0.0');
  } finally { rmSync(dir,{recursive:true,force:true}); }
});
test('produção: IP encaminhado só é aceito do proxy exato e limites expiram', () => {
  const req={socket:{remoteAddress:'::ffff:172.16.1.2'},headers:{'x-real-ip':'203.0.113.2'}};
  assert.equal(clientAddress(req,'172.16.1.2'),'203.0.113.2');
  assert.equal(clientAddress(req,'172.16.1.3'),'172.16.1.2');
  req.headers['x-real-ip']='203.0.113.2, 1.2.3.4';assert.equal(clientAddress(req,'172.16.1.2'),'172.16.1.2');
  let clock=0;const limiter=new AuthLimiter(()=>clock);
  assert.equal(limiter.take('a',1),0);assert.ok(limiter.take('a',1)>0);assert.equal(limiter.take('b',1),0);
  clock=900001;assert.equal(limiter.take('a',1),0);
});
test('Google: nonce vinculado, uso único e TTL inclusive após validação assíncrona', async () => {
  let payload;const auth=new GoogleAuth(clientId,{verify:async()=>payload});const challenge=auth.issue();payload=claims(challenge.nonce);
  assert.deepEqual(await auth.authenticate(challenge.token,'token'),identity());
  await assert.rejects(auth.authenticate(challenge.token,'token'));
  const next=auth.issue();payload=claims(next.nonce);await assert.rejects(auth.authenticate('0'.repeat(64),'token'));
  assert.deepEqual(await auth.authenticate(next.token,'token'),identity());
  let clock=0;const late=new GoogleAuth(clientId,{clock:()=>clock,verify:async()=>{clock=600001;return payload;}});const c=late.issue();payload=claims(c.nonce);
  await assert.rejects(late.authenticate(c.token,'token'));
});
test('Google: claims adulterados ou assinatura recusada não autenticam', async () => {
  for(const change of [{nonce:'bad'},{iss:'https://evil.test'},{aud:'other'},{azp:'other'},{exp:0},{iat:Date.now()/1000+600},{email_verified:false},{sub:''},{email:undefined}]) {
    let payload;const auth=new GoogleAuth(clientId,{verify:async()=>payload});const c=auth.issue();payload=claims(c.nonce,change);
    await assert.rejects(auth.authenticate(c.token,'token'));await assert.rejects(auth.authenticate(c.token,'token'));
  }
  const actual=new GoogleAuth(clientId), c=actual.issue();await assert.rejects(actual.authenticate(c.token,'unsigned-token'));
});
test('Google: email não vincula lojas; sub é estável e senha nunca entra em identidade Google', () => {
  const store=new Store();try {
    const original=store.register(localUser), actor=store.actor(original.token);
    const product=store.addProduct(actor,{name:'Produto privado',price_cents:1000});
    assert.equal(store.googleLogin(identity()).needs_store,true);assert.equal(store.get('SELECT count(*) n FROM tenants').n,1);
    const first=store.googleLogin(identity(),'Google 1'),second=store.googleLogin(identity('two'),'Google 2');
    assert.notEqual(first.user.id,actor.id);assert.notEqual(first.user.id,second.user.id);
    assert.equal(store.googleLogin(identity('one','changed@example.test')).user.id,first.user.id);
    assert.equal(store.login(localUser).user.id,actor.id);
    assert.throws(()=>store.login({...localUser,email:'changed@example.test'}));
    assert.throws(()=>store.scoped('products',product.id,store.actor(first.token)));
    assert.equal(store.get('SELECT count(*) n FROM tenants').n,3);
    store.run('UPDATE users SET active=0 WHERE id=?',first.user.id);
    assert.throws(()=>store.googleLogin(identity(),'Another'));assert.equal(store.get('SELECT count(*) n FROM tenants').n,3);
    assert.equal(store.all('PRAGMA foreign_key_check').length,0);
  } finally { store.close(); }
});
test('Google: cadastro atômico, retorno simultâneo lógico e permissões da equipe fixadas pelo servidor', () => {
  const store=new Store();try {
    const audit=store.audit;store.audit=()=>{throw Error('forced');};assert.throws(()=>store.googleLogin(identity(),'Loja'));
    for(const table of ['tenants','users','google_identities','sessions'])assert.equal(store.get(`SELECT count(*) n FROM ${table}`).n,0);
    store.audit=audit;
    const result=store.googleLogin(identity(),'Loja'), actor=store.actor(result.token);
    assert.equal(store.googleLogin(identity(),'Loja repetida').user.id,result.user.id);assert.equal(store.get('SELECT count(*) n FROM tenants').n,1);
    const seller=store.addUser(actor,{...localUser,is_owner:true,auth_kind:'google',tenant_id:'fake',permissions:['sales.create']});
    assert.equal(seller.is_owner,false);assert.equal(store.get('SELECT auth_kind,tenant_id FROM users WHERE id=?',seller.id).auth_kind,'password');
    assert.equal(store.login(localUser).user.id,seller.id);
  } finally { store.close(); }
});
test('Google: migração legada preserva registros, sessões, FKs e reabertura', () => {
  const dir=mkdtempSync(join(tmpdir(),'pdv-google-migrate-')), path=join(dir,'pdv.sqlite');
  try {
    const db=new DatabaseSync(path);db.exec(readFileSync(new URL('../src/schema.sql',import.meta.url),'utf8'));
    db.exec("INSERT INTO tenants VALUES('t','Loja','now'); INSERT INTO users VALUES('u','t','Nome','old@example.test','salt','hash','[]',1,1,'now'); INSERT INTO sessions VALUES('token','u',9999999999999)");
    const before=db.prepare('SELECT * FROM users').all().map(row=>({...row}));db.close();
    const store=new Store(path);const after=store.all('SELECT * FROM users').map(({auth_kind,...row})=>row);
    assert.deepEqual(after,before);assert.equal(store.get('SELECT user_id FROM sessions').user_id,'u');assert.equal(store.all('PRAGMA foreign_key_check').length,0);
    migrateGoogleUsers(store);assert.deepEqual(store.all('SELECT * FROM users').map(({auth_kind,...row})=>row),before);store.close();
    const reopened=new Store(path);assert.equal(reopened.get('SELECT count(*) n FROM users').n,1);reopened.close();
  }finally{rmSync(dir,{recursive:true,force:true});}
});
test('HTTP Google: CSRF, cookies seguros, onboarding obrigatório e cadastro por senha fechado', async () => {
  const store=new Store();let payload;const google=new GoogleAuth(clientId,{verify:async()=>payload});
  const {server}=application({store,origin:'https://example.test',production:true,publicRegistration:false,googleClientId:clientId,googleAuth:google});
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const base=`http://127.0.0.1:${server.address().port}`;
  const call=(path,data,cookie='',origin='https://example.test')=>fetch(base+path,{method:data===undefined?'GET':'POST',headers:{Origin:origin,Cookie:cookie,...(data===undefined?{}:{'Content-Type':'application/json'})},body:data===undefined?undefined:JSON.stringify(data)});
  try {
    let response=await call('/api/auth/options');const settings=await response.json();let cookie=response.headers.getSetCookie()[0].split(';')[0];payload=claims(settings.nonce);
    assert.match(response.headers.get('set-cookie'),/HttpOnly; SameSite=Strict.*Secure/);
    assert.equal((await call('/api/register',localUser)).status,403);
    assert.equal((await call('/api/auth/google',{credential:'token'},cookie,'https://evil.test')).status,403);
    response=await call('/api/auth/google',{credential:'token'},cookie);assert.equal(response.status,200);assert.equal((await response.json()).needs_store,true);cookie=response.headers.getSetCookie()[0].split(';')[0];
    assert.equal((await call('/api/auth/google/store',{},cookie)).status,400);assert.equal(store.get('SELECT count(*) n FROM tenants').n,0);
    response=await call('/api/auth/google/store',{store_name:'Minha loja'},cookie);assert.equal(response.status,201);const session=response.headers.getSetCookie()[0].split(';')[0];
    assert.equal((await call('/api/state',undefined,session)).status,200);
    assert.equal((await call('/api/auth/google/store',{store_name:'Outra'},cookie)).status,401);
    assert.equal(store.get('SELECT count(*) n FROM tenants').n,1);
    response=await call('/api/logout',{},session);assert.match(response.headers.get('set-cookie'),/Secure/);
    assert.equal((await call('/api/state',undefined,session)).status,401);
    assert.equal((await call('/data/pdv.sqlite')).status,404);
  } finally { await new Promise(resolve=>server.close(resolve));store.close(); }
});
