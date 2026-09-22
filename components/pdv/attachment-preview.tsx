'use client';

import { useEffect, useState, type ReactNode } from 'react';
import {
  ArrowLeft,
  ArrowRight,
  ExternalLink,
  LoaderCircle,
  ZoomIn,
  ZoomOut,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import type { AttachmentRecord } from '@/lib/pdv-types';

type PreviewFile = Pick<AttachmentRecord, 'name' | 'mimeType' | 'url'>;

/** Keeps protected files in the current app/session; never changes their contents. */
export function AttachmentPreviewLink({
  file,
  title,
  children,
  className,
}: {
  file: PreviewFile;
  title: string;
  children: ReactNode;
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <a
        href={file.url}
        target="_blank"
        rel="noopener noreferrer"
        title={title}
        className={className}
        onClick={(event) => {
          if (
            event.button !== 0 ||
            event.ctrlKey ||
            event.metaKey ||
            event.shiftKey ||
            event.altKey
          )
            return;
          event.preventDefault();
          event.stopPropagation();
          setOpen(true);
        }}
      >
        {children}
      </a>
      {open && (
        <DialogContent className="flex h-[92dvh] max-h-[92dvh] max-w-[calc(100%-1rem)] flex-col gap-3 overflow-hidden sm:max-w-4xl">
          <DialogHeader className="shrink-0 pr-8">
            <DialogTitle>{title}</DialogTitle>
            <DialogDescription className="break-all text-xs">
              {file.name}
            </DialogDescription>
          </DialogHeader>
          <AttachmentPreview key={file.url} file={file} />
          <div className="flex shrink-0 flex-wrap items-center justify-between gap-2 border-t pt-3">
            <a
              className="inline-flex min-h-10 items-center gap-2 rounded-lg px-2 text-sm font-semibold text-primary hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              href={file.url}
              target="_blank"
              rel="noopener noreferrer"
            >
              <ExternalLink className="size-4" /> Abrir original
            </a>
            <Button variant="outline" onClick={() => setOpen(false)}>
              Fechar comprovante
            </Button>
          </div>
        </DialogContent>
      )}
    </Dialog>
  );
}

export function AttachmentPreview({ file }: { file: PreviewFile }) {
  const isPdf = file.mimeType === 'application/pdf';
  const isImage = file.mimeType.startsWith('image/');
  const [pages, setPages] = useState<string[]>([]);
  const [page, setPage] = useState(0);
  const [zoom, setZoom] = useState(1);
  const [loading, setLoading] = useState(isPdf);
  const [error, setError] = useState('');
  const [imageFailed, setImageFailed] = useState(false);
  useEffect(() => {
    if (!isPdf) return;
    const controller = new AbortController();
    let alive = true;
    const urls: string[] = [];
    const timer = window.setTimeout(() => controller.abort(), 30_000);
    void (async () => {
      try {
        const response = await fetch(file.url, {
          credentials: 'same-origin',
          cache: 'no-store',
          signal: controller.signal,
        });
        if (!response.ok)
          throw new Error(
            response.status === 401
              ? 'Entre novamente para visualizar o comprovante.'
              : 'Não foi possível carregar o comprovante. Tente novamente ou abra o original.',
          );
        const bytes = new Uint8Array(await response.arrayBuffer());
        window.clearTimeout(timer);
        const { receiptPdfImages } =
          await import('@/lib/report-receipt-images');
        for await (const image of receiptPdfImages(bytes, controller.signal)) {
          if (!alive) break;
          urls.push(
            URL.createObjectURL(
              new Blob([new Uint8Array(image)], { type: 'image/jpeg' }),
            ),
          );
          setPages([...urls]);
        }
      } catch (caught) {
        if (alive)
          setError(
            controller.signal.aborted
              ? 'O comprovante demorou para abrir. Tente novamente ou abra o original.'
              : caught instanceof Error
                ? caught.message
                : 'Não foi possível mostrar a prévia. Abra o original.',
          );
      } finally {
        window.clearTimeout(timer);
        if (alive) setLoading(false);
      }
    })();
    return () => {
      alive = false;
      window.clearTimeout(timer);
      controller.abort();
      urls.forEach((url) => URL.revokeObjectURL(url));
    };
  }, [file.url, isPdf]);
  const src = isPdf ? pages[page] : isImage ? file.url : null;
  return (
    <>
      <div className="flex shrink-0 flex-wrap items-center justify-between gap-2 text-xs">
        <div className="flex items-center gap-2">
          {isPdf && pages.length > 0 ? (
            <>
              <Button
                size="icon-sm"
                variant="outline"
                aria-label="Página anterior"
                disabled={page === 0}
                onClick={() => {
                  setPage(page - 1);
                  setImageFailed(false);
                }}
              >
                <ArrowLeft />
              </Button>
              <output aria-live="polite">
                Página {page + 1} de {pages.length}
                {loading ? ' · carregando…' : ''}
              </output>
              <Button
                size="icon-sm"
                variant="outline"
                aria-label="Próxima página"
                disabled={page >= pages.length - 1}
                onClick={() => {
                  setPage(page + 1);
                  setImageFailed(false);
                }}
              >
                <ArrowRight />
              </Button>
            </>
          ) : (
            <span>{isPdf ? 'Comprovante PDF' : 'Comprovante'}</span>
          )}
        </div>
        <div className="flex items-center gap-2">
          <Button
            size="icon-sm"
            variant="outline"
            aria-label="Diminuir comprovante"
            disabled={zoom === 1 || !src}
            onClick={() => setZoom((value) => Math.max(1, value - 0.5))}
          >
            <ZoomOut />
          </Button>
          <Button
            size="sm"
            variant="ghost"
            disabled={!src}
            onClick={() => setZoom(1)}
          >
            {zoom === 1 ? 'Ajustar à tela' : `${Math.round(zoom * 100)}%`}
          </Button>
          <Button
            size="icon-sm"
            variant="outline"
            aria-label="Ampliar comprovante"
            disabled={zoom >= 3 || !src}
            onClick={() => setZoom((value) => Math.min(3, value + 0.5))}
          >
            <ZoomIn />
          </Button>
        </div>
      </div>
      {error && (
        <p
          role="alert"
          className="shrink-0 rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900"
        >
          {error}
        </p>
      )}
      <div className="min-h-0 flex-1 overflow-auto overscroll-contain rounded-xl border bg-slate-100 p-2">
        {src && !imageFailed ? (
          // oxlint-disable-next-line next/no-img-element -- Preserve intrinsic document dimensions and authenticated/local-blob URLs without image optimization.
          <img
            key={src}
            src={src}
            alt={`Comprovante ${file.name}${isPdf ? ` · página ${page + 1}` : ''}`}
            decoding="async"
            className="mx-auto block h-auto rounded-md bg-white object-contain"
            style={{
              maxWidth: zoom === 1 ? '100%' : 'none',
              maxHeight: zoom === 1 ? '60dvh' : undefined,
              width: zoom === 1 ? undefined : `${zoom * 100}%`,
            }}
            onError={() => setImageFailed(true)}
          />
        ) : loading && !error ? (
          <output className="flex h-full min-h-36 items-center justify-center gap-2 text-sm">
            <LoaderCircle className="size-5 animate-spin" /> Abrindo
            comprovante…
          </output>
        ) : (
          <p className="p-5 text-center text-sm text-muted-foreground">
            Não foi possível mostrar a prévia. Use “Abrir original”.
          </p>
        )}
      </div>
    </>
  );
}
