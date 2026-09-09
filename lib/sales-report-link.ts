import { SYSTEM_SALE_STATUSES } from './sale-display-status.ts';

export type SalesReportLink = {
  storeId: string;
  level: 'simple' | 'detailed' | 'complete';
  period: 'today' | 'yesterday' | '7d' | '15d' | 'day' | 'month' | 'all';
  day: string;
  month: string;
  query: string;
  alertOnly: boolean;
  issue: 'all' | 'missing_receipt' | 'pending_payment';
  seller: string;
  orderStatus: string;
};
const periods = ['today', 'yesterday', '7d', '15d', 'day', 'month', 'all'];
const levels = ['simple', 'detailed', 'complete'];
const idPattern = /^[a-f0-9-]{20,80}$/i;

export function parseSalesReportLink(search: string): SalesReportLink | null {
  if (search.length > 1600) return null;
  const params = new URLSearchParams(search);
  for (const key of [
    'report',
    'storeId',
    'level',
    'period',
    'day',
    'month',
    'q',
    'alert',
    'issue',
    'sellerId',
    'saleStatus',
    'orderStatus',
  ])
    if (params.getAll(key).length > 1) return null;
  if (params.get('report') !== 'sales') return null;
  const storeId = params.get('storeId') ?? '';
  const level = params.get('level') ?? 'complete';
  const period = params.get('period') ?? 'all';
  const day = params.get('day') ?? '';
  const month = params.get('month') ?? '';
  if (
    period === 'day' &&
    (Number(day.slice(0, 4)) < 2000 || Number(day.slice(0, 4)) > 2200)
  )
    return null;
  if (
    period === 'month' &&
    (Number(month.slice(0, 4)) < 2000 || Number(month.slice(0, 4)) > 2200)
  )
    return null;
  if (
    !idPattern.test(storeId) ||
    !levels.includes(level) ||
    !periods.includes(period)
  )
    return null;
  if (
    period === 'day' &&
    (!/^\d{4}-\d{2}-\d{2}$/.test(day) ||
      !Number.isFinite(Date.parse(`${day}T12:00:00Z`)) ||
      new Date(`${day}T12:00:00Z`).toISOString().slice(0, 10) !== day)
  )
    return null;
  if (period === 'month' && !/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) return null;
  const query = (params.get('q') ?? '').trim();
  if (new TextEncoder().encode(query).length > 48) return null;
  const issue = params.get('issue') ?? 'all';
  if (!['all', 'missing_receipt', 'pending_payment'].includes(issue))
    return null;
  const seller = params.get('sellerId') ?? 'all';
  if (seller !== 'all' && !idPattern.test(seller)) return null;
  const automatic = params.get('saleStatus');
  const custom = params.get('orderStatus');
  if (automatic && custom) return null;
  if (automatic && !SYSTEM_SALE_STATUSES.some((item) => item.key === automatic))
    return null;
  if (custom && custom !== 'none' && !idPattern.test(custom)) return null;
  if (params.has('alert') && params.get('alert') !== '1') return null;
  return {
    storeId,
    level: level as SalesReportLink['level'],
    period: period as SalesReportLink['period'],
    day,
    month,
    query,
    alertOnly: params.get('alert') === '1',
    issue: issue as SalesReportLink['issue'],
    seller,
    orderStatus: automatic ? `auto_${automatic}` : (custom ?? 'all'),
  };
}

export function salesReportPath(
  storeId: string,
  level: SalesReportLink['level'],
  filters: string,
) {
  const params = new URLSearchParams(filters);
  params.set('report', 'sales');
  params.set('storeId', storeId);
  params.set('level', level);
  const parsed = parseSalesReportLink(params.toString());
  if (!parsed)
    throw new Error(
      'Não foi possível gerar o link. Confira os filtros do relatório.',
    );
  const safe = new URLSearchParams({
    report: 'sales',
    storeId: parsed.storeId,
    level: parsed.level,
    period: parsed.period,
  });
  if (parsed.period === 'day') safe.set('day', parsed.day);
  if (parsed.period === 'month') safe.set('month', parsed.month);
  if (parsed.query) safe.set('q', parsed.query);
  if (parsed.alertOnly) safe.set('alert', '1');
  if (parsed.issue !== 'all') safe.set('issue', parsed.issue);
  if (parsed.seller !== 'all') safe.set('sellerId', parsed.seller);
  if (parsed.orderStatus.startsWith('auto_'))
    safe.set('saleStatus', parsed.orderStatus.slice(5));
  else if (parsed.orderStatus !== 'all')
    safe.set('orderStatus', parsed.orderStatus);
  return `/?${safe.toString()}`;
}

// OAuth only carries this known internal route, never an arbitrary redirect URL.
export function safeReportReturnTo(value: unknown) {
  if (
    typeof value !== 'string' ||
    value.length > 1600 ||
    !value.startsWith('/?') ||
    /[\\\r\n]/.test(value)
  )
    return '/';
  try {
    const url = new URL(value, 'https://report.internal');
    if (
      url.origin !== 'https://report.internal' ||
      url.pathname !== '/' ||
      url.hash
    )
      return '/';
    const parsed = parseSalesReportLink(url.search);
    return parsed
      ? salesReportPath(parsed.storeId, parsed.level, url.search)
      : '/';
  } catch {
    return '/';
  }
}

export function currentReportReturnTo() {
  return typeof window === 'undefined'
    ? '/'
    : safeReportReturnTo(
        `${window.location.pathname}${window.location.search}`,
      );
}
export function reportGoogleLoginPath() {
  return `/api/auth/google?returnTo=${encodeURIComponent(currentReportReturnTo())}`;
}
