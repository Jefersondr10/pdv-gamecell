'use client';

import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import Image from 'next/image';
import {
  AlertTriangle,
  ArrowDownToLine,
  ArrowRight,
  Building2,
  Camera,
  CircleUserRound,
  FileText,
  History,
  Package,
  Paperclip,
  Printer,
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
  type CompletedSalePayload,
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
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
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
import { Textarea } from '@/components/ui/textarea';
import { normalizeCandidate } from '@/lib/scanner';

type View = 'sell' | 'entry' | 'stock' | 'sales' | 'settings';
type StorageMode = 'browser' | 'session';
type SaleStatusValue = 'Concluída' | 'Cancelada';
type SalesGrouping = 'list' | 'model' | 'customer';
type SalesDayFilter = 'today' | 'yesterday' | 'all' | 'custom';
type SalesReportLevel = 'simple' | 'detailed' | 'complete';
type StockReportLevel = 'summary' | 'serials';

type StockRow = {
  id: string;
  name: string;
  detail: string;
  defaultPriceCents: number;
  available: number;
  received: number;
  codes: string[];
  serials?: string[];
  testOnly?: boolean;
};

type ProductPriceOption = {
  id: string;
  name: string;
  detail: string;
  codes: string[];
  priceCents: number;
  testOnly?: boolean;
};

type SaleModel = {
  name: string;
  detail?: string;
  quantity: number;
  total: number;
};

type SaleAttachment = {
  name: string;
  mimeType: string;
  url?: string;
};

type SaleReportItem = {
  product: string;
  detail: string;
  serial: string;
  value: number;
  referenceValue: number;
  photos: SaleAttachment[];
};

type SaleReportPayment = {
  method: string;
  bank?: string;
  amount: number;
};

type SaleReportData = {
  items: SaleReportItem[];
  payments: SaleReportPayment[];
  receipts: SaleAttachment[];
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
  referenceTotal?: number;
  priceDifference?: number;
  report?: SaleReportData;
  testOnly?: boolean;
  cancellationReason?: string;
  cancelledAt?: string;
  cancelledBy?: string;
};

type SaleCancellation = {
  reason: string;
  at: string;
  operator: string;
};

type SalesGroupRow = {
  label: string;
  sales: number;
  items: number;
  total: number;
};

type StockReportRow = {
  scope: 'main' | 'test';
  model: string;
  color: string;
  memory: string;
  available: number;
  serials: string[];
};

const TEST_STOCK_KEY = 'pdv-apple:test-stock:v1';
const PRODUCT_PRICES_KEY = 'pdv-apple:product-prices:v1';
const GUIDE_STORAGE_KEY = 'pdv-apple:guide-version';
const GUIDE_VERSION = '2026.09.05-default-prices-v1';
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
    defaultPriceCents: 999900,
    available: 12,
    received: 18,
    codes: ['195950638011'],
  },
  {
    id: 'iphone-17-pro-max-silver-256',
    name: 'iPhone 17 Pro Max',
    detail: 'Silver · 256 GB',
    defaultPriceCents: 999900,
    available: 5,
    received: 8,
    codes: ['195950637151'],
  },
  {
    id: 'iphone-16-pink-128',
    name: 'iPhone 16',
    detail: 'Pink · 128 GB',
    defaultPriceCents: 789900,
    available: 3,
    received: 6,
    codes: ['195949822193'],
  },
  {
    id: 'iphone-15-black-128',
    name: 'iPhone 15',
    detail: 'Black · 128 GB',
    defaultPriceCents: 569900,
    available: 2,
    received: 9,
    codes: ['195949035913', '195949035937'],
  },
  {
    id: 'iphone-17-white-256',
    name: 'iPhone 17',
    detail: 'White · 256 GB',
    defaultPriceCents: 859900,
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
  const [sessionSales, setSessionSales] = useState<SaleRow[]>([]);
  const [saleCancellations, setSaleCancellations] = useState<
    Record<string, SaleCancellation>
  >({});
  const [testStorageReady, setTestStorageReady] = useState(false);
  const [testStorageMode, setTestStorageMode] =
    useState<StorageMode>('browser');
  const [productPrices, setProductPrices] = useState<Record<string, number>>(
    () =>
      Object.fromEntries(
        inventoryRows.map((row) => [row.id, row.defaultPriceCents]),
      ),
  );
  const [priceStorageReady, setPriceStorageReady] = useState(false);
  const [priceStorageMode, setPriceStorageMode] =
    useState<StorageMode>('browser');
  const [guideOpen, setGuideOpen] = useState(false);
  const [guideRequired, setGuideRequired] = useState(false);
  const testEntriesRef = useRef<LocalTestEntryRecord[]>([]);
  const testSaleSequenceRef = useRef(1);
  const attachmentUrlsRef = useRef<string[]>([]);
  const existingTestSerials = useMemo(
    () => testEntries.flatMap((entry) => entry.serials),
    [testEntries],
  );
  const productPriceOptions = useMemo<ProductPriceOption[]>(() => {
    const options: ProductPriceOption[] = inventoryRows.map((row) => ({
      id: row.id,
      name: row.name,
      detail: row.detail,
      codes: row.codes,
      priceCents: productPrices[row.id] ?? row.defaultPriceCents,
    }));
    for (const entry of testEntries) {
      if (findCatalogRowByGtin(entry.gtin14)) continue;
      const id = getTestVariationId(entry.gtin14);
      options.push({
        id,
        name: entry.productName,
        detail: entry.productDetail,
        codes: [entry.displayCode],
        priceCents: productPrices[id] ?? 0,
        testOnly: true,
      });
    }
    return options;
  }, [productPrices, testEntries]);
  const saleProductsBySerial = useMemo<SaleProductLookup>(() => {
    const lookup: SaleProductLookup = {};
    for (const entry of testEntries) {
      const catalogRow = findCatalogRowByGtin(entry.gtin14);
      const variationId = catalogRow?.id ?? getTestVariationId(entry.gtin14);
      for (const serial of entry.serials) {
        lookup[serial.trim().toUpperCase()] = {
          product: catalogRow?.name ?? entry.productName,
          detail: catalogRow?.detail ?? entry.productDetail,
          defaultPriceCents:
            productPrices[variationId] ?? catalogRow?.defaultPriceCents ?? 0,
        };
      }
    }
    return lookup;
  }, [productPrices, testEntries]);
  const allSales = useMemo(
    () =>
      [...sessionSales, ...salesRows].map((sale) => {
        const cancellation = saleCancellations[sale.number];
        return cancellation
          ? {
              ...sale,
              status: 'Cancelada' as const,
              cancellationReason: cancellation.reason,
              cancelledAt: cancellation.at,
              cancelledBy: cancellation.operator,
            }
          : sale;
      }),
    [saleCancellations, sessionSales],
  );
  const soldSerials = useMemo(
    () =>
      new Set(
        allSales
          .filter((sale) => sale.status === 'Concluída')
          .flatMap(
            (sale) => sale.report?.items.map((item) => item.serial) ?? [],
          ),
      ),
    [allSales],
  );

  const openSystemGuide = () => setGuideOpen(true);
  const changeGuideOpen = (open: boolean) => {
    if (!open && guideRequired) return;
    setGuideOpen(open);
  };
  const acknowledgeGuide = () => {
    try {
      window.localStorage.setItem(GUIDE_STORAGE_KEY, GUIDE_VERSION);
    } catch {
      // Sem armazenamento local, a confirmação vale apenas nesta sessão.
    }
    setGuideRequired(false);
    setGuideOpen(false);
  };

  const registerCompletedSale = (payload: CompletedSalePayload) => {
    const reportItems: SaleReportItem[] = payload.items.map((item) => ({
      product: item.product,
      detail: item.detail,
      serial: item.serial,
      value: item.priceCents,
      referenceValue: item.defaultPriceCents,
      photos: item.photos.map((file) =>
        createSaleAttachment(file, attachmentUrlsRef.current),
      ),
    }));
    const receipts = payload.receipts.map((file) =>
      createSaleAttachment(file, attachmentUrlsRef.current),
    );
    const payments: SaleReportPayment[] = payload.payments.map((payment) => ({
      method: payment.method,
      bank: payment.method === 'Pix' ? formatBankName(payment.bank) : undefined,
      amount: payment.amountCents,
    }));
    const referenceTotal = reportItems.reduce(
      (sum, item) => sum + item.referenceValue,
      0,
    );
    const priceDifference = reportItems.reduce(
      (sum, item) =>
        sum + (item.referenceValue > 0 ? item.value - item.referenceValue : 0),
      0,
    );
    const now = new Date();
    const sale: SaleRow = {
      number: `#TESTE-${String(testSaleSequenceRef.current).padStart(3, '0')}`,
      customer: payload.customer,
      seller: 'Jeferson',
      items: reportItems.length,
      total: payload.totalCents,
      payment: payments
        .map((payment) =>
          payment.bank ? `${payment.method} · ${payment.bank}` : payment.method,
        )
        .join(' + '),
      date: getSaoPauloDateKey(0),
      time: new Intl.DateTimeFormat('pt-BR', {
        hour: '2-digit',
        minute: '2-digit',
        hour12: false,
        timeZone: 'America/Sao_Paulo',
      }).format(now),
      status: 'Concluída',
      models: groupCompletedItemsByModel(reportItems),
      referenceTotal,
      priceDifference,
      report: { items: reportItems, payments, receipts },
      testOnly: true,
    };
    testSaleSequenceRef.current += 1;
    setSessionSales((current) => [sale, ...current]);
  };

  const cancelSale = (saleNumber: string, reason: string) => {
    setSaleCancellations((current) =>
      current[saleNumber]
        ? current
        : {
            ...current,
            [saleNumber]: {
              reason,
              at: formatSaoPauloDateTime(new Date()),
              operator: 'Jeferson',
            },
          },
    );
  };

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

  const saveProductPrice = (variationId: string, priceCents: number) => {
    if (
      !variationId ||
      !Number.isSafeInteger(priceCents) ||
      priceCents <= 0 ||
      priceCents > 1_000_000_000
    ) {
      return;
    }
    setProductPrices((current) => ({
      ...current,
      [variationId]: priceCents,
    }));
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
    let cancelled = false;
    queueMicrotask(() => {
      if (cancelled) return;
      try {
        const stored = window.localStorage.getItem(PRODUCT_PRICES_KEY);
        if (stored) {
          const loadedPrices = parseStoredProductPrices(stored);
          setProductPrices((current) => ({ ...current, ...loadedPrices }));
        }
      } catch {
        setPriceStorageMode('session');
      } finally {
        setPriceStorageReady(true);
      }
    });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    queueMicrotask(() => {
      if (cancelled) return;
      try {
        if (window.localStorage.getItem(GUIDE_STORAGE_KEY) === GUIDE_VERSION) {
          return;
        }
      } catch {
        // O guia continua obrigatório mesmo quando o navegador bloqueia storage.
      }
      setGuideRequired(true);
      setGuideOpen(true);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(
    () => () => {
      for (const url of attachmentUrlsRef.current) URL.revokeObjectURL(url);
    },
    [],
  );

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
    if (!priceStorageReady || priceStorageMode !== 'browser') return;
    let cancelled = false;
    try {
      window.localStorage.setItem(
        PRODUCT_PRICES_KEY,
        JSON.stringify({ version: 1, prices: productPrices }),
      );
    } catch {
      queueMicrotask(() => {
        if (!cancelled) setPriceStorageMode('session');
      });
    }
    return () => {
      cancelled = true;
    };
  }, [priceStorageMode, priceStorageReady, productPrices]);

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
    const syncProductPrices = (event: StorageEvent) => {
      if (event.key !== PRODUCT_PRICES_KEY || !event.newValue) return;
      const incoming = parseStoredProductPrices(event.newValue);
      setProductPrices((current) => ({ ...current, ...incoming }));
    };
    window.addEventListener('storage', syncProductPrices);
    return () => window.removeEventListener('storage', syncProductPrices);
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
        <OperatorCard onOpenGuide={openSystemGuide} />
      </aside>

      <section className="mx-auto flex h-dvh min-h-0 max-w-[1500px] flex-col overflow-hidden lg:ml-64">
        <AppHeader onOpenGuide={openSystemGuide} />
        <div className="app-demo-strip shrink-0 border-b border-amber-500/15 bg-amber-50 px-4 py-1 text-center text-xs font-semibold text-amber-900 sm:px-7 sm:py-1.5">
          <span className="sm:hidden">TESTE LOCAL · dados não reais</span>
          <span className="hidden sm:inline">
            Modo de teste · entradas ficam somente{' '}
            {testStorageMode === 'browser' ? 'neste navegador' : 'nesta sessão'}{' '}
            · não use dados reais
          </span>
        </div>
        <div className="min-h-0 flex-1 overflow-hidden pb-[calc(4.75rem+env(safe-area-inset-bottom))] lg:pb-0">
          {activeView === 'sell' && (
            <SellWizard
              key={`sell-${viewRun}`}
              onComplete={registerCompletedSale}
              productsBySerial={saleProductsBySerial}
              stagedSerial={stagedSerial}
              unavailableSerials={soldSerials}
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
              soldSerials={soldSerials}
              testEntries={testEntries}
            />
          )}
          {activeView === 'sales' && (
            <SalesView
              key={`sales-${viewRun}`}
              onCancelSale={cancelSale}
              sales={allSales}
            />
          )}
          {activeView === 'settings' && (
            <SettingsView
              key={`settings-${viewRun}`}
              onSaveProductPrice={saveProductPrice}
              priceStorageMode={priceStorageMode}
              products={productPriceOptions}
            />
          )}
        </div>
      </section>

      <MobileNavigation activeView={activeView} onChange={changeView} />
      <SystemGuideDialog
        onAcknowledge={acknowledgeGuide}
        onOpenChange={changeGuideOpen}
        open={guideOpen}
        required={guideRequired}
      />
    </main>
  );
}

