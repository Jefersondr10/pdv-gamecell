import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';
import { jsx, jsxs } from 'react/jsx-runtime';

// Run the real component handlers with controlled hooks and deferred browser
// boundaries. These checks never connect to a server or change user data.
function sourceFunction(file, name) {
  const source = ts.createSourceFile(
    file,
    readFileSync(file, 'utf8'),
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TSX,
  );
  return source.statements.find(
    (node) => ts.isFunctionDeclaration(node) && node.name?.text === name,
  );
}
function find(node, predicate) {
  if (predicate(node)) return node;
  return ts.forEachChild(node, (child) => find(child, predicate));
}
function evaluate(source, globals) {
  const output = ts.transpileModule(`const subject = ${source};`, {
    compilerOptions: {
      target: ts.ScriptTarget.ES2022,
      module: ts.ModuleKind.CommonJS,
      jsx: ts.JsxEmit.ReactJSX,
    },
  }).outputText;
  return runInNewContext(`${output}\nsubject;`, {
    exports: {},
    require: () => ({ jsx, jsxs }),
    ...globals,
  });
}
function mount(file, name, props, globals = {}) {
  const node = sourceFunction(file, name);
  const tags = {};
  const visit = (child) => {
    if (ts.isJsxOpeningElement(child) || ts.isJsxSelfClosingElement(child)) {
      const tag = child.tagName.getText();
      if (/^[A-Z]\w*$/.test(tag)) tags[tag] = tag;
    }
    ts.forEachChild(child, visit);
  };
  visit(node);
  const slots = [];
  const cleanup = [];
  let cursor = 0;
  const hooks = {
    useState(initial) {
      const index = cursor++;
      if (!(index in slots))
        slots[index] = typeof initial === 'function' ? initial() : initial;
      return [
        slots[index],
        (value) => {
          slots[index] =
            typeof value === 'function' ? value(slots[index]) : value;
        },
      ];
    },
    useRef(initial) {
      const index = cursor++;
      if (!(index in slots)) slots[index] = { current: initial };
      return slots[index];
    },
    useEffect(effect) {
      const index = cursor++;
      if (!(index in slots)) {
        slots[index] = true;
        cleanup.push(effect());
      }
    },
  };
  const component = evaluate(node.getText().replace(/^export\s+/, ''), {
    ...tags,
    ...hooks,
    messageOf: (error) => error.message,
    createOperationId: () => 'test-operation',
    ...globals,
  });
  return {
    render() {
      cursor = 0;
      return component(props);
    },
    unmount() {
      cleanup.forEach((dispose) => dispose?.());
    },
  };
}
function nodes(root) {
  if (Array.isArray(root)) return root.flatMap(nodes);
  if (!root || typeof root !== 'object') return [];
  return [root, ...nodes(root.props?.children)];
}
function text(root) {
  if (Array.isArray(root)) return root.map(text).join('');
  if (root == null || typeof root === 'boolean') return '';
  return typeof root === 'object' ? text(root.props?.children) : String(root);
}
const byType = (root, type) => nodes(root).find((node) => node.type === type);
const button = (root, label) =>
  nodes(root).find(
    (node) => node.type === 'Button' && text(node).includes(label),
  );
const submit = (root) =>
  byType(root, 'form').props.onSubmit({ preventDefault() {} });
const settle = () => new Promise((resolve) => setImmediate(resolve));
function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}

const catalog = 'components/pdv/views/catalog-production-view.tsx';
let closes = 0;
let writes = 0;
const clientRequest = deferred();
const client = mount(
  catalog,
  'ClientEditor',
  {
    client: {
      id: 'client-a',
      name: 'Cliente A',
      phone: null,
      email: null,
      notes: null,
      active: true,
    },
    csrfToken: 'test',
    onChanged: async () => {},
    onClose: () => {
      closes++;
    },
  },
  {
    clientEditorPayload: (values) => values,
    patchJson: () => {
      writes++;
      return clientRequest.promise;
    },
  },
);
const beforeClient = client.render();
submit(beforeClient);
submit(beforeClient);
beforeClient.props.onClose();
assert.equal(writes, 1, 'duplicate submit is ignored before React rerenders');
assert.equal(closes, 0, 'close is blocked immediately after submit');
const busyClient = client.render();
assert.equal(busyClient.props.busy, true);
assert.ok(
  nodes(busyClient)
    .filter((node) => ['Input', 'Textarea'].includes(node.type))
    .every((node) => node.props.disabled),
);
client.unmount();
clientRequest.resolve({ ok: true });
await settle();
assert.equal(
  closes,
  0,
  'an old client response cannot close a newly opened editor',
);

