'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  BookOpen,
  ChevronDown,
  CircleUserRound,
  History,
  LoaderCircle,
  LogOut,
  Package,
  Settings,
  ShoppingBag,
  Smartphone,
  UsersRound,
  Warehouse,
} from 'lucide-react';

import { CatalogProductionView } from '@/components/pdv/views/catalog-production-view';
import { EntryHistoryView } from '@/components/pdv/views/entry-history-view';
import { SalesProductionView } from '@/components/pdv/views/sales-production-view';
import { SettingsProductionView } from '@/components/pdv/views/settings-production-view';
import { StockProductionView } from '@/components/pdv/views/stock-production-view';
import { unlockScannerAudio } from '@/components/pdv/barcode-scanner';
import { RecoveryCodesPanel } from '@/components/pdv/recovery-codes-panel';
import {
  EntryWizard,
  type EntryProduct,
  type EntrySubmission,
} from '@/components/pdv/entry-wizard';
import {
  SellWizard,
  type CompletedSalePayload,
  type SaleCustomer,
  type SaleSerialMatch,
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
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { messageOf, requestJson } from '@/lib/client-api';
import {
  activateReceiptOcrQueue,
  enqueueReceiptOcrJobs,
  type ReceiptOcrAttachment,
} from '@/lib/client-receipt-background';
import { displayCommercialCode } from '@/lib/commercial-code';
import type { BootstrapData } from '@/lib/pdv-types';
import { preloadScannerDecoder } from '@/lib/scanner';

type View =
  | 'sell'
  | 'entry'
  | 'stock'
  | 'sales'
  | 'catalog'
  | 'entries'
  | 'settings';

type SessionResponse =
  | { authenticated: false }
  | {
      authenticated: true;
      csrfToken: string;
      user: {
        id: string;
        displayName: string;
        email: string | null;
        username: string | null;
        role: 'owner' | 'admin' | 'operator';
        authKind: 'google' | 'password';
        photoUrl: string | null;
        mustChangePassword: boolean;
      };
      store: { id: string; name: string; code: string } | null;
    };

type BeforeInstallPromptEvent = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
};

const navigation: Array<{
  view: View;
  label: string;
  short: string;
  icon: typeof ShoppingBag;
}> = [
  { view: 'sell', label: 'Vender', short: 'Venda', icon: ShoppingBag },
  { view: 'entry', label: 'Nova entrada', short: 'Entrada', icon: Package },
  { view: 'stock', label: 'Estoque', short: 'Estoque', icon: Warehouse },
  { view: 'sales', label: 'Vendas', short: 'Vendas', icon: History },
  {
    view: 'catalog',
    label: 'Cadastros',
    short: 'Cadastros',
    icon: UsersRound,
  },
  {
    view: 'entries',
    label: 'Histórico de entradas',
    short: 'Hist.',
    icon: BookOpen,
  },
  {
    view: 'settings',
    label: 'Configurações',
    short: 'Ajustes',
    icon: Settings,
  },
];

export function ProductionApp() {
  const [session, setSession] = useState<SessionResponse | null>(null);
  const [sessionError, setSessionError] = useState('');

  const loadSession = useCallback(async () => {
    try {
      setSessionError('');
      setSession(await requestJson<SessionResponse>('/api/auth/session'));
    } catch (error) {
      setSessionError(messageOf(error));
    }
  }, []);

  useEffect(() => {
    queueMicrotask(() => void loadSession());
  }, [loadSession]);

  if (sessionError) {
    return (
      <FullPageMessage
        title="Não foi possível abrir o sistema"
        detail={sessionError}
        onRetry={loadSession}
      />
    );
  }
  if (!session) return <LoadingScreen label="Abrindo o sistema…" />;
  if (!session.authenticated) return <AuthScreen />;
  if (session.user.mustChangePassword) {
    return <RequiredPasswordChange csrfToken={session.csrfToken} />;
  }
  if (!session.store) {
    return (
      <StoreSetup
        csrfToken={session.csrfToken}
        displayName={session.user.displayName}
      />
    );
  }
  return <CloudPdv session={session} />;
}

function RequiredPasswordChange({ csrfToken }: { csrfToken: string }) {
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmation, setConfirmation] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  return (
    <main className="grid h-dvh place-items-center overflow-y-auto bg-muted/35 p-4">
      <Card className="w-full max-w-md">
        <CardHeader>
          <CardTitle>Crie sua senha pessoal</CardTitle>
          <CardDescription>
            A senha inicial foi criada pelo administrador. Troque-a antes de
            acessar a loja.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form
            className="space-y-3"
            onSubmit={async (event) => {
              event.preventDefault();
              if (newPassword !== confirmation) {
                setError('A confirmação não corresponde à nova senha.');
                return;
              }
              setBusy(true);
              setError('');
              try {
                await requestJson('/api/me/password', {
                  method: 'POST',
                  headers: {
                    'content-type': 'application/json',
                    'x-csrf-token': csrfToken,
                  },
                  body: JSON.stringify({ currentPassword, newPassword }),
                });
                window.location.reload();
              } catch (caught) {
                setError(messageOf(caught));
                setBusy(false);
              }
            }}
          >
            <Field label="Senha inicial">
              <Input
                autoComplete="current-password"
                onChange={(event) => setCurrentPassword(event.target.value)}
                required
                type="password"
                value={currentPassword}
              />
            </Field>
            <Field label="Nova senha">
              <Input
                autoComplete="new-password"
                minLength={10}
                onChange={(event) => setNewPassword(event.target.value)}
                required
                type="password"
                value={newPassword}
              />
            </Field>
            <Field label="Confirmar nova senha">
              <Input
                autoComplete="new-password"
                minLength={10}
                onChange={(event) => setConfirmation(event.target.value)}
                required
                type="password"
                value={confirmation}
              />
            </Field>
            {error && (
              <p className="rounded-xl bg-destructive/10 p-3 text-sm font-semibold text-destructive">
                {error}
              </p>
            )}
            <Button
              className="h-12 w-full rounded-xl"
              disabled={busy}
              type="submit"
            >
              Salvar e acessar
            </Button>
            <Button
              className="h-11 w-full rounded-xl"
              disabled={busy}
              onClick={() => void logoutSession(csrfToken)}
              type="button"
              variant="ghost"
            >
              <LogOut /> Sair e usar outra conta
            </Button>
          </form>
        </CardContent>
      </Card>
    </main>
  );
}