function StockView({
  testEntries,
  storageReady,
  storageMode,
  soldSerials,
}: {
  testEntries: LocalTestEntryRecord[];
  storageReady: boolean;
  storageMode: StorageMode;
  soldSerials: ReadonlySet<string>;
}) {
  const [query, setQuery] = useState('');
  const [reportOpen, setReportOpen] = useState(false);
  const [reportLevel, setReportLevel] = useState<StockReportLevel>('summary');
  const testRows: StockRow[] = testEntries.map((entry) => {
    const catalogRow = inventoryRows.find((row) =>
      row.codes.some((code) => code.padStart(14, '0') === entry.gtin14),
    );
    const availableSerials = entry.serials.filter(
      (serial) => !soldSerials.has(serial),
    );
    return {
      id: `test:${entry.gtin14}`,
      name: catalogRow?.name ?? entry.productName,
      detail: catalogRow?.detail ?? entry.productDetail,
      defaultPriceCents: catalogRow?.defaultPriceCents ?? 0,
      available: availableSerials.length,
      received: entry.serials.length,
      codes: [entry.displayCode],
      serials: availableSerials,
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
          <Button
            className="h-10 rounded-xl px-3 sm:px-4"
            onClick={() => setReportOpen(true)}
            variant="outline"
          >
            <FileText />
            <span className="hidden sm:inline">Relatório de estoque</span>
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
      <StockReportDialog
        level={reportLevel}
        onLevelChange={setReportLevel}
        onOpenChange={setReportOpen}
        open={reportOpen}
        rows={rows}
      />
    </PageContainer>
  );
}

function StockReportDialog({
  rows,
  level,
  open,
  onOpenChange,
  onLevelChange,
}: {
  rows: StockRow[];
  level: StockReportLevel;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onLevelChange: (level: StockReportLevel) => void;
}) {
  const [includeTest, setIncludeTest] = useState(false);
  const hasTestRows = rows.some((row) => row.testOnly);
  const reportRows = useMemo(
    () => buildStockReportRows(rows, includeTest),
    [includeTest, rows],
  );

  return (
    <Dialog onOpenChange={onOpenChange} open={open}>
      <DialogContent className="flex h-dvh max-h-dvh max-w-none flex-col gap-0 rounded-none p-0 sm:h-[min(90dvh,54rem)] sm:max-w-4xl sm:rounded-2xl">
        <DialogHeader
          className="shrink-0 border-b px-4 py-3 pr-12 sm:px-5 sm:py-4"
          data-report-controls
        >
          <DialogTitle className="text-lg font-bold">
            Relatório de estoque
          </DialogTitle>
          <DialogDescription>
            Consulte as quantidades por variação ou a rastreabilidade por número
            de série.
          </DialogDescription>
        </DialogHeader>

        <div
          className="grid shrink-0 gap-2 border-b bg-muted/30 p-3 sm:grid-cols-[1fr_auto] sm:items-end sm:p-4"
          data-report-controls
        >
          <fieldset>
            <legend className="text-sm font-semibold">Tipo de relatório</legend>
            <div className="mt-1 grid grid-cols-2 gap-2">
              <Button
                aria-pressed={level === 'summary'}
                className="h-11 rounded-xl"
                onClick={() => onLevelChange('summary')}
                type="button"
                variant={level === 'summary' ? 'default' : 'outline'}
              >
                Por modelo, cor e memória
              </Button>
              <Button
                aria-pressed={level === 'serials'}
                className="h-11 rounded-xl"
                onClick={() => onLevelChange('serials')}
                type="button"
                variant={level === 'serials' ? 'default' : 'outline'}
              >
                Detalhado por SN
              </Button>
            </div>
          </fieldset>
          <Button
            aria-pressed={includeTest}
            className="h-11 rounded-xl"
            disabled={!hasTestRows}
            onClick={() => setIncludeTest((current) => !current)}
            type="button"
            variant={includeTest ? 'secondary' : 'outline'}
          >
            {includeTest ? 'Teste local incluído' : 'Incluir teste local'}
          </Button>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto bg-muted/25 p-3 overscroll-contain sm:p-5">
          <StockReportDocument
            includeTest={includeTest}
            level={level}
            rows={reportRows}
          />
        </div>

        <DialogFooter
          className="mx-0 mb-0 shrink-0 rounded-none border-t bg-background p-3 sm:p-4"
          data-report-controls
        >
          <Button onClick={() => onOpenChange(false)} variant="outline">
            Fechar
          </Button>
          <Button onClick={() => window.print()}>
            <Printer /> Imprimir / salvar PDF
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function StockReportDocument({
  rows,
  level,
  includeTest,
}: {
  rows: StockReportRow[];
  level: StockReportLevel;
  includeTest: boolean;
}) {
  const mainRows = rows.filter((row) => row.scope === 'main');
  const testRows = rows.filter((row) => row.scope === 'test');
  const mainAvailable = mainRows.reduce((sum, row) => sum + row.available, 0);
  const testAvailable = testRows.reduce((sum, row) => sum + row.available, 0);
  const modelCount = new Set(mainRows.map((row) => row.model)).size;

  return (
    <article
      className="report-document mx-auto max-w-3xl rounded-2xl bg-white p-4 text-slate-950 shadow-sm ring-1 ring-slate-200 sm:p-7"
      data-print-report
    >
      <header className="border-b border-slate-200 pb-4">
        <p className="text-xs font-bold uppercase tracking-[0.16em] text-slate-500">
          PDV Estoque
        </p>
        <h2 className="mt-1 text-xl font-extrabold tracking-tight">
          {level === 'summary'
            ? 'Estoque por modelo, cor e memória'
            : 'Estoque detalhado por SN'}
        </h2>
        <p className="mt-1 text-sm text-slate-600">
          Gerado em {formatSaoPauloDateTime(new Date())}
        </p>
      </header>

      <dl className="report-section mt-4 grid grid-cols-2 gap-2 sm:grid-cols-4">
        <ReportMetric label="Estoque principal" value={String(mainAvailable)} />
        <ReportMetric label="Modelos" value={String(modelCount)} />
        <ReportMetric label="Variações" value={String(mainRows.length)} />
        <ReportMetric
          label="Teste local"
          value={includeTest ? String(testAvailable) : 'Não incluído'}
        />
      </dl>

      {includeTest && testRows.length > 0 && (
        <p className="report-section mt-4 rounded-lg bg-amber-50 px-3 py-2 text-sm font-semibold text-amber-900">
          O TESTE LOCAL aparece em seção separada e não foi somado ao estoque
          principal.
        </p>
      )}

      <div className="report-section mt-5 space-y-5">
        <StockReportSection
          level={level}
          rows={mainRows}
          title="Estoque principal"
        />
        {includeTest && testRows.length > 0 && (
          <StockReportSection
            level={level}
            rows={testRows}
            title="TESTE LOCAL"
          />
        )}
      </div>
    </article>
  );
}

function StockReportSection({
  title,
  rows,
  level,
}: {
  title: string;
  rows: StockReportRow[];
  level: StockReportLevel;
}) {
  return (
    <section>
      <div className="flex items-center justify-between gap-3">
        <h3 className="font-extrabold">{title}</h3>
        <span className="text-xs font-semibold text-slate-500">
          {rows.length} {rows.length === 1 ? 'variação' : 'variações'}
        </span>
      </div>
      {rows.length === 0 ? (
        <p className="mt-2 rounded-lg bg-slate-50 px-3 py-3 text-sm text-slate-600">
          Nenhuma unidade disponível neste escopo.
        </p>
      ) : (
        <div className="mt-2 divide-y divide-slate-200 rounded-xl border border-slate-200">
          {rows.map((row) => {
            const missingSerials = Math.max(
              row.available - row.serials.length,
              0,
            );
            return (
              <div
                className="report-row p-3"
                key={`${row.scope}-${row.model}-${row.color}-${row.memory}`}
              >
                <div className="grid gap-2 sm:grid-cols-[1fr_1fr_1fr_auto] sm:items-center">
                  <div>
                    <p className="text-xs font-bold uppercase tracking-wide text-slate-500">
                      Modelo
                    </p>
                    <p className="font-bold">{row.model}</p>
                  </div>
                  <div>
                    <p className="text-xs font-bold uppercase tracking-wide text-slate-500">
                      Cor
                    </p>
                    <p className="font-semibold">{row.color}</p>
                  </div>
                  <div>
                    <p className="text-xs font-bold uppercase tracking-wide text-slate-500">
                      Memória
                    </p>
                    <p className="font-semibold">{row.memory}</p>
                  </div>
                  <div className="sm:text-right">
                    <p className="text-xs font-bold uppercase tracking-wide text-slate-500">
                      Disponível
                    </p>
                    <p className="text-lg font-extrabold">{row.available}</p>
                  </div>
                </div>

                {level === 'serials' && (
                  <div className="mt-3 rounded-lg bg-slate-50 px-3 py-2">
                    <p className="text-xs font-bold uppercase tracking-wide text-slate-500">
                      Números de série disponíveis
                    </p>
                    {row.serials.length > 0 && (
                      <div className="mt-2 grid gap-1.5 sm:grid-cols-2">
                        {row.serials.map((serial) => (
                          <p
                            className="break-all rounded-md bg-white px-2 py-1.5 font-mono text-sm font-semibold ring-1 ring-slate-200"
                            key={serial}
                          >
                            {serial}
                          </p>
                        ))}
                      </div>
                    )}
                    {missingSerials > 0 && (
                      <p className="mt-2 text-sm text-slate-600">
                        {missingSerials}{' '}
                        {missingSerials === 1 ? 'SN não está' : 'SNs não estão'}{' '}
                        disponível nos dados desta demonstração.
                      </p>
                    )}
                    {row.available === 0 && (
                      <p className="mt-2 text-sm text-slate-600">
                        Nenhum SN disponível nesta variação.
                      </p>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
}

function SalesView({
  sales,
  onCancelSale,
}: {
  sales: SaleRow[];
  onCancelSale: (saleNumber: string, reason: string) => void;
}) {
  const [dayFilter, setDayFilter] = useState<SalesDayFilter>('today');
  const [customDay, setCustomDay] = useState(TODAY);
  const [grouping, setGrouping] = useState<SalesGrouping>('list');
  const [query, setQuery] = useState('');
  const [reportOpen, setReportOpen] = useState(false);
  const [cancelSaleNumber, setCancelSaleNumber] = useState('');
  const [reportSaleNumber, setReportSaleNumber] = useState(
    sales.find((sale) => sale.status === 'Concluída')?.number ??
      sales[0]?.number ??
      '',
  );
  const [reportLevel, setReportLevel] = useState<SalesReportLevel>('simple');

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

    return sales.filter((sale) => {
      if (selectedDay && sale.date !== selectedDay) return false;
      if (!normalizedQuery) return true;
      return `${sale.number} ${sale.customer} ${sale.seller} ${sale.payment} ${sale.models.map((model) => model.name).join(' ')}`
        .toLocaleLowerCase('pt-BR')
        .includes(normalizedQuery);
    });
  }, [customDay, dayFilter, query, sales]);

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
  const reportSale =
    sales.find((sale) => sale.number === reportSaleNumber) ?? sales[0];
  const saleToCancel = sales.find((sale) => sale.number === cancelSaleNumber);
  const openReport = (sale: SaleRow) => {
    setReportSaleNumber(sale.number);
    setReportOpen(true);
  };

  return (
    <PageContainer>
      <PageHeading
        action={
          <Button
            aria-label="Gerar relatório por venda"
            className="h-10 rounded-xl px-3 sm:px-4"
            disabled={filteredSales.length === 0}
            onClick={() => {
              const firstSale =
                filteredSales.find((sale) => sale.status === 'Concluída') ??
                filteredSales[0];
              if (firstSale) openReport(firstSale);
            }}
            variant="outline"
          >
            <FileText />
            <span className="hidden sm:inline">Relatório por venda</span>
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
                          <TableCell>
                            <p className="font-semibold">
                              {formatMoney(sale.total)}
                            </p>
                            <SalePriceDifference
                              difference={sale.priceDifference}
                            />
                          </TableCell>
                          <TableCell>
                            <SaleStatus status={sale.status} />
                          </TableCell>
                          <TableCell className="pr-5">
                            <Button
                              aria-label={`Abrir ${sale.number}`}
                              onClick={() => openReport(sale)}
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
                      onClick={() => openReport(sale)}
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
                      <SalePriceDifference
                        className="mt-2"
                        difference={sale.priceDifference}
                      />
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

      <SaleReportDialog
        level={reportLevel}
        onLevelChange={setReportLevel}
        onOpenChange={setReportOpen}
        onRequestCancel={(saleNumber) => {
          setReportOpen(false);
          setCancelSaleNumber(saleNumber);
        }}
        onSaleChange={setReportSaleNumber}
        open={reportOpen}
        sale={reportSale}
        sales={sales}
      />
      <CancelSaleDialog
        onConfirm={(reason) => {
          if (!saleToCancel) return;
          onCancelSale(saleToCancel.number, reason);
          setCancelSaleNumber('');
        }}
        onOpenChange={(open) => {
          if (!open) setCancelSaleNumber('');
        }}
        open={Boolean(saleToCancel)}
        sale={saleToCancel}
      />
    </PageContainer>
  );
}

function CancelSaleDialog({
  sale,
  open,
  onOpenChange,
  onConfirm,
}: {
  sale: SaleRow | undefined;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onConfirm: (reason: string) => void;
}) {
  const [reason, setReason] = useState('');
  const normalizedReason = reason.trim();
  const valid = normalizedReason.length >= 5;
  const close = () => {
    setReason('');
    onOpenChange(false);
  };

  return (
    <Dialog
      onOpenChange={(nextOpen) => {
        if (!nextOpen) close();
      }}
      open={open}
    >
      <DialogContent className="flex max-h-[calc(100dvh-1.5rem)] max-w-[calc(100%-1.5rem)] flex-col gap-0 overflow-hidden p-0 sm:max-w-lg">
        <DialogHeader className="shrink-0 border-b px-4 py-4 pr-12 sm:px-5">
          <DialogTitle className="text-lg font-bold">
            Cancelar venda
          </DialogTitle>
          <DialogDescription>
            A venda continuará no histórico como cancelada e deixará de contar
            nos totais vendidos.
          </DialogDescription>
        </DialogHeader>

        <div className="min-h-0 overflow-y-auto p-4 overscroll-contain sm:p-5">
          {sale && (
            <div className="grid grid-cols-2 gap-2 rounded-xl bg-muted p-3 text-sm">
              <div className="col-span-2">
                <p className="text-xs font-semibold text-muted-foreground">
                  Venda e cliente
                </p>
                <p className="font-bold">
                  {sale.number} · {sale.customer}
                </p>
              </div>
              <div>
                <p className="text-xs font-semibold text-muted-foreground">
                  Aparelhos
                </p>
                <p className="font-bold">{sale.items}</p>
              </div>
              <div>
                <p className="text-xs font-semibold text-muted-foreground">
                  Valor original
                </p>
                <p className="font-bold">{formatMoney(sale.total)}</p>
              </div>
            </div>
          )}

          <label
            className="mt-4 block text-sm font-semibold"
            htmlFor="sale-cancellation-reason"
          >
            Motivo do cancelamento
          </label>
          <Textarea
            aria-describedby="sale-cancellation-help"
            aria-invalid={reason.length > 0 && !valid}
            className="mt-1 max-h-32 min-h-24 field-sizing-fixed"
            id="sale-cancellation-reason"
            maxLength={300}
            onChange={(event) => setReason(event.target.value)}
            placeholder="Explique o motivo em pelo menos 5 caracteres"
            rows={4}
            value={reason}
          />
          <div
            className="mt-1 flex items-start justify-between gap-3 text-xs text-muted-foreground"
            id="sale-cancellation-help"
          >
            <span>
              {reason.length > 0 && !valid
                ? 'Informe um motivo mais completo.'
                : 'O motivo ficará registrado para auditoria.'}
            </span>
            <span>{reason.length}/300</span>
          </div>

          <p className="mt-4 rounded-xl bg-amber-500/10 px-3 py-2 text-sm leading-6 text-amber-950">
            No teste local, SNs vinculados voltam a ficar disponíveis. O
            cancelamento no sistema não estorna Pix ou dinheiro automaticamente.
          </p>
        </div>

        <div className="grid shrink-0 grid-cols-2 gap-2 border-t p-3 sm:p-4">
          <Button className="h-12 rounded-xl" onClick={close} variant="outline">
            Voltar
          </Button>
          <Button
            className="h-12 rounded-xl"
            disabled={!sale || sale.status !== 'Concluída' || !valid}
            onClick={() => {
              if (!sale || sale.status !== 'Concluída' || !valid) return;
              onConfirm(normalizedReason);
              setReason('');
            }}
            variant="destructive"
          >
            <span className="sm:hidden">Cancelar venda</span>
            <span className="hidden sm:inline">Confirmar cancelamento</span>
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function SaleReportDialog({
  sale,
  sales,
  level,
  open,
  onOpenChange,
  onSaleChange,
  onLevelChange,
  onRequestCancel,
}: {
  sale: SaleRow | undefined;
  sales: SaleRow[];
  level: SalesReportLevel;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSaleChange: (saleNumber: string) => void;
  onLevelChange: (level: SalesReportLevel) => void;
  onRequestCancel: (saleNumber: string) => void;
}) {
  const levelOptions: Array<{
    value: SalesReportLevel;
    label: string;
    detail: string;
  }> = [
    {
      value: 'simple',
      label: 'Simplificado',
      detail: 'Cliente, produtos e valores',
    },
    {
      value: 'detailed',
      label: 'Detalhado',
      detail: 'Inclui SNs e pagamentos',
    },
    {
      value: 'complete',
      label: 'Completo',
      detail: 'Inclui fotos e comprovantes',
    },
  ];

  return (
    <Dialog onOpenChange={onOpenChange} open={open}>
      <DialogContent className="flex h-dvh max-h-dvh max-w-none flex-col gap-0 rounded-none p-0 sm:h-[min(90dvh,54rem)] sm:max-w-4xl sm:rounded-2xl">
        <DialogHeader
          className="shrink-0 border-b px-4 py-3 pr-12 sm:px-5 sm:py-4"
          data-report-controls
        >
          <DialogTitle className="text-lg font-bold">
            Relatório por venda
          </DialogTitle>
          <DialogDescription>
            Escolha a venda e o nível de informação antes de imprimir ou salvar
            em PDF.
          </DialogDescription>
        </DialogHeader>

        <div
          className="grid shrink-0 gap-2 border-b bg-muted/30 p-3 sm:grid-cols-[15rem_1fr] sm:p-4"
          data-report-controls
        >
          <div>
            <label className="text-sm font-semibold" htmlFor="report-sale">
              Venda
            </label>
            <NativeSelect
              className="mt-1 h-11 w-full [&_select]:h-11"
              id="report-sale"
              onChange={(event) => onSaleChange(event.target.value)}
              value={sale?.number ?? ''}
            >
              {sales.map((option) => (
                <NativeSelectOption key={option.number} value={option.number}>
                  {option.number} · {option.customer}
                </NativeSelectOption>
              ))}
            </NativeSelect>
          </div>

          <fieldset>
            <legend className="text-sm font-semibold">Tipo de relatório</legend>
            <div className="mt-1 grid grid-cols-3 gap-2">
              {levelOptions.map((option) => (
                <Button
                  aria-pressed={level === option.value}
                  className="h-auto min-w-0 flex-col items-start gap-0 rounded-xl px-2 py-2 text-left sm:px-3"
                  key={option.value}
                  onClick={() => onLevelChange(option.value)}
                  type="button"
                  variant={level === option.value ? 'default' : 'outline'}
                >
                  <span className="w-full truncate text-xs font-bold sm:text-sm">
                    {option.label}
                  </span>
                  <span className="hidden w-full truncate text-xs font-normal opacity-75 md:block">
                    {option.detail}
                  </span>
                </Button>
              ))}
            </div>
          </fieldset>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto bg-muted/25 p-3 overscroll-contain sm:p-5">
          {sale ? (
            <SaleReportDocument level={level} sale={sale} />
          ) : (
            <div className="grid h-full place-items-center text-sm text-muted-foreground">
              Nenhuma venda disponível para o relatório.
            </div>
          )}
        </div>

        <div
          className="grid shrink-0 grid-cols-2 gap-2 border-t bg-background p-3 sm:flex sm:justify-end sm:p-4"
          data-report-controls
        >
          {sale?.status === 'Concluída' && (
            <Button
              className="col-span-2 sm:mr-auto"
              onClick={() => onRequestCancel(sale.number)}
              variant="destructive"
            >
              Cancelar venda
            </Button>
          )}
          <Button onClick={() => onOpenChange(false)} variant="outline">
            Fechar
          </Button>
          <Button disabled={!sale} onClick={() => window.print()}>
            <Printer /> Imprimir / salvar PDF
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function SaleReportDocument({
  sale,
  level,
}: {
  sale: SaleRow;
  level: SalesReportLevel;
}) {
  const reportTitle =
    level === 'simple'
      ? 'Relatório simplificado'
      : level === 'detailed'
        ? 'Relatório detalhado'
        : 'Relatório completo';
  const soldAmount = sale.status === 'Concluída' ? sale.total : 0;
  const reportItems = sale.report?.items ?? [];
  const reportPayments = sale.report?.payments ?? [];
  const receipts = sale.report?.receipts ?? [];
  const photos = reportItems.flatMap((item) =>
    item.photos.map((photo) => ({
      ...photo,
      product: item.product,
      serial: item.serial,
    })),
  );

  return (
    <article
      className="report-document mx-auto max-w-3xl rounded-2xl bg-white p-4 text-slate-950 shadow-sm ring-1 ring-slate-200 sm:p-7"
      data-print-report
    >
      <header className="border-b border-slate-200 pb-4">
        <div className="flex items-start justify-between gap-4">
          <div>
            <p className="text-xs font-bold uppercase tracking-[0.16em] text-slate-500">
              PDV Estoque
            </p>
            <h2 className="mt-1 text-xl font-extrabold tracking-tight">
              {reportTitle}
            </h2>
            <p className="mt-1 text-sm text-slate-600">
              Venda {sale.number} · {formatSalesDay(sale.date)}, {sale.time}
            </p>
          </div>
          <span className="rounded-full border border-slate-300 px-3 py-1 text-xs font-bold">
            {sale.status}
          </span>
        </div>
        {sale.testOnly && (
          <p className="mt-3 rounded-lg bg-amber-50 px-3 py-2 text-xs font-bold text-amber-900">
            VENDA DE TESTE · dados mantidos somente nesta sessão
          </p>
        )}
      </header>

      <section className="report-section mt-4">
        <p className="text-xs font-bold uppercase tracking-wide text-slate-500">
          Cliente
        </p>
        <p className="mt-1 text-base font-bold">{sale.customer}</p>
      </section>

      <dl className="report-section mt-4 grid grid-cols-2 gap-2 sm:grid-cols-3">
        <ReportMetric
          label="Montante vendido"
          value={formatMoney(soldAmount)}
        />
        <ReportMetric label="Total de aparelhos" value={String(sale.items)} />
        <ReportMetric
          className="col-span-2 sm:col-span-1"
          label="Modelos diferentes"
          value={String(sale.models.length)}
        />
      </dl>

      {sale.priceDifference !== undefined && sale.priceDifference !== 0 && (
        <div className="report-section mt-4 flex items-start gap-2 rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-950">
          <AlertTriangle className="mt-0.5 size-4 shrink-0" />
          <p className="font-semibold">
            Venda realizada{' '}
            {formatPriceDifference(sale.priceDifference, 'long')} em relação aos
            preços cadastrados.
          </p>
        </div>
      )}

      {sale.status === 'Cancelada' && (
        <div className="report-section mt-4 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-900">
          <p className="font-semibold">
            Esta venda foi cancelada e, por isso, não entra no montante vendido.
            Valor original: {formatMoney(sale.total)}.
          </p>
          {sale.cancellationReason && (
            <p className="mt-1">
              Motivo: <strong>{sale.cancellationReason}</strong>
              {sale.cancelledBy ? ` · Operador: ${sale.cancelledBy}` : ''}
              {sale.cancelledAt ? ` · ${sale.cancelledAt}` : ''}
            </p>
          )}
        </div>
      )}

      <section className="report-section mt-5">
        <div className="flex items-center justify-between gap-3">
          <h3 className="font-extrabold">Produtos e valores</h3>
          <span className="text-xs font-semibold text-slate-500">
            Quantidade por modelo
          </span>
        </div>
        <div className="mt-2 divide-y divide-slate-200 rounded-xl border border-slate-200">
          {sale.models.map((model) => {
            const serials = reportItems
              .filter(
                (item) =>
                  item.product === model.name &&
                  (!model.detail || item.detail === model.detail),
              )
              .map((item) => item.serial);
            return (
              <div
                className="report-row p-3"
                key={`${model.name}-${model.detail ?? ''}`}
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="font-bold">{model.name}</p>
                    {model.detail && (
                      <p className="text-sm text-slate-600">{model.detail}</p>
                    )}
                    <p className="text-sm text-slate-600">
                      {model.quantity}{' '}
                      {model.quantity === 1 ? 'aparelho' : 'aparelhos'}
                    </p>
                  </div>
                  <strong className="shrink-0">
                    {formatMoney(model.total)}
                  </strong>
                </div>
                {level !== 'simple' && (
                  <div className="mt-2 rounded-lg bg-slate-50 px-3 py-2">
                    <p className="text-xs font-bold uppercase tracking-wide text-slate-500">
                      Números de série
                    </p>
                    {serials.length > 0 ? (
                      <p className="mt-1 break-words font-mono text-sm font-semibold">
                        {serials.join(' · ')}
                      </p>
                    ) : (
                      <p className="mt-1 text-sm text-slate-600">
                        SNs não registrados nesta venda demonstrativa.
                      </p>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </section>

      {level !== 'simple' && reportItems.length > 0 && (
        <section className="report-section mt-5">
          <h3 className="font-extrabold">Itens detalhados</h3>
          <div className="mt-2 divide-y divide-slate-200 rounded-xl border border-slate-200">
            {reportItems.map((item) => (
              <div
                className="report-row grid gap-2 p-3 sm:grid-cols-[1fr_auto] sm:items-center"
                key={item.serial}
              >
                <div className="min-w-0">
                  <p className="font-bold">{item.product}</p>
                  <p className="text-sm text-slate-600">{item.detail}</p>
                  <p className="mt-1 break-all font-mono text-sm font-semibold">
                    SN {item.serial}
                  </p>
                </div>
                <div className="text-right">
                  <strong>{formatMoney(item.value)}</strong>
                  {item.referenceValue > 0 &&
                    item.value !== item.referenceValue && (
                      <p className="mt-0.5 text-xs font-semibold text-amber-800">
                        {formatPriceDifference(
                          item.value - item.referenceValue,
                          'short',
                        )}
                      </p>
                    )}
                </div>
              </div>
            ))}
          </div>
        </section>
      )}

      {level !== 'simple' && (
        <section className="report-section mt-5">
          <h3 className="font-extrabold">Formas de pagamento</h3>
          {reportPayments.length > 0 ? (
            <div className="mt-2 divide-y divide-slate-200 rounded-xl border border-slate-200">
              {reportPayments.map((payment, index) => (
                <div
                  className="report-row flex items-center justify-between gap-3 p-3"
                  key={`${payment.method}-${index}`}
                >
                  <p className="font-semibold">
                    {payment.method}
                    {payment.bank ? ` · ${payment.bank}` : ''}
                  </p>
                  <strong>{formatMoney(payment.amount)}</strong>
                </div>
              ))}
            </div>
          ) : (
            <p className="mt-2 rounded-lg bg-slate-50 px-3 py-2 text-sm text-slate-600">
              {sale.payment} · valores separados não registrados nesta venda
              demonstrativa.
            </p>
          )}
        </section>
      )}

      {level === 'complete' && (
        <>
          <section className="report-section mt-5">
            <h3 className="font-extrabold">Dados da operação</h3>
            <dl className="mt-2 grid grid-cols-2 gap-2 text-sm">
              <ReportDetail label="Vendedor" value={sale.seller} />
              <ReportDetail label="Situação" value={sale.status} />
              <ReportDetail label="Data" value={formatSalesDay(sale.date)} />
              <ReportDetail label="Horário" value={sale.time} />
            </dl>
          </section>

          <section className="report-section mt-5">
            <h3 className="font-extrabold">Fotos dos aparelhos</h3>
            {photos.length > 0 ? (
              <div className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-3">
                {photos.map((photo, index) => (
                  <figure
                    className="report-row overflow-hidden rounded-xl border border-slate-200"
                    key={`${photo.name}-${index}`}
                  >
                    {photo.url && photo.mimeType.startsWith('image/') ? (
                      <div className="relative aspect-[4/3] w-full">
                        <Image
                          alt={`${photo.product}, SN ${photo.serial}`}
                          className="object-cover"
                          fill
                          sizes="(max-width: 640px) 50vw, 240px"
                          src={photo.url}
                          unoptimized
                        />
                      </div>
                    ) : (
                      <div className="grid aspect-[4/3] place-items-center bg-slate-100 text-slate-500">
                        <Camera />
                      </div>
                    )}
                    <figcaption className="p-2 text-xs">
                      <span className="block truncate font-bold">
                        {photo.product} · SN {photo.serial}
                      </span>
                      <span className="block truncate text-slate-500">
                        {photo.name}
                      </span>
                    </figcaption>
                  </figure>
                ))}
              </div>
            ) : (
              <p className="mt-2 rounded-lg bg-slate-50 px-3 py-2 text-sm text-slate-600">
                Nenhuma foto disponível nesta venda demonstrativa.
              </p>
            )}
          </section>

          <section className="report-section mt-5">
            <h3 className="font-extrabold">Comprovantes anexados</h3>
            {receipts.length > 0 ? (
              <div className="mt-2 grid gap-2 sm:grid-cols-2">
                {receipts.map((receipt, index) =>
                  receipt.url && receipt.mimeType.startsWith('image/') ? (
                    <figure
                      className="report-row overflow-hidden rounded-xl border border-slate-200"
                      key={`${receipt.name}-${index}`}
                    >
                      <div className="relative aspect-[16/10] w-full">
                        <Image
                          alt={`Comprovante ${receipt.name}`}
                          className="object-contain"
                          fill
                          sizes="(max-width: 640px) 100vw, 360px"
                          src={receipt.url}
                          unoptimized
                        />
                      </div>
                      <figcaption className="truncate p-2 text-xs font-semibold">
                        {receipt.name}
                      </figcaption>
                    </figure>
                  ) : (
                    <div
                      className="report-row rounded-xl border border-slate-200 p-3"
                      key={`${receipt.name}-${index}`}
                    >
                      {receipt.url ? (
                        <a
                          className="flex items-center gap-3 font-semibold underline-offset-4 hover:underline"
                          href={receipt.url}
                          rel="noreferrer"
                          target="_blank"
                        >
                          <Paperclip className="size-5 shrink-0" />
                          <span className="truncate">{receipt.name}</span>
                        </a>
                      ) : (
                        <p className="font-semibold">{receipt.name}</p>
                      )}
                      <p className="mt-1 text-xs text-slate-500">
                        Arquivo disponível somente durante esta sessão; o PDF do
                        relatório registra o nome do anexo.
                      </p>
                    </div>
                  ),
                )}
              </div>
            ) : (
              <p className="mt-2 rounded-lg bg-slate-50 px-3 py-2 text-sm text-slate-600">
                Nenhum comprovante anexado a esta venda.
              </p>
            )}
          </section>
        </>
      )}
    </article>
  );
}

function ReportMetric({
  label,
  value,
  className = '',
}: {
  label: string;
  value: string;
  className?: string;
}) {
  return (
    <div className={`rounded-xl bg-slate-100 p-3 ${className}`}>
      <dt className="text-xs font-bold uppercase tracking-wide text-slate-500">
        {label}
      </dt>
      <dd className="mt-1 text-lg font-extrabold tabular-nums">{value}</dd>
    </div>
  );
}

function ReportDetail({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg bg-slate-50 p-3">
      <dt className="text-xs font-bold uppercase tracking-wide text-slate-500">
        {label}
      </dt>
      <dd className="mt-1 font-semibold">{value}</dd>
    </div>
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
      const label = model.detail
        ? `${model.name} · ${model.detail}`
        : model.name;
      const current = grouped.get(label) ?? {
        label,
        sales: 0,
        items: 0,
        total: 0,
      };
      grouped.set(label, {
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

function buildStockReportRows(rows: StockRow[], includeTest: boolean) {
  const grouped = new Map<string, StockReportRow>();
  for (const row of rows) {
    if (row.testOnly && !includeTest) continue;
    const scope: StockReportRow['scope'] = row.testOnly ? 'test' : 'main';
    const [color, memory] = splitStockDetail(row.detail);
    const key = `${scope}\u0000${row.name}\u0000${color}\u0000${memory}`;
    const current = grouped.get(key) ?? {
      scope,
      model: row.name,
      color,
      memory,
      available: 0,
      serials: [],
    };
    grouped.set(key, {
      ...current,
      available: current.available + row.available,
      serials: Array.from(
        new Set([...current.serials, ...(row.serials ?? [])]),
      ),
    });
  }
  return [...grouped.values()].sort((left, right) => {
    if (left.scope !== right.scope) return left.scope === 'main' ? -1 : 1;
    return `${left.model} ${left.color} ${left.memory}`.localeCompare(
      `${right.model} ${right.color} ${right.memory}`,
      'pt-BR',
    );
  });
}

function splitStockDetail(detail: string): [string, string] {
  const parts = detail
    .split('·')
    .map((part) => part.trim())
    .filter(Boolean);
  if (parts.length < 2) return ['Não informada', 'Não informada'];
  const [color, ...memoryParts] = parts;
  return [color || 'Não informada', memoryParts.join(' · ') || 'Não informada'];
}

function formatSalesDay(date: string) {
  if (date === TODAY) return 'Hoje';
  if (date === YESTERDAY) return 'Ontem';
  const [year, month, day] = date.split('-');
  return year && month && day ? `${day}/${month}/${year}` : date;
}

function SystemGuideDialog({
  open,
  required,
  onOpenChange,
  onAcknowledge,
}: {
  open: boolean;
  required: boolean;
  onOpenChange: (open: boolean) => void;
  onAcknowledge: () => void;
}) {
  const steps = [
    {
      icon: Smartphone,
      title: '1. Cadastre o produto',
      description:
        'Crie cada variação com modelo, cor, capacidade e preço padrão. Depois, vincule a ela um ou mais códigos UPC, EAN ou JAN.',
    },
    {
      icon: Package,
      title: '2. Dê entrada no estoque',
      description:
        'Entre em Entrada, bipe o UPC/EAN, confirme a variação, bipe cada SN uma única vez, tire as fotos e revise.',
    },
    {
      icon: ShoppingBag,
      title: '3. Faça a venda',
      description:
        'Pesquise o cliente, bipe o SN e fotografe o aparelho. O preço padrão já vem preenchido, mas pode ser alterado; diferenças ficam sinalizadas sem bloquear a venda.',
    },
    {
      icon: WalletCards,
      title: '4. Registre o pagamento',
      description:
        'Adicione Pix ou dinheiro somente quando necessário. Um pagamento pode cobrir vários aparelhos, e o comprovante é opcional.',
    },
    {
      icon: FileText,
      title: '5. Consulte vendas e relatórios',
      description:
        'Filtre vendas por dia, agrupe por modelo ou cliente e gere relatórios de venda ou de estoque por variação e SN.',
    },
    {
      icon: RotateCcw,
      title: '6. Cancele sem apagar o histórico',
      description:
        'Abra o relatório da venda, escolha Cancelar venda e registre o motivo. O SN local volta a ficar disponível, mas o pagamento não é estornado automaticamente.',
    },
  ];

  return (
    <Dialog onOpenChange={onOpenChange} open={open}>
      <DialogContent
        className="flex h-dvh max-h-dvh max-w-none flex-col gap-0 rounded-none p-0 sm:h-[min(90dvh,50rem)] sm:max-w-3xl sm:rounded-2xl"
        showCloseButton={!required}
      >
        <DialogHeader className="shrink-0 border-b px-4 py-4 pr-12 sm:px-6">
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant="secondary">Central de ajuda</Badge>
            {required && (
              <Badge className="bg-primary text-primary-foreground">
                Leitura obrigatória
              </Badge>
            )}
          </div>
          <DialogTitle className="text-xl font-extrabold tracking-tight">
            Como usar o sistema
          </DialogTitle>
          <DialogDescription>
            {required
              ? 'Este é seu primeiro acesso ou o sistema recebeu uma atualização. Leia as orientações para continuar.'
              : 'Consulte novamente o fluxo recomendado e as novidades desta versão.'}
          </DialogDescription>
        </DialogHeader>

        <div className="min-h-0 flex-1 overflow-y-auto p-4 overscroll-contain sm:p-6">
          <div className="mb-4 rounded-2xl border border-sky/30 bg-sky/10 p-4">
            <p className="font-bold text-primary">Novidades desta versão</p>
            <p className="mt-1 text-sm leading-6 text-muted-foreground">
              Agora cada variação pode ter um preço padrão editável. Ele é
              preenchido ao bipar o SN, e vendas acima ou abaixo desse valor
              recebem um aviso sem serem bloqueadas.
            </p>
          </div>

          <ol className="grid gap-3 sm:grid-cols-2">
            {steps.map(({ icon: Icon, title, description }) => (
              <li className="rounded-2xl border bg-card p-4" key={title}>
                <span className="grid size-10 place-items-center rounded-xl bg-secondary text-primary">
                  <Icon className="size-5" />
                </span>
                <h3 className="mt-3 font-bold">{title}</h3>
                <p className="mt-1 text-sm leading-6 text-muted-foreground">
                  {description}
                </p>
              </li>
            ))}
          </ol>

          <div className="mt-4 rounded-2xl bg-amber-500/10 p-4 text-sm text-amber-950">
            <p className="font-bold">Importante sobre este ambiente</p>
            <p className="mt-1 leading-6">
              Os dados marcados como TESTE LOCAL não são estoque nem vendas
              reais. Fotos, comprovantes e vendas de teste permanecem somente
              nesta sessão até a conexão com o banco e o armazenamento
              definitivo.
            </p>
          </div>
        </div>

        <DialogFooter className="mx-0 mb-0 shrink-0 rounded-none border-t bg-background p-3 sm:p-4">
          <Button
            className="h-12 min-w-40 rounded-xl"
            onClick={required ? onAcknowledge : () => onOpenChange(false)}
          >
            {required ? 'Li e entendi' : 'Fechar'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function SettingsView({
  products,
  priceStorageMode,
  onSaveProductPrice,
}: {
  products: ProductPriceOption[];
  priceStorageMode: StorageMode;
  onSaveProductPrice: (variationId: string, priceCents: number) => void;
}) {
  const [pricesOpen, setPricesOpen] = useState(false);
  return (
    <>
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
              title="Produtos, variações e preços"
              detail={`${products.length} ${products.length === 1 ? 'variação' : 'variações'}`}
              description="Modelo, cor, capacidade e preço padrão usado na venda."
              onManage={() => setPricesOpen(true)}
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
      {pricesOpen && (
        <ProductPricesDialog
          onOpenChange={setPricesOpen}
          onSave={onSaveProductPrice}
          open={pricesOpen}
          products={products}
          storageMode={priceStorageMode}
        />
      )}
    </>
  );
}

function ProductPricesDialog({
  products,
  storageMode,
  open,
  onOpenChange,
  onSave,
}: {
  products: ProductPriceOption[];
  storageMode: StorageMode;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSave: (variationId: string, priceCents: number) => void;
}) {
  const [selectedId, setSelectedId] = useState(products[0]?.id ?? '');
  const selected =
    products.find((product) => product.id === selectedId) ?? products[0];
  const [price, setPrice] = useState(() =>
    selected?.priceCents ? formatMoneyInput(selected.priceCents) : '',
  );
  const priceCents = parseMoneyInput(price);
  const valid = Boolean(selected) && priceCents > 0;

  const selectProduct = (variationId: string) => {
    const product = products.find((option) => option.id === variationId);
    setSelectedId(variationId);
    setPrice(product?.priceCents ? formatMoneyInput(product.priceCents) : '');
  };

  return (
    <Dialog onOpenChange={onOpenChange} open={open}>
      <DialogContent className="flex h-dvh max-h-dvh max-w-none flex-col gap-0 rounded-none p-0 sm:h-auto sm:max-h-[calc(100dvh-2rem)] sm:max-w-xl sm:rounded-2xl">
        <DialogHeader className="shrink-0 border-b px-4 py-4 pr-12 sm:px-5">
          <DialogTitle className="text-lg font-bold">
            Preço padrão dos produtos
          </DialogTitle>
          <DialogDescription>
            Escolha uma variação. Este preço será preenchido automaticamente ao
            bipar o SN, mas continuará editável na venda.
          </DialogDescription>
        </DialogHeader>

        <div className="min-h-0 flex-1 overflow-y-auto p-4 overscroll-contain sm:p-5">
          {products.length > 0 ? (
            <>
              <label className="text-sm font-semibold" htmlFor="price-product">
                Produto e variação
              </label>
              <NativeSelect
                className="mt-1 h-12 w-full [&_select]:h-12 [&_select]:rounded-xl"
                id="price-product"
                onChange={(event) => selectProduct(event.target.value)}
                value={selected?.id ?? ''}
              >
                {products.map((product) => (
                  <NativeSelectOption key={product.id} value={product.id}>
                    {product.name} · {product.detail}
                  </NativeSelectOption>
                ))}
              </NativeSelect>

              {selected && (
                <div className="mt-3 rounded-2xl border bg-muted/35 p-4">
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div>
                      <p className="font-bold">{selected.name}</p>
                      <p className="text-sm text-muted-foreground">
                        {selected.detail}
                      </p>
                    </div>
                    {selected.testOnly && (
                      <Badge variant="secondary">TESTE LOCAL</Badge>
                    )}
                  </div>
                  <p className="mt-3 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                    UPC / EAN / JAN
                  </p>
                  <p className="mt-1 break-words font-mono text-sm font-semibold">
                    {selected.codes.join(' · ')}
                  </p>
                </div>
              )}

              <label
                className="mt-4 block text-sm font-semibold"
                htmlFor="default-product-price"
              >
                Preço padrão
              </label>
              <div className="relative mt-1">
                <span className="absolute left-4 top-1/2 -translate-y-1/2 font-bold text-muted-foreground">
                  R$
                </span>
                <Input
                  aria-invalid={price.length > 0 && !valid}
                  className="h-14 rounded-xl pl-12 text-right text-xl font-extrabold"
                  id="default-product-price"
                  inputMode="decimal"
                  onChange={(event) => setPrice(event.target.value)}
                  placeholder="0,00"
                  value={price}
                />
              </div>
              <p className="mt-2 text-xs leading-5 text-muted-foreground">
                Você poderá vender acima ou abaixo deste valor. O sistema apenas
                exibirá um aviso, sem impedir a conclusão.
              </p>
              <p className="mt-3 rounded-xl bg-amber-500/10 px-3 py-2 text-xs font-semibold text-amber-950">
                Neste ambiente, o preço fica salvo{' '}
                {storageMode === 'browser'
                  ? 'somente neste navegador.'
                  : 'somente durante esta sessão.'}
              </p>
            </>
          ) : (
            <p className="text-sm text-muted-foreground">
              Nenhuma variação disponível para configurar.
            </p>
          )}
        </div>

        <DialogFooter className="mx-0 mb-0 grid shrink-0 grid-cols-2 gap-2 rounded-none border-t bg-background p-3 sm:p-4">
          <Button
            className="h-12 rounded-xl"
            onClick={() => onOpenChange(false)}
            variant="outline"
          >
            Voltar
          </Button>
          <Button
            className="h-12 rounded-xl"
            disabled={!valid}
            onClick={() => {
              if (!selected || !valid) return;
              onSave(selected.id, priceCents);
              onOpenChange(false);
            }}
          >
            Salvar preço
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
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

function AppHeader({ onOpenGuide }: { onOpenGuide: () => void }) {
  return (
    <header className="relative z-20 flex h-16 shrink-0 items-center justify-between border-b bg-background/92 px-4 backdrop-blur-xl sm:px-7 lg:h-[4.5rem] lg:px-10">
      <div className="lg:hidden">
        <Brand compact />
      </div>
      <p className="hidden text-sm font-medium capitalize text-muted-foreground lg:block">
        {formatLongCurrentDate()}
      </p>
      <div className="flex items-center gap-1.5 sm:gap-2">
        <Button
          aria-label="Abrir perfil, ajuda e novidades"
          className="h-9 rounded-full px-2 sm:px-3 lg:hidden"
          onClick={onOpenGuide}
          variant="ghost"
        >
          <CircleUserRound />
          <span className="hidden min-[390px]:inline">Jeferson</span>
        </Button>
        <Badge className="h-7 gap-1.5 bg-success/12 px-2.5 text-success ring-1 ring-success/15 hover:bg-success/12 sm:px-3">
          <span className="size-1.5 rounded-full bg-success" />
          Online
        </Badge>
      </div>
    </header>
  );
}

function OperatorCard({ onOpenGuide }: { onOpenGuide: () => void }) {
  return (
    <button
      aria-label="Abrir perfil, ajuda e novidades"
      className="mt-auto w-full rounded-2xl border bg-card p-4 text-left transition hover:border-primary/25 hover:bg-muted/35 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      onClick={onOpenGuide}
      type="button"
    >
      <p className="text-xs font-semibold uppercase tracking-[0.12em] text-muted-foreground">
        Operador
      </p>
      <div className="mt-3 flex items-center gap-3">
        <span className="grid size-10 place-items-center rounded-full bg-secondary text-primary">
          <CircleUserRound className="size-5" />
        </span>
        <div className="min-w-0">
          <p className="truncate font-semibold">Jeferson</p>
          <p className="text-xs text-muted-foreground">
            Administrador · Ajuda e novidades
          </p>
        </div>
      </div>
    </button>
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
  onManage,
}: {
  icon: typeof Smartphone;
  title: string;
  detail: string;
  description: string;
  onManage?: () => void;
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
          <Button onClick={onManage} size="sm" type="button" variant="ghost">
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

function SalePriceDifference({
  difference,
  className = '',
}: {
  difference: number | undefined;
  className?: string;
}) {
  if (difference === undefined || difference === 0) return null;
  return (
    <span
      className={`inline-flex max-w-full items-center gap-1 rounded-md bg-amber-500/12 px-1.5 py-1 text-[0.68rem] font-bold leading-tight text-amber-900 ${className}`}
    >
      <AlertTriangle className="size-3 shrink-0" />
      <span className="truncate">
        {formatPriceDifference(difference, 'short')}
      </span>
    </span>
  );
}

function createSaleAttachment(file: File, urlBucket: string[]): SaleAttachment {
  let url: string | undefined;
  try {
    url = URL.createObjectURL(file);
    urlBucket.push(url);
  } catch {
    // O nome e o tipo continuam disponíveis se a prévia local falhar.
  }
  return {
    name: file.name || 'arquivo anexado',
    mimeType: file.type || 'application/octet-stream',
    url,
  };
}

function formatBankName(bank: string) {
  const names: Record<string, string> = {
    nubank: 'Nubank',
    itau: 'Itaú',
    inter: 'Inter',
  };
  return names[bank] ?? bank;
}

function groupCompletedItemsByModel(items: SaleReportItem[]): SaleModel[] {
  const grouped = new Map<string, SaleModel>();
  for (const item of items) {
    const key = `${item.product}\u0000${item.detail}`;
    const current = grouped.get(key) ?? {
      name: item.product,
      detail: item.detail,
      quantity: 0,
      total: 0,
    };
    grouped.set(key, {
      ...current,
      quantity: current.quantity + 1,
      total: current.total + item.value,
    });
  }
  return [...grouped.values()];
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

function parseStoredProductPrices(value: string) {
  try {
    const parsed: unknown = JSON.parse(value);
    if (!isObject(parsed) || parsed.version !== 1 || !isObject(parsed.prices)) {
      return {};
    }
    const prices: Record<string, number> = {};
    for (const [variationId, cents] of Object.entries(parsed.prices).slice(
      0,
      200,
    )) {
      if (
        variationId.length === 0 ||
        variationId.length > 160 ||
        !/^[a-zA-Z0-9:._-]+$/.test(variationId) ||
        !Number.isSafeInteger(cents) ||
        (cents as number) <= 0 ||
        (cents as number) > 1_000_000_000
      ) {
        continue;
      }
      prices[variationId] = cents as number;
    }
    return prices;
  } catch {
    return {};
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

function formatSaoPauloDateTime(date: Date) {
  return new Intl.DateTimeFormat('pt-BR', {
    timeZone: 'America/Sao_Paulo',
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(date);
}

function formatMoney(cents: number) {
  return new Intl.NumberFormat('pt-BR', {
    style: 'currency',
    currency: 'BRL',
  }).format(cents / 100);
}

function parseMoneyInput(value: string) {
  const normalized = value
    .replace(/\./g, '')
    .replace(',', '.')
    .replace(/[^\d.]/g, '');
  return Math.round((Number.parseFloat(normalized) || 0) * 100);
}

function formatMoneyInput(cents: number) {
  return new Intl.NumberFormat('pt-BR', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(cents / 100);
}

function formatPriceDifference(difference: number, length: 'short' | 'long') {
  const direction = difference < 0 ? 'abaixo' : 'acima';
  const reference = length === 'long' ? ' do preço cadastrado' : '';
  return `${formatMoney(Math.abs(difference))} ${direction}${reference}`;
}

function findCatalogRowByGtin(gtin14: string) {
  return inventoryRows.find((row) =>
    row.codes.some((code) => code.padStart(14, '0') === gtin14),
  );
}

function getTestVariationId(gtin14: string) {
  return `test:${gtin14}`;
}
