'use client';

import { useMemo, useRef, useState } from 'react';
import {
  ArrowLeft,
  ArrowRight,
  Banknote,
  Camera,
  Check,
  CheckCircle2,
  CircleUserRound,
  FileCheck2,
  Paperclip,
  Plus,
  RotateCcw,
  ScanBarcode,
  Search,
  Smartphone,
  Trash2,
  UserRound,
  WalletCards,
} from 'lucide-react';

import { BarcodeScanner } from '@/components/pdv/barcode-scanner';
import { FlowFrame } from '@/components/pdv/flow-frame';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import {
  NativeSelect,
  NativeSelectOption,
} from '@/components/ui/native-select';
import { normalizeCandidate, type ScanCandidate } from '@/lib/scanner';

type SaleStep =
  | 'customer'
  | 'serial'
  | 'photo'
  | 'price'
  | 'items'
  | 'payments'
  | 'receipt'
  | 'review'
  | 'done';

type SaleItem = {
  serial: ScanCandidate;
  product: string;
  detail: string;
  photoCount: number;
  priceCents: number;
};

type SaleProduct = {
  product: string;
  detail: string;
};

export type SaleProductLookup = Record<string, SaleProduct>;

type PaymentMethod = 'pix' | 'cash';

type SalePayment = {
  id: string;
  method: PaymentMethod;
  bank: string;
  amount: string;
};

const SALE_STEPS = [
  'Cliente',
  'SN',
  'Foto',
  'Preço',
  'Aparelhos',
  'Pagamentos',
  'Comprovante',
  'Revisão',
] as const;

const CUSTOMER_DIRECTORY = [
  'Rafael Martins',
  'Camila Souza',
  'Bruno Lima',
  'Fernanda Alves',
  'Mariana Costa',
  'Lucas Oliveira',
];

const STEP_INDEX: Record<SaleStep, number> = {
  customer: 0,
  serial: 1,
  photo: 2,
  price: 3,
  items: 4,
  payments: 5,
  receipt: 6,
  review: 7,
  done: 7,
};

