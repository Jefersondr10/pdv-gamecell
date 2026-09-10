// Test-only adapter. Not imported or packaged by the production application.
import {readFileSync} from 'node:fs';

const assets=new Map([
 ['/mobile-preview',['mobile-preview.html','text/html; charset=utf-8']],
 ['/mobile-preview.css',['mobile-preview.css','text/css; charset=utf-8']],
 ['/mobile-preview.mjs',['mobile-preview.mjs','text/javascript; charset=utf-8']]
]);
export function installMobilePreview(server,{cookieName='pdv_mobile_preview_session'}={}) {
 if(!/^pdv_mobile_preview_session(?:_[0-9]{4,5})?$/.test(cookieName))throw Error('Cookie da prévia inválido.');
 const previewCookie=cookieName;
 if(process.env.NODE_ENV==='production'||server.listening)throw Error('A moldura é exclusiva do servidor de testes local, antes de iniciar.');
 const handlers=server.listeners('request');
 if(handlers.length!==1)throw Error('Servidor de testes inesperado.');
 server.removeListener('request',handlers[0]);
 server.on('request',(req,res)=>{
  const path=new URL(req.url,'http://127.0.0.1').pathname;
  if(assets.has(path)){
   if(req.method!=='GET'){res.writeHead(405,{'Allow':'GET'});res.end();return;}
   const [file,type]=assets.get(path);
   res.writeHead(200,{
    'Content-Type':type,'Cache-Control':'no-store','X-Content-Type-Options':'nosniff','Referrer-Policy':'no-referrer','X-Frame-Options':'DENY',
    'Content-Security-Policy':"default-src 'none'; script-src 'self'; style-src 'self'; img-src 'self'; frame-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'"
   });
   res.end(readFileSync(new URL(file,import.meta.url)));return;
  }
  // Ports do not isolate cookies. Never read or replace a regular local PDV session.
  const session=(req.headers.cookie??'').split(';').map(v=>v.trim()).find(v=>v.startsWith(`${previewCookie}=`));
  req.headers.cookie=session?`pdv_session=${session.slice(previewCookie.length+1)}`:'';
  const setHeader=res.setHeader.bind(res);
  res.setHeader=(name,value)=>{
   const lower=name.toLowerCase();
   if(lower==='set-cookie'){
    const rename=v=>String(v).replace(/^pdv_session=/,`${previewCookie}=`);
    value=Array.isArray(value)?value.map(rename):rename(value);
   }
   if(req.method==='GET'&&path==='/'){
    if(lower==='x-frame-options')value='SAMEORIGIN';
    if(lower==='content-security-policy')value=String(value).replace("frame-ancestors 'none'","frame-ancestors 'self'");
   }
   return setHeader(name,value);
  };
  return handlers[0](req,res);
 });
}
