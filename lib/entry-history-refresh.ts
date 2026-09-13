import type { EntriesPage } from './pdv-types';

export async function loadEntryHistoryPages(
  fetchPage: (cursor: string | null) => Promise<EntriesPage>,
  targetCount: number,
  initialCursor: string | null = null,
  isCurrent: () => boolean = () => true,
): Promise<EntriesPage | null> {
  let page = await fetchPage(initialCursor);
  if (!isCurrent()) return null;
  const seen = new Set<string>();
  while (page.nextCursor && page.items.length < targetCount) {
    if (seen.has(page.nextCursor))
      throw new Error('Não foi possível continuar a leitura das entradas.');
    seen.add(page.nextCursor);
    const next = await fetchPage(page.nextCursor);
    if (!isCurrent()) return null;
    page = { ...next, items: [...page.items, ...next.items] };
  }
  return page;
}
