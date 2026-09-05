'use client';

import { useEffect, useState, type ReactNode } from 'react';
import {
  ArrowDownToLine,
  ArrowRight,
  Banknote,
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

import { EntryWizard } from '@/components/pdv/entry-wizard';
import { SellWizard } from '@/components/pdv/sell-wizard';
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
  { view: 'settings', label: 'Configurações', shortLabel: 'Ajustes', icon: Settings },
];

const inventoryRows = [
  { name: 'iPhone 17 Pro Max', detail: 'Deep Blue · 256 GB', available: 12, received: 18, codes: ['195950638011'] },
  { name: 'iPhone 17 Pro Max', detail: 'Silver · 256 GB', available: 5, received: 8, codes: ['195950637151'] },
  { name: 'iPhone 16', detail: 'Pink · 128 GB', available: 3, received: 6, codes: ['195949822193'] },
  { name: 'iPhone 15', detail: 'Black · 128 GB', available: 2, received: 9, codes: ['195949035913', '195949035937'] },
  { name: 'iPhone 17', detail: 'White · 256 GB', available: 1, received: 4, codes: ['4549995649161'] },
];

const salesRows = [
  { number: '#00128', customer: 'Rafael Martins', seller: 'Jeferson', items: 2, total: 1789800, payment: 'Pix + dinheiro', time: 'Hoje, 18:42', status: 'Concluída' },
  { number: '#00127', customer: 'Camila Souza', seller: 'Marcos', items: 1, total: 999900, payment: 'Pix · Nubank', time: 'Hoje, 16:18', status: 'Concluída' },
  { number: '#00126', customer: 'Bruno Lima', seller: 'Jeferson', items: 1, total: 569900, payment: 'Dinheiro', time: 'Hoje, 14:05', status: 'Cancelada' },
  { number: '#00125', customer: 'Fernanda Alves', seller: 'Ana', items: 3, total: 2439700, payment: '2 Pix', time: 'Ontem, 19:34', status: 'Concluída' },
];