const productRequest = deferred();
let productWrites = 0;
let productCloses = 0;
const product = mount(
  catalog,
  'ProductEditor',
  {
    product: {
      id: 'product-a',
      model: 'iPhone',
      color: 'Preto',
      memory: '128 GB',
      defaultPriceCents: 400000,
      active: true,
      codes: [],
    },
    csrfToken: 'test',
    onChanged: async () => {},
    onStatusChanged: async () => {},
    onClose: () => {
      productCloses++;
    },
  },
  {
    APPLE_COLOR_SUGGESTIONS: [],
    PRODUCT_MARKET_OPTIONS: [],
    appleMemoryOptions: () => ['128 GB'],
    moneyInput: () => '4.000,00',
    productEditorPayload: () => ({ color: 'Azul' }),
    patchJson: () => {
      productWrites++;
      return productRequest.promise;
    },
  },
);
const beforeProduct = product.render();
submit(beforeProduct);
submit(beforeProduct);
beforeProduct.props.onClose();
assert.equal(productWrites, 1, 'duplicate product submit is ignored');
assert.equal(productCloses, 0, 'product editor cannot close while saving');
const busyProduct = product.render();
assert.equal(busyProduct.props.busy, true);
assert.ok(
  nodes(busyProduct)
    .filter((node) =>
      ['Input', 'NativeSelect', 'MoneyInput', 'Textarea'].includes(node.type),
    )
    .every((node) => node.props.disabled),
  'all product fields are locked while the mutation is pending',
);
product.unmount();
productRequest.resolve({ ok: true });
await settle();
assert.equal(productCloses, 0, 'a stale product response cannot close a new editor');

const settings = 'components/pdv/views/settings-production-view.tsx';
const rotationRequest = deferred();
let rotations = 0;
const recovery = mount(
  settings,
  'RecoveryCodesDialog',
  {
    data: { csrfToken: 'test' },
    open: true,
    onOpenChange: () => {
      closes++;
    },
  },
  {
    requestJson: () => {
      rotations++;
      return rotationRequest.promise;
    },
  },
);
const beforeRotation = recovery.render();
const rotating = submit(beforeRotation);
await submit(beforeRotation);
beforeRotation.props.onOpenChange(false);
assert.equal(rotations, 1);
assert.equal(closes, 0);
assert.equal(
  byType(recovery.render(), 'DialogContent').props.showCloseButton,
  false,
);
rotationRequest.resolve({ recoveryCodes: ['CODE-ONE', 'CODE-TWO'] });
await rotating;
// Even a queued close callback from before the response must keep the new list.
beforeRotation.props.onOpenChange(false);
assert.equal(closes, 0);
const generated = recovery.render();
generated.props.onOpenChange(false);
assert.equal(closes, 0);
assert.equal(byType(generated, 'DialogContent').props.showCloseButton, false);
byType(generated, 'RecoveryCodesPanel').props.onContinue();
assert.equal(
  closes,
  1,
  'the confirmed Continue path can clear and close the list',
);

const panelFile = 'components/pdv/recovery-codes-panel.tsx';
for (const clipboard of [
  undefined,
  {
    writeText: async () => {
      throw new Error('Clipboard denied');
    },
  },
]) {
  const panel = mount(
    panelFile,
    'RecoveryCodesPanel',
    { codes: ['CODE-ONE'], onContinue() {} },
    {
      recoveryText: (codes) => codes.join('\n'),
      navigator: { clipboard },
    },
  );
  let rendered = panel.render();
  assert.equal(button(rendered, 'Continuar').props.disabled, true);
  await button(rendered, 'Copiar').props.onClick();
  rendered = panel.render();
  assert.ok(
    nodes(rendered).some(
      (node) =>
        node.props?.role === 'alert' && text(node).includes('Use Baixar'),
    ),
  );
  assert.ok(button(rendered, 'Copiar'));
  assert.equal(
    button(rendered, 'Continuar').props.disabled,
    true,
    'failed copying never marks codes as saved',
  );
  nodes(rendered)
    .find((node) => node.type === 'input')
    .props.onChange({ target: { checked: true } });
  assert.equal(button(panel.render(), 'Continuar').props.disabled, false);
}

