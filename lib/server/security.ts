import { requiredSecret } from '@/lib/server/runtime';

const encoder = new TextEncoder();
// Cloudflare Workers limits a single Web Crypto PBKDF2 operation to 100,000
// iterations. A deployment-only pepper and strict login throttling provide the
// additional protection around this platform-compatible work factor.
const PASSWORD_ITERATIONS = 100_000;
const RECOVERY_ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';

export function randomToken(bytes = 32) {
  const value = new Uint8Array(bytes);
  crypto.getRandomValues(value);
  return toBase64Url(value);
}

export async function sha256(value: string) {
  const digest = await crypto.subtle.digest('SHA-256', encoder.encode(value));
  return toBase64Url(new Uint8Array(digest));
}

export async function hmac(value: string, secret: string) {
  const key = await crypto.subtle.importKey(
    'raw',
    encoder.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const signature = await crypto.subtle.sign(
    'HMAC',
    key,
    encoder.encode(value),
  );
  return toBase64Url(new Uint8Array(signature));
}

export async function hashPassword(
  password: string,
  salt = randomToken(16),
  iterations = PASSWORD_ITERATIONS,
) {
  const pepper = requiredSecret('PASSWORD_PEPPER_V1');
  const material = await crypto.subtle.importKey(
    'raw',
    encoder.encode(`${password}\u0000${pepper}`),
    'PBKDF2',
    false,
    ['deriveBits'],
  );
  const bits = await crypto.subtle.deriveBits(
    {
      name: 'PBKDF2',
      hash: 'SHA-256',
      salt: fromBase64Url(salt),
      iterations,
    },
    material,
    256,
  );
  return { hash: toBase64Url(new Uint8Array(bits)), salt, iterations };
}

export async function verifyPassword(
  password: string,
  salt: string,
  iterations: number,
  expected: string,
) {
  const actual = (await hashPassword(password, salt, iterations)).hash;
  return timingSafeEqual(actual, expected);
}

export function timingSafeEqual(left: string, right: string) {
  const a = encoder.encode(left);
  const b = encoder.encode(right);
  let difference = a.length ^ b.length;
  const length = Math.max(a.length, b.length);
  for (let index = 0; index < length; index += 1) {
    difference |= (a[index] ?? 0) ^ (b[index] ?? 0);
  }
  return difference === 0;
}

export function normalizeEmail(value: string) {
  return value.trim().toLowerCase();
}

export function normalizeUsername(value: string) {
  return value.trim().toLowerCase().replace(/\s+/g, '');
}

export function normalizeStoreCode(value: string) {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40);
}

export function normalizeCommercialCode(value: string) {
  const digits = value.replace(/\D/g, '');
  if (![8, 12, 13, 14].includes(digits.length)) return '';
  const values = digits.split('').map(Number);
  const suppliedCheckDigit = values.pop();
  const total = values
    .reverse()
    .reduce((sum, digit, index) => sum + digit * (index % 2 === 0 ? 3 : 1), 0);
  if (suppliedCheckDigit !== (10 - (total % 10)) % 10) return '';
  return digits.padStart(14, '0');
}

export function normalizeSerial(value: string) {
  return value
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, '');
}

export function normalizeRecoveryCode(value: string) {
  const normalized = value
    .trim()
    .toUpperCase()
    .replace(/O/g, '0')
    .replace(/[IL]/g, '1')
    .replace(/[^0-9A-HJKMNP-TV-Z]/g, '');
  return normalized.length === 16 ? normalized : '';
}

export async function hashRecoveryCode(value: string) {
  const normalized = normalizeRecoveryCode(value);
  if (!normalized) return '';
  return hmac(
    `account-recovery:${normalized}`,
    requiredSecret('RECOVERY_CODE_PEPPER_V1'),
  );
}

export async function createRecoveryCodeSet(count = 8) {
  const codes = Array.from({ length: count }, () => {
    const random = new Uint8Array(16);
    crypto.getRandomValues(random);
    const raw = Array.from(
      random,
      (value) => RECOVERY_ALPHABET[value & 31],
    ).join('');
    return raw.match(/.{1,4}/g)!.join('-');
  });
  return {
    setId: crypto.randomUUID(),
    codes,
    hashes: await Promise.all(codes.map(hashRecoveryCode)),
  };
}

export function validatePassword(password: string) {
  if (password.length < 10 || password.length > 128) {
    return 'A senha deve ter entre 10 e 128 caracteres.';
  }
  if (!/[A-Za-zÀ-ÿ]/.test(password) || !/\d/.test(password)) {
    return 'Use ao menos uma letra e um número.';
  }
  return null;
}

export function toBase64Url(value: Uint8Array) {
  let binary = '';
  for (const byte of value) binary += String.fromCharCode(byte);
  return btoa(binary)
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/g, '');
}

export function fromBase64Url(value: string) {
  const padded = value
    .replace(/-/g, '+')
    .replace(/_/g, '/')
    .padEnd(Math.ceil(value.length / 4) * 4, '=');
  const binary = atob(padded);
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}
