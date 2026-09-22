'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import {
  CalendarClock,
  ScanLine,
  Clock3,
  Plus,
  RefreshCw,
  Search,
  Smartphone,
  ShoppingBag,
  Unlock,
  X,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  BarcodeScanner,
  type ScanFeedback,
} from '@/components/pdv/barcode-scanner';
import type { ScanCandidate } from '@/lib/scanner';
import {
  addReservationUnit,
  resolveReservationScan,
  type ReservationUnit,
} from '@/lib/reservation-scan';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog';
import { can } from '@/lib/permissions';
import { messageOf, requestJson } from '@/lib/client-api';
import {
  PendingOperationError,
  submitRecoverableOperation,
} from '@/lib/client-operation-recovery';
import { parseMoneyInput } from '@/lib/money';
import type { BootstrapData, InventoryPage } from '@/lib/pdv-types';
import {
  reservationLabels,
  type ReservationRecord,
  type ReservationPage,
} from '@/lib/reservations';

const money = (cents: number) =>
  (cents / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
const date = (value: number) =>
  new Date(value).toLocaleString('pt-BR', {
    timeZone: 'America/Sao_Paulo',
    dateStyle: 'short',
    timeStyle: 'short',
  });
function dateInput(value: number) {
  const p = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Sao_Paulo',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(value);
  const part = (type: string) => p.find((v) => v.type === type)?.value;
  return `${part('year')}-${part('month')}-${part('day')}T${part('hour')}:${part('minute')}`;
}
const parseDate = (value: string) => new Date(`${value}:00-03:00`).getTime();
const selectClass =
  'h-11 w-full min-w-0 rounded-xl border bg-background px-3 text-sm';
const fieldClass = 'grid min-w-0 gap-2 text-sm font-semibold';

export function ReservationsView({
  data,
  onOpenSale,
}: {
  data: BootstrapData;
  onOpenSale?: (id: string) => void;
}) {
  const [page, setPage] = useState<ReservationPage>({
    items: [],
    nextOffset: null,
  });
  const [status, setStatus] = useState('active');
  const [query, setQuery] = useState('');
  const [search, setSearch] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [create, setCreate] = useState(false);
  const [editing, setEditing] = useState<{
    row: ReservationRecord;
    mode: 'deadline' | 'release' | 'sale';
  } | null>(null);
  const generation = useRef(0);
  const invalidate = useCallback(() => {
    generation.current++;
  }, []);
  const manage = can(data.user, 'reservations.manage');
  useEffect(() => {
    const t = setTimeout(() => setSearch(query.trim()), 300);
    return () => clearTimeout(t);
  }, [query]);
  const load = useCallback(
    async (offset = 0, background = false) => {
      const current = ++generation.current;
      if (!background) setBusy(true);
      setError('');
      try {
        const result = await requestJson<ReservationPage>(
          `/api/reservations?${new URLSearchParams({ status, q: search, offset: String(offset) })}`,
        );
        if (current === generation.current)
          setPage((old) => ({
            ...result,
            items: offset ? [...old.items, ...result.items] : result.items,
          }));
      } catch (cause) {
        if (current === generation.current) setError(messageOf(cause));
      } finally {
        if (current === generation.current) setBusy(false);
      }
    },
    [status, search],
  );
  useEffect(() => {
    let active = true;
    queueMicrotask(() => {
      if (active) void load();
    });
    return () => {
      active = false;
      invalidate();
    };
  }, [load, invalidate]);
  useEffect(() => {
    const refresh = () => {
      if (!document.hidden && !create && !editing) void load(0, true);
    };
    const timer = setInterval(refresh, 30000);
    window.addEventListener('focus', refresh);
    window.addEventListener('pdv:operations-changed', refresh);
    return () => {
      clearInterval(timer);
      window.removeEventListener('focus', refresh);
      window.removeEventListener('pdv:operations-changed', refresh);
    };
  }, [load, create, editing]);
  const changed = (message: string) => {
    setNotice(message);
    setCreate(false);
    setEditing(null);
    void load();
    window.dispatchEvent(new Event('pdv:sales-changed'));
  };
  return (
    <section
      aria-label="Gestão de reservas"
      className="h-full overflow-y-auto bg-background p-4 sm:p-6"
    >
      <div className="mx-auto max-w-6xl space-y-5">
        <header className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <p className="text-xs font-bold uppercase tracking-widest text-muted-foreground">
              Comercial
            </p>
            <h1 className="mt-1 flex items-center gap-2 text-2xl font-extrabold">
              <CalendarClock className="text-primary" />
              Reservas
            </h1>
            <p className="mt-1 text-sm text-muted-foreground">
              Separe aparelhos por cliente, sem registrar uma venda.
            </p>
          </div>
          <div className="flex gap-2">
            <Button
              variant="outline"
              aria-label="Atualizar reservas"
              disabled={busy}
              onClick={() => void load()}
            >
              <RefreshCw className={busy ? 'animate-spin' : ''} />
            </Button>
            {manage && (
              <Button onClick={() => setCreate(true)}>
                <Plus />
                Nova reserva
              </Button>
            )}
          </div>
        </header>
        <div className="rounded-2xl border border-primary/15 bg-primary/5 p-4 text-sm text-muted-foreground">
          <strong className="text-foreground">
            Reservado não é vendido.
          </strong>{' '}
          Os SNs ficam bloqueados até o prazo escolhido. Ao vencer ou liberar,
          voltam a ficar disponíveis. Não gera recebimento nem faturamento.
        </div>
        <div className="grid gap-3 rounded-2xl border bg-card p-4 sm:grid-cols-[1fr_230px]">
          <label className={fieldClass} htmlFor="reservation-search">
            Pesquisar reserva
            <div className="relative">
              <Search className="absolute left-3 top-3 size-4 text-muted-foreground" />
              <Input
                id="reservation-search"
                className="h-11 pl-9"
                placeholder="Cliente ou SN"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
              />
            </div>
          </label>
          <label className={fieldClass}>
            Situação
            <select
              className={selectClass}
              value={status}
              onChange={(e) => setStatus(e.target.value)}
            >
              {Object.entries(reservationLabels).map(([key, label]) => (
                <option key={key} value={key}>
                  {label}
                </option>
              ))}
              <option value="all">Todas</option>
            </select>
          </label>
        </div>
        {notice && (
          <output className="block rounded-xl border border-green-200 bg-green-50 p-3 text-sm font-semibold text-green-800">
            {notice}
          </output>
        )}
        {error && (
          <p
            role="alert"
            className="rounded-xl bg-destructive/10 p-3 text-sm text-destructive"
          >
            {error}
          </p>
        )}
        <div className="space-y-4" aria-busy={busy}>
          {page.items.map((row) => (
            <article
              key={row.id}
              className="overflow-hidden rounded-2xl border bg-card shadow-sm"
            >
              <header className="flex flex-wrap items-start justify-between gap-3 border-b bg-muted/30 p-4 sm:p-5">
                <div>
                  <h2 className="text-lg font-extrabold">{row.customerName}</h2>
                  <p className="mt-1 text-xs text-muted-foreground">
                    Criada em {date(row.createdAt)} · {row.operatorName}
                  </p>
                </div>
                <span
                  className={`rounded-full px-3 py-1 text-xs font-bold ${row.status === 'active' ? 'bg-amber-100 text-amber-900' : row.status === 'converted' ? 'bg-green-100 text-green-800' : 'bg-muted text-muted-foreground'}`}
                >
                  {reservationLabels[row.status]}
                </span>
              </header>
              <div className="space-y-4 p-4 sm:p-5">
                <p className="flex items-center gap-2 text-sm font-semibold">
                  <Clock3 className="size-4 text-primary" />
                  Prazo: {date(row.expiresAt)} (Brasília)
                </p>
                <ul className="grid gap-2 sm:grid-cols-2">
                  {row.items.map((item) => (
                    <li
                      key={item.unitId}
                      className="flex items-start gap-3 rounded-xl border p-3"
                    >
                      <Smartphone className="mt-1 size-5 shrink-0 text-primary" />
                      <div className="min-w-0">
                        <p className="font-bold">{item.product}</p>
                        <p className="text-sm text-muted-foreground">
                          {item.detail}
                        </p>
                        <p className="mt-1 break-all font-mono text-xs font-semibold">
                          SN {item.serial}
                        </p>
                      </div>
                    </li>
                  ))}
                </ul>
                {row.notes && (
                  <p className="whitespace-pre-wrap break-words rounded-xl bg-muted/40 p-3 text-sm">
                    {row.notes}
                  </p>
                )}
                {row.status === 'active' && manage && (
                  <div className="flex flex-wrap gap-2 border-t pt-4">
                    {can(data.user, 'sell') && (
                      <Button onClick={() => setEditing({ row, mode: 'sale' })}>
                        <ShoppingBag />
                        Concluir venda
                      </Button>
                    )}
                    <Button
                      variant="outline"
                      onClick={() => setEditing({ row, mode: 'deadline' })}
                    >
                      <Clock3 />
                      Alterar prazo
                    </Button>
                    <Button
                      variant="outline"
                      onClick={() => setEditing({ row, mode: 'release' })}
                    >
                      <Unlock />
                      Liberar aparelhos
                    </Button>
                  </div>
                )}
                {row.status === 'converted' && row.saleId && (
                  <div className="border-t pt-3">
                    <p className="mb-2 text-sm font-semibold">
                      Venda #{String(row.saleNumber).padStart(5, '0')}
                    </p>
                    {onOpenSale && (
                      <Button
                        variant="outline"
                        onClick={() => onOpenSale(row.saleId!)}
                      >
                        Ver venda
                      </Button>
                    )}
                  </div>
                )}
              </div>
            </article>
          ))}
          {!busy && !error && !page.items.length && (
            <div className="rounded-2xl border border-dashed bg-card p-10 text-center">
              <CalendarClock className="mx-auto mb-3 size-9 text-muted-foreground" />
              <h2 className="font-bold">Nenhuma reserva nesta situação</h2>
              <p className="mt-1 text-sm text-muted-foreground">
                Crie uma reserva ou ajuste os filtros para consultar as
                anteriores.
              </p>
            </div>
          )}
          {busy && (
            <output className="block p-4 text-center text-sm">
              Carregando reservas…
            </output>
          )}
          {page.nextOffset !== null && (
            <Button
              variant="outline"
              className="w-full"
              disabled={busy}
              onClick={() => void load(page.nextOffset!)}
            >
              Carregar mais reservas
            </Button>
          )}
        </div>
      </div>
      {create && (
        <CreateReservation
          data={data}
          onClose={() => setCreate(false)}
          onSaved={() =>
            changed(
              'Reserva criada. Os aparelhos estão separados para este cliente.',
            )
          }
        />
      )}
      {editing && (
        <ReservationAction
          key={`${editing.row.id}:${editing.mode}`}
          data={data}
          {...editing}
          onClose={() => setEditing(null)}
          onSaved={changed}
        />
      )}
    </section>
  );
}

function CreateReservation({
  data,
  onClose,
  onSaved,
}: {
  data: BootstrapData;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [customerId, setCustomerId] = useState('');
  const [deadline, setDeadline] = useState(() =>
    dateInput(Date.now() + 86400000),
  );
  const [notes, setNotes] = useState('');
  const [query, setQuery] = useState('');
  const [available, setAvailable] = useState<InventoryPage>({
    items: [],
    nextCursor: null,
    total: null,
  });
  const [selected, setSelected] = useState<ReservationUnit[]>([]);
  const selectedRef = useRef<ReservationUnit[]>([]);
  const [inputMode, setInputMode] = useState<'scan' | 'search'>('scan');
  const [scanNotice, setScanNotice] = useState('');
  const [checking, setChecking] = useState(false);
  const scanRequest = useRef<AbortController | null>(null);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [searchError, setSearchError] = useState('');
  const operation = useRef(crypto.randomUUID());
  const saving = useRef(false);
  const generation = useRef(0);
  const invalidate = useCallback(() => {
    generation.current++;
  }, []);
  useEffect(() => () => scanRequest.current?.abort(), []);
  function choose(item: ReservationUnit) {
    const next = addReservationUnit(selectedRef.current, item);
    selectedRef.current = next;
    setSelected(next);
  }
  function changeInputMode(mode: 'scan' | 'search') {
    scanRequest.current?.abort();
    scanRequest.current = null;
    setChecking(false);
    setScanNotice('');
    setInputMode(mode);
  }
  async function acceptScan(candidate: ScanCandidate): Promise<ScanFeedback> {
    if (scanRequest.current || saving.current) return 'silent';
    const controller = new AbortController();
    scanRequest.current = controller;
    setChecking(true);
    setScanNotice('Consultando disponibilidade do SN…');
    try {
      const item = await resolveReservationScan(candidate, (params) =>
        requestJson(`/api/inventory/lookup?${params}`, {
          signal: controller.signal,
        }),
      );
      if (controller.signal.aborted) return 'silent';
      choose(item);
      setScanNotice(
        `SN ${item.serial} adicionado. Pode ler o próximo aparelho.`,
      );
      return 'success';
    } catch (cause) {
      if (controller.signal.aborted) return 'silent';
      setScanNotice(messageOf(cause));
      return 'error';
    } finally {
      if (scanRequest.current === controller) {
        scanRequest.current = null;
        setChecking(false);
      }
    }
  }
  const search = useCallback(
    async (cursor: string | null = null) => {
      const current = ++generation.current;
      setLoading(true);
      setSearchError('');
      try {
        const result = await requestJson<InventoryPage>(
          `/api/inventory?${new URLSearchParams({ status: 'available', q: query, limit: '30', ...(cursor ? { cursor } : {}) })}`,
        );
        if (current === generation.current)
          setAvailable((old) => ({
            ...result,
            items: cursor ? [...old.items, ...result.items] : result.items,
          }));
      } catch (cause) {
        if (current === generation.current) setSearchError(messageOf(cause));
      } finally {
        if (current === generation.current) setLoading(false);
      }
    },
    [query],
  );
  useEffect(() => {
    if (inputMode !== 'search') return;
    const t = setTimeout(() => void search(), 300);
    return () => {
      clearTimeout(t);
      invalidate();
    };
  }, [search, invalidate, inputMode]);
  async function save() {
    if (saving.current || scanRequest.current) return;
    saving.current = true;
    setBusy(true);
    setError('');
    try {
      await requestJson('/api/reservations', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-csrf-token': data.csrfToken,
        },
        body: JSON.stringify({
          operationId: operation.current,
          customerId,
          unitIds: selected.map((item) => item.id),
          expiresAt: parseDate(deadline),
          notes,
        }),
      });
      onSaved();
    } catch (cause) {
      setError(messageOf(cause));
    } finally {
      saving.current = false;
      setBusy(false);
    }
  }
  return (
    <Dialog open onOpenChange={(open) => !open && !busy && onClose()}>
      <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle>Nova reserva</DialogTitle>
          <DialogDescription>
            Escolha o cliente, o prazo e os SNs disponíveis. Nenhum pagamento
            será registrado.
          </DialogDescription>
        </DialogHeader>
        <fieldset disabled={busy} className="min-w-0 space-y-4">
          <div className="grid gap-3 sm:grid-cols-2">
            <label className={fieldClass}>
              Cliente
              <select
                className={selectClass}
                value={customerId}
                onChange={(e) => setCustomerId(e.target.value)}
              >
                <option value="">Selecione o cliente</option>
                {data.clients
                  .filter((c) => c.active)
                  .map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
              </select>
            </label>
            <label className={fieldClass} htmlFor="reservation-deadline">
              Reservar até (Brasília)
              <Input
                id="reservation-deadline"
                type="datetime-local"
                onInput={(e) => setDeadline(e.currentTarget.value)}
                className="h-11"
                value={deadline}
                onChange={(e) => setDeadline(e.target.value)}
              />
            </label>
          </div>
          <section
            aria-label="Selecionar aparelhos para reserva"
            className="space-y-3"
          >
            <div className="grid grid-cols-2 gap-2">
              <Button
                variant={inputMode === 'scan' ? 'default' : 'outline'}
                className="h-11 min-w-0"
                aria-pressed={inputMode === 'scan'}
                onClick={() => changeInputMode('scan')}
              >
                <ScanLine /> Ler SN
              </Button>
              <Button
                variant={inputMode === 'search' ? 'default' : 'outline'}
                className="h-11 min-w-0"
                aria-label="Pesquisar estoque"
                aria-pressed={inputMode === 'search'}
                onClick={() => changeInputMode('search')}
              >
                <Search /> Pesquisar
              </Button>
            </div>
            {inputMode === 'scan' && !busy && (
              <BarcodeScanner
                autoStart
                mode="apple_serial"
                title="Ler SN para reservar"
                description="Leia o SN de cada aparelho, como na venda. IMEI e EID não são aceitos."
                onAccepted={acceptScan}
                notice={scanNotice}
              />
            )}
          </section>
          <section className="rounded-xl border p-3">
            <h3 className="mb-2 font-bold">
              Aparelhos selecionados ({selected.length}/50)
            </h3>
            {selected.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                Leia os SNs ou pesquise no estoque para adicionar aparelhos.
              </p>
            ) : (
              <ul className="space-y-2">
                {selected.map((item) => (
                  <li
                    key={item.id}
                    className="flex items-center justify-between gap-2 rounded-lg bg-primary/5 p-2"
                  >
                    <div className="min-w-0">
                      <p className="text-sm font-semibold">
                        {item.productName} · {item.productDetail}
                      </p>
                      <p className="break-all font-mono text-xs">
                        SN {item.serial}
                      </p>
                    </div>
                    <Button
                      size="icon"
                      variant="ghost"
                      aria-label={`Remover SN ${item.serial}`}
                      onClick={() => {
                        selectedRef.current = selectedRef.current.filter(
                          (v) => v.id !== item.id,
                        );
                        setSelected(selectedRef.current);
                      }}
                    >
                      <X />
                    </Button>
                  </li>
                ))}
              </ul>
            )}
          </section>
          {inputMode === 'search' && (
            <>
              <label className={fieldClass} htmlFor="reservation-unit-search">
                Buscar aparelho disponível
                <Input
                  id="reservation-unit-search"
                  placeholder="Digite ou bipe o SN, modelo, cor ou memória"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                />
              </label>
              {searchError && (
                <p role="alert" className="text-sm text-destructive">
                  {searchError}{' '}
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => void search()}
                  >
                    Tentar novamente
                  </Button>
                </p>
              )}
              <div
                className="max-h-60 space-y-2 overflow-y-auto rounded-xl border p-2"
                aria-label="Aparelhos disponíveis"
              >
                {available.items.map((item) => {
                  const chosen = selected.some((v) => v.id === item.id);
                  return (
                    <div
                      key={item.id}
                      className="flex items-center justify-between gap-2 rounded-lg bg-muted/30 p-2"
                    >
                      <div className="min-w-0">
                        <p className="text-sm font-bold">{item.productName}</p>
                        <p className="text-xs text-muted-foreground">
                          {item.productDetail}
                        </p>
                        <p className="break-all font-mono text-xs">
                          SN {item.serial}
                        </p>
                      </div>
                      <Button
                        size="sm"
                        variant="outline"
                        aria-label={`Adicionar SN ${item.serial}`}
                        disabled={chosen || selected.length >= 50}
                        onClick={() => {
                          try {
                            choose(item);
                            setError('');
                          } catch (cause) {
                            setError(messageOf(cause));
                          }
                        }}
                      >
                        {chosen ? 'Selecionado' : 'Adicionar'}
                      </Button>
                    </div>
                  );
                })}
                {!loading && !available.items.length && (
                  <p className="p-4 text-center text-sm text-muted-foreground">
                    Nenhum aparelho disponível nesta busca.
                  </p>
                )}
                {loading && (
                  <output className="block p-2 text-sm">Buscando…</output>
                )}
                {available.nextCursor && (
                  <Button
                    variant="ghost"
                    disabled={loading}
                    onClick={() => void search(available.nextCursor)}
                  >
                    Mostrar mais aparelhos
                  </Button>
                )}
              </div>
            </>
          )}
          <label className={fieldClass} htmlFor="reservation-notes">
            Observação (opcional)
            <Input
              id="reservation-notes"
              maxLength={500}
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Ex.: aguardando confirmação do cliente"
            />
          </label>
        </fieldset>
        {error && (
          <p
            role="alert"
            className="rounded-xl bg-destructive/10 p-3 text-sm text-destructive"
          >
            {error}
          </p>
        )}
        <DialogFooter>
          <Button variant="outline" disabled={busy} onClick={onClose}>
            Voltar
          </Button>
          <Button
            disabled={
              busy || checking || !customerId || !selected.length || !deadline
            }
            onClick={() => void save()}
          >
            {busy ? 'Reservando…' : 'Confirmar reserva'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function ReservationAction({
  data,
  row,
  mode,
  onClose,
  onSaved,
}: {
  data: BootstrapData;
  row: ReservationRecord;
  mode: 'deadline' | 'release' | 'sale';
  onClose: () => void;
  onSaved: (message: string) => void;
}) {
  const [deadline, setDeadline] = useState(() => dateInput(row.expiresAt));
  const [prices, setPrices] = useState(() =>
    row.items.map((item) =>
      (item.defaultPriceCents / 100).toFixed(2).replace('.', ','),
    ),
  );
  const [cash, setCash] = useState('');
  const [photos, setPhotos] = useState<File[][]>(() => row.items.map(() => []));
  const [receipts, setReceipts] = useState<File[]>([]);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [pending, setPending] = useState(false);
  const saving = useRef(false);
  const amount = prices.reduce((sum, value) => sum + parseMoneyInput(value), 0);
  async function save() {
    if (saving.current || pending) return;
    saving.current = true;
    setBusy(true);
    setError('');
    try {
      if (mode === 'sale') {
        const form = new FormData();
        form.set(
          'payload',
          JSON.stringify({
            operationId: row.id,
            stockReservationId: row.id,
            customerId: row.customerId,
            sellerUserId: data.user.id,
            items: row.items.map((item, i) => ({
              serial: item.serial,
              priceCents: parseMoneyInput(prices[i]),
            })),
            payments:
              parseMoneyInput(cash) > 0
                ? [
                    {
                      method: 'cash',
                      pixAccountId: null,
                      amountCents: parseMoneyInput(cash),
                    },
                  ]
                : [],
            receiptValues: receipts.map(() => ({
              amountCents: null,
              source: null,
            })),
          }),
        );
        photos.forEach((files, index) =>
          files.forEach((file) => form.append(`itemPhotos:${index}`, file)),
        );
        receipts.forEach((file) => form.append('receipts', file));
        const result = await submitRecoverableOperation(
          {
            storeId: data.store.id,
            userId: data.user.id,
            csrfToken: data.csrfToken,
          },
          'sale',
          row.id,
          `Reserva · ${row.customerName} · ${row.items.length} aparelho(s)`,
          form,
        );
        onSaved(
          `Venda #${String(result.number).padStart(5, '0')} concluída. A reserva foi convertida e o estoque atualizado.`,
        );
      } else {
        await requestJson(`/api/reservations/${row.id}`, {
          method: 'PATCH',
          headers: {
            'content-type': 'application/json',
            'x-csrf-token': data.csrfToken,
          },
          body: JSON.stringify({
            action: mode,
            revision: row.revision,
            ...(mode === 'deadline' ? { expiresAt: parseDate(deadline) } : {}),
          }),
        });
        onSaved(
          mode === 'deadline'
            ? 'Prazo da reserva atualizado.'
            : 'Reserva liberada. Os aparelhos estão disponíveis novamente.',
        );
      }
    } catch (cause) {
      if (cause instanceof PendingOperationError) setPending(true);
      setError(messageOf(cause));
    } finally {
      saving.current = false;
      setBusy(false);
    }
  }
  return (
    <Dialog open onOpenChange={(open) => !open && !busy && onClose()}>
      <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>
            {mode === 'sale'
              ? 'Concluir venda da reserva'
              : mode === 'deadline'
                ? 'Alterar prazo'
                : 'Liberar aparelhos'}
          </DialogTitle>
          <DialogDescription>
            {row.customerName} · {row.items.length} aparelho(s)
          </DialogDescription>
        </DialogHeader>
        <fieldset disabled={busy || pending} className="min-w-0 space-y-4">
          {mode === 'deadline' && (
            <label className={fieldClass} htmlFor="reservation-new-deadline">
              Novo prazo (Brasília)
              <Input
                id="reservation-new-deadline"
                type="datetime-local"
                onInput={(e) => setDeadline(e.currentTarget.value)}
                value={deadline}
                onChange={(e) => setDeadline(e.target.value)}
              />
            </label>
          )}
          {mode === 'release' && (
            <p className="text-sm">
              Todos os aparelhos desta reserva voltarão a ficar disponíveis. A
              reserva continuará no histórico como liberada.
            </p>
          )}
          {mode === 'sale' && (
            <>
              <p className="rounded-xl bg-primary/5 p-3 text-sm">
                Confira os preços antes de concluir. Os aparelhos serão baixados
                do estoque e a venda ficará no nome de{' '}
                <strong>{data.user.displayName}</strong>.
              </p>
              {row.items.map((item, i) => (
                <div
                  key={item.unitId}
                  className="grid gap-2 rounded-xl border p-3 text-sm"
                >
                  <span className="font-bold">
                    {item.product} · {item.detail}
                  </span>
                  <span className="break-all font-mono text-xs text-muted-foreground">
                    SN {item.serial}
                  </span>
                  <span>Preço de venda (R$)</span>
                  <Input
                    aria-label={`Preço do SN ${item.serial}`}
                    inputMode="decimal"
                    value={prices[i]}
                    onFocus={(e) => e.currentTarget.select()}
                    onChange={(e) =>
                      setPrices((old) =>
                        old.map((v, j) => (i === j ? e.target.value : v)),
                      )
                    }
                  />
                  <span className="font-semibold">
                    Fotos do aparelho (obrigatório, até 6)
                  </span>
                  <input
                    type="file"
                    className="w-full min-w-0 rounded-lg border bg-background p-2 text-sm file:mr-2 file:rounded file:border-0 file:bg-primary/10 file:px-2 file:py-1 file:text-primary"
                    accept="image/*"
                    multiple
                    aria-label={`Fotos do SN ${item.serial}`}
                    onChange={(e) => {
                      const files = Array.from(e.target.files ?? []);
                      if (files.length > 6) {
                        setError('Selecione até 6 fotos por aparelho.');
                        e.target.value = '';
                        return;
                      }
                      setError('');
                      setPhotos((old) =>
                        old.map((v, j) => (j === i ? files : v)),
                      );
                    }}
                  />
                </div>
              ))}
              <div className="flex justify-between rounded-xl bg-primary/5 p-3 font-extrabold">
                <span>Valor da venda</span>
                <span>{money(amount)}</span>
              </div>
              <label className={fieldClass} htmlFor="reservation-cash">
                Dinheiro recebido (opcional)
                <Input
                  id="reservation-cash"
                  inputMode="decimal"
                  value={cash}
                  onChange={(e) => setCash(e.target.value)}
                  placeholder="Deixe vazio se não recebeu dinheiro"
                />
              </label>
              {cash.trim() && parseMoneyInput(cash) <= 0 && (
                <p role="alert" className="text-sm text-destructive">
                  Informe um valor de dinheiro válido ou deixe o campo vazio.
                </p>
              )}
              <p className="text-sm text-muted-foreground">
                O Pix vem da leitura do comprovante. Você pode anexar agora ou
                depois, em Vendas.
              </p>
              <label htmlFor="reservation-receipts" className={fieldClass}>
                Comprovantes (opcional, até 8)
                <input
                  id="reservation-receipts"
                  className="w-full min-w-0 rounded-lg border bg-background p-2 text-sm file:mr-2 file:rounded file:border-0 file:bg-primary/10 file:px-2 file:py-1 file:text-primary"
                  type="file"
                  accept="image/*,application/pdf"
                  multiple
                  onChange={(e) => {
                    const files = Array.from(e.target.files ?? []);
                    if (files.length > 8) {
                      setError('Selecione até 8 comprovantes.');
                      e.target.value = '';
                      return;
                    }
                    setError('');
                    setReceipts(files);
                  }}
                />
              </label>
            </>
          )}
        </fieldset>
        {error && (
          <p
            role="alert"
            className="rounded-xl bg-destructive/10 p-3 text-sm text-destructive"
          >
            {error}
            {pending &&
              ' Não refaça a venda. Acompanhe a confirmação em Envios deste aparelho.'}
          </p>
        )}
        <DialogFooter>
          <Button variant="outline" disabled={busy} onClick={onClose}>
            Voltar
          </Button>
          <Button
            disabled={
              busy ||
              pending ||
              (mode === 'sale' &&
                (photos.some((files) => files.length === 0) ||
                  prices.some((v) => parseMoneyInput(v) <= 0) ||
                  (Boolean(cash.trim()) && parseMoneyInput(cash) <= 0)))
            }
            onClick={() => void save()}
          >
            {busy
              ? 'Salvando…'
              : mode === 'sale'
                ? 'Confirmar venda'
                : mode === 'deadline'
                  ? 'Salvar prazo'
                  : 'Confirmar liberação'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
