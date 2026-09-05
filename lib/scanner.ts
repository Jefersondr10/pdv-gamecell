export type ScannerMode = 'product' | 'apple_serial';

export type ScannerState =
  | 'idle'
  | 'requesting-permission'
  | 'loading-decoder'
  | 'scanning'
  | 'paused'
  | 'stopped'
  | 'error';

export type ScanCandidate = {
  rawValue: string;
  normalizedValue: string;
  alternateValue?: string;
  key: string;
  format: string;
  prefixStripped?: boolean;
};

type ScannerCallbacks = {
  onAccepted: (candidate: ScanCandidate) => void;
  onStateChange?: (state: ScannerState) => void;
  onError?: (message: string) => void;
};

export type ScanBoundingBox = {
  x: number;
  y: number;
  width: number;
  height: number;
};

export type PositionedScanCandidate = {
  candidate: ScanCandidate;
  boundingBox?: ScanBoundingBox;
};

type Detector = {
  detect: (source: HTMLCanvasElement) => Promise<
    Array<{
      rawValue: string;
      format: string;
      boundingBox?: ScanBoundingBox;
    }>
  >;
};

type TimedSample = ScanCandidate & { at: number };

const PRODUCT_FORMATS = ['ean_13', 'ean_8', 'upc_a', 'upc_e'] as const;
const SERIAL_FORMATS = ['code_128'] as const;
const SAMPLE_WINDOW_MS = 500;
const SCAN_INTERVAL_MS = 100;
const EMPTY_FRAMES_TO_REARM = 6;

let decoderConfigured = false;

export class ScannerService {
  private detector: Detector | null = null;
  private stream: MediaStream | null = null;
  private video: HTMLVideoElement | null = null;
  private scanRegion: HTMLElement | null = null;
  private canvas = document.createElement('canvas');
  private canvasContext = this.canvas.getContext('2d', {
    alpha: false,
    willReadFrequently: true,
  });
  private animationFrame: number | null = null;
  private lastAttemptAt = 0;
  private detectionInFlight = false;
  private samples: TimedSample[] = [];
  private lockedKey: string | null = null;
  private emptyFrames = 0;
  private active = false;
  private callbacks: ScannerCallbacks | null = null;
  private mode: ScannerMode = 'apple_serial';

  async start(
    video: HTMLVideoElement,
    mode: ScannerMode,
    callbacks: ScannerCallbacks,
    scanRegion?: HTMLElement | null,
  ) {
    await this.stop(false);
    this.video = video;
    this.scanRegion = scanRegion ?? null;
    this.mode = mode;
    this.callbacks = callbacks;
    this.active = true;
    callbacks.onStateChange?.('requesting-permission');

    try {
      this.stream = await navigator.mediaDevices.getUserMedia({
        audio: false,
        video: {
          facingMode: { ideal: 'environment' },
          width: { ideal: 1920 },
          height: { ideal: 1080 },
        },
      });

      if (!this.active) {
        this.stopTracks();
        return;
      }

      video.srcObject = this.stream;
      video.autoplay = true;
      video.muted = true;
      video.playsInline = true;
      await video.play();

      callbacks.onStateChange?.('loading-decoder');
      const barcodeLibrary = await import('barcode-detector/ponyfill');
      if (!decoderConfigured) {
        barcodeLibrary.prepareZXingModule({
          overrides: {
            locateFile: (path: string, prefix: string) =>
              path.endsWith('.wasm')
                ? '/wasm/zxing_reader.wasm'
                : prefix + path,
          },
        });
        decoderConfigured = true;
      }

      this.detector = new barcodeLibrary.BarcodeDetector({
        formats:
          mode === 'product' ? [...PRODUCT_FORMATS] : [...SERIAL_FORMATS],
      }) as Detector;
      callbacks.onStateChange?.('scanning');
      document.addEventListener(
        'visibilitychange',
        this.handleVisibilityChange,
      );
      this.queueNextFrame();
    } catch (error) {
      this.active = false;
      this.stopTracks();
      callbacks.onStateChange?.('error');
      callbacks.onError?.(cameraErrorMessage(error));
    }
  }

  async stop(updateState = true) {
    this.active = false;
    if (this.animationFrame !== null) {
      cancelAnimationFrame(this.animationFrame);
      this.animationFrame = null;
    }
    document.removeEventListener(
      'visibilitychange',
      this.handleVisibilityChange,
    );
    this.stopTracks();
    if (this.video) this.video.srcObject = null;
    this.samples = [];
    this.lockedKey = null;
    this.emptyFrames = 0;
    if (updateState) this.callbacks?.onStateChange?.('stopped');
  }

  private handleVisibilityChange = () => {
    if (document.hidden && this.active) {
      void this.stop();
      this.callbacks?.onStateChange?.('paused');
    }
  };

  private stopTracks() {
    this.stream?.getTracks().forEach((track) => track.stop());
    this.stream = null;
  }

