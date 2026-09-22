'use client';
import { useAppBackHandler } from '@/components/pdv/use-app-back';
import { entryBackStep } from '@/lib/app-back';

import { useEffect, useMemo, useRef, useState } from 'react';
import {
  ArrowLeft,
  ArrowRight,
  Camera,
  Check,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  LoaderCircle,
  PackageCheck,
  RotateCcw,
  Trash2,
} from 'lucide-react';

import {
  BarcodeScanner,
  type ScanFeedback,
} from '@/components/pdv/barcode-scanner';
import { FlowFrame } from '@/components/pdv/flow-frame';
import { ProductColorSwatch } from '@/components/pdv/product-color-swatch';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import {
  formatMediaBytes,
  MEDIA_LIMITS,
  prepareMediaSelection,
  sumFileBytes,
} from '@/lib/client-media';
import { createOperationId } from '@/lib/client-operation-id';
import {
  PendingOperationError,
  type RecoveryScope,
} from '@/lib/client-operation-recovery';
import { useRecoverableDraft } from '@/components/pdv/use-recoverable-draft';
import { PendingOperationNotice } from '@/components/pdv/pending-operation-notice';
import type { ScanCandidate } from '@/lib/scanner';

type EntryStep =
  | 'product-scan'
  | 'product-confirm'
  | 'serials'
  | 'photos'
  | 'review'
  | 'done';

export type EntryProduct = {
  id: string;
  name: string;
  detail: string;
  color: string;
  memory: string;
  code: string;
};

type Product = EntryProduct;

type SerialItem = {
  raw: string;
  normalized: string;
};

export type EntrySubmission = {
  operationId: string;
  productId: string;
  gtin14: string;
  displayCode: string;
  productName: string;
  productDetail: string;
  serials: string[];
  photos: File[];
};

export type EntryCommitResult = {
  added: number;
  duplicates: number;
  capacityReached: boolean;
};

type EntryWizardProps = {
  onOpenMenu?: () => void;
  recoveryScope?: RecoveryScope;
  existingTestSerials?: readonly string[];
  productsByCode?: Record<string, EntryProduct>;
  onConfirmEntry?: (
    entry: EntrySubmission,
  ) => EntryCommitResult | Promise<EntryCommitResult>;
  storageMode?: 'browser' | 'session';
  lookupSerials?: (
    serials: string[],
  ) => Promise<Array<{ serial: string; status: 'available' | 'sold' }>>;
};

const ENTRY_STEPS = ['Produto', 'Seriais', 'Fotos', 'Revisão'] as const;

const ENTRY_STAGE_CARD_CLASS =
  'flow-stage-card flex h-full min-h-0 flex-col gap-0 overflow-hidden py-0';

const STEP_INDEX: Record<EntryStep, number> = {
  'product-scan': 0,
  'product-confirm': 0,
  serials: 1,
  photos: 2,
  review: 3,
  done: 3,
};

