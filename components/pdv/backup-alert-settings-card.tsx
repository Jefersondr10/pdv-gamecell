'use client';

import { useEffect, useState } from 'react';
import { Mail } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { messageOf, requestJson } from '@/lib/client-api';
import {
  normalizeBackupAlertEmail,
  type BackupAlertSettings,
} from '@/lib/backup-alert-settings';

export function BackupAlertSettingsCard({ csrfToken }: { csrfToken: string }) {
  const [settings, setSettings] = useState<BackupAlertSettings | null>(null);
  const [email, setEmail] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [reload, setReload] = useState(0);
  useEffect(() => {
    let alive = true;
    void requestJson<BackupAlertSettings>('/api/system/backup-alert-settings')
      .then((value) => {
        if (!alive) return;
        setSettings(value);
        setEmail(value.email ?? '');
        setError('');
      })
      .catch((error) => {
        if (alive) setError(messageOf(error));
      });
    return () => {
      alive = false;
    };
  }, [reload]);
  async function save(event: React.SyntheticEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!settings || saving) return;
    setError('');
    setMessage('');
    try {
      normalizeBackupAlertEmail(email);
      setSaving(true);
      const saved = await requestJson<BackupAlertSettings>(
        '/api/system/backup-alert-settings',
        {
          method: 'PATCH',
          headers: {
            'content-type': 'application/json',
            'x-csrf-token': csrfToken,
          },
          body: JSON.stringify({ email, revision: settings.revision }),
        },
      );
      setSettings(saved);
      setEmail(saved.email ?? '');
      setMessage(
        saved.email
          ? 'E-mail salvo. O envio automático ainda aguarda ativação.'
          : 'Destino removido. Esta loja não receberá alertas por e-mail.',
      );
    } catch (error) {
      setError(messageOf(error));
    } finally {
      setSaving(false);
    }
  }
  return (
    <section className="rounded-xl border bg-card p-4 text-sm">
      <div className="flex items-center gap-2 font-semibold">
        <Mail className="size-5" />
        Alertas de backup por e-mail
      </div>
      <p className="mt-2 text-muted-foreground">
        Destino desta loja. Somente o proprietário pode alterar.
      </p>
      <form onSubmit={save} className="mt-4 space-y-3">
        <div className="space-y-2">
          <Label htmlFor="backup-alert-email">E-mail para avisos</Label>
          <Input
            id="backup-alert-email"
            type="email"
            autoComplete="email"
            inputMode="email"
            maxLength={254}
            placeholder="voce@exemplo.com"
            value={email}
            disabled={!settings || saving}
            onChange={(event) => {
              setEmail(event.target.value);
              setMessage('');
            }}
            aria-describedby="backup-email-help"
          />
          <p id="backup-email-help" className="text-xs text-muted-foreground">
            Deixe em branco e salve para não receber os avisos.
          </p>
        </div>
        <div className="rounded-lg bg-muted/60 px-3 py-2 text-xs text-muted-foreground">
          Envio automático ainda não ativado. Salvar o endereço não ativa o
          serviço. Os avisos dentro do aplicativo continuam disponíveis.
        </div>
        {error && (
          <div role="alert" className="space-y-2">
            <p className="text-destructive">{error}</p>
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={saving}
              onClick={() => setReload((value) => value + 1)}
            >
              Recarregar configuração
            </Button>
          </div>
        )}
        {message && (
          <output className="block text-muted-foreground">{message}</output>
        )}
        <Button
          type="submit"
          disabled={!settings || saving || email === (settings.email ?? '')}
        >
          {saving ? 'Salvando…' : !settings ? 'Carregando…' : 'Salvar e-mail'}
        </Button>
      </form>
    </section>
  );
}
