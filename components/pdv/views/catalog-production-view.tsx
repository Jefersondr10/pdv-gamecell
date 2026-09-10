'use client';

import { createOperationId } from '@/lib/client-operation-id';

import { useMemo, useState } from 'react';
import { can } from '@/lib/permissions';
import {
  Barcode,
  Pencil,
  Power,
  Plus,
  RotateCcw,
  Search,
  Smartphone,
  Trash2,
  UserRound,
  WalletCards,
} from 'lucide-react';

import { ProductStatusAction } from '@/components/pdv/product-status-action';
import { ProductColorSwatch } from '@/components/pdv/product-color-swatch';
import { ClientPurchaseHistory } from './client-purchase-history';
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
import { productEditorPayload } from '@/lib/product-editor';
import type {
  BootstrapData,
  ClientRecord,
  PixAccountRecord,
  ProductRecord,
} from '@/lib/pdv-types';

const PRODUCT_PAGE_SIZE = 30;
const CLIENT_PAGE_SIZE = 40;

export function CatalogProductionView({
  data,
  onChanged,
  onStatusChanged,
  onOpenSale,
}: {
  data: BootstrapData;
  onChanged: () => Promise<void>;
  onStatusChanged: () => Promise<void>;
  onOpenSale?: (id: string) => void;
}) {
  const [historyId, setHistoryId] = useState<string | null>(null);
  const historyClient = data.clients.find((client) => client.id === historyId);
  if (!can(data.user, 'clients') && !can(data.user, 'products'))
    return (
      <p className="p-4 text-sm text-muted-foreground">
        Nenhum cadastro disponível para seu usuário.
      </p>
    );
  if (historyClient)
    return (
      <ClientPurchaseHistory
        key={historyClient.id}
        client={historyClient}
        onBack={() => setHistoryId(null)}
        onOpenSale={onOpenSale}
      />
    );
  return (
    <div className="flex h-full min-h-0 flex-col overflow-hidden px-3 py-3 lg:px-10 lg:py-5">
      <header className="mb-3 shrink-0">
        <p className="eyebrow">Gestão da loja</p>
        <h1 className="mt-0.5 text-2xl font-bold tracking-[-.04em] lg:text-3xl">
          Cadastros
        </h1>
        <p className="mt-1 hidden text-sm text-muted-foreground lg:block">
          Consulte e gerencie clientes e produtos.
        </p>
      </header>
      <Tabs
        className="flex min-h-0 flex-1 flex-col overflow-hidden"
        defaultValue={can(data.user, 'clients') ? 'clients' : 'products'}
      >
        <TabsList
          className="mb-3 grid w-full shrink-0 grid-cols-2 rounded-xl bg-muted p-1 [&_[data-slot=tabs-trigger]]:min-h-10 lg:w-fit lg:min-w-[24rem]"
          size="lg"
        >
          <TabsTrigger value="clients" disabled={!can(data.user, 'clients')}>
            <UserRound /> Clientes
          </TabsTrigger>
          <TabsTrigger value="products" disabled={!can(data.user, 'products')}>
            <Smartphone /> Produtos
          </TabsTrigger>
        </TabsList>
        <TabsContent className="min-h-0 flex-1 overflow-hidden" value="clients">
          <ClientsManager
            canManage={can(data.user, 'clients.manage')}
            canCreate={can(data.user, 'clients.create')}
            canHistory={can(data.user, 'clients.history')}
            csrfToken={data.csrfToken}
            items={data.clients}
            onOpenHistory={setHistoryId}
            onChanged={onChanged}
          />
        </TabsContent>
        <TabsContent
          className="min-h-0 flex-1 overflow-hidden"
          value="products"
        >
          <ProductsManager
            canManage={can(data.user, 'products.manage')}
            csrfToken={data.csrfToken}
            items={data.products}
            onChanged={onChanged}
            onStatusChanged={onStatusChanged}
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
  canCreate,
  canHistory,
  onChanged,
  onOpenHistory,
}: {
  items: ClientRecord[];
  csrfToken: string;
  canManage: boolean;
  canCreate: boolean;
  canHistory: boolean;
  onChanged: () => Promise<void>;
  onOpenHistory: (id: string) => void;
}) {
  const [query, setQuery] = useState('');
  const [status, setStatus] = useState('all');
  const [editingId, setEditingId] = useState<string | null>(null);
  const [visibleCount, setVisibleCount] = useState(CLIENT_PAGE_SIZE);
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
          disabled={!canCreate}
          onClick={() => setEditingId('new')}
        >
          <Plus /> Novo cliente
        </Button>
      }
      filters={
        <>
          <SearchInput
            label="Pesquisar clientes"
            onChange={(value) => {
              setQuery(value);
              setVisibleCount(CLIENT_PAGE_SIZE);
            }}
            placeholder="Nome, telefone ou e-mail"
            value={query}
          />
          <NativeSelect
            aria-label="Filtrar clientes por situação"
            className="h-11 w-32 shrink-0 [&_select]:h-11"
            onChange={(event) => {
              setStatus(event.target.value);
              setVisibleCount(CLIENT_PAGE_SIZE);
            }}
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
      {filtered.slice(0, visibleCount).map((client) => (
        <article
          className={`flex items-center gap-2 rounded-2xl border bg-card p-3 ${client.active ? '' : 'opacity-65'}`}
          key={client.id}
        >
          <button
            type="button"
            onClick={() => onOpenHistory(client.id)}
            disabled={!canHistory}
            aria-label={`Ver compras de ${client.name}`}
            className="flex min-w-0 flex-1 items-center gap-3 rounded-xl text-left outline-none hover:bg-muted/40 focus-visible:ring-2 focus-visible:ring-primary"
          >
            <span className="grid size-10 shrink-0 place-items-center rounded-full bg-secondary text-primary">
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
              {canHistory && (
                <p className="mt-1 text-xs font-semibold text-primary">
                  Ver histórico de compras
                </p>
              )}
            </div>
          </button>
          {canManage && (
            <Button
              aria-label={`Editar ${client.name}`}
              className="size-11 rounded-xl"
              onClick={() => setEditingId(client.id)}
              size="icon"
              variant="outline"
            >
              <Pencil />
            </Button>
          )}
        </article>
      ))}
      {filtered.length > visibleCount && (
        <Button
          className="mx-auto h-11 w-full max-w-xs rounded-xl"
          onClick={() => setVisibleCount((value) => value + CLIENT_PAGE_SIZE)}
          variant="outline"
        >
          Mostrar mais clientes
        </Button>
      )}
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
  onStatusChanged,
}: {
  items: ProductRecord[];
  csrfToken: string;
  canManage: boolean;
  onChanged: () => Promise<void>;
  onStatusChanged: () => Promise<void>;
}) {
  const [query, setQuery] = useState('');
  const [status, setStatus] = useState('all');
  const [editingId, setEditingId] = useState<string | null>(null);
  const [visibleCount, setVisibleCount] = useState(PRODUCT_PAGE_SIZE);
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
            onChange={(value) => {
              setQuery(value);
              setVisibleCount(PRODUCT_PAGE_SIZE);
            }}
            placeholder="Modelo, cor, memória ou UPC"
            value={query}
          />
          <NativeSelect
            aria-label="Filtrar produtos por situação"
            className="h-11 w-32 shrink-0 [&_select]:h-11"
            onChange={(event) => {
              setStatus(event.target.value);
              setVisibleCount(PRODUCT_PAGE_SIZE);
            }}
            value={status}
          >
            <NativeSelectOption value="all">Todos</NativeSelectOption>
            <NativeSelectOption value="active">Ativos</NativeSelectOption>
            <NativeSelectOption value="inactive">Inativos</NativeSelectOption>
          </NativeSelect>
        </>
      }
      summary={`${filtered.length} de ${items.length} produtos`}
    >
      {filtered.slice(0, visibleCount).map((product) => (
        <article
          className={`rounded-2xl border bg-card p-3 ${product.active ? '' : 'opacity-65'}`}
          key={product.id}
        >
          <div className="grid grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-3">
            <span className="grid size-11 place-items-center rounded-2xl bg-secondary">
              <ProductColorSwatch
                className="size-6"
                color={product.color}
                model={product.model}
              />
            </span>
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <p className="truncate font-bold">{product.model}</p>
                <StatusBadge active={product.active} inactiveLabel="Inativo" />
              </div>
              <p className="flex items-center gap-1.5 truncate text-xs text-muted-foreground">
                <ProductColorSwatch
                  color={product.color}
                  model={product.model}
                />
                {product.detail} · {formatMoney(product.defaultPriceCents)}
              </p>
            </div>
            {canManage && (
              <Button
                aria-label={`Editar ${product.model} ${product.detail}`}
                className="size-11 rounded-xl"
                onClick={() => setEditingId(product.id)}
                size="icon"
                variant="outline"
              >
                <Pencil />
              </Button>
            )}
          </div>
          <div className="mt-2 flex flex-wrap items-center justify-between gap-2">
            <div className="flex min-w-0 flex-1 flex-wrap gap-1.5">
              {product.codes.map((code) => (
                <Badge className="font-mono" key={code.id} variant="secondary">
                  {code.kind} {displayCommercialCode(code.code, code.kind)}
                </Badge>
              ))}
            </div>
            {canManage && (
              <ProductStatusAction
                product={product}
                csrfToken={csrfToken}
                onChanged={onStatusChanged}
              />
            )}
          </div>
        </article>
      ))}
      {filtered.length > visibleCount && (
        <Button
          className="h-11 w-full rounded-xl"
          onClick={() =>
            setVisibleCount((current) => current + PRODUCT_PAGE_SIZE)
          }
          type="button"
          variant="outline"
        >
          Mostrar mais{' '}
          {Math.min(PRODUCT_PAGE_SIZE, filtered.length - visibleCount)}
          <span className="text-xs font-semibold text-muted-foreground">
            {filtered.length - visibleCount} restantes
          </span>
        </Button>
      )}
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
          onStatusChanged={onStatusChanged}
          onClose={() => setEditingId(null)}
          product={editingId === 'new' ? null : selected}
        />
      )}
    </ManagerShell>
  );
}

