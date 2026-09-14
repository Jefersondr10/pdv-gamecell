import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const financeUi=readFileSync(new URL('../public/finance-ui.mjs',import.meta.url),'utf8');
const financeCss=readFileSync(new URL('../public/finance.css',import.meta.url),'utf8');
const compactCss=financeCss.slice(financeCss.indexOf('/* A lista de variaveis'));

test('despesas variáveis: ações principais mantêm nomes claros e ficam compactas no celular',()=>{
 assert.match(financeUi,/class="actions \$\{variable\?'expense-primary-actions':''\}"/);
 assert.match(financeUi,/Lançar despesa/);
 assert.match(financeUi,/Cadastrar várias/);
 assert.match(compactCss,/\.expense-primary-actions>button\{[^}]*height:44px;min-height:44px[^}]*white-space:nowrap/);
});

test('despesas variáveis: período, totais, busca e registro usam o espaço móvel sem textos repetidos',()=>{
 assert.match(compactCss,/@media screen and \(max-width:700px\)/);
 assert.match(compactCss,/\.finance-period\{[^}]*grid-template-columns:minmax\(0,1fr\)[^}]*margin:0 0 8px[^}]*padding:7px 9px/);
 assert.match(compactCss,/\.finance-period (?:\.select-trigger,\s*)?[\s\S]*?min-height:44px/);
 assert.match(compactCss,/\.finance-period>\.compact-disclosure\{display:none\}/);
 assert.match(compactCss,/\.variable-expense-metrics \.metric\{[^}]*min-height:54px[^}]*padding:7px 9px/);
 assert.match(compactCss,/\.variable-expense-metrics\+\.metric-explanations\{display:none\}/);
 assert.match(compactCss,/\.finance-search>\.compact-search-details\{grid-column:2/);
 assert.match(compactCss,/\.variable-expense-card\{[^}]*gap:6px[^}]*padding:9px 10px/);
 assert.match(compactCss,/\.variable-expense-card>\.expense-actions>button\{height:44px;min-height:44px/);
});

test('despesas variáveis: regras densas ficam limitadas à tela correta',()=>{
 const scoped=(compactCss.match(/#page\[data-screen="expenses-variable"\]/g)||[]).length;
 assert.ok(scoped>=30);
 assert.doesNotMatch(compactCss,/(?:^|\n)\s*\.(?:page-heading|finance-period|metric|panel|variable-expense-card)\{/);
});
