'use client';

import { Button } from '@/components/ui/button';
import type { OperationKind } from '@/lib/client-operation-recovery';

export function PendingOperationNotice({
  kind,
  onOpenMenu,
}: {
  kind: OperationKind;
  onOpenMenu?: () => void;
}) {
  return (
    <section className="m-4 space-y-4 rounded-2xl border bg-card p-5">
      <h2 className="font-bold">
        {kind === 'sale' ? 'Venda' : 'Entrada'} aguardando confirmação
      </h2>
      <p className="text-sm">
        O envio está guardado neste aparelho. Você pode acessar as outras áreas
        pelo menu enquanto resolve a pendência em Envios.
      </p>
      <p className="text-sm font-semibold text-amber-800">
        Não refaça esta operação nem use os mesmos aparelhos em outro envio.
      </p>
      <div className="flex flex-wrap gap-2">
        <Button
          onClick={() => window.dispatchEvent(new Event('pdv:show-operations'))}
        >
          Acompanhar envio
        </Button>
        {onOpenMenu && (
          <Button variant="outline" onClick={onOpenMenu}>
            Abrir menu da loja
          </Button>
        )}
      </div>
    </section>
  );
}
