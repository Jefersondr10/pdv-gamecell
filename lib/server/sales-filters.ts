import { HttpError, utf8Prefix } from './http.ts';
import {
  SALE_ALERT_SQL,
  SALE_CHECK_STATUS_SQL,
  SALE_RECONCILED_SQL,
  SALE_HAS_MANUAL_STATUS_SQL,
  isSaleCheckStatus,
} from './sale-status-sql.ts';
import type { SaleCheckKey, SaleIssueKey } from '../sale-display-status.ts';
import { SALE_ISSUES } from '../sale-display-status.ts';
import { SALE_ISSUE_SQL } from './sale-status-sql.ts';
export { SALE_ALERT_SQL, SALE_RECONCILED_SQL } from './sale-status-sql.ts';

export type SalesPeriod =
  | 'today'
  | 'yesterday'
  | '7d'
  | '15d'
  | 'day'
  | 'month'
  | 'all';

export type SalesIssue = SaleIssueKey;
export type SalesAutoStatus = SaleCheckKey | 'pending';

export type ParsedSalesFilters = {
  alertOnly: boolean;
  bindings: Array<string | number>;
  comparison: {
    bindings: Array<string | number>;
    label: string;
    where: string[];
  } | null;
  day: string | null;
  from: number | null;
  month: string | null;
  issue: SalesIssue | null;
  orderStatusId: string | null;
  saleStatus: SalesAutoStatus | null;
  period: SalesPeriod | null;
  query: string;
  customerId: string | null;
  sellerId: string | null;
  saleId: string | null;
  to: number | null;
  where: string[];
};

const DAY_MS = 24 * 60 * 60 * 1000;
const MAX_LEGACY_PERIOD_MS = 367 * DAY_MS;
const SAO_PAULO_TIME_ZONE = 'America/Sao_Paulo';

export function parseSalesFilters(
  url: URL,
  storeId: string,
  now = Date.now(),
): ParsedSalesFilters {
  const requestedPeriod = url.searchParams.get('period');
  const period = parsePeriod(requestedPeriod);
  const day = period === 'day' ? parseDay(url.searchParams.get('day')) : null;
  const month =
    period === 'month' ? parseMonth(url.searchParams.get('month')) : null;
  let from: number | null;
  let to: number | null;

  if (period) {
    ({ from, to } = periodBounds(period, day, month, now));
  } else {
    from = optionalMillis(url.searchParams.get('from'), 'Data inicial');
    to = optionalMillis(url.searchParams.get('to'), 'Data final');
    if (from === null && to === null) {
      to = now + DAY_MS;
      from = to - MAX_LEGACY_PERIOD_MS;
    }
    if (to === null) to = Math.min(now + DAY_MS, from! + MAX_LEGACY_PERIOD_MS);
    if (from === null) from = to - MAX_LEGACY_PERIOD_MS;
    if (from >= to) {
      throw new HttpError(400, 'Período inválido.', 'INVALID_PERIOD');
    }
    if (to - from > MAX_LEGACY_PERIOD_MS) {
      throw new HttpError(
        400,
        'Consulte no máximo 12 meses por vez.',
        'PERIOD_TOO_LARGE',
      );
    }
  }

  const query = utf8Prefix((url.searchParams.get('q') ?? '').trim(), 48);
  const alertValue = url.searchParams.get('alert');
  if (alertValue !== null && alertValue !== '' && alertValue !== '1') {
    throw new HttpError(400, 'Filtro de avisos inválido.', 'INVALID_ALERT');
  }
  const alertOnly = alertValue === '1';
  const issue = parseIssue(url.searchParams.get('issue'));
  const orderStatusId = parseOrderStatus(url.searchParams.get('orderStatus'));
  const statusScope = url.searchParams.get('statusScope') ?? 'saved';
  if (!['saved', 'display'].includes(statusScope))
    throw new HttpError(
      400,
      'Filtro de status inválido.',
      'INVALID_STATUS_SCOPE',
    );
  const saleStatusInput = url.searchParams.get('saleStatus');
  if (
    saleStatusInput &&
    saleStatusInput !== 'pending' &&
    !isSaleCheckStatus(saleStatusInput)
  )
    throw new HttpError(
      400,
      'Status da venda inválido.',
      'INVALID_SALE_STATUS',
    );
  const saleStatus = (saleStatusInput || null) as SalesAutoStatus | null;
  const saleId = (url.searchParams.get('saleId') ?? '').trim() || null;
  const customerId = (url.searchParams.get('customerId') ?? '').trim() || null;
  const sellerId = (url.searchParams.get('sellerId') ?? '').trim() || null;
  if (sellerId && !/^[a-f0-9-]{20,80}$/i.test(sellerId)) {
    throw new HttpError(400, 'Vendedor inválido.', 'INVALID_SELLER');
  }
  if (customerId && !/^[a-f0-9-]{20,80}$/i.test(customerId)) {
    throw new HttpError(400, 'Cliente inválido.', 'INVALID_CUSTOMER');
  }
  if (saleId && !/^[a-f0-9-]{20,80}$/i.test(saleId)) {
    throw new HttpError(400, 'Venda inválida.', 'INVALID_SALE');
  }
  const current = buildFilterClauses({
    statusScope,
    sellerId,
    saleStatus,
    customerId,
    alertOnly,
    from,
    issue,
    orderStatusId,
    query,
    saleId,
    storeId,
    to,
  });
  const previous = previousPeriodBounds(period, from, to, day, month);
  const comparison =
    previous && !saleId
      ? {
          ...buildFilterClauses({
            statusScope,
            sellerId,
            saleStatus,
            customerId,
            alertOnly,
            from: previous.from,
            issue,
            orderStatusId,
            query,
            saleId: null,
            storeId,
            to: previous.to,
          }),
          label: previous.label,
        }
      : null;

  return {
    sellerId,
    saleStatus,
    customerId,
    alertOnly,
    bindings: current.bindings,
    comparison,
    day,
    from,
    issue,
    month,
    orderStatusId,
    period,
    query,
    saleId,
    to,
    where: current.where,
  };
}

