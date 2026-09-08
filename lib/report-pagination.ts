export type ReportRange = { top: number; bottom: number };

// Prefer an intact outer block, even when it leaves more white space.
// Oversized groups must expose smaller atomic blocks in the report markup.
export function chooseReportSliceHeight(
  sourceY: number,
  maximumSliceHeight: number,
  ranges: ReportRange[],
  pageCapacity = maximumSliceHeight,
) {
  const idealEnd = sourceY + maximumSliceHeight;
  const starts = ranges
    .filter(
      (range) =>
        range.top > sourceY &&
        range.top < idealEnd &&
        range.bottom > idealEnd &&
        range.bottom - range.top <= pageCapacity,
    )
    .map((range) => range.top);
  const end = starts.length ? Math.min(...starts) : idealEnd;
  return Math.max(1, Math.floor(end - sourceY));
}

export function chunkReportItems<T>(items: T[], size: number): T[][] {
  if (!Number.isInteger(size) || size <= 0)
    throw new Error('Invalid report chunk size');
  const chunks: T[][] = [];
  for (let i = 0; i < items.length; i += size)
    chunks.push(items.slice(i, i + size));
  return chunks;
}
