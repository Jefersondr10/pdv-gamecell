'use client';

import { useState } from 'react';
import {
  ArrowDownToLine,
  ArrowRight,
  Building2,
  CircleUserRound,
  KeyRound,
  Plus,
  RotateCcw,
  ScanBarcode,
  Smartphone,
  UsersRound,
  WalletCards,
} from 'lucide-react';

import { Badge } from '@/components/ui/badge';
import { RecoveryCodesPanel } from '@/components/pdv/recovery-codes-panel';
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
  NativeSelect,
  NativeSelectOption,
} from '@/components/ui/native-select';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Textarea } from '@/components/ui/textarea';
import { messageOf, requestJson } from '@/lib/client-api';
import { parseMoneyInput } from '@/lib/money';
import type { BootstrapData, UserRecord } from '@/lib/pdv-types';

type Manager =
  | 'products'
  | 'clients'
  | 'pix'
  | 'users'
  | 'install'
  | 'recovery'
  | null;

export function SettingsProductionView({
  data,
  onChanged,
  installAvailable,
  installed,
  onInstall,
}: {
  data: BootstrapData;
  onChanged: () => Promise<void>;
  installAvailable: boolean;
  installed: boolean;
  onInstall: () => Promise<void>;
}) {
  const [manager, setManager] = useState<Manager>(null);
  const canManage = data.user.role === 'owner' || data.user.role === 'admin';
  return (
    <div className="flex h-full min-h-0 flex-col overflow-hidden px-3 py-3 sm:px-6 sm:py-5 lg:px-10">
      <div className="mb-3 shrink-0">
        <p className="eyebrow">Administração</p>
        <h1 className="mt-0.5 text-2xl font-bold tracking-[-.04em] sm:text-3xl">
          Configurações
        </h1>
        <p className="mt-1 hidden text-sm text-muted-foreground sm:block">
          Cadastros e acessos usados somente por {data.store.name}.
        </p>
      </div>
      <Tabs
        className="flex min-h-0 flex-1 flex-col overflow-hidden"
        defaultValue="products"
      >
        <TabsList className="mb-3 h-11 w-full shrink-0 justify-start overflow-x-auto rounded-xl bg-muted p-1 sm:w-fit">
          <TabsTrigger value="products">Produtos</TabsTrigger>
          <TabsTrigger value="people">Pessoas</TabsTrigger>
          <TabsTrigger value="finance">Financeiro</TabsTrigger>
          <TabsTrigger value="system">Sistema</TabsTrigger>
        </TabsList>
        <Tab value="products">
          <SettingsCard
            icon={Smartphone}
            title="Produtos, variações e preços"
            detail={`${data.products.length} ${data.products.length === 1 ? 'variação' : 'variações'}`}
            description="Modelo, cor, memória, preço padrão e códigos comerciais."
            disabled={!canManage}
            onManage={() => setManager('products')}
          />
          <SettingsCard
            icon={ScanBarcode}
            title="UPC, EAN e JAN"
            detail={`${data.products.reduce((sum, product) => sum + product.codes.length, 0)} códigos`}
            description="Vários códigos podem apontar para a mesma variação."
            disabled={!canManage}
            onManage={() => setManager('products')}
          />
        </Tab>
        <Tab value="people">
          <SettingsCard
            icon={UsersRound}
            title="Clientes"
            detail={`${data.clients.length} cadastrados`}
            description="Só aparecem na venda depois que o operador pesquisar."
            onManage={() => setManager('clients')}
          />
          <SettingsCard
            icon={CircleUserRound}
            title="Usuários da loja"
            detail={`${data.users.filter((user) => user.active).length} ativos`}
            description="Administrador cria usuário e senha para cada funcionário."
            disabled={!canManage}
            onManage={() => setManager('users')}
          />
        </Tab>
        <Tab value="finance">
          <SettingsCard
            icon={Building2}
            title="Contas Pix"
            detail={`${data.pixAccounts.filter((account) => account.active).length} ativas`}
            description="A conta escolhida fica registrada no pagamento."
            disabled={!canManage}
            onManage={() => setManager('pix')}
          />
          <SettingsCard
            icon={WalletCards}
            title="Formas de pagamento"
            detail="Pix e dinheiro"
            description="Dinheiro e Pix só aparecem quando adicionados pelo botão +."
            disabled
          />
        </Tab>
        <Tab value="system">
          {data.user.role === 'owner' && data.user.authKind === 'password' && (
            <SettingsCard
              icon={KeyRound}
              title="Recuperação da conta"
              detail="Códigos de segurança"
              description="Gere uma nova lista caso tenha perdido ou exposto seus códigos."
              onManage={() => setManager('recovery')}
            />
          )}
          <SettingsCard
            icon={ArrowDownToLine}
            title="Instalar aplicativo"
            detail={
              installed
                ? 'Aplicativo instalado'
                : installAvailable
                  ? 'Pronto para instalar'
                  : 'Disponível pelo navegador'
            }
            description="Use em tela cheia no celular ou computador."
            onManage={() => setManager('install')}
          />
          <SettingsCard
            icon={RotateCcw}
            title="Dados e auditoria"
            detail="Salvos na nuvem"
            description="Entradas, vendas, cancelamentos e operadores ficam preservados."
            disabled
          />
        </Tab>
      </Tabs>
      <ProductsDialog
        data={data}
        onChanged={onChanged}
        onOpenChange={(open) => !open && setManager(null)}
        open={manager === 'products'}
      />
      <ClientsDialog
        data={data}
        onChanged={onChanged}
        onOpenChange={(open) => !open && setManager(null)}
        open={manager === 'clients'}
      />
      <PixDialog
        data={data}
        onChanged={onChanged}
        onOpenChange={(open) => !open && setManager(null)}
        open={manager === 'pix'}
      />
      <UsersDialog
        data={data}
        onChanged={onChanged}
        onOpenChange={(open) => !open && setManager(null)}
        open={manager === 'users'}
      />
      <InstallDialog
        installed={installed}
        installAvailable={installAvailable}
        onInstall={onInstall}
        onOpenChange={(open) => !open && setManager(null)}
        open={manager === 'install'}
      />
      <RecoveryCodesDialog
        data={data}
        onOpenChange={(open) => !open && setManager(null)}
        open={manager === 'recovery'}
      />
    </div>
  );
}