export function EntryWizard({
  existingTestSerials = [],
  productsByCode = {},
  onConfirmEntry,
  lookupSerials,
  recoveryScope,
  onOpenMenu,
}: EntryWizardProps) {
  const [step, setStep] = useState<EntryStep>('product-scan');
  const [commercialCode, setCommercialCode] = useState<ScanCandidate | null>(
    null,
  );
  const [product, setProduct] = useState<Product | null>(null);
  const [serials, setSerials] = useState<SerialItem[]>([]);
  const [photos, setPhotos] = useState<File[]>([]);
  const [preparingPhotos, setPreparingPhotos] = useState(false);
  const [photoProgress, setPhotoProgress] = useState('');
  const [photoError, setPhotoError] = useState('');
  const [saving, setSaving] = useState(false);
  const [submitError, setSubmitError] = useState('');
  const [savedCount, setSavedCount] = useState(0);
  const [ignoredCount, setIgnoredCount] = useState(0);
  const [serialChecksPending, setSerialChecksPending] = useState(0);
  const [announcement, setAnnouncement] = useState(
    'Etapa 1. Leia o UPC ou EAN do produto.',
  );
  const committedRef = useRef(false);
  const operationIdRef = useRef(createOperationId());
  const serialsRef = useRef<SerialItem[]>([]);
  const pendingSerialKeysRef = useRef(new Map<string, number>());
  const serialGenerationRef = useRef(0);
  const goBack = () => {
    if (saving || preparingPhotos) return true;
    const previous = entryBackStep(step);
    if (!previous) return false;
    serialGenerationRef.current += 1;
    pendingSerialKeysRef.current.clear();
    setSerialChecksPending(0);
    setStep(previous);
    setAnnouncement('Etapa anterior. Os dados preenchidos foram mantidos.');
    return true;
  };
  const existingSerialSet = useMemo(
    () => new Set(existingTestSerials),
    [existingTestSerials],
  );
  const draftValue = useMemo(
    () => ({ step, commercialCode, product, serials, photos }),
    [step, commercialCode, product, serials, photos],
  );
  const draft = useRecoverableDraft({
    scope: recoveryScope,
    kind: 'entry',
    operationId: operationIdRef,
    value: draftValue,
    empty: !commercialCode && !serials.length,
    done: step === 'done',
    restore: (value) => {
      setStep(value.step);
      setCommercialCode(value.commercialCode);
      setProduct(value.product);
      setSerials(value.serials);
      serialsRef.current = value.serials;
      setPhotos(value.photos);
      setAnnouncement('Rascunho recuperado. Confira os dados e continue.');
    },
    confirmed: (result) => {
      setSavedCount(result.added ?? serialsRef.current.length);
      setStep('done');
      setSaving(false);
      setSubmitError('');
      committedRef.current = true;
    },
  });

  useAppBackHandler(
    () => {
      if (!draft.ready) return true;
      if (draft.waiting || draft.blocked) {
        onOpenMenu?.();
        return Boolean(onOpenMenu);
      }
      return goBack();
    },
    true,
    10,
  );

  useEffect(
    () => () => {
      serialGenerationRef.current += 1;
      pendingSerialKeysRef.current.clear();
    },
    [],
  );

  const description = useMemo(() => {
    if (step === 'product-scan')
      return 'A câmera já está pronta para o UPC ou EAN.';
    if (step === 'product-confirm')
      return 'Confira o produto antes de avançar.';
    if (step === 'serials') return 'Bipe somente o SN de cada aparelho.';
    if (step === 'photos') return 'Fotografe o recebimento desta entrada.';
    if (step === 'review') return 'Revise tudo antes de confirmar.';
    return 'Entrada preparada com sucesso.';
  }, [step]);

  const reset = () => {
    setStep('product-scan');
    setCommercialCode(null);
    setProduct(null);
    setSerials([]);
    serialsRef.current = [];
    serialGenerationRef.current += 1;
    pendingSerialKeysRef.current.clear();
    setSerialChecksPending(0);
    setPhotos([]);
    setPreparingPhotos(false);
    setPhotoProgress('');
    setPhotoError('');
    setSaving(false);
    setSubmitError('');
    setSavedCount(0);
    setIgnoredCount(0);
    committedRef.current = false;
    operationIdRef.current = createOperationId();
    setAnnouncement('Nova entrada. Leia o UPC ou EAN do produto.');
  };

  const acceptProductCode = (candidate: ScanCandidate): ScanFeedback => {
    const matchingCode = [candidate.normalizedValue, candidate.alternateValue]
      .filter((value): value is string => Boolean(value))
      .find((value) => productsByCode[value]);
    const matchedProduct = matchingCode ? productsByCode[matchingCode] : null;
    const acceptedCandidate = matchingCode
      ? {
          ...candidate,
          normalizedValue: matchingCode,
          key: `PRODUCT:${matchingCode}`,
        }
      : candidate;
    serialsRef.current = [];
    serialGenerationRef.current += 1;
    pendingSerialKeysRef.current.clear();
    setSerialChecksPending(0);
    setSerials([]);
    setPhotos([]);
    setPhotoProgress('');
    setPhotoError('');
    setSavedCount(0);
    setIgnoredCount(0);
    committedRef.current = false;
    setCommercialCode(acceptedCandidate);
    setProduct(matchedProduct);
    setStep('product-confirm');
    setAnnouncement(
      matchedProduct
        ? `${matchedProduct.name} encontrado. Confirme o produto.`
        : 'Código não cadastrado. Cadastre o produto antes de continuar.',
    );
    return matchedProduct ? 'success' : 'error';
  };

  const addSerial = async (candidate: ScanCandidate): Promise<ScanFeedback> => {
    const generation = serialGenerationRef.current;
    const candidateValues = serialCandidateValues(candidate);
    const existingValue = candidateValues.find((value) =>
      existingSerialSet.has(value),
    );
    if (existingValue) {
      setAnnouncement(
        `SN ${existingValue} já existe no estoque e foi ignorado.`,
      );
      return 'error';
    }
    const repeatedValue = candidateValues.find((value) =>
      serialsRef.current.some((item) => item.normalized === value),
    );
    if (repeatedValue) {
      setAnnouncement(`SN ${repeatedValue} já foi bipado e foi ignorado.`);
      return 'error';
    }
    const pendingValue = candidateValues.find((value) =>
      pendingSerialKeysRef.current.has(value),
    );
    if (pendingValue) {
      setAnnouncement(`SN ${pendingValue} já está sendo verificado.`);
      return 'silent';
    }
    candidateValues.forEach((value) =>
      pendingSerialKeysRef.current.set(value, generation),
    );
    if (lookupSerials) {
      setSerialChecksPending((current) => current + 1);
    }
    try {
      if (lookupSerials) {
        const matches = await lookupSerials(candidateValues);
        if (generation !== serialGenerationRef.current) return 'silent';
        const registered = candidateValues
          .map((value) => matches.find((match) => match.serial === value))
          .find(Boolean);
        if (registered) {
          setAnnouncement(
            `SN ${registered.serial} já está cadastrado e foi ignorado.`,
          );
          return 'error';
        }
      }
      const repeatedAfterLookup = candidateValues.find((value) =>
        serialsRef.current.some((item) => item.normalized === value),
      );
      if (repeatedAfterLookup) {
        setAnnouncement(
          `SN ${repeatedAfterLookup} já foi bipado e foi ignorado.`,
        );
        return 'error';
      }
      const nextSerials = [
        ...serialsRef.current,
        { raw: candidate.rawValue, normalized: candidate.normalizedValue },
      ];
      serialsRef.current = nextSerials;
      setSerials(nextSerials);
      setAnnouncement(`SN ${candidate.normalizedValue} adicionado.`);
      return 'success';
    } catch {
      if (generation !== serialGenerationRef.current) return 'silent';
      if (lookupSerials) {
        setAnnouncement(
          'Não foi possível verificar este SN. Confira a conexão e bipe novamente.',
        );
      }
      return 'error';
    } finally {
      candidateValues.forEach((value) => {
        if (pendingSerialKeysRef.current.get(value) === generation) {
          pendingSerialKeysRef.current.delete(value);
        }
      });
      if (lookupSerials && generation === serialGenerationRef.current) {
        setSerialChecksPending((current) => Math.max(0, current - 1));
      }
    }
  };

  const acceptSerial = (candidate: ScanCandidate) => addSerial(candidate);

  if (!draft.ready)
    return (
      <output className="block p-5 text-sm">Recuperando o andamento…</output>
    );
  if (draft.blocked)
    return (
      <div className="m-4 rounded-xl border p-5" role="alert">
        <p>{draft.blocked}</p>
        <Button className="mt-3" onClick={() => window.location.reload()}>
          Reabrir com segurança
        </Button>
        {onOpenMenu && (
          <Button className="mt-3 ml-2" variant="outline" onClick={onOpenMenu}>
            Abrir menu da loja
          </Button>
        )}
      </div>
    );
  if (draft.waiting)
    return <PendingOperationNotice kind="entry" onOpenMenu={onOpenMenu} />;
  return (
    <FlowFrame
      announcement={announcement}
      currentStep={STEP_INDEX[step]}
      description={
        step !== 'done' && draft.label
          ? `${description} ${draft.label}.`
          : description
      }
      eyebrow="Entrada de estoque"
      steps={ENTRY_STEPS}
      title={step === 'done' ? 'Entrada concluída' : 'Nova entrada'}
    >
      {step === 'product-scan' && (
        <BarcodeScanner
          autoStart
          fill
          description="Centralize o UPC, EAN ou JAN. A leitura avança para a conferência do produto."
          mode="product"
          onAccepted={acceptProductCode}
          title="1. Bipar código do produto"
        />
      )}

      {step === 'product-confirm' && commercialCode && (
        <ProductConfirmation
          candidate={commercialCode}
          onConfirm={() => {
            setStep('serials');
            setAnnouncement('Etapa 2. Bipe somente o número de série.');
          }}
          onRescan={() => {
            setCommercialCode(null);
            setProduct(null);
            serialsRef.current = [];
            setSerials([]);
            setPhotos([]);
            setPhotoProgress('');
            setPhotoError('');
            setSavedCount(0);
            setIgnoredCount(0);
            committedRef.current = false;
            setStep('product-scan');
            setAnnouncement('Faça uma nova leitura do UPC ou EAN.');
          }}
          product={product}
        />
      )}

      {step === 'serials' && product && (
        <SerialStage
          announcement={announcement}
          checking={serialChecksPending > 0}
          onAccepted={acceptSerial}
          onBack={goBack}
          onNext={() => {
            serialGenerationRef.current += 1;
            pendingSerialKeysRef.current.clear();
            setSerialChecksPending(0);
            setStep('photos');
            setAnnouncement(
              'Etapa 3. Adicione ao menos uma foto do recebimento.',
            );
          }}
          onRemove={(serial) => {
            const nextSerials = serialsRef.current.filter(
              (item) => item.normalized !== serial,
            );
            serialsRef.current = nextSerials;
            setSerials(nextSerials);
            setAnnouncement(`SN ${serial} removido.`);
          }}
          product={product}
          serials={serials}
        />
      )}

      {step === 'photos' && product && (
        <PhotoStage
          onBack={goBack}
          onFiles={(files) => {
            if (preparingPhotos) return;
            setPreparingPhotos(true);
            setPhotoError('');
            setPhotoProgress('Preparando fotos…');
            void prepareMediaSelection({
              current: photos,
              incoming: files,
              maxFiles: MEDIA_LIMITS.entryPhotos,
              onProgress: ({ completed, total }) => {
                setPhotoProgress(
                  total > 0
                    ? `Preparando foto ${Math.min(completed + 1, total)} de ${total}…`
                    : 'Preparando fotos…',
                );
              },
            })
              .then((result) => {
                setPhotos(result.files);
                const optimized = result.optimizedCount
                  ? ` ${result.optimizedCount} ${result.optimizedCount === 1 ? 'foi otimizada' : 'foram otimizadas'}, economizando ${formatMediaBytes(result.bytesSaved)}.`
                  : '';
                const duplicates = result.duplicateCount
                  ? ` ${result.duplicateCount} ${result.duplicateCount === 1 ? 'repetida foi ignorada' : 'repetidas foram ignoradas'}.`
                  : '';
                setAnnouncement(
                  result.addedCount > 0
                    ? `${result.addedCount} ${result.addedCount === 1 ? 'foto pronta' : 'fotos prontas'}.${optimized}${duplicates}`
                    : `Nenhuma foto nova foi adicionada.${duplicates}`,
                );
              })
              .catch((error) => {
                const message =
                  error instanceof Error
                    ? error.message
                    : 'Não foi possível preparar as fotos.';
                setPhotoError(message);
                setAnnouncement(message);
              })
              .finally(() => {
                setPreparingPhotos(false);
                setPhotoProgress('');
              });
          }}
          onNext={() => {
            setStep('review');
            setAnnouncement('Etapa 4. Revise e confirme a entrada.');
          }}
          photoCount={photos.length}
          photoBytes={sumFileBytes(photos)}
          photoError={photoError}
          preparing={preparingPhotos}
          progressLabel={photoProgress}
          product={product}
          serialCount={serials.length}
        />
      )}

      {step === 'review' && product && (
        <EntryReview
          error={submitError}
          onBack={goBack}
          onConfirm={async () => {
            if (committedRef.current || !commercialCode) return;
            committedRef.current = true;
            setSaving(true);
            setSubmitError('');
            let result: EntryCommitResult;
            try {
              result = (await onConfirmEntry?.({
                operationId: operationIdRef.current,
                productId: product.id,
                gtin14: commercialCode.normalizedValue,
                displayCode: product.code,
                productName: product.name,
                productDetail: product.detail,
                serials: serials.map((serial) => serial.normalized),
                photos,
              })) ?? {
                added: serials.length,
                duplicates: 0,
                capacityReached: false,
              };
            } catch (error) {
              committedRef.current = false;
              if (error instanceof PendingOperationError)
                draft.setWaiting(true);
              setSaving(false);
              const message =
                error instanceof Error
                  ? error.message
                  : 'Não foi possível salvar a entrada. Tente novamente.';
              setSubmitError(message);
              setAnnouncement(message);
              return;
            }
            setSavedCount(result.added);
            setIgnoredCount(Math.max(serials.length - result.added, 0));
            setSaving(false);
            setStep('done');
            setAnnouncement(
              result.added > 0
                ? `Entrada salva com ${result.added} ${result.added === 1 ? 'aparelho' : 'aparelhos'}.`
                : 'Nenhuma unidade nova foi salva porque os SNs já estavam registrados.',
            );
          }}
          photoCount={photos.length}
          product={product}
          saving={saving}
          serials={serials}
        />
      )}

      {step === 'done' && (
        <CompletionStage
          count={savedCount}
          ignoredCount={ignoredCount}
          onReset={reset}
          productName={product?.name ?? 'Produto'}
        />
      )}
    </FlowFrame>
  );
}

