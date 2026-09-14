import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { Store } from '../src/store.mjs';
import { businessDate } from '../src/domain.mjs';
import { shiftMonth } from '../src/finance.mjs';

const today = businessDate();
const monthBefore = offset => shiftMonth(today.slice(0, 7), -offset);
const dateIn = (offset, day = '10') => `${monthBefore(offset)}-${day}`;
const addDays = (value, amount) => {
  const date = new Date(`${value}T12:00:00Z`);
  date.setUTCDate(date.getUTCDate() + amount);
  return date.toISOString().slice(0, 10);
};

function setup(t, suffix = randomUUID()) {
  const db = new Store();
  t.after(() => db.close());
  const session = db.register({
    name: 'Administrador',
    store_name: 'Loja de aceite',
    email: `variable-paid-${suffix}@example.test`,
    password: 'senha-ficticia-de-teste'
  });
  const actor = db.actor(session.token);
  return { db, actor, finance: db.finance };
}

function classification(x, suffix = randomUUID(), { categoryScope = 'both', subcategoryScope = 'both' } = {}) {
  const category = x.finance.saveCategory(x.actor, {
    name: `Categoria ${suffix}`,
    applicability: categoryScope
  });
  const subcategory = x.finance.saveSubcategory(x.actor, {
    category_id: category.id,
    name: `Subcategoria ${suffix}`,
    applicability: subcategoryScope
  });
  return { category, subcategory };
}

function variablePayload(classificationIds, overrides = {}) {
  return {
    request_id: randomUUID(),
    kind: 'variable',
    expense_date: dateIn(1),
    description: '',
    amount_cents: 12_345,
    category_id: classificationIds.category.id,
    subcategory_id: classificationIds.subcategory.id,
    payee: '',
    notes: '',
    ...overrides
  };
}

function closeMonth(x, month) {
  const report = x.finance.report(x.actor, month);
  return x.finance.closeMonth(x.actor, {
    month,
    source_hash: report.result.source_hash,
    settings_version: report.result.settings_version
  });
}

test('despesa variável individual nasce paga, aceita descrição vazia e normaliza toda a data', t => {
  const x = setup(t);
  const ids = classification(x);
  const expenseDate = dateIn(2, '08');
  const saved = x.finance.saveExpense(x.actor, variablePayload(ids, {
    expense_date: expenseDate,
    payee: 'Fornecedor opcional',
    notes: 'Compra já quitada'
  })).expenses[0];

  assert.equal(saved.kind, 'variable');
  assert.equal(saved.description, '');
  assert.equal(saved.expense_date, expenseDate);
  assert.equal(saved.due_date, expenseDate);
  assert.equal(saved.paid_date, expenseDate);
  assert.equal(saved.reference_month, expenseDate.slice(0, 7));
  assert.equal(saved.reminder_days, 0);
  assert.equal(saved.payee, 'Fornecedor opcional');
  assert.equal(saved.notes, 'Compra já quitada');
  assert.equal(saved.category_id, ids.category.id);
  assert.equal(saved.subcategory_id, ids.subcategory.id);

  const listed = x.finance.expenses(x.actor, expenseDate.slice(0, 7)).rows[0];
  assert.equal(listed.state, 'paid');
  assert.equal(x.finance.reminders(x.actor).items.some(row => row.id === saved.id), false);
});

test('despesa variável aceita os aliases expense_date e date, inclusive em lote já pago', t => {
  const x = setup(t);
  const ids = classification(x);
  const firstDate = dateIn(3, '11');
  const secondDate = dateIn(2, '12');
  const thirdDate = dateIn(1, '13');

  const byDateAlias = x.finance.saveExpense(x.actor, variablePayload(ids, {
    expense_date: undefined,
    date: firstDate
  })).expenses[0];
  assert.equal(byDateAlias.expense_date, firstDate);
  assert.equal(byDateAlias.due_date, firstDate);
  assert.equal(byDateAlias.paid_date, firstDate);

  const batch = x.finance.saveVariableBatch(x.actor, {
    request_id: randomUUID(),
    expenses: [
      {
        date: secondDate,
        description: '',
        amount_cents: 2_500,
        category_id: ids.category.id,
        subcategory_id: ids.subcategory.id
      },
      {
        expense_date: thirdDate,
        description: 'Frete já pago',
        amount_cents: 3_500,
        category_id: ids.category.id,
        subcategory_id: ids.subcategory.id,
        payee: 'Transportadora',
        notes: 'Pago no ato'
      }
    ]
  });

  assert.equal(batch.replayed, false);
  assert.deepEqual(batch.expenses.map(row => row.ordinal), [0, 1]);
  assert.deepEqual(batch.expenses.map(row => row.expense_date), [secondDate, thirdDate]);
  for (const row of batch.expenses) {
    assert.equal(row.kind, 'variable');
    assert.equal(row.paid_date, row.expense_date);
    assert.equal(row.due_date, row.expense_date);
    assert.equal(row.reference_month, row.expense_date.slice(0, 7));
    assert.equal(row.reminder_days, 0);
  }
  assert.equal(x.finance.reminders(x.actor).count, 0);
});

