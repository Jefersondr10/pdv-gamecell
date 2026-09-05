'use client';

const MEBIBYTE = 1024 * 1024;

export const MEDIA_LIMITS = {
  maxFileBytes: 10 * MEBIBYTE,
  maxOperationBytes: 45 * MEBIBYTE,
  entryPhotos: 8,
  saleItemPhotos: 6,
  saleReceipts: 8,
  saleFiles: 60,
} as const;

const IMAGE_TYPES = new Set([
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/heic',
  'image/heif',
]);

const DIRECTLY_OPTIMIZABLE_TYPES = new Set([
  'image/jpeg',
  'image/jpg',
  'image/png',
  'image/webp',
]);

const CONVERT_IF_SUPPORTED_TYPES = new Set(['image/heic', 'image/heif']);
const preparedOrigins = new WeakMap<File, string>();

export type MediaPreparationProgress = {
  completed: number;
  total: number;
};

export type PrepareMediaSelectionOptions = {
  current: readonly File[];
  incoming: readonly File[];
  maxFiles: number;
  allowPdf?: boolean;
  otherFiles?: readonly File[];
  maxCombinedFiles?: number;
  maxFileBytes?: number;
  maxTotalBytes?: number;
  maxDimension?: number;
  quality?: number;
  onProgress?: (progress: MediaPreparationProgress) => void;
};

export type PreparedMediaSelection = {
  files: File[];
  addedCount: number;
  duplicateCount: number;
  optimizedCount: number;
  bytesSaved: number;
  totalBytes: number;
};

export async function prepareMediaSelection({
  current,
  incoming,
  maxFiles,
  allowPdf = false,
  otherFiles = [],
  maxCombinedFiles,
  maxFileBytes = MEDIA_LIMITS.maxFileBytes,
  maxTotalBytes = MEDIA_LIMITS.maxOperationBytes,
  maxDimension = 2_000,
  quality = 0.85,
  onProgress,
}: PrepareMediaSelectionOptions): Promise<PreparedMediaSelection> {
  const existingIdentities = new Set(current.map(fileIdentity));
  const incomingIdentities = new Set<string>();
  const uniqueIncoming: File[] = [];
  let duplicateCount = 0;

  for (const file of incoming) {
    assertAllowedType(file, allowPdf);
    const identity = fileIdentity(file);
    if (existingIdentities.has(identity) || incomingIdentities.has(identity)) {
      duplicateCount += 1;
      continue;
    }
    incomingIdentities.add(identity);
    uniqueIncoming.push(file);
  }

  if (current.length + uniqueIncoming.length > maxFiles) {
    throw new Error(
      `Selecione no máximo ${maxFiles} ${allowPdf ? 'arquivos' : 'fotos'}.`,
    );
  }
  if (
    maxCombinedFiles !== undefined &&
    otherFiles.length + current.length + uniqueIncoming.length >
      maxCombinedFiles
  ) {
    throw new Error(
      `Esta venda permite no máximo ${maxCombinedFiles} anexos no total.`,
    );
  }

  const prepared: File[] = [];
  let optimizedCount = 0;
  let bytesSaved = 0;
  onProgress?.({ completed: 0, total: uniqueIncoming.length });

  for (let index = 0; index < uniqueIncoming.length; index += 1) {
    await yieldToBrowser();
    const source = uniqueIncoming[index];
    const result = await optimizeImage(source, { maxDimension, quality });
    if (result.type.toLowerCase() === 'image/jpg') {
      throw new Error(
        `${source.name || 'Arquivo'} usa um formato JPEG não reconhecido pelo servidor. Selecione novamente pela câmera ou galeria.`,
      );
    }
    if (result.size > maxFileBytes) {
      throw new Error(
        `${source.name || 'Arquivo'} ultrapassa ${formatMediaBytes(maxFileBytes)} mesmo após a preparação.`,
      );
    }
    if (result !== source) {
      optimizedCount += 1;
      bytesSaved += source.size - result.size;
      preparedOrigins.set(result, fileIdentity(source));
    }
    prepared.push(result);
    onProgress?.({ completed: index + 1, total: uniqueIncoming.length });
  }

  const files = [...current, ...prepared];
  const totalBytes = sumFileBytes([...otherFiles, ...files]);
  if (totalBytes > maxTotalBytes) {
    throw new Error(
      `Os anexos somam ${formatMediaBytes(totalBytes)}. O limite por operação é ${formatMediaBytes(maxTotalBytes)}.`,
    );
  }

  return {
    files,
    addedCount: prepared.length,
    duplicateCount,
    optimizedCount,
    bytesSaved,
    totalBytes: sumFileBytes(files),
  };
}

export function sumFileBytes(files: readonly File[]) {
  return files.reduce((total, file) => total + file.size, 0);
}