function CloudPdv({
  session,
}: {
  session: Extract<SessionResponse, { authenticated: true }>;
}) {
  const [activeView, setActiveView] = useState<View>('sell');
  const [run, setRun] = useState(0);
  const [data, setData] = useState<BootstrapData | null>(null);
  const [loadingError, setLoadingError] = useState('');
  const [guideOpen, setGuideOpen] = useState(false);
  const [profileOpen, setProfileOpen] = useState(false);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [installPrompt, setInstallPrompt] =
    useState<BeforeInstallPromptEvent | null>(null);
  const [installed, setInstalled] = useState(
    () =>
      typeof window !== 'undefined' &&
      window.matchMedia('(display-mode: standalone)').matches,
  );
  const [saleToOpen, setSaleToOpen] = useState<string | null>(null);
  const reloadRequestRef = useRef(0);
  const dataRef = useRef<BootstrapData | null>(null);
  const lastReloadAtRef = useRef(0);
  const catalogSyncRef = useRef(0);

  const reload = useCallback(async (background = false) => {
    const requestId = ++reloadRequestRef.current;
    try {
      if (!background) setLoadingError('');
      const next = await requestJson<BootstrapData>('/api/bootstrap');
      if (requestId !== reloadRequestRef.current) return;
      dataRef.current = next;
      lastReloadAtRef.current = Date.now();
      setData(next);
      if (next.guideRequired) setGuideOpen(true);
    } catch (error) {
      if (requestId !== reloadRequestRef.current) return;
      const message = messageOf(error);
      if (/Entre novamente/.test(message)) window.location.reload();
      if (!background || !dataRef.current) setLoadingError(message);
    }
  }, []);

  useEffect(() => {
    queueMicrotask(() => void reload());
  }, [reload]);

  useEffect(() => {
    if (!data?.store.id || !data.csrfToken) return;
    return activateReceiptOcrQueue({
      storeId: data.store.id,
      csrfToken: data.csrfToken,
    });
  }, [data?.csrfToken, data?.store.id]);

  useEffect(() => {
    if (!data?.systemCatalog.updateAvailable) return;
    const version = data.systemCatalog.currentVersion;
    if (catalogSyncRef.current === version) return;
    catalogSyncRef.current = version;
    void requestJson('/api/system-catalog/sync', {
      method: 'POST',
      headers: { 'x-csrf-token': data.csrfToken },
    })
      .then(() => reload(true))
      .catch(() => {
        catalogSyncRef.current = 0;
      });
  }, [data, reload]);

  useEffect(() => {
    const refreshIfStale = () => {
      if (
        !document.hidden &&
        Date.now() - lastReloadAtRef.current >= 10 * 60_000
      ) {
        void reload(true);
      }
    };
    const interval = window.setInterval(refreshIfStale, 10 * 60_000);
    document.addEventListener('visibilitychange', refreshIfStale);
    window.addEventListener('focus', refreshIfStale);
    return () => {
      window.clearInterval(interval);
      document.removeEventListener('visibilitychange', refreshIfStale);
      window.removeEventListener('focus', refreshIfStale);
    };
  }, [reload]);

  useEffect(() => {
    if ('serviceWorker' in navigator) {
      void navigator.serviceWorker.register('/sw.js', {
        scope: '/',
        updateViaCache: 'none',
      });
    }
    const beforeInstall = (event: Event) => {
      event.preventDefault();
      setInstallPrompt(event as BeforeInstallPromptEvent);
    };
    const appInstalled = () => {
      setInstalled(true);
      setInstallPrompt(null);
    };
    window.addEventListener('beforeinstallprompt', beforeInstall);
    window.addEventListener('appinstalled', appInstalled);
    return () => {
      window.removeEventListener('beforeinstallprompt', beforeInstall);
      window.removeEventListener('appinstalled', appInstalled);
    };
  }, []);

  useEffect(() => {
    const unlock = () => {
      unlockScannerAudio();
      preloadScannerDecoder();
    };
    const warmupTimer = window.setTimeout(preloadScannerDecoder, 600);
    window.addEventListener('pointerdown', unlock, {
      capture: true,
      once: true,
    });
    window.addEventListener('keydown', unlock, { capture: true, once: true });
    return () => {
      window.clearTimeout(warmupTimer);
      window.removeEventListener('pointerdown', unlock, { capture: true });
      window.removeEventListener('keydown', unlock, { capture: true });
    };
  }, []);

  const changeView = (view: View) => {
    if (view !== 'sales') setSaleToOpen(null);
    setActiveView(view);
    setRun((value) => value + 1);
    if (Date.now() - lastReloadAtRef.current >= 5_000) void reload(true);
  };

  const productsByCode = useMemo<Record<string, EntryProduct>>(() => {
    const lookup: Record<string, EntryProduct> = {};
    for (const product of data?.products.filter((item) => item.active) ?? []) {
      for (const code of product.codes) {
        lookup[code.code] = {
          id: product.id,
          name: product.model,
          detail: product.detail,
          color: product.color,
          memory: product.memory,
          code: displayCommercialCode(code.code, code.kind),
        };
      }
    }
    return lookup;
  }, [data?.products]);
  const lookupSerials = useCallback(async (serials: string[]) => {
    const params = new URLSearchParams();
    serials.forEach((serial) => params.append('serial', serial));
    const result = await requestJson<{ matches: SaleSerialMatch[] }>(
      `/api/inventory/lookup?${params.toString()}`,
    );
    return result.matches;
  }, []);

  const saveEntry = async (entry: EntrySubmission) => {
    const form = new FormData();
    form.set(
      'payload',
      JSON.stringify({
        operationId: entry.operationId,
        productId: entry.productId,
        gtin14: entry.gtin14,
        serials: entry.serials,
      }),
    );
    entry.photos.forEach((photo) => form.append('photos', photo));
    const result = await requestJson<{ added: number }>('/api/entries', {
      method: 'POST',
      headers: { 'x-csrf-token': data!.csrfToken },
      body: form,
    });
    void reload(true);
    return { added: result.added, duplicates: 0, capacityReached: false };
  };

  const createSaleCustomer = async (input: {
    operationId: string;
    name: string;
    phone: string;
  }): Promise<SaleCustomer> => {
    const result = await requestJson<{ id: string }>('/api/clients', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-csrf-token': data!.csrfToken,
      },
      body: JSON.stringify(input),
    });
    const created = {
      id: result.id,
      name: input.name,
      phone: input.phone || null,
      email: null,
      notes: null,
      active: true,
    };
    setData((current) => {
      if (!current) return current;
      const next = { ...current, clients: [...current.clients, created] };
      dataRef.current = next;
      return next;
    });
    return { id: created.id, name: created.name, phone: created.phone };
  };

  const saveSale = async (sale: CompletedSalePayload) => {
    const form = new FormData();
    form.set(
      'payload',
      JSON.stringify({
        operationId: sale.operationId,
        customerId: sale.customerId,
        items: sale.items.map((item) => ({
          serial: item.serial,
          priceCents: item.priceCents,
        })),
        payments: sale.payments.map((payment) => ({
          method: payment.method === 'Pix' ? 'pix' : 'cash',
          pixAccountId: payment.method === 'Pix' ? payment.bank : null,
          amountCents: payment.amountCents,
        })),
        receiptValues: sale.receiptValues,
      }),
    );
    sale.items.forEach((item, itemIndex) =>
      item.photos.forEach((photo) =>
        form.append(`itemPhotos:${itemIndex}`, photo),
      ),
    );
    sale.receipts.forEach((receipt) => form.append('receipts', receipt));
    const result = await requestJson<{
      id: string;
      receipts: ReceiptOcrAttachment[];
    }>('/api/sales', {
      method: 'POST',
      headers: { 'x-csrf-token': data!.csrfToken },
      body: form,
    });
    void enqueueReceiptOcrJobs({
      storeId: data!.store.id,
      saleId: result.id,
      attachments: result.receipts ?? [],
      files: sale.receipts,
      receiptValues: sale.receiptValues,
    }).catch(() => {});
    void reload(true);
  };

  const logout = async () => {
    await requestJson('/api/auth/logout', {
      method: 'POST',
      headers: { 'x-csrf-token': data?.csrfToken ?? session.csrfToken },
    });
    window.location.reload();
  };

  if (loadingError) {
    return (
      <FullPageMessage
        title="Não foi possível carregar a loja"
        detail={loadingError}
        onRetry={reload}
      />
    );
  }
  if (!data) return <LoadingScreen label="Carregando sua loja…" />;

  return (
    <main className="h-dvh overflow-hidden bg-background text-foreground">
      <aside className="fixed inset-y-0 left-0 z-30 hidden w-64 border-r bg-sidebar px-5 py-6 lg:flex lg:flex-col">
        <Brand storeName={data.store.name} />
        <DesktopNavigation active={activeView} onChange={changeView} />
        <button
          className="mt-auto w-full rounded-2xl border bg-card p-4 text-left transition hover:bg-muted/40"
          onClick={() => setProfileOpen(true)}
          type="button"
        >
          <p className="text-xs font-bold uppercase tracking-wider text-muted-foreground">
            Operador
          </p>
          <div className="mt-2 flex items-center gap-3">
            <span className="grid size-10 place-items-center rounded-full bg-secondary text-primary">
              <CircleUserRound className="size-5" />
            </span>
            <span className="min-w-0">
              <span className="block truncate font-bold">
                {data.user.displayName}
              </span>
              <span className="block text-xs text-muted-foreground">
                {roleLabel(data.user.role)} · Ajuda
              </span>
            </span>
          </div>
        </button>
      </aside>

      <section className="mx-auto flex h-dvh min-h-0 max-w-[1500px] flex-col overflow-hidden lg:ml-64">
        <header className="relative z-20 flex h-[calc(3.75rem+env(safe-area-inset-top))] shrink-0 items-center justify-between border-b bg-background/95 px-4 pt-[env(safe-area-inset-top)] backdrop-blur-xl lg:h-[4.5rem] lg:px-10 lg:pt-0">
          <button
            aria-controls="mobile-primary-navigation"
            aria-expanded={mobileMenuOpen}
            aria-haspopup="dialog"
            aria-label={`Abrir menu da loja ${data.store.name}`}
            className="group flex min-w-0 items-center gap-1 rounded-2xl py-1 pr-1 text-left outline-none transition hover:bg-muted/60 focus-visible:ring-2 focus-visible:ring-ring lg:hidden"
            onClick={() => setMobileMenuOpen(true)}
            type="button"
          >
            <Brand compact storeName={data.store.name} />
            <ChevronDown
              className={`size-4 shrink-0 text-muted-foreground transition-transform ${mobileMenuOpen ? 'rotate-180' : ''}`}
            />
          </button>
          <div className="hidden lg:block">
            <p className="text-sm font-bold">{data.store.name}</p>
            <p className="text-xs text-muted-foreground">
              Loja {data.store.code}
            </p>
          </div>
          <div className="flex shrink-0 items-center gap-1 sm:gap-2">
            <Button
              className="h-10 rounded-full px-3 text-sm lg:hidden"
              onClick={() => setProfileOpen(true)}
              size="sm"
              variant="ghost"
            >
              <CircleUserRound />{' '}
              <span className="hidden min-[430px]:inline">
                {firstName(data.user.displayName)}
              </span>
            </Button>
            <Badge className="bg-success/10 text-success hover:bg-success/10">
              <span className="mr-1 size-1.5 rounded-full bg-success" />
              Online
            </Badge>
          </div>
        </header>

        <div className="min-h-0 flex-1 overflow-hidden">
          {activeView === 'sell' && (
            <SellWizard
              customers={data.clients
                .filter((client) => client.active)
                .map(({ id, name, phone }) => ({ id, name, phone }))}
              key={`sell-${run}`}
              onComplete={saveSale}
              onCreateCustomer={createSaleCustomer}
              pixAccounts={data.pixAccounts
                .filter((account) => account.active)
                .map(({ id, name }) => ({ id, name }))}
              resolveSerials={lookupSerials}
            />
          )}
          {activeView === 'entry' && (
            <EntryWizard
              key={`entry-${run}`}
              lookupSerials={lookupSerials}
              onConfirmEntry={saveEntry}
              productsByCode={productsByCode}
            />
          )}
          {activeView === 'stock' && (
            <StockProductionView
              data={data}
              key={`stock-${run}`}
              onOpenSale={(saleId) => {
                setSaleToOpen(saleId);
                changeView('sales');
              }}
            />
          )}
          {activeView === 'sales' && (
            <SalesProductionView
              data={data}
              key={`sales-${run}`}
              onChanged={() => reload(true)}
              onOpenSaleHandled={() => setSaleToOpen(null)}
              openSaleId={saleToOpen}
            />
          )}
          {activeView === 'catalog' && (
            <CatalogProductionView
              data={data}
              key={`catalog-${run}`}
              onChanged={() => reload(true)}
            />
          )}
          {activeView === 'entries' && (
            <EntryHistoryView key={`entries-${run}`} />
          )}
          {activeView === 'settings' && (
            <SettingsProductionView
              data={data}
              installAvailable={Boolean(installPrompt)}
              installed={installed}
              key={`settings-${run}`}
              onChanged={() => reload(true)}
              onInstall={async () => {
                if (!installPrompt) return;
                await installPrompt.prompt();
                await installPrompt.userChoice;
                setInstallPrompt(null);
              }}
            />
          )}
        </div>
      </section>

      <MobileNavigation
        active={activeView}
        onChange={changeView}
        onOpenChange={setMobileMenuOpen}
        open={mobileMenuOpen}
        storeCode={data.store.code}
        storeName={data.store.name}
      />
      <ProfileDialog
        data={data}
        onEntries={() => {
          setProfileOpen(false);
          changeView('entries');
        }}
        onGuide={() => {
          setProfileOpen(false);
          setGuideOpen(true);
        }}
        onLogout={() => void logout()}
        onOpenChange={setProfileOpen}
        onSettings={() => {
          setProfileOpen(false);
          changeView('settings');
        }}
        open={profileOpen}
      />
      <GuideDialog
        onAcknowledge={async () => {
          await requestJson('/api/guide', {
            method: 'POST',
            headers: { 'x-csrf-token': data.csrfToken },
          });
          setData((current) =>
            current ? { ...current, guideRequired: false } : current,
          );
          setGuideOpen(false);
        }}
        onOpenChange={(open) => {
          if (!open && data.guideRequired) return;
          setGuideOpen(open);
        }}
        open={guideOpen}
        required={data.guideRequired}
      />
    </main>
  );
}