test('categoria e subcategoria são obrigatórias, compatíveis com variável e isoladas por loja', t => {
  const x = setup(t);
  const valid = classification(x, 'válida', { categoryScope: 'variable', subcategoryScope: 'variable' });
  const fixedOnly = classification(x, 'somente-fixa', { categoryScope: 'fixed', subcategoryScope: 'fixed' });
  const broadCategory = x.finance.saveCategory(x.actor, { name: 'Categoria ampla', applicability: 'both' });
  const fixedSubcategory = x.finance.saveSubcategory(x.actor, {
    category_id: broadCategory.id,
    name: 'Subcategoria somente fixa',
    applicability: 'fixed'
  });
  const other = setup(t, 'outra-loja');
  const foreign = classification(other, 'outra-loja');
  const before = x.db.get('SELECT COUNT(*) AS total FROM operating_expenses').total;

  const invalidPayloads = [
    variablePayload(valid, { category_id: undefined }),
    variablePayload(valid, { subcategory_id: undefined }),
    variablePayload(fixedOnly),
    variablePayload({ category: broadCategory, subcategory: fixedSubcategory }),
    variablePayload(foreign),
    variablePayload({ category: valid.category, subcategory: foreign.subcategory })
  ];
  for (const payload of invalidPayloads) assert.throws(() => x.finance.saveExpense(x.actor, payload));
  assert.equal(x.db.get('SELECT COUNT(*) AS total FROM operating_expenses').total, before);

  const saved = x.finance.saveExpense(x.actor, variablePayload(valid)).expenses[0];
  assert.equal(saved.category_id, valid.category.id);
  assert.equal(saved.subcategory_id, valid.subcategory.id);
  assert.equal(other.finance.expenses(other.actor, 'all').rows.length, 0);
});

test('data futura é recusada no individual e invalida o lote inteiro', t => {
  const x = setup(t);
  const ids = classification(x);
  const future = addDays(today, 1);
  const before = x.db.get('SELECT COUNT(*) AS total FROM operating_expenses').total;

  assert.throws(
    () => x.finance.saveExpense(x.actor, variablePayload(ids, { expense_date: future })),
    /futuro/
  );
  assert.throws(
    () => x.finance.saveVariableBatch(x.actor, {
      request_id: randomUUID(),
      expenses: [
        variablePayload(ids, { request_id: undefined, expense_date: dateIn(1) }),
        variablePayload(ids, { request_id: undefined, expense_date: future })
      ]
    }),
    /Linha 2:.*futuro/
  );
  assert.equal(x.db.get('SELECT COUNT(*) AS total FROM operating_expenses').total, before);
});

test('variáveis nunca aparecem nos lembretes, mesmo com data antiga ou dados legados inconsistentes', t => {
  const x = setup(t);
  const ids = classification(x);
  const oldDate = dateIn(4, '01');
  const saved = x.finance.saveExpense(x.actor, variablePayload(ids, { expense_date: oldDate })).expenses[0];

  assert.equal(x.finance.reminders(x.actor, today).count, 0);
  x.db.run('UPDATE operating_expenses SET paid_date=NULL,reminder_days=30 WHERE tenant_id=? AND id=?', x.actor.tenant_id, saved.id);
  assert.equal(x.finance.reminders(x.actor, today).items.some(row => row.id === saved.id), false);
});

