export type SalePrices = {
  revision: number;
  status: 'completed' | 'cancelled';
  productsTotalCents: number;
  receivedTotalCents: number;
  receivedDifferenceCents: number;
  priceDifferenceCents: number;
  items: { id: string; soldPriceCents: number }[];
};

export function originalPriceSnapshot(value: string | null) {
  if (!value) return null;
  try {
    const snapshot = JSON.parse(value) as {
      totalCents: number;
      receivedTotalCents: number;
      items: { serial: string; soldPriceCents: number }[];
    };
    if (
      !Number.isSafeInteger(snapshot.totalCents) ||
      snapshot.totalCents <= 0 ||
      !Number.isSafeInteger(snapshot.receivedTotalCents) ||
      snapshot.receivedTotalCents < 0 ||
      !Array.isArray(snapshot.items) ||
      !snapshot.items.length ||
      snapshot.items.some(
        (item) =>
          typeof item.serial !== 'string' ||
          !Number.isSafeInteger(item.soldPriceCents) ||
          item.soldPriceCents < 0,
      )
    )
      return null;
    return snapshot;
  } catch {
    return null;
  }
}
