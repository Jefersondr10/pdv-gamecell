import { isAbsolute, resolve } from 'node:path';
import { statSync } from 'node:fs';
import { isIP } from 'node:net';

export function configuration(env = process.env, nodeVersion = process.versions.node) {
  const production = env.NODE_ENV === 'production';
  const origin = env.APP_ORIGIN ?? 'http://127.0.0.1:3000';
  let url;
  try { url = new URL(origin); } catch { throw Error('APP_ORIGIN inválida.'); }
  if (url.origin !== origin || !['http:', 'https:'].includes(url.protocol)) throw Error('APP_ORIGIN deve ser uma origem canônica sem caminho.');
  const portText = env.PORT ?? '3000';
  if (!/^\d+$/.test(portText) || Number(portText) < 1 || Number(portText) > 65535) throw Error('PORT inválida.');
  const dbPath = env.DB_PATH ?? './data/pdv.sqlite';
  const trustedProxy = env.TRUSTED_PROXY_IP ?? '';
  if (trustedProxy && !isIP(trustedProxy)) throw Error('TRUSTED_PROXY_IP inválido.');
  const googleClientId = env.GOOGLE_CLIENT_ID ?? '';
  if (googleClientId && !/^[a-zA-Z0-9-]+\.apps\.googleusercontent\.com$/.test(googleClientId)) throw Error('GOOGLE_CLIENT_ID inválido.');
  const host = env.HOST ?? '127.0.0.1';
  if (production) {
    if (Number(nodeVersion.split('.')[0]) !== 24) throw Error('Produção requer Node 24 LTS.');
    if (url.protocol !== 'https:') throw Error('Produção requer HTTPS.');
    if (!isAbsolute(dbPath) || !statSync(dbPath, { throwIfNoEntry: false })?.isFile()) throw Error('DB_PATH deve apontar para um banco persistente existente.');
    if (!googleClientId) throw Error('Configure o login Google antes de publicar.');
    if (!['127.0.0.1', '::1'].includes(host) && !(host === '0.0.0.0' && env.CONTAINER_ISOLATED === 'true' && trustedProxy)) throw Error('Servidor deve ficar isolado atrás do gateway.');
  }
  return { production, origin, host, port: Number(portText), dbPath: resolve(dbPath), trustedProxy, googleClientId, publicRegistration: !production };
}

export function clientAddress(req, trustedProxy = '') {
  const peer = (req.socket.remoteAddress ?? '').replace(/^::ffff:/, '');
  const forwarded = req.headers['x-real-ip'];
  return trustedProxy && peer === trustedProxy && typeof forwarded === 'string' && isIP(forwarded) ? forwarded : peer;
}

export class AuthLimiter {
  constructor(clock = Date.now) { this.clock = clock; this.entries = new Map(); }
  take(key, limit, windowMs = 15 * 60_000) {
    const time = this.clock();
    for (const [k, v] of this.entries) if (v.until <= time) this.entries.delete(k);
    if (!this.entries.has(key) && this.entries.size >= 10000) return 60;
    const v = this.entries.get(key) ?? { count: 0, until: time + windowMs };
    v.count++; this.entries.set(key, v);
    return v.count > limit ? Math.max(1, Math.ceil((v.until - time) / 1000)) : 0;
  }
}
