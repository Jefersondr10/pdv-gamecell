import { normalizeCommercialCode } from './gtin.ts';
import {
  normalizeCandidate,
  type ScanCandidate,
  type ScannerMode,
} from './scanner.ts';

export type StockScanResult = { query: string; productIds: string[] };

export function isStockSerialQuery(value: string) {
  return (
    /^[a-z0-9]{6,18}$/i.test(value) &&
    (/[0-9]/.test(value) ||
      Boolean(normalizeCandidate(value, 'manual_code_128', 'apple_serial')))
  );
}

// Read-only lookup shared by the camera and keyboard-wedge scanner.
export async function resolveStockScan(
  candidate: ScanCandidate,
  mode: ScannerMode,
  products: Array<{ id: string; codes: Array<{ code: string }> }>,
  lookupSerial: (query: string) => Promise<{ productIds: string[] }>,
): Promise<StockScanResult> {
  const query = candidate.normalizedValue;
  if (mode === 'apple_serial') {
    const result = await lookupSerial(query);
    return { query, productIds: [...new Set(result.productIds)] };
  }
  const codes = new Set([query, candidate.alternateValue].filter(Boolean));
  return {
    query,
    productIds: products
      .filter((product) =>
        product.codes.some(({ code }) =>
          codes.has(normalizeCommercialCode(code)),
        ),
      )
      .map((product) => product.id),
  };
}
