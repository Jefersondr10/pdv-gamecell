import { expandUpce, hasValidGtinCheckDigit } from './gtin.ts';

export { expandUpce, hasValidGtinCheckDigit } from './gtin.ts';

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
  onCameras?: (
    cameras: Array<{ id: string; label: string }>,
    selected: string,
  ) => void;
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

type DetectorConstructor = {
  new (options: { formats: string[] }): Detector;
  getSupportedFormats?: () => Promise<string[]>;
};

type PreparedDetector = {
  detector: Detector;
  native: boolean;
};

type TimedSample = ScanCandidate & { at: number };

// One physical presentation can emit only one accepted code. Different readings
// of the same box must not rearm the scanner or form an interleaved consensus.
export class ScanConsensus {
  private samples: TimedSample[] = [];
  private locked = false;
  private emptyFrames = 0;
  reset() {
    this.samples = [];
    this.locked = false;
    this.emptyFrames = 0;
  }
  interrupt() {
    this.samples = [];
  }
  observe(candidate: ScanCandidate | null, at: number): ScanCandidate | null {
    if (!candidate) {
      this.samples = [];
      if (this.locked && ++this.emptyFrames >= EMPTY_FRAMES_TO_REARM)
        this.reset();
      return null;
    }
    this.emptyFrames = 0;
    if (this.locked) return null;
    const recent = recentScanSamples(this.samples, at);
    this.samples =
      recent.at(-1)?.key === candidate.key
        ? [...recent, { ...candidate, at }].slice(-6)
        : [{ ...candidate, at }];
    if (this.samples.length < 3 || at - this.samples[0].at < 250) return null;
    this.locked = true;
    this.samples = [];
    return candidate;
  }
}

export function recentScanSamples<T extends { at: number }>(
  samples: T[],
  now: number,
) {
  return samples.filter((sample) => now - sample.at <= SAMPLE_WINDOW_MS);
}

export async function openScannerCamera(
  media: Pick<MediaDevices, 'getUserMedia'>,
  deviceId?: string,
) {
  const video: MediaTrackConstraints = {
    width: { ideal: 1920 },
    height: { ideal: 1080 },
    frameRate: { ideal: 24, max: 30 },
  };
  try {
    return await media.getUserMedia({
      audio: false,
      video: {
        ...video,
        ...(deviceId
          ? { deviceId: { exact: deviceId } }
          : { facingMode: { exact: 'environment' } }),
      },
    });
  } catch (error) {
    if (
      !(error instanceof DOMException) ||
      !['OverconstrainedError', 'NotFoundError'].includes(error.name)
    )
      throw error;
    return await media.getUserMedia({
      audio: false,
      video: { ...video, facingMode: { ideal: 'environment' } },
    });
  }
}

const PRODUCT_FORMATS = ['ean_13', 'ean_8', 'upc_a', 'upc_e'] as const;
const SERIAL_FORMATS = ['code_128'] as const;
const SAMPLE_WINDOW_MS = 1_400;
const SCAN_INTERVAL_MS = 100;
const EMPTY_FRAMES_TO_REARM = 6;

let decoderConfigured = false;
let ponyfillPromise: Promise<
  typeof import('barcode-detector/ponyfill')
> | null = null;

