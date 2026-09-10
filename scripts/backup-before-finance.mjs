import { DatabaseSync, backup } from 'node:sqlite';
import { existsSync, mkdirSync } from 'node:fs';
import { resolve, join } from 'node:path';

const source=resolve('data/pdv.sqlite');
if(!existsSync(source))throw new Error('Banco local esperado não encontrado; nenhuma alteração realizada.');
const directory=resolve('data/backups');mkdirSync(directory,{recursive:true});
const destination=join(directory,`before-finance-${new Date().toISOString().replaceAll(':','-')}.sqlite`);
const db=new DatabaseSync(source,{readOnly:true});
try { await backup(db,destination); } finally {db.close();}
const copied=new DatabaseSync(destination,{readOnly:true});
try {
  const integrity=copied.prepare('PRAGMA integrity_check').get().integrity_check;
  if(integrity!=='ok')throw new Error('Cópia não passou na verificação de integridade.');
  console.log(JSON.stringify({backup:destination,integrity}));
} finally {copied.close();}
