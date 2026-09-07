'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { Copy, LoaderCircle, MessageCircle, RefreshCw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Textarea } from '@/components/ui/textarea';
import {
  buildStockWhatsAppMessage,
  type StockOfferResponse,
} from '@/lib/stock-whatsapp';
import { messageOf, requestJson } from '@/lib/client-api';

export function StockWhatsAppDialog({
  storeName,
  onClose,
}: {
  storeName: string;
  onClose: () => void;
}) {
  const [message, setMessage] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [feedback, setFeedback] = useState('');
  const [ready, setReady] = useState(false);
  const [unpriced, setUnpriced] = useState(false);
  const [sharing, setSharing] = useState(false);
  const editor = useRef<HTMLTextAreaElement>(null);
  const request = useRef<AbortController | null>(null);

  const regenerate = useCallback(async () => {
    request.current?.abort();
    const controller = new AbortController();
    request.current = controller;
    setLoading(true);
    setReady(false);
    setError('');
    setFeedback('');
    try {
      const response = await requestJson<StockOfferResponse>(
        '/api/inventory?view=whatsapp',
        { signal: controller.signal },
      );
      if (controller.signal.aborted) return;
      setMessage(buildStockWhatsAppMessage(response, storeName));
      setUnpriced(response.rows.some((row) => row.defaultPriceCents <= 0));
      setReady(response.rows.length > 0);
    } catch (caught) {
      if (!controller.signal.aborted) setError(messageOf(caught));
    } finally {
      if (!controller.signal.aborted) setLoading(false);
    }
  }, [storeName]);

  useEffect(() => {
    const timer = window.setTimeout(() => void regenerate(), 0);
    return () => {
      window.clearTimeout(timer);
      request.current?.abort();
    };
  }, [regenerate]);

  async function copyMessage() {
    setFeedback('');
    try {
      if (!navigator.clipboard?.writeText)
        throw new Error('clipboard unavailable');
      await navigator.clipboard.writeText(message);
      setFeedback('Lista copiada. Cole na conversa ou no grupo do WhatsApp.');
    } catch {
      editor.current?.focus();
      editor.current?.select();
      setFeedback(
        'Não foi possível copiar automaticamente. O texto está selecionado: use Copiar no menu do seu aparelho.',
      );
    }
  }

  async function shareMessage() {
    setSharing(true);
    setFeedback('');
    try {
      // Uses the user's share chooser, never a predefined recipient or automatic send.
      if (
        navigator.share &&
        (!navigator.canShare || navigator.canShare({ text: message }))
      ) {
        await navigator.share({ text: message });
      } else {
        const url = `https://wa.me/?text=${encodeURIComponent(message)}`;
        // Long URLs are not portable; preserve the entire message through copying instead.
        if (url.length > 7000) {
          await copyMessage();
          setFeedback(
            'A lista é longa para abrir por link. Copie o texto completo e cole no WhatsApp.',
          );
        } else {
          window.open(url, '_blank', 'noopener,noreferrer');
          setFeedback(
            'Continue no WhatsApp. Se ele não abriu, use Copiar lista.',
          );
        }
      }
    } catch (caught) {
      if (!(caught instanceof Error && caught.name === 'AbortError'))
        setFeedback(
          'Não foi possível compartilhar. Use Copiar lista e cole no WhatsApp.',
        );
    } finally {
      setSharing(false);
    }
  }

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="flex h-dvh max-h-dvh max-w-none flex-col gap-0 overflow-hidden rounded-none p-0 pb-[env(safe-area-inset-bottom)] pt-[env(safe-area-inset-top)] [&_[data-slot=dialog-close]]:top-[calc(.5rem+env(safe-area-inset-top))] sm:h-[90dvh] sm:max-w-2xl sm:rounded-2xl sm:pb-0 sm:pt-0 sm:[&_[data-slot=dialog-close]]:top-2">
        <DialogHeader className="shrink-0 border-b p-4 pr-12">
          <DialogTitle className="flex items-center gap-2 text-lg font-bold">
            <MessageCircle className="size-5 text-success" /> Lista para
            WhatsApp
          </DialogTitle>
          <DialogDescription>
            Todos os produtos com estoque, sem quantidades e sem SNs. A
            pesquisa da tela não limita esta lista.
          </DialogDescription>
        </DialogHeader>
        <div className="flex min-h-0 flex-1 flex-col gap-3 bg-muted/30 p-3 sm:p-4">
          {loading ? (
            <output className="grid flex-1 place-items-center text-sm text-muted-foreground">
              <span className="flex items-center gap-2">
                <LoaderCircle className="size-4 animate-spin" /> Consultando
                estoque e preços atuais…
              </span>
            </output>
          ) : error ? (
            <div
              className="grid flex-1 place-items-center text-center"
              role="alert"
            >
              <div>
                <p className="font-semibold">Não foi possível gerar a lista.</p>
                <p className="mt-1 text-sm text-muted-foreground">{error}</p>
                <Button className="mt-3" onClick={() => void regenerate()}>
                  Tentar novamente
                </Button>
              </div>
            </div>
          ) : !ready ? (
            <div className="grid flex-1 place-items-center text-center">
              <div>
                <p className="font-semibold">
                  Nenhum produto disponível para anunciar.
                </p>
                <p className="mt-1 text-sm text-muted-foreground">
                  A lista inclui apenas produtos com unidades disponíveis.
                </p>
              </div>
            </div>
          ) : (
            <>
              <div className="flex shrink-0 flex-wrap items-center justify-between gap-2">
                <label
                  className="text-sm font-semibold"
                  htmlFor="stock-whatsapp-message"
                >
                  Prévia editável
                </label>
                <Button
                  className="h-9 rounded-lg text-sm"
                  variant="outline"
                  title="Substitui o texto editado por uma nova lista do estoque atual"
                  onClick={() => void regenerate()}
                  disabled={sharing}
                >
                  <RefreshCw className="size-4" /> Refazer lista
                </Button>
              </div>
              <Textarea
                id="stock-whatsapp-message"
                ref={editor}
                aria-describedby="stock-whatsapp-hint"
                className="min-h-0 flex-1 resize-none rounded-xl bg-background p-4 text-base leading-relaxed [field-sizing:fixed] md:text-base"
                value={message}
                onChange={(event) => {
                  setMessage(event.target.value);
                  setFeedback('');
                }}
                disabled={sharing}
                spellCheck={false}
              />
              <p
                className="shrink-0 text-sm text-muted-foreground"
                id="stock-whatsapp-hint"
              >
                Edite o título ou acrescente seus avisos, contatos e link do
                grupo. A edição vale só para esta mensagem; refazer a lista
                substitui o texto. Nada é enviado automaticamente.
              </p>
              {unpriced && (
                <p className="shrink-0 text-sm text-muted-foreground">
                  Produtos sem preço cadastrado aparecem como “Preço sob
                  consulta”.
                </p>
              )}
            </>
          )}
        </div>
        <DialogFooter className="m-0 shrink-0 gap-2 rounded-none border-t bg-background p-3 sm:flex-wrap">
          {feedback && (
            <output className="w-full text-left text-sm" aria-live="polite">
              {feedback}
            </output>
          )}
          <div className="grid w-full grid-cols-2 gap-2">
            <Button
              className="h-11 rounded-xl"
              variant="outline"
              disabled={!ready || loading || sharing || !message.trim()}
              onClick={() => void copyMessage()}
            >
              <Copy /> Copiar lista
            </Button>
            <Button
              className="h-11 rounded-xl"
              disabled={!ready || loading || sharing || !message.trim()}
              onClick={() => void shareMessage()}
            >
              {sharing ? (
                <LoaderCircle className="animate-spin" />
              ) : (
                <MessageCircle />
              )}{' '}
              WhatsApp
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
