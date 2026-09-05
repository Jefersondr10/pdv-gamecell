'use client';

import { useMemo, useState } from 'react';
import {
  Barcode,
  Pencil,
  Plus,
  RotateCcw,
  Search,
  Smartphone,
  Trash2,
  UserRound,
  WalletCards,
} from 'lucide-react';

import { ProductColorSwatch } from '@/components/pdv/product-color-swatch';
import {
  APPLE_COLOR_SUGGESTIONS,
  PRODUCT_MARKET_OPTIONS,
  appleMemoryOptions,
} from '@/components/pdv/product-options';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import {
  Dialog,
  DialogContent,
  DialogDescription,
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
import { displayCommercialCode } from '@/lib/commercial-code';
import { parseMoneyInput } from '@/lib/money';
import type {
  BootstrapData,
  ClientRecord,
  PixAccountRecord,
  ProductRecord,
} from '@/lib/pdv-types';

export function CatalogProductionView({
  data,
  onChanged,
}: {
  data: BootstrapData;
  onChanged: () => Promise<void>;
}) {
  const canManage = data.user.role === 'owner' || data.user.role === 'admin';
  return (
    <div className="flex h-full min-h-0 flex-col overflow-hidden px-3 py-3 lg:px-10 lg:py-5">
      <header className="mb-3 shrink-0">
        <p className="eyebrow">Gestão da loja</p>
        <h1 className="mt-0.5 text-2xl font-bold tracking-[-.04em] lg:text-3xl">
          Cadastros
        </h1>
        <p className="mt-1 hidden text-sm text-muted-foreground lg:block">
          Consulte e gerencie clientes, produtos e contas de pagamento.
        </p>
      </header>
      <Tabs
        className="flex min-h-0 flex-1 flex-col overflow-hidden"
        defaultValue="clients"
      >
        <TabsList className="mb-3 grid h-12 w-full shrink-0 grid-cols-3 rounded-xl bg-muted p-1 lg:w-fit lg:min-w-[34rem]">
          <TabsTrigger value="clients">
            <UserRound /> Clientes
          </TabsTrigger>
          <TabsTrigger value="products">
            <Smartphone /> Produtos
          </TabsTrigger>
          <TabsTrigger value="accounts">
            <WalletCards /> Contas
          </TabsTrigger>
        </TabsList>
        <TabsContent className="min-h-0 flex-1 overflow-hidden" value="clients">
          <ClientsManager
            canManage={canManage}
            csrfToken={data.csrfToken}
            items={data.clients}
            onChanged={onChanged}
          />
        </TabsContent>
        <TabsContent
          className="min-h-0 flex-1 overflow-hidden"
          value="products"
        >
          <ProductsManager
            canManage={canManage}
            csrfToken={data.csrfToken}
            items={data.products}
            onChanged={onChanged}
          />
        </TabsContent>
        <TabsContent
          className="min-h-0 flex-1 overflow-hidden"
          value="accounts"
        >
          <AccountsManager
            canManage={canManage}
            csrfToken={data.csrfToken}
            items={data.pixAccounts}
            onChanged={onChanged}
          />
        </TabsContent>
      </Tabs>
    </div>
  );
}

function ClientsManager({
  items,
  csrfToken,
  canManage,
  onChanged,
}: {
  items: ClientRecord[];
  csrfToken: string;
  canManage: boolean;
  onChanged: () => Promise<void>;
}) {
  const [query, setQuery] = useState('');
  const [status, setStatus] = useState('all');
  const [editingId, setEditingId] = useState<string | null>(null);
  const filtered = useMemo(() => {
    const term = normalizeSearch(query);
    return items.filter((item) => {
      if (status === 'active' && !item.active) return false;
      if (status === 'inactive' && item.active) return false;
      return (
        !term ||
        normalizeSearch(
          [item.name, item.phone, item.email, item.notes]
            .filter(Boolean)
            .join(' '),
        ).includes(term)
      );
    });
  }, [items, query, status]);
  const selected = items.find((item) => item.id === editingId) ?? null;
  return (
    <ManagerShell
      action={
        <Button
          className="h-11 rounded-xl"
          disabled={!canManage}
          onClick={() => setEditingId('new')}
        >
          <Plus /> Novo cliente
        </Button>
      }
      filters={
        <>
          <SearchInput
            label="Pesquisar clientes"
            onChange={setQuery}
            placeholder="Nome, telefone ou e-mail"
            value={query}
          />
          <NativeSelect
            aria-label="Filtrar clientes por situação"
            className="h-11 w-32 shrink-0 [&_select]:h-11"
            onChange={(event) => setStatus(event.target.value)}
            value={status}
          >
            <NativeSelectOption value="all">Todos</NativeSelectOption>
            <NativeSelectOption value="active">Ativos</NativeSelectOption>
            <NativeSelectOption value="inactive">Excluídos</NativeSelectOption>
          </NativeSelect>
        </>
      }
      summary={`${filtered.length} de ${items.length} clientes`}
    >
      {filtered.map((client) => (
        <article
          className={`grid grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-3 rounded-2xl border bg-card p-3 ${client.active ? '' : 'opacity-65'}`}
          key={client.id}
        >
          <span className="grid size-10 place-items-center rounded-full bg-secondary text-primary">
            <UserRound className="size-5" />
          </span>
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <p className="truncate font-bold">{client.name}</p>
              <StatusBadge active={client.active} />
            </div>
            <p className="truncate text-xs text-muted-foreground">
              {[client.phone, client.email].filter(Boolean).join(' · ') ||
                'Sem contato informado'}
            </p>
          </div>
          {canManage && (
            <Button
              aria-label={`Editar ${client.name}`}
              className="size-10 rounded-xl"
              onClick={() => setEditingId(client.id)}
              size="icon"
              variant="outline"
            >
              <Pencil />
            </Button>
          )}
        </article>
      ))}
      {filtered.length === 0 && (
        <EmptyState
          icon={UserRound}
          text={
            items.length
              ? 'Nenhum cliente encontrado.'
              : 'Nenhum cliente cadastrado.'
          }
        />
      )}
      {editingId && (
        <ClientEditor
          client={editingId === 'new' ? null : selected}
          csrfToken={csrfToken}
          key={editingId}
          onChanged={onChanged}
          onClose={() => setEditingId(null)}
        />
      )}
    </ManagerShell>
  );
}

function ProductsManager({
  items,
  csrfToken,
  canManage,
  onChanged,
}: {
  items: ProductRecord[];
  csrfToken: string;
  canManage: boolean;
  onChanged: () => Promise<void>;
}) {
  const [query, setQuery] = useState('');
  const [status, setStatus] = useState('all');
  const [editingId, setEditingId] = useState<string | null>(null);
  const filtered = useMemo(() => {
    const term = normalizeSearch(query);
    return items.filter((item) => {
      if (status === 'active' && !item.active) return false;
      if (status === 'inactive' && item.active) return false;
      return (
        !term ||
        normalizeSearch(
          `${item.model} ${item.color} ${item.memory} ${item.codes
            .map(({ code, kind }) => displayCommercialCode(code, kind))
            .join(' ')}`,
        ).includes(term)
      );
    });
  }, [items, query, status]);
  const selected = items.find((item) => item.id === editingId) ?? null;
  return (
    <ManagerShell
      action={
        <Button
          className="h-11 rounded-xl"
          disabled={!canManage}
          onClick={() => setEditingId('new')}
        >
          <Plus /> Novo produto
        </Button>
      }
      filters={
        <>
          <SearchInput
            label="Pesquisar produtos"
            onChange={setQuery}
            placeholder="Modelo, cor, memória ou UPC"
            value={query}
          />
          <NativeSelect
            aria-label="Filtrar produtos por situação"
            className="h-11 w-32 shrink-0 [&_select]:h-11"
            onChange={(event) => setStatus(event.target.value)}
            value={status}
          >
            <NativeSelectOption value="all">Todos</NativeSelectOption>
            <NativeSelectOption value="active">Ativos</NativeSelectOption>
            <NativeSelectOption value="inactive">Excluídos</NativeSelectOption>
          </NativeSelect>
        </>
      }
      summary={`${filtered.length} de ${items.length} produtos`}
    >
      {filtered.map((product) => (
        <article
          className={`rounded-2xl border bg-card p-3 ${product.active ? '' : 'opacity-65'}`}
          key={product.id}
        >
          <div className="grid grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-3">
            <span className="grid size-11 place-items-center rounded-2xl bg-secondary">
              <ProductColorSwatch className="size-6" color={product.color} />
            </span>
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <p className="truncate font-bold">{product.model}</p>
                <StatusBadge active={product.active} />
              </div>
              <p className="flex items-center gap-1.5 truncate text-xs text-muted-foreground">
                <ProductColorSwatch color={product.color} />
                {product.detail} · {formatMoney(product.defaultPriceCents)}
              </p>
            </div>
            {canManage && (
              <Button
                aria-label={`Editar ${product.model} ${product.detail}`}
                className="size-10 rounded-xl"
                onClick={() => setEditingId(product.id)}
                size="icon"
                variant="outline"
              >
                <Pencil />
              </Button>
            )}
          </div>
          <div className="mt-2 flex flex-wrap gap-1.5">
            {product.codes.map((code) => (
              <Badge className="font-mono" key={code.id} variant="secondary">
                {code.kind} {displayCommercialCode(code.code, code.kind)}
              </Badge>
            ))}
          </div>
        </article>
      ))}
      {filtered.length === 0 && (
        <EmptyState
          icon={Smartphone}
          text={
            items.length
              ? 'Nenhum produto encontrado.'
              : 'Nenhum produto cadastrado.'
          }
        />
      )}
      {editingId && (
        <ProductEditor
          csrfToken={csrfToken}
          key={editingId}
          onChanged={onChanged}
          onClose={() => setEditingId(null)}
          product={editingId === 'new' ? null : selected}
        />
      )}
    </ManagerShell>
  );
}

function AccountsManager({
  items,
  csrfToken,
  canManage,
  onChanged,
}: {
  items: PixAccountRecord[];
  csrfToken: string;
  canManage: boolean;
  onChanged: () => Promise<void>;
}) {
  const [query, setQuery] = useState('');
  const [status, setStatus] = useState('all');
  const [editingId, setEditingId] = useState<string | null>(null);
  const filtered = useMemo(() => {
    const term = normalizeSearch(query);
    return items.filter((item) => {
      if (status === 'active' && !item.active) return false;
      if (status === 'inactive' && item.active) return false;
      return (
        !term ||
        normalizeSearch(`${item.name} ${item.details ?? ''}`).includes(term)
      );
    });
  }, [items, query, status]);
  const selected = items.find((item) => item.id === editingId) ?? null;
  return (
    <ManagerShell
      action={
        <Button
          className="h-11 rounded-xl"
          disabled={!canManage}
          onClick={() => setEditingId('new')}
        >
          <Plus /> Nova conta
        </Button>
      }
      filters={
        <>
          <SearchInput
            label="Pesquisar contas"
            onChange={setQuery}
            placeholder="Nome ou detalhes da conta"
            value={query}
          />
          <NativeSelect
            aria-label="Filtrar contas por situação"
            className="h-11 w-32 shrink-0 [&_select]:h-11"
            onChange={(event) => setStatus(event.target.value)}
            value={status}
          >
            <NativeSelectOption value="all">Todas</NativeSelectOption>
            <NativeSelectOption value="active">Ativas</NativeSelectOption>
            <NativeSelectOption value="inactive">Excluídas</NativeSelectOption>
          </NativeSelect>
        </>
      }
      summary={`${filtered.length} de ${items.length} contas`}
    >
      {filtered.map((account) => (
        <article
          className={`grid grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-3 rounded-2xl border bg-card p-3 ${account.active ? '' : 'opacity-65'}`}
          key={account.id}
        >
          <span className="grid size-10 place-items-center rounded-full bg-secondary text-primary">
            <WalletCards className="size-5" />
          </span>
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <p className="truncate font-bold">{account.name}</p>
              <StatusBadge active={account.active} />
            </div>
            <p className="truncate text-xs text-muted-foreground">
              {account.details || 'Sem detalhes informados'}
            </p>
          </div>
          {canManage && (
            <Button
              aria-label={`Editar ${account.name}`}
              className="size-10 rounded-xl"
              onClick={() => setEditingId(account.id)}
              size="icon"
              variant="outline"
            >
              <Pencil />
            </Button>
          )}
        </article>
      ))}
      {filtered.length === 0 && (
        <EmptyState
          icon={WalletCards}
          text={
            items.length
              ? 'Nenhuma conta encontrada.'
              : 'Nenhuma conta cadastrada.'
          }
        />
      )}
      {editingId && (
        <AccountEditor
          account={editingId === 'new' ? null : selected}
          csrfToken={csrfToken}
          key={editingId}
          onChanged={onChanged}
          onClose={() => setEditingId(null)}
        />
      )}
    </ManagerShell>
  );
}

function ClientEditor({
  client,
  csrfToken,
  onChanged,
  onClose,
}: {
  client: ClientRecord | null;
  csrfToken: string;
  onChanged: () => Promise<void>;
  onClose: () => void;
}) {
  const [values, setValues] = useState({
    name: client?.name ?? '',
    phone: client?.phone ?? '',
    email: client?.email ?? '',
    notes: client?.notes ?? '',
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const set = (key: keyof typeof values, value: string) =>
    setValues((current) => ({ ...current, [key]: value }));
  const toggleActive = async (active: boolean) => {
    if (!client) return;
    await runAction(setBusy, setError, async () => {
      await patchJson(`/api/clients/${client.id}`, csrfToken, { active });
      await onChanged();
      onClose();
    });
  };
  return (
    <EditorDialog
      description={
        client
          ? 'Altere os dados usados nas próximas vendas.'
          : 'Cadastre os dados básicos do cliente.'
      }
      onClose={onClose}
      title={client ? 'Editar cliente' : 'Novo cliente'}
    >
      {error && <ErrorBox>{error}</ErrorBox>}
      <form
        className="grid gap-3 sm:grid-cols-2"
        onSubmit={(event) => {
          event.preventDefault();
          void runAction(setBusy, setError, async () => {
            if (client) {
              await patchJson(`/api/clients/${client.id}`, csrfToken, values);
            } else {
              await postJson('/api/clients', csrfToken, values);
            }
            await onChanged();
            onClose();
          });
        }}
      >
        <Field label="Nome">
          <Input
            className="h-11"
            onChange={(event) => set('name', event.target.value)}
            required
            value={values.name}
          />
        </Field>
        <Field label="Telefone (opcional)">
          <Input
            className="h-11"
            inputMode="tel"
            onChange={(event) => set('phone', event.target.value)}
            value={values.phone}
          />
        </Field>
        <Field label="E-mail (opcional)">
          <Input
            className="h-11"
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
        <Button
          className="h-12 rounded-xl sm:col-span-2"
          disabled={busy}
          type="submit"
        >
          Salvar cliente
        </Button>
      </form>
      {client && (
        <RecordStatusControl
          active={client.active}
          busy={busy}
          label="cliente"
          onToggle={toggleActive}
        />
      )}
    </EditorDialog>
  );
}

function ProductEditor({
  product,
  csrfToken,
  onChanged,
  onClose,
}: {
  product: ProductRecord | null;
  csrfToken: string;
  onChanged: () => Promise<void>;
  onClose: () => void;
}) {
  const [values, setValues] = useState({
    model: product?.model ?? '',
    color: product?.color ?? '',
    memory: product?.memory ?? '128 GB',
    price: product ? moneyInput(product.defaultPriceCents) : '',
    codes: '',
  });
  const [newCode, setNewCode] = useState('');
  const [newCodeMarket, setNewCodeMarket] = useState('');
  const [removeCodeId, setRemoveCodeId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const set = (key: keyof typeof values, value: string) =>
    setValues((current) => ({ ...current, [key]: value }));
  const toggleActive = async (active: boolean) => {
    if (!product) return;
    await runAction(setBusy, setError, async () => {
      await patchJson(`/api/products/${product.id}`, csrfToken, { active });
      await onChanged();
      onClose();
    });
  };
  return (
    <EditorDialog
      description={
        product
          ? 'Edite a variação, o preço e os códigos reconhecidos pelo leitor.'
          : 'Cadastre uma variação com pelo menos um UPC ou EAN.'
      }
      onClose={onClose}
      title={product ? 'Editar produto' : 'Novo produto'}
      wide
    >
      {error && <ErrorBox>{error}</ErrorBox>}
      <form
        className="grid gap-3 sm:grid-cols-2"
        onSubmit={(event) => {
          event.preventDefault();
          void runAction(setBusy, setError, async () => {
            const payload = {
              model: values.model,
              color: values.color,
              memory: values.memory,
              defaultPriceCents: parseMoneyInput(values.price),
            };
            if (product) {
              await patchJson(
                `/api/products/${product.id}`,
                csrfToken,
                payload,
              );
            } else {
              await postJson('/api/products', csrfToken, {
                ...payload,
                codes: splitCodes(values.codes),
              });
            }
            await onChanged();
            onClose();
          });
        }}
      >
        <Field label="Modelo">
          <Input
            className="h-11"
            onChange={(event) => set('model', event.target.value)}
            required
            value={values.model}
          />
        </Field>
        <Field label="Cor">
          <div className="relative">
            <ProductColorSwatch
              className="absolute left-3 top-1/2 z-10 size-5 -translate-y-1/2"
              color={values.color || 'Sem cor'}
            />
            <Input
              className="h-11 pl-11"
              list="apple-product-colors"
              onChange={(event) => set('color', event.target.value)}
              required
              value={values.color}
            />
            <datalist id="apple-product-colors">
              {APPLE_COLOR_SUGGESTIONS.map((color) => (
                <option key={color} value={color}>
                  {color}
                </option>
              ))}
            </datalist>
          </div>
        </Field>
        <Field label="Memória">
          <NativeSelect
            className="h-11 w-full [&_select]:h-11"
            onChange={(event) => set('memory', event.target.value)}
            value={values.memory}
          >
            {appleMemoryOptions(product?.memory).map((memory) => (
              <NativeSelectOption key={memory} value={memory}>
                {memory}
              </NativeSelectOption>
            ))}
          </NativeSelect>
        </Field>
        <Field label="Preço padrão">
          <MoneyInput
            onChange={(value) => set('price', value)}
            value={values.price}
          />
        </Field>
        {!product && (
          <div className="sm:col-span-2">
            <Field label="UPC / EAN (um por linha ou separado por vírgula)">
              <Textarea
                inputMode="numeric"
                onChange={(event) => set('codes', event.target.value)}
                placeholder="Digite os 12 números impressos na caixa"
                required
                value={values.codes}
              />
            </Field>
            <p className="mt-1 text-xs text-muted-foreground">
              Se a câmera acrescentar um zero na frente, o sistema reconhecerá o
              mesmo UPC automaticamente.
            </p>
          </div>
        )}
        <Button
          className="h-12 rounded-xl sm:col-span-2"
          disabled={busy}
          type="submit"
        >
          Salvar produto
        </Button>
      </form>

      {product && (
        <section className="mt-5 rounded-2xl border p-3 sm:p-4">
          <div className="flex items-center justify-between gap-3">
            <div>
              <p className="font-bold">Códigos UPC e EAN</p>
              <p className="text-xs text-muted-foreground">
                A leitura aceita o UPC de 12 números e o zero técnico do leitor.
              </p>
            </div>
            <Badge variant="secondary">{product.codes.length}/20</Badge>
          </div>
          <div className="mt-3 space-y-2">
            {product.codes.map((code) => (
              <div
                className="flex items-center gap-2 rounded-xl bg-muted/50 p-2"
                key={code.id}
              >
                <Barcode className="size-4 shrink-0 text-muted-foreground" />
                <span className="min-w-0 flex-1 truncate font-mono text-sm font-bold">
                  {displayCommercialCode(code.code, code.kind)}
                </span>
                <div className="flex shrink-0 flex-wrap justify-end gap-1">
                  <Badge variant="outline">{code.kind}</Badge>
                  {code.market && (
                    <Badge variant="secondary">{code.market}</Badge>
                  )}
                </div>
                <Button
                  aria-label={`Excluir código ${displayCommercialCode(code.code, code.kind)}`}
                  disabled={busy || product.codes.length <= 1}
                  onClick={() => setRemoveCodeId(code.id)}
                  size="icon-sm"
                  type="button"
                  variant="destructive"
                >
                  <Trash2 />
                </Button>
              </div>
            ))}
          </div>
          {removeCodeId && (
            <div className="mt-3 rounded-xl border border-destructive/25 bg-destructive/5 p-3">
              <p className="text-sm font-bold">Excluir este código?</p>
              <p className="mt-1 text-xs text-muted-foreground">
                Ele deixará de identificar o produto nas próximas entradas.
              </p>
              <div className="mt-2 flex justify-end gap-2">
                <Button
                  onClick={() => setRemoveCodeId(null)}
                  size="sm"
                  type="button"
                  variant="ghost"
                >
                  Cancelar
                </Button>
                <Button
                  disabled={busy}
                  onClick={() =>
                    void runAction(setBusy, setError, async () => {
                      await deleteJson(
                        `/api/products/${product.id}/codes/${removeCodeId}`,
                        csrfToken,
                      );
                      setRemoveCodeId(null);
                      await onChanged();
                    })
                  }
                  size="sm"
                  type="button"
                  variant="destructive"
                >
                  Excluir código
                </Button>
              </div>
            </div>
          )}
          <form
            className="mt-3 grid gap-2 sm:grid-cols-[minmax(0,1fr)_12rem_auto]"
            onSubmit={(event) => {
              event.preventDefault();
              void runAction(setBusy, setError, async () => {
                await postJson(`/api/products/${product.id}/codes`, csrfToken, {
                  code: newCode,
                  market: newCodeMarket || null,
                });
                setNewCode('');
                setNewCodeMarket('');
                await onChanged();
              });
            }}
          >
            <Input
              aria-label="Novo código UPC ou EAN"
              className="h-11 font-mono"
              inputMode="numeric"
              onChange={(event) => setNewCode(event.target.value)}
              placeholder="Adicionar UPC ou EAN"
              required
              value={newCode}
            />
            <NativeSelect
              aria-label="Mercado do código"
              className="h-11 w-full [&_select]:h-11"
              onChange={(event) => setNewCodeMarket(event.target.value)}
              value={newCodeMarket}
            >
              <NativeSelectOption value="">
                Mercado (opcional)
              </NativeSelectOption>
              {PRODUCT_MARKET_OPTIONS.map((market) => (
                <NativeSelectOption key={market} value={market}>
                  {market}
                </NativeSelectOption>
              ))}
            </NativeSelect>
            <Button
              aria-label="Adicionar código"
              className="size-11 rounded-xl"
              disabled={busy || product.codes.length >= 20}
              size="icon"
              type="submit"
            >
              <Plus />
            </Button>
          </form>
        </section>
      )}
      {product && (
        <RecordStatusControl
          active={product.active}
          busy={busy}
          label="produto"
          onToggle={toggleActive}
        />
      )}
    </EditorDialog>
  );
}

function AccountEditor({
  account,
  csrfToken,
  onChanged,
  onClose,
}: {
  account: PixAccountRecord | null;
  csrfToken: string;
  onChanged: () => Promise<void>;
  onClose: () => void;
}) {
  const [name, setName] = useState(account?.name ?? '');
  const [details, setDetails] = useState(account?.details ?? '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const toggleActive = async (active: boolean) => {
    if (!account) return;
    await runAction(setBusy, setError, async () => {
      await patchJson(`/api/pix-accounts/${account.id}`, csrfToken, { active });
      await onChanged();
      onClose();
    });
  };
  return (
    <EditorDialog
      description="A conta ativa fica disponível quando um pagamento Pix é adicionado."
      onClose={onClose}
      title={account ? 'Editar conta' : 'Nova conta'}
    >
      {error && <ErrorBox>{error}</ErrorBox>}
      <form
        className="space-y-3"
        onSubmit={(event) => {
          event.preventDefault();
          void runAction(setBusy, setError, async () => {
            const payload = { name, details };
            if (account) {
              await patchJson(
                `/api/pix-accounts/${account.id}`,
                csrfToken,
                payload,
              );
            } else {
              await postJson('/api/pix-accounts', csrfToken, payload);
            }
            await onChanged();
            onClose();
          });
        }}
      >
        <Field label="Nome da conta">
          <Input
            className="h-11"
            onChange={(event) => setName(event.target.value)}
            placeholder="Nubank principal"
            required
            value={name}
          />
        </Field>
        <Field label="Titular ou identificação (opcional)">
          <Input
            className="h-11"
            onChange={(event) => setDetails(event.target.value)}
            placeholder="Ex.: Jeferson · final 1234"
            value={details}
          />
        </Field>
        <Button
          className="h-12 w-full rounded-xl"
          disabled={busy}
          type="submit"
        >
          Salvar conta
        </Button>
      </form>
      {account && (
        <RecordStatusControl
          active={account.active}
          busy={busy}
          label="conta"
          onToggle={toggleActive}
        />
      )}
    </EditorDialog>
  );
}

function ManagerShell({
  action,
  filters,
  summary,
  children,
}: {
  action: React.ReactNode;
  filters: React.ReactNode;
  summary: string;
  children: React.ReactNode;
}) {
  return (
    <section className="flex h-full min-h-0 flex-col overflow-hidden">
      <div className="shrink-0 space-y-2 pb-3">
        <div className="flex items-center justify-between gap-3">
          <p className="text-sm font-bold text-muted-foreground">{summary}</p>
          {action}
        </div>
        <div className="flex gap-2">{filters}</div>
      </div>
      <div className="min-h-0 flex-1 space-y-2 overflow-y-auto overscroll-contain pb-2 pr-0.5">
        {children}
      </div>
    </section>
  );
}

function EditorDialog({
  title,
  description,
  onClose,
  wide = false,
  children,
}: {
  title: string;
  description: string;
  onClose: () => void;
  wide?: boolean;
  children: React.ReactNode;
}) {
  return (
    <Dialog onOpenChange={(open) => !open && onClose()} open>
      <DialogContent
        className={`flex h-dvh max-h-dvh max-w-none flex-col gap-0 overflow-hidden rounded-none p-0 sm:h-[90dvh] sm:rounded-2xl ${wide ? 'sm:max-w-3xl' : 'sm:max-w-xl'}`}
      >
        <DialogHeader className="shrink-0 border-b px-4 py-4 pr-12">
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>
        <div className="min-h-0 flex-1 overflow-y-auto p-4 overscroll-contain">
          {children}
        </div>
        <div className="shrink-0 border-t bg-muted/30 p-3 text-right">
          <Button
            className="h-10 min-w-28"
            onClick={onClose}
            type="button"
            variant="outline"
          >
            Fechar
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function RecordStatusControl({
  active,
  busy,
  label,
  onToggle,
}: {
  active: boolean;
  busy: boolean;
  label: 'cliente' | 'produto' | 'conta';
  onToggle: (active: boolean) => Promise<void>;
}) {
  const [confirming, setConfirming] = useState(false);
  if (!active) {
    return (
      <div className="mt-5 rounded-2xl border bg-muted/30 p-3">
        <p className="text-sm text-muted-foreground">
          Este {label} está excluído das novas operações.
        </p>
        <Button
          className="mt-2"
          disabled={busy}
          onClick={() => void onToggle(true)}
          type="button"
          variant="secondary"
        >
          <RotateCcw /> Restaurar {label}
        </Button>
      </div>
    );
  }
  return (
    <div className="mt-5 rounded-2xl border border-destructive/20 bg-destructive/5 p-3">
      {!confirming ? (
        <div className="flex items-center justify-between gap-3">
          <p className="text-xs text-muted-foreground">
            A exclusão preserva vendas e históricos anteriores.
          </p>
          <Button
            disabled={busy}
            onClick={() => setConfirming(true)}
            type="button"
            variant="destructive"
          >
            <Trash2 /> Excluir
          </Button>
        </div>
      ) : (
        <div>
          <p className="font-bold">Confirmar exclusão?</p>
          <p className="mt-1 text-xs text-muted-foreground">
            O {label} deixará de aparecer nas novas operações, mas continuará
            nos históricos.
          </p>
          <div className="mt-3 flex justify-end gap-2">
            <Button
              onClick={() => setConfirming(false)}
              type="button"
              variant="ghost"
            >
              Cancelar
            </Button>
            <Button
              disabled={busy}
              onClick={() => void onToggle(false)}
              type="button"
              variant="destructive"
            >
              Confirmar exclusão
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}

function SearchInput({
  label,
  value,
  placeholder,
  onChange,
}: {
  label: string;
  value: string;
  placeholder: string;
  onChange: (value: string) => void;
}) {
  return (
    <div className="relative min-w-0 flex-1">
      <Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
      <Input
        aria-label={label}
        className="h-11 rounded-xl pl-10"
        onChange={(event) => onChange(event.target.value)}
        placeholder={placeholder}
        value={value}
      />
    </div>
  );
}

function StatusBadge({ active }: { active: boolean }) {
  return active ? (
    <Badge className="bg-success/10 text-success hover:bg-success/10">
      Ativo
    </Badge>
  ) : (
    <Badge variant="secondary">Excluído</Badge>
  );
}

function EmptyState({
  icon: Icon,
  text,
}: {
  icon: typeof Smartphone;
  text: string;
}) {
  return (
    <Card className="border-dashed">
      <CardContent className="grid min-h-40 place-items-center p-5 text-center">
        <div>
          <Icon className="mx-auto size-7 text-muted-foreground" />
          <p className="mt-2 text-sm text-muted-foreground">{text}</p>
        </div>
      </CardContent>
    </Card>
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
        className="h-11 pl-10 text-right font-bold"
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

async function runAction(
  setBusy: (busy: boolean) => void,
  setError: (error: string) => void,
  action: () => Promise<void>,
) {
  setBusy(true);
  setError('');
  try {
    await action();
  } catch (error) {
    setError(messageOf(error));
  } finally {
    setBusy(false);
  }
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

async function deleteJson(url: string, csrfToken: string) {
  return requestJson(url, {
    method: 'DELETE',
    headers: { 'x-csrf-token': csrfToken },
  });
}

function splitCodes(value: string) {
  return value
    .split(/[\n,;]+/)
    .map((code) => code.trim())
    .filter(Boolean);
}

function normalizeSearch(value: string) {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim();
}

function moneyInput(cents: number) {
  return (cents / 100).toLocaleString('pt-BR', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

function formatMoney(cents: number) {
  return new Intl.NumberFormat('pt-BR', {
    style: 'currency',
    currency: 'BRL',
  }).format(cents / 100);
}