function buildFilterClauses({
  statusScope,
  sellerId,
  saleStatus,
  customerId,
  alertOnly,
  from,
  issue,
  orderStatusId,
  query,
  saleId,
  storeId,
  to,
}: {
  statusScope: string;
  sellerId: string | null;
  saleStatus: SalesAutoStatus | null;
  customerId: string | null;
  alertOnly: boolean;
  from: number | null;
  issue: SalesIssue | null;
  orderStatusId: string | null;
  query: string;
  saleId: string | null;
  storeId: string;
  to: number | null;
}) {
  const where = ['s.store_id = ?'];
  const bindings: Array<string | number> = [storeId];
  if (sellerId) {
    where.push('s.seller_user_id = ?');
    bindings.push(sellerId);
  }
  if (saleStatus === 'pending')
    where.push(`s.status = 'completed' AND NOT ${SALE_RECONCILED_SQL}`);
  else if (saleStatus) {
    where.push(`${SALE_CHECK_STATUS_SQL} = ?`);
    bindings.push(saleStatus);
  }
  if (customerId) {
    where.push('s.customer_id = ?');
    bindings.push(customerId);
  }
  if (from !== null) {
    where.push('s.created_at >= ?');
    bindings.push(from);
  }
  if (to !== null) {
    where.push('s.created_at < ?');
    bindings.push(to);
  }
  if (query) {
    const pattern = `%${query}%`;
    const saleNumberMatch = query.match(/^#?\s*0*(\d{1,10})$/);
    const exactSaleNumber = saleNumberMatch
      ? Number(saleNumberMatch[1])
      : -1;
    where.push(`(
      CAST(s.number AS TEXT) LIKE ? OR s.number = ?
      OR s.customer_name LIKE ? COLLATE NOCASE
      OR s.seller_name LIKE ? COLLATE NOCASE OR EXISTS (
        SELECT 1 FROM sale_items search_item
        WHERE search_item.sale_id = s.id AND search_item.store_id = s.store_id
          AND (search_item.product_name LIKE ? COLLATE NOCASE
            OR search_item.product_detail LIKE ? COLLATE NOCASE
            OR search_item.serial LIKE ? COLLATE NOCASE)
      )
    )`);
    bindings.push(
      pattern,
      exactSaleNumber,
      pattern,
      pattern,
      pattern,
      pattern,
      pattern,
    );
  }
  if (alertOnly) {
    where.push(`(s.status = 'completed' AND ${SALE_ALERT_SQL})`);
  }
  if (issue)
    where.push(`(s.status = 'completed' AND ${SALE_ISSUE_SQL[issue]})`);
  if (orderStatusId === 'none') {
    where.push(
      statusScope === 'display'
        ? `NOT ${SALE_HAS_MANUAL_STATUS_SQL}`
        : 's.order_status_id IS NULL',
    );
  } else if (orderStatusId) {
    where.push('s.order_status_id = ?');
    bindings.push(orderStatusId);
  }
  if (orderStatusId && statusScope === 'display') {
    where.push(`s.status = 'completed' AND NOT ${SALE_RECONCILED_SQL}`);
    if (orderStatusId !== 'none') where.push(SALE_HAS_MANUAL_STATUS_SQL);
  }
  if (saleId) {
    where.push('s.id = ?');
    bindings.push(saleId);
  }
  return { bindings, where };
}

function parseIssue(value: string | null): SalesIssue | null {
  if (value === null || value === '') return null;
  if (SALE_ISSUES.some((issue) => issue.key === value))
    return value as SalesIssue;
  throw new HttpError(400, 'Filtro de pendência inválido.', 'INVALID_ISSUE');
}

function parseOrderStatus(value: string | null) {
  if (value === null || value === '') return null;
  if (value === 'none') return value;
  if (!/^[a-f0-9-]{20,80}$/i.test(value)) {
    throw new HttpError(400, 'Status de pedido inválido.', 'INVALID_STATUS');
  }
  return value;
}

function parsePeriod(value: string | null): SalesPeriod | null {
  if (value === null || value === '') return null;
  if (
    value === 'today' ||
    value === 'yesterday' ||
    value === '7d' ||
    value === '15d' ||
    value === 'day' ||
    value === 'month' ||
    value === 'all'
  ) {
    return value;
  }
  throw new HttpError(400, 'Filtro de período inválido.', 'INVALID_PERIOD');
}

function parseDay(value: string | null) {
  if (
    !value ||
    !/^\d{4}-(?:0[1-9]|1[0-2])-(?:0[1-9]|[12]\d|3[01])$/.test(value)
  ) {
    throw new HttpError(400, 'Selecione um dia válido.', 'INVALID_DAY');
  }
  const parsed = new Date(`${value}T00:00:00-03:00`);
  if (
    !Number.isFinite(parsed.getTime()) ||
    dateKey(parsed.getTime()) !== value
  ) {
    throw new HttpError(400, 'Selecione um dia válido.', 'INVALID_DAY');
  }
  return value;
}

function parseMonth(value: string | null) {
  if (!value || !/^\d{4}-(?:0[1-9]|1[0-2])$/.test(value)) {
    throw new HttpError(400, 'Selecione um mês válido.', 'INVALID_MONTH');
  }
  const year = Number(value.slice(0, 4));
  if (year < 2000 || year > 2200) {
    throw new HttpError(400, 'Selecione um mês válido.', 'INVALID_MONTH');
  }
  return value;
}

function periodBounds(
  period: SalesPeriod,
  day: string | null,
  month: string | null,
  now: number,
): { from: number | null; to: number | null } {
  if (period === 'all') return { from: null, to: null };
  if (period === 'day') {
    const from = saoPauloMidnight(day!);
    return { from, to: from + DAY_MS };
  }
  if (period === 'month') {
    const [year, monthNumber] = month!.split('-').map(Number);
    const nextYear = monthNumber === 12 ? year + 1 : year;
    const nextMonth = monthNumber === 12 ? 1 : monthNumber + 1;
    return {
      from: saoPauloMidnight(`${year}-${twoDigits(monthNumber)}-01`),
      to: saoPauloMidnight(`${nextYear}-${twoDigits(nextMonth)}-01`),
    };
  }

  const todayStart = saoPauloMidnight(dateKey(now));
  if (period === 'today') return { from: todayStart, to: todayStart + DAY_MS };
  if (period === 'yesterday') {
    return { from: todayStart - DAY_MS, to: todayStart };
  }
  const days = period === '7d' ? 7 : 15;
  return {
    from: todayStart - (days - 1) * DAY_MS,
    to: todayStart + DAY_MS,
  };
}

function previousPeriodBounds(
  period: SalesPeriod | null,
  from: number | null,
  to: number | null,
  day: string | null,
  month: string | null,
): { from: number; label: string; to: number } | null {
  if (!period || period === 'all' || from === null || to === null) return null;
  if (period === 'month') {
    const [year, monthNumber] = month!.split('-').map(Number);
    const previousYear = monthNumber === 1 ? year - 1 : year;
    const previousMonth = monthNumber === 1 ? 12 : monthNumber - 1;
    return {
      from: saoPauloMidnight(`${previousYear}-${twoDigits(previousMonth)}-01`),
      label: 'mês anterior',
      to: saoPauloMidnight(`${year}-${twoDigits(monthNumber)}-01`),
    };
  }
  const duration = to - from;
  return {
    from: from - duration,
    label:
      period === 'today'
        ? 'ontem'
        : period === '7d'
          ? '7 dias anteriores'
          : period === '15d'
            ? '15 dias anteriores'
            : day || period === 'yesterday'
              ? 'dia anterior'
              : 'período anterior',
    to: from,
  };
}

function dateKey(value: number) {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: SAO_PAULO_TIME_ZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date(value));
}

function saoPauloMidnight(day: string) {
  return new Date(`${day}T00:00:00-03:00`).getTime();
}

function optionalMillis(value: string | null, label: string) {
  if (value === null || value === '') return null;
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number < 0) {
    throw new HttpError(400, `${label} inválida.`, 'INVALID_DATE');
  }
  return number;
}

function twoDigits(value: number) {
  return String(value).padStart(2, '0');
}