test('variável paga pode ser corrigida diretamente entre meses abertos, mantendo identidade, versão e auditoria', t => {
  const x = setup(t);
  const originalClass = classification(x, 'original');
  const correctedClass = classification(x, 'corrigida');
  const originalDate = dateIn(3, '07');
  const correctedDate = dateIn(2, '09');
  const saved = x.finance.saveExpense(x.actor, variablePayload(originalClass, {
    expense_date: originalDate,
    amount_cents: 4_000,
    payee: 'Favorecido antigo'
  })).expenses[0];
  const beforeAudit = x.db.get("SELECT COUNT(*) AS total FROM audit WHERE tenant_id=? AND entity='operating_expense' AND entity_id=?", x.actor.tenant_id, saved.id).total;

  const edited = x.finance.saveExpense(x.actor, {
    version: saved.version,
    expense_date: correctedDate,
    description: 'Descrição corrigida',
    amount_cents: 5_500,
    category_id: correctedClass.category.id,
    subcategory_id: correctedClass.subcategory.id,
    payee: 'Novo favorecido',
    notes: 'Correção auditada'
  }, saved.id).expenses[0];

  assert.equal(edited.id, saved.id);
  assert.equal(edited.version, saved.version + 1);
  assert.equal(edited.created_at, saved.created_at);
  assert.equal(edited.kind, 'variable');
  assert.equal(edited.expense_date, correctedDate);
  assert.equal(edited.due_date, correctedDate);
  assert.equal(edited.paid_date, correctedDate);
  assert.equal(edited.reference_month, correctedDate.slice(0, 7));
  assert.equal(edited.amount_cents, 5_500);
  assert.equal(edited.category_id, correctedClass.category.id);
  assert.equal(edited.subcategory_id, correctedClass.subcategory.id);
  assert.equal(x.finance.expenses(x.actor, originalDate.slice(0, 7)).summary.variable_cents, 0);
  assert.equal(x.finance.expenses(x.actor, correctedDate.slice(0, 7)).summary.variable_cents, 5_500);
  assert.equal(x.db.get('SELECT COUNT(*) AS total FROM operating_expenses WHERE tenant_id=? AND id=?', x.actor.tenant_id, saved.id).total, 1);

  const auditRows = x.db.all("SELECT action,data_json FROM audit WHERE tenant_id=? AND entity='operating_expense' AND entity_id=? ORDER BY rowid", x.actor.tenant_id, saved.id);
  assert.equal(auditRows.length, beforeAudit + 1);
  assert.equal(auditRows.at(-1).action, 'updated');
  const auditData = JSON.parse(auditRows.at(-1).data_json);
  assert.equal(auditData.before.amount_cents, 4_000);
  assert.equal(auditData.after.amount_cents, 5_500);
  assert.throws(() => x.finance.saveExpense(x.actor, {
    version: saved.version,
    amount_cents: 6_000
  }, saved.id), /outra tela/);
});

test('tipo é imutável e variável paga não aceita pagar novamente nem reabrir', t => {
  const x = setup(t);
  const ids = classification(x);
  const saved = x.finance.saveExpense(x.actor, variablePayload(ids)).expenses[0];

  assert.throws(() => x.finance.saveExpense(x.actor, {
    version: saved.version,
    kind: 'fixed',
    amount_cents: saved.amount_cents,
    reference_month: saved.reference_month,
    due_date: saved.due_date,
    description: 'Tentativa de troca'
  }, saved.id), /tipo.*não pode ser alterado/i);
  assert.throws(() => x.finance.updateExpenseState(x.actor, saved.id, {
    action: 'pay',
    version: saved.version,
    paid_date: saved.paid_date
  }), /já representam pagamentos|não usam esta ação/i);
  assert.throws(() => x.finance.updateExpenseState(x.actor, saved.id, {
    action: 'reopen',
    version: saved.version,
    notes: 'Não deveria reabrir'
  }), /já representam pagamentos|não usam esta ação|não podem ficar a pagar/i);
});

