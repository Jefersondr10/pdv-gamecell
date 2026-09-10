import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { orderedGoogleOptions } from '../public/google-ui.mjs';

test('Google UI: solicitações de nonce são seriadas mesmo quando o primeiro formulário sai da tela', async () => {
  const first={isConnected:true},second={isConnected:true};let resolveFirst;const requests=[];
  const old=orderedGoogleOptions(first,()=>{requests.push('old');return new Promise(resolve=>{resolveFirst=resolve;});});
  await new Promise(resolve=>setImmediate(resolve));first.isConnected=false;
  const current=orderedGoogleOptions(second,()=>{requests.push('new');return Promise.resolve('nonce-new');});
  await new Promise(resolve=>setImmediate(resolve));assert.deepEqual(requests,['old']);
  resolveFirst('nonce-old');assert.equal(await old,'nonce-old');assert.equal(await current,'nonce-new');assert.deepEqual(requests,['old','new']);
  assert.equal(await orderedGoogleOptions({isConnected:false},()=>{throw Error('not allowed');}),null);
});
test('Google UI: metadados iniciais não emitem nonce, erro inicial tem uma única renderização', () => {
  const app=readFileSync(new URL('../public/app.mjs',import.meta.url),'utf8');
  assert.ok(app.includes("api('/auth/options?metadata=1')"));
  assert.ok(app.includes("if(!app.querySelector('.auth'))renderAuth()"));
});