export function PdvApp() {
  const [activeView, setActiveView] = useState<View>('sell');
  const [viewRun, setViewRun] = useState(0);
  const [stagedSerial, setStagedSerial] = useState('');

  const changeView = (view: View) => {
    if (view === 'sell') setStagedSerial('');
    setActiveView(view);
    setViewRun((current) => current + 1);
  };

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
          'Abre uma nova venda e prepara um número de série para conferência. Não finaliza nem movimenta o estoque.',
        inputSchema: {
          type: 'object',
          properties: {
            serial: {
              type: 'string',
              description: 'Número de série Apple com 8 a 18 letras ou números.',
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
          await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
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
          Versão demonstrativa · nenhuma operação altera dados reais
        </div>
        <div className="min-h-0 flex-1 overflow-hidden pb-[calc(4.75rem+env(safe-area-inset-bottom))] lg:pb-0">
          {activeView === 'sell' && (
            <SellWizard key={`sell-${viewRun}`} stagedSerial={stagedSerial} />
          )}
          {activeView === 'entry' && <EntryWizard key={`entry-${viewRun}`} />}
          {activeView === 'stock' && <StockView key={`stock-${viewRun}`} />}
          {activeView === 'sales' && <SalesView key={`sales-${viewRun}`} />}
          {activeView === 'settings' && <SettingsView key={`settings-${viewRun}`} />}
        </div>
      </section>

      <MobileNavigation activeView={activeView} onChange={changeView} />
    </main>
  );
}

function StockView() {
  const [query, setQuery] = useState('');
  const filtered = inventoryRows.filter((row) =>
    `${row.name} ${row.detail} ${row.codes.join(' ')}`
      .toLowerCase()
      .includes(query.toLowerCase()),
  );
  const available = inventoryRows.reduce((sum, row) => sum + row.available, 0);

  return (
    <PageContainer>
      <PageHeading
        action={<Button className="hidden h-10 rounded-xl sm:flex" variant="outline"><Download /> Exportar</Button>}
        description="Quantidade por variação e rastreabilidade individual por SN."
        eyebrow="Inventário"
        title="Estoque"
      />
      <div className="mb-3 grid shrink-0 grid-cols-3 gap-2 sm:gap-3">
        <MetricCard icon={Warehouse} label="Disponíveis" value={String(available)} accent="blue" />
        <MetricCard icon={Smartphone} label="Variações" value={String(inventoryRows.length)} accent="cyan" />
        <MetricCard icon={TrendingUp} label="Vendidos hoje" value="7" accent="green" />
      </div>

      <Card className="surface-card flex min-h-0 flex-1 flex-col overflow-hidden">
        <CardHeader className="shrink-0 border-b p-4">
          <div className="hidden sm:block">
            <CardTitle className="text-base">Produtos disponíveis</CardTitle>
            <CardDescription>Consulte todas as unidades por SN.</CardDescription>
          </div>
          <div className="relative w-full sm:w-72">
            <Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input className="h-11 rounded-xl pl-9 text-base" onChange={(event) => setQuery(event.target.value)} placeholder="Produto, cor ou código" value={query} />
          </div>
        </CardHeader>
        <CardContent className="min-h-0 flex-1 overflow-hidden px-0 py-0">
          <div className="hidden h-full min-h-0 overflow-auto overscroll-contain md:block">
            <Table>
              <TableHeader className="[&_th]:sticky [&_th]:top-0 [&_th]:z-10 [&_th]:bg-card">
                <TableRow><TableHead className="pl-5">Produto</TableHead><TableHead>Códigos</TableHead><TableHead>Recebidos</TableHead><TableHead>Disponíveis</TableHead><TableHead className="pr-5 text-right">Ação</TableHead></TableRow>
              </TableHeader>
              <TableBody>
                {filtered.map((row) => (
                  <TableRow key={`${row.name}-${row.detail}`}>
                    <TableCell className="pl-5"><p className="font-semibold">{row.name}</p><p className="text-xs text-muted-foreground">{row.detail}</p></TableCell>
                    <TableCell><p className="max-w-52 truncate font-mono text-xs text-muted-foreground">{row.codes.join(' · ')}</p></TableCell>
                    <TableCell>{row.received}</TableCell>
                    <TableCell><StockBadge count={row.available} /></TableCell>
                    <TableCell className="pr-5 text-right"><Button size="sm" variant="ghost">Ver SNs <ArrowRight /></Button></TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
          <div className="h-full overflow-y-auto overscroll-contain divide-y md:hidden">
            {filtered.map((row) => (
              <button className="flex min-h-[4.7rem] w-full items-center gap-3 px-4 py-3 text-left" key={`${row.name}-${row.detail}`} type="button">
                <span className="grid size-11 shrink-0 place-items-center rounded-xl bg-secondary text-primary"><Smartphone className="size-5" /></span>
                <span className="min-w-0 flex-1"><span className="block truncate text-sm font-semibold">{row.name}</span><span className="block truncate text-xs text-muted-foreground">{row.detail}</span></span>
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
  const totalToday = salesRows
    .filter((sale) => sale.status === 'Concluída' && sale.time.startsWith('Hoje'))
    .reduce((sum, sale) => sum + sale.total, 0);

  return (
    <PageContainer>
      <PageHeading
        action={<Button className="hidden h-10 rounded-xl sm:flex" variant="outline"><FileText /> Relatório</Button>}
        description="Itens, pagamentos, responsáveis, cancelamentos e devoluções."
        eyebrow="Histórico"
        title="Vendas"
      />
      <div className="mb-3 grid shrink-0 grid-cols-3 gap-2 sm:gap-3">
        <MetricCard icon={Banknote} label="Hoje" value={formatMoney(totalToday)} accent="blue" />
        <MetricCard icon={ShoppingBag} label="Aparelhos" value="3" accent="cyan" />
        <MetricCard icon={WalletCards} label="Pix" value="R$ 21.898" accent="green" />
      </div>

      <Card className="surface-card flex min-h-0 flex-1 flex-col overflow-hidden">
        <CardHeader className="shrink-0 border-b p-4">
          <div className="hidden sm:block"><CardTitle className="text-base">Últimas vendas</CardTitle><CardDescription>Registros originais preservados.</CardDescription></div>
          <div className="relative w-full sm:w-72"><Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" /><Input className="h-11 rounded-xl pl-9 text-base" placeholder="Cliente, SN ou número" /></div>
        </CardHeader>
        <CardContent className="min-h-0 flex-1 overflow-hidden px-0 py-0">
          <div className="hidden h-full min-h-0 overflow-auto overscroll-contain md:block">
            <Table>
              <TableHeader className="[&_th]:sticky [&_th]:top-0 [&_th]:z-10 [&_th]:bg-card"><TableRow><TableHead className="pl-5">Venda</TableHead><TableHead>Cliente</TableHead><TableHead>Vendedor</TableHead><TableHead>Pagamento</TableHead><TableHead>Total</TableHead><TableHead>Status</TableHead><TableHead className="pr-5" /></TableRow></TableHeader>
              <TableBody>
                {salesRows.map((sale) => (
                  <TableRow key={sale.number}>
                    <TableCell className="pl-5"><p className="font-semibold">{sale.number}</p><p className="text-xs text-muted-foreground">{sale.time}</p></TableCell>
                    <TableCell><p className="font-medium">{sale.customer}</p><p className="text-xs text-muted-foreground">{sale.items} {sale.items === 1 ? 'aparelho' : 'aparelhos'}</p></TableCell>
                    <TableCell>{sale.seller}</TableCell><TableCell>{sale.payment}</TableCell><TableCell className="font-semibold">{formatMoney(sale.total)}</TableCell><TableCell><SaleStatus status={sale.status} /></TableCell><TableCell className="pr-5"><Button aria-label={`Abrir ${sale.number}`} size="icon-sm" variant="ghost"><ArrowRight /></Button></TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
          <div className="h-full overflow-y-auto overscroll-contain divide-y md:hidden">
            {salesRows.map((sale) => (
              <button className="w-full px-4 py-3 text-left" key={sale.number} type="button">
                <div className="flex items-start justify-between gap-3"><div className="min-w-0"><p className="truncate text-sm font-semibold">{sale.customer}</p><p className="mt-0.5 text-xs text-muted-foreground">{sale.number} · {sale.time}</p></div><SaleStatus status={sale.status} /></div>
                <div className="mt-2 flex items-end justify-between gap-3"><p className="truncate text-xs text-muted-foreground">{sale.items} {sale.items === 1 ? 'aparelho' : 'aparelhos'} · {sale.payment}</p><p className="shrink-0 text-sm font-bold">{formatMoney(sale.total)}</p></div>
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
      <PageHeading description="Cadastros usados nas entradas, vendas e relatórios." eyebrow="Administração" title="Configurações" />
      <Tabs className="flex min-h-0 flex-1 flex-col overflow-hidden" defaultValue="products">
        <TabsList className="mb-3 h-11 w-full shrink-0 justify-start overflow-x-auto rounded-xl bg-muted p-1 sm:w-fit" variant="default">
          <TabsTrigger className="h-9 px-3" value="products">Produtos</TabsTrigger><TabsTrigger className="h-9 px-3" value="people">Pessoas</TabsTrigger><TabsTrigger className="h-9 px-3" value="finance">Financeiro</TabsTrigger><TabsTrigger className="h-9 px-3" value="system">Sistema</TabsTrigger>
        </TabsList>
        <SettingsTab value="products"><SettingsCard icon={Smartphone} title="Produtos e variações" detail="5 variações ativas" description="Modelo, cor, capacidade e apresentação no estoque." /><SettingsCard icon={ScanBarcode} title="Códigos comerciais" detail="6 códigos vinculados" description="Uma variação pode aceitar vários UPCs, EANs ou JANs." /></SettingsTab>
        <SettingsTab value="people"><SettingsCard icon={UsersRound} title="Clientes" detail="84 cadastrados" description="Cadastro rápido com nome obrigatório." /><SettingsCard icon={UserRound} title="Vendedores" detail="3 ativos" description="Responsável comercial selecionado na venda." /><SettingsCard icon={CircleUserRound} title="Usuários" detail="4 acessos" description="Cada operador usa sua própria conta." /></SettingsTab>
        <SettingsTab value="finance"><SettingsCard icon={Building2} title="Bancos Pix" detail="3 contas ativas" description="Conta de recebimento exigida para cada Pix." /><SettingsCard icon={WalletCards} title="Formas de pagamento" detail="Dinheiro e Pix" description="Uma venda aceita vários lançamentos." /></SettingsTab>
        <SettingsTab value="system"><SettingsCard icon={ArrowDownToLine} title="Backups" detail="A configurar" description="Banco e imagens terão cópias separadas." /><SettingsCard icon={RotateCcw} title="Auditoria" detail="Todas as operações" description="Operador, data e alterações preservados." /></SettingsTab>
      </Tabs>
    </PageContainer>
  );
}

function SettingsTab({ value, children }: { value: string; children: ReactNode }) {
  return <TabsContent className="min-h-0 flex-1 overflow-y-auto overscroll-contain" value={value}><div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">{children}</div></TabsContent>;
}

function MainNavigation({ activeView, onChange }: { activeView: View; onChange: (view: View) => void }) {
  return (
    <nav aria-label="Navegação principal" className="mt-10 space-y-1">
      {navItems.map(({ view, label, icon: Icon }) => {
        const active = view === activeView;
        return <button className={`flex min-h-12 w-full items-center gap-3 rounded-2xl px-4 text-left text-[0.95rem] font-semibold transition ${active ? 'bg-primary text-primary-foreground shadow-[0_10px_24px_rgb(10_35_66/16%)]' : 'text-muted-foreground hover:bg-muted hover:text-foreground'}`} key={view} onClick={() => onChange(view)} type="button"><Icon className="size-[1.15rem]" strokeWidth={2.1} /> {label}</button>;
      })}
    </nav>
  );
}

function MobileNavigation({ activeView, onChange }: { activeView: View; onChange: (view: View) => void }) {
  return (
    <nav aria-label="Navegação principal" className="fixed inset-x-0 bottom-0 z-40 border-t bg-background/95 px-2 pb-[max(0.55rem,env(safe-area-inset-bottom))] pt-1.5 backdrop-blur-xl lg:hidden">
      <div className="mx-auto grid max-w-lg grid-cols-5">
        {navItems.map(({ view, label, shortLabel, icon: Icon }) => {
          const active = view === activeView;
          return <button className={`flex min-h-[3.6rem] flex-col items-center justify-center gap-1 rounded-xl text-xs font-semibold ${active ? 'text-primary' : 'text-muted-foreground'}`} key={view} onClick={() => onChange(view)} type="button"><Icon className={`size-5 ${active ? 'fill-primary/10' : ''}`} strokeWidth={active ? 2.4 : 1.9} />{shortLabel ?? label}</button>;
        })}
      </div>
    </nav>
  );
}

function AppHeader() {
  return (
    <header className="relative z-20 flex h-16 shrink-0 items-center justify-between border-b bg-background/92 px-4 backdrop-blur-xl sm:px-7 lg:h-[4.5rem] lg:px-10">
      <div className="lg:hidden"><Brand compact /></div>
      <p className="hidden text-sm font-medium text-muted-foreground lg:block">Quinta-feira, 4 de setembro</p>
      <Badge className="h-7 gap-1.5 bg-success/12 px-3 text-success ring-1 ring-success/15 hover:bg-success/12"><span className="size-1.5 rounded-full bg-success" />Online</Badge>
    </header>
  );
}

function OperatorCard() {
  return <div className="mt-auto rounded-2xl border bg-card p-4"><p className="text-xs font-semibold uppercase tracking-[0.12em] text-muted-foreground">Operador</p><div className="mt-3 flex items-center gap-3"><span className="grid size-10 place-items-center rounded-full bg-secondary text-primary"><CircleUserRound className="size-5" /></span><div className="min-w-0"><p className="truncate font-semibold">Jeferson</p><p className="text-xs text-muted-foreground">Administrador</p></div></div></div>;
}

function Brand({ compact = false }: { compact?: boolean }) {
  return <div className="flex items-center gap-3"><span className={`grid place-items-center rounded-xl bg-primary text-primary-foreground shadow-[0_8px_20px_rgb(10_35_66/20%)] ${compact ? 'size-9' : 'size-11'}`}><Smartphone className={compact ? 'size-4' : 'size-5'} strokeWidth={2.25} /></span><div><p className={`${compact ? 'text-base' : 'text-lg'} font-extrabold tracking-[-0.04em]`}>PDV Estoque</p>{!compact && <p className="text-xs font-medium text-muted-foreground">Controle por número de série</p>}</div></div>;
}

function PageContainer({ children }: { children: ReactNode }) {
  return <div className="flex h-full min-h-0 flex-col overflow-hidden px-3 py-3 sm:px-6 sm:py-5 lg:px-10">{children}</div>;
}

function PageHeading({ eyebrow, title, description, action }: { eyebrow: string; title: string; description: string; action?: ReactNode }) {
  return <div className="mb-3 flex shrink-0 items-end justify-between gap-4"><div className="min-w-0"><p className="eyebrow">{eyebrow}</p><h1 className="mt-0.5 text-2xl font-bold tracking-[-0.04em] sm:text-3xl">{title}</h1><p className="mt-1 hidden truncate text-sm text-muted-foreground sm:block">{description}</p></div>{action}</div>;
}

function MetricCard({ icon: Icon, label, value, accent }: { icon: typeof Warehouse; label: string; value: string; accent: 'blue' | 'cyan' | 'green' }) {
  const colors = { blue: 'bg-primary/10 text-primary', cyan: 'bg-sky/20 text-[#08749b]', green: 'bg-success/10 text-success' };
  return <Card className="min-w-0" size="sm"><CardContent className="flex min-w-0 items-center gap-2 p-2.5 sm:gap-3 sm:p-4"><span className={`hidden size-10 shrink-0 place-items-center rounded-xl sm:grid ${colors[accent]}`}><Icon className="size-5" /></span><div className="min-w-0"><p className="truncate text-[0.65rem] font-semibold uppercase tracking-wide text-muted-foreground sm:text-xs">{label}</p><p className="mt-0.5 truncate text-sm font-extrabold tracking-tight sm:text-lg">{value}</p></div></CardContent></Card>;
}

function SettingsCard({ icon: Icon, title, detail, description }: { icon: typeof Smartphone; title: string; detail: string; description: string }) {
  return <Card className="surface-card"><CardHeader className="p-4"><span className="mb-2 grid size-10 place-items-center rounded-xl bg-secondary text-primary"><Icon className="size-5" /></span><CardTitle className="text-base">{title}</CardTitle><CardDescription>{description}</CardDescription></CardHeader><CardContent className="p-4 pt-0"><div className="flex items-center justify-between border-t pt-3"><span className="text-sm font-semibold text-muted-foreground">{detail}</span><Button size="sm" variant="ghost">Gerenciar <ArrowRight /></Button></div></CardContent></Card>;
}

function StockBadge({ count }: { count: number }) {
  const low = count <= 2;
  return <Badge className={low ? 'bg-amber-500/10 text-amber-800 hover:bg-amber-500/10' : 'bg-success/10 text-success hover:bg-success/10'}>{count} <span className="hidden sm:inline">{count === 1 ? 'unidade' : 'unidades'}</span></Badge>;
}

function SaleStatus({ status }: { status: string }) {
  return status === 'Cancelada' ? <Badge variant="destructive">Cancelada</Badge> : <Badge className="bg-success/10 text-success hover:bg-success/10">Concluída</Badge>;
}

function formatMoney(cents: number) {
  return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(cents / 100);
}
