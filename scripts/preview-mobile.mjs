// Isolated manual QA only. All records live in memory and disappear at shutdown.
import { randomUUID } from 'node:crypto';
import { Store } from '../src/store.mjs';
import { application } from '../src/server.mjs';
import { businessDate } from '../src/domain.mjs';
import { installMobilePreview } from './mobile-preview-shell.mjs';
const previewPort=Number(process.env.PDV_PREVIEW_PORT??3011);
if(!Number.isInteger(previewPort)||previewPort<1024||previewPort>65535)throw Error('Porta de prévia inválida.');
const store = new Store(':memory:');
const actor = store.actor(store.register({ name: 'Pessoa de teste', store_name: 'Gamecell · Teste mobile', email: 'mobile@example.test', password: 'teste-mobile-isolado-2026' }).token);
const today = businessDate(), month = today.slice(0,7);
const customer = store.addCustomer(actor, { name: 'Cliente de demonstração com nome completo', phone: '(11) 99999-0000' });
const product = store.addProduct(actor, { name: 'Smartphone 256 GB — produto de demonstração', sku: 'TESTE-001', price_cents: 279990 });
store.operations.receive(actor, { product_id: product.id, quantity: 10, unit_cost_cents: 190000, request_id: randomUUID() });
const sale = store.saveDraft(actor, { customer_id: customer.id, seller_id: actor.id, items: [{ product_id: product.id, quantity: 1, unit_price_cents: 279990, serial_number: 'SN-TESTE-001' }]}).id;
store.addPayment(actor, sale, { method: 'cash', amount_cents: 279990, request_id: randomUUID() });
store.confirm(actor, sale, true);
store.savePixAccount(actor, { name: 'Conta Pix de demonstração' });
// Percentuais fictícios para demonstração, sem representar condições de uma loja/adquirente.
store.saveCardMachine(actor,{name:'Máquina de demonstração',brands:[{name:'Visa / Mastercard',debit_basis_points:200,credit_rates:Array.from({length:18},(_,i)=>({installments:i+1,basis_points:300+i*100}))}]});
for (const [description, kind, amount] of [['Aluguel da loja','fixed',180000],['Internet e telefonia','fixed',14990],['Material de limpeza e embalagens para os pedidos','variable',8560]]) {
  store.finance.saveExpense(actor, { request_id: randomUUID(), description, kind, amount_cents: amount, reference_month: month, due_date: today, category: kind==='fixed'?'Estrutura':'Materiais', reminder_days: 3 });
}
const { server } = application({ store, origin: `http://127.0.0.1:${previewPort}` });
installMobilePreview(server,{cookieName:`pdv_mobile_preview_session_${previewPort}`});
server.listen(previewPort, '127.0.0.1', () => console.log(`Prévia isolada: http://127.0.0.1:${previewPort}/mobile-preview`));
for (const signal of ['SIGINT','SIGTERM']) process.on(signal, () => server.close(() => {store.close();process.exit(0);}));
