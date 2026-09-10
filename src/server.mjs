import { createServer } from 'node:http';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { Store } from './store.mjs';
import { AppError, check } from './domain.mjs';
import { configuration, clientAddress, AuthLimiter } from './config.mjs';
import { GoogleAuth } from './google-auth.mjs';

function cookieToken(req) {
  return (req.headers.cookie ?? '').split(';').map(v => v.trim()).find(v => v.startsWith('pdv_session='))?.slice(12) ?? '';
}
async function body(req) {
  check((req.headers['content-type'] ?? '').split(';')[0] === 'application/json', 'Envie JSON.', 415);
  let text = '', bytes = 0;
  for await (const chunk of req) { bytes += chunk.length; check(bytes <= 256_000, 'Requisição muito grande.', 413); text += chunk.toString(); }
  try { const data = JSON.parse(text || '{}'); check(data && typeof data === 'object' && !Array.isArray(data), 'JSON inválido.'); return data; }
  catch (error) { if (error instanceof AppError) throw error; throw new AppError('JSON inválido.'); }
}
export function application(options = {}) {
  const config = options.store ? { origin: 'http://127.0.0.1:3000', production: false, publicRegistration: true, trustedProxy: '', googleClientId: '', ...options } : { ...configuration(), ...options };
  if (config.production) config.publicRegistration = false;
  const { origin, production, publicRegistration, trustedProxy, googleClientId } = config;
  const store = options.store ?? new Store(config.dbPath);
  const limiter = new AuthLimiter();
  const google = googleClientId ? (options.googleAuth ?? new GoogleAuth(googleClientId)) : null;
  const cookie = (name, value, maxAge = 43200) => `${name}=${value}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${maxAge}${origin.startsWith('https:') ? '; Secure' : ''}`;
  const googleCookie = req => (req.headers.cookie ?? '').split(';').map(v => v.trim()).find(v => v.startsWith('pdv_google='))?.slice(11) ?? '';
  const assets = new Map([
    ['/', ['index.html', 'text/html; charset=utf-8']],
    ['/privacidade', ['privacy.html', 'text/html; charset=utf-8']],
    ['/privacy.css', ['privacy.css', 'text/css; charset=utf-8']],
    ['/app.mjs', ['app.mjs', 'text/javascript; charset=utf-8']],
    ['/mobile-ui.mjs', ['mobile-ui.mjs', 'text/javascript; charset=utf-8']],
    ['/installment-calculator.mjs', ['installment-calculator.mjs', 'text/javascript; charset=utf-8']],
    ['/google-ui.mjs', ['google-ui.mjs', 'text/javascript; charset=utf-8']],
    ['/stock-ui.mjs', ['stock-ui.mjs', 'text/javascript; charset=utf-8']],
    ['/sales-view.mjs', ['sales-view.mjs', 'text/javascript; charset=utf-8']],
    ['/select-control.mjs', ['select-control.mjs', 'text/javascript; charset=utf-8']],
    ['/finance-ui.mjs', ['finance-ui.mjs', 'text/javascript; charset=utf-8']],
    ['/finance.css', ['finance.css', 'text/css; charset=utf-8']],
    ['/brand.css', ['brand.css', 'text/css; charset=utf-8']],
    ['/date-control.mjs', ['date-control.mjs', 'text/javascript; charset=utf-8']],
    ['/gamecell-logo.png', ['gamecell-logo.png', 'image/png']],
    ['/style.css', ['style.css', 'text/css; charset=utf-8']],
    ['/share.mjs', ['share.mjs', 'text/javascript; charset=utf-8']],
    ['/receipt-view.mjs', ['receipt-view.mjs', 'text/javascript; charset=utf-8']]
  ]);
  const server = createServer(async (req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'no-referrer');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('Cross-Origin-Opener-Policy', 'same-origin-allow-popups');
    if (production) res.setHeader('Strict-Transport-Security', 'max-age=31536000');
    res.setHeader('Content-Security-Policy', `default-src 'self'; script-src 'self'${google ? ' https://accounts.google.com/gsi/client' : ''}; style-src 'self'${google ? ' https://accounts.google.com/gsi/style' : ''}; img-src 'self' data:; connect-src 'self'${google ? ' https://accounts.google.com/gsi/' : ''}; frame-src ${google ? 'https://accounts.google.com/gsi/' : "'none'"}; frame-ancestors 'none'; base-uri 'none'; form-action 'self'`);
    const json = (data, code = 200) => { res.statusCode = code; res.setHeader('Content-Type', 'application/json; charset=utf-8'); res.end(JSON.stringify(data)); };
    try {
      const url = new URL(req.url, origin), path = url.pathname, method = req.method;
      if (path === '/' && google) res.setHeader('Referrer-Policy', production ? 'strict-origin-when-cross-origin' : 'no-referrer-when-downgrade');
      if (method === 'GET' && path === '/health') { store.get('SELECT 1'); return json({ status: 'ok', stage: production ? 'production' : 'local-validation' }); }
      const limitAuth = (key = 'auth') => {
        const ip = clientAddress(req, trustedProxy);
        const retry = limiter.take('global', 300, 60_000) || limiter.take(`${key}:${ip}`, key === 'login' ? 30 : 90);
        if (retry) { res.setHeader('Retry-After', String(retry)); throw new AppError('Muitas tentativas. Aguarde e tente novamente.', 429); }
      };
      if (method === 'GET' && path === '/api/auth/options') {
        check(!['cross-site','same-site'].includes(req.headers['sec-fetch-site']) && (!req.headers.origin || req.headers.origin === origin), 'Origem não permitida.', 403);
        limitAuth('options');
        const challenge = url.searchParams.get('metadata') === '1' ? null : google?.issue();
        if (challenge) res.setHeader('Set-Cookie', cookie('pdv_google', challenge.token, 600));
        return json({ google_client_id: googleClientId, nonce: challenge?.nonce, password_registration: publicRegistration, production });
      }
      if (method === 'GET' && (assets.has(path) || /^\/s\/[a-f0-9]{64}$/.test(path))) {
        const [file, mime] = assets.get(path) ?? ['share.html', 'text/html; charset=utf-8'];
        res.setHeader('Content-Type', mime); res.end(readFileSync(new URL(`../public/${file}`, import.meta.url))); return;
      }
      if (method === 'GET' && path.startsWith('/api/public/')) return json(store.public(path.slice('/api/public/'.length)));
      check(path.startsWith('/api/'), 'Página não encontrada.', 404);
      let data = {};
      if (['POST', 'PUT', 'DELETE', 'PATCH'].includes(method)) {
        check(req.headers.origin === origin, 'Origem não permitida.', 403);
        data = await body(req);
      }
      if (method === 'POST' && ['/api/auth/google', '/api/auth/google/store'].includes(path)) {
        check(google, 'Login Google indisponível.', 503); limitAuth('google');
        let signedIn = false;
        try { signedIn = !!store.actor(cookieToken(req)); } catch (error) { if (error.status !== 401) throw error; }
        check(!signedIn, 'Saia da conta atual antes de entrar em outra loja.', 409);
        const token = googleCookie(req);
        if (path === '/api/auth/google') {
          const identity = await google.authenticate(token, data.credential);
          const result = store.googleLogin(identity);
          if (result.needs_store) {
            const next = google.issue({ identity });
            res.setHeader('Set-Cookie', cookie('pdv_google', next.token, 600));
            return json(result);
          }
          res.setHeader('Set-Cookie', [cookie('pdv_session', result.token), cookie('pdv_google', '', 0)]);
          return json({ user: result.user });
        }
        const pending = google.get(token);
        check(pending.identity, 'Entre com Google antes de criar sua loja.', 401);
        check(typeof data.store_name === 'string' && data.store_name.trim().length > 0, 'Informe o nome da loja.');
        const result = store.googleLogin(pending.identity, data.store_name);
        google.discard(token);
        res.setHeader('Set-Cookie', [cookie('pdv_session', result.token), cookie('pdv_google', '', 0)]);
        return json({ user: result.user }, 201);
      }
      if (method === 'POST' && ['/api/register', '/api/login'].includes(path)) {
        if (path === '/api/register') check(publicRegistration, 'Para criar uma loja, use Entrar com Google.', 403);
        limitAuth('login');
        const result = path === '/api/register' ? store.register(data) : store.login(data);
        res.setHeader('Set-Cookie', cookie('pdv_session', result.token));
        return json({ user: result.user }, path === '/api/register' ? 201 : 200);
      }
      const token = cookieToken(req), actor = store.actor(token);
      if (method === 'POST' && path === '/api/logout') {
        store.logout(token); res.setHeader('Set-Cookie', [cookie('pdv_session', '', 0), cookie('pdv_google', '', 0)]); return json({ ok: true });
      }
      if (method === 'GET' && path === '/api/state') return json(store.snapshot(actor, Object.fromEntries(url.searchParams)));
      if (method === 'GET' && path === '/api/expenses') return json(store.finance.expenses(actor,url.searchParams.get('month')??undefined));
      if (method === 'GET' && path === '/api/expense-categories') return json(store.finance.categories(actor));
      if (method === 'POST' && path === '/api/expense-categories') return json(store.finance.saveCategory(actor,data),201);
      const categoryRoute=path.match(/^\/api\/expense-categories\/([a-f0-9-]{36})$/);
      if (method === 'PUT' && categoryRoute)return json(store.finance.saveCategory(actor,data,categoryRoute[1]));
      if (method === 'GET' && path === '/api/expense-subcategories') return json(store.finance.subcategories(actor));
      if (method === 'POST' && path === '/api/expense-subcategories') return json(store.finance.saveSubcategory(actor,data),201);
      const subcategoryRoute=path.match(/^\/api\/expense-subcategories\/([a-f0-9-]{36})$/);
      if (method === 'PUT' && subcategoryRoute)return json(store.finance.saveSubcategory(actor,data,subcategoryRoute[1]));
      if (method === 'GET' && path === '/api/finance') return json(store.finance.report(actor,url.searchParams.get('month')??undefined));
      if (method === 'POST' && path === '/api/expenses') return json(store.finance.saveExpense(actor,data),201);
      if (method === 'POST' && path === '/api/expenses/batch') {const result=store.finance.saveVariableBatch(actor,data);return json(result,result.replayed?200:201);}
      if (method === 'PUT' && path === '/api/finance/settings') return json(store.finance.saveSettings(actor,data));
      if (method === 'POST' && path === '/api/finance/close') return json(store.finance.closeMonth(actor,data),201);
      const financeRoute=path.match(/^\/api\/(expenses|finance)\/([a-f0-9-]{36})(?:\/(state|withdrawals))?$/);
      if(financeRoute) {
        const [,resource,key,action]=financeRoute;
        if(resource==='expenses' && method==='PUT' && !action)return json(store.finance.saveExpense(actor,data,key));
        if(resource==='expenses' && method==='POST' && action==='state')return json(store.finance.updateExpenseState(actor,key,data));
        if(resource==='finance' && method==='POST' && action==='withdrawals')return json(store.finance.withdraw(actor,key,data),201);
      }
      if (method === 'POST' && path === '/api/products') return json(store.addProduct(actor, data), 201);
      if (method === 'POST' && path === '/api/customers') return json(store.addCustomer(actor, data), 201);
      if (method === 'POST' && path === '/api/users') return json(store.addUser(actor, data), 201);
      if (method === 'POST' && path === '/api/rates') return json(store.saveRate(actor, data), 201);
      if (method === 'POST' && path === '/api/card-machines') return json(store.saveCardMachine(actor, data), 201);
      if (method === 'POST' && path === '/api/pix-accounts') return json(store.savePixAccount(actor, data), 201);
      if (method === 'POST' && path === '/api/suppliers') return json(store.saveSupplier(actor, data), 201);
      if (method === 'POST' && path === '/api/sale-statuses') return json(store.saveSaleStatus(actor, data), 201);
      if (method === 'POST' && path === '/api/entries') return json(store.transaction(()=>store.operations.guardClosures(actor,()=>store.receive(actor,data))),201);
      if (method === 'POST' && path === '/api/stock/entries') {const result=store.operations.receive(actor,data);return json(result,result.replayed?200:201);}
      const entryRoute=path.match(/^\/api\/stock\/entries\/([a-f0-9-]{36})(?:\/(void))?$/);
      if(entryRoute&&method==='GET'&&!entryRoute[2]){const entry=store.operations.entries(actor).find(e=>e.id===entryRoute[1]);if(!entry)throw new AppError('Entrada não encontrada.',404);return json(entry);}
      if(entryRoute&&((method==='PUT'&&!entryRoute[2])||(method==='POST'&&entryRoute[2]==='void')))return json(store.operations.updateEntry(actor,entryRoute[1],data,!!entryRoute[2]));
      if (method === 'GET' && path === '/api/stock/report') return json(store.operations.report(actor));
      if (method === 'GET' && path === '/api/stock/report.csv') {
        const csv=store.operations.reportCsv(actor);res.setHeader('Content-Type','text/csv; charset=utf-8');
        res.setHeader('Content-Disposition','attachment; filename="estoque-gamecell.csv"');res.end(csv);return;
      }
      const editSaleRoute=path.match(/^\/api\/sales\/([a-f0-9-]{36})\/edit$/);
      const wholesaleRoute=path.match(/^\/api\/sales\/([a-f0-9-]{36})\/wholesale$/);
      const cancelSaleRoute=path.match(/^\/api\/sales\/([a-f0-9-]{36})\/cancel$/);
      if(method==='POST'&&cancelSaleRoute)return json(store.operations.cancelSale(actor,cancelSaleRoute[1],data));
      if(method==='PUT'&&wholesaleRoute)return json(store.operations.setWholesale(actor,wholesaleRoute[1],data));
      if(method==='PUT'&&editSaleRoute)return json(store.operations.editSale(actor,editSaleRoute[1],data));
      if (method === 'POST' && path === '/api/sales') return json(store.saveDraft(actor, data), 201);
      const route = path.match(/^\/api\/(sales|rates|card-machines|users|sale-statuses|pix-accounts|suppliers|products)\/([a-f0-9-]{36})(?:\/(confirm|payments|share|permissions|status|history))?$/);
      if (route) {
        const [, resource, itemId, action] = route;
        if (resource === 'sales') {
          if (method === 'GET' && !action) return json(store.sale(actor, itemId));
          if (method === 'PUT' && !action) return json(store.saveDraft(actor, data, itemId));
          if (method === 'PUT' && action === 'status') return json(store.setOperationalStatus(actor, itemId, data));
          if (method === 'POST' && action === 'confirm') return json(store.confirm(actor, itemId, data.acknowledge_difference));
          if (method === 'POST' && action === 'payments') {
            const result = store.addPayment(actor, itemId, data);
            return json(result, result.replayed ? 200 : 201);
          }
          if (method === 'POST' && action === 'share') { const link = store.share(actor, itemId); return json({ url: `${origin}/s/${link.token}` }); }
        }
        if (resource === 'users' && method === 'PUT' && action === 'permissions') return json(store.updatePermissions(actor, itemId, data));
        if (resource === 'rates' && method === 'PUT' && !action) return json(store.saveRate(actor, data, itemId));
        if (resource === 'card-machines' && method === 'PUT' && !action) return json(store.saveCardMachine(actor, data, itemId));
        if (resource === 'pix-accounts' && method === 'PUT' && !action) return json(store.savePixAccount(actor, data, itemId));
        if (resource === 'suppliers' && method === 'PUT' && !action) return json(store.saveSupplier(actor, data, itemId));
        if (resource === 'products' && method === 'GET' && action === 'history') return json(store.productHistory(actor, itemId));
        if (resource === 'sale-statuses' && method === 'PUT' && !action) return json(store.saveSaleStatus(actor, data, itemId));
      }
      throw new AppError('Rota não encontrada.', 404);
    } catch (error) {
      const status = error instanceof AppError ? error.status : 500;
      if (status === 500) console.error('Falha interna:', error.message);
      json({ error: status === 500 ? 'Não foi possível concluir a operação.' : error.message }, status);
    }
  });
  server.requestTimeout = 30_000;
  server.headersTimeout = 15_000;
  server.keepAliveTimeout = 5_000;
  server.maxRequestsPerSocket = 1000;
  return { server, store };
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const { host, port, production } = configuration();
  const { server, store } = application();
  server.listen(port, host, () => console.log(`PDV Gamecell • ${production ? 'produção' : 'validação local'} • porta ${port}`));
  for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => server.close(() => { store.close(); process.exit(0); }));
}