function AuthScreen() {
  const [busy, setBusy] = useState(false);
  const [recoveryCodes, setRecoveryCodes] = useState<string[]>([]);
  const [error, setError] = useState(() => {
    if (typeof window === 'undefined') return '';
    return new URLSearchParams(window.location.search).get('auth_error') ?? '';
  });

  const submit = async (url: string, payload: Record<string, unknown>) => {
    setBusy(true);
    setError('');
    try {
      const result = await requestJson<{ recoveryCodes?: string[] }>(url, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(payload),
      });
      if (result.recoveryCodes?.length) {
        setRecoveryCodes(result.recoveryCodes);
        setBusy(false);
        return;
      }
      window.location.assign('/');
    } catch (submissionError) {
      setError(messageOf(submissionError));
      setBusy(false);
    }
  };

  if (recoveryCodes.length) {
    return (
      <main className="grid h-dvh place-items-center overflow-y-auto bg-muted/35 p-4">
        <RecoveryCodesPanel
          codes={recoveryCodes}
          continueLabel="Concluir"
          onContinue={() => window.location.assign('/')}
        />
      </main>
    );
  }

  return (
    <main className="grid h-dvh overflow-hidden bg-[radial-gradient(circle_at_top_left,var(--color-secondary),transparent_45%)] lg:grid-cols-[1fr_1.05fr]">
      <section className="hidden flex-col justify-between bg-primary p-12 text-primary-foreground lg:flex">
        <Brand light storeName="AtacadoApple" />
        <div className="max-w-lg">
          <p className="text-sm font-bold uppercase tracking-[0.18em] text-primary-foreground/65">
            PDV e estoque por SN
          </p>
          <h1 className="mt-4 text-5xl font-extrabold tracking-[-0.05em]">
            Venda rápida, estoque rastreável e cada loja no seu lugar.
          </h1>
          <p className="mt-5 text-lg leading-8 text-primary-foreground/75">
            Entradas, vendas, fotos, comprovantes, relatórios e usuários em um
            aplicativo instalável.
          </p>
        </div>
        <p className="text-sm text-primary-foreground/60">
          Dados de cada loja isolados e protegidos.
        </p>
      </section>
      <section className="flex min-h-0 items-center justify-center overflow-y-auto p-3 sm:p-6">
        <Card className="w-full max-w-xl shadow-2xl shadow-primary/10">
          <CardHeader className="pb-3 lg:hidden">
            <Brand storeName="AtacadoApple" />
          </CardHeader>
          <CardContent className="p-4 sm:p-6">
            <Tabs defaultValue="login">
              <TabsList className="grid h-11 w-full grid-cols-2">
                <TabsTrigger value="login">Entrar</TabsTrigger>
                <TabsTrigger value="register">Criar uma loja</TabsTrigger>
              </TabsList>
              {error && (
                <p
                  className="mt-3 rounded-xl bg-destructive/10 px-3 py-2 text-sm font-semibold text-destructive"
                  role="alert"
                >
                  {error}
                </p>
              )}
              <TabsContent value="login">
                <LoginForms busy={busy} onSubmit={submit} />
              </TabsContent>
              <TabsContent value="register">
                <RegisterForm busy={busy} onSubmit={submit} />
              </TabsContent>
            </Tabs>
          </CardContent>
        </Card>
      </section>
    </main>
  );
}

