'use client';

import { useEffect, useMemo, useState } from 'react';
import {
  ArrowDownToLine,
  ArrowRight,
  Banknote,
  Building2,
  Camera,
  Check,
  ChevronDown,
  CircleUserRound,
  Clock3,
  Download,
  FileText,
  History,
  Package,
  Plus,
  RotateCcw,
  ScanBarcode,
  Search,
  Settings,
  ShoppingBag,
  Smartphone,
  Trash2,
  TrendingUp,
  UserRound,
  UsersRound,
  WalletCards,
  Warehouse,
  X,
} from 'lucide-react';

import { BarcodeScanner } from '@/components/pdv/barcode-scanner';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { NativeSelect, NativeSelectOption } from '@/components/ui/native-select';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import type { ScanCandidate } from '@/lib/scanner';

type View = 'sell' | 'entry' | 'stock' | 'sales' | 'settings';

const navItems: Array<{ view: View; label: string; shortLabel?: string; icon: typeof ShoppingBag }> = [
  { view: 'sell', label: 'Vender', icon: ShoppingBag },
  { view: 'entry', label: 'Entrada', icon: Package },
  { view: 'stock', label: 'Estoque', icon: Warehouse },
  { view: 'sales', label: 'Vendas', icon: History },
  { view: 'settings', label: 'Configurações', shortLabel: 'Ajustes', icon: Settings },
];

const inventoryRows = [
  {
    name: 'iPhone 17 Pro Max',
    detail: 'Deep Blue · 256 GB',
    available: 12,
    received: 18,
    codes: ['195950638011'],
  },
  {
    name: 'iPhone 17 Pro Max',
    detail: 'Silver · 256 GB',
    available: 5,
    received: 8,
    codes: ['195950637151'],
  },
  {
    name: 'iPhone 16',
    detail: 'Pink · 128 GB',
    available: 3,
    received: 6,
    codes: ['195949822193'],
  },
  {
    name: 'iPhone 15',
    detail: 'Black · 128 GB',
    available: 2,
    received: 9,
    codes: ['195949035913', '195949035937'],
  },
  {
    name: 'iPhone 17',
    detail: 'White · 256 GB',
    available: 1,
    received: 4,
    codes: ['4549995649161'],
  },
];

const salesRows = [
  { number: '#00128', customer: 'Rafael Martins', seller: 'Jeferson', items: 2, total: 1789800, payment: 'Pix + dinheiro', time: 'Hoje, 18:42', status: 'Concluída' },
  { number: '#00127', customer: 'Camila Souza', seller: 'Marcos', items: 1, total: 999900, payment: 'Pix · Nubank', time: 'Hoje, 16:18', status: 'Concluída' },
  { number: '#00126', customer: 'Bruno Lima', seller: 'Jeferson', items: 1, total: 569900, payment: 'Dinheiro', time: 'Hoje, 14:05', status: 'Cancelada' },
  { number: '#00125', customer: 'Fernanda Alves', seller: 'Ana', items: 3, total: 2439700, payment: '2 Pix', time: 'Ontem, 19:34', status: 'Concluída' },
];

export function PdvApp() {
  const [activeView, setActiveView] = useState<View>('sell');
  const [stagedSerial, setStagedSerial] = useState('HC9P06R095');

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
              annotations: { readOnlyHint: boolean; untrustedContentHint: boolean };
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
          'Abre a venda e prepara um número de série para conferência. Não finaliza a venda nem movimenta o estoque.',
        inputSchema: {
          type: 'object',
          properties: {
            serial: {
              type: 'string',
              description: 'Número de série com 8 a 18 letras ou números.',
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
          const serial = input.serial.trim().toUpperCase();
          if (!/^[A-Z0-9]{8,18}$/.test(serial)) {
            throw new Error('O número de série deve ter de 8 a 18 letras ou números.');
          }
          setStagedSerial(serial);
          setActiveView('sell');
          await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
          return { status: 'staged', serial, finalized: false };
        },
      },
      { signal: lifecycle.signal },
    );
    void Promise.resolve(registration).catch(() => undefined);
    return () => lifecycle.abort();
  }, []);

  return (
    <main className="min-h-dvh bg-background text-foreground">
      <aside className="fixed inset-y-0 left-0 z-30 hidden w-64 border-r bg-sidebar px-5 py-6 lg:flex lg:flex-col">
        <Brand />
        <MainNavigation activeView={activeView} onChange={setActiveView} />
        <OperatorCard />
      </aside>

      <section className="mx-auto min-h-dvh max-w-[1500px] pb-28 lg:ml-64 lg:pb-8">
        <AppHeader />
        <div className="border-b border-amber-500/15 bg-amber-50 px-4 py-2.5 text-center text-xs font-semibold text-amber-900 sm:px-7 lg:px-10">
          Primeira versão em desenvolvimento · os dados exibidos nesta tela são demonstrativos
        </div>
        {activeView === 'sell' && (
          <SellView lastSerial={stagedSerial} onSerialChange={setStagedSerial} />
        )}
        {activeView === 'entry' && <EntryView />}
        {activeView === 'stock' && <StockView />}
        {activeView === 'sales' && <SalesView />}
        {activeView === 'settings' && <SettingsView />}
      </section>

      <MobileNavigation activeView={activeView} onChange={setActiveView} />
    </main>
  );
}

