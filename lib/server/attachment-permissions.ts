import type { Permission } from '../permissions.ts';

export function attachmentReadPermissions(
  kind: string,
): readonly Permission[] | null {
  if (kind === 'entry_photo') return ['stock', 'entries'];
  if (kind === 'item_photo') return ['sales'];
  if (kind === 'receipt') return ['sales', 'overview'];
  if (kind === 'report') return ['sales'];
  return null;
}