export function preloadScannerDecoder() {
  void loadPonyfill().catch(() => {
    // Uma falha transitória no aquecimento não deve gerar erro global.
    // O início do leitor fará uma nova tentativa quando necessário.
  });
}

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
  private consensus = new ScanConsensus();
  private active = false;
  private callbacks: ScannerCallbacks | null = null;
  private mode: ScannerMode = 'apple_serial';
  private generation = 0;
  private usingNativeDetector = false;
  private nativeFallbackAttempted = false;

  async start(
    video: HTMLVideoElement,
    mode: ScannerMode,
    callbacks: ScannerCallbacks,
    scanRegion?: HTMLElement | null,
    deviceId?: string,
  ) {
    await this.stop(false);
    const generation = ++this.generation;
    this.video = video;
    this.scanRegion = scanRegion ?? null;
    this.mode = mode;
    this.callbacks = callbacks;
    this.active = true;
    callbacks.onStateChange?.('requesting-permission');

    try {
      const detectorTask = createDetector(mode).then(
        (detector) => ({ detector, error: null }),
        (error: unknown) => ({ detector: null, error }),
      );
      const stream = await openScannerCamera(navigator.mediaDevices, deviceId);

      if (!this.isCurrent(generation)) {
        stream.getTracks().forEach((track) => track.stop());
        return;
      }

      this.stream = stream;
      const track = stream.getVideoTracks()[0];
      try {
        const capabilities = track?.getCapabilities?.() as
          | (MediaTrackCapabilities & { focusMode?: string[] })
          | undefined;
        if (capabilities?.focusMode?.includes('continuous'))
          await track.applyConstraints({
            advanced: [{ focusMode: 'continuous' } as MediaTrackConstraintSet],
          });
      } catch {
        /* Focus controls are optional on Safari. */
      }
      if (!this.isCurrent(generation)) {
        stream.getTracks().forEach((track) => track.stop());
        return;
      }
      void navigator.mediaDevices
        .enumerateDevices()
        .then((devices) => {
          if (!this.isCurrent(generation)) return;
          callbacks.onCameras?.(
            devices
              .filter((device) => device.kind === 'videoinput')
              .map((device, index) => ({
                id: device.deviceId,
                label: device.label || `Câmera ${index + 1}`,
              })),
            track?.getSettings().deviceId ?? '',
          );
        })
        .catch(() => {
          /* The current camera remains usable without a device list. */
        });
      video.srcObject = stream;
      video.autoplay = true;
      video.muted = true;
      video.playsInline = true;
      await video.play();

      if (!this.isCurrent(generation)) {
        stream.getTracks().forEach((track) => track.stop());
        return;
      }

      callbacks.onStateChange?.('loading-decoder');
      const detectorResult = await detectorTask;
      if (!this.isCurrent(generation)) {
        stream.getTracks().forEach((track) => track.stop());
        return;
      }
      if (detectorResult.error || !detectorResult.detector) {
        throw detectorResult.error ?? new Error('Leitor indisponível.');
      }
      this.detector = detectorResult.detector.detector;
      this.usingNativeDetector = detectorResult.detector.native;
      this.nativeFallbackAttempted = false;
      callbacks.onStateChange?.('scanning');
      document.addEventListener(
        'visibilitychange',
        this.handleVisibilityChange,
      );
      this.queueNextFrame();
    } catch (error) {
      if (!this.isCurrent(generation)) return;
      this.active = false;
      this.stopTracks();
      callbacks.onStateChange?.('error');
      callbacks.onError?.(cameraErrorMessage(error));
    }
  }

  async stop(updateState = true) {
    this.generation += 1;
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
    this.consensus.reset();
    this.lastAttemptAt = 0;
    this.detector = null;
    this.detectionInFlight = false;
    this.usingNativeDetector = false;
    this.nativeFallbackAttempted = false;
    if (updateState) this.callbacks?.onStateChange?.('stopped');
  }

  private isCurrent(generation: number) {
    return this.active && generation === this.generation;
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
      const generation = this.generation;
      void this.detectCurrentFrame().finally(() => {
        if (generation !== this.generation) return;
        this.detectionInFlight = false;
        this.lastAttemptAt = performance.now();
      });
    }
    this.queueNextFrame();
  };

  private async detectCurrentFrame() {
    const generation = this.generation;
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
    const targetWidth = Math.min(
      this.mode === 'product' ? 900 : 800,
      Math.round(sourceWidth),
    );
    const targetHeight = Math.max(
      this.mode === 'apple_serial' ? 112 : 180,
      Math.round((sourceHeight / sourceWidth) * targetWidth),
    );

    if (this.canvas.width !== targetWidth) this.canvas.width = targetWidth;
    if (this.canvas.height !== targetHeight) this.canvas.height = targetHeight;
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
      if (!this.isCurrent(generation) || detector !== this.detector) return;
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
      const accepted = this.consensus.observe(candidate, performance.now());
      if (accepted) this.callbacks?.onAccepted(accepted);
    } catch (error) {
      if (!this.isCurrent(generation) || detector !== this.detector) return;
      this.consensus.interrupt();
      if (this.usingNativeDetector && !this.nativeFallbackAttempted) {
        this.nativeFallbackAttempted = true;
        this.callbacks?.onStateChange?.('loading-decoder');
        try {
          const fallback = await createPonyfillDetector(this.mode);
          if (!this.isCurrent(generation)) return;
          this.detector = fallback;
          this.usingNativeDetector = false;
          this.callbacks?.onStateChange?.('scanning');
          return;
        } catch (fallbackError) {
          if (!this.isCurrent(generation)) return;
          this.active = false;
          this.stopTracks();
          this.callbacks?.onStateChange?.('error');
          this.callbacks?.onError?.(cameraErrorMessage(fallbackError));
          return;
        }
      }
      this.callbacks?.onError?.(
        error instanceof Error
          ? error.message
          : 'Não foi possível analisar a imagem.',
      );
    }
  }

  private handleEmptyFrame() {
    this.consensus.observe(null, performance.now());
  }
}

