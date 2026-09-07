export type BackupAlertSettings = {
  email: string | null;
  revision: number;
  updatedAt: number | null;
  deliveryStatus: 'not_configured';
};

export function normalizeBackupAlertEmail(value: unknown): string | null {
  if (typeof value !== 'string' || value.length > 254)
    throw new Error('Informe um e-mail válido.');
  for (let index = 0; index < value.length; index++) {
    const code = value.charCodeAt(index);
    if (code < 32 || code === 127) throw new Error('Informe um e-mail válido.');
  }
  const email = value.trim().toLowerCase();
  if (!email) return null;
  const parts = email.split('@');
  if (
    parts.length !== 2 ||
    parts[0].length > 64 ||
    !/^[a-z0-9.!#$%&'*+/=?^_`{|}~-]+$/.test(parts[0]) ||
    parts[0].startsWith('.') ||
    parts[0].endsWith('.') ||
    parts[0].includes('..')
  )
    throw new Error('Informe um e-mail válido.');
  const domain = parts[1].split('.');
  if (
    domain.length < 2 ||
    domain.some(
      (label) => !/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(label),
    )
  )
    throw new Error('Informe um e-mail válido.');
  return email;
}