test('cancelamento da variável paga preserva histórico e a exclui dos totais sem exclusão física', t => {
  const x = setup(t);
  const ids = classification(x);
  const expenseDate = dateIn(1);
  const saved = x.finance.saveExpense(x.actor, variablePayload(ids, {
    expense_date: expenseDate,
    amount_cents: 7_000
  })).expenses[0];

  const cancelled = x.finance.updateExpenseState(x.actor, saved.id, {
    action: 'cancel',
    version: saved.version,
    notes: 'Lançamento duplicado'
  });
  assert.ok(cancelled.voided_at);
  assert.equal(cancelled.version, saved.version + 1);
  assert.equal(x.finance.expenses(x.actor, expenseDate.slice(0, 7)).summary.variable_cents, 0);
  assert.equal(x.finance.expenses(x.actor, expenseDate.slice(0, 7)).rows.find(row => row.id === saved.id).state, 'cancelled');
  assert.equal(x.db.get('SELECT COUNT(*) AS total FROM operating_expenses WHERE tenant_id=? AND id=?', x.actor.tenant_id, saved.id).total, 1);
  assert.equal(x.db.get("SELECT COUNT(*) AS total FROM audit WHERE tenant_id=? AND entity='operating_expense' AND entity_id=? AND action='cancel'", x.actor.tenant_id, saved.id).total, 1);
});

test('replay individual e em lote continua idempotente depois do fechamento do mês', t => {
  const x = setup(t);
  const ids = classification(x);
  const expenseDate = dateIn(4, '14');
  const individualPayload = variablePayload(ids, {
    request_id: randomUUID(),
    expense_date: expenseDate,
    amount_cents: 8_000
  });
  const batchPayload = {
    request_id: randomUUID(),
    expenses: [{
      date: expenseDate,
      description: 'Segunda variável',
      amount_cents: 9_000,
      category_id: ids.category.id,
      subcategory_id: ids.subcategory.id
    }]
  };
  const individual = x.finance.saveExpense(x.actor, individualPayload);
  const batch = x.finance.saveVariableBatch(x.actor, batchPayload);
  closeMonth(x, expenseDate.slice(0, 7));
  const countsBeforeReplay = {
    expenses: x.db.get('SELECT COUNT(*) AS total FROM operating_expenses').total,
    audit: x.db.get('SELECT COUNT(*) AS total FROM audit').total,
    batches: x.db.get('SELECT COUNT(*) AS total FROM expense_batches').total
  };

  const individualReplay = x.finance.saveExpense(x.actor, individualPayload);
  const batchReplay = x.finance.saveVariableBatch(x.actor, batchPayload);
  assert.equal(individualReplay.replayed, true);
  assert.equal(batchReplay.replayed, true);
  assert.deepEqual(individualReplay.expenses.map(row => row.id), individual.expenses.map(row => row.id));
  assert.deepEqual(batchReplay.expenses.map(row => row.id), batch.expenses.map(row => row.id));
  assert.deepEqual({
    expenses: x.db.get('SELECT COUNT(*) AS total FROM operating_expenses').total,
    audit: x.db.get('SELECT COUNT(*) AS total FROM audit').total,
    batches: x.db.get('SELECT COUNT(*) AS total FROM expense_batches').total
  }, countsBeforeReplay);
  assert.throws(() => x.finance.saveExpense(x.actor, {
    version: individual.expenses[0].version,
    amount_cents: 10_000
  }, individual.expenses[0].id), /fechado/);
});

test('despesa fixa mantém fluxo de lembrete, pagamento e reabertura', t => {
  const x = setup(t);
  const payload = {
    request_id: randomUUID(),
    kind: 'fixed',
    description: 'Aluguel da loja',
    amount_cents: 10_000,
    reference_month: today.slice(0, 7),
    due_date: today,
    reminder_days: 3,
    payee: 'Locador',
    notes: ''
  };
  const saved = x.finance.saveExpense(x.actor, payload).expenses[0];
  assert.equal(saved.kind, 'fixed');
  assert.equal(saved.paid_date, null);
  assert.equal(x.finance.reminders(x.actor, today).items.some(row => row.id === saved.id), true);

  const paid = x.finance.updateExpenseState(x.actor, saved.id, {
    action: 'pay',
    version: saved.version,
    paid_date: today,
    notes: ''
  });
  assert.equal(paid.paid_date, today);
  assert.equal(x.finance.reminders(x.actor, today).items.some(row => row.id === saved.id), false);

  const reopened = x.finance.updateExpenseState(x.actor, saved.id, {
    action: 'reopen',
    version: paid.version,
    notes: 'Pagamento marcado por engano'
  });
  assert.equal(reopened.paid_date, null);
  assert.equal(x.finance.reminders(x.actor, today).items.some(row => row.id === saved.id), true);
});
