import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { saleTiming } from '../public/sales-view.mjs';

const esc=value=>String(value??'').replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;');
const app=readFileSync(new URL('../public/app.mjs',import.meta.url),'utf8');
const css=readFileSync(new URL('../public/brand.css',import.meta.url),'utf8');

test('data e hora: dia comercial e instante real aparecem juntos em uma linha compacta',()=>{
 const seen=[];
 const html=saleTiming({business_date:'2026-09-10',created_at:'2026-09-11T01:37:00.000Z'}, {
  esc,
  date:value=>{seen.push(['date',value]);return '10/09/2026';},
  time:value=>{seen.push(['time',value]);return '22:37';}
 });
 assert.match(html,/class="sale-timing" aria-label="Data e hora da venda"><strong>10\/09\/2026<\/strong><span aria-hidden="true">·<\/span><span>22:37<\/span>/);
 assert.deepEqual(seen,[['date','2026-09-10T12:00:00-03:00'],['time','2026-09-11T01:37:00.000Z']]);
 assert.doesNotMatch(html,/Data da venda|Registrada às|12:00/);
});

test('data e hora: registro inválido mantém somente a data sem texto extra',()=>{
 const html=saleTiming({business_date:'2026-09-10',created_at:'inválido'}, {esc,date:()=> '10/09/2026',time:()=>''});
 assert.match(html,/sale-timing[\s\S]*<strong>10\/09\/2026<\/strong>/);
 assert.doesNotMatch(html,/Horário|Registrada às|·/);
});

test('data e hora: prefere o instante semântico de registro e mantém compatibilidade',()=>{
 const seen=[];
 const html=saleTiming({business_date:'2026-09-10',registered_at:'2026-09-11T01:37:00.000Z',created_at:'2026-09-11T00:00:00.000Z'}, {
  esc,date:()=> '10/09/2026',time:value=>{seen.push(value);return '22:37';}
 });
 assert.match(html,/<strong>10\/09\/2026<\/strong><span aria-hidden="true">·<\/span><span>22:37<\/span>/);
 assert.deepEqual(seen,['2026-09-11T01:37:00.000Z']);
});

test('hora da interface usa o fuso de São Paulo e somente o instante criado',()=>{
 const start=app.indexOf('const time ='),end=app.indexOf('const filterDateLabel',start);
 assert.ok(start>=0&&end>start);
 const context={Intl,Date};
 runInNewContext(`${app.slice(start,end)};this.formatted=time('2026-09-11T01:37:00.000Z');this.invalid=time('sem-instante');`,context);
 assert.equal(context.formatted,'22:37');
 assert.equal(context.invalid,'');
});

test('dashboard deixa o ranking no menu próprio e mantém horário compacto nas vendas',()=>{
 const start=app.indexOf('function renderDashboard()'),end=app.indexOf('function renderSales()',start);
 assert.ok(start>=0&&end>start);
 const dashboard=app.slice(start,end);
 assert.doesNotMatch(dashboard,/sellerRanking\(|rankingView\(|Ranking por faturamento/);
 assert.match(app,/salesRecords\(state\.sales,\{esc,money,date,time,/);
 assert.match(app,/cancelledSaleDetailView\(s,\{esc,money,date,time,icon\}\)/);
 assert.match(app,/saleTiming\(s,\{esc,date,time\}\)/);
 assert.match(css,/\.sale-timing\s*\{[^}]*font-variant-numeric|\.sale-timing strong\s*\{[^}]*font-variant-numeric/);
});
