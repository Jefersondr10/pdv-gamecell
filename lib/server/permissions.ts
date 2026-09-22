import {
  ALL_PERMISSIONS,
  PERMISSION_PARENTS,
  canAny,
  type Permission,
  type PermissionSubject,
} from '../permissions.ts';
import { HttpError } from './http.ts';

export function assertPermission(
  subject: PermissionSubject,
  ...permissions: Permission[]
) {
  if (!canAny(subject, permissions))
    throw new HttpError(
      403,
      'Seu usuário não tem acesso a esta função. Fale com o responsável pela loja.',
      'PERMISSION_DENIED',
    );
}

export function parsePermissions(
  value: unknown,
  role: PermissionSubject['role'],
): Permission[] {
  if (
    !Array.isArray(value) ||
    value.length > ALL_PERMISSIONS.length ||
    value.some(
      (key) =>
        typeof key !== 'string' || !ALL_PERMISSIONS.includes(key as Permission),
    )
  ) {
    throw new HttpError(
      400,
      'Selecione apenas as permissões disponíveis.',
      'INVALID_PERMISSIONS',
    );
  }
  const keys = [...new Set(value)] as Permission[];
  if (role !== 'admin' && keys.includes('users.manage'))
    throw new HttpError(
      400,
      'Somente administradores podem gerenciar funcionários.',
      'INVALID_PERMISSIONS',
    );
  if (
    keys.some((key) =>
      (PERMISSION_PARENTS[key] ?? []).some((parent) => !keys.includes(parent)),
    )
  )
    throw new HttpError(
      400,
      'Libere o menu correspondente antes de liberar suas ações.',
      'INVALID_PERMISSIONS',
    );
  return keys.sort();
}

// Central coverage for all authenticated business routes; record-dependent file
// authorization and legacy recovery are checked in their respective handlers.
export function routePermissions(request: Request): Permission[] | null {
  const url = new URL(request.url);
  let path;
  try {
    path = decodeURIComponent(url.pathname).replace(/\/+$/, '');
  } catch {
    throw new HttpError(400, 'Endereço inválido.', 'INVALID_PATH');
  }
  const read = request.method === 'GET';
  if (path === '/api/reservations' || /^\/api\/reservations\/[^/]+$/.test(path))
    return [read ? 'reservations' : 'reservations.manage'];
  if (path === '/api/report-shares') return ['sales'];
  if (path === '/api/sales')
    return read
      ? url.searchParams.get('customerId')?.trim()
        ? ['sales', 'clients.history']
        : ['sales']
      : ['sell'];
  if (path === '/api/sales/groups') return ['sales', 'ranking'];
  if (/^\/api\/sales\/[^/]+\/(history|receipt-conflicts)$/.test(path))
    return ['sales'];
  if (/^\/api\/sales\/[^/]+\/payments$/.test(path)) return ['sales.payments'];
  if (/^\/api\/sales\/[^/]+\/prices$/.test(path)) return ['sales.prices'];
  if (/^\/api\/sales\/[^/]+\/date$/.test(path)) return ['sales.date'];
  if (/^\/api\/sales\/[^/]+\/receipt-payment$/.test(path))
    return read ? ['sales'] : ['sales.payments'];
  if (/^\/api\/sales\/[^/]+\/attachments$/.test(path))
    return ['sales.attachments'];
  if (/^\/api\/sales\/[^/]+\/cancel$/.test(path)) return ['sales.cancel'];
  if (/^\/api\/sales\/[^/]+\/order-status$/.test(path)) return ['sales.status'];
  if (/^\/api\/sales\/[^/]+\/participants$/.test(path))
    return ['sales.participants'];
  if (/^\/api\/sales\/[^/]+\/receipt-values$/.test(path))
    return ['sales.receipts'];
  if (/^\/api\/sales\/[^/]+\/receipts\/[^/]+$/.test(path))
    return ['sales.receipts.delete'];
  if (/^\/api\/sales\/[^/]+\/receipt-ocr$/.test(path))
    return read ? ['sales', 'overview'] : ['sales.receipts'];
  if (path === '/api/receipt-ocr/status') return ['sales', 'overview', 'sell'];
  if (path === '/api/receipt-ocr/legacy-review') return ['sales.receipts'];
  if (path === '/api/entries') return [read ? 'entries' : 'entry'];
  if (path === '/api/inventory/history') return ['entries', 'sales'];
  if (path === '/api/inventory') return ['stock', 'reservations'];
  if (path === '/api/inventory/lookup')
    return ['sell', 'entry', 'stock', 'reservations'];
  if (path === '/api/rankings') return ['ranking'];
  if (path === '/api/overview') return ['overview'];
  if (path === '/api/clients') return ['clients.create'];
  if (/^\/api\/clients\/[^/]+$/.test(path)) return ['clients.manage'];
  if (path.startsWith('/api/products')) return ['products.manage'];
  // The payloadless, idempotent system-catalog sync retains its original access.
  if (path.startsWith('/api/pix-accounts')) return ['finance.manage'];
  if (path.startsWith('/api/order-statuses'))
    return read ? ['finance', 'sales'] : ['finance.manage'];
  if (path.startsWith('/api/users')) return ['users.manage'];
  if (path === '/api/system/backup-status') return ['backup'];
  return null;
}
