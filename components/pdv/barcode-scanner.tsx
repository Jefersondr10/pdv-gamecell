'use client';

import { useEffect, useRef, useState } from 'react';
import { Camera, Keyboard, Pause, ScanLine, TriangleAlert } from 'lucide-react';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  ScannerService,
  normalizeCandidate,
  type ScanCandidate,
  type ScannerMode,
  type ScannerState,
} from '@/lib/scanner';

type BarcodeScannerProps = {
  mode: ScannerMode;
  onAccepted: (candidate: ScanCandidate) => void;
  title?: string;
  description?: string;
};

export function BarcodeScanner({
  mode,
  onAccepted,
  title = mode === 'product' ? 'Leitor de produto' : 'Leitor de SN',
  description =
    mode === 'product'
      ? 'Aponte para o UPC, EAN ou JAN da embalagem.'
      : 'Aponte para o código abaixo de “Serial No.”',
}: BarcodeScannerProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const serviceRef = useRef<ScannerService | null>(null);
  const [state, setState] = useState<ScannerState>('idle');
  const [error, setError] = useState('');
  const [manualValue, setManualValue] = useState('');
  const [showManual, setShowManual] = useState(false);
  const [ambiguous, setAmbiguous] = useState(false);

  useEffect(() => {
    const service = new ScannerService();
    serviceRef.current = service;
    return () => {
      void service.stop(false);
    };
  }, []);

  const start = async () => {
    const video = videoRef.current;
    const service = serviceRef.current;
    if (!video || !service) return;
    setError('');
    setAmbiguous(false);
    await service.start(video, mode, {
      onAccepted: (candidate) => {
        setAmbiguous(false);
        navigator.vibrate?.(80);
        onAccepted(candidate);
      },
      onStateChange: setState,
      onAmbiguous: () => setAmbiguous(true),
      onError: setError,
    });
  };

  const stop = () => {
    void serviceRef.current?.stop();
    setState('idle');
  };

  const submitManual = () => {
    const format = mode === 'product' ? 'manual_gtin' : 'manual_code_128';
    const candidate = normalizeCandidate(manualValue, format, mode);
    if (!candidate) {
      setError(
        mode === 'product'
          ? 'Digite um UPC, EAN ou JAN válido, incluindo o dígito verificador.'
          : 'Digite um SN com 8 a 18 letras ou números.',
      );
      return;
    }
    setError('');
    onAccepted(candidate);
    setManualValue('');
    setShowManual(false);
  };

  const scanning = state === 'scanning' || state === 'loading-decoder';
  const requestingPermission = state === 'requesting-permission';

  return (
    <div className="overflow-hidden rounded-[1.25rem] bg-ink text-white shadow-[0_24px_70px_rgb(9_25_47/18%)]">
      <div className="flex items-start justify-between gap-4 border-b border-white/10 px-4 py-4 sm:px-5">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="text-lg font-bold tracking-tight">{title}</h2>
            <Badge className="bg-white/10 text-white ring-1 ring-white/10 hover:bg-white/10">
              {mode === 'product' ? 'UPC · EAN · JAN' : 'SN · Code 128'}
            </Badge>
          </div>
          <p className="mt-1 text-sm text-white/55">{description}</p>
        </div>
        <ScanLine className="mt-1 size-6 shrink-0 text-sky" />
      </div>

      <div className="p-4 sm:p-5">
        <div className="scanner-grid relative isolate grid min-h-[260px] place-items-center overflow-hidden rounded-[1.1rem] border border-white/10 bg-[#06111f] px-6 text-center sm:min-h-[330px]">
          <video
            aria-label="Imagem ao vivo da câmera"
            className={`absolute inset-0 size-full object-cover transition-opacity ${scanning ? 'opacity-70' : 'opacity-0'}`}
            muted
            playsInline
            ref={videoRef}
          />
          <div className="scan-frame" aria-hidden="true">
            <span className="corner corner-tl" />
            <span className="corner corner-tr" />
            <span className="corner corner-bl" />
            <span className="corner corner-br" />
            {scanning && <span className="scan-beam" />}
          </div>
          {!scanning && (
            <div className="relative z-10 flex max-w-sm flex-col items-center">
              <span className="grid size-16 place-items-center rounded-2xl bg-white/8 ring-1 ring-white/10">
                <Camera className="size-7 text-sky" strokeWidth={1.8} />
              </span>
              <p className="mt-4 text-base font-semibold">
                {requestingPermission ? 'Abrindo a câmera…' : 'Câmera desligada'}
              </p>
              <p className="mt-1 text-sm leading-6 text-white/50">
                A câmera será usada somente durante a leitura.
              </p>
            </div>
          )}
          {scanning && (
            <p className="absolute bottom-5 z-10 rounded-full bg-black/55 px-4 py-2 text-sm font-semibold backdrop-blur">
              Centralize um único código na moldura
            </p>
          )}
        </div>

        {(ambiguous || error) && (
          <div className="mt-3 flex items-start gap-2 rounded-xl bg-amber-400/10 px-3 py-2.5 text-sm text-amber-100 ring-1 ring-amber-300/15">
            <TriangleAlert className="mt-0.5 size-4 shrink-0" />
            <span>
              {error || 'Mais de um código foi encontrado. Aproxime somente a etiqueta desejada.'}
            </span>
          </div>
        )}

        {showManual && (
          <div className="mt-3 rounded-2xl border border-white/10 bg-white/5 p-3">
            <label className="text-sm font-semibold" htmlFor={`manual-${mode}`}>
              {mode === 'product' ? 'Código comercial' : 'Número de série'}
            </label>
            <div className="mt-2 grid gap-2 sm:grid-cols-[1fr_auto]">
              <Input
                autoCapitalize="characters"
                className="h-12 border-white/15 bg-black/20 font-mono text-white placeholder:text-white/35"
                id={`manual-${mode}`}
                onChange={(event) => setManualValue(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') submitManual();
                }}
                placeholder={mode === 'product' ? 'Ex.: 195950638011' : 'Ex.: HC9P06R095'}
                value={manualValue}
              />
              <Button className="h-12 rounded-xl bg-white text-ink hover:bg-white/90" onClick={submitManual}>
                Confirmar
              </Button>
            </div>
          </div>
        )}

        <div className="mt-4 grid gap-3 sm:grid-cols-[1fr_auto]">
          <Button
            className="h-14 rounded-2xl bg-sky px-5 text-base font-bold text-ink hover:bg-sky/90"
            disabled={requestingPermission}
            onClick={scanning ? stop : start}
          >
            {scanning ? <Pause className="size-5" /> : <ScanLine className="size-5" />}
            {scanning ? 'Pausar leitura' : requestingPermission ? 'Abrindo câmera…' : 'Abrir câmera'}
          </Button>
          <Button
            className="h-14 rounded-2xl border-white/15 bg-white/5 px-5 text-white hover:bg-white/10"
            onClick={() => setShowManual((current) => !current)}
            variant="outline"
          >
            <Keyboard /> Digitar {mode === 'product' ? 'código' : 'SN'}
          </Button>
        </div>
      </div>
    </div>
  );
}