function ProductConfirmation({
  candidate,
  product,
  onConfirm,
  onRescan,
}: {
  candidate: ScanCandidate;
  product: Product | null;
  onConfirm: () => void;
  onRescan: () => void;
}) {
  return (
    <Card className={ENTRY_STAGE_CARD_CLASS}>
      <CardContent className="flex min-h-0 flex-1 flex-col items-center justify-center overflow-hidden p-4 text-center sm:p-6">
        <span
          className={`grid size-16 place-items-center rounded-2xl ${product ? 'bg-success/10 text-success' : 'bg-amber-500/10 text-amber-700'}`}
        >
          {product ? (
            <PackageCheck className="size-8" />
          ) : (
            <RotateCcw className="size-8" />
          )}
        </span>
        <p className="eyebrow mt-5">Código lido</p>
        <p className="mt-1 font-mono text-sm font-bold sm:text-base">
          {candidate.rawValue}
        </p>

        {product ? (
          <div className="mt-5 w-full max-w-md rounded-2xl border bg-background p-4 text-left">
            <div className="flex items-center gap-3">
              <span className="grid size-12 shrink-0 place-items-center rounded-xl bg-secondary text-primary">
                <ProductColorSwatch
                  className="size-7"
                  color={product.color}
                  model={product.name}
                />
              </span>
              <div className="min-w-0">
                <p className="truncate font-bold">{product.name}</p>
                <p className="flex items-center gap-2 truncate text-sm text-muted-foreground">
                  <ProductColorSwatch
                    color={product.color}
                    model={product.name}
                  />
                  <span className="truncate">{product.color}</span>
                  <Badge variant="secondary">{product.memory}</Badge>
                </p>
              </div>
            </div>
          </div>
        ) : (
          <div className="mt-5 max-w-md rounded-2xl bg-amber-500/10 p-4 text-sm text-amber-900">
            Este código ainda não está vinculado a um produto. Cadastre o
            modelo, cor, memória e UPC/EAN em Configurações.
          </div>
        )}
      </CardContent>

      <div className="grid shrink-0 grid-cols-2 gap-2 border-t p-2.5 sm:p-3">
        <Button
          className="h-12 rounded-xl"
          onClick={onRescan}
          variant="outline"
        >
          <ArrowLeft />
          <span className="sm:hidden">Reler</span>
          <span className="hidden sm:inline">Ler novamente</span>
        </Button>
        <Button
          className="h-12 rounded-xl"
          disabled={!product}
          onClick={onConfirm}
        >
          <span className="sm:hidden">
            {product ? 'Confirmar' : 'Não cadastrado'}
          </span>
          <span className="hidden sm:inline">
            {product ? 'Confirmar produto' : 'Produto não cadastrado'}
          </span>{' '}
          <ArrowRight className="hidden sm:block" />
        </Button>
      </div>
    </Card>
  );
}

