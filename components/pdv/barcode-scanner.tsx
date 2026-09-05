'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import {
  ArrowLeft,
  Camera,
  Keyboard,
  Pause,
  ScanLine,
  TriangleAlert,
} from 'lucide-react';

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
  autoStart?: boolean;
  fill?: boolean;
  onBack?: () => void;
};

export function BarcodeScanner({
  mode,
  onAccepted,
  title = mode === 'product' ? 'Leitor de produto' : 'Leitor de SN',
  description =
    mode === 'product'
      ? 'Aponte para o UPC, EAN ou JAN da embalagem.'
      : 'Alinhe somente a faixa do SN. IMEI, EID e outros códigos serão ignorados.',
  autoStart = false,
  fill = false,
  onBack,
}: BarcodeScannerProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const serviceRef = useRef<ScannerService | null>(null);
  const onAcceptedRef = useRef(onAccepted);
  const autoStartAttemptedRef = useRef(false);
  const [state, setState] = useState<ScannerState>('idle');
  const [error, setError] = useState('');
  const [manualValue, setManualValue] = useState('');
  const [showManual, setShowManual] = useState(false);

  useEffect(() => {
    onAcceptedRef.current = onAccepted;
  }, [onAccepted]);

  useEffect(() => {
    const service = new ScannerService();
    serviceRef.current = service;
    return () => {
      void service.stop(false);
      serviceRef.current = null;
    };
  }, []);

  const start = useCallback(async () => {
    const video = videoRef.current;
    const service = serviceRef.current;
    if (!video || !service) return;
    setError('');
    await service.start(video, mode, {
      onAccepted: (candidate) => {
        navigator.vibrate?.(80);
        onAcceptedRef.current(candidate);
      },
      onStateChange: setState,
      onError: setError,
    });
  }, [mode]);

  useEffect(() => {
    if (!autoStart || autoStartAttemptedRef.current) return;
    const timer = window.setTimeout(() => {
      if (autoStartAttemptedRef.current) return;
      autoStartAttemptedRef.current = true;
      void start();
    }, 0);
    return () => window.clearTimeout(timer);
  }, [autoStart, start]);

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
          : 'Digite um SN de 8 a 18 caracteres contendo pelo menos uma letra.',
      );
      return;
    }
    setError('');
    onAcceptedRef.current(candidate);
    setManualValue('');
    setShowManual(false);
  };

  const scanning = state === 'scanning' || state === 'loading-decoder';
  const requestingPermission = state === 'requesting-permission';

  return (
    <div
      className={`relative flex min-h-0 flex-col overflow-hidden rounded-[1.25rem] bg-ink text-white shadow-[0_24px_70px_rgb(9_25_47/18%)] ${fill ? 'h-full' : ''}`}
    >
      <div className="flex shrink-0 items-start justify-between gap-3 border-b border-white/10 px-4 py-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="text-base font-bold tracking-tight sm:text-lg">{title}</h2>
            <Badge className="bg-white/10 text-white ring-1 ring-white/10 hover:bg-white/10">
              {mode === 'product' ? 'UPC · EAN · JAN' : 'Somente SN'}
            </Badge>
          </div>
          <p className="scanner-description mt-1 line-clamp-2 text-sm leading-5 text-white/60">
            {description}
          </p>
        </div>
        <ScanLine className="mt-1 size-5 shrink-0 text-sky" />
      </div>

      <div className="flex min-h-0 flex-1 flex-col gap-3 p-3 sm:p-4">
        <div
          className={`scanner-camera scanner-grid relative isolate grid place-items-center overflow-hidden rounded-[1.1rem] border border-white/10 bg-[#06111f] px-4 text-center ${fill ? 'min-h-[145px] flex-1' : 'min-h-[240px] sm:min-h-[310px]'}`}
        >
          <video
            aria-label="Imagem ao vivo da câmera"
            className={`absolute inset-0 size-full object-cover transition-opacity ${scanning ? 'opacity-75' : 'opacity-0'}`}
            muted
            playsInline
            ref={videoRef}
          />
          <div
            className={`scan-frame ${mode === 'apple_serial' ? 'scan-frame-serial' : 'scan-frame-product'}`}
            aria-hidden="true"
          >
            <span className="corner corner-tl" />
            <span className="corner corner-tr" />
            <span className="corner corner-bl" />
            <span className="corner corner-br" />
            {scanning && <span className="scan-beam" />}
          </div>

          {!scanning && (
            <div className="relative z-10 flex max-w-sm flex-col items-center">
              <span className="grid size-12 place-items-center rounded-2xl bg-white/8 ring-1 ring-white/10 sm:size-14">
                <Camera className="size-6 text-sky" strokeWidth={1.8} />
              </span>
              <p className="mt-3 text-sm font-semibold sm:text-base">
                {requestingPermission ? 'Abrindo a câmera…' : 'Câmera desligada'}
              </p>
              <p className="mt-1 text-xs leading-5 text-white/50 sm:text-sm">
                O acesso é usado somente durante esta etapa.
              </p>
            </div>
          )}

          {scanning && (
            <p className="absolute bottom-3 z-10 rounded-full bg-black/65 px-3 py-1.5 text-xs font-semibold backdrop-blur sm:text-sm">
              {mode === 'product'
                ? 'Centralize o UPC ou EAN'
                : 'Mantenha somente o SN dentro da faixa'}
            </p>
          )}

          {error && (
            <div className="absolute inset-x-3 top-3 z-20 flex items-start gap-2 rounded-xl bg-amber-950/90 px-3 py-2.5 text-left text-sm text-amber-50 ring-1 ring-amber-300/20 backdrop-blur">
              <TriangleAlert className="mt-0.5 size-4 shrink-0" />
              <span>{error}</span>
            </div>
          )}

          {showManual && (
            <div className="absolute inset-x-3 bottom-3 z-30 rounded-2xl border border-white/15 bg-[#07182a]/95 p-3 text-left shadow-2xl backdrop-blur">
              <label className="text-sm font-semibold" htmlFor={`manual-${mode}`}>
                {mode === 'product' ? 'Código comercial' : 'Número de série'}
              </label>
              <div className="mt-2 grid grid-cols-[1fr_auto] gap-2">
                <Input
                  autoCapitalize="characters"
                  className="h-11 min-w-0 border-white/15 bg-black/20 font-mono text-white placeholder:text-white/35"
                  id={`manual-${mode}`}
                  onChange={(event) => setManualValue(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter') submitManual();
                  }}
                  placeholder={mode === 'product' ? '195950638011' : 'HC9P06R095'}
                  value={manualValue}
                />
                <Button
                  className="h-11 rounded-xl bg-white text-ink hover:bg-white/90"
                  onClick={submitManual}
                >
                  Confirmar
                </Button>
              </div>
            </div>
          )}
        </div>

        <div
          className={`grid shrink-0 gap-2 ${onBack ? 'grid-cols-[auto_1fr_auto]' : 'grid-cols-[1fr_auto]'}`}
        >
          {onBack && (
            <Button
              aria-label="Voltar"
              className="h-11 rounded-xl border-white/15 bg-white/5 px-3 text-white hover:bg-white/10 sm:h-12"
              onClick={onBack}
              variant="outline"
            >
              <ArrowLeft />
            </Button>
          )}
          <Button
            className="h-11 rounded-xl bg-sky px-4 text-sm font-bold text-ink hover:bg-sky/90 sm:h-12 sm:text-base"
            disabled={requestingPermission}
            onClick={scanning ? stop : start}
          >
            {scanning ? <Pause className="size-5" /> : <ScanLine className="size-5" />}
            {scanning
              ? 'Pausar'
              : requestingPermission
                ? 'Abrindo…'
                : 'Abrir câmera'}
          </Button>
          <Button
            aria-label={mode === 'product' ? 'Digitar código' : 'Digitar SN'}
            className="h-11 rounded-xl border-white/15 bg-white/5 px-4 text-white hover:bg-white/10 sm:h-12"
            onClick={() => setShowManual((current) => !current)}
            variant="outline"
          >
            <Keyboard />
            <span className="hidden sm:inline">Digitar</span>
          </Button>
        </div>
      </div>
    </div>
  );
}
