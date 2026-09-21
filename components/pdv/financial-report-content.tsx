'use client';
import type { SaleRecord } from '@/lib/pdv-types';
import {
  reportMoney,
  summarizeFinancialReport,
  type ReportDateBasis,
} from '@/lib/financial-report';
import { Button } from '@/components/ui/button';

export function FinancialReportContent({
  sales,
  basis,
  filters,
  generatedAt,
  level,
  onOpenSale,
}: {
  sales: SaleRecord[];
  basis: ReportDateBasis;
  filters: string;
  generatedAt: number;
  level: 'simple' | 'detailed' | 'complete';
  onOpenSale: (sale: SaleRecord) => void;
}) {
  const summary = summarizeFinancialReport(sales, basis, filters, generatedAt);
  return (
    <div className="space-y-6 pt-5">
      <section aria-label="Resumo financeiro" className="space-y-3">
        <div className="rounded-2xl bg-emerald-700 p-5 text-white">
          <p className="text-xs font-bold uppercase tracking-widest">
            Total recebido
          </p>
          <p className="mt-2 text-3xl font-black tabular-nums">
            {reportMoney(summary.totalCents)}
          </p>
        </div>
        <div className="grid grid-cols-2 gap-3">
          {[
            ['Pix', summary.pixCents],
            ['Dinheiro', summary.cashCents],
          ].map(([label, value]) => (
            <div key={label} className="rounded-xl border p-4">
              <p className="text-sm font-bold text-slate-500">{label}</p>
              <p className="mt-1 text-lg font-black tabular-nums text-emerald-700">
                {reportMoney(Number(value))}
              </p>
            </div>
          ))}
        </div>
        <p className="text-xs leading-relaxed text-slate-500">
          {basis === 'receipt'
            ? 'Período pela data identificada do recebimento. Para dinheiro, usamos a data de registro no sistema.'
            : 'Pagamentos das vendas do período, inclusive os recebidos em outra data.'}{' '}
          Canceladas não entram nos totais. A leitura do documento não confirma
          crédito no banco.
        </p>
        {summary.undatedCount > 0 && (
          <p className="rounded-xl border border-amber-300 bg-amber-50 p-3 text-sm font-bold text-amber-900">
            {summary.undatedCount} recebimento(s) sem data identificada:{' '}
            {reportMoney(summary.undatedCents)}, fora deste total. Escolha “Data
            da venda” para consultá-los.
          </p>
        )}
      </section>
      <section>
        <h3 className="text-lg font-extrabold">Recebimentos por destino</h3>
        <p className="mt-1 text-xs text-slate-500">
          Quando a conta não foi identificada, agrupamos por recebedor e banco.
        </p>
        <div className="mt-3 space-y-3">
          {summary.groups.map((group) => (
            <div className="rounded-xl border p-4" key={group.key}>
              <div className="flex flex-wrap items-start justify-between gap-2">
                <strong>{group.recipient}</strong>
                <strong className="text-emerald-700 tabular-nums">
                  {reportMoney(group.amountCents)}
                </strong>
              </div>
              <p className="mt-1 text-sm text-slate-600">
                {group.method === 'cash' ? 'Dinheiro' : group.bank}
              </p>
              {group.method === 'pix' && (
                <p className="mt-1 text-xs text-slate-500">
                  {group.account
                    ? `Conta ${group.account}`
                    : 'Conta não identificada'}
                </p>
              )}
              <p className="mt-2 text-xs text-slate-500">
                {group.count} recebimento(s)
              </p>
            </div>
          ))}
        </div>
      </section>
      {level !== 'simple' && (
        <section>
          <h3 className="text-lg font-extrabold">Recebimentos por venda</h3>
          <div className="mt-3 space-y-4">
            {summary.saleGroups.map((group) => (
              <article
                key={group.saleId}
                aria-label={`Recebimentos da venda ${group.saleNumber}`}
                className="overflow-hidden rounded-2xl border border-slate-200"
              >
                <header className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 bg-slate-50 px-4 py-4">
                  <div>
                    <Button
                      variant="link"
                      className="h-auto p-0 font-extrabold"
                      onClick={() => {
                        const sale = sales.find((s) => s.id === group.saleId);
                        if (sale) onOpenSale(sale);
                      }}
                    >
                      Venda #{String(group.saleNumber).padStart(5, '0')}
                    </Button>
                    <p className="mt-1 text-xs font-semibold text-slate-500">
                      {group.rows.length}{' '}
                      {group.rows.length === 1 ? 'recebimento' : 'recebimentos'}
                    </p>
                  </div>
                  <div className="text-right">
                    <p className="text-xs font-semibold text-slate-500">
                      Recebido neste relatório
                    </p>
                    <strong className="mt-1 block text-lg text-emerald-700 tabular-nums">
                      {reportMoney(group.amountCents)}
                    </strong>
                  </div>
                </header>
                <div className="divide-y divide-slate-200">
                  {group.rows.map((row, index) => (
                    <div key={row.id} className="space-y-3 p-4">
                      <div className="flex items-center justify-between gap-3">
                        <p className="flex items-center gap-2 font-bold">
                          <span className="grid size-6 shrink-0 place-items-center rounded-full bg-slate-100 text-xs text-slate-500">
                            {index + 1}
                          </span>
                          {row.method === 'pix' ? 'Pix' : 'Dinheiro'}
                        </p>
                        <strong className="shrink-0 text-emerald-700 tabular-nums">
                          {reportMoney(row.amountCents)}
                        </strong>
                      </div>
                      <p className="text-xs font-semibold text-slate-500">
                        {row.method === 'cash' ? 'Registro: ' : ''}
                        {row.date || 'Data não identificada'} ·{' '}
                        {row.time || 'Hora não identificada'}
                      </p>
                      {row.method === 'pix' && (
                        <>
                          <div className="rounded-lg bg-blue-50 p-3">
                            <p className="text-xs font-bold uppercase text-blue-700">
                              Recebedor
                            </p>
                            <p className="mt-1 font-bold">{row.recipient}</p>
                            <p className="text-sm">{row.bank}</p>
                            <p className="mt-1 text-xs text-slate-500">
                              {row.account
                                ? `Conta ${row.account}`
                                : 'Conta não identificada'}
                            </p>
                          </div>
                          <div className="rounded-lg bg-slate-50 p-3">
                            <p className="text-xs font-bold uppercase text-slate-500">
                              Pagador
                            </p>
                            <p className="mt-1 text-sm font-semibold">
                              {row.payer}
                            </p>
                            <p className="text-xs text-slate-500">
                              {row.payerBank}
                            </p>
                          </div>
                          {level === 'complete' && (
                            <p className="break-all text-xs text-slate-500">
                              Identificador:{' '}
                              {row.transactionId || 'Não identificado'}
                            </p>
                          )}
                        </>
                      )}
                    </div>
                  ))}
                </div>
              </article>
            ))}
          </div>
        </section>
      )}
      {!summary.rows.length && (
        <p className="rounded-xl bg-slate-50 p-5 text-center text-slate-500">
          Nenhum recebimento identificado neste período.
        </p>
      )}
    </div>
  );
}
