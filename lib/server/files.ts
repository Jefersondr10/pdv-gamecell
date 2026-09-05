import { HttpError } from '@/lib/server/http';
import { runtime } from '@/lib/server/runtime';

export type PendingFile = {
  id: string;
  key: string;
  file: File;
};

const IMAGE_TYPES = new Set([
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/heic',
  'image/heif',
]);

export async function boundedFormData(
  request: Request,
  options: { maxBytes: number; tooLargeMessage: string },
) {
  const contentType = request.headers.get('content-type') ?? '';
  if (!contentType.toLowerCase().startsWith('multipart/form-data')) {
    throw new HttpError(415, 'Formato de envio inválido.', 'BAD_CONTENT_TYPE');
  }
  if (!request.body) {
    throw new HttpError(400, 'Dados do envio ausentes.', 'INVALID_MULTIPART');
  }
  const declaredLength = Number(request.headers.get('content-length'));
  if (Number.isFinite(declaredLength) && declaredLength > options.maxBytes) {
    throw new HttpError(413, options.tooLargeMessage, 'PAYLOAD_TOO_LARGE');
  }

  const reader = request.body.getReader();
  let received = 0;
  let exceeded = false;
  const limitedBody = new ReadableStream<Uint8Array>({
    async pull(controller) {
      const chunk = await reader.read();
      if (chunk.done) {
        controller.close();
        return;
      }
      received += chunk.value.byteLength;
      if (received > options.maxBytes) {
        exceeded = true;
        await reader.cancel('multipart limit exceeded');
        controller.error(new Error('multipart limit exceeded'));
        return;
      }
      controller.enqueue(chunk.value);
    },
    cancel(reason) {
      return reader.cancel(reason);
    },
  });

  try {
    return await new Response(limitedBody, {
      headers: { 'content-type': contentType },
    }).formData();
  } catch (error) {
    if (exceeded) {
      throw new HttpError(413, options.tooLargeMessage, 'PAYLOAD_TOO_LARGE');
    }
    throw new HttpError(
      400,
      'Não foi possível ler os arquivos enviados.',
      'INVALID_MULTIPART',
      error instanceof Error ? error.message : undefined,
    );
  }
}

export function assertFormDataKeys(
  form: FormData,
  allowed: (key: string) => boolean,
) {
  for (const key of form.keys()) {
    if (!allowed(key)) {
      throw new HttpError(
        400,
        'O envio contém um campo não reconhecido.',
        'UNKNOWN_MULTIPART_FIELD',
      );
    }
  }
}

export function validateFiles(
  values: FormDataEntryValue[],
  options: { required?: boolean; receipts?: boolean; max?: number } = {},
) {
  const files = values.filter((value): value is File => value instanceof File);
  if (options.required && files.length === 0) {
    throw new HttpError(400, 'Adicione ao menos uma foto.', 'PHOTO_REQUIRED');
  }
  if (files.length > (options.max ?? 8)) {
    throw new HttpError(400, 'Muitos arquivos anexados.', 'TOO_MANY_FILES');
  }
  for (const file of files) {
    const allowed =
      IMAGE_TYPES.has(file.type.toLowerCase()) ||
      (options.receipts && file.type.toLowerCase() === 'application/pdf');
    if (!allowed || file.size <= 0 || file.size > 10 * 1024 * 1024) {
      throw new HttpError(
        400,
        'Use imagens ou PDF de até 10 MB.',
        'INVALID_FILE',
      );
    }
  }
  return files;
}

export function prepareFile(
  storeId: string,
  scope: string,
  file: File,
): PendingFile {
  const id = crypto.randomUUID();
  const extension = safeExtension(file);
  return {
    id,
    key: `stores/${storeId}/${scope}/${id}${extension}`,
    file,
  };
}

export async function uploadFiles(files: PendingFile[]) {
  const results = await Promise.allSettled(
    files.map((pending) =>
      runtime().FILES.put(pending.key, pending.file.stream(), {
        httpMetadata: { contentType: pending.file.type },
        customMetadata: { originalName: pending.file.name.slice(0, 200) },
      }),
    ),
  );
  const failure = results.find(
    (result): result is PromiseRejectedResult => result.status === 'rejected',
  );
  if (failure) throw failure.reason;
}

export async function cleanupFiles(files: PendingFile[]) {
  await Promise.allSettled(
    files.map((pending) => runtime().FILES.delete(pending.key)),
  );
}

function safeExtension(file: File) {
  const nameExtension = file.name
    .toLowerCase()
    .match(/\.(jpe?g|png|webp|heic|heif|pdf)$/)?.[0];
  if (nameExtension) return nameExtension === '.jpeg' ? '.jpg' : nameExtension;
  const byType: Record<string, string> = {
    'image/jpeg': '.jpg',
    'image/png': '.png',
    'image/webp': '.webp',
    'image/heic': '.heic',
    'image/heif': '.heif',
    'application/pdf': '.pdf',
  };
  return byType[file.type.toLowerCase()] ?? '';
}
