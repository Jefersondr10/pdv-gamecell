'use client';

import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import {
  ArrowDownToLine,
  ArrowRight,
  Building2,
  CircleUserRound,
  Download,
  FileText,
  History,
  Package,
  RotateCcw,
  ScanBarcode,
  Search,
  Settings,
  ShoppingBag,
  Smartphone,
  TrendingUp,
  UserRound,
  UsersRound,
  WalletCards,
  Warehouse,
} from 'lucide-react';

import {
  EntryWizard,
  type LocalTestEntryCommitResult,
  type LocalTestEntryRecord,
} from '@/components/pdv/entry-wizard';
import {
  SellWizard,
  type SaleProductLookup,
} from '@/components/pdv/sell-wizard';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import {
  NativeSelect,
  NativeSelectOption,
} from '@/components/ui/native-select';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { normalizeCandidate } from '@/lib/scanner';

type View = 'sell' | 'entry' | 'stock' | 'sales' | 'settings';
type StorageMode = 'browser' | 'session';
type SaleStatusValue = 'Concluída' | 'Cancelada';
type SalesGrouping = 'list' | 'model' | 'customer';
type SalesDayFilter = 'today' | 'yesterday' | 'all' | 'custom';

type StockRow = {
  id: string;
  name: string;
  detail: string;
  available: number;
  received: number;
  codes: string[];
  testOnly?: boolean;
};

type SaleModel = {
  name: string;
  quantity: number;
  total: number;
};

type SaleRow = {
  number: string;
  customer: string;
  seller: string;
  items: number;
  total: number;
  payment: string;
  date: string;
  time: string;
  status: SaleStatusValue;
  models: SaleModel[];
};

type SalesGroupRow = {
  label: string;
  sales: number;
  items: number;
  total: number;
};

const TEST_STOCK_KEY = 'pdv-apple:test-stock:v1';
const TODAY = getSaoPauloDateKey(0);
const YESTERDAY = getSaoPauloDateKey(-1);

const navItems: Array<{
  view: View;
  label: string;
  shortLabel?: string;
  icon: typeof ShoppingBag;
}> = [
  { view: 'sell', label: 'Vender', icon: ShoppingBag },
  { view: 'entry', label: 'Entrada', icon: Package },
  { view: 'stock', label: 'Estoque', icon: Warehouse },
  { view: 'sales', label: 'Vendas', icon: History },
  {
    view: 'settings',
    label: 'Configurações',
    shortLabel: 'Ajustes',
    icon: Settings,
  },
];

const inventoryRows: StockRow[] = [
  {
    id: 'iphone-17-pro-max-deep-blue-256',
    name: 'iPhone 17 Pro Max',
    detail: 'Deep Blue · 256 GB',
    available: 12,
    received: 18,
    codes: ['195950638011'],
  },
  {
    id: 'iphone-17-pro-max-silver-256',
    name: 'iPhone 17 Pro Max',
    detail: 'Silver · 256 GB',
    available: 5,
    received: 8,
    codes: ['195950637151'],
  },
  {
    id: 'iphone-16-pink-128',
    name: 'iPhone 16',
    detail: 'Pink · 128 GB',
    available: 3,
    received: 6,
    codes: ['195949822193'],
  },
  {
    id: 'iphone-15-black-128',
    name: 'iPhone 15',
    detail: 'Black · 128 GB',
    available: 2,
    received: 9,
    codes: ['195949035913', '195949035937'],
  },
  {
    id: 'iphone-17-white-256',
    name: 'iPhone 17',
    detail: 'White · 256 GB',
    available: 1,
    received: 4,
    codes: ['4549995649161'],
  },
];

const salesRows: SaleRow[] = [
  {
    number: '#00128',
    customer: 'Rafael Martins',
    seller: 'Jeferson',
    items: 2,
    total: 1789800,
    payment: 'Pix + dinheiro',
    date: TODAY,
    time: '18:42',
    status: 'Concluída',
    models: [
      { name: 'iPhone 17 Pro Max', quantity: 1, total: 999900 },
      { name: 'iPhone 16', quantity: 1, total: 789900 },
    ],
  },
  {
    number: '#00127',
    customer: 'Camila Souza',
    seller: 'Marcos',
    items: 1,
    total: 999900,
    payment: 'Pix · Nubank',
    date: TODAY,
    time: '16:18',
    status: 'Concluída',
    models: [{ name: 'iPhone 17 Pro Max', quantity: 1, total: 999900 }],
  },
  {
    number: '#00126',
    customer: 'Bruno Lima',
    seller: 'Jeferson',
    items: 1,
    total: 569900,
    payment: 'Dinheiro',
    date: TODAY,
    time: '14:05',
    status: 'Cancelada',
    models: [{ name: 'iPhone 15', quantity: 1, total: 569900 }],
  },
  {
    number: '#00125',
    customer: 'Fernanda Alves',
    seller: 'Ana',
    items: 3,
    total: 2439700,
    payment: '2 Pix',
    date: YESTERDAY,
    time: '19:34',
    status: 'Concluída',
    models: [
      { name: 'iPhone 16', quantity: 2, total: 1579800 },
      { name: 'iPhone 15', quantity: 1, total: 859900 },
    ],
  },
];

