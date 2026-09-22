export const PERMISSION_GROUPS = [
  {
    label: 'Reservas',
    items: [
      ['reservations', 'Consultar reservas e aparelhos'],
      ['reservations.manage', 'Criar, alterar prazo e liberar reservas'],
    ],
  },
  {
    label: 'Vender',
    items: [
      ['sell', 'Acessar e finalizar novas vendas'],
      ['sell.assign', 'Escolher outro vendedor'],
    ],
  },
  {
    label: 'Estoque e entradas',
    items: [
      ['entry', 'Fazer novas entradas'],
      ['stock', 'Consultar estoque, fotos e relatórios'],
      ['entries', 'Consultar histórico de entradas'],
    ],
  },
  {
    label: 'Vendas registradas',
    items: [
      ['sales', 'Consultar vendas e relatórios'],
      [
        'sales.participants',
        'Alterar cliente e vendedor de vendas registradas',
      ],
      ['sales.date', 'Alterar data e hora de vendas registradas'],
      ['sales.payments', 'Adicionar e corrigir pagamentos'],
      ['sales.prices', 'Alterar preços de produtos em vendas realizadas'],
      ['sales.attachments', 'Anexar fotos e comprovantes'],
      ['sales.receipts', 'Corrigir valores e reler comprovantes'],
      ['sales.receipts.delete', 'Excluir comprovantes manualmente'],
      ['sales.status', 'Alterar status do pedido'],
      ['sales.cancel', 'Cancelar vendas'],
    ],
  },
  {
    label: 'Análise',
    items: [
      ['ranking', 'Acessar rankings'],
      ['overview', 'Acessar comprovantes e conferência de pagamentos'],
    ],
  },
  {
    label: 'Cadastros',
    items: [
      ['clients', 'Consultar clientes'],
      ['clients.history', 'Consultar histórico de compras do cliente'],
      ['clients.create', 'Cadastrar clientes, inclusive durante a venda'],
      ['clients.manage', 'Editar e desativar clientes'],
      ['products', 'Consultar produtos e códigos'],
      ['products.manage', 'Cadastrar, editar e desativar produtos e códigos'],
      ['finance', 'Consultar status cadastrados'],
      ['finance.manage', 'Gerenciar status do pedido'],
    ],
  },
  {
    label: 'Administração',
    items: [
      ['users.manage', 'Gerenciar funcionários (administradores)'],
      ['backup', 'Consultar a situação dos backups'],
    ],
  },
] as const;

export type Permission = (typeof PERMISSION_GROUPS)[number]['items'][number][0];
export const ALL_PERMISSIONS: Permission[] = PERMISSION_GROUPS.flatMap(
  (group) => group.items.map(([key]) => key),
);
type Role = 'owner' | 'admin' | 'operator';
export type PermissionSubject = {
  role: Role;
  permissions?: readonly Permission[];
};
const MANAGER_ONLY: Permission[] = [
  'sales.prices',
  'sales.date',
  'sales.receipts.delete',
  'sales.cancel',
  'sales.participants',
  'clients.manage',
  'products.manage',
  'finance.manage',
  'users.manage',
  'backup',
];
export const PERMISSION_PARENTS: Partial<
  Record<Permission, readonly Permission[]>
> = {
  'reservations.manage': ['reservations'],
  'sell.assign': ['sell'],
  'sales.payments': ['sales'],
  'sales.prices': ['sales'],
  'sales.date': ['sales'],
  'sales.attachments': ['sales'],
  'sales.receipts': ['sales'],
  'sales.receipts.delete': ['sales'],
  'sales.status': ['sales'],
  'sales.cancel': ['sales'],
  'sales.participants': ['sales'],
  'clients.history': ['clients'],
  'clients.manage': ['clients'],
  'products.manage': ['products'],
  'finance.manage': ['finance'],
};
export function defaultPermissions(role: Role): Permission[] {
  return ALL_PERMISSIONS.filter(
    (key) => role !== 'operator' || !MANAGER_ONLY.includes(key),
  );
}
export function resolvePermissions(
  role: Role,
  stored: string | null,
): Permission[] {
  if (role === 'owner' || stored === null) return defaultPermissions(role);
  try {
    const parsed: unknown = JSON.parse(stored);
    if (!Array.isArray(parsed)) return [];
    const values = parsed.filter((key): key is Permission =>
      ALL_PERMISSIONS.includes(key),
    );
    return values.filter(
      (key) =>
        (key !== 'users.manage' || role === 'admin') &&
        (PERMISSION_PARENTS[key] ?? []).every((parent) =>
          values.includes(parent),
        ),
    );
  } catch {
    return [];
  }
}
export function can(
  subject: PermissionSubject,
  permission: Permission,
): boolean {
  if (subject.role === 'owner') return true;
  const values = subject.permissions ?? defaultPermissions(subject.role);
  return (
    values.includes(permission) &&
    (permission !== 'users.manage' || subject.role === 'admin') &&
    (PERMISSION_PARENTS[permission] ?? []).every((parent) =>
      values.includes(parent),
    )
  );
}
export function canAny(
  subject: PermissionSubject,
  permissions: readonly Permission[],
) {
  return permissions.some((permission) => can(subject, permission));
}