function ProductsDialog({
  data,
  open,
  onOpenChange,
  onChanged,
}: CommonDialogProps) {
  const [showNew, setShowNew] = useState(data.products.length === 0);
  const [values, setValues] = useState({
    model: '',
    color: '',
    memory: '',
    codes: '',
    price: '',
  });
  const [selectedId, setSelectedId] = useState(data.products[0]?.id ?? '');
  const selected = data.products.find((product) => product.id === selectedId);
  const [price, setPrice] = useState(
    selected ? moneyInput(selected.defaultPriceCents) : '',
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const set = (key: keyof typeof values, value: string) =>
    setValues((current) => ({ ...current, [key]: value }));
  const refresh = async () => {
    await onChanged();
    setShowNew(false);
  };
  return (
    <Dialog onOpenChange={onOpenChange} open={open}>
      <DialogContent className="flex h-dvh max-h-dvh max-w-none flex-col overflow-hidden rounded-none p-0 sm:h-[90dvh] sm:max-w-2xl sm:rounded-2xl">
        <DialogHeader className="shrink-0 border-b px-4 py-4 pr-12">
          <DialogTitle>Produtos e preços</DialogTitle>
          <DialogDescription>
            Cadastre cada combinação de modelo, cor e memória e vincule seus
            UPCs/EANs.
          </DialogDescription>
        </DialogHeader>
        <div className="min-h-0 flex-1 overflow-y-auto p-4 overscroll-contain">
          {error && <ErrorBox>{error}</ErrorBox>}
          <div className="mb-3 flex items-center justify-between">
            <p className="font-bold">
              {data.products.length} variações cadastradas
            </p>
            <Button onClick={() => setShowNew((value) => !value)} size="sm">
              <Plus /> Novo produto
            </Button>
          </div>
          {showNew && (
            <form
              className="mb-4 grid gap-3 rounded-2xl border bg-muted/25 p-4 sm:grid-cols-2"
              onSubmit={async (event) => {
                event.preventDefault();
                setBusy(true);
                setError('');
                try {
                  await postJson('/api/products', data.csrfToken, {
                    model: values.model,
                    color: values.color,
                    memory: values.memory,
                    codes: values.codes
                      .split(/[\n,;]+/)
                      .map((code) => code.trim())
                      .filter(Boolean),
                    defaultPriceCents: parseMoneyInput(values.price),
                  });
                  setValues({
                    model: '',
                    color: '',
                    memory: '',
                    codes: '',
                    price: '',
                  });
                  await refresh();
                } catch (caught) {
                  setError(messageOf(caught));
                } finally {
                  setBusy(false);
                }
              }}
            >
              <Field label="Modelo">
                <Input
                  onChange={(event) => set('model', event.target.value)}
                  required
                  value={values.model}
                />
              </Field>
              <Field label="Cor">
                <Input
                  onChange={(event) => set('color', event.target.value)}
                  required
                  value={values.color}
                />
              </Field>
              <Field label="Memória">
                <Input
                  onChange={(event) => set('memory', event.target.value)}
                  placeholder="128 GB"
                  required
                  value={values.memory}
                />
              </Field>
              <Field label="Preço padrão">
                <MoneyInput
                  onChange={(value) => set('price', value)}
                  value={values.price}
                />
              </Field>
              <div className="sm:col-span-2">
                <Field label="UPC / EAN / JAN (um por linha ou separado por vírgula)">
                  <Textarea
                    onChange={(event) => set('codes', event.target.value)}
                    placeholder="195950638011"
                    required
                    value={values.codes}
                  />
                </Field>
              </div>
              <Button
                className="h-11 sm:col-span-2"
                disabled={busy}
                type="submit"
              >
                Salvar produto
              </Button>
            </form>
          )}
          {data.products.length ? (
            <>
              <label className="text-sm font-semibold">
                Alterar preço cadastrado
                <NativeSelect
                  className="mt-1 h-11 w-full [&_select]:h-11"
                  onChange={(event) => {
                    const product = data.products.find(
                      (item) => item.id === event.target.value,
                    );
                    setSelectedId(event.target.value);
                    setPrice(
                      product ? moneyInput(product.defaultPriceCents) : '',
                    );
                  }}
                  value={selectedId}
                >
                  {data.products.map((product) => (
                    <NativeSelectOption key={product.id} value={product.id}>
                      {product.model} · {product.detail}
                    </NativeSelectOption>
                  ))}
                </NativeSelect>
              </label>
              {selected && (
                <div className="mt-3 rounded-2xl border p-4">
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div>
                      <p className="font-bold">{selected.model}</p>
                      <p className="text-sm text-muted-foreground">
                        {selected.detail}
                      </p>
                    </div>
                    <Badge variant="secondary">
                      {selected.codes.length}{' '}
                      {selected.codes.length === 1 ? 'código' : 'códigos'}
                    </Badge>
                  </div>
                  <p className="mt-2 break-words font-mono text-xs text-muted-foreground">
                    {selected.codes
                      .map((code) => displayCode(code.code))
                      .join(' · ')}
                  </p>
                  <div className="mt-3 grid grid-cols-[1fr_auto] gap-2">
                    <MoneyInput onChange={setPrice} value={price} />
                    <Button
                      disabled={busy}
                      onClick={async () => {
                        setBusy(true);
                        setError('');
                        try {
                          await patchJson(
                            `/api/products/${selected.id}`,
                            data.csrfToken,
                            { defaultPriceCents: parseMoneyInput(price) },
                          );
                          await onChanged();
                        } catch (caught) {
                          setError(messageOf(caught));
                        } finally {
                          setBusy(false);
                        }
                      }}
                    >
                      Salvar preço
                    </Button>
                  </div>
                  <p className="mt-2 text-xs text-muted-foreground">
                    O preço preenche a venda automaticamente, mas continua
                    editável.
                  </p>
                </div>
              )}
            </>
          ) : (
            !showNew && <EmptyText>Nenhum produto cadastrado.</EmptyText>
          )}
        </div>
        <DialogFooter className="shrink-0 border-t p-3">
          <Button onClick={() => onOpenChange(false)} variant="outline">
            Fechar
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function ClientsDialog({
  data,
  open,
  onOpenChange,
  onChanged,
}: CommonDialogProps) {
  const [values, setValues] = useState({
    name: '',
    phone: '',
    email: '',
    notes: '',
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const set = (key: keyof typeof values, value: string) =>
    setValues((current) => ({ ...current, [key]: value }));
  return (
    <Dialog onOpenChange={onOpenChange} open={open}>
      <DialogContent className="flex max-h-[92dvh] max-w-xl flex-col overflow-hidden">
        <DialogHeader>
          <DialogTitle>Clientes</DialogTitle>
          <DialogDescription>
            Nenhum nome aparece na venda até o operador pesquisar.
          </DialogDescription>
        </DialogHeader>
        <div className="min-h-0 flex-1 overflow-y-auto pr-1">
          {error && <ErrorBox>{error}</ErrorBox>}
          <form
            className="grid gap-2 rounded-2xl border bg-muted/25 p-3 sm:grid-cols-2"
            onSubmit={async (event) => {
              event.preventDefault();
              setBusy(true);
              setError('');
              try {
                await postJson('/api/clients', data.csrfToken, values);
                setValues({ name: '', phone: '', email: '', notes: '' });
                await onChanged();
              } catch (caught) {
                setError(messageOf(caught));
              } finally {
                setBusy(false);
              }
            }}
          >
            <Field label="Nome">
              <Input
                onChange={(event) => set('name', event.target.value)}
                required
                value={values.name}
              />
            </Field>
            <Field label="Telefone (opcional)">
              <Input
                onChange={(event) => set('phone', event.target.value)}
                value={values.phone}
              />
            </Field>
            <Field label="E-mail (opcional)">
              <Input
                onChange={(event) => set('email', event.target.value)}
                type="email"
                value={values.email}
              />
            </Field>
            <div className="sm:col-span-2">
              <Field label="Observação (opcional)">
                <Textarea
                  onChange={(event) => set('notes', event.target.value)}
                  value={values.notes}
                />
              </Field>
            </div>
            <Button className="sm:col-span-2" disabled={busy} type="submit">
              <Plus /> Adicionar cliente
            </Button>
          </form>
          <div className="mt-3 divide-y rounded-2xl border">
            {data.clients.map((client) => (
              <div className="px-3 py-2" key={client.id}>
                <p className="font-bold">{client.name}</p>
                <p className="text-xs text-muted-foreground">
                  {[client.phone, client.email].filter(Boolean).join(' · ') ||
                    'Sem contato informado'}
                </p>
              </div>
            ))}
            {data.clients.length === 0 && (
              <EmptyText>Nenhum cliente cadastrado.</EmptyText>
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function PixDialog({ data, open, onOpenChange, onChanged }: CommonDialogProps) {
  const [name, setName] = useState('');
  const [details, setDetails] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  return (
    <Dialog onOpenChange={onOpenChange} open={open}>
      <DialogContent className="max-w-xl">
        <DialogHeader>
          <DialogTitle>Contas Pix</DialogTitle>
          <DialogDescription>
            Cadastre as contas que podem receber pagamentos.
          </DialogDescription>
        </DialogHeader>
        {error && <ErrorBox>{error}</ErrorBox>}
        <form
          className="grid gap-2 sm:grid-cols-[1fr_1fr_auto]"
          onSubmit={async (event) => {
            event.preventDefault();
            setBusy(true);
            setError('');
            try {
              await postJson('/api/pix-accounts', data.csrfToken, {
                name,
                details,
              });
              setName('');
              setDetails('');
              await onChanged();
            } catch (caught) {
              setError(messageOf(caught));
            } finally {
              setBusy(false);
            }
          }}
        >
          <Field label="Nome">
            <Input
              onChange={(event) => setName(event.target.value)}
              placeholder="Nubank principal"
              required
              value={name}
            />
          </Field>
          <Field label="Detalhes (opcional)">
            <Input
              onChange={(event) => setDetails(event.target.value)}
              placeholder="Titular ou final"
              value={details}
            />
          </Field>
          <Button className="mt-auto h-10" disabled={busy} type="submit">
            <Plus /> Adicionar
          </Button>
        </form>
        <div className="max-h-64 overflow-y-auto divide-y rounded-2xl border">
          {data.pixAccounts.map((account) => (
            <div
              className="flex items-center justify-between px-3 py-2"
              key={account.id}
            >
              <div>
                <p className="font-bold">{account.name}</p>
                <p className="text-xs text-muted-foreground">
                  {account.details || 'Sem detalhes'}
                </p>
              </div>
              <Badge className="bg-success/10 text-success hover:bg-success/10">
                Ativa
              </Badge>
            </div>
          ))}
          {data.pixAccounts.length === 0 && (
            <EmptyText>Nenhuma conta Pix cadastrada.</EmptyText>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

function UsersDialog({
  data,
  open,
  onOpenChange,
  onChanged,
}: CommonDialogProps) {
  const [showNew, setShowNew] = useState(false);
  const [values, setValues] = useState({
    displayName: '',
    username: '',
    password: '',
    role: 'operator',
  });
  const [resetTarget, setResetTarget] = useState<UserRecord | null>(null);
  const [resetPassword, setResetPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const set = (key: keyof typeof values, value: string) =>
    setValues((current) => ({ ...current, [key]: value }));
  return (
    <Dialog onOpenChange={onOpenChange} open={open}>
      <DialogContent className="flex h-dvh max-h-dvh max-w-none flex-col overflow-hidden rounded-none p-0 sm:h-[90dvh] sm:max-w-2xl sm:rounded-2xl">
        <DialogHeader className="shrink-0 border-b px-4 py-4 pr-12">
          <DialogTitle>Usuários da loja</DialogTitle>
          <DialogDescription>
            Somente administradores criam e controlam o acesso dos funcionários.
          </DialogDescription>
        </DialogHeader>
        <div className="min-h-0 flex-1 overflow-y-auto p-4 overscroll-contain">
          {error && <ErrorBox>{error}</ErrorBox>}
          <div className="mb-3 flex items-center justify-between">
            <p className="font-bold">
              Código da loja: <code>{data.store.code}</code>
            </p>
            <Button onClick={() => setShowNew((value) => !value)} size="sm">
              <Plus /> Novo usuário
            </Button>
          </div>
          {showNew && (
            <form
              className="mb-4 grid gap-3 rounded-2xl border bg-muted/25 p-4 sm:grid-cols-2"
              onSubmit={async (event) => {
                event.preventDefault();
                setBusy(true);
                setError('');
                try {
                  await postJson('/api/users', data.csrfToken, values);
                  setValues({
                    displayName: '',
                    username: '',
                    password: '',
                    role: 'operator',
                  });
                  setShowNew(false);
                  await onChanged();
                } catch (caught) {
                  setError(messageOf(caught));
                } finally {
                  setBusy(false);
                }
              }}
            >
              <Field label="Nome">
                <Input
                  onChange={(event) => set('displayName', event.target.value)}
                  required
                  value={values.displayName}
                />
              </Field>
              <Field label="Usuário">
                <Input
                  autoCapitalize="none"
                  onChange={(event) => set('username', event.target.value)}
                  required
                  value={values.username}
                />
              </Field>
              <Field label="Senha inicial">
                <Input
                  minLength={10}
                  onChange={(event) => set('password', event.target.value)}
                  required
                  type="password"
                  value={values.password}
                />
              </Field>
              <Field label="Função">
                <NativeSelect
                  className="h-10 w-full [&_select]:h-10"
                  onChange={(event) => set('role', event.target.value)}
                  value={values.role}
                >
                  <NativeSelectOption value="operator">
                    Operador
                  </NativeSelectOption>
                  {data.user.role === 'owner' && (
                    <NativeSelectOption value="admin">
                      Administrador
                    </NativeSelectOption>
                  )}
                </NativeSelect>
              </Field>
              <p className="text-xs text-muted-foreground sm:col-span-2">
                No primeiro acesso, o funcionário será obrigado a trocar esta
                senha.
              </p>
              <Button className="sm:col-span-2" disabled={busy} type="submit">
                Criar usuário
              </Button>
            </form>
          )}
          <div className="divide-y rounded-2xl border">
            {data.users.map((user) => (
              <div
                className="grid grid-cols-[1fr_auto] items-center gap-3 px-3 py-3"
                key={user.id}
              >
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <p className="truncate font-bold">{user.displayName}</p>
                    {user.id === data.user.id && (
                      <Badge variant="secondary">Você</Badge>
                    )}
                  </div>
                  <p className="truncate text-xs text-muted-foreground">
                    {user.authKind === 'google'
                      ? user.email
                      : `${data.store.code} / ${user.username}`}{' '}
                    · {roleLabel(user.role)}
                  </p>
                </div>
                {user.id !== data.user.id && user.role !== 'owner' && (
                  <div className="flex gap-1">
                    {user.authKind === 'password' && (
                      <Button
                        aria-label="Redefinir senha"
                        onClick={() => setResetTarget(user)}
                        size="icon"
                        variant="ghost"
                      >
                        <KeyRound />
                      </Button>
                    )}
                    <Button
                      onClick={async () => {
                        setBusy(true);
                        setError('');
                        try {
                          await patchJson(
                            `/api/users/${user.id}`,
                            data.csrfToken,
                            { active: !user.active },
                          );
                          await onChanged();
                        } catch (caught) {
                          setError(messageOf(caught));
                        } finally {
                          setBusy(false);
                        }
                      }}
                      size="sm"
                      variant={user.active ? 'outline' : 'secondary'}
                    >
                      {user.active ? 'Desativar' : 'Ativar'}
                    </Button>
                  </div>
                )}
              </div>
            ))}
          </div>
          {resetTarget && (
            <div className="mt-4 rounded-2xl border border-amber-300 bg-amber-50 p-4 text-amber-950">
              <p className="font-bold">
                Nova senha para {resetTarget.displayName}
              </p>
              <Input
                className="mt-2 bg-white"
                minLength={10}
                onChange={(event) => setResetPassword(event.target.value)}
                placeholder="Senha com letras e números"
                type="password"
                value={resetPassword}
              />
              <div className="mt-2 flex justify-end gap-2">
                <Button
                  onClick={() => {
                    setResetTarget(null);
                    setResetPassword('');
                  }}
                  size="sm"
                  variant="ghost"
                >
                  Cancelar
                </Button>
                <Button
                  disabled={resetPassword.length < 10 || busy}
                  onClick={async () => {
                    setBusy(true);
                    setError('');
                    try {
                      await patchJson(
                        `/api/users/${resetTarget.id}`,
                        data.csrfToken,
                        { password: resetPassword },
                      );
                      setResetTarget(null);
                      setResetPassword('');
                      await onChanged();
                    } catch (caught) {
                      setError(messageOf(caught));
                    } finally {
                      setBusy(false);
                    }
                  }}
                  size="sm"
                >
                  Redefinir
                </Button>
              </div>
            </div>
          )}
        </div>
        <DialogFooter className="shrink-0 border-t p-3">
          <Button onClick={() => onOpenChange(false)} variant="outline">
            Fechar
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function RecoveryCodesDialog({
  data,
  open,
  onOpenChange,
}: {
  data: BootstrapData;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const [currentPassword, setCurrentPassword] = useState('');
  const [codes, setCodes] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const close = () => {
    setCurrentPassword('');
    setCodes([]);
    setError('');
    onOpenChange(false);
  };
  return (
    <Dialog onOpenChange={(next) => !next && close()} open={open}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>Códigos de recuperação</DialogTitle>
          <DialogDescription>
            A nova lista substitui imediatamente todos os códigos anteriores.
          </DialogDescription>
        </DialogHeader>
        {codes.length ? (
          <RecoveryCodesPanel
            codes={codes}
            compact
            continueLabel="Concluir e fechar"
            onContinue={close}
          />
        ) : (
          <form
            className="space-y-3"
            onSubmit={async (event) => {
              event.preventDefault();
              setBusy(true);
              setError('');
              try {
                const result = await requestJson<{ recoveryCodes: string[] }>(
                  '/api/me/recovery-codes',
                  {
                    method: 'POST',
                    headers: {
                      'content-type': 'application/json',
                      'x-csrf-token': data.csrfToken,
                    },
                    body: JSON.stringify({ currentPassword }),
                  },
                );
                setCodes(result.recoveryCodes);
                setCurrentPassword('');
              } catch (caught) {
                setError(messageOf(caught));
              } finally {
                setBusy(false);
              }
            }}
          >
            {error && <ErrorBox>{error}</ErrorBox>}
            <Field label="Confirme sua senha atual">
              <Input
                autoComplete="current-password"
                onChange={(event) => setCurrentPassword(event.target.value)}
                required
                type="password"
                value={currentPassword}
              />
            </Field>
            <Button className="h-11 w-full" disabled={busy} type="submit">
              <KeyRound /> Gerar nova lista
            </Button>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}

function InstallDialog({
  open,
  onOpenChange,
  installAvailable,
  installed,
  onInstall,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  installAvailable: boolean;
  installed: boolean;
  onInstall: () => Promise<void>;
}) {
  return (
    <Dialog onOpenChange={onOpenChange} open={open}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Instalar aplicativo</DialogTitle>
          <DialogDescription>
            O mesmo sistema pode ficar na tela inicial e abrir em tela cheia.
          </DialogDescription>
        </DialogHeader>
        {installed ? (
          <p className="rounded-xl bg-success/10 p-4 font-semibold text-success">
            Este dispositivo já abriu o sistema como aplicativo.
          </p>
        ) : installAvailable ? (
          <Button className="h-12 rounded-xl" onClick={() => void onInstall()}>
            <ArrowDownToLine /> Instalar agora
          </Button>
        ) : (
          <div className="space-y-2 text-sm text-muted-foreground">
            <p>
              <strong className="text-foreground">iPhone/iPad:</strong> abra no
              Safari, toque em Compartilhar e em Adicionar à Tela de Início.
            </p>
            <p>
              <strong className="text-foreground">Android:</strong> abra no
              Chrome, toque no menu e em Instalar aplicativo.
            </p>
            <p>
              <strong className="text-foreground">Computador:</strong> use o
              ícone de instalação na barra do Chrome ou Edge.
            </p>
            <p>
              O navegador interno pode não exibir a instalação; abra o endereço
              no navegador do aparelho.
            </p>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

type CommonDialogProps = {
  data: BootstrapData;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onChanged: () => Promise<void>;
};
function SettingsCard({
  icon: Icon,
  title,
  detail,
  description,
  onManage,
  disabled = false,
}: {
  icon: typeof Smartphone;
  title: string;
  detail: string;
  description: string;
  onManage?: () => void;
  disabled?: boolean;
}) {
  return (
    <Card>
      <CardHeader className="p-4">
        <span className="mb-2 grid size-10 place-items-center rounded-xl bg-secondary text-primary">
          <Icon className="size-5" />
        </span>
        <CardTitle className="text-base">{title}</CardTitle>
        <CardDescription>{description}</CardDescription>
      </CardHeader>
      <CardContent className="flex items-center justify-between border-t p-4">
        <span className="text-sm font-semibold text-muted-foreground">
          {detail}
        </span>
        <Button
          disabled={disabled}
          onClick={onManage}
          size="sm"
          variant="ghost"
        >
          Gerenciar <ArrowRight />
        </Button>
      </CardContent>
    </Card>
  );
}
function Tab({
  value,
  children,
}: {
  value: string;
  children: React.ReactNode;
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
function MoneyInput({
  value,
  onChange,
}: {
  value: string;
  onChange: (value: string) => void;
}) {
  return (
    <div className="relative">
      <span className="absolute left-3 top-1/2 -translate-y-1/2 font-bold text-muted-foreground">
        R$
      </span>
      <Input
        className="pl-10 text-right font-bold"
        inputMode="decimal"
        onChange={(event) => onChange(event.target.value)}
        placeholder="0,00"
        value={value}
      />
    </div>
  );
}
function ErrorBox({ children }: { children: React.ReactNode }) {
  return (
    <p
      className="mb-3 rounded-xl bg-destructive/10 p-3 text-sm font-semibold text-destructive"
      role="alert"
    >
      {children}
    </p>
  );
}
function EmptyText({ children }: { children: React.ReactNode }) {
  return (
    <p className="p-4 text-center text-sm text-muted-foreground">{children}</p>
  );
}
async function postJson(url: string, csrfToken: string, payload: unknown) {
  return requestJson(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-csrf-token': csrfToken },
    body: JSON.stringify(payload),
  });
}
async function patchJson(url: string, csrfToken: string, payload: unknown) {
  return requestJson(url, {
    method: 'PATCH',
    headers: { 'content-type': 'application/json', 'x-csrf-token': csrfToken },
    body: JSON.stringify(payload),
  });
}
function moneyInput(cents: number) {
  return (cents / 100).toLocaleString('pt-BR', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}
function displayCode(code: string) {
  return code.replace(/^0+(?=\d)/, '');
}
function roleLabel(role: UserRecord['role']) {
  return role === 'owner'
    ? 'Proprietário'
    : role === 'admin'
      ? 'Administrador'
      : 'Operador';
}
