import { OAuth2Client } from 'google-auth-library';
import { randomBytes, createHash } from 'node:crypto';
import { check } from './domain.mjs';

const digest = value => createHash('sha256').update(value).digest('hex');
export class GoogleAuth {
  constructor(clientId, { verify, clock = Date.now } = {}) {
    this.clientId = clientId; this.clock = clock; this.pending = new Map();
    const client = new OAuth2Client(clientId);
    this.verify = verify ?? (async token => (await client.verifyIdToken({ idToken: token, audience: clientId })).getPayload());
  }
  issue(value = {}) {
    for (const [key, item] of this.pending) if (item.expires <= this.clock()) this.pending.delete(key);
    check(this.pending.size < 3000, 'Muitos acessos. Tente novamente em instantes.', 429);
    const token = randomBytes(32).toString('hex'), nonce = randomBytes(32).toString('hex');
    this.pending.set(digest(token), { nonce, expires: this.clock() + 10 * 60_000, ...value });
    return { token, nonce };
  }
  get(token) {
    check(typeof token === 'string' && /^[a-f0-9]{64}$/.test(token), 'Atualize a página para entrar com Google.', 401);
    const pending = this.pending.get(digest(token));
    check(pending && pending.expires > this.clock(), 'O acesso expirou. Entre com Google novamente.', 401);
    return pending;
  }
  consume(token) { const value = this.get(token); this.pending.delete(digest(token)); return value; }
  discard(token) { this.pending.delete(digest(token)); }
  async authenticate(token, credential) {
    check(typeof credential === 'string' && credential.length < 16000, 'Credencial Google inválida.', 401);
    const challenge = this.consume(token);
    check(!challenge.identity, 'Inicie um novo acesso Google.', 401);
    let identity, timer;
    try { identity = await Promise.race([this.verify(credential), new Promise((_, reject) => { timer = setTimeout(() => reject(Error('timeout')), 10000); })]); }
    catch { check(false, 'Não foi possível validar o acesso Google. Tente novamente.', 401); }
    finally { clearTimeout(timer); }
    check(challenge.expires > this.clock(), 'O acesso expirou. Entre com Google novamente.', 401);
    const seconds = this.clock() / 1000;
    check(identity && ['https://accounts.google.com', 'accounts.google.com'].includes(identity.iss) &&
      identity.aud === this.clientId && (!identity.azp || identity.azp === this.clientId) &&
      Number.isFinite(identity.exp) && identity.exp > seconds && Number.isFinite(identity.iat) && identity.iat <= seconds + 60 &&
      identity.nonce === challenge.nonce && identity.email_verified === true &&
      typeof identity.sub === 'string' && /^[a-zA-Z0-9_-]{1,255}$/.test(identity.sub) &&
      typeof identity.email === 'string', 'Identidade Google inválida.', 401);
    return { sub: identity.sub, email: identity.email, name: identity.name || identity.email.split('@')[0] };
  }
}