const sales = 'components/pdv/views/sales-production-view.tsx';
const cancelRequest = deferred();
let cancellations = 0;
let cancelCloses = 0;
const cancellation = mount(
  sales,
  'CancelDialog',
  {
    sale: { id: 'sale-a', number: 1 },
    data: { csrfToken: 'test' },
    onChanged: async () => {},
    onOpenChange: () => {
      cancelCloses++;
    },
  },
  {
    requestJson: () => {
      cancellations++;
      return cancelRequest.promise;
    },
  },
);
let renderedCancel = cancellation.render();
byType(renderedCancel, 'Textarea').props.onChange({
  target: { value: 'Motivo válido' },
});
renderedCancel = cancellation.render();
const cancelPending = button(
  renderedCancel,
  'Confirmar cancelamento',
).props.onClick();
await button(renderedCancel, 'Confirmar cancelamento').props.onClick();
renderedCancel.props.onOpenChange(false);
button(renderedCancel, 'Voltar').props.onClick();
assert.equal(cancellations, 1);
assert.equal(cancelCloses, 0);
assert.equal(
  byType(cancellation.render(), 'DialogContent').props.showCloseButton,
  false,
);
cancellation.unmount();
cancelRequest.resolve({ ok: true });
await cancelPending;
assert.equal(cancelCloses, 0, 'old cancellation cannot dismiss another sale');
assert.match(
  readFileSync(sales, 'utf8'),
  /<CancelDialog\s+key=\{cancelSale\?\.id/,
);

// A rejected mutation keeps its form available, reports the rejection and can
// be retried; it must not be presented as a successful close.
for (const target of ['ClientEditor', 'CancelDialog']) {
  let attempts = 0;
  let closed = 0;
  const mutate = async () => {
    attempts++;
    if (attempts === 1) throw new Error('Gravação recusada');
  };
  const screen = mount(
    target === 'ClientEditor' ? catalog : sales,
    target,
    {
      client: { id: 'a', name: 'Cliente A', active: true },
      sale: { id: 'a', number: 1 },
      data: { csrfToken: 'test' },
      csrfToken: 'test',
      onChanged: async () => {},
      onClose: () => {
        closed++;
      },
      onOpenChange: () => {
        closed++;
      },
    },
    {
      patchJson: mutate,
      requestJson: mutate,
      clientEditorPayload: (values) => values,
    },
  );
  const save = () =>
    target === 'ClientEditor'
      ? submit(screen.render())
      : button(screen.render(), 'Confirmar cancelamento').props.onClick();
  await save();
  await settle();
  assert.equal(closed, 0);
  assert.ok(text(screen.render()).includes('Gravação recusada'));
  assert.equal(
    target === 'ClientEditor'
      ? screen.render().props.busy
      : byType(screen.render(), 'DialogContent').props.showCloseButton,
    target !== 'ClientEditor',
  );
  await save();
  await settle();
  assert.equal(attempts, 2);
  assert.equal(closed, 1);
}

const copyRequest = deferred();
let copies = 0;
const copyPanel = mount(
  panelFile,
  'RecoveryCodesPanel',
  { codes: ['CODE-ONE'], onContinue() {} },
  {
    recoveryText: (codes) => codes.join('\n'),
    navigator: {
      clipboard: {
        writeText: () => {
          copies++;
          return copyRequest.promise;
        },
      },
    },
  },
);
const copyButton = button(copyPanel.render(), 'Copiar');
const copyPending = copyButton.props.onClick();
await copyButton.props.onClick();
assert.equal(copies, 1);
assert.equal(button(copyPanel.render(), 'Copiando…').props.disabled, true);
copyRequest.resolve();
await copyPending;
assert.ok(button(copyPanel.render(), 'Copiados'));
assert.equal(button(copyPanel.render(), 'Continuar').props.disabled, true);

const app = 'components/pdv/production-app.tsx';
let reloads = 0;
const lazyLoading = mount(
  app,
  'ViewLoading',
  {},
  {
    window: {
      location: {
        reload: () => {
          reloads++;
        },
      },
    },
  },
);
assert.ok(text(lazyLoading.render()).includes('Abrindo…'));
assert.equal(button(lazyLoading.render(), 'Atualizar sistema'), undefined);
for (const error of [
  new Error('Failed to fetch dynamically imported module: /assets/old.js'),
  new Error('Importing a module script failed.'),
  new Error('Loading chunk 42 failed.'),
]) {
  const loadingFailure = mount(
    app,
    'ViewLoading',
    { error },
    {
      window: {
        location: {
          reload: () => {
            reloads++;
          },
        },
      },
    },
  );
  const rendered = loadingFailure.render();
  assert.ok(nodes(rendered).some((node) => node.props?.role === 'alert'));
  assert.equal(text(rendered).includes('Abrindo…'), false);
  assert.ok(button(rendered, 'Atualizar sistema'));
  loadingFailure.render();
}
assert.equal(
  reloads,
  0,
  'failed lazy chunks never trigger an automatic reload loop',
);
const failedChunk = mount(
  app,
  'ViewLoading',
  { error: new Error('Failed to fetch dynamically imported module') },
  {
    window: {
      location: {
        reload: () => {
          reloads++;
        },
      },
    },
  },
);
const updateButton = button(failedChunk.render(), 'Atualizar sistema');
updateButton.props.onClick();
updateButton.props.onClick();
assert.equal(reloads, 1);
assert.equal(button(failedChunk.render(), 'Atualizando…').props.disabled, true);
assert.equal(
  (readFileSync(app, 'utf8').match(/loading: ViewLoading/g) ?? []).length,
  7,
);
const cloud = sourceFunction(app, 'CloudPdv');
const logoutDeclaration = find(
  cloud,
  (node) => ts.isVariableDeclaration(node) && node.name.getText() === 'logout',
);
for (const succeeds of [false, true]) {
  const request = deferred();
  const state = {
    busy: false,
    error: 'old error',
    calls: 0,
    disposed: 0,
    redirects: 0,
  };
  const logout = evaluate(logoutDeclaration.initializer.getText(), {
    logoutBusyRef: { current: false },
    setLogoutBusy: (value) => {
      state.busy = value;
    },
    setLogoutError: (value) => {
      state.error = value;
    },
    messageOf: (error) => error.message,
    data: { csrfToken: 'test' },
    session: { csrfToken: 'test' },
    requestJson: () => {
      state.calls++;
      return request.promise;
    },
    backGuard: {
      dispose: () => {
        state.disposed++;
      },
    },
    window: {
      location: {
        replace: () => {
          state.redirects++;
        },
      },
    },
  });
  const pending = logout();
  await logout();
  assert.equal(state.calls, 1);
  assert.equal(state.busy, true);
  assert.equal(state.error, '');
  if (succeeds) request.resolve({ ok: true });
  else request.reject(new Error('Sem conexão'));
  await pending;
  assert.equal(state.redirects, succeeds ? 1 : 0);
  assert.equal(state.disposed, succeeds ? 1 : 0);
  assert.equal(state.busy, succeeds);
  assert.equal(
    state.error,
    succeeds ? '' : 'A saída não foi confirmada. Sem conexão',
  );
}
const profile = mount(
  app,
  'ProfileDialog',
  {
    data: {
      user: { displayName: 'Pessoa', role: 'owner' },
      store: { name: 'Loja' },
    },
    open: true,
    logoutBusy: true,
    logoutError: 'A saída não foi confirmada.',
  },
  { roleLabel: () => 'Proprietário', can: () => true },
);
assert.ok(
  nodes(profile.render())
    .filter((node) => node.type === 'Button')
    .every((node) => node.props.disabled),
);
assert.ok(nodes(profile.render()).some((node) => node.props?.role === 'alert'));
for (const name of ['RequiredPasswordChange', 'StoreSetup']) {
  const failure = deferred();
  let calls = 0;
  const screen = mount(
    app,
    name,
    { csrfToken: 'test', displayName: 'Pessoa' },
    {
      isPrimaryStoreCode: () => false,
      logoutSession: () => {
        calls++;
        return failure.promise;
      },
    },
  );
  const logoutButton = button(screen.render(), 'Sair e usar outra conta');
  logoutButton.props.onClick();
  logoutButton.props.onClick();
  assert.equal(calls, 1);
  assert.equal(button(screen.render(), 'Saindo…').props.disabled, true);
  failure.reject(new Error('Sem conexão'));
  await settle();
  assert.ok(
    text(screen.render()).includes('A saída não foi confirmada. Sem conexão'),
  );
  assert.equal(
    button(screen.render(), 'Sair e usar outra conta').props.disabled,
    false,
  );
}
console.log(
  'UI action guards: duplicate submits, busy closes, stale responses, recovery acknowledgement, clipboard errors, logout failures and lazy-chunk recovery passed.',
);
