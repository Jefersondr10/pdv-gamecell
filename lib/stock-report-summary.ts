type StockSummaryInput = { model: string; memory: string; available: number };

export function summarizeStockByMemory(rows: readonly StockSummaryInput[]) {
  const groups = new Map<
    string,
    { key: string; model: string; memory: string; quantity: number }
  >();
  const models = new Set<string>();
  const normalize = (value: string) => value.trim().replace(/\s+/g, ' ');
  for (const row of rows) {
    if (row.available <= 0) continue;
    const model = normalize(row.model);
    // Normalize presentation differences without guessing a missing unit or
    // converting a catalog's storage capacity to another capacity label.
    const memory = normalize(row.memory)
      .toUpperCase()
      .replace(/(\d)\s*(GB|TB)\b/g, '$1 $2');
    const modelKey = model.toLocaleLowerCase('pt-BR');
    const key = JSON.stringify([modelKey, memory]);
    const group = groups.get(key) ?? { key, model, memory, quantity: 0 };
    group.quantity += row.available;
    groups.set(key, group);
    models.add(modelKey);
  }
  const compare = new Intl.Collator('pt-BR', {
    numeric: true,
    sensitivity: 'base',
  });
  const capacity = (value: string) => {
    const match = value.match(/^(\d+(?:[.,]\d+)?) (GB|TB)$/);
    return match
      ? Number(match[1].replace(',', '.')) * (match[2] === 'TB' ? 1024 : 1)
      : Infinity;
  };
  return {
    modelCount: models.size,
    groups: [...groups.values()].sort(
      (a, b) =>
        compare.compare(a.model, b.model) ||
        capacity(a.memory) - capacity(b.memory) ||
        compare.compare(a.memory, b.memory),
    ),
  };
}