function LoginForms({
  busy,
  onSubmit,
}: {
  busy: boolean;
  onSubmit: (url: string, payload: Record<string, unknown>) => Promise<void>;
}) {
  const [mode, setMode] = useState<'owner' | 'staff'>('owner');
  const [email, setEmail] = useState('');
  const [storeCode, setStoreCode] = useState('');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [recovering, setRecovering] = useState(false);
  const [recoveryCode, setRecoveryCode] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmation, setConfirmation] = useState('');
  const [recoveryError, setRecoveryError] = useState('');
  if (recovering) {
    return (
      <form
        className="mt-4 space-y-3"
        onSubmit={(event) => {
          event.preventDefault();
          if (newPassword !== confirmation) {
            setRecoveryError('A confirmação não corresponde à nova senha.');
            return;
          }
          setRecoveryError('');
          void onSubmit('/api/auth/recover-password', {
            email,
            code: recoveryCode,
            newPassword,
          });
        }}
      >
        <div>
          <p className="font-bold">Recuperar conta do dono</p>
          <p className="text-sm text-muted-foreground">
            Informe um dos códigos que você guardou ao criar a conta.
          </p>
        </div>
        <Field label="E-mail">
          <Input
            autoComplete="email"
            onChange={(event) => setEmail(event.target.value)}
            required
            type="email"
            value={email}
          />
        </Field>
        <Field label="Código de recuperação">
          <Input
            autoCapitalize="characters"
            autoComplete="one-time-code"
            maxLength={24}
            onChange={(event) => setRecoveryCode(event.target.value)}
            placeholder="XXXX-XXXX-XXXX-XXXX"
            required
            value={recoveryCode}
          />
        </Field>
        <Field label="Nova senha">
          <Input
            autoComplete="new-password"
            minLength={10}
            onChange={(event) => setNewPassword(event.target.value)}
            required
            type="password"
            value={newPassword}
          />
        </Field>
        <Field label="Confirmar nova senha">
          <Input
            autoComplete="new-password"
            minLength={10}
            onChange={(event) => setConfirmation(event.target.value)}
            required
            type="password"
            value={confirmation}
          />
        </Field>
        {recoveryError && (
          <p className="rounded-xl bg-destructive/10 p-3 text-sm font-semibold text-destructive">
            {recoveryError}
          </p>
        )}
        <Button
          className="h-12 w-full rounded-xl"
          disabled={busy}
          type="submit"
        >
          {busy ? <LoaderCircle className="animate-spin" /> : null} Criar nova
          senha
        </Button>
        <Button
          className="w-full"
          disabled={busy}
          onClick={() => setRecovering(false)}
          type="button"
          variant="ghost"
        >
          Voltar para entrar
        </Button>
      </form>
    );
  }
  return (
    <form
      className="mt-4 space-y-3"
      onSubmit={(event) => {
        event.preventDefault();
        void onSubmit(
          '/api/auth/login',
          mode === 'owner'
            ? { mode, email, password }
            : { mode, storeCode, username, password },
        );
      }}
    >
      <div className="grid grid-cols-2 gap-2 rounded-xl bg-muted p-1">
        <Button
          onClick={() => setMode('owner')}
          type="button"
          variant={mode === 'owner' ? 'default' : 'ghost'}
        >
          Dono da loja
        </Button>
        <Button
          onClick={() => setMode('staff')}
          type="button"
          variant={mode === 'staff' ? 'default' : 'ghost'}
        >
          Funcionário
        </Button>
      </div>
      {mode === 'owner' ? (
        <Field label="E-mail">
          <Input
            autoComplete="email"
            onChange={(event) => setEmail(event.target.value)}
            required
            type="email"
            value={email}
          />
        </Field>
      ) : (
        <>
          <Field label="Código da loja">
            <Input
              autoCapitalize="none"
              onChange={(event) => setStoreCode(event.target.value)}
              required
              value={storeCode}
            />
          </Field>
          <Field label="Usuário">
            <Input
              autoCapitalize="none"
              autoComplete="username"
              onChange={(event) => setUsername(event.target.value)}
              required
              value={username}
            />
          </Field>
        </>
      )}
      <Field label="Senha">
        <Input
          autoComplete="current-password"
          onChange={(event) => setPassword(event.target.value)}
          required
          type="password"
          value={password}
        />
      </Field>
      {mode === 'owner' && (
        <Button
          className="h-auto w-full px-0 text-sm"
          disabled={busy}
          onClick={() => setRecovering(true)}
          type="button"
          variant="link"
        >
          Esqueci minha senha
        </Button>
      )}
      <Button className="h-12 w-full rounded-xl" disabled={busy} type="submit">
        {busy ? <LoaderCircle className="animate-spin" /> : null} Entrar
      </Button>
      {mode === 'owner' && (
        <>
          <div className="flex items-center gap-3 text-xs text-muted-foreground">
            <span className="h-px flex-1 bg-border" />
            ou
            <span className="h-px flex-1 bg-border" />
          </div>
          <Button
            className="h-12 w-full rounded-xl"
            onClick={() => window.location.assign('/api/auth/google')}
            type="button"
            variant="outline"
          >
            Continuar com Google
          </Button>
        </>
      )}
    </form>
  );
}

