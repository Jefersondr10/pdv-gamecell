import { requiredSecret } from '@/lib/server/runtime';

export { normalizeCommercialCode } from '@/lib/gtin';

const encoder = new TextEncoder();
export const PASSWORD_ITERATIONS = 600_000;
const PBKDF2_OPERATION_LIMIT = 100_000;
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

export function credentialLoginAttemptKey(storeCode: string, login: string) {
  return hmac(
    `credential\u0000${storeCode}\u0000${login}`,
    requiredSecret('RATE_LIMIT_SECRET_V1'),
  );
}

export async function hashPassword(
  password: string,
  salt = randomToken(16),
  iterations = PASSWORD_ITERATIONS,
) {
  const pepper = requiredSecret('PASSWORD_PEPPER_V1');
  const baseSalt = fromBase64Url(salt);
  let materialBytes = encoder.encode(`${password}\u0000${pepper}`);
  let remaining = iterations;
  let round = 0;

  // Workers caps each Web Crypto PBKDF2 call at 100k iterations. Chaining
  // domain-separated rounds retains the full 600k sequential work factor while
  // keeping every individual operation within the platform limit.
  while (remaining > 0) {
    const material = await crypto.subtle.importKey(
      'raw',
      materialBytes,
      'PBKDF2',
      false,
      ['deriveBits'],
    );
    const roundSalt =
      round === 0
        ? baseSalt
        : concatBytes(baseSalt, encoder.encode(`\u0000round:${round}`));
    const operationIterations = Math.min(remaining, PBKDF2_OPERATION_LIMIT);
    const bits = await crypto.subtle.deriveBits(
      {
        name: 'PBKDF2',
        hash: 'SHA-256',
        salt: roundSalt,
        iterations: operationIterations,
      },
      material,
      256,
    );
    materialBytes = new Uint8Array(bits);
    remaining -= operationIterations;
    round += 1;
  }
  return { hash: toBase64Url(materialBytes), salt, iterations };
}

export async function verifyPassword(
  password: string,
  salt: string,
  iterations: number,
  expected: string,
) {
  const supported =
    Number.isSafeInteger(iterations) &&
    iterations >= PBKDF2_OPERATION_LIMIT &&
    iterations <= PASSWORD_ITERATIONS &&
    iterations % PBKDF2_OPERATION_LIMIT === 0;
  const actual = (
    await hashPassword(
      password,
      salt,
      supported ? iterations : PASSWORD_ITERATIONS,
    )
  ).hash;
  return supported && timingSafeEqual(actual, expected);
}

function concatBytes(left: Uint8Array, right: Uint8Array) {
  const combined = new Uint8Array(left.length + right.length);
  combined.set(left);
  combined.set(right, left.length);
  return combined;
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

export function normalizeSerial(value: string) {
  return value
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, '');
}

export function normalizeAppleSerial(value: string) {
  // O `S` impresso por alguns leitores pode ser um prefixo técnico, mas também
  // pode fazer parte de um SN real. Preserve sempre o valor lido; a equivalência
  // com/sem o prefixo é tratada somente nas buscas por `serialAliases`.
  return normalizeSerial(value);
}

export function isValidAppleSerial(value: string) {
  const normalized = normalizeAppleSerial(value);
  const serialBody = normalized.startsWith('S')
    ? normalized.slice(1)
    : normalized;
  return /^[A-Z0-9]{8,17}$/.test(serialBody) && /[A-Z]/.test(serialBody);
}

export function serialAliases(value: string) {
  const normalized = normalizeAppleSerial(value);
  if (!isValidAppleSerial(normalized)) return [];
  const alternate = normalized.startsWith('S')
    ? normalized.slice(1)
    : `S${normalized}`;
  return Array.from(new Set([normalized, alternate]));
}

export function serialAliasKey(value: string) {
  return serialAliases(value).sort().join('\u0000');
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
