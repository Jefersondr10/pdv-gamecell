'use client';

import { useMemo, useState } from 'react';
import {
  ArrowLeft,
  ArrowRight,
  Camera,
  Check,
  CheckCircle2,
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
import type { ScanCandidate } from '@/lib/scanner';

type EntryStep =
  | 'product-scan'
  | 'product-confirm'
  | 'serials'
  | 'photos'
  | 'review'
  | 'done';

type Product = {
  name: string;
  detail: string;
  code: string;
};

type SerialItem = {
  raw: string;
  normalized: string;
};

const ENTRY_STEPS = ['Produto', 'Seriais', 'Fotos', 'Revisão'] as const;

const PRODUCTS_BY_CODE: Record<string, Product> = {
  '00195950638011': {
    name: 'iPhone 17 Pro Max',
    detail: 'Deep Blue · 256 GB',
    code: '195950638011',
  },
  '00195950637151': {
    name: 'iPhone 17 Pro Max',
    detail: 'Silver · 256 GB',
    code: '195950637151',
  },
  '00195949822193': {
    name: 'iPhone 16',
    detail: 'Pink · 128 GB',
    code: '195949822193',
  },
  '00195949035913': {
    name: 'iPhone 15',
    detail: 'Black · 128 GB',
    code: '195949035913',
  },
  '04549995649161': {
    name: 'iPhone 17',
    detail: 'White · 256 GB',
    code: '4549995649161',
  },
};

const STEP_INDEX: Record<EntryStep, number> = {
  'product-scan': 0,
  'product-confirm': 0,
  serials: 1,
  photos: 2,
  review: 3,
  done: 3,
};

export function EntryWizard() {
  const [step, setStep] = useState<EntryStep>('product-scan');
  const [commercialCode, setCommercialCode] = useState<ScanCandidate | null>(null);
  const [product, setProduct] = useState<Product | null>(null);
  const [serials, setSerials] = useState<SerialItem[]>([]);
  const [photoCount, setPhotoCount] = useState(0);
  const [announcement, setAnnouncement] = useState(
    'Etapa 1. Leia o UPC ou EAN do produto.',
  );

  const description = useMemo(() => {
    if (step === 'product-scan') return 'A câmera já está pronta para o UPC ou EAN.';
    if (step === 'product-confirm') return 'Confira o produto antes de avançar.';
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
    setPhotoCount(0);
    setAnnouncement('Nova entrada. Leia o UPC ou EAN do produto.');
  };

  const acceptProductCode = (candidate: ScanCandidate) => {
    const matchedProduct = PRODUCTS_BY_CODE[candidate.normalizedValue] ?? null;
    setCommercialCode(candidate);
    setProduct(matchedProduct);
    setStep('product-confirm');
    setAnnouncement(
      matchedProduct
        ? `${matchedProduct.name} encontrado. Confirme o produto.`
        : 'Código ainda não cadastrado. Faça uma nova leitura.',
    );
  };

  const acceptSerial = (candidate: ScanCandidate) => {
    if (serials.some((item) => item.normalized === candidate.normalizedValue)) {
      setAnnouncement(`SN ${candidate.normalizedValue} já foi bipado e foi ignorado.`);
      return;
    }

    setSerials((current) => [
      ...current,
      { raw: candidate.rawValue, normalized: candidate.normalizedValue },
    ]);
    setAnnouncement(`SN ${candidate.normalizedValue} adicionado.`);
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
            setAnnouncement('Etapa 3. Adicione ao menos uma foto do recebimento.');
          }}
          onRemove={(serial) => {
            setSerials((current) =>
              current.filter((item) => item.normalized !== serial),
            );
            setAnnouncement(`SN ${serial} removido.`);
          }}
          product={product}
          serials={serials}
        />
      )}

      {step === 'photos' && product && (
        <PhotoStage
          onBack={() => setStep('serials')}
          onFiles={(count) => {
            setPhotoCount(count);
            setAnnouncement(`${count} ${count === 1 ? 'foto adicionada' : 'fotos adicionadas'}.`);
          }}
          onNext={() => {
            setStep('review');
            setAnnouncement('Etapa 4. Revise e confirme a entrada.');
          }}
          photoCount={photoCount}
          product={product}
          serialCount={serials.length}
        />
      )}

      {step === 'review' && product && (
        <EntryReview
          onBack={() => setStep('photos')}
          onConfirm={() => {
            setStep('done');
            setAnnouncement(
              `Entrada concluída com ${serials.length} ${serials.length === 1 ? 'aparelho' : 'aparelhos'}.`,
            );
          }}
          photoCount={photoCount}
          product={product}
          serials={serials}
        />
      )}

      {step === 'done' && (
        <CompletionStage
          count={serials.length}
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
    <Card className="flex h-full min-h-0 flex-col overflow-hidden">
      <CardContent className="flex min-h-0 flex-1 flex-col items-center justify-center p-5 text-center sm:p-8">
        <span
          className={`grid size-16 place-items-center rounded-2xl ${product ? 'bg-success/10 text-success' : 'bg-amber-500/10 text-amber-700'}`}
        >
          {product ? <PackageCheck className="size-8" /> : <RotateCcw className="size-8" />}
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
                <p className="truncate text-sm text-muted-foreground">{product.detail}</p>
              </div>
            </div>
          </div>
        ) : (
          <div className="mt-5 max-w-md rounded-2xl bg-amber-500/10 p-4 text-sm text-amber-900">
            Este código ainda não está vinculado a um produto. Faça outra leitura ou cadastre-o em Configurações.
          </div>
        )}
      </CardContent>

      <div className="grid shrink-0 grid-cols-2 gap-2 border-t p-3 sm:p-4">
        <Button className="h-12 rounded-xl" onClick={onRescan} variant="outline">
          <ArrowLeft /> Ler novamente
        </Button>
        <Button className="h-12 rounded-xl" disabled={!product} onClick={onConfirm}>
          Confirmar produto <ArrowRight />
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

      <Card className="flex min-h-0 flex-col overflow-hidden">
        <CardHeader className="hidden shrink-0 border-b p-4 md:flex">
          <div>
            <p className="eyebrow">{product.name}</p>
            <CardTitle className="mt-1 text-base">SNs registrados</CardTitle>
          </div>
          <Badge variant="secondary">{serials.length}</Badge>
        </CardHeader>

        <CardContent className="hidden min-h-0 flex-1 flex-col gap-2 overflow-y-auto p-3 overscroll-contain md:flex">
          {serials.length === 0 ? (
            <div className="grid min-h-32 flex-1 place-items-center rounded-2xl border border-dashed bg-muted/30 p-4 text-center text-sm text-muted-foreground">
              O primeiro SN aparecerá aqui depois do bip.
            </div>
          ) : (
            serials
              .slice()
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

        <div className="shrink-0 border-t p-3">
          <div className="mb-2 flex min-w-0 items-center justify-between gap-3 md:hidden">
            <div className="min-w-0">
              <p className="text-sm font-bold">
                {serials.length} {serials.length === 1 ? 'SN registrado' : 'SNs registrados'}
              </p>
              <p className="truncate text-xs text-muted-foreground">
                {latest ? `Último: ${latest.normalized}` : announcement}
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
            <Button aria-label="Voltar" className="h-11 rounded-xl" onClick={onBack} variant="outline">
              <ArrowLeft />
            </Button>
            <Button className="h-11 rounded-xl" disabled={serials.length === 0} onClick={onNext}>
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
  onFiles: (count: number) => void;
  onBack: () => void;
  onNext: () => void;
}) {
  return (
    <Card className="flex h-full min-h-0 flex-col overflow-hidden">
      <CardContent className="flex min-h-0 flex-1 flex-col items-center justify-center p-4 text-center sm:p-8">
        <div className="mb-4 flex flex-wrap justify-center gap-2">
          <Badge variant="secondary">{product.name}</Badge>
          <Badge variant="outline">{serialCount} {serialCount === 1 ? 'aparelho' : 'aparelhos'}</Badge>
        </div>
        <label className="flex w-full max-w-xl cursor-pointer flex-col items-center rounded-3xl border-2 border-dashed bg-muted/30 p-6 transition hover:bg-muted/55 sm:p-10">
          <span className="grid size-16 place-items-center rounded-2xl bg-card text-primary shadow-sm">
            <Camera className="size-7" />
          </span>
          <span className="mt-4 text-base font-bold">Fotografar recebimento</span>
          <span className="mt-1 text-sm text-muted-foreground">
            Selecione uma ou mais fotos da entrada.
          </span>
          {photoCount > 0 && (
            <span className="mt-4 inline-flex items-center gap-2 rounded-full bg-success/10 px-4 py-2 text-sm font-semibold text-success">
              <Check className="size-4" /> {photoCount} {photoCount === 1 ? 'foto pronta' : 'fotos prontas'}
            </span>
          )}
          <input
            accept="image/*"
            capture="environment"
            className="sr-only"
            multiple
            onChange={(event) => {
              const count = event.target.files?.length ?? 0;
              if (count > 0) onFiles(count);
            }}
            type="file"
          />
        </label>
      </CardContent>
      <div className="grid shrink-0 grid-cols-2 gap-2 border-t p-3 sm:p-4">
        <Button className="h-12 rounded-xl" onClick={onBack} variant="outline">
          <ArrowLeft /> Voltar
        </Button>
        <Button className="h-12 rounded-xl" disabled={photoCount === 0} onClick={onNext}>
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
  return (
    <Card className="flex h-full min-h-0 flex-col overflow-hidden">
      <CardContent className="min-h-0 flex-1 overflow-y-auto p-4 overscroll-contain sm:p-6">
        <div className="grid gap-4 md:grid-cols-2">
          <section className="rounded-2xl border bg-background p-4">
            <p className="eyebrow">Produto</p>
            <div className="mt-3 flex items-center gap-3">
              <span className="grid size-12 shrink-0 place-items-center rounded-xl bg-secondary text-primary">
                <Smartphone className="size-6" />
              </span>
              <div className="min-w-0">
                <p className="truncate font-bold">{product.name}</p>
                <p className="truncate text-sm text-muted-foreground">{product.detail}</p>
                <p className="mt-1 font-mono text-xs text-muted-foreground">UPC/EAN {product.code}</p>
              </div>
            </div>
          </section>
          <section className="rounded-2xl border bg-background p-4">
            <p className="eyebrow">Resumo</p>
            <dl className="mt-3 space-y-2 text-sm">
              <div className="flex justify-between gap-4"><dt className="text-muted-foreground">Aparelhos</dt><dd className="font-bold">{serials.length}</dd></div>
              <div className="flex justify-between gap-4"><dt className="text-muted-foreground">Fotos</dt><dd className="font-bold">{photoCount}</dd></div>
              <div className="flex justify-between gap-4"><dt className="text-muted-foreground">Situação</dt><dd className="font-bold text-success">Pronta</dd></div>
            </dl>
          </section>
        </div>

        <section className="mt-4 rounded-2xl border bg-background p-4">
          <div className="flex items-center justify-between gap-3">
            <p className="font-bold">Números de série</p>
            <Badge variant="secondary">{serials.length}</Badge>
          </div>
          <div className="mt-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
            {serials.map((serial, index) => (
              <div className="flex items-center gap-2 rounded-xl bg-muted/55 px-3 py-2.5" key={serial.normalized}>
                <span className="text-xs font-bold text-muted-foreground">{index + 1}</span>
                <span className="truncate font-mono text-sm font-semibold">{serial.normalized}</span>
              </div>
            ))}
          </div>
        </section>
      </CardContent>

      <div className="grid shrink-0 grid-cols-2 gap-2 border-t p-3 sm:p-4">
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
  productName,
  onReset,
}: {
  count: number;
  productName: string;
  onReset: () => void;
}) {
  return (
    <Card className="grid h-full place-items-center overflow-hidden">
      <CardContent className="max-w-lg p-6 text-center sm:p-10">
        <span className="mx-auto grid size-20 place-items-center rounded-full bg-success/10 text-success">
          <CheckCircle2 className="size-10" />
        </span>
        <h2 className="mt-5 text-2xl font-bold tracking-tight">Entrada preparada</h2>
        <p className="mt-2 text-sm leading-6 text-muted-foreground">
          {count} {count === 1 ? 'unidade de' : 'unidades de'} {productName} passaram por todas as etapas.
        </p>
        <p className="mt-3 rounded-xl bg-amber-500/10 px-4 py-3 text-sm text-amber-900">
          Esta é uma demonstração: nenhum estoque real foi alterado.
        </p>
        <Button className="mt-5 h-12 rounded-xl px-6" onClick={onReset}>
          <RotateCcw /> Fazer nova entrada
        </Button>
      </CardContent>
    </Card>
  );
}
