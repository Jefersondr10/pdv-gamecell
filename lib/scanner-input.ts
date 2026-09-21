export type ScannerInput = 'camera' | 'keyboard';

// Device capabilities, not window width: a narrow desktop window still uses
// the hardware reader. Touch tablets (including iPad desktop mode) use camera.
export function defaultScannerInput({
  userAgent,
  coarsePointer,
  canHover,
}: {
  userAgent: string;
  coarsePointer: boolean;
  canHover: boolean;
}): ScannerInput {
  const mobileDevice = /Android|iPhone|iPad|iPod|Mobile/i.test(userAgent);
  return mobileDevice || (coarsePointer && !canHover) ? 'camera' : 'keyboard';
}