export function SellWizard({
  stagedSerial = '',
  productsBySerial = {},
}: {
  stagedSerial?: string;
  productsBySerial?: SaleProductLookup;
}) {
  const initialSerial = stagedSerial
    ? normalizeCandidate(stagedSerial, 'manual_code_128', 'apple_serial')
    : null;
  const initialProduct = initialSerial
    ? productsBySerial[initialSerial.normalizedValue]
    : null;
  const [step, setStep] = useState<SaleStep>('customer');
  const [customer, setCustomer] = useState('');
  const [customerQuery, setCustomerQuery] = useState('');
  const [pendingSerial, setPendingSerial] = useState<ScanCandidate | null>(
    initialProduct ? initialSerial : null,
  );
  const [pendingProduct, setPendingProduct] = useState<SaleProduct | null>(
    initialProduct,
  );
  const [photoCount, setPhotoCount] = useState(0);
  const [price, setPrice] = useState('9.999,00');
  const [items, setItems] = useState<SaleItem[]>([]);
  const [payments, setPayments] = useState<SalePayment[]>([]);
  const [receiptNames, setReceiptNames] = useState<string[]>([]);
  const [serialWarning, setSerialWarning] = useState(
    initialSerial && !initialProduct
      ? `O SN ${initialSerial.normalizedValue} não foi encontrado no estoque de teste. Faça a entrada primeiro.`
      : '',
  );
  const [announcement, setAnnouncement] = useState(
    'Etapa 1. Pesquise o cliente para começar.',
  );
  const itemsRef = useRef<SaleItem[]>([]);

  const total = useMemo(
    () => items.reduce((sum, item) => sum + item.priceCents, 0),
    [items],
  );
  const paid = useMemo(
    () =>
      payments.reduce((sum, payment) => sum + parseMoney(payment.amount), 0),
    [payments],
  );
  const remaining = total - paid;
  const paymentsValid =
    payments.length > 0 &&
    payments.every(
      (payment) =>
        parseMoney(payment.amount) > 0 &&
        (payment.method !== 'pix' || Boolean(payment.bank)),
    );

  const description = useMemo(() => {
    if (step === 'customer') return 'Nenhum cliente aparece antes da pesquisa.';
    if (step === 'serial') return 'Localize o aparelho pelo número de série.';
    if (step === 'photo') return 'Vincule a foto deste aparelho.';
    if (step === 'price') return 'Informe o preço unitário.';
    if (step === 'items')
      return 'Bipe outro SN ou siga com o pagamento da venda inteira.';
    if (step === 'payments')
      return 'Adicione somente as formas usadas nesta venda.';
    if (step === 'receipt') return 'Anexe o comprovante ou pule esta etapa.';
    if (step === 'review')
      return 'Confira a venda completa antes de finalizar.';
    return 'Venda preparada com sucesso.';
  }, [step]);

  const reset = () => {
    setStep('customer');
    setCustomer('');
    setCustomerQuery('');
    setPendingSerial(null);
    setPendingProduct(null);
    setPhotoCount(0);
    setPrice('9.999,00');
    setItems([]);
    itemsRef.current = [];
    setPayments([]);
    setReceiptNames([]);
    setSerialWarning('');
    setAnnouncement('Nova venda. Pesquise o cliente para começar.');
  };

  const clearCheckout = () => {
    const hadCheckout = payments.length > 0 || receiptNames.length > 0;
    setPayments([]);
    setReceiptNames([]);
    return hadCheckout;
  };

  const acceptSerial = (candidate: ScanCandidate) => {
    if (
      itemsRef.current.some(
        (item) => item.serial.normalizedValue === candidate.normalizedValue,
      )
    ) {
      const warning = `O SN ${candidate.normalizedValue} já está nesta venda. Bipe outro SN.`;
      setPendingSerial(null);
      setPendingProduct(null);
      setSerialWarning(warning);
      navigator.vibrate?.([120, 80, 120]);
      return;
    }
    const product = productsBySerial[candidate.normalizedValue];
    if (!product) {
      const warning = `O SN ${candidate.normalizedValue} não foi encontrado no estoque de teste. Faça a entrada primeiro.`;
      setPendingSerial(null);
      setPendingProduct(null);
      setSerialWarning(warning);
      navigator.vibrate?.([120, 80, 120]);
      return;
    }
    setSerialWarning('');
    setPendingSerial(candidate);
    setPendingProduct(product);
    setAnnouncement(`SN ${candidate.normalizedValue} localizado e disponível.`);
  };

  const addPendingItem = () => {
    if (!pendingSerial || !pendingProduct) return;
    const priceCents = parseMoney(price);
    if (priceCents <= 0) return;
    if (
      itemsRef.current.some(
        (item) => item.serial.normalizedValue === pendingSerial.normalizedValue,
      )
    ) {
      const warning = `O SN ${pendingSerial.normalizedValue} já está nesta venda e não foi adicionado novamente.`;
      setSerialWarning(warning);
      setAnnouncement(warning);
      return;
    }

    const nextItems = [
      ...itemsRef.current,
      {
        serial: pendingSerial,
        product: pendingProduct.product,
        detail: pendingProduct.detail,
        photoCount,
        priceCents,
      },
    ];
    itemsRef.current = nextItems;
    setItems(nextItems);
    const checkoutReset = clearCheckout();
    setPendingSerial(null);
    setPendingProduct(null);
    setPhotoCount(0);
    setPrice('9.999,00');
    setSerialWarning('');
    setStep('items');
    setAnnouncement(
      checkoutReset
        ? 'Aparelho adicionado. Pagamentos e comprovantes foram reiniciados porque o total mudou.'
        : 'Etapa 5. Aparelho adicionado. Bipe outro SN ou vá para o pagamento.',
    );
  };

  const removeItem = (serial: string) => {
    const nextItems = itemsRef.current.filter(
      (item) => item.serial.normalizedValue !== serial,
    );
    if (nextItems.length === itemsRef.current.length) return;
    itemsRef.current = nextItems;
    setItems(nextItems);
    const checkoutReset = clearCheckout();
    if (nextItems.length === 0) {
      setStep('serial');
      setAnnouncement(
        checkoutReset
          ? 'A venda ficou sem aparelhos. Pagamentos e comprovantes foram reiniciados. Bipe um SN para continuar.'
          : 'A venda ficou sem aparelhos. Bipe um SN para continuar.',
      );
      return;
    }
    setAnnouncement(
      checkoutReset
        ? 'Aparelho removido. Pagamentos e comprovantes foram reiniciados porque o total mudou.'
        : 'Aparelho removido da venda.',
    );
  };

  const scanAnotherItem = () => {
    setPendingSerial(null);
    setPendingProduct(null);
    setPhotoCount(0);
    setPrice('9.999,00');
    setSerialWarning('');
    setStep('serial');
    setAnnouncement('Bipe o SN do próximo aparelho.');
  };

  const addPayment = (method: PaymentMethod) => {
    const suggestedAmount = Math.max(remaining, 0);
    setPayments((current) => [
      ...current,
      {
        id: createLocalId('payment'),
        method,
        bank: method === 'pix' ? 'nubank' : '',
        amount: formatMoneyInput(suggestedAmount),
      },
    ]);
    setAnnouncement(
      `${method === 'pix' ? 'Pix' : 'Dinheiro'} adicionado aos pagamentos.`,
    );
  };

  const updatePayment = (id: string, patch: Partial<SalePayment>) => {
    setPayments((current) =>
      current.map((payment) =>
        payment.id === id ? { ...payment, ...patch } : payment,
      ),
    );
  };

  const removePayment = (id: string) => {
    setPayments((current) => current.filter((payment) => payment.id !== id));
    setAnnouncement('Pagamento removido.');
  };

  const goToReview = (skippedReceipt: boolean) => {
    if (skippedReceipt) setReceiptNames([]);
    setStep('review');
    setAnnouncement(
      skippedReceipt
        ? 'Comprovante pulado. Revise e finalize a venda.'
        : 'Comprovante anexado. Revise e finalize a venda.',
    );
  };

  return (
    <FlowFrame
      announcement={announcement}
      currentStep={STEP_INDEX[step]}
      description={description}
      eyebrow="Ponto de venda"
      steps={SALE_STEPS}
      title={step === 'done' ? 'Venda concluída' : 'Nova venda'}
    >
      {step === 'customer' && (
        <CustomerStage
          customer={customer}
          onNext={() => {
            setStep('serial');
            setAnnouncement('Etapa 2. Bipe o número de série do aparelho.');
          }}
          onQueryChange={(value) => {
            setCustomerQuery(value);
            if (customer && value.trim() !== customer) setCustomer('');
          }}
          onSelect={(name) => {
            setCustomer(name);
            setCustomerQuery(name);
            setAnnouncement(`${name} selecionado.`);
          }}
          query={customerQuery}
        />
      )}

      {step === 'serial' && (
        <SaleSerialStage
          candidate={pendingSerial}
          onAccepted={acceptSerial}
          onBack={() => setStep(items.length > 0 ? 'items' : 'customer')}
          onConfirm={() => {
            setStep('photo');
            setAnnouncement('Etapa 3. Fotografe o aparelho.');
          }}
          onRescan={() => {
            setPendingSerial(null);
            setPendingProduct(null);
            setSerialWarning('');
            setAnnouncement('Faça uma nova leitura do SN.');
          }}
          product={pendingProduct}
          warning={serialWarning}
        />
      )}

      {step === 'photo' && pendingSerial && (
        <SalePhotoStage
          candidate={pendingSerial}
          onBack={() => setStep('serial')}
          onFiles={(count) => {
            setPhotoCount(count);
            setAnnouncement(
              `${count} ${count === 1 ? 'foto vinculada' : 'fotos vinculadas'} ao aparelho.`,
            );
          }}
          onNext={() => {
            setStep('price');
            setAnnouncement('Etapa 4. Informe o preço do aparelho.');
          }}
          photoCount={photoCount}
        />
      )}

      {step === 'price' && pendingSerial && pendingProduct && (
        <PriceStage
          candidate={pendingSerial}
          onBack={() => setStep('photo')}
          onChange={setPrice}
          onNext={addPendingItem}
          product={pendingProduct}
          value={price}
        />
      )}

      {step === 'items' && (
        <SaleItemsStage
          items={items}
          onAddAnother={scanAnotherItem}
          onNext={() => {
            setStep('payments');
            setAnnouncement(
              'Etapa 6. Adicione as formas de pagamento da venda inteira.',
            );
          }}
          onRemove={removeItem}
          total={total}
        />
      )}

      {step === 'payments' && (
        <PaymentStage
          itemCount={items.length}
          onAdd={addPayment}
          onBack={() => {
            setStep('items');
            setAnnouncement(
              'Revise os aparelhos ou siga novamente para o pagamento.',
            );
          }}
          onNext={() => {
            setStep('receipt');
            setAnnouncement(
              'Etapa 7. Anexe um comprovante ou use Pular comprovante.',
            );
          }}
          onRemove={removePayment}
          onUpdate={updatePayment}
          paid={paid}
          payments={payments}
          ready={paymentsValid && remaining === 0}
          remaining={remaining}
          total={total}
        />
      )}

      {step === 'receipt' && (
        <ReceiptStage
          fileNames={receiptNames}
          onBack={() => setStep('payments')}
          onFiles={(fileNames) => {
            setReceiptNames((current) =>
              Array.from(new Set([...current, ...fileNames])),
            );
            setAnnouncement(
              `${fileNames.length} ${fileNames.length === 1 ? 'comprovante anexado' : 'comprovantes anexados'}.`,
            );
          }}
          onNext={() => goToReview(false)}
          onSkip={() => goToReview(true)}
        />
      )}

      {step === 'review' && (
        <SaleReview
          customer={customer}
          items={items}
          onEditItems={() => {
            setStep('items');
            setAnnouncement('Revise os aparelhos antes de finalizar a venda.');
          }}
          onBack={() => setStep('receipt')}
          onConfirm={() => {
            setStep('done');
            setAnnouncement(
              `Venda concluída no valor de ${formatMoney(total)}.`,
            );
          }}
          paid={paid}
          payments={payments}
          receiptCount={receiptNames.length}
          total={total}
        />
      )}

      {step === 'done' && (
        <SaleCompletion customer={customer} onReset={reset} total={total} />
      )}
    </FlowFrame>
  );
}

