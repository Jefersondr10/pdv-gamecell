import { HttpError } from '@/lib/server/http';
import { runtime } from '@/lib/server/runtime';
import { timingSafeEqual } from '@/lib/server/security';

const PRIMARY_STORE_CODES = new Set(['atacadoapple', 'atacado-apple']);

export function assertPrimaryStoreAccess(code: string, value: unknown) {
  if (!PRIMARY_STORE_CODES.has(code)) return;
  const expected = runtime().PRIMARY_STORE_SETUP_TOKEN_V1?.trim();
  const provided = typeof value === 'string' ? value.trim() : '';
  if (!expected || !provided || !timingSafeEqual(provided, expected)) {
    throw new HttpError(
      403,
      'Este identificador de loja está reservado. Escolha outro código para sua loja.',
      'PRIMARY_STORE_RESERVED',
    );
  }
}