  private queueNextFrame() {
    if (!this.active) return;
    this.animationFrame = requestAnimationFrame(this.scanFrame);
  }

  private scanFrame = (now: number) => {
    if (!this.active) return;
    if (
      !this.detectionInFlight &&
      now - this.lastAttemptAt >= SCAN_INTERVAL_MS &&
      this.video?.readyState === HTMLMediaElement.HAVE_ENOUGH_DATA
    ) {
      this.lastAttemptAt = now;
      this.detectionInFlight = true;
      void this.detectCurrentFrame().finally(() => {
        this.detectionInFlight = false;
      });
    }
    this.queueNextFrame();
  };

  private async detectCurrentFrame() {
    const video = this.video;
    const context = this.canvasContext;
    const detector = this.detector;
    if (
      !video ||
      !context ||
      !detector ||
      !video.videoWidth ||
      !video.videoHeight
    ) {
      return;
    }

    const {
      x: sourceX,
      y: sourceY,
      width: sourceWidth,
      height: sourceHeight,
    } = sourceRegionForObjectCover(video, this.scanRegion, this.mode);
    const targetWidth = Math.min(1100, Math.round(sourceWidth));
    const targetHeight = Math.max(
      this.mode === 'apple_serial' ? 128 : 220,
      Math.round((sourceHeight / sourceWidth) * targetWidth),
    );

    this.canvas.width = targetWidth;
    this.canvas.height = targetHeight;
    context.drawImage(
      video,
      sourceX,
      sourceY,
      sourceWidth,
      sourceHeight,
      0,
      0,
      targetWidth,
      targetHeight,
    );

    try {
      const results = await detector.detect(this.canvas);
      const candidates: PositionedScanCandidate[] = [];
      for (const result of results) {
        const candidate = normalizeCandidate(
          result.rawValue,
          result.format,
          this.mode,
        );
        if (candidate) {
          candidates.push({ candidate, boundingBox: result.boundingBox });
        }
      }

      if (candidates.length === 0) {
        this.handleEmptyFrame();
        return;
      }

      const candidate = selectCentralCandidate(
        candidates,
        this.canvas.width,
        this.canvas.height,
      );
      if (!candidate) {
        this.handleEmptyFrame();
        return;
      }
      this.emptyFrames = 0;
      if (this.lockedKey === candidate.key) return;

      const at = performance.now();
      this.samples = [
        ...this.samples.filter((sample) => at - sample.at <= SAMPLE_WINDOW_MS),
        { ...candidate, at },
      ].slice(-3);

      const confirmations = this.samples.filter(
        (sample) => sample.key === candidate.key,
      );
      if (confirmations.length >= 2) {
        this.lockedKey = candidate.key;
        this.samples = [];
        this.callbacks?.onAccepted(candidate);
      }
    } catch (error) {
      this.callbacks?.onError?.(
        error instanceof Error
          ? error.message
          : 'Não foi possível analisar a imagem.',
      );
    }
  }

  private handleEmptyFrame() {
    this.samples = [];
    if (!this.lockedKey) return;
    this.emptyFrames += 1;
    if (this.emptyFrames >= EMPTY_FRAMES_TO_REARM) {
      this.lockedKey = null;
      this.emptyFrames = 0;
    }
  }
}

function sourceRegionForObjectCover(
  video: HTMLVideoElement,
  scanRegion: HTMLElement | null,
  mode: ScannerMode,
): ScanBoundingBox {
  const videoBox = video.getBoundingClientRect();
  const regionBox = scanRegion?.getBoundingClientRect();
  if (
    !regionBox ||
    videoBox.width <= 0 ||
    videoBox.height <= 0 ||
    video.videoWidth <= 0 ||
    video.videoHeight <= 0
  ) {
    const width = video.videoWidth * 0.92;
    const height = video.videoHeight * (mode === 'apple_serial' ? 0.18 : 0.36);
    return {
      x: (video.videoWidth - width) / 2,
      y: (video.videoHeight - height) / 2,
      width,
      height,
    };
  }

  const scale = Math.max(
    videoBox.width / video.videoWidth,
    videoBox.height / video.videoHeight,
  );
  const croppedX = (video.videoWidth * scale - videoBox.width) / 2;
  const croppedY = (video.videoHeight * scale - videoBox.height) / 2;
  const x = Math.max(0, (regionBox.left - videoBox.left + croppedX) / scale);
  const y = Math.max(0, (regionBox.top - videoBox.top + croppedY) / scale);
  const width = Math.min(regionBox.width / scale, video.videoWidth - x);
  const height = Math.min(regionBox.height / scale, video.videoHeight - y);
  return { x, y, width: Math.max(1, width), height: Math.max(1, height) };
}