function CustomerStage({
  customer,
  query,
  onQueryChange,
  onSelect,
  onNext,
}: {
  customer: string;
  query: string;
  onQueryChange: (value: string) => void;
  onSelect: (name: string) => void;
  onNext: () => void;
}) {
  const normalizedQuery = query.trim().toLocaleLowerCase('pt-BR');
  const canSearch = normalizedQuery.length >= 2;
  const matches = canSearch
    ? CUSTOMER_DIRECTORY.filter((name) =>
        name.toLocaleLowerCase('pt-BR').includes(normalizedQuery),
      )
    : [];
  return (
    <Card className="flex h-full min-h-0 flex-col overflow-hidden">
      <CardContent className="min-h-0 flex-1 overflow-y-auto p-4 overscroll-contain sm:p-6">
        <div className="mx-auto max-w-2xl">
          <div className="flex items-center gap-3">
            <span className="grid size-12 place-items-center rounded-2xl bg-secondary text-primary">
              <CircleUserRound className="size-6" />
            </span>
            <div>
              <h2 className="text-lg font-bold">Pesquisar cliente</h2>
              <p className="text-sm text-muted-foreground">
                Digite pelo menos duas letras. Nenhum cadastro é exibido antes
                disso.
              </p>
            </div>
          </div>

          <div className="relative mt-5">
            <Search className="absolute left-4 top-1/2 size-5 -translate-y-1/2 text-muted-foreground" />
            <Input
              aria-label="Pesquisar cliente"
              aria-describedby="customer-search-help"
              className="h-14 rounded-2xl pl-12 text-base"
              onChange={(event) => onQueryChange(event.target.value)}
              placeholder="Nome do cliente"
              value={query}
            />
          </div>
          <p
            className="mt-2 text-sm text-muted-foreground"
            id="customer-search-help"
          >
            A lista aparece somente depois da pesquisa.
          </p>

          {canSearch && (
            <div className="mt-4 space-y-2" aria-label="Clientes encontrados">
              {matches.map((name) => (
                <Button
                  aria-pressed={customer === name}
                  className="h-14 w-full justify-start rounded-2xl px-4"
                  key={name}
                  onClick={() => onSelect(name)}
                  variant={customer === name ? 'secondary' : 'outline'}
                >
                  <UserRound />
                  <span className="truncate">{name}</span>
                  {customer === name && (
                    <Check className="ml-auto text-success" />
                  )}
                </Button>
              ))}

              {matches.length === 0 && (
                <div className="rounded-2xl border border-dashed bg-muted/25 px-4 py-5 text-center text-sm text-muted-foreground">
                  Nenhum cliente cadastrado foi encontrado.
                </div>
              )}
            </div>
          )}

          {customer && (
            <div className="mt-4 flex items-center gap-2 rounded-xl bg-success/10 px-4 py-3 text-sm font-semibold text-success">
              <Check className="size-4" /> {customer} selecionado
            </div>
          )}
        </div>
      </CardContent>
      <div className="shrink-0 border-t p-3 text-right sm:p-4">
        <Button
          className="h-12 w-full rounded-xl sm:w-auto sm:min-w-56"
          disabled={!customer}
          onClick={onNext}
        >
          Bipar aparelho <ArrowRight />
        </Button>
      </div>
    </Card>
  );
}