function SerialStage({
  announcement,
  checking,
  product,
  serials,
  onAccepted,
  onBack,
  onNext,
  onRemove,
}: {
  announcement: string;
  checking: boolean;
  product: Product;
  serials: SerialItem[];
  onAccepted: (candidate: ScanCandidate) => Promise<ScanFeedback>;
  onBack: () => void;
  onNext: () => void;
  onRemove: (serial: string) => void;
}) {
  const latest = serials.at(-1);
  const duplicateWarning =
    /(?:já (?:existe|está cadastrado|foi bipado)|não foi possível)/i.test(
      announcement,
    )
      ? announcement
      : '';

  return (
    <div className="grid h-full min-h-0 grid-rows-[minmax(0,1fr)_auto] gap-3 lg:grid-cols-[minmax(0,1fr)_18rem] lg:grid-rows-1">
      <BarcodeScanner
        autoStart
        fill
        description="A faixa é estreita de propósito. IMEI, EID e outros códigos visíveis não geram erro."
        mode="apple_serial"
        onAccepted={onAccepted}
        title="2. Bipar somente o SN"
      />

      <Card className="flow-stage-card flex min-h-0 flex-col gap-0 overflow-hidden py-0">
        <CardHeader className="hidden shrink-0 border-b p-4 lg:flex">
          <div>
            <p className="eyebrow flex items-center gap-2">
              <ProductColorSwatch color={product.color} model={product.name} />{' '}
              {product.name}
            </p>
            <CardTitle className="mt-1 text-base">SNs registrados</CardTitle>
          </div>
          <Badge variant="secondary">{serials.length}</Badge>
        </CardHeader>

        <CardContent className="hidden min-h-0 flex-1 flex-col gap-2 overflow-hidden p-3 lg:flex">
          {serials.length === 0 ? (
            <div className="grid min-h-32 flex-1 place-items-center rounded-2xl border border-dashed bg-muted/30 p-4 text-center text-sm text-muted-foreground">
              O primeiro SN aparecerá aqui depois do bip.
            </div>
          ) : (
            serials
              .slice(-4)
              .reverse()
              .map((serial, index) => (
                <div
                  className="flex min-h-12 items-center gap-2 rounded-xl border bg-background px-3"
                  key={serial.normalized}
                >
                  <span className="grid size-7 shrink-0 place-items-center rounded-lg bg-success/10 text-xs font-bold text-success">
                    {serials.length - index}
                  </span>
                  <span className="min-w-0 flex-1 truncate font-mono text-sm font-semibold">
                    {serial.normalized}
                  </span>
                  <Button
                    aria-label={`Remover ${serial.normalized}`}
                    className="size-11 text-muted-foreground hover:text-destructive"
                    onClick={() => onRemove(serial.normalized)}
                    size="icon"
                    variant="ghost"
                  >
                    <Trash2 />
                  </Button>
                </div>
              ))
          )}
        </CardContent>

        <div className="shrink-0 border-t p-2.5 sm:p-3">
          {duplicateWarning && (
            <p
              className="mb-2 rounded-xl border border-amber-500/35 bg-amber-50 px-3 py-2 text-xs font-semibold text-amber-950 dark:bg-amber-500/10 dark:text-amber-100"
              role="alert"
            >
              {duplicateWarning}
            </p>
          )}
          <div className="mb-2 flex min-w-0 items-center justify-between gap-3 lg:hidden">
            <div className="min-w-0">
              <p className="text-sm font-bold">
                {serials.length}{' '}
                {serials.length === 1 ? 'SN registrado' : 'SNs registrados'}
              </p>
              <p className="truncate text-xs text-muted-foreground">
                {duplicateWarning
                  ? duplicateWarning
                  : latest
                    ? `Último: ${latest.normalized}`
                    : announcement}
              </p>
            </div>
            {latest && (
              <Button
                aria-label={`Remover ${latest.normalized}`}
                className="size-11 shrink-0"
                onClick={() => onRemove(latest.normalized)}
                size="icon"
                variant="ghost"
              >
                <Trash2 />
              </Button>
            )}
          </div>
          <div className="grid grid-cols-[auto_1fr] gap-2">
            <Button
              aria-label="Voltar"
              className="h-11 rounded-xl"
              disabled={checking}
              onClick={onBack}
              variant="outline"
            >
              <ArrowLeft />
            </Button>
            <Button
              className="h-11 rounded-xl"
              disabled={serials.length === 0 || checking}
              onClick={onNext}
            >
              {checking ? (
                <>
                  <LoaderCircle className="animate-spin" /> Verificando SN…
                </>
              ) : (
                <>
                  Finalizar bipagem <ArrowRight />
                </>
              )}
            </Button>
          </div>
        </div>
      </Card>
    </div>
  );
}