function RegisterForm({
  busy,
  onSubmit,
}: {
  busy: boolean;
  onSubmit: (url: string, payload: Record<string, unknown>) => Promise<void>;
}) {
  const [values, setValues] = useState({
    displayName: '',
    email: '',
    password: '',
    storeName: '',
    storeCode: '',
    setupToken: '',
  });
  const set = (key: keyof typeof values, value: string) =>
    setValues((current) => ({ ...current, [key]: value }));
  return (
    <form
      className="mt-4 grid gap-3 sm:grid-cols-2"
      onSubmit={(event) => {
        event.preventDefault();
        void onSubmit('/api/auth/register-owner', values);
      }}
    >
      <Field label="Seu nome">
        <Input
          onChange={(event) => set('displayName', event.target.value)}
          required
          value={values.displayName}
        />
      </Field>
      <Field label="Nome da loja">
        <Input
          onChange={(event) => set('storeName', event.target.value)}
          required
          value={values.storeName}
        />
      </Field>
      <Field label="E-mail">
        <Input
          autoComplete="email"
          onChange={(event) => set('email', event.target.value)}
          required
          type="email"
          value={values.email}
        />
      </Field>
      <Field label="Código da loja">
        <Input
          autoCapitalize="none"
          onChange={(event) => set('storeCode', event.target.value)}
          placeholder="atacadoapple"
          required
          value={values.storeCode}
        />
      </Field>
      <div className="sm:col-span-2">
        <Field label="Senha (letras e números, mínimo 10 caracteres)">
          <Input
            autoComplete="new-password"
            minLength={10}
            onChange={(event) => set('password', event.target.value)}
            required
            type="password"
            value={values.password}
          />
        </Field>
      </div>
      <div className="sm:col-span-2">
        <Field label="Código de ativação">
          <Input
            autoComplete="one-time-code"
            onChange={(event) => set('setupToken', event.target.value)}
            required
            value={values.setupToken}
          />
        </Field>
        <p className="mt-1 text-xs text-muted-foreground">
          Necessário apenas para criar conta sem Google. Solicite o código ao
          administrador do sistema.
        </p>
      </div>
      <Button
        className="h-12 rounded-xl sm:col-span-2"
        disabled={busy}
        type="submit"
      >
        {busy ? <LoaderCircle className="animate-spin" /> : null} Criar conta e
        loja
      </Button>
      <div className="flex items-center gap-3 text-xs text-muted-foreground sm:col-span-2">
        <span className="h-px flex-1 bg-border" />
        ou
        <span className="h-px flex-1 bg-border" />
      </div>
      <Button
        className="h-12 rounded-xl sm:col-span-2"
        onClick={() => window.location.assign('/api/auth/google')}
        type="button"
        variant="outline"
      >
        Criar conta com Google
      </Button>
      <p className="text-center text-xs leading-5 text-muted-foreground sm:col-span-2">
        Este cadastro cria uma nova loja. Usuários de funcionários são criados
        depois, em Configurações.
      </p>
    </form>
  );
}

