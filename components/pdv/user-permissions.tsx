'use client';

import { useRef, useState } from 'react';
import { ShieldCheck } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog';
import {
  PERMISSION_GROUPS,
  PERMISSION_PARENTS,
  defaultPermissions,
  type Permission,
} from '@/lib/permissions';
import { messageOf, requestJson } from '@/lib/client-api';
import type { UserRecord } from '@/lib/pdv-types';

export function PermissionFields({
  role,
  value,
  onChange,
  disabled = false,
}: {
  role: UserRecord['role'];
  value: Permission[];
  onChange: (value: Permission[]) => void;
  disabled?: boolean;
}) {
  return (
    <div className="grid gap-3">
      {PERMISSION_GROUPS.map((group) => (
        <fieldset
          key={group.label}
          className="rounded-xl border bg-background p-3"
          disabled={disabled}
        >
          <legend className="px-1 text-sm font-bold">{group.label}</legend>
          {group.items.map(([key, label]) => (
            <label
              key={key}
              className="flex min-h-11 cursor-pointer items-center gap-3 rounded-lg px-2 py-2 text-sm hover:bg-muted/40"
            >
              <Checkbox
                className="size-5"
                disabled={
                  disabled || (key === 'users.manage' && role !== 'admin')
                }
                checked={value.includes(key)}
                onCheckedChange={(checked) => {
                  const next = new Set(value);
                  if (checked) {
                    next.add(key);
                    for (const parent of PERMISSION_PARENTS[key] ?? [])
                      next.add(parent);
                  } else {
                    next.delete(key);
                    for (const [child, parents] of Object.entries(
                      PERMISSION_PARENTS,
                    ))
                      if (parents.includes(key))
                        next.delete(child as Permission);
                  }
                  onChange([...next]);
                }}
              />
              <span>{label}</span>
            </label>
          ))}
        </fieldset>
      ))}
    </div>
  );
}

export function UserPermissionsDialog({
  user,
  csrfToken,
  onClose,
  onChanged,
}: {
  user: UserRecord;
  csrfToken: string;
  onClose: () => void;
  onChanged: () => Promise<void>;
}) {
  const [value, setValue] = useState(
    () => user.permissions ?? defaultPermissions(user.role),
  );
  const [expected] = useState(
    () => user.permissions ?? defaultPermissions(user.role),
  );
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState('');
  const sending = useRef(false);
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open && !sending.current) onClose();
      }}
    >
      <DialogContent
        showCloseButton={!busy}
        className="flex max-h-[92dvh] max-w-2xl flex-col overflow-hidden p-0"
      >
        <DialogHeader className="border-b p-4 pr-12">
          <DialogTitle className="flex items-center gap-2">
            <ShieldCheck className="size-5" /> Acessos de {user.displayName}
          </DialogTitle>
          <DialogDescription>
            Escolha os menus e as ações liberados. Ao salvar, este usuário
            precisará entrar novamente.
          </DialogDescription>
        </DialogHeader>
        <div className="min-h-0 flex-1 space-y-3 overflow-y-auto p-4">
          {error && (
            <p
              role="alert"
              className="rounded-xl bg-destructive/10 p-3 text-sm text-destructive"
            >
              {error}
            </p>
          )}
          {saved && (
            <p className="text-sm text-success">
              Permissões salvas. Falta apenas atualizar a lista.
            </p>
          )}
          <PermissionFields
            role={user.role}
            value={value}
            onChange={setValue}
            disabled={busy || saved}
          />
        </div>
        <DialogFooter className="border-t p-4">
          <Button variant="outline" disabled={busy} onClick={onClose}>
            Fechar
          </Button>
          <Button
            disabled={busy}
            onClick={async () => {
              if (sending.current) return;
              sending.current = true;
              setBusy(true);
              setError('');
              try {
                if (!saved) {
                  await requestJson(`/api/users/${user.id}`, {
                    method: 'PATCH',
                    headers: {
                      'content-type': 'application/json',
                      'x-csrf-token': csrfToken,
                    },
                    body: JSON.stringify({
                      permissions: value,
                      expectedPermissions: expected,
                    }),
                  });
                  setSaved(true);
                }
                await onChanged();
                onClose();
              } catch (caught) {
                setError(messageOf(caught));
              } finally {
                sending.current = false;
                setBusy(false);
              }
            }}
          >
            {busy ? 'Salvando…' : saved ? 'Atualizar lista' : 'Salvar acessos'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