function PhotoStage({
  product,
  serialCount,
  photoCount,
  photoBytes,
  photoError,
  preparing,
  progressLabel,
  onFiles,
  onBack,
  onNext,
}: {
  product: Product;
  serialCount: number;
  photoCount: number;
  photoBytes: number;
  photoError: string;
  preparing: boolean;
  progressLabel: string;
  onFiles: (files: File[]) => void;
  onBack: () => void;
  onNext: () => void;
}) {
  return (
    <Card className={ENTRY_STAGE_CARD_CLASS}>
      <CardContent className="flex min-h-0 flex-1 flex-col items-center justify-center overflow-hidden p-3 text-center sm:p-6">
        <div className="mb-4 flex flex-wrap justify-center gap-2">
          <Badge className="gap-1.5" variant="secondary">
            <ProductColorSwatch color={product.color} model={product.name} />{' '}
            {product.name}
          </Badge>
          <Badge variant="outline">{product.memory}</Badge>
          <Badge variant="outline">
            {serialCount} {serialCount === 1 ? 'aparelho' : 'aparelhos'}
          </Badge>
        </div>
        <label className="flow-upload-panel flex w-full max-w-xl cursor-pointer flex-col items-center rounded-2xl border-2 border-dashed bg-muted/30 p-4 transition hover:bg-muted/55 sm:rounded-3xl sm:p-6">
          <span className="flow-stage-icon grid size-12 place-items-center rounded-2xl bg-card text-primary shadow-sm">
            {preparing ? (
              <LoaderCircle className="size-6 animate-spin" />
            ) : (
              <Camera className="size-6" />
            )}
          </span>
          <span className="mt-2 text-base font-bold sm:mt-3">
            {preparing
              ? progressLabel || 'Preparando fotos…'
              : 'Fotografar recebimento'}
          </span>
          <span className="flow-stage-support mt-1 text-sm text-muted-foreground">
            {preparing
              ? 'Reduzindo o tamanho sem comprometer a leitura.'
              : 'Selecione uma ou mais fotos da entrada.'}
          </span>
          {photoCount > 0 && (
            <span className="mt-2 inline-flex items-center gap-2 rounded-full bg-success/10 px-4 py-2 text-sm font-semibold text-success sm:mt-3">
              <Check className="size-4" /> {photoCount}{' '}
              {photoCount === 1 ? 'foto pronta' : 'fotos prontas'} ·{' '}
              {formatMediaBytes(photoBytes)}
            </span>
          )}
          <input
            accept="image/*"
            capture="environment"
            className="sr-only"
            disabled={preparing}
            multiple
            onChange={(event) => {
              const files = Array.from(event.target.files ?? []);
              if (files.length > 0) onFiles(files);
              event.currentTarget.value = '';
            }}
            type="file"
          />
        </label>
        {photoError && (
          <p
            className="mt-2 w-full max-w-xl rounded-xl border border-destructive/25 bg-destructive/10 px-3 py-2 text-sm font-semibold text-destructive"
            role="alert"
          >
            {photoError}
          </p>
        )}
      </CardContent>
      <div className="grid shrink-0 grid-cols-2 gap-2 border-t p-2.5 sm:p-3">
        <Button
          className="h-12 rounded-xl"
          disabled={preparing}
          onClick={onBack}
          variant="outline"
        >
          <ArrowLeft /> Voltar
        </Button>
        <Button
          className="h-12 rounded-xl"
          disabled={photoCount === 0 || preparing}
          onClick={onNext}
        >
          Revisar entrada <ArrowRight />
        </Button>
      </div>
    </Card>
  );
}

