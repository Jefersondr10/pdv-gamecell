import { randomUUID, createHash } from 'node:crypto';
import { pendingRefunds, acknowledgeRefundReserve } from './sale-cancellation.mjs';
import { check, integer, text, businessDate, requirePermission, feeCents, sumMoney } from './domain.mjs';

const now = () => new Date().toISOString();
const hash = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const uuid = value => { check(typeof value === 'string' && /^[a-f0-9]{8}-[a-f0-9]{4}-[1-5][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i.test(value), 'Identificador de solicitação inválido.'); return value.toLowerCase(); };
export function validDate(value) {
  check(typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value) && value >= '2000-01-01' && value <= '2199-12-31', 'Data inválida.');
  const date = new Date(`${value}T12:00:00Z`);
  check(!Number.isNaN(date.getTime()) && date.toISOString().slice(0,10) === value, 'Data inválida.');
  return value;
}
export function validMonth(value) { check(typeof value === 'string' && /^(20|21)\d{2}-(0[1-9]|1[0-2])$/.test(value), 'Mês inválido.'); return value; }
export function shiftMonth(month, offset) {
  validMonth(month); const [year, monthNumber] = month.split('-').map(Number);
  const d = new Date(Date.UTC(year, monthNumber - 1 + offset, 1));
  return validMonth(d.toISOString().slice(0,7));
}
export function monthlyDue(date, offset) {
  validDate(date); const month = shiftMonth(date.slice(0,7), offset), [year, monthNumber] = month.split('-').map(Number);
  const day = Math.min(Number(date.slice(8)), new Date(Date.UTC(year, monthNumber, 0)).getUTCDate());
  return `${month}-${String(day).padStart(2,'0')}`;
}
const dayDistance = (a,b) => Math.round((new Date(`${b}T12:00:00Z`) - new Date(`${a}T12:00:00Z`)) / 86400000);
const stateOf = (row,today) => row.voided_at ? 'cancelled' : row.paid_date ? 'paid' : row.due_date < today ? 'overdue' : row.due_date === today ? 'today' : 'open';
const validScope=value=>{check(['both','fixed','variable'].includes(value),'Selecione Fixas, Variáveis ou Ambas.');return value;};
const scopeAccepts=(scope,kind)=>scope==='both'||scope===kind;
const expenseTotal=values=>{const total=values.reduce((sum,v)=>sum+BigInt(v),0n);check(total<=BigInt(Number.MAX_SAFE_INTEGER),'Total de despesas fora do limite seguro.');return Number(total);};

export function distributeProfit(result, reserveBasisPoints, partners) {
  const positive = Math.max(0,result), retained = feeCents(positive,reserveBasisPoints), pool = positive - retained;
  const allocations = partners.map(p => ({ ...p, amount_cents: Number(BigInt(pool) * BigInt(p.basis_points) / 10000n), remainder: Number(BigInt(pool) * BigInt(p.basis_points) % 10000n) }));
  let centsLeft = pool - allocations.reduce((sum,p) => sum + p.amount_cents,0);
  for (const p of [...allocations].sort((a,b) => b.remainder-a.remainder || a.id.localeCompare(b.id))) { if (centsLeft-- > 0) p.amount_cents++; }
  return { reserve_cents: retained, distribution_cents: pool, partners: allocations.map(({remainder,...p})=>p) };
}

