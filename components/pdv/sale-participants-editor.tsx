'use client';

import { useEffect, useRef, useState } from 'react';
import { LoaderCircle, UsersRound } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  Combobox,
  ComboboxInput,
  ComboboxContent,
  ComboboxEmpty,
  ComboboxItem,
  ComboboxList,
} from '@/components/ui/combobox';
import { ApiError, requestJson, messageOf } from '@/lib/client-api';
import { createOperationId } from '@/lib/client-operation-id';
import type {
  ParticipantChoice,
  SaleParticipants,
  SaleParticipantsResponse,
} from '@/lib/sale-participants';

export function useSaleParticipants(
  saleId: string | undefined,
  enabled: boolean,
  csrfToken: string,
) {
  const [data, setData] = useState<SaleParticipantsResponse | null>(null);
  const [customerId, setCustomerId] = useState<string | null>(null);
  const [sellerUserId, setSellerId] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [revision, setRevision] = useState(0);
  const operationId = useRef(createOperationId());
  useEffect(() => {
    if (!saleId || !enabled) return;
    let ignore = false;
    const controller = new AbortController();
    const timer = window.setTimeout(() => {
      setLoading(true);
      setData(null);
      setError('');
      void requestJson<SaleParticipantsResponse>(
        `/api/sales/${saleId}/participants`,
        { signal: controller.signal },
      )
        .then((result) => {
          if (ignore) return;
          setData(result);
          setCustomerId(result.current.customerId);
          setSellerId(result.current.sellerUserId);
          operationId.current = createOperationId();
        })
        .catch((caught) => {
          if (!ignore) setError(messageOf(caught));
        })
        .finally(() => {
          if (!ignore) setLoading(false);
        });
    }, 0);
    return () => {
      ignore = true;
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [saleId, enabled, revision]);
  const dirty = Boolean(
    enabled &&
    data &&
    (data.current.customerId !== customerId ||
      data.current.sellerUserId !== sellerUserId),
  );
  return {
    data,
    customerId,
    sellerUserId,
    loading,
    error,
    dirty,
    reload: () => setRevision((value) => value + 1),
    setCustomerId: (id: string | null) => {
      operationId.current = createOperationId();
      setCustomerId(id);
    },
    setSellerId: (id: string) => {
      operationId.current = createOperationId();
      setSellerId(id);
    },
    async save() {
      if (!dirty || !data || !saleId) return false;
      let result: { current: SaleParticipants };
      try {
        result = await requestJson<{ current: SaleParticipants }>(
          `/api/sales/${saleId}/participants`,
          {
            method: 'PATCH',
            headers: {
              'content-type': 'application/json',
              'x-csrf-token': csrfToken,
            },
            body: JSON.stringify({
              operationId: operationId.current,
              expected: {
                customerId: data.current.customerId,
                sellerUserId: data.current.sellerUserId,
                revision: data.current.revision,
              },
              customerId,
              sellerUserId,
            }),
          },
        );
      } catch (caught) {
        if (
          caught instanceof ApiError &&
          [
            'SALE_CHANGED',
            'SALE_CANCELLED',
            'CUSTOMER_INVALID',
            'SELLER_INVALID',
            'OPERATION_ALREADY_USED',
          ].includes(caught.code ?? '')
        ) {
          setRevision((value) => value + 1);
        }
        throw caught;
      }
      setData({ ...data, current: result.current });
      setCustomerId(result.current.customerId);
      setSellerId(result.current.sellerUserId);
      operationId.current = createOperationId();
      return true;
    },
  };
}

export function SaleParticipantsEditor({
  editor,
  disabled,
}: {
  editor: ReturnType<typeof useSaleParticipants>;
  disabled: boolean;
}) {
  const { data } = editor;
  const clients = data ? [...data.clients] : [];
  if (data && !clients.some((client) => client.id === data.current.customerId))
    clients.unshift({
      id: data.current.customerId ?? '',
      name: `${data.current.customerName} (atual)`,
    });
  const sellers = data ? [...data.sellers] : [];
  if (
    data &&
    !sellers.some((seller) => seller.id === data.current.sellerUserId)
  )
    sellers.unshift({
      id: data.current.sellerUserId,
      name: `${data.current.sellerName} (atual)`,
    });
  return (
    <section className="rounded-2xl border p-4">
      <div className="flex items-start gap-3">
        <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-secondary text-primary">
          <UsersRound className="size-5" />
        </span>
        <div>
          <h3 className="font-extrabold">Cliente e vendedor</h3>
          <p className="text-sm text-muted-foreground">
            A troca atualiza o histórico de compras e os rankings.
          </p>
        </div>
      </div>
      {editor.loading ? (
        <output className="mt-3 flex items-center gap-2 text-sm">
          <LoaderCircle className="size-4 animate-spin" />
          Carregando cadastros…
        </output>
      ) : editor.error ? (
        <div className="mt-3 text-sm">
          <p role="alert">{editor.error}</p>
          <Button
            className="mt-2"
            onClick={editor.reload}
            disabled={disabled}
            variant="outline"
          >
            Tentar novamente
          </Button>
        </div>
      ) : (
        data && (
          <>
            <div className="mt-3 grid gap-3 sm:grid-cols-2">
              <ParticipantPicker
                label="Cliente da venda"
                options={clients}
                value={editor.customerId ?? ''}
                onChange={(id) => editor.setCustomerId(id || null)}
                disabled={disabled}
              />
              <ParticipantPicker
                label="Vendedor da venda"
                options={sellers}
                value={editor.sellerUserId}
                onChange={editor.setSellerId}
                disabled={disabled}
              />
            </div>
            <p className="mt-3 text-xs text-muted-foreground">
              Produtos, SNs e valores não mudam. Quem fez a alteração fica
              registrado.
            </p>
            {editor.dirty && (
              <p className="mt-2 text-sm font-semibold text-primary">
                Troca pendente. Use Salvar alterações para confirmar.
              </p>
            )}
          </>
        )
      )}
    </section>
  );
}

function ParticipantPicker({
  label,
  options,
  value,
  onChange,
  disabled,
}: {
  label: string;
  options: ParticipantChoice[];
  value: string;
  onChange: (id: string) => void;
  disabled: boolean;
}) {
  return (
    <div className="min-w-0 space-y-1.5">
      <p className="text-sm font-semibold">{label}</p>
      <Combobox
        items={options}
        value={options.find((option) => option.id === value) ?? null}
        itemToStringLabel={(item) => item.name}
        itemToStringValue={(item) => item.id}
        onValueChange={(item) => {
          if (item) onChange(item.id);
        }}
        disabled={disabled}
      >
        <ComboboxInput
          aria-label={label}
          placeholder="Pesquisar pelo nome…"
          className="h-11 w-full"
          disabled={disabled}
        />
        <ComboboxContent>
          <ComboboxEmpty>Nenhum cadastro encontrado.</ComboboxEmpty>
          <ComboboxList>
            {(item: ParticipantChoice) => (
              <ComboboxItem
                key={item.id}
                value={item}
                className="min-h-10 px-3 py-2 font-semibold"
              >
                {item.name}
              </ComboboxItem>
            )}
          </ComboboxList>
        </ComboboxContent>
      </Combobox>
    </div>
  );
}