export function PdvApp() {
  const [activeView, setActiveView] = useState<View>('sell');
  const [viewRun, setViewRun] = useState(0);
  const [stagedSerial, setStagedSerial] = useState('');
  const [testEntries, setTestEntries] = useState<LocalTestEntryRecord[]>([]);
  const [testStorageReady, setTestStorageReady] = useState(false);
  const [testStorageMode, setTestStorageMode] =
    useState<StorageMode>('browser');
  const testEntriesRef = useRef<LocalTestEntryRecord[]>([]);
  const existingTestSerials = useMemo(
    () => testEntries.flatMap((entry) => entry.serials),
    [testEntries],
  );
  const saleProductsBySerial = useMemo<SaleProductLookup>(() => {
    const lookup: SaleProductLookup = {};
    for (const entry of testEntries) {
      for (const serial of entry.serials) {
        lookup[serial.trim().toUpperCase()] = {
          product: entry.productName,
          detail: entry.productDetail,
        };
      }
    }
    return lookup;
  }, [testEntries]);

  const changeView = (view: View) => {
    if (view === 'sell') setStagedSerial('');
    setActiveView(view);
    setViewRun((current) => current + 1);
  };

  const saveTestEntry = (
    entry: LocalTestEntryRecord,
  ): LocalTestEntryCommitResult => {
    const result = mergeTestEntryWithResult(testEntriesRef.current, entry);
    testEntriesRef.current = result.entries;
    setTestEntries(result.entries);
    return {
      added: result.added,
      duplicates: result.duplicates,
      capacityReached: result.capacityReached,
    };
  };

  useEffect(() => {
    let cancelled = false;
    queueMicrotask(() => {
      if (cancelled) return;
      try {
        const stored = window.localStorage.getItem(TEST_STOCK_KEY);
        if (stored) {
          const loadedEntries = parseStoredTestEntries(stored);
          const merged = mergeTestEntryCollections(
            testEntriesRef.current,
            loadedEntries,
          );
          testEntriesRef.current = merged;
          setTestEntries(merged);
        }
      } catch {
        setTestStorageMode('session');
      } finally {
        setTestStorageReady(true);
      }
    });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!testStorageReady || testStorageMode !== 'browser') return;
    let cancelled = false;
    try {
      window.localStorage.setItem(
        TEST_STOCK_KEY,
        JSON.stringify({ version: 1, entries: testEntries }),
      );
    } catch {
      queueMicrotask(() => {
        if (!cancelled) setTestStorageMode('session');
      });
    }
    return () => {
      cancelled = true;
    };
  }, [testEntries, testStorageMode, testStorageReady]);

  useEffect(() => {
    const syncTestEntries = (event: StorageEvent) => {
      if (event.key !== TEST_STOCK_KEY || !event.newValue) return;
      const incoming = parseStoredTestEntries(event.newValue);
      const merged = mergeTestEntryCollections(
        testEntriesRef.current,
        incoming,
      );
      testEntriesRef.current = merged;
      setTestEntries(merged);
    };
    window.addEventListener('storage', syncTestEntries);
    return () => window.removeEventListener('storage', syncTestEntries);
  }, []);

  useEffect(() => {
    const modelContext = (
      document as Document & {
        modelContext?: {
          registerTool: (
            tool: {
              name: string;
              title: string;
              description: string;
              inputSchema: object;
              annotations: {
                readOnlyHint: boolean;
                untrustedContentHint: boolean;
              };
              execute: (input: unknown) => Promise<object>;
            },
            options: { signal: AbortSignal },
          ) => void | Promise<void>;
        };
      }
    ).modelContext;
    if (!modelContext?.registerTool) return;

    const lifecycle = new AbortController();
    const registration = modelContext.registerTool(
      {
        name: 'stage_serial_for_sale',
        title: 'Preparar aparelho para venda',
        description:
          'Abre uma nova venda e prepara um número de série para conferência. Não finaliza nem movimenta o estoque.',
        inputSchema: {
          type: 'object',
          properties: {
            serial: {
              type: 'string',
              description:
                'Número de série Apple com 8 a 18 letras ou números.',
            },
          },
          required: ['serial'],
          additionalProperties: false,
        },
        annotations: { readOnlyHint: false, untrustedContentHint: false },
        async execute(input) {
          if (
            !input ||
            typeof input !== 'object' ||
            !('serial' in input) ||
            typeof input.serial !== 'string'
          ) {
            throw new Error('Informe o campo serial.');
          }
          const candidate = normalizeCandidate(
            input.serial,
            'manual_code_128',
            'apple_serial',
          );
          if (!candidate) {
            throw new Error(
              'O SN deve ter de 8 a 18 caracteres e conter pelo menos uma letra.',
            );
          }
          setStagedSerial(candidate.normalizedValue);
          setActiveView('sell');
          setViewRun((current) => current + 1);
          await new Promise<void>((resolve) =>
            requestAnimationFrame(() => resolve()),
          );
          return {
            status: 'staged',
            serial: candidate.normalizedValue,
            finalized: false,
          };
        },
      },
      { signal: lifecycle.signal },
    );
    void Promise.resolve(registration).catch(() => undefined);
    return () => lifecycle.abort();
  }, []);

  return (
    <main className="h-dvh overflow-hidden bg-background text-foreground">
      <aside className="fixed inset-y-0 left-0 z-30 hidden w-64 border-r bg-sidebar px-5 py-6 lg:flex lg:flex-col">
        <Brand />
        <MainNavigation activeView={activeView} onChange={changeView} />
        <OperatorCard />
      </aside>

      <section className="mx-auto flex h-dvh min-h-0 max-w-[1500px] flex-col overflow-hidden lg:ml-64">
        <AppHeader />
        <div className="app-demo-strip shrink-0 border-b border-amber-500/15 bg-amber-50 px-4 py-1.5 text-center text-xs font-semibold text-amber-900 sm:px-7">
          Modo de teste · entradas ficam somente{' '}
          {testStorageMode === 'browser' ? 'neste navegador' : 'nesta sessão'} ·
          não use dados reais
        </div>
        <div className="min-h-0 flex-1 overflow-hidden pb-[calc(4.75rem+env(safe-area-inset-bottom))] lg:pb-0">
          {activeView === 'sell' && (
            <SellWizard
              key={`sell-${viewRun}`}
              productsBySerial={saleProductsBySerial}
              stagedSerial={stagedSerial}
            />
          )}
          {activeView === 'entry' && (
            <EntryWizard
              existingTestSerials={existingTestSerials}
              key={`entry-${viewRun}`}
              onConfirmTestEntry={saveTestEntry}
              storageMode={testStorageMode}
            />
          )}
          {activeView === 'stock' && (
            <StockView
              key={`stock-${viewRun}`}
              storageMode={testStorageMode}
              storageReady={testStorageReady}
              testEntries={testEntries}
            />
          )}
          {activeView === 'sales' && <SalesView key={`sales-${viewRun}`} />}
          {activeView === 'settings' && (
            <SettingsView key={`settings-${viewRun}`} />
          )}
        </div>
      </section>

      <MobileNavigation activeView={activeView} onChange={changeView} />
    </main>
  );
}

