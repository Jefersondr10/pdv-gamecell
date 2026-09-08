// Safari can send an empty multipart body for disk-backed or IndexedDB-restored
// Files. Materialize each attachment immediately before fetch, not before saving
// it locally: a later IndexedDB read can create a disk-backed File again.
// https://bugs.webkit.org/show_bug.cgi?id=319985
export async function prepareUploadForm(form: FormData, signal?: AbortSignal) {
  const prepared = new FormData();
  for (const [name, value] of form.entries()) {
    signal?.throwIfAborted();
    if (typeof value === 'string') {
      prepared.append(name, value);
      continue;
    }
    let bytes: ArrayBuffer;
    try {
      bytes = await value.arrayBuffer();
      if (bytes.byteLength !== value.size) throw new Error('Incomplete file');
    } catch {
      signal?.throwIfAborted();
      throw new Error(
        'Não foi possível abrir um dos anexos neste aparelho. O envio continua guardado; mantenha esta página aberta e tente retomar em Envios.',
      );
    }
    signal?.throwIfAborted();
    prepared.append(name, new Blob([bytes], { type: value.type }), value.name);
  }
  return prepared;
}