function SaleSerialStage({
  candidate,
  product,
  warning,
  onAccepted,
  onBack,
  onConfirm,
  onRescan,
}: {
  candidate: ScanCandidate | null;
  product: SaleProduct | null;
  warning: string;
  onAccepted: (candidate: ScanCandidate) => void;
  onBack: () => void;
  onConfirm: () => void;
  onRescan: () => void;
}) {
  if (!candidate) {
    return (
      <div className="h-full min-h-0">
        <BarcodeScanner
          autoStart
          fill
          description="IMEI, EID e códigos numéricos ao redor não são considerados SN."
          mode="apple_serial"
          notice={warning}
          onAccepted={onAccepted}
          onBack={onBack}
          title="2. Bipar somente o SN"
        />
      </div>
    );
  }

  return (
    <Card className="flex h-full min-h-0 flex-col overflow-hidden">
      <CardContent className="grid min-h-0 flex-1 place-items-center overflow-y-auto p-5 text-center overscroll-contain sm:p-8">
        <div className="max-w-md">
          <span className="mx-auto grid size-16 place-items-center rounded-2xl bg-success/10 text-success">
            <Smartphone className="size-8" />
          </span>
          <p className="eyebrow mt-5">Aparelho disponível</p>
          <h2 className="mt-1 text-xl font-bold">
            {product?.product ?? 'Produto não identificado'}
          </h2>
          <p className="text-sm text-muted-foreground">
            {product?.detail ?? 'Confira o estoque antes de continuar'}
          </p>
          <p className="mx-auto mt-4 w-fit rounded-xl bg-muted px-4 py-2 font-mono text-sm font-bold">
            SN {candidate.normalizedValue}
          </p>
        </div>
      </CardContent>
      <div className="grid shrink-0 grid-cols-2 gap-2 border-t p-3 sm:p-4">
        <Button
          className="h-12 rounded-xl"
          onClick={onRescan}
          variant="outline"
        >
          <ScanBarcode />
          <span className="sm:hidden">Reler</span>
          <span className="hidden sm:inline">Ler novamente</span>
        </Button>
        <Button className="h-12 rounded-xl" onClick={onConfirm}>
          <span className="sm:hidden">Confirmar</span>
          <span className="hidden sm:inline">Confirmar aparelho</span>
          <ArrowRight className="hidden sm:block" />
        </Button>
      </div>
    </Card>
  );
}