function EntryReview({
  product,
  serials,
  photoCount,
  saving,
  error,
  onBack,
  onConfirm,
}: {
  product: Product;
  serials: SerialItem[];
  photoCount: number;
  saving: boolean;
  error: string;
  onBack: () => void;
  onConfirm: () => void;
}) {
  const pageSize = 4;
  const [page, setPage] = useState(0);
  const pageCount = Math.max(1, Math.ceil(serials.length / pageSize));
  const safePage = Math.min(page, pageCount - 1);
  const visibleSerials = serials.slice(
    safePage * pageSize,
    safePage * pageSize + pageSize,
  );

  return (
    <Card className={ENTRY_STAGE_CARD_CLASS}>
      <CardContent className="min-h-0 flex-1 overflow-hidden p-3 sm:p-5">
        <div className="grid grid-cols-1 gap-2 sm:gap-3 lg:grid-cols-2">
          <section className="rounded-xl border bg-background p-3 sm:rounded-2xl sm:p-4">
            <p className="eyebrow">Produto</p>
            <div className="mt-3 flex items-center gap-3">
              <span className="hidden size-12 shrink-0 place-items-center rounded-xl bg-secondary text-primary sm:grid">
                <ProductColorSwatch
                  className="size-7"
                  color={product.color}
                  model={product.name}
                />
              </span>
              <div className="min-w-0">
                <p className="truncate font-bold">{product.name}</p>
                <p className="flex items-center gap-2 truncate text-sm text-muted-foreground">
                  <ProductColorSwatch
                    color={product.color}
                    model={product.name}
                  />
                  <span className="truncate">{product.color}</span>
                  <Badge variant="secondary">{product.memory}</Badge>
                </p>
                <p className="mt-1 font-mono text-xs text-muted-foreground">
                  UPC/EAN {product.code}
                </p>
              </div>
            </div>
          </section>
          <section className="rounded-xl border bg-background p-3 sm:rounded-2xl sm:p-4">
            <p className="eyebrow">Resumo</p>
            <dl className="mt-3 space-y-2 text-sm">
              <div className="flex justify-between gap-4">
                <dt className="text-muted-foreground">Aparelhos</dt>
                <dd className="font-bold">{serials.length}</dd>
              </div>
              <div className="flex justify-between gap-4">
                <dt className="text-muted-foreground">Fotos</dt>
                <dd className="font-bold">{photoCount}</dd>
              </div>
              <div className="flex justify-between gap-4">
                <dt className="text-muted-foreground">Situação</dt>
                <dd className="font-bold text-success">Pronta</dd>
              </div>
            </dl>
          </section>
        </div>

        <section className="mt-2 rounded-xl border bg-background p-3 sm:mt-3 sm:rounded-2xl sm:p-4">
          <div className="flex items-center justify-between gap-3">
            <p className="font-bold">Números de série</p>
            <Badge variant="secondary">{serials.length}</Badge>
          </div>
          <div className="mt-2 grid grid-cols-2 gap-2 lg:grid-cols-4">
            {visibleSerials.map((serial, index) => (
              <div
                className="flex items-center gap-2 rounded-xl bg-muted/55 px-3 py-2.5"
                key={serial.normalized}
              >
                <span className="text-xs font-bold text-muted-foreground">
                  {safePage * pageSize + index + 1}
                </span>
                <span className="truncate font-mono text-sm font-semibold">
                  {serial.normalized}
                </span>
              </div>
            ))}
          </div>
          {pageCount > 1 && (
            <div
              aria-live="polite"
              className="mt-2 flex items-center justify-center gap-3"
            >
              <Button
                aria-label="SNs anteriores"
                className="size-9"
                disabled={safePage === 0}
                onClick={() => setPage((current) => Math.max(0, current - 1))}
                size="icon"
                variant="ghost"
              >
                <ChevronLeft />
              </Button>
              <span className="text-xs font-semibold text-muted-foreground">
                {safePage + 1} de {pageCount}
              </span>
              <Button
                aria-label="Próximos SNs"
                className="size-9"
                disabled={safePage >= pageCount - 1}
                onClick={() =>
                  setPage((current) => Math.min(pageCount - 1, current + 1))
                }
                size="icon"
                variant="ghost"
              >
                <ChevronRight />
              </Button>
            </div>
          )}
        </section>
      </CardContent>

      <div className="grid shrink-0 grid-cols-2 gap-2 border-t p-2.5 sm:p-3">
        {error && (
          <p
            className="col-span-2 rounded-xl bg-destructive/10 px-3 py-2 text-sm font-semibold text-destructive"
            role="alert"
          >
            {error}
          </p>
        )}
        <Button
          className="h-12 rounded-xl"
          disabled={saving}
          onClick={onBack}
          variant="outline"
        >
          <ArrowLeft /> Voltar
        </Button>
        <Button
          className="h-12 rounded-xl"
          disabled={saving}
          onClick={onConfirm}
        >
          {saving ? (
            <>
              <LoaderCircle className="animate-spin" />
              <span className="sm:hidden">Salvando…</span>
              <span className="hidden sm:inline">
                Enviando fotos e salvando…
              </span>
            </>
          ) : (
            <>
              <Check /> Confirmar entrada
            </>
          )}
        </Button>
      </div>
    </Card>
  );
}