function SellView({
  lastSerial,
  onSerialChange,
}: {
  lastSerial: string;
  onSerialChange: (serial: string) => void;
}) {
  const [customer, setCustomer] = useState('Rafael Martins');
  const [customerDialog, setCustomerDialog] = useState(false);
  const [newCustomerName, setNewCustomerName] = useState('');
  const [paymentDialog, setPaymentDialog] = useState(false);
  const [photoCount, setPhotoCount] = useState(1);

  const handleScan = (candidate: ScanCandidate) => {
    onSerialChange(candidate.normalizedValue);
  };

  return (
    <PageContainer>
      <PageHeading
        eyebrow="PDV"
        title="Nova venda"
        description="Leia o número de série para localizar o aparelho no estoque."
        action={
          <Button className="hidden h-11 rounded-xl px-4 sm:flex" onClick={() => setCustomerDialog(true)} variant="outline">
            <Plus /> Cadastrar cliente
          </Button>
        }
      />

      <div className="grid items-start gap-5 xl:grid-cols-[minmax(0,1.2fr)_minmax(340px,0.8fr)]">
        <div className="space-y-5">
          <Card className="surface-card">
            <CardHeader className="border-b">
              <div>
                <CardTitle className="text-lg">Cliente</CardTitle>
                <CardDescription>Selecione ou cadastre usando apenas o nome.</CardDescription>
              </div>
              <Button className="rounded-xl" onClick={() => setCustomerDialog(true)} size="icon" variant="secondary" aria-label="Selecionar cliente">
                <ChevronDown />
              </Button>
            </CardHeader>
            <CardContent>
              <button
                className="flex min-h-14 w-full items-center gap-3 rounded-2xl border bg-muted/45 px-4 text-left transition hover:bg-muted"
                onClick={() => setCustomerDialog(true)}
                type="button"
              >
                <span className="grid size-9 place-items-center rounded-full bg-card text-primary shadow-sm">
                  <CircleUserRound className="size-5" />
                </span>
                <span className="flex-1 font-semibold">{customer}</span>
                <ChevronDown className="size-4 text-muted-foreground" />
              </button>
            </CardContent>
          </Card>

          <BarcodeScanner mode="apple_serial" onAccepted={handleScan} />
        </div>

        <Card className="surface-card xl:sticky xl:top-28">
          <CardHeader className="border-b">
            <div>
              <p className="eyebrow">Venda em andamento</p>
              <CardTitle className="mt-1 text-lg">Aparelhos</CardTitle>
            </div>
            <Badge variant="secondary">1 item</Badge>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="rounded-2xl border bg-background p-4">
              <div className="flex items-start gap-3">
                <span className="grid size-12 shrink-0 place-items-center rounded-xl bg-[#eaf3ff] text-primary">
                  <Smartphone className="size-6" />
                </span>
                <div className="min-w-0 flex-1">
                  <p className="font-bold">iPhone 17 Pro Max</p>
                  <p className="mt-0.5 text-sm text-muted-foreground">Deep Blue · 256 GB</p>
                  <div className="mt-3 flex flex-wrap items-center gap-2">
                    <Badge className="font-mono" variant="outline">{maskSerial(lastSerial)}</Badge>
                    <Badge className="bg-success/10 text-success hover:bg-success/10">Disponível</Badge>
                  </div>
                </div>
              </div>

              <div className="mt-4 grid grid-cols-[1fr_auto] items-center gap-3 border-t pt-4">
                <div>
                  <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Preço unitário</p>
                  <p className="mt-1 text-lg font-bold tracking-tight">R$ 9.999,00</p>
                </div>
                <label className="grid size-11 cursor-pointer place-items-center rounded-xl border bg-card text-muted-foreground transition hover:text-primary" title="Adicionar foto">
                  <Camera className="size-5" />
                  <input
                    accept="image/*"
                    capture="environment"
                    className="sr-only"
                    onChange={(event) => setPhotoCount(Math.max(1, event.target.files?.length ?? 0))}
                    type="file"
                  />
                </label>
              </div>
              <div className="mt-3 flex items-center gap-2 rounded-xl bg-success/8 px-3 py-2 text-xs font-semibold text-success">
                <Check className="size-4" /> {photoCount} foto vinculada ao aparelho
              </div>
            </div>

            <Button className="h-12 w-full rounded-2xl border-dashed" variant="outline">
              <Plus /> Adicionar outro aparelho
            </Button>

            <div className="rounded-2xl bg-muted/55 p-4">
              <div className="flex items-center justify-between text-sm text-muted-foreground">
                <span>Subtotal</span>
                <span>R$ 9.999,00</span>
              </div>
              <div className="mt-3 flex items-end justify-between border-t pt-4">
                <span className="font-semibold">Total</span>
                <span className="text-2xl font-extrabold tracking-[-0.04em]">R$ 9.999,00</span>
              </div>
            </div>

            <Button className="h-14 w-full rounded-2xl text-base font-bold" onClick={() => setPaymentDialog(true)}>
              <Banknote className="size-5" /> Ir para pagamentos <ArrowRight className="ml-auto size-5" />
            </Button>
            <p className="text-center text-xs leading-5 text-muted-foreground">
              O estoque só será atualizado após a confirmação da venda.
            </p>
          </CardContent>
        </Card>
      </div>

      <Dialog onOpenChange={setCustomerDialog} open={customerDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Selecionar cliente</DialogTitle>
            <DialogDescription>Para um novo cliente, somente o nome é obrigatório.</DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            {['Rafael Martins', 'Camila Souza', 'Bruno Lima'].map((name) => (
              <Button
                className="h-11 w-full justify-start rounded-xl"
                key={name}
                onClick={() => {
                  setCustomer(name);
                  setCustomerDialog(false);
                }}
                variant={name === customer ? 'secondary' : 'ghost'}
              >
                <UserRound /> {name}
                {name === customer && <Check className="ml-auto" />}
              </Button>
            ))}
            <div className="border-t pt-3">
              <label className="text-sm font-semibold" htmlFor="new-customer">Novo cliente</label>
              <div className="mt-2 flex gap-2">
                <Input
                  className="h-11"
                  id="new-customer"
                  onChange={(event) => setNewCustomerName(event.target.value)}
                  placeholder="Nome do cliente"
                  value={newCustomerName}
                />
                <Button
                  className="h-11"
                  disabled={!newCustomerName.trim()}
                  onClick={() => {
                    setCustomer(newCustomerName.trim());
                    setNewCustomerName('');
                    setCustomerDialog(false);
                  }}
                >
                  Adicionar
                </Button>
              </div>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      <PaymentDialog open={paymentDialog} onOpenChange={setPaymentDialog} />
    </PageContainer>
  );
}

function EntryView() {
  const [serials, setSerials] = useState([
    { raw: 'SHC9P06R095', normalized: 'HC9P06R095' },
    { raw: 'SFC3Y91KL20', normalized: 'FC3Y91KL20' },
    { raw: 'SD0M18Q7P33', normalized: 'D0M18Q7P33' },
  ]);
  const [photoCount, setPhotoCount] = useState(2);
  const [notice, setNotice] = useState('Rascunho salvo automaticamente');

  const addSerial = (candidate: ScanCandidate) => {
    if (serials.some((item) => item.normalized === candidate.normalizedValue)) {
      setNotice('SN repetido: este aparelho já está na entrada');
      return;
    }
    setSerials((current) => [
      ...current,
      { raw: candidate.rawValue, normalized: candidate.normalizedValue },
    ]);
    setNotice(`SN ${candidate.normalizedValue} adicionado`);
  };

  return (
    <PageContainer>
      <PageHeading
        eyebrow="Recebimento"
        title="Nova entrada"
        description="Registre cada aparelho pelo SN e fotografe o recebimento uma única vez."
        action={<Badge className="hidden h-7 bg-amber-500/10 px-3 text-amber-800 hover:bg-amber-500/10 sm:inline-flex"><Clock3 /> Em rascunho</Badge>}
      />

      <div className="mb-5 grid gap-3 sm:grid-cols-3">
        <ProgressStep number="1" title="Produto" detail="Identificado" complete />
        <ProgressStep number="2" title="Seriais" detail={`${serials.length} aparelhos`} active />
        <ProgressStep number="3" title="Fotos e revisão" detail={`${photoCount} fotos`} />
      </div>

      <Card className="surface-card mb-5">
        <CardContent className="flex flex-col gap-4 sm:flex-row sm:items-center">
          <span className="grid size-14 shrink-0 place-items-center rounded-2xl bg-[#eaf3ff] text-primary">
            <Smartphone className="size-7" />
          </span>
          <div className="min-w-0 flex-1">
            <p className="eyebrow">Produto selecionado</p>
            <p className="mt-1 text-lg font-bold">iPhone 17 Pro Max</p>
            <p className="text-sm text-muted-foreground">Deep Blue · 256 GB · UPC 195950638011</p>
          </div>
          <Button className="rounded-xl" variant="outline">Trocar produto</Button>
        </CardContent>
      </Card>

      <div className="grid items-start gap-5 xl:grid-cols-[minmax(0,1.15fr)_minmax(340px,0.85fr)]">
        <BarcodeScanner
          description="Leia uma caixa por vez. IMEI, EID e etiquetas extras serão ignorados."
          mode="apple_serial"
          onAccepted={addSerial}
          title="Bipagem contínua"
        />

        <Card className="surface-card xl:sticky xl:top-28">
          <CardHeader className="border-b">
            <div>
              <p className="eyebrow">Entrada atual</p>
              <CardTitle className="mt-1 text-lg">Seriais registrados</CardTitle>
            </div>
            <span className="grid size-10 place-items-center rounded-xl bg-primary text-lg font-extrabold text-primary-foreground">
              {serials.length}
            </span>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="max-h-64 space-y-2 overflow-y-auto pr-1">
              {serials.map((serial, index) => (
                <div className="flex items-center gap-3 rounded-xl border bg-background px-3 py-2.5" key={serial.normalized}>
                  <span className="grid size-7 shrink-0 place-items-center rounded-lg bg-success/10 text-xs font-bold text-success">{index + 1}</span>
                  <div className="min-w-0 flex-1">
                    <p className="truncate font-mono text-sm font-semibold">{serial.normalized}</p>
                    {serial.raw !== serial.normalized && <p className="text-[0.7rem] text-muted-foreground">Lido: {serial.raw}</p>}
                  </div>
                  <Button
                    aria-label={`Remover ${serial.normalized}`}
                    className="text-muted-foreground hover:text-destructive"
                    onClick={() => setSerials((current) => current.filter((item) => item.normalized !== serial.normalized))}
                    size="icon-sm"
                    variant="ghost"
                  >
                    <X />
                  </Button>
                </div>
              ))}
            </div>

            <label className="flex min-h-20 cursor-pointer items-center gap-3 rounded-2xl border border-dashed bg-muted/35 px-4 transition hover:bg-muted/60">
              <span className="grid size-10 place-items-center rounded-xl bg-card text-primary shadow-sm"><Camera className="size-5" /></span>
              <span className="flex-1">
                <span className="block font-semibold">Fotos do recebimento</span>
                <span className="block text-xs text-muted-foreground">{photoCount} selecionadas · adicione quantas precisar</span>
              </span>
              <Plus className="size-4 text-muted-foreground" />
              <input
                accept="image/*"
                className="sr-only"
                multiple
                onChange={(event) => setPhotoCount(event.target.files?.length ?? 0)}
                type="file"
              />
            </label>

            <div className="rounded-xl bg-muted/55 px-3 py-2.5 text-sm text-muted-foreground">
              {notice}
            </div>

            <div className="grid grid-cols-2 gap-2">
              <Button className="h-12 rounded-xl" variant="outline">Salvar rascunho</Button>
              <Button className="h-12 rounded-xl" disabled={serials.length === 0}>Revisar entrada</Button>
            </div>
            <p className="text-center text-xs leading-5 text-muted-foreground">O estoque ainda não foi alterado.</p>
          </CardContent>
        </Card>
      </div>
    </PageContainer>
  );
}

function StockView() {
  const [query, setQuery] = useState('');
  const filtered = inventoryRows.filter((row) => `${row.name} ${row.detail} ${row.codes.join(' ')}`.toLowerCase().includes(query.toLowerCase()));
  const available = inventoryRows.reduce((sum, row) => sum + row.available, 0);

  return (
    <PageContainer>
      <PageHeading
        eyebrow="Inventário"
        title="Estoque"
        description="Quantidade por variação e rastreabilidade individual por número de série."
        action={<Button className="hidden h-11 rounded-xl sm:flex" variant="outline"><Download /> Exportar</Button>}
      />

      <div className="mb-5 grid gap-3 sm:grid-cols-3">
        <MetricCard icon={Warehouse} label="Disponíveis" value={String(available)} accent="blue" />
        <MetricCard icon={Smartphone} label="Variações" value={String(inventoryRows.length)} accent="cyan" />
        <MetricCard icon={TrendingUp} label="Vendidos hoje" value="7" accent="green" />
      </div>

      <Card className="surface-card">
        <CardHeader className="border-b">
          <div>
            <CardTitle className="text-lg">Produtos disponíveis</CardTitle>
            <CardDescription>Abra uma variação para consultar todos os SNs.</CardDescription>
          </div>
          <div className="relative w-full sm:w-72">
            <Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input className="h-11 rounded-xl pl-9" onChange={(event) => setQuery(event.target.value)} placeholder="Produto, cor ou código" value={query} />
          </div>
        </CardHeader>
        <CardContent className="px-0">
          <div className="hidden md:block">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="pl-5">Produto</TableHead>
                  <TableHead>Códigos vinculados</TableHead>
                  <TableHead>Recebidos</TableHead>
                  <TableHead>Disponíveis</TableHead>
                  <TableHead className="pr-5 text-right">Ação</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filtered.map((row) => (
                  <TableRow key={`${row.name}-${row.detail}`}>
                    <TableCell className="pl-5">
                      <p className="font-semibold">{row.name}</p>
                      <p className="text-xs text-muted-foreground">{row.detail}</p>
                    </TableCell>
                    <TableCell>
                      <p className="max-w-52 truncate font-mono text-xs text-muted-foreground">{row.codes.join(' · ')}</p>
                    </TableCell>
                    <TableCell>{row.received}</TableCell>
                    <TableCell><StockBadge count={row.available} /></TableCell>
                    <TableCell className="pr-5 text-right"><Button size="sm" variant="ghost">Ver SNs <ArrowRight /></Button></TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
          <div className="divide-y md:hidden">
            {filtered.map((row) => (
              <button className="flex w-full items-center gap-3 px-4 py-4 text-left" key={`${row.name}-${row.detail}`} type="button">
                <span className="grid size-11 shrink-0 place-items-center rounded-xl bg-secondary text-primary"><Smartphone className="size-5" /></span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-semibold">{row.name}</span>
                  <span className="block truncate text-xs text-muted-foreground">{row.detail}</span>
                </span>
                <StockBadge count={row.available} />
                <ArrowRight className="size-4 text-muted-foreground" />
              </button>
            ))}
          </div>
        </CardContent>
      </Card>
    </PageContainer>
  );
}

function SalesView() {
  const totalToday = salesRows.filter((sale) => sale.status === 'Concluída' && sale.time.startsWith('Hoje')).reduce((sum, sale) => sum + sale.total, 0);

  return (
    <PageContainer>
      <PageHeading
        eyebrow="Movimentações"
        title="Vendas"
        description="Consulte itens, pagamentos, responsáveis, cancelamentos e devoluções."
        action={<Button className="hidden h-11 rounded-xl sm:flex" variant="outline"><FileText /> Relatório</Button>}
      />

      <div className="mb-5 grid gap-3 sm:grid-cols-3">
        <MetricCard icon={Banknote} label="Vendas hoje" value={formatMoney(totalToday)} accent="blue" />
        <MetricCard icon={ShoppingBag} label="Aparelhos vendidos" value="3" accent="cyan" />
        <MetricCard icon={WalletCards} label="Recebido em Pix" value="R$ 21.898,00" accent="green" />
      </div>

      <Card className="surface-card">
        <CardHeader className="border-b">
          <div>
            <CardTitle className="text-lg">Últimas vendas</CardTitle>
            <CardDescription>Os registros originais permanecem preservados.</CardDescription>
          </div>
          <div className="flex w-full gap-2 sm:w-auto">
            <div className="relative flex-1 sm:w-60">
              <Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
              <Input className="h-11 rounded-xl pl-9" placeholder="Cliente, SN ou número" />
            </div>
            <Button className="h-11 rounded-xl" variant="outline">Filtros</Button>
          </div>
        </CardHeader>
        <CardContent className="px-0">
          <div className="hidden md:block">
            <Table>
              <TableHeader>
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
                {salesRows.map((sale) => (
                  <TableRow key={sale.number}>
                    <TableCell className="pl-5"><p className="font-semibold">{sale.number}</p><p className="text-xs text-muted-foreground">{sale.time}</p></TableCell>
                    <TableCell><p className="font-medium">{sale.customer}</p><p className="text-xs text-muted-foreground">{sale.items} {sale.items === 1 ? 'aparelho' : 'aparelhos'}</p></TableCell>
                    <TableCell>{sale.seller}</TableCell>
                    <TableCell>{sale.payment}</TableCell>
                    <TableCell className="font-semibold">{formatMoney(sale.total)}</TableCell>
                    <TableCell><SaleStatus status={sale.status} /></TableCell>
                    <TableCell className="pr-5"><Button size="icon-sm" variant="ghost" aria-label={`Abrir ${sale.number}`}><ArrowRight /></Button></TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
          <div className="divide-y md:hidden">
            {salesRows.map((sale) => (
              <button className="w-full px-4 py-4 text-left" key={sale.number} type="button">
                <div className="flex items-start justify-between gap-3">
                  <div><p className="font-semibold">{sale.customer}</p><p className="mt-0.5 text-xs text-muted-foreground">{sale.number} · {sale.time}</p></div>
                  <SaleStatus status={sale.status} />
                </div>
                <div className="mt-3 flex items-end justify-between"><p className="text-xs text-muted-foreground">{sale.items} {sale.items === 1 ? 'aparelho' : 'aparelhos'} · {sale.payment}</p><p className="font-bold">{formatMoney(sale.total)}</p></div>
              </button>
            ))}
          </div>
        </CardContent>
      </Card>
    </PageContainer>
  );
}

function SettingsView() {
  return (
    <PageContainer>
      <PageHeading eyebrow="Administração" title="Configurações" description="Cadastros usados nas entradas, vendas e relatórios." />

      <Tabs defaultValue="products">
        <TabsList className="mb-5 h-11 w-full justify-start overflow-x-auto rounded-xl bg-muted p-1 sm:w-fit" variant="default">
          <TabsTrigger className="h-9 px-3" value="products">Produtos</TabsTrigger>
          <TabsTrigger className="h-9 px-3" value="people">Pessoas</TabsTrigger>
          <TabsTrigger className="h-9 px-3" value="finance">Financeiro</TabsTrigger>
          <TabsTrigger className="h-9 px-3" value="system">Sistema</TabsTrigger>
        </TabsList>

        <TabsContent value="products">
          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
            <SettingsCard icon={Smartphone} title="Produtos e variações" detail="5 variações ativas" description="Modelo, cor, capacidade e apresentação no estoque." />
            <SettingsCard icon={ScanBarcode} title="Códigos comerciais" detail="6 códigos vinculados" description="Uma variação pode aceitar vários UPCs ou JANs." />
          </div>
        </TabsContent>
        <TabsContent value="people">
          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
            <SettingsCard icon={UsersRound} title="Clientes" detail="84 cadastrados" description="Cadastro rápido com nome obrigatório." />
            <SettingsCard icon={UserRound} title="Vendedores" detail="3 ativos" description="Responsável comercial selecionado na venda." />
            <SettingsCard icon={CircleUserRound} title="Usuários" detail="4 acessos" description="Cada operador entra com sua própria conta." />
          </div>
        </TabsContent>
        <TabsContent value="finance">
          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
            <SettingsCard icon={Building2} title="Bancos Pix" detail="3 contas ativas" description="Conta de recebimento exigida para cada Pix." />
            <SettingsCard icon={WalletCards} title="Formas de pagamento" detail="Dinheiro e Pix" description="Pagamentos podem ser divididos em vários lançamentos." />
          </div>
        </TabsContent>
        <TabsContent value="system">
          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
            <SettingsCard icon={ArrowDownToLine} title="Backups" detail="A configurar" description="Banco e imagens terão cópias separadas e testadas." />
            <SettingsCard icon={RotateCcw} title="Auditoria" detail="Todas as operações" description="Operador, vendedor, data e alterações preservados." />
          </div>
        </TabsContent>
      </Tabs>
    </PageContainer>
  );
}

function PaymentDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const [pixAmount, setPixAmount] = useState('8.000,00');
  const [cashAmount, setCashAmount] = useState('1.999,00');
  const total = 999900;
  const entered = useMemo(() => parseMoney(pixAmount) + parseMoney(cashAmount), [pixAmount, cashAmount]);
  const remaining = total - entered;

  return (
    <Dialog onOpenChange={onOpenChange} open={open}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="text-lg">Pagamentos da venda</DialogTitle>
          <DialogDescription>Combine dinheiro e quantos Pix forem necessários.</DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div className="grid grid-cols-[120px_1fr] gap-2 rounded-xl border p-3">
            <NativeSelect className="w-full">
              <NativeSelectOption value="pix">Pix</NativeSelectOption>
            </NativeSelect>
            <div className="grid gap-2 sm:grid-cols-2">
              <NativeSelect className="w-full" aria-label="Banco de recebimento">
                <NativeSelectOption value="nubank">Nubank</NativeSelectOption>
                <NativeSelectOption value="itau">Itaú</NativeSelectOption>
                <NativeSelectOption value="inter">Inter</NativeSelectOption>
              </NativeSelect>
              <Input aria-label="Valor Pix" className="text-right font-semibold" onChange={(event) => setPixAmount(event.target.value)} value={pixAmount} />
            </div>
          </div>
          <div className="grid grid-cols-[120px_1fr] gap-2 rounded-xl border p-3">
            <NativeSelect className="w-full">
              <NativeSelectOption value="cash">Dinheiro</NativeSelectOption>
            </NativeSelect>
            <div className="flex items-center gap-2">
              <Input aria-label="Valor em dinheiro" className="text-right font-semibold" onChange={(event) => setCashAmount(event.target.value)} value={cashAmount} />
              <Button aria-label="Remover pagamento" size="icon" variant="ghost"><Trash2 /></Button>
            </div>
          </div>
          <Button className="h-11 w-full rounded-xl border-dashed" variant="outline"><Plus /> Adicionar pagamento</Button>
          <div className="rounded-2xl bg-muted p-4">
            <div className="flex justify-between text-sm text-muted-foreground"><span>Total da venda</span><span>{formatMoney(total)}</span></div>
            <div className="mt-2 flex justify-between text-sm text-muted-foreground"><span>Pagamentos</span><span>{formatMoney(entered)}</span></div>
            <div className="mt-3 flex justify-between border-t pt-3 font-bold"><span>Restante</span><span className={remaining === 0 ? 'text-success' : 'text-destructive'}>{formatMoney(Math.abs(remaining))}</span></div>
          </div>
        </div>
        <DialogFooter>
          <Button className="h-11 rounded-xl" onClick={() => onOpenChange(false)} variant="outline">Voltar</Button>
          <Button className="h-11 rounded-xl" disabled={remaining !== 0}><Check /> Revisar e finalizar</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function MainNavigation({ activeView, onChange }: { activeView: View; onChange: (view: View) => void }) {
  return (
    <nav className="mt-10 space-y-1" aria-label="Navegação principal">
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

function MobileNavigation({ activeView, onChange }: { activeView: View; onChange: (view: View) => void }) {
  return (
    <nav className="fixed inset-x-0 bottom-0 z-40 border-t bg-background/95 px-2 pb-[max(0.65rem,env(safe-area-inset-bottom))] pt-2 backdrop-blur-xl lg:hidden" aria-label="Navegação principal">
      <div className="mx-auto grid max-w-lg grid-cols-5">
        {navItems.map(({ view, label, shortLabel, icon: Icon }) => {
          const active = view === activeView;
          return (
            <button className={`flex min-h-[3.6rem] flex-col items-center justify-center gap-1 rounded-xl text-[0.68rem] font-semibold ${active ? 'text-primary' : 'text-muted-foreground'}`} key={view} onClick={() => onChange(view)} type="button">
              <Icon className={`size-5 ${active ? 'fill-primary/10' : ''}`} strokeWidth={active ? 2.4 : 1.9} />
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
    <header className="sticky top-0 z-20 flex h-[4.5rem] items-center justify-between border-b bg-background/92 px-4 backdrop-blur-xl sm:px-7 lg:px-10">
      <div className="lg:hidden"><Brand compact /></div>
      <p className="hidden text-sm font-medium text-muted-foreground lg:block">Quinta-feira, 4 de setembro</p>
      <Badge className="h-7 gap-1.5 bg-success/12 px-3 text-success ring-1 ring-success/15 hover:bg-success/12"><span className="size-1.5 rounded-full bg-success" />Sistema online</Badge>
    </header>
  );
}

function OperatorCard() {
  return (
    <div className="mt-auto rounded-2xl border bg-card p-4">
      <p className="text-xs font-semibold uppercase tracking-[0.12em] text-muted-foreground">Operador</p>
      <div className="mt-3 flex items-center gap-3">
        <span className="grid size-10 place-items-center rounded-full bg-secondary text-primary"><CircleUserRound className="size-5" /></span>
        <div className="min-w-0"><p className="truncate font-semibold">Jeferson</p><p className="text-xs text-muted-foreground">Administrador</p></div>
      </div>
    </div>
  );
}

function Brand({ compact = false }: { compact?: boolean }) {
  return (
    <div className="flex items-center gap-3">
      <span className={`grid place-items-center rounded-xl bg-primary text-primary-foreground shadow-[0_8px_20px_rgb(10_35_66/20%)] ${compact ? 'size-9' : 'size-11'}`}><Smartphone className={compact ? 'size-4' : 'size-5'} strokeWidth={2.25} /></span>
      <div><p className={`${compact ? 'text-base' : 'text-lg'} font-extrabold tracking-[-0.04em]`}>PDV Estoque</p>{!compact && <p className="text-xs font-medium text-muted-foreground">Controle por número de série</p>}</div>
    </div>
  );
}

function PageContainer({ children }: { children: React.ReactNode }) {
  return <div className="px-4 py-6 sm:px-7 lg:px-10 lg:py-9">{children}</div>;
}

function PageHeading({ eyebrow, title, description, action }: { eyebrow: string; title: string; description: string; action?: React.ReactNode }) {
  return (
    <div className="mb-7 flex items-end justify-between gap-4">
      <div><p className="eyebrow">{eyebrow}</p><h1 className="mt-1 text-[clamp(1.7rem,4vw,2.4rem)] font-bold tracking-[-0.04em]">{title}</h1><p className="mt-2 max-w-2xl text-sm leading-6 text-muted-foreground sm:text-base">{description}</p></div>
      {action}
    </div>
  );
}

function ProgressStep({ number, title, detail, active, complete }: { number: string; title: string; detail: string; active?: boolean; complete?: boolean }) {
  return (
    <div className={`flex items-center gap-3 rounded-2xl border p-3.5 ${active ? 'border-primary/25 bg-primary/[0.04]' : 'bg-card'}`}>
      <span className={`grid size-9 shrink-0 place-items-center rounded-xl text-sm font-bold ${complete ? 'bg-success text-white' : active ? 'bg-primary text-primary-foreground' : 'bg-muted text-muted-foreground'}`}>{complete ? <Check className="size-4" /> : number}</span>
      <div><p className="font-semibold">{title}</p><p className="text-xs text-muted-foreground">{detail}</p></div>
    </div>
  );
}

function MetricCard({ icon: Icon, label, value, accent }: { icon: typeof Warehouse; label: string; value: string; accent: 'blue' | 'cyan' | 'green' }) {
  const colors = { blue: 'bg-primary/10 text-primary', cyan: 'bg-sky/20 text-[#08749b]', green: 'bg-success/10 text-success' };
  return (
    <Card className="surface-card" size="sm"><CardContent className="flex items-center gap-3"><span className={`grid size-11 place-items-center rounded-xl ${colors[accent]}`}><Icon className="size-5" /></span><div><p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">{label}</p><p className="mt-0.5 text-xl font-extrabold tracking-tight">{value}</p></div></CardContent></Card>
  );
}

function SettingsCard({ icon: Icon, title, detail, description }: { icon: typeof Smartphone; title: string; detail: string; description: string }) {
  return (
    <Card className="surface-card"><CardHeader><span className="mb-3 grid size-11 place-items-center rounded-xl bg-secondary text-primary"><Icon className="size-5" /></span><CardTitle>{title}</CardTitle><CardDescription>{description}</CardDescription></CardHeader><CardContent><div className="flex items-center justify-between border-t pt-4"><span className="text-sm font-semibold text-muted-foreground">{detail}</span><Button size="sm" variant="ghost">Gerenciar <ArrowRight /></Button></div></CardContent></Card>
  );
}

function StockBadge({ count }: { count: number }) {
  const low = count <= 2;
  return <Badge className={low ? 'bg-amber-500/10 text-amber-800 hover:bg-amber-500/10' : 'bg-success/10 text-success hover:bg-success/10'}>{count} {count === 1 ? 'unidade' : 'unidades'}</Badge>;
}

function SaleStatus({ status }: { status: string }) {
  return status === 'Cancelada' ? <Badge variant="destructive">Cancelada</Badge> : <Badge className="bg-success/10 text-success hover:bg-success/10">Concluída</Badge>;
}

function maskSerial(serial: string) {
  if (serial.length <= 7) return serial;
  return `${serial.slice(0, 4)}•••${serial.slice(-3)}`;
}

function formatMoney(cents: number) {
  return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(cents / 100);
}

function parseMoney(value: string) {
  const normalized = value.replace(/\./g, '').replace(',', '.').replace(/[^\d.]/g, '');
  return Math.round((Number.parseFloat(normalized) || 0) * 100);
}
