'use client';
import { useEffect, useState } from 'react';
import { ShieldCheck } from 'lucide-react';
import { requestJson } from '@/lib/client-api';
import type { BackupStatus } from '@/lib/backup-status';

export function BackupStatusCard({
  alertOnly = false,
}: {
  alertOnly?: boolean;
}) {
  const [status, setStatus] = useState<BackupStatus | null>(null);
  useEffect(() => {
    let alive = true;
    const refresh = () => {
      if (document.hidden) return;
      void requestJson<BackupStatus>('/api/system/backup-status')
        .then((value) => {
          if (alive) setStatus(value);
        })
        .catch(() => {
          if (alive)
            setStatus({
              state: 'unknown',
              lastSuccessAt: null,
              externalAlerts: false,
            });
        });
    };
    refresh();
    const timer = setInterval(refresh, 60_000);
    return () => {
      alive = false;
      clearInterval(timer);
    };
  }, []);
  if (!status || (alertOnly && status.state === 'healthy')) return null;
  const title = {
    healthy: 'Backup externo em dia',
    warning: 'Backup precisa de atenção',
    late: 'Backup externo atrasado',
    failed: 'A última tentativa de backup falhou',
    unknown: 'Status do backup indisponível',
  }[status.state];
  if (alertOnly)
    return (
      <div
        className="shrink-0 border-b bg-amber-50 px-4 py-2 text-xs text-amber-950"
        role="alert"
      >
        {title}. Consulte Ajustes › Sistema.
      </div>
    );
  return (
    <section className="rounded-xl border bg-card p-4 text-sm">
      <div className="flex items-center gap-2 font-semibold">
        <ShieldCheck className="size-5" />
        {title}
      </div>
      <p className="mt-2 text-muted-foreground">
        {status.lastSuccessAt
          ? `Última cópia externa confirmada: ${new Date(status.lastSuccessAt).toLocaleString('pt-BR')}.`
          : 'Não foi possível confirmar uma cópia externa recente.'}
      </p>
      <p className="mt-2 text-xs text-muted-foreground">
        {status.externalAlerts
          ? 'Alertas externos ativados.'
          : 'Alertas externos ainda não ativados. Este aviso só aparece enquanto você acessa o sistema.'}
      </p>
    </section>
  );
}
