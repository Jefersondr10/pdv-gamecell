// Isolated manual QA only. All records live in memory and disappear at shutdown.
import { randomUUID } from 'node:crypto';
import { Store } from '../src/store.mjs';
import { application } from '../src/server.mjs';
import { businessDate } from '../src/domain.mjs';
import { installMobilePreview } from './mobile-preview-shell.mjs';
const previewPort=Number(process.env.PDV_PREVIEW_PORT??process.argv[2]??3011);
if(!Number.isInteger(previewPort)||previewPort<1024||previewPort>65535)throw Error('Porta de prévia inválida.');
const store = new Store(':memory:');
const actor = store.actor(store.register({ name: 'Pessoa de teste', store_name: 'Gamecell · Teste mobile', email: 'mobile@example.test', password: 'teste-mobile-isolado-2026' }).token);
const today = businessDate(), month = today.slice(0,7);
const customer = store.addCustomer(actor, { name: 'Cliente de demonstração com nome completo', phone: '(11) 99999-0000' });
const secondSeller = store.addUser(actor, { name: 'Ana Ribeiro', email: 'ana@example.test', password: 'senha-ficticia-de-teste', permissions: [] });
const product = store.addProduct(actor, { name: 'Smartphone 256 GB — produto de demonstração', sku: 'TESTE-001', price_cents: 279990 });
const accessory = store.addProduct(actor, { name: 'Controle sem fio', sku: 'TESTE-002', price_cents: 18000 });
store.operations.receive(actor, { product_id: product.id, quantity: 10, unit_cost_cents: 190000, request_id: randomUUID() });
store.operations.receive(actor, { product_id: accessory.id, quantity: 5, unit_cost_cents: 17000, request_id: randomUUID() });
const sale = store.saveDraft(actor, { customer_id: customer.id, seller_id: actor.id, items: [{ product_id: product.id, quantity: 1, unit_price_cents: 279990, serial_number: 'SN-TESTE-001' }]}).id;
store.addPayment(actor, sale, { method: 'cash', amount_cents: 279990, request_id: randomUUID() });
store.confirm(actor, sale, true);
const readyStatus=store.saveSaleStatus(actor,{name:'Pronto para entrega',color:'blue'});
store.setOperationalStatus(actor,sale,{operational_status_id:readyStatus.id});
store.setReviewManual(actor,sale,{review_manual:true,edit_token:store.sale(actor,sale).edit_token});
const yesterdayDate=new Date(`${today}T12:00:00Z`);yesterdayDate.setUTCDate(yesterdayDate.getUTCDate()-1);
const yesterday=yesterdayDate.toISOString().slice(0,10);
const wholesaleSale=store.saveDraft(actor,{customer_id:customer.id,seller_id:secondSeller.id,business_date:yesterday,is_wholesale:true,items:[{product_id:product.id,quantity:1,unit_price_cents:250000,serial_number:'SN-TESTE-002'}]}).id;
store.addPayment(actor,wholesaleSale,{method:'cash',amount_cents:250000,request_id:randomUUID()});
store.confirm(actor,wholesaleSale,true);
const accessorySale=store.saveDraft(actor,{customer_id:customer.id,seller_id:secondSeller.id,items:[{product_id:accessory.id,quantity:5,unit_price_cents:18000}]}).id;
store.addPayment(actor,accessorySale,{method:'cash',amount_cents:90000,request_id:randomUUID()});
store.confirm(actor,accessorySale,true);
const cancelledSale=store.saveDraft(actor,{customer_id:customer.id,seller_id:actor.id,items:[{product_id:product.id,quantity:1,unit_price_cents:125000,serial_number:'SN-TESTE-003'}]}).id;
store.addPayment(actor,cancelledSale,{method:'cash',amount_cents:125000,request_id:randomUUID()});
store.confirm(actor,cancelledSale,true);
const cancellationToken=store.sale(actor,cancelledSale).edit_token;
store.operations.cancelSale(actor,cancelledSale,{request_id:randomUUID(),edit_token:cancellationToken,reason:'Pedido cancelado para testar o histórico',acknowledge_stock_return:true});
store.savePixAccount(actor, { name: 'Conta Pix de demonstração' });
// Percentuais fictícios para demonstração, sem representar condições de uma loja/adquirente.
store.saveCardMachine(actor,{name:'Máquina de demonstração',brands:[{name:'Visa / Mastercard',debit_basis_points:200,credit_rates:Array.from({length:18},(_,i)=>({installments:i+1,basis_points:300+i*100}))}]});
for (const [description, amount] of [['Aluguel da loja',180000],['Internet e telefonia',14990]]) {
  store.finance.saveExpense(actor, { request_id: randomUUID(), description, kind: 'fixed', amount_cents: amount, reference_month: month, due_date: today, category: 'Estrutura', reminder_days: 3 });
}
const variableCategory=store.finance.saveCategory(actor,{name:'Operação',applicability:'variable'});
const variableSubcategory=store.finance.saveSubcategory(actor,{category_id:variableCategory.id,name:'Materiais',applicability:'variable'});
store.finance.saveExpense(actor,{request_id:randomUUID(),kind:'variable',expense_date:today,description:'Material de limpeza e embalagens para os pedidos',amount_cents:8560,category_id:variableCategory.id,subcategory_id:variableSubcategory.id});
const { server } = application({ store, origin: `http://127.0.0.1:${previewPort}` });
installMobilePreview(server,{cookieName:`pdv_mobile_preview_session_${previewPort}`});
server.listen(previewPort, '127.0.0.1', () => console.log(`Prévia isolada: http://127.0.0.1:${previewPort}/mobile-preview`));
for (const signal of ['SIGINT','SIGTERM']) process.on(signal, () => server.close(() => {store.close();process.exit(0);}));
