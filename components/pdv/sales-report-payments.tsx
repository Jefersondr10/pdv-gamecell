import type { SalesPaymentSummary } from '@/lib/sales-payment-summary';

const money = (cents: number) =>
  (cents / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

export function SalesReportPayments({
  summary,
}: {
  summary: SalesPaymentSummary;
}) {
  return (
    <section className="report-section mt-3 rounded-xl border border-slate-200 bg-white p-3 sm:p-4">
      <h3 className="text-base font-extrabold">Onde foi recebido</h3>
      <p className="mt-1 text-xs text-slate-500">
        Pagamentos informados das vendas deste relatório. Não confirma crédito
        no banco.
      </p>
      <dl className="mt-3 grid gap-x-6 sm:grid-cols-2">
        {summary.groups.map((group) => (
          <div
            className="report-row flex items-start justify-between gap-3 border-b border-slate-100 py-2 text-sm"
            key={group.key}
          >
            <dt className="min-w-0 break-words text-slate-700">
              {group.label}
              {group.aliases.length > 0 && (
                <span className="mt-1 block text-xs text-slate-500">
                  Outros nomes no período: {group.aliases.join(', ')}
                </span>
              )}
            </dt>
            <dd className="shrink-0 font-bold tabular-nums text-slate-950">
              {money(group.amountCents)}
            </dd>
          </div>
        ))}
      </dl>
      {summary.groups.length === 0 && (
        <p className="mt-3 text-sm text-slate-600">
          Nenhum pagamento informado.
        </p>
      )}
      <dl className="mt-3 space-y-2 rounded-lg bg-slate-100 px-3 py-2 text-sm">
        <div className="flex flex-wrap justify-between gap-x-4 gap-y-1 font-extrabold text-slate-950">
          <dt>Total recebido informado</dt>
          <dd className="tabular-nums">{money(summary.receivedCents)}</dd>
        </div>
        {summary.outstandingCents > 0 && (
          <div className="flex flex-wrap justify-between gap-x-4 gap-y-1 font-bold text-rose-800">
            <dt>Falta receber</dt>
            <dd className="tabular-nums">{money(summary.outstandingCents)}</dd>
          </div>
        )}
        {summary.excessCents > 0 && (
          <div className="flex flex-wrap justify-between gap-x-4 gap-y-1 font-bold text-amber-900">
            <dt>Recebido a mais</dt>
            <dd className="tabular-nums">{money(summary.excessCents)}</dd>
          </div>
        )}
      </dl>
      {summary.outstandingCents > 0 && summary.excessCents > 0 && (
        <p className="mt-2 text-xs text-slate-600">
          As diferenças são conferidas por venda: um valor a mais não quita
          outra venda.
        </p>
      )}
      {summary.inconsistentSaleCount > 0 && (
        <p className="mt-2 rounded-lg bg-amber-50 p-2 text-sm font-semibold text-amber-950">
          Conferir pagamentos de {summary.inconsistentSaleCount} venda(s): o
          detalhamento não corresponde ao total recebido salvo. Total detalhado:{' '}
          {money(summary.detailedCents)}.
        </p>
      )}
    </section>
  );
}
