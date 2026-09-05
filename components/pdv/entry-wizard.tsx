'use client';

import { useMemo, useRef, useState } from 'react';
import {
  ArrowLeft,
  ArrowRight,
  Camera,
  Check,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  PackageCheck,
  RotateCcw,
  Smartphone,
  Trash2,
} from 'lucide-react';

import { BarcodeScanner } from '@/components/pdv/barcode-scanner';
import { FlowFrame } from '@/components/pdv/flow-frame';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
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
  code: string;
};

type Product = EntryProduct;

type SerialItem = {
  raw: string;
  normalized: string;
};

export type EntrySubmission = {
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
  'flex h-full min-h-0 flex-col gap-0 overflow-hidden py-0';

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
}: EntryWizardProps) {
  const [step, setStep] = useState<EntryStep>('product-scan');
  const [commercialCode, setCommercialCode] = useState<ScanCandidate | null>(
    null,
  );
  const [product, setProduct] = useState<Product | null>(null);
  const [serials, setSerials] = useState<SerialItem[]>([]);
  const [photos, setPhotos] = useState<File[]>([]);
  const [savedCount, setSavedCount] = useState(0);
  const [ignoredCount, setIgnoredCount] = useState(0);
  const [serialPrefixChoice, setSerialPrefixChoice] =
    useState<ScanCandidate | null>(null);
  const [announcement, setAnnouncement] = useState(
    'Etapa 1. Leia o UPC ou EAN do produto.',
  );
  const committedRef = useRef(false);
  const serialsRef = useRef<SerialItem[]>([]);
  const existingSerialSet = useMemo(
    () => new Set(existingTestSerials),
    [existingTestSerials],
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
    setPhotos([]);
    setSavedCount(0);
    setIgnoredCount(0);
    setSerialPrefixChoice(null);
    committedRef.current = false;
    setAnnouncement('Nova entrada. Leia o UPC ou EAN do produto.');
  };

  const acceptProductCode = (candidate: ScanCandidate) => {
    const matchedProduct = productsByCode[candidate.normalizedValue] ?? null;
    serialsRef.current = [];
    setSerials([]);
    setPhotos([]);
    setSavedCount(0);
    setIgnoredCount(0);
    committedRef.current = false;
    setCommercialCode(candidate);
    setProduct(matchedProduct);
    setStep('product-confirm');
    setAnnouncement(
      matchedProduct
        ? `${matchedProduct.name} encontrado. Confirme o produto.`
        : 'Código não cadastrado. Cadastre o produto antes de continuar.',
    );
  };

  const addSerial = async (candidate: ScanCandidate) => {
    const candidateValues = serialCandidateValues(candidate);
    const existingValue = candidateValues.find((value) =>
      existingSerialSet.has(value),
    );
    if (existingValue) {
      setAnnouncement(
        `SN ${existingValue} já existe no estoque e foi ignorado.`,
      );
      return;
    }
    if (lookupSerials) {
      try {
        const matches = await lookupSerials(candidateValues);
        const registered = candidateValues
          .map((value) => matches.find((match) => match.serial === value))
          .find(Boolean);
        if (registered) {
          setAnnouncement(
            `SN ${registered.serial} já está cadastrado e foi ignorado.`,
          );
          return;
        }
      } catch {
        setAnnouncement(
          'Não foi possível verificar este SN. Confira a conexão e bipe novamente.',
        );
        return;
      }
    }
    const repeatedAfterLookup = candidateValues.find((value) =>
      serialsRef.current.some((item) => item.normalized === value),
    );
    if (repeatedAfterLookup) {
      setAnnouncement(
        `SN ${repeatedAfterLookup} já foi bipado e foi ignorado.`,
      );
      return;
    }
    const repeatedValue = candidateValues.find((value) =>
      serialsRef.current.some((item) => item.normalized === value),
    );
    if (repeatedValue) {
      setAnnouncement(`SN ${repeatedValue} já foi bipado e foi ignorado.`);
      return;
    }

    const nextSerials = [
      ...serialsRef.current,
      { raw: candidate.rawValue, normalized: candidate.normalizedValue },
    ];
    serialsRef.current = nextSerials;
    setSerials(nextSerials);
    setAnnouncement(`SN ${candidate.normalizedValue} adicionado.`);
  };

  const acceptSerial = (candidate: ScanCandidate) => {
    if (candidate.prefixStripped && candidate.alternateValue) {
      setSerialPrefixChoice(candidate);
      setAnnouncement('Confirme se o S faz parte do número de série.');
      return;
    }
    void addSerial(candidate);
  };

  return (
    <FlowFrame
      announcement={announcement}
      currentStep={STEP_INDEX[step]}
      description={description}
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
          onAccepted={acceptSerial}
          onBack={() => setStep('product-confirm')}
          onNext={() => {
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
          onBack={() => setStep('serials')}
          onFiles={(files) => {
            setPhotos((current) =>
              mergeUniqueFiles(current, files).slice(0, 8),
            );
            setAnnouncement(
              `${files.length} ${files.length === 1 ? 'foto adicionada' : 'fotos adicionadas'}.`,
            );
          }}
          onNext={() => {
            setStep('review');
            setAnnouncement('Etapa 4. Revise e confirme a entrada.');
          }}
          photoCount={photos.length}
          product={product}
          serialCount={serials.length}
        />
      )}

      {step === 'review' && product && (
        <EntryReview
          onBack={() => setStep('photos')}
          onConfirm={async () => {
            if (committedRef.current || !commercialCode) return;
            committedRef.current = true;
            let result: EntryCommitResult;
            try {
              result = (await onConfirmEntry?.({
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
              setAnnouncement(
                error instanceof Error
                  ? error.message
                  : 'Não foi possível salvar a entrada. Tente novamente.',
              );
              return;
            }
            setSavedCount(result.added);
            setIgnoredCount(Math.max(serials.length - result.added, 0));
            setStep('done');
            setAnnouncement(
              result.added > 0
                ? `Entrada salva com ${result.added} ${result.added === 1 ? 'aparelho' : 'aparelhos'}.`
                : 'Nenhuma unidade nova foi salva porque os SNs já estavam registrados.',
            );
          }}
          photoCount={photos.length}
          product={product}
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

      <Dialog
        onOpenChange={(open) => {
          if (!open) setSerialPrefixChoice(null);
        }}
        open={Boolean(serialPrefixChoice)}
      >
        <DialogContent className="max-w-md">
          {serialPrefixChoice && (
            <>
              <DialogHeader>
                <DialogTitle>O S faz parte do SN?</DialogTitle>
                <DialogDescription>
                  Algumas etiquetas usam S apenas como prefixo. Confira o número
                  impresso ao lado do código antes de salvar.
                </DialogDescription>
              </DialogHeader>
              <div className="grid gap-2 rounded-xl bg-muted p-3 font-mono text-sm">
                <span>Sem prefixo: {serialPrefixChoice.normalizedValue}</span>
                <span>Com S: {serialPrefixChoice.alternateValue}</span>
              </div>
              <DialogFooter className="grid grid-cols-2 gap-2 sm:grid-cols-2">
                <Button
                  onClick={() => {
                    void addSerial(serialPrefixChoice);
                    setSerialPrefixChoice(null);
                  }}
                >
                  Remover o S
                </Button>
                <Button
                  onClick={() => {
                    const value = serialPrefixChoice.alternateValue!;
                    void addSerial({
                      ...serialPrefixChoice,
                      normalizedValue: value,
                      key: `SERIAL:${value}`,
                      alternateValue: serialPrefixChoice.normalizedValue,
                      prefixStripped: undefined,
                    });
                    setSerialPrefixChoice(null);
                  }}
                  variant="outline"
                >
                  Manter o S
                </Button>
              </DialogFooter>
            </>
          )}
        </DialogContent>
      </Dialog>
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
                <Smartphone className="size-6" />
              </span>
              <div className="min-w-0">
                <p className="truncate font-bold">{product.name}</p>
                <p className="truncate text-sm text-muted-foreground">
                  {product.detail}
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
  product,
  serials,
  onAccepted,
  onBack,
  onNext,
  onRemove,
}: {
  announcement: string;
  product: Product;
  serials: SerialItem[];
  onAccepted: (candidate: ScanCandidate) => void;
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
    <div className="grid h-full min-h-0 grid-rows-[minmax(0,1fr)_auto] gap-3 md:grid-cols-[minmax(0,1fr)_18rem] md:grid-rows-1">
      <BarcodeScanner
        autoStart
        fill
        description="A faixa é estreita de propósito. IMEI, EID e outros códigos visíveis não geram erro."
        mode="apple_serial"
        onAccepted={onAccepted}
        title="2. Bipar somente o SN"
      />

      <Card className="flex min-h-0 flex-col gap-0 overflow-hidden py-0">
        <CardHeader className="hidden shrink-0 border-b p-4 md:flex">
          <div>
            <p className="eyebrow">{product.name}</p>
            <CardTitle className="mt-1 text-base">SNs registrados</CardTitle>
          </div>
          <Badge variant="secondary">{serials.length}</Badge>
        </CardHeader>

        <CardContent className="hidden min-h-0 flex-1 flex-col gap-2 overflow-hidden p-3 md:flex">
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
          <div className="mb-2 flex min-w-0 items-center justify-between gap-3 md:hidden">
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
              onClick={onBack}
              variant="outline"
            >
              <ArrowLeft />
            </Button>
            <Button
              className="h-11 rounded-xl"
              disabled={serials.length === 0}
              onClick={onNext}
            >
              Finalizar bipagem <ArrowRight />
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
  onFiles,
  onBack,
  onNext,
}: {
  product: Product;
  serialCount: number;
  photoCount: number;
  onFiles: (files: File[]) => void;
  onBack: () => void;
  onNext: () => void;
}) {
  return (
    <Card className={ENTRY_STAGE_CARD_CLASS}>
      <CardContent className="flex min-h-0 flex-1 flex-col items-center justify-center overflow-hidden p-3 text-center sm:p-6">
        <div className="mb-4 flex flex-wrap justify-center gap-2">
          <Badge variant="secondary">{product.name}</Badge>
          <Badge variant="outline">
            {serialCount} {serialCount === 1 ? 'aparelho' : 'aparelhos'}
          </Badge>
        </div>
        <label className="flow-upload-panel flex w-full max-w-xl cursor-pointer flex-col items-center rounded-2xl border-2 border-dashed bg-muted/30 p-4 transition hover:bg-muted/55 sm:rounded-3xl sm:p-6">
          <span className="flow-stage-icon grid size-12 place-items-center rounded-2xl bg-card text-primary shadow-sm">
            <Camera className="size-6" />
          </span>
          <span className="mt-2 text-base font-bold sm:mt-3">
            Fotografar recebimento
          </span>
          <span className="flow-stage-support mt-1 text-sm text-muted-foreground">
            Selecione uma ou mais fotos da entrada.
          </span>
          {photoCount > 0 && (
            <span className="mt-2 inline-flex items-center gap-2 rounded-full bg-success/10 px-4 py-2 text-sm font-semibold text-success sm:mt-3">
              <Check className="size-4" /> {photoCount}{' '}
              {photoCount === 1 ? 'foto pronta' : 'fotos prontas'}
            </span>
          )}
          <input
            accept="image/*"
            capture="environment"
            className="sr-only"
            multiple
            onChange={(event) => {
              const files = Array.from(event.target.files ?? []);
              if (files.length > 0) onFiles(files);
            }}
            type="file"
          />
        </label>
      </CardContent>
      <div className="grid shrink-0 grid-cols-2 gap-2 border-t p-2.5 sm:p-3">
        <Button className="h-12 rounded-xl" onClick={onBack} variant="outline">
          <ArrowLeft /> Voltar
        </Button>
        <Button
          className="h-12 rounded-xl"
          disabled={photoCount === 0}
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
  onBack,
  onConfirm,
}: {
  product: Product;
  serials: SerialItem[];
  photoCount: number;
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
        <div className="grid grid-cols-2 gap-2 sm:gap-3">
          <section className="rounded-xl border bg-background p-3 sm:rounded-2xl sm:p-4">
            <p className="eyebrow">Produto</p>
            <div className="mt-3 flex items-center gap-3">
              <span className="hidden size-12 shrink-0 place-items-center rounded-xl bg-secondary text-primary sm:grid">
                <Smartphone className="size-6" />
              </span>
              <div className="min-w-0">
                <p className="truncate font-bold">{product.name}</p>
                <p className="truncate text-sm text-muted-foreground">
                  {product.detail}
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
        <Button className="h-12 rounded-xl" onClick={onBack} variant="outline">
          <ArrowLeft /> Voltar
        </Button>
        <Button className="h-12 rounded-xl" onClick={onConfirm}>
          <Check /> Confirmar entrada
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

function mergeUniqueFiles(current: File[], incoming: File[]) {
  const byIdentity = new Map(
    current.map((file) => [
      `${file.name}:${file.size}:${file.lastModified}`,
      file,
    ]),
  );
  for (const file of incoming) {
    byIdentity.set(`${file.name}:${file.size}:${file.lastModified}`, file);
  }
  return [...byIdentity.values()];
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
