// Safari can send an empty multipart body for disk-backed or IndexedDB-restored
// Files. Materialize each attachment immediately before fetch, not before saving
// it locally: a later IndexedDB read can create a disk-backed File again.
// https://bugs.webkit.org/show_bug.cgi?id=319985
export type AttachmentIssue = { index: number; field: string; name: string };

export class UnreadableAttachmentError extends Error {
  constructor(public attachment: AttachmentIssue) {
    super(
      `Não foi possível abrir "${attachment.name}". Selecione o arquivo novamente.`,
    );
    this.name = 'UnreadableAttachmentError';
  }
}

export async function readUploadFile(
  file: File,
  attachment: AttachmentIssue,
  signal?: AbortSignal,
) {
  signal?.throwIfAborted();
  try {
    const bytes = await file.arrayBuffer();
    if (bytes.byteLength !== file.size) throw new Error('Incomplete file');
    signal?.throwIfAborted();
    return bytes;
  } catch {
    signal?.throwIfAborted();
    throw new UnreadableAttachmentError(attachment);
  }
}

export async function prepareUploadForm(form: FormData, signal?: AbortSignal) {
  const prepared = new FormData();
  for (const [index, [name, value]] of [...form.entries()].entries()) {
    signal?.throwIfAborted();
    if (typeof value === 'string') {
      prepared.append(name, value);
      continue;
    }
    const bytes = await readUploadFile(
      value,
      { index, field: name, name: value.name || 'anexo' },
      signal,
    );
    signal?.throwIfAborted();
    prepared.append(name, new Blob([bytes], { type: value.type }), value.name);
  }
  return prepared;
}
