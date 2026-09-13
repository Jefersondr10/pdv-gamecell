import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const styles=readFileSync(new URL('../public/calculator-extra.css',import.meta.url),'utf8');
const brand=readFileSync(new URL('../public/brand.css',import.meta.url),'utf8');
const expanded=styles.slice(styles.indexOf('/* Expand the result'));
// These are source contracts, not substitutes for viewport and zoom checks in a browser.
const rules=[...expanded.matchAll(/([^{}]+)\{([^{}]*)\}/g)].map(([,selector,body])=>({
  selectors:selector.trim().split(',').map(s=>s.trim()),body
}));
const rule=selector=>rules.filter(r=>r.selectors.includes(selector)).map(r=>r.body).join('\n');

test('calculadora expandida: a cadeia de altura pertence somente à etapa de resultado',()=>{
  assert.ok(expanded.startsWith('/* Expand the result'));
  assert.ok(rules.length>=10);
  for(const {selectors} of rules)for(const selector of selectors)assert.ok(selector.includes('.calculator-step-result'),selector);
  assert.match(rule('.main:has(.calculator-step-result)'),/min-height\s*:\s*100dvh/);
  assert.match(rule('.main:has(.calculator-step-result)'),/display\s*:\s*flex/);
  assert.match(rule('.main:has(.calculator-step-result) > .topbar'),/flex\s*:\s*none/);
  const content=rules.find(r=>r.selectors.some(s=>s.endsWith('.content:has(.calculator-step-result)')))?.body??'';
  assert.match(content,/margin-block\s*:\s*0/);
  assert.match(content,/flex\s*:\s*1/);
  for(const selector of ['#page:has(.calculator-step-result)','.calculator-step-result','.calculator-step-result .calculator-layout','.calculator-step-result .calculator-result','.calculator-step-result #calculator-result']){
    assert.match(rule(selector),/display\s*:\s*flex/,selector);
    assert.match(rule(selector),/flex-direction\s*:\s*column/,selector);
    assert.match(rule(selector),/flex\s*:\s*1/,selector);
  }
  assert.match(rule('.calculator-step-result'),/max-width\s*:\s*none/);
  assert.match(rule('.calculator-step-result .calculator-layout'),/align-items\s*:\s*stretch/);
  assert.match(styles,/\.calculator-step-form\s*\{[^}]*max-width\s*:\s*600px/);
});

test('calculadora expandida: conserva as 18 parcelas em nove linhas móveis e seis no desktop',()=>{
  assert.match(brand,/\.installment-grid\s*\{[^}]*grid-template-columns\s*:\s*repeat\(2,minmax\(0,1fr\)\)/);
  assert.match(brand,/@media screen and \(min-width:\s*901px\)[\s\S]*?\.installment-grid\s*\{[^}]*grid-template-columns\s*:\s*repeat\(3,minmax\(0,1fr\)\)/);
  assert.match(rule('.calculator-step-result .installment-grid'),/flex\s*:\s*1/);
  assert.match(rule('.calculator-step-result .installment-grid'),/grid-template-rows\s*:\s*repeat\(9,minmax\(auto,1fr\)\)/);
  assert.match(expanded,/@media screen and \(min-width:\s*901px\)\s*\{\s*\.calculator-step-result \.installment-grid\s*\{[^}]*grid-template-rows\s*:\s*repeat\(6,minmax\(auto,1fr\)\)/);
});

test('calculadora expandida: telas curtas e zoom mantêm crescimento natural sem recortar ações',()=>{
  assert.doesNotMatch(expanded,/(?:^|[;{])\s*(?:height|max-height)\s*:/m);
  assert.doesNotMatch(expanded,/overflow(?:-[xy])?\s*:\s*(?:hidden|clip)/);
  assert.doesNotMatch(expanded,/position\s*:\s*(?:fixed|absolute)/);
  assert.match(rule('.calculator-step-result .calculator-result'),/overflow\s*:\s*visible/);
  assert.match(rule('.calculator-step-result .calculator-submit'),/flex\s*:\s*none/);
  assert.match(rule('.calculator-step-result > .page-heading'),/flex\s*:\s*none/);
  assert.match(rule('.calculator-step-result .installment-option'),/font-size\s*:\s*clamp\(/);
});
