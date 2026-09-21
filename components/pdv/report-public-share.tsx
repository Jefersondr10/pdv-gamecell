'use client';
import { useState } from 'react';
import { Link2, LoaderCircle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { messageOf, requestJson } from '@/lib/client-api';
import { reportDate } from '@/lib/financial-report';
import type { SalesPdfOptions } from '@/lib/sales-report-pdf';
type Share = {
  id: string;
  title: string;
  url: string;
  expiresAt: number;
  revokedAt: number | null;
};
export function ReportPublicShare({
  options,
  csrfToken,
  disabled,
  canCreate,
  onBusyChange,
}: {
  options: SalesPdfOptions;
  csrfToken: string;
  disabled: boolean;
  canCreate: boolean;
  onBusyChange: (busy: boolean) => void;
}) {
  const [open, setOpen] = useState(false),
    [consent, setConsent] = useState(false),
    [hours, setHours] = useState('24');
  const [busy, setBusy] = useState(false),
    [error, setError] = useState(''),
    [shares, setShares] = useState<Share[]>([]),
    [created, setCreated] = useState<Share | null>(null);
  const [checkedAt, setCheckedAt] = useState(() => Date.now());
  const [operation, setOperation] = useState(() => crypto.randomUUID());
  async function refresh() {
    setCheckedAt(Date.now());
    try {
      setShares(
        (await requestJson<{ items: Share[] }>('/api/report-shares')).items,
      );
    } catch (e) {
      setError(messageOf(e));
    }
  }
  return (
    <>
      <Button
        variant="outline"
        disabled={disabled}
        onClick={() => {
          setOpen(true);
          setCreated(null);
          setConsent(false);
          setError('');
          setOperation(crypto.randomUUID());
          void refresh();
        }}
      >
        <Link2 />
        Link público
      </Button>
      <Dialog
        open={open}
        onOpenChange={(value) => {
          if (!busy) setOpen(value);
        }}
      >
        <DialogContent
          className="max-h-[90dvh] overflow-y-auto sm:max-w-xl"
          showCloseButton={!busy}
        >
          <DialogHeader>
            <DialogTitle>Compartilhar relatório</DialogTitle>
            <DialogDescription>
              Uma cópia fixa do relatório, sem acesso ao restante do sistema.
            </DialogDescription>
          </DialogHeader>
          <label className="grid gap-2 text-sm font-bold">
            Validade do link
            <select
              className="h-10 rounded-lg border bg-background px-3"
              disabled={busy || Boolean(created)}
              value={hours}
              onChange={(e) => {
                setHours(e.target.value);
                setOperation(crypto.randomUUID());
              }}
            >
              <option value="1">1 hora</option>
              <option value="24">24 horas</option>
              <option value="168">7 dias</option>
            </select>
          </label>
          <label className="flex items-start gap-3 rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-950">
            <input
              className="mt-1"
              type="checkbox"
              disabled={busy}
              checked={consent}
              onChange={(e) => setConsent(e.target.checked)}
            />
            <span>
              Permitir que qualquer pessoa com o link leia este relatório,
              incluindo dados de clientes, pagamentos e os anexos selecionados.
            </span>
          </label>
          <p className="text-xs text-muted-foreground">
            O acesso termina no prazo escolhido ou ao revogar. Arquivos que
            alguém já baixou não podem ser recolhidos.
          </p>
          {error && (
            <p role="alert" className="text-sm font-bold text-destructive">
              {error}
            </p>
          )}
          {!created ? (
            <Button
              disabled={busy || !consent || !canCreate}
              onClick={async () => {
                setBusy(true);
                onBusyChange(true);
                setError('');
                try {
                  const { buildSalesReportPdf } =
                    await import('@/lib/sales-report-pdf');
                  const bytes = await buildSalesReportPdf(options);
                  const form = new FormData();
                  form.set(
                    'file',
                    new File([bytes as BlobPart], 'relatorio.pdf', {
                      type: 'application/pdf',
                    }),
                  );
                  form.set(
                    'title',
                    `${options.kind === 'financial' ? 'Relatório financeiro' : 'Relatório de vendas'} · ${options.filterSummary || 'Período selecionado'}`.slice(
                      0,
                      120,
                    ),
                  );
                  form.set('hours', hours);
                  form.set('consent', 'public');
                  form.set('operationId', operation);
                  const item = await requestJson<Share>('/api/report-shares', {
                    method: 'POST',
                    headers: { 'x-csrf-token': csrfToken },
                    body: form,
                  });
                  setCreated(item);
                  await refresh();
                } catch (e) {
                  setError(messageOf(e));
                } finally {
                  setBusy(false);
                  onBusyChange(false);
                }
              }}
            >
              {busy ? <LoaderCircle className="animate-spin" /> : <Link2 />}
              {busy ? 'Preparando relatório…' : 'Criar link público'}
            </Button>
          ) : (
            <div className="rounded-xl border border-emerald-300 bg-emerald-50 p-3">
              <p className="mb-2 text-sm font-bold text-emerald-800">
                Link criado · válido até {reportDate(created.expiresAt)}
              </p>
              <Input
                aria-label="Link público criado"
                readOnly
                value={created.url}
                onFocus={(e) => e.target.select()}
              />
            </div>
          )}
          <section className="mt-3 border-t pt-4">
            <h3 className="mb-3 font-extrabold">Links recentes da loja</h3>
            <div className="space-y-3">
              {shares.map((item) => {
                const active = !item.revokedAt && item.expiresAt > checkedAt;
                return (
                  <div key={item.id} className="rounded-xl border p-3">
                    <p className="text-sm font-bold">{item.title}</p>
                    <p className="mt-1 text-xs text-muted-foreground">
                      {item.revokedAt
                        ? 'Revogado'
                        : active
                          ? `Válido até ${reportDate(item.expiresAt)}`
                          : 'Expirado'}
                    </p>
                    {active && (
                      <>
                        <Input
                          className="mt-2"
                          aria-label={`Link ${item.title}`}
                          readOnly
                          value={item.url}
                          onFocus={(e) => e.target.select()}
                        />
                        <Button
                          className="mt-2"
                          variant="outline"
                          size="sm"
                          disabled={busy}
                          onClick={async () => {
                            setBusy(true);
                            onBusyChange(true);
                            try {
                              await requestJson('/api/report-shares', {
                                method: 'DELETE',
                                headers: {
                                  'content-type': 'application/json',
                                  'x-csrf-token': csrfToken,
                                },
                                body: JSON.stringify({ id: item.id }),
                              });
                              if (created?.id === item.id) {
                                setCreated(null);
                                setConsent(false);
                                setOperation(crypto.randomUUID());
                              }
                              await refresh();
                            } catch (e) {
                              setError(messageOf(e));
                            } finally {
                              setBusy(false);
                              onBusyChange(false);
                            }
                          }}
                        >
                          Revogar acesso
                        </Button>
                      </>
                    )}
                  </div>
                );
              })}
            </div>
          </section>
        </DialogContent>
      </Dialog>
    </>
  );
}
