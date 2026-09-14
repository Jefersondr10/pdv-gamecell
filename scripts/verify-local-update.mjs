// Read-only post-update check. No database rows or credentials are printed.
import { DatabaseSync } from 'node:sqlite';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve,relative,isAbsolute } from 'node:path';

const root=resolve('.'),backup=resolve(process.argv[2]??''),inside=relative(resolve(root,'data/backups'),backup);
if(!inside||inside.startsWith('..')||isAbsolute(inside)||!backup.endsWith('.sqlite'))throw Error('Informe uma cópia SQLite dentro de data/backups.');
const before=new DatabaseSync(backup,{readOnly:true}),current=new DatabaseSync(resolve(root,'data/pdv.sqlite'),{readOnly:true});
const sha=value=>createHash('sha256').update(value).digest('hex');
try {
 const tables=before.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name").all().map(t=>t.name);
 const changed=tables.filter(name=>{
  if(!/^[a-z_]+$/.test(name))throw Error('Nome de tabela inesperado.');
  const rows=db=>db.prepare('SELECT * FROM '+name).all().map(row=>JSON.stringify(row)).sort().join('\n');
  return sha(rows(before))!==sha(rows(current));
 });
 const integrity=current.prepare('PRAGMA integrity_check').get().integrity_check,foreignKeys=current.prepare('PRAGMA foreign_key_check').all();
 console.log(JSON.stringify({original_tables:tables.length,changed_tables:changed,integrity,foreign_key_errors:foreignKeys.length}));
 if(changed.length||integrity!=='ok'||foreignKeys.length)throw Error('A conferência encontrou diferenças; não foi feita nenhuma restauração.');
} finally {before.close();current.close();}
const paths=['app.mjs','finance-ui.mjs','expense-filter-controller.mjs','ranking-ui.mjs','date-control.mjs','brand.css','receipt-view.mjs','stock-ui.mjs','sales-view.mjs'];
for(const path of paths){
 const response=await fetch('http://127.0.0.1:3000/'+path),served=Buffer.from(await response.arrayBuffer());
 if(!response.ok||sha(served)!==sha(readFileSync(resolve(root,'public',path))))throw Error('Ativo local não corresponde: '+path);
}
const health=await(await fetch('http://127.0.0.1:3000/health')).json();
console.log(JSON.stringify({health,assets_verified:paths.length}));