function CompletionStage({
  count,
  ignoredCount,
  productName,
  onReset,
}: {
  count: number;
  ignoredCount: number;
  productName: string;
  onReset: () => void;
}) {
  return (
    <Card className={ENTRY_STAGE_CARD_CLASS}>
      <CardContent className="grid min-h-0 flex-1 place-items-center overflow-hidden p-4 text-center sm:p-7">
        <div className="max-w-lg">
          <span className="mx-auto grid size-20 place-items-center rounded-full bg-success/10 text-success">
            <CheckCircle2 className="size-10" />
          </span>
          <h2 className="mt-5 text-2xl font-bold tracking-tight">
            {count > 0 ? 'Entrada salva' : 'Nenhuma unidade nova'}
          </h2>
          <p className="mt-2 text-sm leading-6 text-muted-foreground">
            {count > 0
              ? `${count} ${count === 1 ? 'unidade de' : 'unidades de'} ${productName} foram adicionadas ao estoque.`
              : 'Os números de série informados já estavam registrados.'}
          </p>
          {ignoredCount > 0 && (
            <p className="mt-2 text-xs font-semibold text-amber-800">
              {ignoredCount}{' '}
              {ignoredCount === 1 ? 'SN foi ignorado' : 'SNs foram ignorados'}.
            </p>
          )}
          <p className="mt-3 rounded-xl bg-success/10 px-4 py-3 text-sm text-success">
            Entrada registrada na nuvem e disponível para os usuários desta
            loja.
          </p>
          <Button className="mt-5 h-12 rounded-xl px-6" onClick={onReset}>
            <RotateCcw /> Fazer nova entrada
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

function serialCandidateValues(candidate: ScanCandidate) {
  return Array.from(
    new Set(
      [candidate.normalizedValue, candidate.alternateValue].filter(
        (value): value is string => Boolean(value),
      ),
    ),
  );
}