function StockView({
  testEntries,
  storageReady,
  storageMode,
}: {
  testEntries: LocalTestEntryRecord[];
  storageReady: boolean;
  storageMode: StorageMode;
}) {
  const [query, setQuery] = useState('');
  const testRows: StockRow[] = testEntries.map((entry) => {
    const catalogRow = inventoryRows.find((row) =>
      row.codes.some((code) => code.padStart(14, '0') === entry.gtin14),
    );
    return {
      id: `test:${entry.gtin14}`,
      name: catalogRow?.name ?? entry.productName,
      detail: catalogRow?.detail ?? entry.productDetail,
      available: entry.serials.length,
      received: entry.serials.length,
      codes: [entry.displayCode],
      testOnly: true,
    };
  });
  const rows = [...testRows, ...inventoryRows];
  const filtered = rows.filter((row) =>
    `${row.name} ${row.detail} ${row.codes.join(' ')}`
      .toLowerCase()
      .includes(query.toLowerCase()),
  );
  const available = inventoryRows.reduce((sum, row) => sum + row.available, 0);

  return (
    <PageContainer>
      <PageHeading
        action={
          <Button className="hidden h-10 rounded-xl sm:flex" variant="outline">
            <Download /> Exportar
          </Button>
        }
        description="Quantidade por variação e rastreabilidade individual por SN."
        eyebrow="Inventário"
        title="Estoque"
      />
      <div className="mb-3 grid shrink-0 grid-cols-3 gap-2 sm:gap-3">
        <MetricCard
          icon={Warehouse}
          label="Disponíveis"
          value={String(available)}
          accent="blue"
        />
        <MetricCard
          icon={Smartphone}
          label="Variações"
          value={String(inventoryRows.length)}
          accent="cyan"
        />
        <MetricCard
          icon={TrendingUp}
          label="Vendidos hoje"
          value="7"
          accent="green"
        />
      </div>

      <Card className="surface-card flex min-h-0 flex-1 flex-col overflow-hidden">
        <CardHeader className="shrink-0 border-b p-4">
          <div className="hidden sm:block">
            <CardTitle className="text-base">Produtos disponíveis</CardTitle>
            <CardDescription>
              Entradas de teste ficam separadas e não alteram os totais reais.
            </CardDescription>
          </div>
          <div className="relative w-full sm:w-72">
            <Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              aria-label="Pesquisar estoque"
              className="h-11 rounded-xl pl-9 text-base"
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Produto, cor ou código"
              value={query}
            />
          </div>
          {testRows.length > 0 && (
            <div className="col-span-full flex items-center gap-2 rounded-xl bg-amber-500/10 px-3 py-2 text-xs font-semibold text-amber-900">
              <Badge className="bg-amber-600 text-white hover:bg-amber-600">
                TESTE LOCAL
              </Badge>
              {storageMode === 'browser'
                ? 'Somente neste navegador · não é estoque real'
                : 'Somente nesta sessão · não é estoque real'}
            </div>
          )}
          {!storageReady && (
            <p className="col-span-full text-xs text-muted-foreground">
              Carregando entradas de teste…
            </p>
          )}
        </CardHeader>
        <CardContent className="min-h-0 flex-1 overflow-hidden px-0 py-0">
          <div className="hidden h-full min-h-0 overflow-auto overscroll-contain md:block">
            <Table>
              <TableHeader className="[&_th]:sticky [&_th]:top-0 [&_th]:z-10 [&_th]:bg-card">
                <TableRow>
                  <TableHead className="pl-5">Produto</TableHead>
                  <TableHead>Códigos</TableHead>
                  <TableHead>Recebidos</TableHead>
                  <TableHead>Disponíveis</TableHead>
                  <TableHead className="pr-5 text-right">Ação</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filtered.map((row) => (
                  <TableRow
                    className={row.testOnly ? 'bg-amber-50/60' : undefined}
                    key={row.id}
                  >
                    <TableCell className="pl-5">
                      <div className="flex items-center gap-2">
                        <p className="font-semibold">{row.name}</p>
                        {row.testOnly && (
                          <Badge className="bg-amber-600 text-white hover:bg-amber-600">
                            TESTE LOCAL
                          </Badge>
                        )}
                      </div>
                      <p className="text-xs text-muted-foreground">
                        {row.detail}
                      </p>
                    </TableCell>
                    <TableCell>
                      <p className="max-w-52 truncate font-mono text-xs text-muted-foreground">
                        {row.codes.join(' · ')}
                      </p>
                    </TableCell>
                    <TableCell>{row.received}</TableCell>
                    <TableCell>
                      <StockBadge count={row.available} />
                    </TableCell>
                    <TableCell className="pr-5 text-right">
                      <Button size="sm" variant="ghost">
                        Ver SNs <ArrowRight />
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
          <div className="h-full overflow-y-auto overscroll-contain divide-y md:hidden">
            {filtered.map((row) => (
              <button
                className={`flex min-h-[4.7rem] w-full items-center gap-3 px-4 py-3 text-left ${row.testOnly ? 'bg-amber-50/60' : ''}`}
                key={row.id}
                type="button"
              >
                <span className="grid size-11 shrink-0 place-items-center rounded-xl bg-secondary text-primary">
                  <Smartphone className="size-5" />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="flex items-center gap-1.5">
                    <span className="truncate text-sm font-semibold">
                      {row.name}
                    </span>
                    {row.testOnly && (
                      <Badge className="shrink-0 bg-amber-600 px-1.5 text-[0.6rem] text-white hover:bg-amber-600">
                        TESTE
                      </Badge>
                    )}
                  </span>
                  <span className="block truncate text-xs text-muted-foreground">
                    {row.detail}
                  </span>
                </span>
                <StockBadge count={row.available} />
                <ArrowRight className="size-4 text-muted-foreground" />
              </button>
            ))}
            {filtered.length === 0 && (
              <div className="grid h-full place-items-center p-6 text-center text-sm text-muted-foreground">
                Nenhum produto encontrado.
              </div>
            )}
          </div>
        </CardContent>
      </Card>
    </PageContainer>
  );
}

function SalesView() {
  const [dayFilter, setDayFilter] = useState<SalesDayFilter>('today');
  const [customDay, setCustomDay] = useState(TODAY);
  const [grouping, setGrouping] = useState<SalesGrouping>('list');
  const [query, setQuery] = useState('');

  const filteredSales = useMemo(() => {
    const selectedDay =
      dayFilter === 'today'
        ? TODAY
        : dayFilter === 'yesterday'
          ? YESTERDAY
          : dayFilter === 'custom'
            ? customDay || '__no-date__'
            : null;
    const normalizedQuery = query.trim().toLocaleLowerCase('pt-BR');

    return salesRows.filter((sale) => {
      if (selectedDay && sale.date !== selectedDay) return false;
      if (!normalizedQuery) return true;
      return `${sale.number} ${sale.customer} ${sale.seller} ${sale.payment} ${sale.models.map((model) => model.name).join(' ')}`
        .toLocaleLowerCase('pt-BR')
        .includes(normalizedQuery);
    });
  }, [customDay, dayFilter, query]);

  const completedSales = filteredSales.filter(
    (sale) => sale.status === 'Concluída',
  );
  const completedTotal = completedSales.reduce(
    (sum, sale) => sum + sale.total,
    0,
  );
  const completedItems = completedSales.reduce(
    (sum, sale) => sum + sale.items,
    0,
  );
  const groupedRows = useMemo(
    () =>
      grouping === 'model'
        ? groupSalesByModel(filteredSales)
        : grouping === 'customer'
          ? groupSalesByCustomer(filteredSales)
          : [],
    [filteredSales, grouping],
  );
  const isEmpty =
    grouping === 'list' ? filteredSales.length === 0 : groupedRows.length === 0;

  return (
    <PageContainer>
      <PageHeading
        action={
          <Button className="hidden h-10 rounded-xl sm:flex" variant="outline">
            <FileText /> Relatório
          </Button>
        }
        description="Itens, pagamentos, responsáveis, cancelamentos e devoluções."
        eyebrow="Histórico"
        title="Vendas"
      />
      <Card className="surface-card flex min-h-0 flex-1 flex-col overflow-hidden">
        <CardHeader className="shrink-0 gap-3 border-b p-3 sm:p-4">
          <div className="grid gap-2 sm:grid-cols-[12rem_minmax(0,1fr)]">
            <NativeSelect
              aria-label="Filtrar vendas por dia"
              className="h-11 w-full rounded-xl [&_select]:h-11 [&_select]:rounded-xl"
              onChange={(event) =>
                setDayFilter(event.target.value as SalesDayFilter)
              }
              value={dayFilter}
            >
              <NativeSelectOption value="today">
                Hoje · {formatShortDate(TODAY)}
              </NativeSelectOption>
              <NativeSelectOption value="yesterday">
                Ontem · {formatShortDate(YESTERDAY)}
              </NativeSelectOption>
              <NativeSelectOption value="all">Todos os dias</NativeSelectOption>
              <NativeSelectOption value="custom">
                Escolher uma data
              </NativeSelectOption>
            </NativeSelect>
            <div className="relative">
              <Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                aria-label="Pesquisar vendas"
                className="h-11 rounded-xl pl-9 text-base"
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Cliente, modelo ou número"
                value={query}
              />
            </div>
          </div>

          {dayFilter === 'custom' && (
            <Input
              aria-label="Data das vendas"
              className="h-11 w-full rounded-xl sm:w-56"
              onChange={(event) => setCustomDay(event.target.value)}
              type="date"
              value={customDay}
            />
          )}

          <div aria-label="Agrupar vendas" className="grid grid-cols-3 gap-2">
            {(
              [
                ['list', 'Lista'],
                ['model', 'Por modelo'],
                ['customer', 'Por cliente'],
              ] as const
            ).map(([value, label]) => (
              <Button
                aria-pressed={grouping === value}
                className="h-10 min-w-0 rounded-xl px-2 text-xs sm:text-sm"
                key={value}
                onClick={() => setGrouping(value)}
                type="button"
                variant={grouping === value ? 'default' : 'outline'}
              >
                {label}
              </Button>
            ))}
          </div>

          <div className="grid grid-cols-3 divide-x rounded-xl bg-muted px-2 py-2 text-center">
            <SalesMetric label="Vendas" value={String(completedSales.length)} />
            <SalesMetric label="Aparelhos" value={String(completedItems)} />
            <SalesMetric label="Total" value={formatMoney(completedTotal)} />
          </div>
        </CardHeader>
        <CardContent className="min-h-0 flex-1 overflow-hidden p-0">
          <div className="h-full min-h-0 overflow-y-auto overscroll-contain">
            {grouping === 'list' ? (
              <>
                <div className="hidden md:block">
                  <Table>
                    <TableHeader className="[&_th]:sticky [&_th]:top-0 [&_th]:z-10 [&_th]:bg-card">
                      <TableRow>
                        <TableHead className="pl-5">Venda</TableHead>
                        <TableHead>Cliente</TableHead>
                        <TableHead>Vendedor</TableHead>
                        <TableHead>Pagamento</TableHead>
                        <TableHead>Total</TableHead>
                        <TableHead>Status</TableHead>
                        <TableHead className="pr-5" />
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {filteredSales.map((sale) => (
                        <TableRow key={sale.number}>
                          <TableCell className="pl-5">
                            <p className="font-semibold">{sale.number}</p>
                            <p className="text-xs text-muted-foreground">
                              {formatSalesDay(sale.date)} · {sale.time}
                            </p>
                          </TableCell>
                          <TableCell>
                            <p className="font-medium">{sale.customer}</p>
                            <p className="text-xs text-muted-foreground">
                              {sale.items}{' '}
                              {sale.items === 1 ? 'aparelho' : 'aparelhos'}
                            </p>
                          </TableCell>
                          <TableCell>{sale.seller}</TableCell>
                          <TableCell>{sale.payment}</TableCell>
                          <TableCell className="font-semibold">
                            {formatMoney(sale.total)}
                          </TableCell>
                          <TableCell>
                            <SaleStatus status={sale.status} />
                          </TableCell>
                          <TableCell className="pr-5">
                            <Button
                              aria-label={`Abrir ${sale.number}`}
                              size="icon-sm"
                              variant="ghost"
                            >
                              <ArrowRight />
                            </Button>
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
                <div className="divide-y md:hidden">
                  {filteredSales.map((sale) => (
                    <button
                      className="w-full px-4 py-3 text-left"
                      key={sale.number}
                      type="button"
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <p className="truncate text-sm font-semibold">
                            {sale.customer}
                          </p>
                          <p className="mt-0.5 text-xs text-muted-foreground">
                            {sale.number} · {formatSalesDay(sale.date)},{' '}
                            {sale.time}
                          </p>
                        </div>
                        <SaleStatus status={sale.status} />
                      </div>
                      <div className="mt-2 flex items-end justify-between gap-3">
                        <p className="truncate text-xs text-muted-foreground">
                          {sale.items}{' '}
                          {sale.items === 1 ? 'aparelho' : 'aparelhos'} ·{' '}
                          {sale.payment}
                        </p>
                        <p className="shrink-0 text-sm font-bold">
                          {formatMoney(sale.total)}
                        </p>
                      </div>
                    </button>
                  ))}
                </div>
              </>
            ) : (
              <div className="divide-y">
                {groupedRows.map((row) => (
                  <div
                    className="flex items-center gap-4 px-4 py-4 sm:px-5"
                    key={row.label}
                  >
                    <span className="grid size-11 shrink-0 place-items-center rounded-xl bg-secondary text-primary">
                      {grouping === 'model' ? (
                        <Smartphone className="size-5" />
                      ) : (
                        <UserRound className="size-5" />
                      )}
                    </span>
                    <div className="min-w-0 flex-1">
                      <p className="truncate font-bold">{row.label}</p>
                      <p className="mt-0.5 text-xs text-muted-foreground">
                        {row.sales} {row.sales === 1 ? 'venda' : 'vendas'} ·{' '}
                        {row.items} {row.items === 1 ? 'aparelho' : 'aparelhos'}
                      </p>
                    </div>
                    <strong className="shrink-0 text-sm sm:text-base">
                      {formatMoney(row.total)}
                    </strong>
                  </div>
                ))}
              </div>
            )}

            {isEmpty && (
              <div className="grid min-h-40 place-items-center p-6 text-center text-sm text-muted-foreground">
                Nenhuma venda encontrada para esse filtro.
              </div>
            )}
          </div>
        </CardContent>
      </Card>
    </PageContainer>
  );
}

function SalesMetric({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0 px-1.5">
      <p className="truncate text-[0.65rem] font-semibold uppercase tracking-wide text-muted-foreground sm:text-xs">
        {label}
      </p>
      <p className="mt-0.5 whitespace-nowrap text-xs font-extrabold tabular-nums sm:text-base">
        {value}
      </p>
    </div>
  );
}

function groupSalesByModel(sales: SaleRow[]): SalesGroupRow[] {
  const grouped = new Map<string, SalesGroupRow>();
  for (const sale of sales) {
    if (sale.status !== 'Concluída') continue;
    for (const model of sale.models) {
      const current = grouped.get(model.name) ?? {
        label: model.name,
        sales: 0,
        items: 0,
        total: 0,
      };
      grouped.set(model.name, {
        ...current,
        sales: current.sales + 1,
        items: current.items + model.quantity,
        total: current.total + model.total,
      });
    }
  }
  return [...grouped.values()].sort((left, right) => right.total - left.total);
}

function groupSalesByCustomer(sales: SaleRow[]): SalesGroupRow[] {
  const grouped = new Map<string, SalesGroupRow>();
  for (const sale of sales) {
    if (sale.status !== 'Concluída') continue;
    const current = grouped.get(sale.customer) ?? {
      label: sale.customer,
      sales: 0,
      items: 0,
      total: 0,
    };
    grouped.set(sale.customer, {
      ...current,
      sales: current.sales + 1,
      items: current.items + sale.items,
      total: current.total + sale.total,
    });
  }
  return [...grouped.values()].sort((left, right) => right.total - left.total);
}

function formatSalesDay(date: string) {
  if (date === TODAY) return 'Hoje';
  if (date === YESTERDAY) return 'Ontem';
  const [year, month, day] = date.split('-');
  return year && month && day ? `${day}/${month}/${year}` : date;
}

function SettingsView() {
  return (
    <PageContainer>
      <PageHeading
        description="Cadastros usados nas entradas, vendas e relatórios."
        eyebrow="Administração"
        title="Configurações"
      />
      <Tabs
        className="flex min-h-0 flex-1 flex-col overflow-hidden"
        defaultValue="products"
      >
        <TabsList
          className="mb-3 h-11 w-full shrink-0 justify-start overflow-x-auto rounded-xl bg-muted p-1 sm:w-fit"
          variant="default"
        >
          <TabsTrigger className="h-9 px-3" value="products">
            Produtos
          </TabsTrigger>
          <TabsTrigger className="h-9 px-3" value="people">
            Pessoas
          </TabsTrigger>
          <TabsTrigger className="h-9 px-3" value="finance">
            Financeiro
          </TabsTrigger>
          <TabsTrigger className="h-9 px-3" value="system">
            Sistema
          </TabsTrigger>
        </TabsList>
        <SettingsTab value="products">
          <SettingsCard
            icon={Smartphone}
            title="Produtos e variações"
            detail="5 variações ativas"
            description="Modelo, cor, capacidade e apresentação no estoque."
          />
          <SettingsCard
            icon={ScanBarcode}
            title="Códigos comerciais"
            detail="6 códigos vinculados"
            description="Uma variação pode aceitar vários UPCs, EANs ou JANs."
          />
        </SettingsTab>
        <SettingsTab value="people">
          <SettingsCard
            icon={UsersRound}
            title="Clientes"
            detail="84 cadastrados"
            description="Cadastro rápido com nome obrigatório."
          />
          <SettingsCard
            icon={UserRound}
            title="Vendedores"
            detail="3 ativos"
            description="Responsável comercial selecionado na venda."
          />
          <SettingsCard
            icon={CircleUserRound}
            title="Usuários"
            detail="4 acessos"
            description="Cada operador usa sua própria conta."
          />
        </SettingsTab>
        <SettingsTab value="finance">
          <SettingsCard
            icon={Building2}
            title="Bancos Pix"
            detail="3 contas ativas"
            description="Conta de recebimento exigida para cada Pix."
          />
          <SettingsCard
            icon={WalletCards}
            title="Formas de pagamento"
            detail="Dinheiro e Pix"
            description="Uma venda aceita vários lançamentos."
          />
        </SettingsTab>
        <SettingsTab value="system">
          <SettingsCard
            icon={ArrowDownToLine}
            title="Backups"
            detail="A configurar"
            description="Banco e imagens terão cópias separadas."
          />
          <SettingsCard
            icon={RotateCcw}
            title="Auditoria"
            detail="Todas as operações"
            description="Operador, data e alterações preservados."
          />
        </SettingsTab>
      </Tabs>
    </PageContainer>
  );
}

function SettingsTab({
  value,
  children,
}: {
  value: string;
  children: ReactNode;
}) {
  return (
    <TabsContent
      className="min-h-0 flex-1 overflow-y-auto overscroll-contain"
      value={value}
    >
      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">{children}</div>
    </TabsContent>
  );
}

function MainNavigation({
  activeView,
  onChange,
}: {
  activeView: View;
  onChange: (view: View) => void;
}) {
  return (
    <nav aria-label="Navegação principal" className="mt-10 space-y-1">
      {navItems.map(({ view, label, icon: Icon }) => {
        const active = view === activeView;
        return (
          <button
            className={`flex min-h-12 w-full items-center gap-3 rounded-2xl px-4 text-left text-[0.95rem] font-semibold transition ${active ? 'bg-primary text-primary-foreground shadow-[0_10px_24px_rgb(10_35_66/16%)]' : 'text-muted-foreground hover:bg-muted hover:text-foreground'}`}
            key={view}
            onClick={() => onChange(view)}
            type="button"
          >
            <Icon className="size-[1.15rem]" strokeWidth={2.1} /> {label}
          </button>
        );
      })}
    </nav>
  );
}

function MobileNavigation({
  activeView,
  onChange,
}: {
  activeView: View;
  onChange: (view: View) => void;
}) {
  return (
    <nav
      aria-label="Navegação principal"
      className="fixed inset-x-0 bottom-0 z-40 border-t bg-background/95 px-2 pb-[max(0.55rem,env(safe-area-inset-bottom))] pt-1.5 backdrop-blur-xl lg:hidden"
    >
      <div className="mx-auto grid max-w-lg grid-cols-5">
        {navItems.map(({ view, label, shortLabel, icon: Icon }) => {
          const active = view === activeView;
          return (
            <button
              className={`flex min-h-[3.6rem] flex-col items-center justify-center gap-1 rounded-xl text-xs font-semibold ${active ? 'text-primary' : 'text-muted-foreground'}`}
              key={view}
              onClick={() => onChange(view)}
              type="button"
            >
              <Icon
                className={`size-5 ${active ? 'fill-primary/10' : ''}`}
                strokeWidth={active ? 2.4 : 1.9}
              />
              {shortLabel ?? label}
            </button>
          );
        })}
      </div>
    </nav>
  );
}

function AppHeader() {
  return (
    <header className="relative z-20 flex h-16 shrink-0 items-center justify-between border-b bg-background/92 px-4 backdrop-blur-xl sm:px-7 lg:h-[4.5rem] lg:px-10">
      <div className="lg:hidden">
        <Brand compact />
      </div>
      <p className="hidden text-sm font-medium capitalize text-muted-foreground lg:block">
        {formatLongCurrentDate()}
      </p>
      <Badge className="h-7 gap-1.5 bg-success/12 px-3 text-success ring-1 ring-success/15 hover:bg-success/12">
        <span className="size-1.5 rounded-full bg-success" />
        Online
      </Badge>
    </header>
  );
}

function OperatorCard() {
  return (
    <div className="mt-auto rounded-2xl border bg-card p-4">
      <p className="text-xs font-semibold uppercase tracking-[0.12em] text-muted-foreground">
        Operador
      </p>
      <div className="mt-3 flex items-center gap-3">
        <span className="grid size-10 place-items-center rounded-full bg-secondary text-primary">
          <CircleUserRound className="size-5" />
        </span>
        <div className="min-w-0">
          <p className="truncate font-semibold">Jeferson</p>
          <p className="text-xs text-muted-foreground">Administrador</p>
        </div>
      </div>
    </div>
  );
}

function Brand({ compact = false }: { compact?: boolean }) {
  return (
    <div className="flex items-center gap-3">
      <span
        className={`grid place-items-center rounded-xl bg-primary text-primary-foreground shadow-[0_8px_20px_rgb(10_35_66/20%)] ${compact ? 'size-9' : 'size-11'}`}
      >
        <Smartphone
          className={compact ? 'size-4' : 'size-5'}
          strokeWidth={2.25}
        />
      </span>
      <div>
        <p
          className={`${compact ? 'text-base' : 'text-lg'} font-extrabold tracking-[-0.04em]`}
        >
          PDV Estoque
        </p>
        {!compact && (
          <p className="text-xs font-medium text-muted-foreground">
            Controle por número de série
          </p>
        )}
      </div>
    </div>
  );
}

function PageContainer({ children }: { children: ReactNode }) {
  return (
    <div className="flex h-full min-h-0 flex-col overflow-hidden px-3 py-3 sm:px-6 sm:py-5 lg:px-10">
      {children}
    </div>
  );
}

function PageHeading({
  eyebrow,
  title,
  description,
  action,
}: {
  eyebrow: string;
  title: string;
  description: string;
  action?: ReactNode;
}) {
  return (
    <div className="mb-3 flex shrink-0 items-end justify-between gap-4">
      <div className="min-w-0">
        <p className="eyebrow">{eyebrow}</p>
        <h1 className="mt-0.5 text-2xl font-bold tracking-[-0.04em] sm:text-3xl">
          {title}
        </h1>
        <p className="mt-1 hidden truncate text-sm text-muted-foreground sm:block">
          {description}
        </p>
      </div>
      {action}
    </div>
  );
}

function MetricCard({
  icon: Icon,
  label,
  value,
  accent,
}: {
  icon: typeof Warehouse;
  label: string;
  value: string;
  accent: 'blue' | 'cyan' | 'green';
}) {
  const colors = {
    blue: 'bg-primary/10 text-primary',
    cyan: 'bg-sky/20 text-[#08749b]',
    green: 'bg-success/10 text-success',
  };
  return (
    <Card className="min-w-0" size="sm">
      <CardContent className="flex min-w-0 items-center gap-2 p-2.5 sm:gap-3 sm:p-4">
        <span
          className={`hidden size-10 shrink-0 place-items-center rounded-xl sm:grid ${colors[accent]}`}
        >
          <Icon className="size-5" />
        </span>
        <div className="min-w-0">
          <p className="truncate text-[0.65rem] font-semibold uppercase tracking-wide text-muted-foreground sm:text-xs">
            {label}
          </p>
          <p className="mt-0.5 truncate text-sm font-extrabold tracking-tight sm:text-lg">
            {value}
          </p>
        </div>
      </CardContent>
    </Card>
  );
}

function SettingsCard({
  icon: Icon,
  title,
  detail,
  description,
}: {
  icon: typeof Smartphone;
  title: string;
  detail: string;
  description: string;
}) {
  return (
    <Card className="surface-card">
      <CardHeader className="p-4">
        <span className="mb-2 grid size-10 place-items-center rounded-xl bg-secondary text-primary">
          <Icon className="size-5" />
        </span>
        <CardTitle className="text-base">{title}</CardTitle>
        <CardDescription>{description}</CardDescription>
      </CardHeader>
      <CardContent className="p-4 pt-0">
        <div className="flex items-center justify-between border-t pt-3">
          <span className="text-sm font-semibold text-muted-foreground">
            {detail}
          </span>
          <Button size="sm" variant="ghost">
            Gerenciar <ArrowRight />
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

function StockBadge({ count }: { count: number }) {
  const low = count <= 2;
  return (
    <Badge
      className={
        low
          ? 'bg-amber-500/10 text-amber-800 hover:bg-amber-500/10'
          : 'bg-success/10 text-success hover:bg-success/10'
      }
    >
      {count}{' '}
      <span className="hidden sm:inline">
        {count === 1 ? 'unidade' : 'unidades'}
      </span>
    </Badge>
  );
}

function SaleStatus({ status }: { status: SaleStatusValue }) {
  return status === 'Cancelada' ? (
    <Badge variant="destructive">Cancelada</Badge>
  ) : (
    <Badge className="bg-success/10 text-success hover:bg-success/10">
      Concluída
    </Badge>
  );
}

function parseStoredTestEntries(value: string) {
  try {
    const parsed: unknown = JSON.parse(value);
    if (
      !isObject(parsed) ||
      parsed.version !== 1 ||
      !Array.isArray(parsed.entries)
    ) {
      return [];
    }

    let entries: LocalTestEntryRecord[] = [];
    let serialCount = 0;
    for (const candidate of parsed.entries.slice(0, 100)) {
      const sanitized = sanitizeTestEntry(candidate);
      if (!sanitized || serialCount >= 500) continue;
      const limited = {
        ...sanitized,
        serials: sanitized.serials.slice(0, 500 - serialCount),
      };
      entries = mergeTestEntry(entries, limited);
      serialCount = entries.reduce(
        (sum, entry) => sum + entry.serials.length,
        0,
      );
    }
    return entries;
  } catch {
    return [];
  }
}

function mergeTestEntryCollections(
  current: LocalTestEntryRecord[],
  incoming: LocalTestEntryRecord[],
) {
  return incoming.reduce(
    (entries, entry) => mergeTestEntry(entries, entry),
    current,
  );
}

function mergeTestEntry(
  current: LocalTestEntryRecord[],
  candidate: LocalTestEntryRecord,
) {
  return mergeTestEntryWithResult(current, candidate).entries;
}

function mergeTestEntryWithResult(
  current: LocalTestEntryRecord[],
  candidate: LocalTestEntryRecord,
) {
  const entry = sanitizeTestEntry(candidate);
  if (!entry) {
    return {
      entries: current,
      added: 0,
      duplicates: 0,
      capacityReached: false,
    };
  }

  const knownSerials = new Set(current.flatMap((item) => item.serials));
  const remainingCapacity = Math.max(500 - knownSerials.size, 0);
  const freshSerials = entry.serials.filter(
    (serial) => !knownSerials.has(serial),
  );
  const existingIndex = current.findIndex(
    (item) => item.gtin14 === entry.gtin14,
  );
  const productLimitReached = existingIndex < 0 && current.length >= 100;
  const additions = productLimitReached
    ? []
    : freshSerials.slice(0, remainingCapacity);
  const result = {
    added: additions.length,
    duplicates: entry.serials.length - freshSerials.length,
    capacityReached:
      productLimitReached || freshSerials.length > remainingCapacity,
  };

  if (existingIndex >= 0) {
    if (additions.length === 0) return { entries: current, ...result };
    return {
      entries: current.map((item, index) =>
        index === existingIndex
          ? {
              ...item,
              serials: [...item.serials, ...additions].slice(0, 500),
            }
          : item,
      ),
      ...result,
    };
  }

  if (additions.length === 0) return { entries: current, ...result };
  return {
    entries: [...current, { ...entry, serials: additions }],
    ...result,
  };
}

function sanitizeTestEntry(value: unknown): LocalTestEntryRecord | null {
  if (!isObject(value)) return null;
  if (typeof value.gtin14 !== 'string') {
    return null;
  }
  const normalizedGtin = normalizeCandidate(
    value.gtin14,
    'stored_gtin',
    'product',
  );
  if (!normalizedGtin || normalizedGtin.normalizedValue !== value.gtin14) {
    return null;
  }
  if (!Array.isArray(value.serials)) return null;

  const serials = Array.from(
    new Set(
      value.serials
        .filter((serial): serial is string => typeof serial === 'string')
        .map((serial) => serial.toUpperCase().replace(/\s+/g, ''))
        .filter(
          (serial) => /^[A-Z0-9]{8,18}$/.test(serial) && /[A-Z]/.test(serial),
        ),
    ),
  ).slice(0, 500);
  if (serials.length === 0) return null;

  const rawDisplayCode =
    typeof value.displayCode === 'string' ? value.displayCode : '';
  const displayDigits = rawDisplayCode.replace(/\D/g, '');
  const normalizedDisplayCode = normalizeCandidate(
    displayDigits,
    'stored_display_code',
    'product',
  );
  const fallbackDisplayCode = value.gtin14.replace(/^0+(?=\d)/, '');
  const productName =
    typeof value.productName === 'string' && value.productName.trim()
      ? value.productName.trim().slice(0, 100)
      : 'Produto de teste';
  const productDetail =
    typeof value.productDetail === 'string' && value.productDetail.trim()
      ? value.productDetail.trim().slice(0, 100)
      : 'Entrada de teste local';

  return {
    gtin14: value.gtin14,
    displayCode:
      normalizedDisplayCode?.normalizedValue === value.gtin14
        ? displayDigits
        : fallbackDisplayCode,
    productName,
    productDetail,
    serials,
  };
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function getSaoPauloDateKey(offsetDays: number) {
  const instant = new Date(Date.now() + offsetDays * 86_400_000);
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/Sao_Paulo',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(instant);
  const getPart = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((part) => part.type === type)?.value ?? '';
  return `${getPart('year')}-${getPart('month')}-${getPart('day')}`;
}

function formatShortDate(date: string) {
  const [, month, day] = date.split('-');
  return month && day ? `${day}/${month}` : date;
}

function formatLongCurrentDate() {
  return new Intl.DateTimeFormat('pt-BR', {
    timeZone: 'America/Sao_Paulo',
    weekday: 'long',
    day: 'numeric',
    month: 'long',
  }).format(new Date());
}

function formatMoney(cents: number) {
  return new Intl.NumberFormat('pt-BR', {
    style: 'currency',
    currency: 'BRL',
  }).format(cents / 100);
}