export function normalizeCandidate(
  rawInput: string,
  format: string,
  mode: ScannerMode,
): ScanCandidate | null {
  const rawValue = rawInput.trim();
  if (!rawValue) return null;

  if (mode === 'product') {
    const digits = rawValue.replace(/\D/g, '');
    if (![8, 12, 13, 14].includes(digits.length)) return null;
    const canonicalValue =
      format === 'upc_e' && digits.length === 8 ? expandUpce(digits) : digits;
    if (!canonicalValue || !hasValidGtinCheckDigit(canonicalValue)) return null;
    const normalizedValue = canonicalValue.padStart(14, '0');
    return {
      rawValue,
      normalizedValue,
      key: `PRODUCT:${normalizedValue}`,
      format,
    };
  }

  const upperValue = rawValue.toUpperCase().replace(/\s+/g, '');
  if (!/^[A-Z0-9]{8,18}$/.test(upperValue)) return null;
  const canStripApplePrefix =
    !format.startsWith('manual_') &&
    upperValue.startsWith('S') &&
    /^[A-Z0-9]{8,17}$/.test(upperValue.slice(1));
  const normalizedValue = canStripApplePrefix
    ? upperValue.slice(1)
    : upperValue;
  if (!/[A-Z]/.test(normalizedValue)) return null;

  return {
    rawValue,
    normalizedValue,
    alternateValue: canStripApplePrefix ? upperValue : undefined,
    key: `SERIAL:${normalizedValue}`,
    format,
    prefixStripped: canStripApplePrefix || undefined,
  };
}

export function selectCentralCandidate(
  positionedCandidates: PositionedScanCandidate[],
  frameWidth: number,
  frameHeight: number,
) {
  const bestByKey = new Map<
    string,
    PositionedScanCandidate & { score: number }
  >();

  for (const positioned of positionedCandidates) {
    const score = centralityScore(
      positioned.boundingBox,
      frameWidth,
      frameHeight,
    );
    const current = bestByKey.get(positioned.candidate.key);
    if (!current || score < current.score) {
      bestByKey.set(positioned.candidate.key, { ...positioned, score });
    }
  }

  return (
    [...bestByKey.values()].sort((left, right) => left.score - right.score)[0]
      ?.candidate ?? null
  );
}

function centralityScore(
  box: ScanBoundingBox | undefined,
  frameWidth: number,
  frameHeight: number,
) {
  if (!box || frameWidth <= 0 || frameHeight <= 0)
    return Number.MAX_SAFE_INTEGER;

  const centerX = box.x + box.width / 2;
  const centerY = box.y + box.height / 2;
  const horizontalDistance = Math.abs(centerX - frameWidth / 2) / frameWidth;
  const verticalDistance = Math.abs(centerY - frameHeight / 2) / frameHeight;
  const widthBonus = Math.min(box.width / frameWidth, 1) * 0.08;

  // A faixa já é estreita; priorizar o centro vertical evita capturar a linha
  // de IMEI/EID que costuma ficar imediatamente acima ou abaixo do SN.
  return horizontalDistance * 0.65 + verticalDistance * 2 - widthBonus;
}

export function hasValidGtinCheckDigit(value: string) {
  if (!/^\d{8}$|^\d{12,14}$/.test(value)) return false;
  const digits = value.split('').map(Number);
  const suppliedCheckDigit = digits.pop();
  const total = digits
    .reverse()
    .reduce((sum, digit, index) => sum + digit * (index % 2 === 0 ? 3 : 1), 0);
  return suppliedCheckDigit === (10 - (total % 10)) % 10;
}

export function expandUpce(value: string) {
  if (!/^\d{8}$/.test(value)) return null;
  const [numberSystem, first, second, third, fourth, fifth, expansion, check] =
    value.split('');
  if (numberSystem !== '0' && numberSystem !== '1') return null;

  let body: string;
  if ('012'.includes(expansion)) {
    body = `${numberSystem}${first}${second}${expansion}0000${third}${fourth}${fifth}`;
  } else if (expansion === '3') {
    body = `${numberSystem}${first}${second}${third}00000${fourth}${fifth}`;
  } else if (expansion === '4') {
    body = `${numberSystem}${first}${second}${third}${fourth}00000${fifth}`;
  } else {
    body = `${numberSystem}${first}${second}${third}${fourth}${fifth}0000${expansion}`;
  }

  const expanded = body + check;
  return hasValidGtinCheckDigit(expanded) ? expanded : null;
}

function cameraErrorMessage(error: unknown) {
  if (error instanceof DOMException) {
    if (error.name === 'NotAllowedError') {
      return 'A câmera não foi autorizada. Libere o acesso no navegador e tente novamente.';
    }
    if (error.name === 'NotFoundError') {
      return 'Nenhuma câmera foi encontrada neste aparelho.';
    }
    if (error.name === 'NotReadableError') {
      return 'A câmera está sendo usada por outro aplicativo.';
    }
  }
  return 'Não foi possível abrir a câmera. Você ainda pode digitar o SN.';
}
