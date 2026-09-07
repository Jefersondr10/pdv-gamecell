import { provideRuntime } from '@pdv-runtime';

export type AppRuntime = {
  DB: D1Database;
  FILES: R2Bucket;
  APP_ORIGIN?: string;
  GOOGLE_CLIENT_ID?: string;
  GOOGLE_CLIENT_SECRET?: string;
  SESSION_TOKEN_PEPPER_V1?: string;
  PASSWORD_PEPPER_V1?: string;
  OAUTH_STATE_SECRET_V1?: string;
  RATE_LIMIT_SECRET_V1?: string;
  PRODUCTION_RESET_SECRET_V1?: string;
  PRODUCTION_MAINTENANCE?: string;
  PRODUCTION_MAINTENANCE_BYPASS_V1?: string;
  PRIMARY_STORE_SETUP_TOKEN_V1?: string;
  PASSWORD_SIGNUP_TOKEN_V1?: string;
  RECOVERY_CODE_PEPPER_V1?: string;
  MIGRATION_EXPORT_TOKEN?: string;
  MIGRATION_EXPORT_EXPIRES_AT?: string;
  MIGRATION_READ_ONLY?: string;
};

export function runtime(): AppRuntime {
  return provideRuntime() as unknown as AppRuntime;
}

export function requiredSecret(
  key:
    | 'GOOGLE_CLIENT_ID'
    | 'GOOGLE_CLIENT_SECRET'
    | 'SESSION_TOKEN_PEPPER_V1'
    | 'PASSWORD_PEPPER_V1'
    | 'OAUTH_STATE_SECRET_V1'
    | 'RATE_LIMIT_SECRET_V1'
    | 'PRODUCTION_RESET_SECRET_V1'
    | 'RECOVERY_CODE_PEPPER_V1',
) {
  const value = runtime()[key]?.trim();
  if (!value) throw new Error(`Configuração ausente: ${key}`);
  return value;
}