/** Finanças da loja: acesso explícito, valores em centavos e fotografia imutável do fechamento. */
export class Finance {
  constructor(store) { this.store = store; }
  access(actor, write=false, closing=false) {
    requirePermission(actor, closing ? 'finance.view' : 'expenses.view');
    if (write) requirePermission(actor, closing ? 'finance.manage' : 'expenses.manage');
  }
  expense(actor,key) {
    const row = this.store.get('SELECT e.*,l.category_id,sl.subcategory_id,sl.name AS subcategory FROM operating_expenses e LEFT JOIN expense_category_links l ON l.tenant_id=e.tenant_id AND l.expense_id=e.id LEFT JOIN expense_subcategory_links sl ON sl.tenant_id=e.tenant_id AND sl.expense_id=e.id WHERE e.tenant_id=? AND e.id=?',actor.tenant_id,key);
    check(row,'Despesa não encontrada.',404); return row;
  }
  categories(actor) {
    this.access(actor);
    return this.store.all(`SELECT c.*,COALESCE(sc.applicability,'both') AS applicability, (SELECT COUNT(*) FROM expense_category_links l WHERE l.tenant_id=c.tenant_id AND l.category_id=c.id) AS expense_count
      FROM expense_categories c LEFT JOIN expense_category_scopes sc ON sc.tenant_id=c.tenant_id AND sc.category_id=c.id WHERE c.tenant_id=? ORDER BY c.active DESC,c.name_key,c.id`,actor.tenant_id).map(c=>({...c,active:!!c.active}));
  }
  saveCategory(actor,data,key=null) {
    this.access(actor,true);
    const name=text(data.name,'Nome da categoria',100).replace(/\s+/g,' '),nameKey=name.normalize('NFKC').toLocaleLowerCase('pt-BR');
    return this.store.transaction(()=>{
      const old=key?this.categories(actor).find(c=>c.id===key):null;
      if(key){check(old,'Categoria não encontrada.',404);check(data.version===old.version,'Categoria alterada em outra tela. Atualize antes de salvar.',409);}
      const color=data.color??old?.color??'#9756F4',active=data.active??old?.active??true;
      check(typeof active==='boolean','Situação da categoria inválida.');
      check(typeof color==='string'&&/^#[0-9a-f]{6}$/i.test(color),'Cor da categoria inválida.');
      check(!this.store.get('SELECT id FROM expense_categories WHERE tenant_id=? AND name_key=? AND id<>?',actor.tenant_id,nameKey,key??''),'Já existe uma categoria com este nome, inclusive entre as inativas.',409);
      const applicability=validScope(data.applicability??old?.applicability??'both');
      check(!this.subcategories(actor).some(c=>c.category_id===key&&c.active&&!scopeAccepts(applicability,c.applicability)),'Ajuste primeiro as subcategorias ativas para este tipo de despesa.',409);
      const id=key??randomUUID(),at=now();
      if(old)this.store.run('UPDATE expense_categories SET name=?,name_key=?,color=?,active=?,version=version+1,updated_at=? WHERE tenant_id=? AND id=?',name,nameKey,color.toUpperCase(),Number(active),at,actor.tenant_id,id);
      else this.store.run('INSERT INTO expense_categories(id,tenant_id,name,name_key,color,active,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?)',id,actor.tenant_id,name,nameKey,color.toUpperCase(),Number(active),at,at);
      this.store.run('INSERT INTO expense_category_scopes VALUES(?,?,?) ON CONFLICT(tenant_id,category_id) DO UPDATE SET applicability=excluded.applicability',actor.tenant_id,id,applicability);
      this.store.audit(actor,'expense_category',id,old?'updated':'created',{before:old,after:{name,color:color.toUpperCase(),active,applicability}});
      return this.categories(actor).find(c=>c.id===id);
    });
  }
  subcategories(actor) {
    this.access(actor);
    return this.store.all(`SELECT s.*,(SELECT COUNT(*) FROM expense_subcategory_links l WHERE l.tenant_id=s.tenant_id AND l.subcategory_id=s.id) AS expense_count
      FROM expense_subcategories s WHERE s.tenant_id=? ORDER BY s.active DESC,s.name_key,s.id`,actor.tenant_id).map(s=>({...s,active:!!s.active}));
  }
  saveSubcategory(actor,data,key=null) {
    this.access(actor,true);
    const name=text(data.name,'Nome da subcategoria',100).replace(/\s+/g,' '),nameKey=name.normalize('NFKC').toLocaleLowerCase('pt-BR');
    return this.store.transaction(()=>{
      const old=key?this.subcategories(actor).find(c=>c.id===key):null;
      if(key){check(old,'Subcategoria não encontrada.',404);check(data.version===old.version,'Subcategoria alterada em outra tela. Atualize antes de salvar.',409);}
      const categoryId=uuid(data.category_id??old?.category_id),category=this.categories(actor).find(c=>c.id===categoryId);
      check(category,'Categoria não encontrada.',404);check(!old||old.category_id===categoryId,'Não é possível mover uma subcategoria. Crie outra na categoria desejada.');
      const active=data.active??old?.active??true,applicability=validScope(data.applicability??old?.applicability??category.applicability);
      check(typeof active==='boolean','Situação da subcategoria inválida.');
      check(!active||category.active,'Ative a categoria antes de ativar suas subcategorias.',409);
      check(!active||scopeAccepts(category.applicability,applicability),'A subcategoria deve respeitar os tipos permitidos na categoria.');
      check(!this.store.get('SELECT id FROM expense_subcategories WHERE tenant_id=? AND category_id=? AND name_key=? AND id<>?',actor.tenant_id,categoryId,nameKey,key??''),'Já existe uma subcategoria com este nome nesta categoria.',409);
      const id=key??randomUUID(),at=now();
      if(old)this.store.run('UPDATE expense_subcategories SET name=?,name_key=?,applicability=?,active=?,version=version+1,updated_at=? WHERE tenant_id=? AND id=?',name,nameKey,applicability,Number(active),at,actor.tenant_id,id);
      else this.store.run('INSERT INTO expense_subcategories(id,tenant_id,category_id,name,name_key,applicability,active,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?)',id,actor.tenant_id,categoryId,name,nameKey,applicability,Number(active),at,at);
      this.store.audit(actor,'expense_subcategory',id,old?'updated':'created',{before:old,after:{name,category_id:categoryId,applicability,active}});
      return this.subcategories(actor).find(c=>c.id===id);
    });
  }
  resolveExpenseCategory(actor,row,old=null) {
    if(!row.category_id){check(!row.subcategory_id,'Selecione a categoria da subcategoria.');return {...row,category_id:null,subcategory_id:null};}
    const category=this.categories(actor).find(c=>c.id===row.category_id);
    check(category,'Categoria não encontrada.',404);
    const kept=old?.category_id===category.id&&old.kind===row.kind;
    check(kept||category.active,'Esta categoria está inativa. Selecione uma categoria ativa.',409);
    check(kept||scopeAccepts(category.applicability,row.kind),'Esta categoria não está disponível para este tipo de despesa.');
    let sub=null;
    if(row.subcategory_id){
      sub=this.subcategories(actor).find(c=>c.id===row.subcategory_id);
      check(sub&&sub.category_id===category.id,'Subcategoria não encontrada nesta categoria.',404);
      const subKept=kept&&old?.subcategory_id===sub.id;
      check(subKept||(sub.active&&category.active),'Esta subcategoria ou sua categoria está inativa.',409);
      check(subKept||(scopeAccepts(category.applicability,row.kind)&&scopeAccepts(sub.applicability,row.kind)),'Esta subcategoria não está disponível para este tipo de despesa.');
    }
    return {...row,category:old?.category_id===category.id?old.category:category.name,subcategory_id:sub?.id??null,
      subcategory:sub?(old?.subcategory_id===sub.id?old.subcategory:sub.name):''};
  }
  linkExpenseCategory(actor,key,categoryId,row={}) {
    this.store.run('DELETE FROM expense_subcategory_links WHERE tenant_id=? AND expense_id=?',actor.tenant_id,key);
    if(categoryId)this.store.run('INSERT INTO expense_category_links(tenant_id,expense_id,category_id) VALUES(?,?,?) ON CONFLICT(tenant_id,expense_id) DO UPDATE SET category_id=excluded.category_id',actor.tenant_id,key,categoryId);
    else this.store.run('DELETE FROM expense_category_links WHERE tenant_id=? AND expense_id=?',actor.tenant_id,key);
    if(row.subcategory_id)this.store.run('INSERT INTO expense_subcategory_links VALUES(?,?,?,?,?)',actor.tenant_id,key,categoryId,row.subcategory_id,row.subcategory);
  }
  openMonth(actor,month) {
    check(!this.store.get('SELECT id FROM finance_closures WHERE tenant_id=? AND reference_month=?',actor.tenant_id,month),
      'Este mês já foi fechado. O valor e a competência das despesas estão protegidos.',409);
  }
  settings(actor) {
    this.access(actor,false,true);
    const row = this.store.get('SELECT * FROM finance_settings WHERE tenant_id=?',actor.tenant_id);
    return row ? { reserve_basis_points:row.reserve_basis_points, partners:JSON.parse(row.partners_json), version:row.version } : {reserve_basis_points:10000,partners:[],version:0};
  }
  saveSettings(actor,data) {
    this.access(actor,true,true);
    const reserve = integer(data.reserve_basis_points,'Percentual da loja',0,10000);
    check(Array.isArray(data.partners) && data.partners.length<=20,'Cadastre até 20 sócios.');
    const partners = data.partners.map(p=>({id:p.id ? uuid(p.id):randomUUID(), name:text(p.name,'Nome do sócio',100),basis_points:integer(p.basis_points,'Participação',1,10000)}));
    check(new Set(partners.map(p=>p.id)).size===partners.length && new Set(partners.map(p=>p.name.toLocaleLowerCase('pt-BR'))).size===partners.length,'Existem sócios repetidos.');
    check(partners.length ? partners.reduce((s,p)=>s+p.basis_points,0)===10000 : reserve===10000,'As participações dos sócios devem somar 100%. Sem sócios, mantenha 100% na loja.');
    return this.store.transaction(()=>{
      const previous = this.settings(actor); check(data.version===previous.version,'Configuração alterada em outra tela. Atualize antes de salvar.',409);
      this.store.run(`INSERT INTO finance_settings(tenant_id,reserve_basis_points,partners_json,version,updated_at) VALUES(?,?,?,?,?)
        ON CONFLICT(tenant_id) DO UPDATE SET reserve_basis_points=excluded.reserve_basis_points,partners_json=excluded.partners_json,version=excluded.version,updated_at=excluded.updated_at`,
        actor.tenant_id,reserve,JSON.stringify(partners),previous.version+1,now());
      this.store.audit(actor,'finance_settings',actor.tenant_id,'updated',{before:previous,after:{reserve_basis_points:reserve,partners}});
      return this.settings(actor);
    });
  }
  cleanExpense(data) {
    check(data && typeof data==='object' && !Array.isArray(data),'Despesa inválida.');
    check(['fixed','variable'].includes(data.kind),'Tipo de despesa inválido.');
    check(data.category_id===undefined||data.category_id===null||data.category_id===''||typeof data.category_id==='string','Categoria inválida.');
    check(data.subcategory_id===undefined||data.subcategory_id===null||data.subcategory_id===''||typeof data.subcategory_id==='string','Subcategoria inválida.');
    return { description:text(data.description,'Descrição',200), kind:data.kind, amount_cents:integer(data.amount_cents,'Valor',1),
      reference_month:validMonth(data.reference_month), due_date:validDate(data.due_date),
      category:text(data.category,'Categoria',100,false), payee:text(data.payee,'Favorecido',150,false),
      notes:text(data.notes,'Observações',2000,false), reminder_days:integer(data.reminder_days??3,'Antecedência',0,30),
      ...(data.category_id?{category_id:uuid(data.category_id)}:{}), ...(data.subcategory_id?{subcategory_id:uuid(data.subcategory_id)}:{}) };
  }
  saveVariableBatch(actor,data) {
    this.access(actor,true);const requestId=uuid(data.request_id);
    check(Array.isArray(data.expenses)&&data.expenses.length>=1&&data.expenses.length<=50,'Informe de 1 a 50 despesas variáveis por vez.');
    const rows=data.expenses.map((row,index)=>{
      try {
        check(row&&typeof row==='object'&&!Array.isArray(row),'Despesa inválida.');
        check(row.kind===undefined||row.kind==='variable','O cadastro em lote aceita somente despesas variáveis.');
        check(row.repeat_count===undefined||row.repeat_count===1,'Cada linha deve representar uma única conta, sem repetição mensal.');
        return this.cleanExpense({...row,kind:'variable'});
      } catch(error) { check(false,`Linha ${index+1}: ${error.message}`,error.status??400); }
    });
    sumMoney(rows.map(row=>row.amount_cents));
    return this.store.transaction(()=>this.insertExpenseBatch(actor,requestId,hash({operation:'variable_batch',rows}),rows));
  }
  // Called only inside the caller's transaction; either every row and audit is saved, or none is.
  insertExpenseBatch(actor,requestId,payloadHash,rows) {
    const previous=this.store.get('SELECT * FROM expense_batches WHERE tenant_id=? AND id=?',actor.tenant_id,requestId);
    if(previous) {check(previous.payload_hash===payloadHash,'Solicitação já utilizada com outros valores.',409);return {expenses:this.store.all('SELECT id FROM operating_expenses WHERE tenant_id=? AND batch_id=? ORDER BY ordinal',actor.tenant_id,requestId).map(e=>this.expense(actor,e.id)),replayed:true};}
    rows=rows.map((row,index)=>{try{return this.resolveExpenseCategory(actor,row);}catch(error){check(false,`Linha ${index+1}: ${error.message}`,error.status??400);}});
    rows.forEach((row,index)=>{
      try {this.openMonth(actor,row.reference_month);}catch(error){check(false,`Linha ${index+1}: ${error.message}`,error.status??400);}
    });
    const at=now();this.store.run('INSERT INTO expense_batches VALUES(?,?,?,?)',requestId,actor.tenant_id,payloadHash,at);
    const expenses=rows.map((row,i)=>{
      const id=randomUUID();this.store.run(`INSERT INTO operating_expenses(id,tenant_id,batch_id,ordinal,description,kind,amount_cents,reference_month,due_date,category,payee,notes,reminder_days,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
        id,actor.tenant_id,requestId,i,...['description','kind','amount_cents','reference_month','due_date','category','payee','notes','reminder_days'].map(k=>row[k]),at,at);
      this.linkExpenseCategory(actor,id,row.category_id,row);
      this.store.audit(actor,'operating_expense',id,'created',row);return this.expense(actor,id);
    });
    return {expenses,replayed:false};
  }
  saveExpense(actor,data,key=null) {
    this.access(actor,true); let clean=this.cleanExpense(data);const count=key?1:integer(data.repeat_count??1,'Meses',1,60), requestId=key?null:uuid(data.request_id), payloadHash=hash({clean,count});
    return this.store.transaction(()=>{
      if(key) {
        const old=this.expense(actor,key); check(data.version===old.version,'Despesa alterada em outra tela. Atualize antes de salvar.',409);
        check(!old.paid_date && !old.voided_at,'Estorne o pagamento antes de editar. Despesas canceladas não podem ser editadas.',409);
        this.openMonth(actor,old.reference_month); this.openMonth(actor,clean.reference_month);
        if(data.category_id===undefined&&old.category_id)clean={...clean,category_id:old.category_id,category:old.category};
        if(data.subcategory_id===undefined&&old.subcategory_id&&clean.category_id===old.category_id)clean={...clean,subcategory_id:old.subcategory_id};
        clean=this.resolveExpenseCategory(actor,clean,old);
        this.store.run(`UPDATE operating_expenses SET description=?,kind=?,amount_cents=?,reference_month=?,due_date=?,category=?,payee=?,notes=?,reminder_days=?,version=version+1,updated_at=? WHERE tenant_id=? AND id=?`,
          ...['description','kind','amount_cents','reference_month','due_date','category','payee','notes','reminder_days'].map(k=>clean[k]),now(),actor.tenant_id,key);
        this.linkExpenseCategory(actor,key,clean.category_id,clean);
        this.store.audit(actor,'operating_expense',key,'updated',{before:old,after:clean});
        return {expenses:[this.expense(actor,key)],replayed:false};
      }
      const rows=Array.from({length:count},(_,i)=>({...clean,reference_month:shiftMonth(clean.reference_month,i),due_date:monthlyDue(clean.due_date,i)}));
      return this.insertExpenseBatch(actor,requestId,payloadHash,rows);
    });
  }
  updateExpenseState(actor,key,data) {
    this.access(actor,true); check(['pay','reopen','cancel'].includes(data.action),'Ação inválida.');
    return this.store.transaction(()=>{
      const old=this.expense(actor,key);
      // Repeated acknowledgements return the same row, never another financial movement.
      if(data.action==='pay' && old.paid_date) {
        check(data.paid_date===old.paid_date && (data.notes??'').trim()===old.payment_note,'Pagamento já registrado com outros dados.',409);return old;
      }
      check(data.version===old.version,'Despesa alterada em outra tela. Atualize antes de salvar.',409);
      check(!old.voided_at,'Despesa cancelada.',409);
      const note=text(data.notes,'Observação',1000,data.action!=='pay');
      if(data.action==='pay') {
        const date=validDate(data.paid_date);check(date<=businessDate(),'O pagamento não pode estar no futuro.');
        this.store.run('UPDATE operating_expenses SET paid_date=?,payment_note=?,version=version+1,updated_at=? WHERE tenant_id=? AND id=?',date,note,now(),actor.tenant_id,key);
      } else if(data.action==='reopen') {
        check(old.paid_date,'Esta despesa não foi paga.',409);
        this.store.run("UPDATE operating_expenses SET paid_date=NULL,payment_note='',version=version+1,updated_at=? WHERE tenant_id=? AND id=?",now(),actor.tenant_id,key);
      } else {
        check(!old.paid_date,'Estorne o pagamento antes de cancelar.',409);this.openMonth(actor,old.reference_month);
        this.store.run('UPDATE operating_expenses SET voided_at=?,version=version+1,updated_at=? WHERE tenant_id=? AND id=?',now(),now(),actor.tenant_id,key);
      }
      this.store.audit(actor,'operating_expense',key,data.action,{before:old,note,paid_date:data.paid_date??null});return this.expense(actor,key);
    });
  }
  reminders(actor,today=businessDate()) {
    this.access(actor);validDate(today);
    const limit=new Date(`${today}T12:00:00Z`);limit.setUTCDate(limit.getUTCDate()+30);
    const rows=this.store.all(`SELECT * FROM operating_expenses WHERE tenant_id=? AND paid_date IS NULL AND voided_at IS NULL AND due_date<=? ORDER BY due_date,description`,actor.tenant_id,limit.toISOString().slice(0,10))
      .filter(e=>dayDistance(today,e.due_date)<=e.reminder_days).map(e=>({...e,state:stateOf(e,today),days_until_due:dayDistance(today,e.due_date)}));
    return {today,count:rows.length,overdue_count:rows.filter(e=>e.state==='overdue').length,total_cents:expenseTotal(rows.map(e=>e.amount_cents)),items:rows};
  }
  expenses(actor,month=businessDate().slice(0,7)) {
    this.access(actor);if(month!=='all')validMonth(month);const today=businessDate();
    const rows=this.store.all(`SELECT e.*,l.category_id,sl.subcategory_id,sl.name AS subcategory,EXISTS(SELECT 1 FROM finance_closures c WHERE c.tenant_id=e.tenant_id AND c.reference_month=e.reference_month) AS month_closed
      FROM operating_expenses e LEFT JOIN expense_category_links l ON l.tenant_id=e.tenant_id AND l.expense_id=e.id LEFT JOIN expense_subcategory_links sl ON sl.tenant_id=e.tenant_id AND sl.expense_id=e.id WHERE e.tenant_id=? ${month==='all'?'':'AND e.reference_month=?'} ORDER BY e.due_date,e.description,e.id`,...month==='all'?[actor.tenant_id]:[actor.tenant_id,month])
      .map(e=>({...e,month_closed:!!e.month_closed,state:stateOf(e,today)})),valid=rows.filter(e=>!e.voided_at);
    const total=predicate=>expenseTotal(valid.filter(predicate).map(e=>e.amount_cents));
    return {month,rows,closed:!!this.store.get('SELECT id FROM finance_closures WHERE tenant_id=? AND reference_month=?',actor.tenant_id,month),
      summary:{total_cents:total(()=>true),fixed_cents:total(e=>e.kind==='fixed'),variable_cents:total(e=>e.kind==='variable'),paid_cents:total(e=>!!e.paid_date),open_cents:total(e=>!e.paid_date),overdue_cents:total(e=>e.state==='overdue')},reminders:this.reminders(actor),categories:this.categories(actor),subcategories:this.subcategories(actor)};
  }
  calculate(actor,month) {
    this.access(actor,false,true);validMonth(month);
    // finance.view grants only this shop-wide financial report, not general access to sales endpoints.
    const internalActor={...actor,permissions:[...actor.permissions,'sales.view_all']};
    const [year,monthNumber]=month.split('-').map(Number),lastDay=new Date(Date.UTC(year,monthNumber,0)).toISOString().slice(0,10);
    const rows=this.store.all("SELECT id FROM sales WHERE tenant_id=? AND status='confirmed' AND business_date>=? AND business_date<=? ORDER BY id",actor.tenant_id,`${month}-01`,lastDay);
    const sales=rows.map(row=>this.store.fullSale(internalActor,row.id));
    const expenses=this.store.all('SELECT id,description,kind,amount_cents,reference_month FROM operating_expenses WHERE tenant_id=? AND reference_month=? AND voided_at IS NULL ORDER BY id',actor.tenant_id,month);
    const profit=sales.reduce((sum,s)=>sum+(s.profit_cents??0),0), expenseTotal=sumMoney(expenses.map(e=>e.amount_cents)), result=profit-expenseTotal;
    check(Number.isSafeInteger(result) && Math.abs(result)<=100_000_000_000,'Resultado fora do limite.');
    const source={sales:sales.map(s=>({id:s.id,number:s.number,total_cents:s.total_cents,profit_cents:s.profit_cents,profit_state:s.profit_state,known_cost_cents:s.known_cost_cents,fee_cents:s.reconciliation.fee_cents,freight_cents:s.freight_cents,sale_expenses:s.expenses})),expenses};
    const settings=this.settings(actor);
    return {month,sales_count:sales.length,revenue_cents:sumMoney(sales.map(s=>s.total_cents)),sales_profit_cents:profit,
      incomplete_sales:sales.filter(s=>s.profit_state!=='complete').map(s=>({number:s.number,state:s.profit_state})),
      expenses_cents:expenseTotal,fixed_cents:sumMoney(expenses.filter(e=>e.kind==='fixed').map(e=>e.amount_cents)),variable_cents:sumMoney(expenses.filter(e=>e.kind==='variable').map(e=>e.amount_cents)),
      result_cents:result,...distributeProfit(result,settings.reserve_basis_points,settings.partners),reserve_basis_points:settings.reserve_basis_points,
      settings_version:settings.version,source,source_hash:hash(source)};
  }
  closure(actor,key) {
    this.access(actor,false,true);const row=this.store.get('SELECT * FROM finance_closures WHERE tenant_id=? AND id=?',actor.tenant_id,key);
    check(row,'Fechamento não encontrado.',404);return {...row,snapshot:JSON.parse(row.snapshot_json)};
  }
  report(actor,month=businessDate().slice(0,7)) {
    this.access(actor,false,true);validMonth(month);
    const current=this.calculate(actor,month), row=this.store.get('SELECT id FROM finance_closures WHERE tenant_id=? AND reference_month=?',actor.tenant_id,month), closed=row?this.closure(actor,row.id):null;
    const withdrawals=closed?this.store.all('SELECT id,partner_id,amount_cents,paid_date,notes FROM profit_withdrawals WHERE tenant_id=? AND closure_id=? ORDER BY created_at,id',actor.tenant_id,closed.id):[];
    const snapshot=closed?.snapshot??current, withdrawn=sumMoney(withdrawals.map(w=>w.amount_cents));
    const refunds=pendingRefunds(this.store,actor,{shopWide:true});
    return {month,closed:!!closed,closure_id:closed?.id??null,closed_at:closed?.created_at??null,source_changed:!!closed&&closed.source_hash!==current.source_hash,
      result:snapshot,withdrawals,withdrawn_cents:withdrawn,remaining_withdrawals_cents:snapshot.distribution_cents-withdrawn,
      refunds_pending:refunds,cash_recheck_required:refunds.count>0,
      cash_after_planned_cents:refunds.count||snapshot.cash_available_cents==null?null:snapshot.cash_available_cents-snapshot.distribution_cents,
      cash_after_recorded_cents:refunds.count||snapshot.cash_available_cents==null?null:snapshot.cash_available_cents-withdrawn,
      settings:this.settings(actor),history:this.store.all('SELECT id,reference_month,created_at FROM finance_closures WHERE tenant_id=? ORDER BY reference_month DESC LIMIT 24',actor.tenant_id)};
  }
  closeMonth(actor,data) {
    this.access(actor,true,true);const month=validMonth(data.month);
    check(month<businessDate().slice(0,7),'O mês atual fica como prévia. Feche somente meses já encerrados.');
    const cash=data.cash_available_cents==null?null:integer(data.cash_available_cents,'Caixa livre conferido');
    return this.store.transaction(()=>{
      const previous=this.store.get('SELECT id FROM finance_closures WHERE tenant_id=? AND reference_month=?',actor.tenant_id,month);
      if(previous) { const closed=this.closure(actor,previous.id);check(closed.snapshot.cash_available_cents===cash,'Este mês já foi fechado com outros dados.',409);return this.report(actor,month); }
      const refundReserve=acknowledgeRefundReserve(this.store,actor,data);
      const calculated=this.calculate(actor,month);
      check(data.source_hash===calculated.source_hash && data.settings_version===calculated.settings_version,'Os valores mudaram. Atualize e confira novamente.',409);
      check(!calculated.incomplete_sales.length,'Confira os custos e pagamentos pendentes das vendas antes de fechar o mês.',409);
      check(cash===null || cash>=calculated.distribution_cents,'O caixa livre informado não cobre as retiradas. Aumente a reserva da loja ou confira o saldo.');
      const key=randomUUID(),at=now(),snapshot={...calculated,cash_available_cents:cash};
      this.store.run('INSERT INTO finance_closures VALUES(?,?,?,?,?,?,?)',key,actor.tenant_id,month,JSON.stringify(snapshot),calculated.source_hash,actor.id,at);
      this.store.audit(actor,'finance_closure',key,'closed',{month,result_cents:calculated.result_cents,distribution_cents:calculated.distribution_cents,refund_reserve_acknowledged_cents:refundReserve});
      return this.report(actor,month);
    });
  }
  withdraw(actor,key,data) {
    this.access(actor,true,true);const requestId=uuid(data.request_id),amount=integer(data.amount_cents,'Retirada',1),date=validDate(data.paid_date),notes=text(data.notes,'Observações',1000,false);
    check(date<=businessDate(),'A retirada não pode estar no futuro.');
    return this.store.transaction(()=>{
      const previous=this.store.get('SELECT * FROM profit_withdrawals WHERE tenant_id=? AND request_id=?',actor.tenant_id,requestId);
      if(previous){check(previous.closure_id===key && previous.partner_id===data.partner_id && previous.amount_cents===amount && previous.paid_date===date && previous.notes===notes,'Solicitação já usada com outros dados.',409);return previous;}
      const refundReserve=acknowledgeRefundReserve(this.store,actor,data);
      const closure=this.closure(actor,key),partner=closure.snapshot.partners.find(p=>p.id===data.partner_id);check(partner,'Sócio não encontrado neste fechamento.',404);
      check(this.calculate(actor,closure.reference_month).source_hash===closure.source_hash,'As vendas mudaram após o fechamento. Revise a diferença antes de registrar novas retiradas.',409);
      check(date>=businessDate(new Date(closure.created_at)),'A retirada não pode anteceder o fechamento.');
      const paid=this.store.get('SELECT COALESCE(SUM(amount_cents),0) AS total FROM profit_withdrawals WHERE tenant_id=? AND closure_id=? AND partner_id=?',actor.tenant_id,key,partner.id).total;
      check(amount<=partner.amount_cents-paid,'O valor ultrapassa o saldo de retirada deste sócio.');
      const id=randomUUID();this.store.run('INSERT INTO profit_withdrawals VALUES(?,?,?,?,?,?,?,?,?,?)',id,actor.tenant_id,key,partner.id,requestId,amount,date,notes,actor.id,now());
      this.store.audit(actor,'profit_withdrawal',id,'recorded',{closure_id:key,partner_id:partner.id,amount_cents:amount,paid_date:date,refund_reserve_acknowledged_cents:refundReserve});
      return {id,amount_cents:amount};
    });
  }
}
