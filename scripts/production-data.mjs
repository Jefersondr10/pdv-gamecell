import { DatabaseSync, backup } from 'node:sqlite';
import { closeSync, openSync, lstatSync, mkdtempSync, linkSync, unlinkSync, rmSync, chmodSync, readdirSync, statSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve, dirname, join, isAbsolute } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createHash } from 'node:crypto';
import { Store } from '../src/store.mjs';

const required = ['tenants','users','sessions','products','sales','sale_items','lots','payments','google_identities','payment_changes'];
function absolute(path) {
  if (!path || !isAbsolute(path)) throw Error('Informe um caminho absoluto.');
  return resolve(path);
}
function absent(path) {
  for (const suffix of ['', '-wal', '-shm']) if (lstatSync(path+suffix,{throwIfNoEntry:false})) throw Error('Destino ou arquivos auxiliares já existem; nada foi substituído.');
}
export function validateDatabase(path) {
  absolute(path);
  if (!lstatSync(path).isFile() || lstatSync(path).isSymbolicLink()) throw Error('Banco deve ser arquivo regular.');
  const db = new DatabaseSync(path,{readOnly:true,timeout:5000});
  try {
    if (db.prepare('PRAGMA integrity_check').all().some(row=>row.integrity_check!=='ok')) throw Error('Integridade inválida.');
    if (db.prepare('PRAGMA foreign_key_check').all().length) throw Error('Relacionamentos inválidos.');
    const tables = new Set(db.prepare("SELECT name FROM sqlite_schema WHERE type='table'").all().map(row=>row.name));
    if (required.some(name=>!tables.has(name))) throw Error('O arquivo não tem o esquema esperado do PDV.');
    return { integrity:'ok', foreign_keys:'ok', tables:tables.size, sqlite:db.prepare('SELECT sqlite_version() version').get().version };
  } finally { db.close(); }
}
function promote(source,destination) {
  absent(destination);
  // Hard-link publication is atomic and fails if a concurrent process created the destination.
  linkSync(source,destination);
  unlinkSync(source);
}
export function initializeDatabase(destination) {
  destination=absolute(destination); absent(destination);
  const stage=mkdtempSync(join(dirname(destination),'.pdv-init-'));
  chmodSync(stage,0o700);
  try {
    const source=join(stage,'pdv.sqlite'), store=new Store(source);
    try {
      if (store.get('SELECT count(*) n FROM tenants').n || store.get('SELECT count(*) n FROM users').n) throw Error('Inicialização não está vazia.');
      store.db.exec('PRAGMA wal_checkpoint(TRUNCATE)');
    } finally { store.close(); }
    chmodSync(source,0o600); const result=validateDatabase(source); promote(source,destination); return result;
  } finally { rmSync(stage,{recursive:true,force:true}); }
}
export async function backupDatabase(source,directory) {
  source=absolute(source); directory=absolute(directory);
  validateDatabase(source);
  if (!lstatSync(directory).isDirectory() || lstatSync(directory).isSymbolicLink()) throw Error('Diretório de backup inválido.');
  const lock=join(directory,'.pdv-backup.lock');
  const fd=openSync(lock,'wx',0o600); closeSync(fd);
  let stage;
  try {
    stage=mkdtempSync(join(directory,'.pdv-backup-')); chmodSync(stage,0o700);
    const copy=join(stage,'pdv.sqlite'), db=new DatabaseSync(source,{readOnly:true,timeout:5000});
    try { await backup(db,copy); } finally { db.close(); }
    // A standalone backup must also open on a read-only backup volume without WAL sidecars.
    const standalone=new DatabaseSync(copy);
    try { standalone.exec('PRAGMA journal_mode=DELETE'); } finally { standalone.close(); }
    chmodSync(copy,0o600); const result=validateDatabase(copy);
    const name=`pdv-${new Date().toISOString().replaceAll(':','-')}.sqlite`, destination=join(directory,name);
    const metadata={...result,created_at:new Date().toISOString(),node:process.versions.node,bytes:statSync(copy).size,sha256:createHash('sha256').update(readFileSync(copy)).digest('hex')};
    promote(copy,destination);
    writeFileSync(destination+'.json',JSON.stringify(metadata,null,2)+'\n',{flag:'wx',mode:0o600});
    return {file:destination,...metadata};
  } finally { if(stage)rmSync(stage,{recursive:true,force:true}); unlinkSync(lock); }
}
export function restoreDatabase(source,destination) {
  source=absolute(source);destination=absolute(destination);absent(destination);
  const metadata=JSON.parse(readFileSync(source+'.json','utf8'));
  if (createHash('sha256').update(readFileSync(source)).digest('hex')!==metadata.sha256) throw Error('Backup diferente da cópia validada.');
  const stage=mkdtempSync(join(dirname(destination),'.pdv-restore-'));chmodSync(stage,0o700);
  try {
    const copy=join(stage,'pdv.sqlite');writeFileSync(copy,readFileSync(source),{flag:'wx',mode:0o600});
    const result=validateDatabase(copy);promote(copy,destination);return result;
  } finally { rmSync(stage,{recursive:true,force:true}); }
}
export function pruneBackups(directory,days=30) {
  directory=absolute(directory);
  if (!Number.isInteger(days)||days<14) throw Error('Retenção mínima de 14 dias.');
  const files=readdirSync(directory).filter(name=>/^pdv-\d{4}-\d\d-\d\dT\d\d-\d\d-\d\d\.\d{3}Z\.sqlite$/.test(name)).sort();
  const cutoff=Date.now()-days*86400000;
  let removed=0;
  for(const name of files.slice(0,-14)) {
    const path=join(directory,name);
    if(!lstatSync(path).isFile()||statSync(path).mtimeMs>=cutoff)continue;
    // Only this script's dated backups, never the live DB or arbitrary paths.
    if(!lstatSync(path+'.json',{throwIfNoEntry:false})?.isFile())continue;
    unlinkSync(path);unlinkSync(path+'.json');removed++;
  }
  return {removed};
}
if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href===import.meta.url) {
  process.umask(0o077);
  const [command,source,target]=process.argv.slice(2);
  try {
    let result;
    if(command==='init-empty')result=initializeDatabase(source);
    else if(command==='backup')result=await backupDatabase(source,target);
    else if(command==='verify')result=validateDatabase(source);
    else if(command==='restore-new')result=restoreDatabase(source,target);
    else if(command==='prune')result=pruneBackups(source);
    else throw Error('Use init-empty, backup, verify, restore-new ou prune.');
    console.log(JSON.stringify(result));
  }catch(error){console.error(error.message);process.exitCode=1;}
}
