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
  NativeSelect,
  NativeSelectOption,
} from '@/components/ui/native-select';
import {
  ScannerService,
  normalizeCandidate,
  type ScanCandidate,
  type ScannerMode,
  type ScannerState,
} from '@/lib/scanner';
import { defaultScannerInput, type ScannerInput } from '@/lib/scanner-input';

export type ScanFeedback = 'success' | 'error' | 'silent';

type BarcodeScannerProps = {
  mode: ScannerMode;
  onAccepted: (
    candidate: ScanCandidate,
  ) => ScanFeedback | Promise<ScanFeedback>;
  title?: string;
  description?: string;
  notice?: string;
  autoStart?: boolean;
  fill?: boolean;
  onBack?: () => void;
};

let scannerAudioContext: AudioContext | null = null;
// Keep the chosen reader while moving between scanning steps in this session.
const scannerInputPreference: Partial<Record<ScannerInput, ScannerInput>> = {};

export function unlockScannerAudio() {
  try {
    const AudioContextConstructor =
      window.AudioContext ??
      (window as unknown as { webkitAudioContext?: typeof AudioContext })
        .webkitAudioContext;
    if (!AudioContextConstructor) return;
    scannerAudioContext ??= new AudioContextConstructor();
    if (scannerAudioContext.state === 'suspended') {
      void scannerAudioContext.resume().catch(() => {
        // Alguns navegadores só liberam áudio no próximo gesto do usuário.
      });
    }
  } catch {
    // O navegador ainda pode oferecer vibração ou feedback visual.
  }
}