function SalePhotoStage({
  candidate,
  photoCount,
  onFiles,
  onBack,
  onNext,
}: {
  candidate: ScanCandidate;
  photoCount: number;
  onFiles: (count: number) => void;
  onBack: () => void;
  onNext: () => void;
}) {
  return (
    <Card className="flex h-full min-h-0 flex-col overflow-hidden">
      <CardContent className="flex min-h-0 flex-1 flex-col items-center justify-start overflow-y-auto p-4 text-center overscroll-contain sm:justify-center sm:p-8">
        <Badge variant="secondary">SN {candidate.normalizedValue}</Badge>
        <label className="mt-4 flex w-full max-w-xl cursor-pointer flex-col items-center rounded-3xl border-2 border-dashed bg-muted/30 p-6 transition hover:bg-muted/55 sm:p-10">
          <span className="grid size-16 place-items-center rounded-2xl bg-card text-primary shadow-sm">
            <Camera className="size-7" />
          </span>
          <span className="mt-4 text-base font-bold">Fotografar aparelho</span>
          <span className="mt-1 text-sm text-muted-foreground">
            A foto ficará vinculada a este SN.
          </span>
          {photoCount > 0 && (
            <span className="mt-4 inline-flex items-center gap-2 rounded-full bg-success/10 px-4 py-2 text-sm font-semibold text-success">
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
        <Button
          className="h-12 rounded-xl"
          disabled={photoCount === 0}
          onClick={onNext}
        >
          <span className="sm:hidden">Preço</span>
          <span className="hidden sm:inline">Informar preço</span>
          <ArrowRight className="hidden sm:block" />
        </Button>
      </div>
    </Card>
  );
}

function PriceStage({
  candidate,
  product,
  value,
  onChange,
  onBack,
  onNext,
}: {
  candidate: ScanCandidate;
  product: SaleProduct;
  value: string;
  onChange: (value: string) => void;
  onBack: () => void;
  onNext: () => void;
}) {
  const valid = parseMoney(value) > 0;
  return (
    <Card className="flex h-full min-h-0 flex-col overflow-hidden">
      <CardContent className="grid min-h-0 flex-1 place-items-center overflow-y-auto p-5 overscroll-contain sm:p-8">
        <div className="w-full max-w-lg">
          <div className="flex items-center gap-3 rounded-2xl border bg-background p-4">
            <span className="grid size-12 shrink-0 place-items-center rounded-xl bg-secondary text-primary">
              <Smartphone className="size-6" />
            </span>
            <div className="min-w-0">
              <p className="truncate font-bold">{product.product}</p>
              <p className="truncate text-xs text-muted-foreground">
                {product.detail}
              </p>
              <p className="truncate text-sm text-muted-foreground">
                SN {candidate.normalizedValue}
              </p>
            </div>
          </div>
          <label
            className="mt-5 block text-sm font-semibold"
            htmlFor="sale-price"
          >
            Preço unitário
          </label>
          <div className="relative mt-2">
            <span className="absolute left-4 top-1/2 -translate-y-1/2 text-base font-bold text-muted-foreground">
              R$
            </span>
            <Input
              className="h-16 pl-12 text-right text-2xl font-extrabold"
              id="sale-price"
              inputMode="decimal"
              onChange={(event) => onChange(event.target.value)}
              value={value}
            />
          </div>
        </div>
      </CardContent>
      <div className="grid shrink-0 grid-cols-2 gap-2 border-t p-3 sm:p-4">
        <Button className="h-12 rounded-xl" onClick={onBack} variant="outline">
          <ArrowLeft /> Voltar
        </Button>
        <Button className="h-12 rounded-xl" disabled={!valid} onClick={onNext}>
          <span className="sm:hidden">Adicionar</span>
          <span className="hidden sm:inline">Adicionar aparelho</span>
          <ArrowRight className="hidden sm:block" />
        </Button>
      </div>
    </Card>
  );
}

function SaleItemsStage({
  items,
  total,
  onAddAnother,
  onRemove,
  onNext,
}: {
  items: SaleItem[];
  total: number;
  onAddAnother: () => void;
  onRemove: (serial: string) => void;
  onNext: () => void;
}) {
  return (
    <Card className="flex h-full min-h-0 flex-col overflow-hidden">
      <CardContent className="min-h-0 flex-1 overflow-y-auto p-4 overscroll-contain sm:p-6">
        <div className="mx-auto max-w-2xl">
          <div className="rounded-2xl bg-secondary p-4">
            <div className="flex items-center justify-between gap-3">
              <div>
                <p className="font-bold">Aparelhos desta venda</p>
                <p className="mt-1 text-sm text-muted-foreground">
                  Cada SN é um aparelho. O pagamento será do total da venda.
                </p>
              </div>
              <Badge className="shrink-0" variant="secondary">
                {items.length} {items.length === 1 ? 'item' : 'itens'}
              </Badge>
            </div>
          </div>

          <ul className="mt-4 space-y-2" aria-label="Aparelhos da venda">
            {items.map((item) => (
              <li
                className="flex items-center gap-3 rounded-2xl border bg-background p-3"
                key={item.serial.normalizedValue}
              >
                <span className="grid size-11 shrink-0 place-items-center rounded-xl bg-secondary text-primary">
                  <Smartphone className="size-5" />
                </span>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-bold">{item.product}</p>
                  <p className="truncate text-xs text-muted-foreground">
                    {item.detail}
                  </p>
                  <p className="truncate font-mono text-xs text-muted-foreground">
                    SN {item.serial.normalizedValue}
                  </p>
                </div>
                <strong className="shrink-0 text-sm">
                  {formatMoney(item.priceCents)}
                </strong>
                <Button
                  aria-label={`Remover ${item.product}, SN ${item.serial.normalizedValue}`}
                  className="size-11 shrink-0"
                  onClick={() => onRemove(item.serial.normalizedValue)}
                  size="icon"
                  variant="ghost"
                >
                  <Trash2 />
                </Button>
              </li>
            ))}
          </ul>

          <div className="mt-4 flex items-center justify-between rounded-2xl bg-muted p-4">
            <span className="font-semibold">Total da venda</span>
            <strong className="text-lg">{formatMoney(total)}</strong>
          </div>
        </div>
      </CardContent>
      <div className="grid shrink-0 grid-cols-2 gap-2 border-t p-3 sm:p-4">
        <Button
          className="h-12 rounded-xl"
          onClick={onAddAnother}
          variant="outline"
        >
          <ScanBarcode />
          <span className="sm:hidden">Outro SN</span>
          <span className="hidden sm:inline">Bipar outro SN</span>
        </Button>
        <Button
          className="h-12 rounded-xl"
          disabled={items.length === 0}
          onClick={onNext}
        >
          <span className="sm:hidden">Pagamento</span>
          <span className="hidden sm:inline">Ir para pagamento</span>
          <ArrowRight className="hidden sm:block" />
        </Button>
      </div>
    </Card>
  );
}

function PaymentStage({
  itemCount,
  total,
  paid,
  remaining,
  payments,
  ready,
  onAdd,
  onUpdate,
  onRemove,
  onBack,
  onNext,
}: {
  itemCount: number;
  total: number;
  paid: number;
  remaining: number;
  payments: SalePayment[];
  ready: boolean;
  onAdd: (method: PaymentMethod) => void;
  onUpdate: (id: string, patch: Partial<SalePayment>) => void;
  onRemove: (id: string) => void;
  onBack: () => void;
  onNext: () => void;
}) {
  const [showTypePicker, setShowTypePicker] = useState(false);

  return (
    <Card className="flex h-full min-h-0 flex-col overflow-hidden">
      <CardContent className="min-h-0 flex-1 overflow-y-auto p-4 overscroll-contain sm:p-6">
        <div className="mx-auto max-w-2xl space-y-3">
          <div className="rounded-2xl bg-secondary px-4 py-3">
            <p className="font-bold">Pagamento da venda inteira</p>
            <p className="mt-1 text-sm text-muted-foreground">
              As formas de pagamento cobrem{' '}
              {itemCount === 1
                ? 'o total do aparelho'
                : `o total dos ${itemCount} aparelhos`}{' '}
              desta venda.
            </p>
          </div>

          {payments.length === 0 && (
            <div className="rounded-2xl border border-dashed bg-muted/25 p-5 text-center">
              <WalletCards className="mx-auto size-7 text-primary" />
              <p className="mt-2 font-bold">Nenhum pagamento adicionado</p>
              <p className="mt-1 text-sm text-muted-foreground">
                Dinheiro só aparecerá se você escolher essa opção.
              </p>
            </div>
          )}

          {payments.map((payment, index) => (
            <div
              className="rounded-2xl border bg-background p-4"
              key={payment.id}
            >
              <div className="flex items-center justify-between gap-3">
                <div className="flex items-center gap-2 font-bold">
                  {payment.method === 'pix' ? (
                    <WalletCards className="size-5 text-primary" />
                  ) : (
                    <Banknote className="size-5 text-primary" />
                  )}
                  {index + 1}. {payment.method === 'pix' ? 'Pix' : 'Dinheiro'}
                </div>
                <Button
                  aria-label={`Remover pagamento ${index + 1}`}
                  className="size-11"
                  onClick={() => onRemove(payment.id)}
                  size="icon"
                  variant="ghost"
                >
                  <Trash2 />
                </Button>
              </div>

              <div
                className={`mt-3 grid gap-3 ${payment.method === 'pix' ? 'sm:grid-cols-2' : ''}`}
              >
                {payment.method === 'pix' && (
                  <div>
                    <label
                      className="text-sm font-semibold"
                      htmlFor={`bank-${payment.id}`}
                    >
                      Banco
                    </label>
                    <NativeSelect
                      className="mt-1 h-12 w-full [&_select]:h-12"
                      id={`bank-${payment.id}`}
                      onChange={(event) =>
                        onUpdate(payment.id, { bank: event.target.value })
                      }
                      value={payment.bank}
                    >
                      <NativeSelectOption value="nubank">
                        Nubank
                      </NativeSelectOption>
                      <NativeSelectOption value="itau">Itaú</NativeSelectOption>
                      <NativeSelectOption value="inter">
                        Inter
                      </NativeSelectOption>
                    </NativeSelect>
                  </div>
                )}
                <div>
                  <label
                    className="text-sm font-semibold"
                    htmlFor={`amount-${payment.id}`}
                  >
                    Valor
                  </label>
                  <Input
                    className="mt-1 h-12 text-right text-base font-bold"
                    id={`amount-${payment.id}`}
                    inputMode="decimal"
                    onChange={(event) =>
                      onUpdate(payment.id, { amount: event.target.value })
                    }
                    value={payment.amount}
                  />
                </div>
              </div>
            </div>
          ))}

          <Button
            className="h-12 w-full rounded-2xl border-dashed"
            onClick={() => setShowTypePicker((current) => !current)}
            variant="outline"
          >
            <Plus /> Adicionar pagamento
          </Button>

          {showTypePicker && (
            <div className="grid grid-cols-2 gap-2 rounded-2xl bg-muted p-3">
              <Button
                className="h-12 rounded-xl"
                onClick={() => {
                  onAdd('pix');
                  setShowTypePicker(false);
                }}
                variant="outline"
              >
                <WalletCards /> Pix
              </Button>
              <Button
                className="h-12 rounded-xl"
                onClick={() => {
                  onAdd('cash');
                  setShowTypePicker(false);
                }}
                variant="outline"
              >
                <Banknote /> Dinheiro
              </Button>
            </div>
          )}

          <div className="rounded-2xl bg-muted p-4">
            <div className="flex justify-between text-sm">
              <span className="text-muted-foreground">Total da venda</span>
              <strong>{formatMoney(total)}</strong>
            </div>
            <div className="mt-2 flex justify-between text-sm">
              <span className="text-muted-foreground">Informado</span>
              <strong>{formatMoney(paid)}</strong>
            </div>
            <div className="mt-3 flex justify-between border-t pt-3">
              <span className="font-bold">
                {remaining < 0 ? 'Excedente' : 'Restante'}
              </span>
              <strong
                className={
                  remaining === 0 ? 'text-success' : 'text-destructive'
                }
              >
                {formatMoney(Math.abs(remaining))}
              </strong>
            </div>
          </div>
        </div>
      </CardContent>
      <div className="grid shrink-0 grid-cols-2 gap-2 border-t p-3 sm:p-4">
        <Button className="h-12 rounded-xl" onClick={onBack} variant="outline">
          <ArrowLeft /> Voltar
        </Button>
        <Button className="h-12 rounded-xl" disabled={!ready} onClick={onNext}>
          Comprovante <ArrowRight className="hidden sm:block" />
        </Button>
      </div>
    </Card>
  );
}

function ReceiptStage({
  fileNames,
  onFiles,
  onBack,
  onSkip,
  onNext,
}: {
  fileNames: string[];
  onFiles: (fileNames: string[]) => void;
  onBack: () => void;
  onSkip: () => void;
  onNext: () => void;
}) {
  return (
    <Card className="flex h-full min-h-0 flex-col overflow-hidden">
      <CardContent className="flex min-h-0 flex-1 flex-col items-center justify-start overflow-y-auto p-4 text-center overscroll-contain sm:justify-center sm:p-8">
        <Badge variant="secondary">Comprovante opcional</Badge>
        <div className="mt-4 grid w-full max-w-xl grid-cols-2 gap-3">
          <label className="flex min-h-40 cursor-pointer flex-col items-center justify-center rounded-3xl border-2 border-dashed bg-muted/30 p-4 transition hover:bg-muted/55 sm:p-6">
            <span className="grid size-12 place-items-center rounded-2xl bg-card text-primary shadow-sm">
              <Camera className="size-6" />
            </span>
            <span className="mt-3 font-bold">Tirar foto</span>
            <span className="mt-1 text-xs text-muted-foreground">
              Abrir a câmera
            </span>
            <input
              accept="image/*"
              capture="environment"
              className="sr-only"
              onChange={(event) => {
                const names = Array.from(event.target.files ?? []).map(
                  (file) => file.name,
                );
                if (names.length > 0) onFiles(names);
                event.currentTarget.value = '';
              }}
              type="file"
            />
          </label>

          <label className="flex min-h-40 cursor-pointer flex-col items-center justify-center rounded-3xl border-2 border-dashed bg-muted/30 p-4 transition hover:bg-muted/55 sm:p-6">
            <span className="grid size-12 place-items-center rounded-2xl bg-card text-primary shadow-sm">
              <Paperclip className="size-6" />
            </span>
            <span className="mt-3 font-bold">Anexar arquivo</span>
            <span className="mt-1 text-xs text-muted-foreground">
              Foto ou PDF
            </span>
            <input
              accept="image/*,application/pdf"
              className="sr-only"
              multiple
              onChange={(event) => {
                const names = Array.from(event.target.files ?? []).map(
                  (file) => file.name,
                );
                if (names.length > 0) onFiles(names);
                event.currentTarget.value = '';
              }}
              type="file"
            />
          </label>
        </div>

        {fileNames.length > 0 && (
          <div className="mt-4 flex max-w-xl items-center gap-2 rounded-full bg-success/10 px-4 py-2 text-sm font-semibold text-success">
            <FileCheck2 className="size-4 shrink-0" />
            <span className="truncate">
              {fileNames.length === 1
                ? fileNames[0]
                : `${fileNames.length} comprovantes prontos`}
            </span>
          </div>
        )}
      </CardContent>
      <div className="grid shrink-0 grid-cols-[auto_1fr] gap-2 border-t p-3 sm:p-4">
        <Button
          aria-label="Voltar"
          className="h-12 rounded-xl"
          onClick={onBack}
          variant="outline"
        >
          <ArrowLeft />
        </Button>
        {fileNames.length === 0 ? (
          <Button className="h-12 rounded-xl" onClick={onSkip}>
            Pular comprovante <ArrowRight />
          </Button>
        ) : (
          <Button className="h-12 rounded-xl" onClick={onNext}>
            Continuar com comprovante <ArrowRight className="hidden sm:block" />
          </Button>
        )}
      </div>
    </Card>
  );
}

function SaleReview({
  customer,
  items,
  payments,
  receiptCount,
  total,
  paid,
  onBack,
  onEditItems,
  onConfirm,
}: {
  customer: string;
  items: SaleItem[];
  payments: SalePayment[];
  receiptCount: number;
  total: number;
  paid: number;
  onBack: () => void;
  onEditItems: () => void;
  onConfirm: () => void;
}) {
  return (
    <Card className="flex h-full min-h-0 flex-col overflow-hidden">
      <CardContent className="min-h-0 flex-1 overflow-y-auto p-4 overscroll-contain sm:p-6">
        <div className="mx-auto max-w-3xl">
          <div className="grid gap-3 sm:grid-cols-3">
            <SummaryTile
              label="Cliente"
              value={customer}
              icon={CircleUserRound}
            />
            <SummaryTile
              label="Itens"
              value={String(items.length)}
              icon={Smartphone}
            />
            <SummaryTile
              label="Total"
              value={formatMoney(total)}
              icon={WalletCards}
            />
          </div>

          <section className="mt-4 rounded-2xl border bg-background p-4">
            <div className="flex items-center justify-between">
              <h2 className="font-bold">Aparelhos</h2>
              <Badge variant="secondary">{items.length}</Badge>
            </div>
            <div className="mt-3 space-y-2">
              {items.map((item) => (
                <div
                  className="flex items-center gap-3 rounded-xl bg-muted/50 p-3"
                  key={item.serial.normalizedValue}
                >
                  <Smartphone className="size-5 shrink-0 text-primary" />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-bold">{item.product}</p>
                    <p className="truncate font-mono text-xs text-muted-foreground">
                      SN {item.serial.normalizedValue} · {item.photoCount}{' '}
                      {item.photoCount === 1 ? 'foto' : 'fotos'}
                    </p>
                  </div>
                  <strong className="text-sm">
                    {formatMoney(item.priceCents)}
                  </strong>
                </div>
              ))}
            </div>
            <Button
              className="mt-3 h-11 w-full rounded-xl border-dashed"
              onClick={onEditItems}
              variant="outline"
            >
              <Smartphone /> Alterar aparelhos
            </Button>
          </section>

          <div className="mt-4 grid gap-3 sm:grid-cols-2">
            <div className="rounded-2xl bg-success/10 p-4 text-sm">
              <div className="flex items-center justify-between gap-3">
                <span className="font-semibold text-success">
                  {payments.length}{' '}
                  {payments.length === 1 ? 'pagamento' : 'pagamentos'}
                </span>
                <strong>{formatMoney(paid)}</strong>
              </div>
            </div>
            <div className="rounded-2xl bg-muted p-4 text-sm">
              <div className="flex items-center justify-between gap-3">
                <span className="font-semibold">Comprovante</span>
                <strong>
                  {receiptCount > 0
                    ? `${receiptCount} ${receiptCount === 1 ? 'anexado' : 'anexados'}`
                    : 'Pulado'}
                </strong>
              </div>
            </div>
          </div>
        </div>
      </CardContent>
      <div className="grid shrink-0 grid-cols-2 gap-2 border-t p-3 sm:p-4">
        <Button className="h-12 rounded-xl" onClick={onBack} variant="outline">
          <ArrowLeft /> Voltar
        </Button>
        <Button className="h-12 rounded-xl" onClick={onConfirm}>
          <Check /> Finalizar venda
        </Button>
      </div>
    </Card>
  );
}

function SummaryTile({
  label,
  value,
  icon: Icon,
}: {
  label: string;
  value: string;
  icon: typeof Smartphone;
}) {
  return (
    <div className="flex items-center gap-3 rounded-2xl border bg-background p-3">
      <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-secondary text-primary">
        <Icon className="size-5" />
      </span>
      <div className="min-w-0">
        <p className="text-xs font-semibold text-muted-foreground">{label}</p>
        <p className="truncate text-sm font-bold">{value}</p>
      </div>
    </div>
  );
}

function SaleCompletion({
  customer,
  total,
  onReset,
}: {
  customer: string;
  total: number;
  onReset: () => void;
}) {
  return (
    <Card className="grid h-full place-items-center overflow-hidden">
      <CardContent className="max-w-lg p-6 text-center sm:p-10">
        <span className="mx-auto grid size-20 place-items-center rounded-full bg-success/10 text-success">
          <CheckCircle2 className="size-10" />
        </span>
        <h2 className="mt-5 text-2xl font-bold tracking-tight">
          Venda preparada
        </h2>
        <p className="mt-2 text-sm leading-6 text-muted-foreground">
          Cliente {customer} · total de {formatMoney(total)}.
        </p>
        <p className="mt-3 rounded-xl bg-amber-500/10 px-4 py-3 text-sm text-amber-900">
          Esta é uma demonstração: nenhum estoque ou pagamento real foi
          alterado.
        </p>
        <Button className="mt-5 h-12 rounded-xl px-6" onClick={onReset}>
          <RotateCcw /> Fazer nova venda
        </Button>
      </CardContent>
    </Card>
  );
}

function createLocalId(prefix: string) {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) {
    return `${prefix}-${crypto.randomUUID()}`;
  }
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function parseMoney(value: string) {
  const normalized = value
    .replace(/\./g, '')
    .replace(',', '.')
    .replace(/[^\d.]/g, '');
  return Math.round((Number.parseFloat(normalized) || 0) * 100);
}

function formatMoney(cents: number) {
  return new Intl.NumberFormat('pt-BR', {
    style: 'currency',
    currency: 'BRL',
  }).format(cents / 100);
}

function formatMoneyInput(cents: number) {
  return new Intl.NumberFormat('pt-BR', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(cents / 100);
}
