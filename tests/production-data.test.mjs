import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Store } from '../src/store.mjs';
import { DatabaseSync } from 'node:sqlite';
import { initializeDatabase, backupDatabase, restoreDatabase, validateDatabase } from '../scripts/production-data.mjs';

test('produção: bootstrap vazio não sobrescreve dados nem cria usuários',()=>{
  const directory=mkdtempSync(join(tmpdir(),'pdv-init-test-'));
  try {
    const path=join(directory,'pdv.sqlite');assert.equal(initializeDatabase(path).integrity,'ok');
    const store=new Store(path);assert.equal(store.get('SELECT count(*) n FROM tenants').n,0);store.close();
    const before=readFileSync(path);assert.throws(()=>initializeDatabase(path));assert.deepEqual(readFileSync(path),before);
    const invalid=join(directory,'invalid.sqlite');writeFileSync(invalid,'');assert.throws(()=>validateDatabase(invalid));
  }finally{rmSync(directory,{recursive:true,force:true});}
});
test('produção: backup em uso recupera dados isolados e recusa corrupção/sobrescrita',async()=>{
  const directory=mkdtempSync(join(tmpdir(),'pdv-backup-test-'));let store;
  try {
    const path=join(directory,'pdv.sqlite'), backups=join(directory,'backups');mkdirSync(backups);initializeDatabase(path);
    store=new Store(path);
    const first=store.googleLogin({sub:'owner-a',email:'a@example.test',name:'A'},'Loja A');
    const second=store.googleLogin({sub:'owner-b',email:'b@example.test',name:'B'},'Loja B');
    const actor=store.actor(first.token),product=store.addProduct(actor,{name:'Produto preservado',price_cents:3500});
    const result=await backupDatabase(path,backups);assert.equal(result.foreign_keys,'ok');
    const standalone=new DatabaseSync(result.file,{readOnly:true});
    assert.equal(standalone.prepare('PRAGMA journal_mode').get().journal_mode,'delete');standalone.close();
    const restoredPath=join(directory,'restored.sqlite');restoreDatabase(result.file,restoredPath);
    const restored=new Store(restoredPath);
    try {
      assert.equal(restored.scoped('products',product.id,restored.actor(first.token)).name,'Produto preservado');
      assert.throws(()=>restored.scoped('products',product.id,restored.actor(second.token)));
      assert.equal(restored.get('SELECT count(*) n FROM tenants').n,2);
    }finally{restored.close();}
    assert.throws(()=>restoreDatabase(result.file,restoredPath));
    writeFileSync(result.file,'corrupt');assert.throws(()=>restoreDatabase(result.file,join(directory,'bad.sqlite')));
    assert.equal(existsSync(join(directory,'bad.sqlite')),false);
    writeFileSync(join(backups,'.pdv-backup.lock'),'');await assert.rejects(backupDatabase(path,backups));
  }finally{store?.close();rmSync(directory,{recursive:true,force:true});}
});
