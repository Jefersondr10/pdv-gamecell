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
      'Este código de loja está reservado para o proprietário do sistema. Informe o código de ativação.',
      'PRIMARY_STORE_RESERVED',
    );
  }
}

export function assertPasswordSignupAccess(value: unknown) {
  const provided = typeof value === 'string' ? value.trim() : '';
  const candidates = [
    runtime().PASSWORD_SIGNUP_TOKEN_V1?.trim(),
    runtime().PRIMARY_STORE_SETUP_TOKEN_V1?.trim(),
  ].filter((candidate): candidate is string => Boolean(candidate));
  if (
    !provided ||
    candidates.length === 0 ||
    !candidates.some((candidate) => timingSafeEqual(provided, candidate))
  ) {
    throw new HttpError(
      403,
      'Informe um código de ativação válido para criar a conta sem Google.',
      'PASSWORD_SIGNUP_INVITE_REQUIRED',
    );
  }
}