function isPrimaryStoreCode(value: string) {
  const code = value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40);
  return code === 'atacadoapple' || code === 'atacado-apple';
}

function StoreSetup({
  csrfToken,
  displayName,
}: {
  csrfToken: string;
  displayName: string;
}) {
  const [name, setName] = useState('');
  const [code, setCode] = useState('');
  const [setupToken, setSetupToken] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  return (
    <main className="grid h-dvh place-items-center overflow-y-auto bg-muted/40 p-4">
      <Card className="w-full max-w-lg">
        <CardHeader>
          <CardTitle>Crie sua loja</CardTitle>
          <CardDescription>
            Olá, {displayName}. Sua conta Google foi confirmada; falta somente
            identificar a loja.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form
            className="space-y-3"
            onSubmit={async (event) => {
              event.preventDefault();
              setBusy(true);
              setError('');
              try {
                await requestJson('/api/stores', {
                  method: 'POST',
                  headers: {
                    'content-type': 'application/json',
                    'x-csrf-token': csrfToken,
                  },
                  body: JSON.stringify({ name, code, setupToken }),
                });
                window.location.reload();
              } catch (submissionError) {
                setError(messageOf(submissionError));
                setBusy(false);
              }
            }}
          >
            <Field label="Nome da loja">
              <Input
                onChange={(event) => setName(event.target.value)}
                required
                value={name}
              />
            </Field>
            <Field label="Código da loja">
              <Input
                autoCapitalize="none"
                onChange={(event) => setCode(event.target.value)}
                placeholder="atacadoapple"
                required
                value={code}
              />
            </Field>
            {isPrimaryStoreCode(code) && (
              <Field label="Código de ativação da loja principal">
                <Input
                  autoComplete="one-time-code"
                  onChange={(event) => setSetupToken(event.target.value)}
                  required
                  value={setupToken}
                />
              </Field>
            )}
            {error && (
              <p className="rounded-xl bg-destructive/10 p-3 text-sm text-destructive">
                {error}
              </p>
            )}
            <Button
              className="h-12 w-full rounded-xl"
              disabled={busy}
              type="submit"
            >
              Criar loja
            </Button>
            <Button
              className="h-11 w-full rounded-xl"
              disabled={busy}
              onClick={() => void logoutSession(csrfToken)}
              type="button"
              variant="ghost"
            >
              <LogOut /> Sair e usar outra conta
            </Button>
          </form>
        </CardContent>
      </Card>
    </main>
  );
}