export function AccountsManager({
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
            <NativeSelectOption value="inactive">Inativas</NativeSelectOption>
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
              <StatusBadge active={account.active} inactiveLabel="Inativa" />
            </div>
            <p className="truncate text-xs text-muted-foreground">
              {account.details || 'Sem detalhes informados'}
            </p>
          </div>
          {canManage && (
            <Button
              aria-label={`Editar ${account.name}`}
              className="size-11 rounded-xl"
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
  const [operationId, setOperationId] = useState(createOperationId);
  const [values, setValues] = useState({
    name: client?.name ?? '',
    phone: client?.phone ?? '',
    email: client?.email ?? '',
    notes: client?.notes ?? '',
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const set = (key: keyof typeof values, value: string) => {
    setOperationId(createOperationId());
    setValues((current) => ({ ...current, [key]: value }));
  };
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
              await postJson('/api/clients', csrfToken, {
                ...values,
                operationId,
              });
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

export function ProductEditor({
  product,
  csrfToken,
  onChanged,
  onStatusChanged,
  onClose,
}: {
  product: ProductRecord | null;
  csrfToken: string;
  onChanged: () => Promise<void>;
  onStatusChanged: () => Promise<void>;
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
  const [codeSaved, setCodeSaved] = useState('');
  const [savedCodes, setSavedCodes] = useState<ProductRecord['codes']>([]);
  const [removedCodes, setRemovedCodes] = useState<string[]>([]);
  const displayedCodes = [
    ...new Map(
      [...(product?.codes ?? []), ...savedCodes].map((code) => [code.id, code]),
    ).values(),
  ].filter((code) => !removedCodes.includes(code.id));
  const [removeCodeId, setRemoveCodeId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const set = (key: keyof typeof values, value: string) =>
    setValues((current) => ({ ...current, [key]: value }));
  return (
    <EditorDialog
      busy={busy}
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
      {product && (
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3 rounded-xl border bg-muted/30 p-3">
          <div className="min-w-0 flex-1">
            <p className="flex items-center gap-2 text-sm font-semibold">
              Situação{' '}
              <StatusBadge active={product.active} inactiveLabel="Inativo" />
            </p>
            <p className="mt-1 text-sm text-muted-foreground">
              Desativar impede novas entradas. O estoque existente e o histórico
              são preservados.
            </p>
          </div>
          <ProductStatusAction
            product={product}
            csrfToken={csrfToken}
            onChanged={onStatusChanged}
            disabled={busy}
            onBusyChange={setBusy}
          />
        </div>
      )}
      <form
        className="grid gap-3 sm:grid-cols-2"
        onSubmit={(event) => {
          event.preventDefault();
          void runAction(setBusy, setError, async () => {
            const payload = productEditorPayload(
              values,
              newCode,
              newCodeMarket,
            );
            if (product) {
              const result = (await patchJson(
                `/api/products/${product.id}`,
                csrfToken,
                payload,
              )) as { code?: ProductRecord['codes'][number] };
              if (result.code)
                setSavedCodes((current) => [...current, result.code!]);
              setNewCode('');
              setNewCodeMarket('');
            } else {
              await postJson('/api/products', csrfToken, {
                ...payload,
                codes: splitCodes(values.codes),
              });
            }
            try {
              await onChanged();
              onClose();
            } catch {
              setError(
                'O produto foi salvo, mas a lista não atualizou. Reabra Cadastros para ver os dados atuais.',
              );
            }
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
              model={values.model}
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
        {product && (
          <section className="mt-2 rounded-2xl border p-3 sm:col-span-2 sm:p-4">
            <div className="flex items-center justify-between gap-3">
              <div>
                <p className="font-bold">Códigos UPC, EAN e JAN</p>
                <p className="text-xs text-muted-foreground">
                  A leitura aceita o UPC de 12 números e o zero técnico do
                  leitor.
                </p>
              </div>
              <Badge variant="secondary">{displayedCodes.length}/20</Badge>
            </div>
            <div className="mt-3 space-y-2">
              {displayedCodes.map((code) => (
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
                    disabled={busy || displayedCodes.length <= 1}
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
                        setRemovedCodes((current) => [
                          ...current,
                          removeCodeId,
                        ]);
                        setRemoveCodeId(null);
                        try {
                          await onChanged();
                        } catch {
                          setError(
                            'Código excluído. A lista não atualizou; reabra Cadastros para conferir.',
                          );
                        }
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
            <div className="mt-3 grid gap-2 sm:grid-cols-[minmax(0,1fr)_12rem_auto]">
              <Input
                aria-label="Novo código UPC ou EAN"
                className="h-11 font-mono"
                inputMode="numeric"
                onChange={(event) => {
                  setNewCode(event.target.value);
                  setCodeSaved('');
                }}
                placeholder="Adicionar UPC ou EAN"
                disabled={busy}
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
                className="h-11 rounded-xl"
                disabled={
                  busy || !newCode.trim() || displayedCodes.length >= 20
                }
                type="button"
                onClick={() => {
                  void runAction(setBusy, setError, async () => {
                    const result = (await patchJson(
                      `/api/products/${product.id}`,
                      csrfToken,
                      {
                        addCode: {
                          code: newCode,
                          market: newCodeMarket || null,
                        },
                      },
                    )) as { code: ProductRecord['codes'][number] };
                    setSavedCodes((current) => [...current, result.code]);
                    setNewCode('');
                    setNewCodeMarket('');
                    setCodeSaved(
                      'Código salvo. Já está disponível para leitura.',
                    );
                    try {
                      await onChanged();
                    } catch {
                      setError(
                        'Código salvo. A lista não atualizou; reabra Cadastros para conferir.',
                      );
                    }
                  });
                }}
              >
                <Plus /> Salvar código
              </Button>
            </div>
            <p className="mt-2 text-xs text-muted-foreground">
              Salvar alterações também grava o código digitado acima.
            </p>
            {codeSaved && (
              <output className="mt-2 text-sm font-semibold text-success">
                {codeSaved}
              </output>
            )}
          </section>
        )}
        <Button
          className="h-12 rounded-xl sm:col-span-2"
          disabled={busy}
          type="submit"
        >
          {busy
            ? 'Salvando…'
            : product
              ? 'Salvar alterações'
              : 'Salvar produto'}
        </Button>
      </form>
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
  const [receiptBank, setReceiptBank] = useState(account?.receiptBank ?? '');
  const [receiptRecipientDocument, setReceiptRecipientDocument] = useState(
    account?.receiptRecipientDocument ?? '',
  );
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
      busy={busy}
      onClose={onClose}
      title={account ? 'Editar conta' : 'Nova conta'}
    >
      {error && <ErrorBox>{error}</ErrorBox>}
      <form
        className="space-y-3"
        onSubmit={(event) => {
          event.preventDefault();
          void runAction(setBusy, setError, async () => {
            const payload = {
              name,
              details,
              receiptBank,
              receiptRecipientDocument,
            };
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
        <Field label="Banco recebedor no comprovante (opcional)">
          <Input
            value={receiptBank}
            maxLength={150}
            onChange={(event) => setReceiptBank(event.target.value)}
            placeholder="Nome da instituição como aparece no comprovante"
          />
        </Field>
        <Field label="CPF/CNPJ do recebedor (opcional)">
          <Input
            value={receiptRecipientDocument}
            inputMode="numeric"
            maxLength={20}
            onChange={(event) =>
              setReceiptRecipientDocument(event.target.value)
            }
            placeholder="Documento do titular desta conta"
          />
        </Field>
        <p className="text-sm text-muted-foreground">
          Para identificar esta conta automaticamente, o banco e o CPF/CNPJ
          precisam conferir com o recebedor do comprovante. Dados ausentes ou
          ambíguos exigem conferência.
        </p>
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
  busy = false,
  children,
}: {
  title: string;
  description: string;
  onClose: () => void;
  wide?: boolean;
  busy?: boolean;
  children: React.ReactNode;
}) {
  return (
    <Dialog onOpenChange={(open) => !open && !busy && onClose()} open>
      <DialogContent
        showCloseButton={!busy}
        className={`flex h-dvh max-h-dvh max-w-none flex-col gap-0 overflow-hidden rounded-none p-0 pb-[env(safe-area-inset-bottom)] pt-[env(safe-area-inset-top)] [&_[data-slot=dialog-close]]:top-[calc(.5rem+env(safe-area-inset-top))] sm:h-[90dvh] sm:rounded-2xl sm:pb-0 sm:pt-0 sm:[&_[data-slot=dialog-close]]:top-2 ${wide ? 'sm:max-w-3xl' : 'sm:max-w-xl'}`}
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
            disabled={busy}
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
          {label === 'conta'
            ? 'Esta conta está inativa para novos pagamentos.'
            : `Este ${label} está excluído das novas operações.`}
        </p>
        <Button
          className="mt-2"
          disabled={busy}
          onClick={() => void onToggle(true)}
          type="button"
          variant="secondary"
        >
          <RotateCcw />{' '}
          {label === 'conta' ? 'Reativar conta' : `Restaurar ${label}`}
        </Button>
      </div>
    );
  }
  return (
    <div className="mt-5 rounded-2xl border border-destructive/20 bg-destructive/5 p-3">
      {!confirming ? (
        <div className="flex items-center justify-between gap-3">
          <p className="text-xs text-muted-foreground">
            {label === 'conta'
              ? 'Desativar bloqueia novos pagamentos, sem apagar os anteriores.'
              : 'A exclusão preserva vendas e históricos anteriores.'}
          </p>
          <Button
            disabled={busy}
            onClick={() => setConfirming(true)}
            type="button"
            variant={label === 'conta' ? 'outline' : 'destructive'}
          >
            {label === 'conta' ? (
              <>
                <Power /> Desativar conta
              </>
            ) : (
              <>
                <Trash2 /> Excluir
              </>
            )}
          </Button>
        </div>
      ) : (
        <div>
          <p className="font-bold">
            {label === 'conta'
              ? 'Desativar esta conta?'
              : 'Confirmar exclusão?'}
          </p>
          <p className="mt-1 text-xs text-muted-foreground">
            {label === 'conta'
              ? 'A conta sairá das opções de novos pagamentos. Os pagamentos já registrados não mudam. Você pode reativá-la depois.'
              : `O ${label} deixará de aparecer nas novas operações, mas continuará nos históricos.`}
          </p>
          <div className="mt-3 flex justify-end gap-2">
            <Button
              onClick={() => setConfirming(false)}
              disabled={busy}
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
              {label === 'conta'
                ? 'Confirmar desativação'
                : 'Confirmar exclusão'}
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

function StatusBadge({
  active,
  inactiveLabel = 'Excluído',
}: {
  active: boolean;
  inactiveLabel?: string;
}) {
  return active ? (
    <Badge className="bg-success/10 text-success hover:bg-success/10">
      Ativo
    </Badge>
  ) : (
    <Badge variant="secondary">{inactiveLabel}</Badge>
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