async function createDetector(mode: ScannerMode): Promise<PreparedDetector> {
  const formats =
    mode === 'product' ? [...PRODUCT_FORMATS] : [...SERIAL_FORMATS];
  const NativeDetector = nativeDetectorConstructor();
  if (NativeDetector?.getSupportedFormats) {
    try {
      const supported = await NativeDetector.getSupportedFormats();
      if (formats.every((format) => supported.includes(format))) {
        return { detector: new NativeDetector({ formats }), native: true };
      }
    } catch {
      // Alguns Androids expõem uma implementação parcial. O leitor local é o fallback.
    }
  }

  return { detector: await createPonyfillDetector(mode), native: false };
}

async function createPonyfillDetector(mode: ScannerMode): Promise<Detector> {
  const formats =
    mode === 'product' ? [...PRODUCT_FORMATS] : [...SERIAL_FORMATS];
  const barcodeLibrary = await loadPonyfill();
  return new barcodeLibrary.BarcodeDetector({ formats }) as Detector;
}

function nativeDetectorConstructor() {
  return (globalThis as unknown as { BarcodeDetector?: DetectorConstructor })
    .BarcodeDetector;
}

function loadPonyfill() {
  ponyfillPromise ??= import('barcode-detector/ponyfill')
    .then(async (barcodeLibrary) => {
      if (!decoderConfigured) {
        await barcodeLibrary.prepareZXingModule({
          overrides: {
            locateFile: (path: string, prefix: string) =>
              path.endsWith('.wasm')
                ? '/wasm/zxing_reader.wasm'
                : prefix + path,
          },
          fireImmediately: true,
        });
        decoderConfigured = true;
      }
      return barcodeLibrary;
    })
    .catch((error: unknown) => {
      ponyfillPromise = null;
      decoderConfigured = false;
      throw error;
    });
  return ponyfillPromise;
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
    const expandedUpce =
      format === 'upc_e' && digits.length === 8 ? expandUpce(digits) : null;
    const canonicalValue = expandedUpce ?? digits;
    if (!hasValidGtinCheckDigit(canonicalValue)) return null;
    const normalizedValue = canonicalValue.padStart(14, '0');
    return {
      rawValue,
      normalizedValue,
      alternateValue: expandedUpce ? digits.padStart(14, '0') : undefined,
      key: `PRODUCT:${normalizedValue}`,
      format,
    };
  }

  const upperValue = rawValue.toUpperCase().replace(/\s+/g, '');
  if (!/^[A-Z0-9]{8,18}$/.test(upperValue)) return null;
  const serialBody = upperValue.startsWith('S')
    ? upperValue.slice(1)
    : upperValue;
  if (!/^[A-Z0-9]{8,17}$/.test(serialBody) || !/[A-Z]/.test(serialBody)) {
    return null;
  }
  const alternateValue = upperValue.startsWith('S')
    ? upperValue.slice(1)
    : `S${upperValue}`;
  const identityValue = [upperValue, alternateValue].sort()[0];

  return {
    rawValue,
    normalizedValue: upperValue,
    alternateValue,
    key: `SERIAL:${identityValue}`,
    format,
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