function ProfileDialog({
  data,
  open,
  onOpenChange,
  onEntries,
  onGuide,
  onLogout,
  onSettings,
}: {
  data: BootstrapData;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onEntries: () => void;
  onGuide: () => void;
  onLogout: () => void;
  onSettings: () => void;
}) {
  return (
    <Dialog onOpenChange={onOpenChange} open={open}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{data.user.displayName}</DialogTitle>
          <DialogDescription>
            {roleLabel(data.user.role)} · {data.store.name}
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-2">
          <Button
            className="h-12 justify-start rounded-xl lg:hidden"
            onClick={onEntries}
            variant="outline"
          >
            <History /> Histórico de entradas
          </Button>
          <Button
            className="h-12 justify-start rounded-xl lg:hidden"
            onClick={onSettings}
            variant="outline"
          >
            <Settings /> Ajustes e usuários
          </Button>
          <Button
            className="h-12 justify-start rounded-xl"
            onClick={onGuide}
            variant="outline"
          >
            <BookOpen /> Como usar e novidades
          </Button>
          <Button
            className="h-12 justify-start rounded-xl"
            onClick={onLogout}
            variant="outline"
          >
            <LogOut /> Sair do sistema
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function GuideDialog({
  open,
  required,
  onOpenChange,
  onAcknowledge,
}: {
  open: boolean;
  required: boolean;
  onOpenChange: (open: boolean) => void;
  onAcknowledge: () => Promise<void>;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  return (
    <Dialog
      onOpenChange={(nextOpen) => {
        if (!nextOpen && !required) setError('');
        onOpenChange(nextOpen);
      }}
      open={open}
    >
      <DialogContent
        className="flex max-h-[92dvh] max-w-2xl flex-col overflow-hidden"
        showCloseButton={!required}
      >
        <DialogHeader>
          <DialogTitle>Como usar o sistema</DialogTitle>
          <DialogDescription>
            {required
              ? 'Leitura obrigatória no primeiro acesso ou após uma atualização.'
              : 'Guia rápido e novidades desta versão.'}
          </DialogDescription>
        </DialogHeader>
        <div className="min-h-0 flex-1 space-y-3 overflow-y-auto pr-1 text-sm leading-6">
          <GuideStep number="1" title="Cadastre a base">
            Em Cadastros, gerencie clientes, produtos, preços, cores, memórias,
            UPCs, EANs, JANs e contas Pix. O catálogo padrão do sistema já traz
            o iPhone 16 (exceto o Pro Max) e toda a linha iPhone 17, com códigos
            verificados dos Estados Unidos e do Japão. Códigos de outros
            mercados podem ser acrescentados sem substituir seus preços. Em
            Ajustes, o proprietário gerencia os usuários da loja.
          </GuideStep>
          <GuideStep number="2" title="Dê entrada">
            Abra Entrada. Bipe o UPC/EAN, confirme o produto, bipe somente os
            SNs e fotografe o recebimento. O zero técnico do leitor e o prefixo
            S do SN são reconhecidos automaticamente. Um bip agudo confirma a
            leitura; dois bips graves avisam quando ela não pode ser usada.
          </GuideStep>
          <GuideStep number="3" title="Venda por etapas">
            Pesquise ou cadastre o cliente, bipe um ou mais SNs, adicione fotos,
            confira ou altere o preço e anexe ou pule o comprovante. A leitura
            do valor acontece automaticamente no próprio aparelho. Você pode
            salvar a venda enquanto ela continua; quando terminar, a venda é
            atualizada sem recarregar a página. Também é possível salvar sem
            informar pagamento e completar depois.
          </GuideStep>
          <GuideStep number="4" title="Diferenças de valor">
            O sistema permite receber acima ou abaixo do total dos produtos, mas
            compara visualmente Valor da venda e Total pago: azul quando são
            iguais, vermelho quando falta receber e violeta quando foi pago a
            mais. A conferência dos comprovantes aparece separadamente, em roxo,
            para não ser confundida com pagamento pendente. Alterar o preço de
            venda não gera aviso em comparação ao preço padrão.
          </GuideStep>
          <GuideStep number="5" title="Relatórios e histórico">
            O estoque abre somente com variações disponíveis. Nos detalhes,
            alterne entre SNs disponíveis e vendidos; um SN vendido abre sua
            venda. O relatório ignora estoque zerado. Em Vendas, o botão
            Relatório de vendas baixa o período filtrado nos formatos
            simplificado, detalhado ou completo, separa os resultados por dia e
            destaca o total diário; cada venda também mantém seu próprio PDF. O
            menu Histórico preserva cada entrada.
          </GuideStep>
          <GuideStep
            number="6"
            title="Pagamento, status e anexos depois da venda"
          >
            Em Vendas, toque em Editar para completar um pagamento pendente sem
            apagar os pagamentos anteriores, dividir o saldo em mais de uma
            forma, mudar o status do pedido, conferir comprovantes ou
            acrescentar fotos ao SN correto. Produtos e preços originais
            permanecem protegidos.
          </GuideStep>
          <GuideStep number="7" title="Usuários e lojas">
            Cada loja é isolada. O proprietário cria funcionários e senhas;
            criar conta na tela inicial abre uma nova loja.
          </GuideStep>
          <GuideStep number="8" title="Menu e comparações">
            No celular, toque no nome da loja para abrir o menu. Em Vendas, os
            indicadores compactos funcionam como filtros e comparam o resultado
            com o período anterior equivalente. Toque em Filtros para localizar
            vendas sem comprovante, com pagamento pendente ou por status.
          </GuideStep>
        </div>
        <DialogFooter>
          {error && (
            <p
              className="w-full rounded-xl bg-destructive/10 px-3 py-2 text-left text-sm font-semibold text-destructive"
              role="alert"
            >
              {error}
            </p>
          )}
          <Button
            className="h-11 rounded-xl"
            disabled={busy}
            onClick={async () => {
              setBusy(true);
              setError('');
              try {
                await onAcknowledge();
              } catch (caught) {
                setError(messageOf(caught));
              } finally {
                setBusy(false);
              }
            }}
          >
            {busy && <LoaderCircle className="animate-spin" />}
            {busy ? 'Confirmando…' : required ? 'Li e quero acessar' : 'Fechar'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function GuideStep({
  number,
  title,
  children,
}: {
  number: string;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section className="rounded-2xl border bg-muted/25 p-3">
      <div className="flex gap-3">
        <span className="grid size-8 shrink-0 place-items-center rounded-full bg-primary text-sm font-bold text-primary-foreground">
          {number}
        </span>
        <div>
          <h3 className="font-bold">{title}</h3>
          <p className="mt-0.5 text-muted-foreground">{children}</p>
        </div>
      </div>
    </section>
  );
}

function DesktopNavigation({
  active,
  onChange,
}: {
  active: View;
  onChange: (view: View) => void;
}) {
  return (
    <nav className="mt-8 space-y-1" aria-label="Navegação principal">
      {navigation.map(({ view, label, icon: Icon }) => (
        <button
          className={`flex min-h-11 w-full items-center gap-3 rounded-2xl px-4 text-left text-sm font-semibold transition ${active === view ? 'bg-primary text-primary-foreground shadow-lg shadow-primary/15' : 'text-muted-foreground hover:bg-muted hover:text-foreground'}`}
          key={view}
          onClick={() => onChange(view)}
          type="button"
        >
          <Icon className="size-[1.1rem]" />
          {label}
        </button>
      ))}
    </nav>
  );
}

function MobileNavigation({
  active,
  onChange,
  onOpenChange,
  open,
  storeCode,
  storeName,
}: {
  active: View;
  onChange: (view: View) => void;
  onOpenChange: (open: boolean) => void;
  open: boolean;
  storeCode: string;
  storeName: string;
}) {
  const selectView = (view: View) => {
    onOpenChange(false);
    onChange(view);
  };

  return (
    <Sheet onOpenChange={onOpenChange} open={open}>
      <SheetContent
        className="w-[min(88vw,23rem)] gap-0 overflow-hidden rounded-r-[2rem] p-0 lg:hidden"
        id="mobile-primary-navigation"
        side="left"
      >
        <SheetHeader className="border-b bg-muted/35 px-5 pb-5 pt-[max(1.25rem,env(safe-area-inset-top))]">
          <SheetTitle className="sr-only">Menu da loja</SheetTitle>
          <div className="pr-10">
            <Brand storeName={storeName} />
          </div>
          <SheetDescription>
            Loja {storeCode} · escolha onde deseja ir.
          </SheetDescription>
        </SheetHeader>
        <nav
          aria-label="Navegação principal"
          className="min-h-0 flex-1 overflow-y-auto p-3 pb-[max(1rem,env(safe-area-inset-bottom))]"
        >
          <div className="grid gap-2">
            {navigation.map(({ view, label, icon: Icon }) => {
              const selected = active === view;
              return (
                <button
                  aria-current={selected ? 'page' : undefined}
                  className={`group flex min-h-16 w-full items-center gap-3 rounded-2xl border px-3.5 text-left text-[0.9375rem] font-bold outline-none transition focus-visible:ring-2 focus-visible:ring-ring ${selected ? 'border-primary/20 bg-primary text-primary-foreground shadow-lg shadow-primary/15' : 'border-transparent bg-muted/35 text-foreground hover:border-border hover:bg-muted'}`}
                  key={view}
                  onClick={() => selectView(view)}
                  type="button"
                >
                  <span
                    className={`grid size-10 shrink-0 place-items-center rounded-xl ${selected ? 'bg-white/15' : 'bg-background text-primary shadow-sm'}`}
                  >
                    <Icon className="size-5" />
                  </span>
                  <span className="min-w-0 flex-1 truncate">{label}</span>
                  {selected && (
                    <span className="rounded-full bg-white/15 px-2 py-1 text-xs">
                      Atual
                    </span>
                  )}
                </button>
              );
            })}
          </div>
        </nav>
      </SheetContent>
    </Sheet>
  );
}

function Brand({
  compact = false,
  light = false,
  storeName,
}: {
  compact?: boolean;
  light?: boolean;
  storeName: string;
}) {
  return (
    <div className="flex min-w-0 items-center gap-2 sm:gap-3">
      <span
        className={`grid place-items-center rounded-xl ${light ? 'bg-white/12 text-white' : 'bg-primary text-primary-foreground'} ${compact ? 'size-9' : 'size-11'}`}
      >
        <Smartphone className={compact ? 'size-4' : 'size-5'} />
      </span>
      <div className="min-w-0">
        <p
          className={`truncate font-extrabold tracking-[-.04em] ${compact ? 'max-w-40 text-base' : 'text-lg'}`}
        >
          {storeName}
        </p>
        {!compact && (
          <p
            className={`text-xs ${light ? 'text-white/60' : 'text-muted-foreground'}`}
          >
            PDV e estoque por SN
          </p>
        )}
      </div>
    </div>
  );
}

function Field({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <label className="block text-sm font-semibold">
      <span className="mb-1 block">{label}</span>
      {children}
    </label>
  );
}

function LoadingScreen({ label }: { label: string }) {
  return (
    <main className="grid h-dvh place-items-center bg-background">
      <div className="text-center">
        <LoaderCircle className="mx-auto size-8 animate-spin text-primary" />
        <p className="mt-3 text-sm font-semibold text-muted-foreground">
          {label}
        </p>
      </div>
    </main>
  );
}

function FullPageMessage({
  title,
  detail,
  onRetry,
}: {
  title: string;
  detail: string;
  onRetry: () => void | Promise<void>;
}) {
  return (
    <main className="grid h-dvh place-items-center bg-muted/30 p-4">
      <Card className="max-w-md">
        <CardHeader>
          <CardTitle>{title}</CardTitle>
          <CardDescription>{detail}</CardDescription>
        </CardHeader>
        <CardContent>
          <Button className="w-full" onClick={() => void onRetry()}>
            Tentar novamente
          </Button>
        </CardContent>
      </Card>
    </main>
  );
}

async function logoutSession(csrfToken: string) {
  await requestJson('/api/auth/logout', {
    method: 'POST',
    headers: { 'x-csrf-token': csrfToken },
  });
  window.location.reload();
}

function roleLabel(role: BootstrapData['user']['role']) {
  return role === 'owner'
    ? 'Proprietário'
    : role === 'admin'
      ? 'Administrador'
      : 'Operador';
}

function firstName(name: string) {
  return name.trim().split(/\s+/)[0] || 'Perfil';
}