export function formatMediaBytes(bytes: number) {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 MB';
  if (bytes < MEBIBYTE) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  return `${(bytes / MEBIBYTE).toLocaleString('pt-BR', {
    maximumFractionDigits: 1,
    minimumFractionDigits: bytes < 10 * MEBIBYTE ? 1 : 0,
  })} MB`;
}

function assertAllowedType(file: File, allowPdf: boolean) {
  const type = file.type.toLowerCase();
  if (IMAGE_TYPES.has(type) || type === 'image/jpg') return;
  if (allowPdf && type === 'application/pdf') return;
  throw new Error(
    allowPdf
      ? 'Use imagens JPEG, PNG, WebP, HEIC/HEIF ou arquivos PDF.'
      : 'Use imagens JPEG, PNG, WebP ou HEIC/HEIF.',
  );
}

async function optimizeImage(
  file: File,
  options: { maxDimension: number; quality: number },
) {
  const type = file.type.toLowerCase();
  if (
    !DIRECTLY_OPTIMIZABLE_TYPES.has(type) &&
    !CONVERT_IF_SUPPORTED_TYPES.has(type)
  ) {
    return file;
  }

  let decoded: DecodedImage | null = null;
  try {
    decoded = await decodeImage(file);
    const scale = Math.min(
      1,
      options.maxDimension / Math.max(decoded.width, decoded.height),
    );
    const width = Math.max(1, Math.round(decoded.width * scale));
    const height = Math.max(1, Math.round(decoded.height * scale));
    const outputType =
      type === 'image/jpeg' ||
      type === 'image/jpg' ||
      CONVERT_IF_SUPPORTED_TYPES.has(type)
        ? 'image/jpeg'
        : 'image/webp';
    const blob = await renderImage(
      decoded.source,
      width,
      height,
      outputType,
      options.quality,
    );
    if (!blob || blob.size <= 0 || blob.size >= file.size) return file;
    return new File([blob], optimizedFileName(file.name, outputType), {
      type: outputType,
      lastModified: file.lastModified,
    });
  } catch {
    // HEIC/HEIF and some camera encodings cannot be decoded by every browser.
    // The original remains valid for the server-side allowlist and audit trail.
    return file;
  } finally {
    decoded?.dispose();
  }
}

type DecodedImage = {
  source: CanvasImageSource;
  width: number;
  height: number;
  dispose: () => void;
};

async function decodeImage(file: File): Promise<DecodedImage> {
  if (typeof createImageBitmap === 'function') {
    try {
      const bitmap = await createImageBitmap(file);
      return {
        source: bitmap,
        width: bitmap.width,
        height: bitmap.height,
        dispose: () => bitmap.close(),
      };
    } catch {
      // Fall through to the HTML image decoder for browser-specific formats.
    }
  }

  const url = URL.createObjectURL(file);
  const image = new Image();
  image.decoding = 'async';
  image.src = url;
  try {
    await image.decode();
    return {
      source: image,
      width: image.naturalWidth,
      height: image.naturalHeight,
      dispose: () => URL.revokeObjectURL(url),
    };
  } catch (error) {
    URL.revokeObjectURL(url);
    throw error;
  }
}

async function renderImage(
  source: CanvasImageSource,
  width: number,
  height: number,
  type: 'image/jpeg' | 'image/webp',
  quality: number,
) {
  if (typeof OffscreenCanvas !== 'undefined') {
    const canvas = new OffscreenCanvas(width, height);
    const context = canvas.getContext('2d');
    if (!context) return null;
    context.imageSmoothingEnabled = true;
    context.imageSmoothingQuality = 'high';
    context.drawImage(source, 0, 0, width, height);
    return canvas.convertToBlob({ type, quality });
  }

  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext('2d');
  if (!context) return null;
  context.imageSmoothingEnabled = true;
  context.imageSmoothingQuality = 'high';
  context.drawImage(source, 0, 0, width, height);
  return new Promise<Blob | null>((resolve) =>
    canvas.toBlob(resolve, type, quality),
  );
}

function optimizedFileName(name: string, type: 'image/jpeg' | 'image/webp') {
  const stem = (name || 'foto').replace(/\.[^.]+$/, '') || 'foto';
  return `${stem}-otimizada.${type === 'image/jpeg' ? 'jpg' : 'webp'}`;
}

function fileIdentity(file: File) {
  return (
    preparedOrigins.get(file) ??
    `${file.name}:${file.size}:${file.lastModified}:${file.type}`
  );
}

function yieldToBrowser() {
  return new Promise<void>((resolve) => {
    if (typeof requestAnimationFrame === 'function') {
      requestAnimationFrame(() => resolve());
      return;
    }
    setTimeout(resolve, 0);
  });
}