export function BarcodeScanner({
  mode,
  onAccepted,
  title = mode === 'product' ? 'Leitor de produto' : 'Leitor de SN',
  description = mode === 'product'
    ? 'Aponte para o UPC, EAN ou JAN da embalagem.'
    : 'Alinhe somente a faixa do SN. IMEI, EID e outros códigos serão ignorados.',
  notice = '',
  autoStart = false,
  fill = false,
  onBack,
}: BarcodeScannerProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const manualInputRef = useRef<HTMLInputElement>(null);
  const scanFrameRef = useRef<HTMLDivElement>(null);
  const serviceRef = useRef<ScannerService | null>(null);
  const onAcceptedRef = useRef(onAccepted);
  const autoStartAttemptedRef = useRef(false);
  const [state, setState] = useState<ScannerState>('idle');
  const [error, setError] = useState('');
  const [manualValue, setManualValue] = useState('');
  const [input, setInput] = useState<ScannerInput | null>(null);
  const defaultInputRef = useRef<ScannerInput>('keyboard');
  const showManual = input === 'keyboard';
  const [cameras, setCameras] = useState<Array<{ id: string; label: string }>>(
    [],
  );
  const [cameraId, setCameraId] = useState('');

  useEffect(() => {
    // Resolve only after hydration; until then no camera can auto-start.
    const timer = window.setTimeout(() => {
      const defaultInput = defaultScannerInput({
        userAgent: navigator.userAgent,
        coarsePointer: window.matchMedia('(pointer: coarse)').matches,
        canHover: window.matchMedia('(hover: hover)').matches,
      });
      defaultInputRef.current = defaultInput;
      setInput(scannerInputPreference[defaultInput] ?? defaultInput);
    }, 0);
    return () => window.clearTimeout(timer);
  }, []);

  useEffect(() => {
    if (showManual) manualInputRef.current?.focus({ preventScroll: true });
  }, [showManual]);

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

  const deliverCandidate = useCallback((candidate: ScanCandidate) => {
    void Promise.resolve(onAcceptedRef.current(candidate))
      .then((feedback) => {
        if (feedback !== 'silent') playScannerFeedback(feedback);
      })
      .catch(() => playScannerFeedback('error'));
  }, []);

  const start = useCallback(
    async (selectedCamera = cameraId) => {
      unlockScannerAudio();
      autoStartAttemptedRef.current = true;
      scannerInputPreference[defaultInputRef.current] = 'camera';
      setInput('camera');
      const video = videoRef.current;
      const service = serviceRef.current;
      if (!video || !service) return;
      setError('');
      await service.start(
        video,
        mode,
        {
          onAccepted: deliverCandidate,
          onStateChange: setState,
          onError: setError,
          onCameras: (options, selected) => {
            setCameras(options);
            setCameraId(selected);
          },
        },
        scanFrameRef.current,
        selectedCamera || undefined,
      );
    },
    [cameraId, deliverCandidate, mode],
  );

  useEffect(() => {
    if (!autoStart || input !== 'camera' || autoStartAttemptedRef.current)
      return;
    const timer = window.setTimeout(() => {
      if (autoStartAttemptedRef.current) return;
      autoStartAttemptedRef.current = true;
      void start();
    }, 0);
    return () => window.clearTimeout(timer);
  }, [autoStart, input, start]);

  const stop = () => {
    void serviceRef.current?.stop();
    setState('idle');
  };

  const submitManual = () => {
    unlockScannerAudio();
    const format = mode === 'product' ? 'manual_gtin' : 'manual_code_128';
    const candidate = normalizeCandidate(manualValue, format, mode);
    if (!candidate) {
      setError(
        mode === 'product'
          ? 'Digite um UPC, EAN ou JAN válido, incluindo o dígito verificador.'
          : 'Digite um SN de 8 a 18 caracteres contendo pelo menos uma letra.',
      );
      manualInputRef.current?.select();
      playScannerFeedback('error');
      return;
    }
    setError('');
    deliverCandidate(candidate);
    setManualValue('');
    manualInputRef.current?.focus({ preventScroll: true });
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
            <h2 className="text-base font-bold tracking-tight sm:text-lg">
              {title}
            </h2>
            <Badge className="scanner-mode-badge bg-white/10 text-white ring-1 ring-white/10 hover:bg-white/10">
              {mode === 'product' ? 'UPC · EAN · JAN' : 'Somente SN'}
            </Badge>
          </div>
          <p className="scanner-description mt-1 line-clamp-2 text-sm leading-5 text-white/60">
            {showManual
              ? mode === 'product'
                ? 'Bipe o UPC, EAN ou JAN da embalagem no campo abaixo.'
                : 'Bipe somente o SN. IMEI e EID não são aceitos.'
              : description}
          </p>
        </div>
        <ScanLine className="mt-1 size-5 shrink-0 text-sky" />
      </div>

      <div className="flex min-h-0 flex-1 flex-col gap-3 p-3 sm:p-4">
        <div
          className={`scanner-camera scanner-grid relative isolate rounded-[1.1rem] border border-white/10 bg-[#06111f] px-4 text-center ${showManual ? 'overflow-y-auto py-3' : 'grid place-items-center overflow-hidden'} ${fill ? 'min-h-[145px] flex-1' : 'min-h-[240px] sm:min-h-[310px]'}`}
        >
          <video
            aria-label="Imagem ao vivo da câmera"
            className={`absolute inset-0 size-full object-cover transition-opacity ${scanning ? 'opacity-100' : 'opacity-0'}`}
            muted
            playsInline
            ref={videoRef}
          />
          {!showManual && (
            <div
              className={`scan-frame ${mode === 'apple_serial' ? 'scan-frame-serial' : 'scan-frame-product'}`}
              aria-hidden="true"
              ref={scanFrameRef}
            >
              <span className="corner corner-tl" />
              <span className="corner corner-tr" />
              <span className="corner corner-bl" />
              <span className="corner corner-br" />
              {scanning && <span className="scan-beam" />}
            </div>
          )}

          {!scanning && !showManual && (
            <div className="relative z-10 flex max-w-sm flex-col items-center">
              <span className="grid size-12 place-items-center rounded-2xl bg-white/8 ring-1 ring-white/10 sm:size-14">
                <Camera className="size-6 text-sky" strokeWidth={1.8} />
              </span>
              <p className="mt-3 text-sm font-semibold sm:text-base">
                {requestingPermission
                  ? 'Abrindo a câmera…'
                  : 'Câmera desligada'}
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

          {showManual && (
            <div className="relative z-10 w-full rounded-2xl border border-white/15 bg-[#07182a]/95 p-3 text-left shadow-2xl backdrop-blur">
              <p className="mb-2 text-sm font-bold">Bipador USB / Bluetooth</p>
              <p className="mb-3 text-xs leading-5 text-white/70">
                Use um leitor em modo teclado, com Enter ao final da leitura.
                Você também pode digitar o código abaixo.
              </p>
              <label
                className="text-sm font-semibold"
                htmlFor={`manual-${mode}`}
              >
                {mode === 'product' ? 'Código comercial' : 'Número de série'}
              </label>
              <div className="mt-2 grid grid-cols-[1fr_auto] gap-2">
                <Input
                  autoCapitalize="characters"
                  autoComplete="off"
                  spellCheck={false}
                  ref={manualInputRef}
                  className="h-11 min-w-0 border-white/15 bg-black/20 font-mono text-white placeholder:text-white/35"
                  id={`manual-${mode}`}
                  onChange={(event) => setManualValue(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter') {
                      event.preventDefault();
                      event.stopPropagation();
                      submitManual();
                    }
                  }}
                  placeholder={
                    mode === 'product' ? '195950638011' : 'HC9P06R095'
                  }
                  value={manualValue}
                />
                <Button
                  type="button"
                  className="h-11 rounded-xl bg-white text-ink hover:bg-white/90"
                  onClick={submitManual}
                >
                  Confirmar
                </Button>
              </div>
            </div>
          )}
        </div>

        {(error || notice) && (
          <div
            className="flex shrink-0 items-start gap-2 rounded-xl bg-amber-950/90 px-3 py-2.5 text-left text-sm text-amber-50 ring-1 ring-amber-300/20"
            role="alert"
          >
            <TriangleAlert className="mt-0.5 size-4 shrink-0" />
            <span>{error || notice}</span>
          </div>
        )}

        {!showManual && cameras.length > 1 && (
          <label className="flex shrink-0 items-center gap-2 text-sm">
            <span className="shrink-0">Câmera</span>
            <NativeSelect
              aria-label="Selecionar câmera para leitura"
              className="h-9 min-w-0 flex-1 border-white/20 bg-ink text-white"
              disabled={requestingPermission}
              value={cameraId}
              onChange={(event) => {
                setCameraId(event.target.value);
                void start(event.target.value);
              }}
            >
              {cameras.map((camera) => (
                <NativeSelectOption value={camera.id} key={camera.id}>
                  {camera.label}
                </NativeSelectOption>
              ))}
            </NativeSelect>
          </label>
        )}
        {!showManual && (
          <p className="scanner-distance-tip shrink-0 text-center text-xs text-white/65">
            Mantenha a caixa a cerca de 15–30 cm. Afaste um pouco se a imagem
            estiver sem foco.
          </p>
        )}
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
            className="h-11 min-w-0 rounded-xl bg-sky px-2 text-sm font-bold text-ink hover:bg-sky/90 sm:h-12 sm:px-4 sm:text-base"
            disabled={requestingPermission}
            onClick={() => (scanning ? stop() : void start())}
          >
            {scanning ? (
              <Pause className={`size-5 ${onBack ? 'hidden sm:block' : ''}`} />
            ) : (
              <ScanLine
                className={`size-5 ${onBack ? 'hidden sm:block' : ''}`}
              />
            )}
            {scanning
              ? 'Pausar'
              : requestingPermission
                ? 'Abrindo…'
                : 'Abrir câmera'}
          </Button>
          <Button
            aria-label="Usar bipador USB/Bluetooth ou digitar"
            aria-pressed={showManual}
            className="h-11 min-w-0 rounded-xl border-white/15 bg-white/5 px-2 text-white hover:bg-white/10 sm:h-12 sm:px-4"
            onClick={() => {
              scannerInputPreference[defaultInputRef.current] = 'keyboard';
              autoStartAttemptedRef.current = true;
              stop();
              setError('');
              setInput('keyboard');
            }}
            variant="outline"
          >
            <Keyboard className={onBack ? 'hidden sm:block' : ''} />
            <span>Bipador</span>
          </Button>
        </div>
      </div>
    </div>
  );
}

export function playScannerFeedback(kind: Exclude<ScanFeedback, 'silent'>) {
  navigator.vibrate?.(kind === 'success' ? 70 : [120, 80, 120]);
  try {
    unlockScannerAudio();
    const context = scannerAudioContext;
    if (!context) return;
    if (context.state === 'suspended') {
      void context
        .resume()
        .then(() => emitScannerTone(context, kind))
        .catch(() => {
          // A vibração e o aviso visual continuam disponíveis.
        });
      return;
    }
    emitScannerTone(context, kind);
  } catch {
    // O feedback visual da etapa continua disponível.
  }
}

function emitScannerTone(
  context: AudioContext,
  kind: Exclude<ScanFeedback, 'silent'>,
) {
  if (kind === 'success') {
    emitTone(context, 1046, context.currentTime, 0.09, 0.12);
    return;
  }
  emitTone(context, 220, context.currentTime, 0.11, 0.14);
  emitTone(context, 165, context.currentTime + 0.15, 0.14, 0.14);
}

function emitTone(
  context: AudioContext,
  frequency: number,
  startAt: number,
  duration: number,
  volume: number,
) {
  try {
    const oscillator = context.createOscillator();
    const gain = context.createGain();
    oscillator.type = 'sine';
    oscillator.frequency.setValueAtTime(frequency, startAt);
    gain.gain.setValueAtTime(0.0001, startAt);
    gain.gain.exponentialRampToValueAtTime(volume, startAt + 0.01);
    gain.gain.exponentialRampToValueAtTime(
      0.0001,
      startAt + Math.max(0.03, duration),
    );
    oscillator.connect(gain);
    gain.connect(context.destination);
    oscillator.start(startAt);
    oscillator.stop(startAt + duration + 0.01);
  } catch {
    // O feedback visual da etapa continua disponível.
  }
}
