'use client';

import { useMemo, useRef, useState } from 'react';
import {
  ArrowLeft,
  ArrowRight,
  Banknote,
  Camera,
  Check,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  CircleUserRound,
  FileCheck2,
  LoaderCircle,
  Paperclip,
  Plus,
  RotateCcw,
  ScanBarcode,
  Search,
  Smartphone,
  Trash2,
  UserRound,
  WalletCards,
  X,
} from 'lucide-react';

import { BarcodeScanner } from '@/components/pdv/barcode-scanner';
import { FlowFrame } from '@/components/pdv/flow-frame';
import { ProductColorSwatch } from '@/components/pdv/product-color-swatch';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import {
  NativeSelect,
  NativeSelectOption,
} from '@/components/ui/native-select';
import {
  formatMediaBytes,
  MEDIA_LIMITS,
  prepareMediaSelection,
  sumFileBytes,
  type PreparedMediaSelection,
} from '@/lib/client-media';
import { parseMoneyInput } from '@/lib/money';
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
  photos: File[];
  defaultPriceCents: number;
  priceCents: number;
};

type SaleProduct = {
  product: string;
  detail: string;
  defaultPriceCents: number;
};

export type SaleSerialMatch = SaleProduct & {
  serial: string;
  status: 'available' | 'sold';
};

export type SaleProductLookup = Record<string, SaleProduct>;

export type SaleCustomer = { id: string; name: string };
export type SalePixAccount = { id: string; name: string };

type PaymentMethod = 'pix' | 'cash';

type SalePayment = {
  id: string;
  method: PaymentMethod;
  bank: string;
  amount: string;
};

export type CompletedSalePayload = {
  customerId: string;
  customer: string;
  items: Array<{
    serial: string;
    product: string;
    detail: string;
    photos: File[];
    defaultPriceCents: number;
    priceCents: number;
  }>;
  payments: Array<{
    method: 'Pix' | 'Dinheiro';
    bank: string;
    amountCents: number;
  }>;
  receipts: File[];
  productsTotalCents: number;
  receivedTotalCents: number;
  receivedDifferenceCents: number;
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

const STAGE_CARD_CLASS =
  'flow-stage-card flex h-full min-h-0 flex-col gap-0 overflow-hidden py-0';

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
  customers = [],
  pixAccounts = [],
  onComplete,
  unavailableSerials,
  resolveSerials,
}: {
  stagedSerial?: string;
  productsBySerial?: SaleProductLookup;
  customers?: SaleCustomer[];
  pixAccounts?: SalePixAccount[];
  onComplete?: (sale: CompletedSalePayload) => void | Promise<void>;
  unavailableSerials?: ReadonlySet<string>;
  resolveSerials?: (serials: string[]) => Promise<SaleSerialMatch[]>;
}) {
  const initialSerial = stagedSerial
    ? normalizeCandidate(stagedSerial, 'manual_code_128', 'apple_serial')
    : null;
  const initialUnavailable = initialSerial
    ? unavailableSerials?.has(initialSerial.normalizedValue)
    : false;
  const initialProduct =
    initialSerial && !initialUnavailable
      ? productsBySerial[initialSerial.normalizedValue]
      : null;
  const [step, setStep] = useState<SaleStep>('customer');
  const [customerId, setCustomerId] = useState('');
  const [customer, setCustomer] = useState('');
  const [customerQuery, setCustomerQuery] = useState('');
  const [pendingSerial, setPendingSerial] = useState<ScanCandidate | null>(
    initialProduct ? initialSerial : null,
  );
  const [pendingProduct, setPendingProduct] = useState<SaleProduct | null>(
    initialProduct,
  );
  const [photoFiles, setPhotoFiles] = useState<File[]>([]);
  const [price, setPrice] = useState(() =>
    getDefaultPriceInput(initialProduct),
  );
  const [items, setItems] = useState<SaleItem[]>([]);
  const [payments, setPayments] = useState<SalePayment[]>([]);
  const [receiptFiles, setReceiptFiles] = useState<File[]>([]);
  const [preparingPhotos, setPreparingPhotos] = useState(false);
  const [photoProgress, setPhotoProgress] = useState('');
  const [photoError, setPhotoError] = useState('');
  const [preparingReceipts, setPreparingReceipts] = useState(false);
  const [receiptProgress, setReceiptProgress] = useState('');
  const [receiptError, setReceiptError] = useState('');
  const [saving, setSaving] = useState(false);
  const [serialWarning, setSerialWarning] = useState(
    initialSerial && initialUnavailable
      ? `O SN ${initialSerial.normalizedValue} já foi vendido e não está disponível. Cancele a venda anterior para liberá-lo.`
      : initialSerial && !initialProduct
        ? `O SN ${initialSerial.normalizedValue} não foi encontrado no estoque da loja. Faça a entrada primeiro.`
        : '',
  );
  const [checkingSerial, setCheckingSerial] = useState(false);
  const [announcement, setAnnouncement] = useState(
    'Etapa 1. Pesquise o cliente para começar.',
  );
  const itemsRef = useRef<SaleItem[]>([]);
  const completionSentRef = useRef(false);
  const checkingSerialRef = useRef(false);

  const total = useMemo(
    () => items.reduce((sum, item) => sum + item.priceCents, 0),
    [items],
  );
  const paid = useMemo(
    () =>
      payments.reduce(
        (sum, payment) => sum + parseMoneyInput(payment.amount),
        0,
      ),
    [payments],
  );
  const remaining = total - paid;
  const paymentsValid =
    payments.length > 0 &&
    payments.every(
      (payment) =>
        parseMoneyInput(payment.amount) > 0 &&
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
    setCustomerId('');
    setCustomer('');
    setCustomerQuery('');
    setPendingSerial(null);
    setPendingProduct(null);
    setPhotoFiles([]);
    setPreparingPhotos(false);
    setPhotoProgress('');
    setPhotoError('');
    setPrice('');
    setItems([]);
    itemsRef.current = [];
    setPayments([]);
    setReceiptFiles([]);
    setPreparingReceipts(false);
    setReceiptProgress('');
    setReceiptError('');
    setSaving(false);
    setSerialWarning('');
    completionSentRef.current = false;
    setAnnouncement('Nova venda. Pesquise o cliente para começar.');
  };

  const clearCheckout = () => {
    const hadCheckout = payments.length > 0 || receiptFiles.length > 0;
    setPayments([]);
    setReceiptFiles([]);
    setReceiptProgress('');
    setReceiptError('');
    return hadCheckout;
  };

  const prepareItemPhotos = async (files: File[]) => {
    if (preparingPhotos) return;
    setPreparingPhotos(true);
    setPhotoError('');
    setPhotoProgress('Preparando fotos…');
    try {
      const result = await prepareMediaSelection({
        current: photoFiles,
        incoming: files,
        maxFiles: MEDIA_LIMITS.saleItemPhotos,
        otherFiles: itemsRef.current.flatMap((item) => item.photos),
        maxCombinedFiles: MEDIA_LIMITS.saleFiles,
        onProgress: ({ completed, total }) => {
          setPhotoProgress(
            total > 0
              ? `Preparando foto ${Math.min(completed + 1, total)} de ${total}…`
              : 'Preparando fotos…',
          );
        },
      });
      setPhotoFiles(result.files);
      setAnnouncement(mediaReadyAnnouncement(result, 'foto', 'fotos'));
    } catch (error) {
      const message =
        error instanceof Error
          ? error.message
          : 'Não foi possível preparar as fotos.';
      setPhotoError(message);
      setAnnouncement(message);
    } finally {
      setPreparingPhotos(false);
      setPhotoProgress('');
    }
  };

  const prepareReceipts = async (files: File[]) => {
    if (preparingReceipts) return;
    setPreparingReceipts(true);
    setReceiptError('');
    setReceiptProgress('Preparando comprovantes…');
    try {
      const result = await prepareMediaSelection({
        current: receiptFiles,
        incoming: files,
        maxFiles: MEDIA_LIMITS.saleReceipts,
        allowPdf: true,
        otherFiles: itemsRef.current.flatMap((item) => item.photos),
        maxCombinedFiles: MEDIA_LIMITS.saleFiles,
        onProgress: ({ completed, total }) => {
          setReceiptProgress(
            total > 0
              ? `Preparando arquivo ${Math.min(completed + 1, total)} de ${total}…`
              : 'Preparando comprovantes…',
          );
        },
      });
      setReceiptFiles(result.files);
      setAnnouncement(
        mediaReadyAnnouncement(result, 'comprovante', 'comprovantes'),
      );
    } catch (error) {
      const message =
        error instanceof Error
          ? error.message
          : 'Não foi possível preparar os comprovantes.';
      setReceiptError(message);
      setAnnouncement(message);
    } finally {
      setPreparingReceipts(false);
      setReceiptProgress('');
    }
  };

  const acceptSerial = async (candidate: ScanCandidate) => {
    if (checkingSerialRef.current) return;
    const candidateValues = serialCandidateValues(candidate);
    const repeatedValue = candidateValues.find((value) =>
      itemsRef.current.some((item) => item.serial.normalizedValue === value),
    );
    if (repeatedValue) {
      const warning = `O SN ${repeatedValue} já está nesta venda. Bipe outro SN.`;
      setPendingSerial(null);
      setPendingProduct(null);
      setPrice('');
      setSerialWarning(warning);
      navigator.vibrate?.([120, 80, 120]);
      return;
    }
    let availableValue = candidateValues.find(
      (value) =>
        Boolean(productsBySerial[value]) && !unavailableSerials?.has(value),
    );
    let unavailableValue = candidateValues.find((value) =>
      unavailableSerials?.has(value),
    );
    let product = availableValue ? productsBySerial[availableValue] : null;
    if (resolveSerials) {
      checkingSerialRef.current = true;
      setCheckingSerial(true);
      setSerialWarning('');
      try {
        const matches = await resolveSerials(candidateValues);
        const available = candidateValues
          .map((value) =>
            matches.find(
              (match) => match.serial === value && match.status === 'available',
            ),
          )
          .find(Boolean);
        const unavailable = candidateValues
          .map((value) =>
            matches.find(
              (match) => match.serial === value && match.status === 'sold',
            ),
          )
          .find(Boolean);
        availableValue = available?.serial;
        unavailableValue = unavailable?.serial;
        product = available ?? null;
      } catch {
        setSerialWarning(
          'Não foi possível consultar este SN agora. Confira a conexão e tente novamente.',
        );
        navigator.vibrate?.([120, 80, 120]);
        return;
      } finally {
        checkingSerialRef.current = false;
        setCheckingSerial(false);
      }
    }
    if (!availableValue && unavailableValue) {
      const warning = `O SN ${unavailableValue} já foi vendido e não está disponível. Cancele a venda anterior para liberá-lo.`;
      setPendingSerial(null);
      setPendingProduct(null);
      setPhotoFiles([]);
      setPhotoProgress('');
      setPhotoError('');
      setPrice('');
      setSerialWarning(warning);
      navigator.vibrate?.([120, 80, 120]);
      return;
    }
    setPhotoFiles([]);
    setPhotoProgress('');
    setPhotoError('');
    if (!product || !availableValue) {
      const warning = `O SN ${candidate.normalizedValue} não foi encontrado no estoque da loja. Faça a entrada primeiro.`;
      setPendingSerial(null);
      setPendingProduct(null);
      setPrice('');
      setSerialWarning(warning);
      navigator.vibrate?.([120, 80, 120]);
      return;
    }
    const resolvedCandidate =
      availableValue === candidate.normalizedValue
        ? candidate
        : {
            ...candidate,
            normalizedValue: availableValue,
            key: `SERIAL:${availableValue}`,
          };
    setSerialWarning('');
    setPendingSerial(resolvedCandidate);
    setPendingProduct(product);
    setPrice(getDefaultPriceInput(product));
    setAnnouncement(`SN ${availableValue} localizado e disponível.`);
  };

  const addPendingItem = () => {
    if (!pendingSerial || !pendingProduct) return;
    const priceCents = parseMoneyInput(price);
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
        photos: photoFiles,
        defaultPriceCents: pendingProduct.defaultPriceCents,
        priceCents,
      },
    ];
    itemsRef.current = nextItems;
    setItems(nextItems);
    const checkoutReset = clearCheckout();
    setPendingSerial(null);
    setPendingProduct(null);
    setPhotoFiles([]);
    setPhotoProgress('');
    setPhotoError('');
    setPrice('');
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
    setPhotoFiles([]);
    setPhotoProgress('');
    setPhotoError('');
    setPrice('');
    setSerialWarning('');
    setStep('serial');
    setAnnouncement('Bipe o SN do próximo aparelho.');
  };

  const addPayment = (method: PaymentMethod) => {
    const suggestedAmount = Math.max(remaining, 0);
    const receiptInvalidated = receiptFiles.length > 0;
    setReceiptProgress('');
    setReceiptError('');
    if (receiptInvalidated) {
      setReceiptFiles([]);
      setReceiptProgress('');
      setReceiptError('');
    }
    setPayments((current) => [
      ...current,
      {
        id: createLocalId('payment'),
        method,
        bank: method === 'pix' ? (pixAccounts[0]?.id ?? '') : '',
        amount: formatMoneyInput(suggestedAmount),
      },
    ]);
    setAnnouncement(
      receiptInvalidated
        ? `${method === 'pix' ? 'Pix' : 'Dinheiro'} adicionado. O comprovante anterior foi removido porque o pagamento mudou.`
        : `${method === 'pix' ? 'Pix' : 'Dinheiro'} adicionado aos pagamentos.`,
    );
  };

  const updatePayment = (id: string, patch: Partial<SalePayment>) => {
    const receiptInvalidated = receiptFiles.length > 0;
    setReceiptProgress('');
    setReceiptError('');
    if (receiptInvalidated) {
      setReceiptFiles([]);
      setReceiptProgress('');
      setReceiptError('');
    }
    setPayments((current) =>
      current.map((payment) =>
        payment.id === id ? { ...payment, ...patch } : payment,
      ),
    );
    if (receiptInvalidated) {
      setAnnouncement(
        'O comprovante anterior foi removido porque o pagamento mudou.',
      );
    }
  };

  const removePayment = (id: string) => {
    const receiptInvalidated = receiptFiles.length > 0;
    setReceiptProgress('');
    setReceiptError('');
    if (receiptInvalidated) {
      setReceiptFiles([]);
      setReceiptProgress('');
      setReceiptError('');
    }
    setPayments((current) => current.filter((payment) => payment.id !== id));
    setAnnouncement(
      receiptInvalidated
        ? 'Pagamento removido. O comprovante anterior também foi removido.'
        : 'Pagamento removido.',
    );
  };

  const goToReview = (skippedReceipt: boolean) => {
    if (skippedReceipt) {
      setReceiptFiles([]);
      setReceiptProgress('');
      setReceiptError('');
    }
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
          customers={customers}
          onNext={() => {
            setStep('serial');
            setAnnouncement('Etapa 2. Bipe o número de série do aparelho.');
          }}
          onQueryChange={(value) => {
            setCustomerQuery(value);
            if (customer && value.trim() !== customer) {
              setCustomer('');
              setCustomerId('');
            }
          }}
          onSelect={(selected) => {
            setCustomerId(selected.id);
            setCustomer(selected.name);
            setCustomerQuery(selected.name);
            setAnnouncement(`${selected.name} selecionado.`);
          }}
          query={customerQuery}
        />
      )}

      {step === 'serial' && (
        <SaleSerialStage
          candidate={pendingSerial}
          checking={checkingSerial}
          onAccepted={acceptSerial}
          onBack={() => setStep(items.length > 0 ? 'items' : 'customer')}
          onConfirm={() => {
            setStep('photo');
            setAnnouncement('Etapa 3. Fotografe o aparelho.');
          }}
          onRescan={() => {
            setPendingSerial(null);
            setPendingProduct(null);
            setPhotoFiles([]);
            setPhotoProgress('');
            setPhotoError('');
            setPrice('');
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
          onFiles={prepareItemPhotos}
          onNext={() => {
            setStep('price');
            setAnnouncement('Etapa 4. Informe o preço do aparelho.');
          }}
          photoBytes={sumFileBytes(photoFiles)}
          photoError={photoError}
          photoFiles={photoFiles}
          preparing={preparingPhotos}
          progressLabel={photoProgress}
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
          pixAccounts={pixAccounts}
          ready={paymentsValid}
          remaining={remaining}
          total={total}
        />
      )}

      {step === 'receipt' && (
        <ReceiptStage
          files={receiptFiles}
          onBack={() => setStep('payments')}
          onFiles={prepareReceipts}
          onNext={() => goToReview(false)}
          onSkip={() => goToReview(true)}
          preparing={preparingReceipts}
          progressLabel={receiptProgress}
          receiptBytes={sumFileBytes(receiptFiles)}
          receiptError={receiptError}
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
          onConfirm={async () => {
            if (!completionSentRef.current) {
              completionSentRef.current = true;
              setSaving(true);
              try {
                await onComplete?.({
                  customerId,
                  customer,
                  items: items.map((item) => ({
                    serial: item.serial.normalizedValue,
                    product: item.product,
                    detail: item.detail,
                    photos: item.photos,
                    defaultPriceCents: item.defaultPriceCents,
                    priceCents: item.priceCents,
                  })),
                  payments: payments.map((payment) => ({
                    method: payment.method === 'pix' ? 'Pix' : 'Dinheiro',
                    bank: payment.bank,
                    amountCents: parseMoneyInput(payment.amount),
                  })),
                  receipts: receiptFiles,
                  productsTotalCents: total,
                  receivedTotalCents: paid,
                  receivedDifferenceCents: paid - total,
                });
              } catch (error) {
                completionSentRef.current = false;
                setSaving(false);
                setAnnouncement(
                  error instanceof Error
                    ? error.message
                    : 'Não foi possível salvar a venda.',
                );
                return;
              }
            }
            setStep('done');
            setSaving(false);
            setAnnouncement(
              `Venda concluída com recebimento de ${formatMoney(paid)}.`,
            );
          }}
          paid={paid}
          payments={payments}
          receiptCount={receiptFiles.length}
          uploadBytes={sumFileBytes([
            ...items.flatMap((item) => item.photos),
            ...receiptFiles,
          ])}
          total={total}
          saving={saving}
        />
      )}

      {step === 'done' && (
        <SaleCompletion customer={customer} onReset={reset} total={paid} />
      )}
    </FlowFrame>
  );
}

function CustomerStage({
  customer,
  customers,
  query,
  onQueryChange,
  onSelect,
  onNext,
}: {
  customer: string;
  customers: SaleCustomer[];
  query: string;
  onQueryChange: (value: string) => void;
  onSelect: (customer: SaleCustomer) => void;
  onNext: () => void;
}) {
  const normalizedQuery = query.trim().toLocaleLowerCase('pt-BR');
  const canSearch = normalizedQuery.length >= 2;
  const allMatches = canSearch
    ? customers.filter((entry) =>
        entry.name.toLocaleLowerCase('pt-BR').includes(normalizedQuery),
      )
    : [];
  const matches = allMatches.slice(0, 4);
  return (
    <Card className={STAGE_CARD_CLASS}>
      <CardContent className="min-h-0 flex-1 overflow-hidden p-3 lg:p-5">
        <div className="mx-auto max-w-none lg:max-w-2xl">
          <div className="flow-stage-intro flex items-center gap-3">
            <span className="grid size-11 place-items-center rounded-2xl bg-secondary text-primary">
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

          <div className="relative mt-3 lg:mt-5">
            <Search className="absolute left-4 top-1/2 size-5 -translate-y-1/2 text-muted-foreground" />
            <Input
              aria-label="Pesquisar cliente"
              aria-describedby="customer-search-help"
              className="h-12 rounded-2xl pl-12 text-base lg:h-14"
              onChange={(event) => onQueryChange(event.target.value)}
              placeholder="Nome do cliente"
              value={query}
            />
          </div>
          <p className="sr-only" id="customer-search-help">
            A lista aparece somente depois da pesquisa.
          </p>

          {canSearch && !customer && (
            <div
              className="mt-3 grid grid-cols-1 gap-2 lg:mt-4 lg:grid-cols-2"
              aria-label="Clientes encontrados"
            >
              {matches.map((entry) => (
                <Button
                  aria-pressed={customer === entry.name}
                  className="h-14 min-w-0 justify-start rounded-xl px-4 text-base lg:h-12 lg:px-3 lg:text-sm"
                  key={entry.id}
                  onClick={() => onSelect(entry)}
                  variant={customer === entry.name ? 'secondary' : 'outline'}
                >
                  <UserRound className="hidden size-4 lg:block" />
                  <span className="truncate">{entry.name}</span>
                  {customer === entry.name && (
                    <Check className="ml-auto text-success" />
                  )}
                </Button>
              ))}

              {matches.length === 0 && (
                <div className="col-span-2 rounded-xl border border-dashed bg-muted/25 px-4 py-3 text-center text-sm text-muted-foreground">
                  Nenhum cliente cadastrado foi encontrado.
                </div>
              )}
              {allMatches.length > matches.length && (
                <p className="col-span-2 text-center text-xs text-muted-foreground">
                  Mais resultados disponíveis. Digite mais letras para refinar.
                </p>
              )}
            </div>
          )}

          {customer && (
            <div className="mt-3 flex items-center gap-2 rounded-xl bg-success/10 px-4 py-3 text-sm font-semibold text-success lg:mt-4">
              <Check className="size-4" /> {customer} selecionado
            </div>
          )}
        </div>
      </CardContent>
      <div className="flow-stage-actions shrink-0 border-t p-2.5 text-right lg:p-3">
        <Button
          className="h-14 w-full rounded-2xl text-base lg:h-12 lg:w-auto lg:min-w-56 lg:rounded-xl lg:text-sm"
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
  checking,
  product,
  warning,
  onAccepted,
  onBack,
  onConfirm,
  onRescan,
}: {
  candidate: ScanCandidate | null;
  checking: boolean;
  product: SaleProduct | null;
  warning: string;
  onAccepted: (candidate: ScanCandidate) => void;
  onBack: () => void;
  onConfirm: () => void;
  onRescan: () => void;
}) {
  if (checking) {
    return (
      <Card className={STAGE_CARD_CLASS}>
        <CardContent className="grid min-h-0 flex-1 place-items-center p-6 text-center">
          <div>
            <LoaderCircle className="mx-auto size-8 animate-spin text-primary" />
            <p className="mt-3 font-bold">Consultando o SN…</p>
            <p className="mt-1 text-sm text-muted-foreground">
              Confirmando a disponibilidade no estoque.
            </p>
          </div>
        </CardContent>
      </Card>
    );
  }
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
    <Card className={STAGE_CARD_CLASS}>
      <CardContent className="grid min-h-0 flex-1 place-items-center overflow-hidden p-4 text-center sm:p-6">
        <div className="max-w-md">
          <span className="flow-stage-icon mx-auto grid size-14 place-items-center rounded-2xl bg-success/10 text-success">
            <Smartphone className="size-7" />
          </span>
          <p className="eyebrow mt-3 sm:mt-5">Aparelho disponível</p>
          <h2 className="mt-1 text-xl font-bold">
            {product?.product ?? 'Produto não identificado'}
          </h2>
          {product ? (
            <ProductDetailVisual
              className="mt-1 justify-center"
              detail={product.detail}
            />
          ) : (
            <p className="text-sm text-muted-foreground">
              Confira o estoque antes de continuar
            </p>
          )}
          <p className="mx-auto mt-3 w-fit rounded-xl bg-muted px-4 py-2 font-mono text-sm font-bold sm:mt-4">
            SN {candidate.normalizedValue}
          </p>
        </div>
      </CardContent>
      <div className="grid shrink-0 grid-cols-2 gap-2 border-t p-2.5 sm:p-3">
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
  photoFiles,
  photoBytes,
  photoError,
  preparing,
  progressLabel,
  onFiles,
  onBack,
  onNext,
}: {
  candidate: ScanCandidate;
  photoFiles: File[];
  photoBytes: number;
  photoError: string;
  preparing: boolean;
  progressLabel: string;
  onFiles: (files: File[]) => void;
  onBack: () => void;
  onNext: () => void;
}) {
  return (
    <Card className={STAGE_CARD_CLASS}>
      <CardContent className="flex min-h-0 flex-1 flex-col items-center justify-center overflow-hidden p-3 text-center sm:p-6">
        <Badge variant="secondary">SN {candidate.normalizedValue}</Badge>
        <label className="flow-upload-panel mt-3 flex w-full max-w-xl cursor-pointer flex-col items-center rounded-2xl border-2 border-dashed bg-muted/30 p-4 transition hover:bg-muted/55 sm:mt-4 sm:rounded-3xl sm:p-6">
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
              : 'Fotografar aparelho'}
          </span>
          <span className="flow-stage-support mt-1 text-sm text-muted-foreground">
            {preparing
              ? 'Reduzindo o tamanho sem comprometer a leitura.'
              : 'A foto ficará vinculada a este SN.'}
          </span>
          {photoFiles.length > 0 && (
            <span className="mt-2 inline-flex items-center gap-2 rounded-full bg-success/10 px-4 py-2 text-sm font-semibold text-success sm:mt-3">
              <Check className="size-4" /> {photoFiles.length}{' '}
              {photoFiles.length === 1 ? 'foto pronta' : 'fotos prontas'} ·{' '}
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
          disabled={photoFiles.length === 0 || preparing}
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
  const priceCents = parseMoneyInput(value);
  const valid = priceCents > 0;
  const hasDefaultPrice = product.defaultPriceCents > 0;
  const difference = hasDefaultPrice
    ? priceCents - product.defaultPriceCents
    : 0;
  const hasDifference = valid && difference !== 0;
  return (
    <Card className={STAGE_CARD_CLASS}>
      <CardContent className="grid min-h-0 flex-1 place-items-center overflow-hidden p-4 sm:p-6">
        <div className="w-full max-w-lg">
          <div className="flex items-center gap-3 rounded-xl border bg-background p-3 sm:rounded-2xl sm:p-4">
            <span className="grid size-12 shrink-0 place-items-center rounded-xl bg-secondary text-primary">
              <Smartphone className="size-6" />
            </span>
            <div className="min-w-0">
              <p className="truncate font-bold">{product.product}</p>
              <ProductDetailVisual detail={product.detail} />
              <p className="truncate text-sm text-muted-foreground">
                SN {candidate.normalizedValue}
              </p>
            </div>
          </div>
          <label
            className="mt-3 block text-sm font-semibold sm:mt-5"
            htmlFor="sale-price"
          >
            Preço unitário
          </label>
          <div className="relative mt-2">
            <span className="absolute left-4 top-1/2 -translate-y-1/2 text-base font-bold text-muted-foreground">
              R$
            </span>
            <Input
              aria-describedby="sale-price-guidance"
              className="h-14 pl-12 text-right text-2xl font-extrabold sm:h-16"
              id="sale-price"
              inputMode="decimal"
              onChange={(event) => onChange(event.target.value)}
              value={value}
            />
          </div>
          <div
            className={`mt-3 rounded-xl border px-3 py-2 text-sm ${hasDifference ? 'border-amber-500/35 bg-amber-50 text-amber-950 dark:bg-amber-500/10 dark:text-amber-100' : 'border-border bg-muted/50 text-foreground'}`}
            id="sale-price-guidance"
            role="note"
          >
            <p className="font-bold">
              {hasDifference
                ? `Atenção: ${formatPriceDifference(difference)} do preço padrão`
                : hasDefaultPrice
                  ? `Preço padrão: ${formatMoney(product.defaultPriceCents)}`
                  : 'Preço padrão ainda não configurado'}
            </p>
            <p className="flow-stage-support mt-0.5 text-xs">
              {hasDifference
                ? 'A venda será permitida e ficará sinalizada no histórico. O pagamento usará o valor digitado.'
                : 'Você pode alterar este valor. Se houver diferença, a venda será permitida e ficará sinalizada.'}
            </p>
          </div>
        </div>
      </CardContent>
      <div className="grid shrink-0 grid-cols-2 gap-2 border-t p-2.5 sm:p-3">
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
  const pageSize = 2;
  const [page, setPage] = useState(() =>
    Math.max(0, Math.ceil(items.length / pageSize) - 1),
  );
  const pageCount = Math.max(1, Math.ceil(items.length / pageSize));
  const safePage = Math.min(page, pageCount - 1);
  const visibleItems = items.slice(
    safePage * pageSize,
    safePage * pageSize + pageSize,
  );
  const priceDifference = getItemsPriceDifference(items);

  return (
    <Card className={STAGE_CARD_CLASS}>
      <CardContent className="min-h-0 flex-1 overflow-hidden p-3 sm:p-4">
        <div className="mx-auto max-w-2xl">
          <div
            className={`rounded-2xl border p-3 sm:p-4 ${priceDifference !== 0 ? 'border-amber-500/35 bg-amber-50 text-amber-950 dark:bg-amber-500/10 dark:text-amber-100' : 'bg-secondary'}`}
            role="note"
          >
            <div className="flex items-center justify-between gap-3">
              <div>
                <p className="font-bold">
                  {priceDifference !== 0
                    ? `Atenção: venda ${formatPriceDifference(priceDifference)} dos preços cadastrados`
                    : 'Aparelhos desta venda'}
                </p>
                <p
                  className={`flow-stage-support mt-1 text-sm ${priceDifference === 0 ? 'text-muted-foreground' : ''}`}
                >
                  {priceDifference !== 0
                    ? 'A diferença é permitida. O pagamento usará o valor praticado.'
                    : 'Cada SN é um aparelho. O pagamento será do total da venda.'}
                </p>
              </div>
              <Badge className="shrink-0" variant="secondary">
                {items.length} {items.length === 1 ? 'item' : 'itens'}
              </Badge>
            </div>
          </div>

          <ul className="mt-3 space-y-2" aria-label="Aparelhos da venda">
            {visibleItems.map((item) => (
              <li
                className="flex items-center gap-2 rounded-xl border bg-background p-2 sm:gap-3 sm:p-3"
                key={item.serial.normalizedValue}
              >
                <span className="hidden size-10 shrink-0 place-items-center rounded-xl bg-secondary text-primary sm:grid">
                  <Smartphone className="size-5" />
                </span>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-bold">{item.product}</p>
                  <ProductDetailVisual detail={item.detail} />
                  <p className="truncate font-mono text-xs text-muted-foreground">
                    SN {item.serial.normalizedValue}
                  </p>
                </div>
                <div className="shrink-0 text-right">
                  <p className="text-[11px] font-semibold text-muted-foreground">
                    Praticado
                  </p>
                  <strong className="block text-sm">
                    {formatMoney(item.priceCents)}
                  </strong>
                  <p
                    className={`flow-stage-support text-[11px] ${item.defaultPriceCents > 0 && item.priceCents !== item.defaultPriceCents ? 'font-semibold text-amber-800 dark:text-amber-200' : 'text-muted-foreground'}`}
                  >
                    {getItemPriceReference(item)}
                  </p>
                </div>
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

          {pageCount > 1 && (
            <div
              aria-live="polite"
              className="mt-2 flex items-center justify-center gap-3"
            >
              <Button
                aria-label="Aparelhos anteriores"
                className="size-9"
                disabled={safePage === 0}
                onClick={() => setPage(Math.max(0, safePage - 1))}
                size="icon"
                variant="ghost"
              >
                <ChevronLeft />
              </Button>
              <span className="text-xs font-semibold text-muted-foreground">
                {safePage + 1} de {pageCount}
              </span>
              <Button
                aria-label="Próximos aparelhos"
                className="size-9"
                disabled={safePage >= pageCount - 1}
                onClick={() => setPage(Math.min(pageCount - 1, safePage + 1))}
                size="icon"
                variant="ghost"
              >
                <ChevronRight />
              </Button>
            </div>
          )}

          <div className="mt-3 flex items-center justify-between rounded-xl bg-muted p-3 sm:rounded-2xl sm:p-4">
            <span className="font-semibold">Total da venda</span>
            <strong className="text-lg">{formatMoney(total)}</strong>
          </div>
        </div>
      </CardContent>
      <div className="grid shrink-0 grid-cols-2 gap-2 border-t p-2.5 sm:p-3">
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
  pixAccounts,
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
  pixAccounts: SalePixAccount[];
  ready: boolean;
  onAdd: (method: PaymentMethod) => void;
  onUpdate: (id: string, patch: Partial<SalePayment>) => void;
  onRemove: (id: string) => void;
  onBack: () => void;
  onNext: () => void;
}) {
  const [showTypePicker, setShowTypePicker] = useState(false);
  const [activePaymentIndex, setActivePaymentIndex] = useState(0);
  const safePaymentIndex = Math.min(
    activePaymentIndex,
    Math.max(0, payments.length - 1),
  );
  const activePayment = payments[safePaymentIndex];

  return (
    <Card className={STAGE_CARD_CLASS}>
      <CardContent className="min-h-0 flex-1 overflow-hidden p-3 sm:p-4">
        <div className="mx-auto max-w-2xl space-y-2">
          <div className="payment-stage-summary rounded-xl bg-secondary px-3 py-2.5 sm:rounded-2xl sm:px-4 sm:py-3">
            <p className="font-bold">Pagamento da venda inteira</p>
            <p className="flow-stage-support mt-1 text-sm text-muted-foreground">
              As formas de pagamento cobrem{' '}
              {itemCount === 1
                ? 'o total do aparelho'
                : `o total dos ${itemCount} aparelhos`}{' '}
              desta venda.
            </p>
          </div>

          {payments.length === 0 && (
            <div className="rounded-xl border border-dashed bg-muted/25 p-3 text-center">
              <p className="font-bold">Nenhum pagamento adicionado</p>
              <p className="flow-stage-support mt-1 text-sm text-muted-foreground">
                Dinheiro só aparecerá se você escolher essa opção.
              </p>
            </div>
          )}

          {activePayment && (
            <div className="rounded-xl border bg-background p-3">
              <div className="flex items-center justify-between gap-3">
                <div className="flex items-center gap-2 font-bold">
                  {activePayment.method === 'pix' ? (
                    <WalletCards className="size-5 text-primary" />
                  ) : (
                    <Banknote className="size-5 text-primary" />
                  )}
                  {activePayment.method === 'pix' ? 'Pix' : 'Dinheiro'}
                  {payments.length > 1 && (
                    <span className="text-xs font-semibold text-muted-foreground">
                      {safePaymentIndex + 1} de {payments.length}
                    </span>
                  )}
                </div>
                <div className="flex items-center gap-1">
                  {payments.length > 1 && (
                    <>
                      <Button
                        aria-label="Pagamento anterior"
                        className="size-9"
                        disabled={safePaymentIndex === 0}
                        onClick={() =>
                          setActivePaymentIndex((current) =>
                            Math.max(0, current - 1),
                          )
                        }
                        size="icon"
                        variant="ghost"
                      >
                        <ChevronLeft />
                      </Button>
                      <Button
                        aria-label="Próximo pagamento"
                        className="size-9"
                        disabled={safePaymentIndex >= payments.length - 1}
                        onClick={() =>
                          setActivePaymentIndex((current) =>
                            Math.min(payments.length - 1, current + 1),
                          )
                        }
                        size="icon"
                        variant="ghost"
                      >
                        <ChevronRight />
                      </Button>
                    </>
                  )}
                  <Button
                    aria-label={`Remover pagamento ${safePaymentIndex + 1}`}
                    className="size-9"
                    onClick={() => {
                      onRemove(activePayment.id);
                      setActivePaymentIndex((current) =>
                        Math.max(0, current - 1),
                      );
                    }}
                    size="icon"
                    variant="ghost"
                  >
                    <Trash2 />
                  </Button>
                </div>
              </div>

              <div
                className={`mt-2 grid gap-2 ${activePayment.method === 'pix' ? 'grid-cols-2' : ''}`}
              >
                {activePayment.method === 'pix' && (
                  <div>
                    <label
                      className="text-sm font-semibold"
                      htmlFor={`bank-${activePayment.id}`}
                    >
                      Conta Pix
                    </label>
                    <NativeSelect
                      className="mt-1 h-11 w-full [&_select]:h-11"
                      id={`bank-${activePayment.id}`}
                      onChange={(event) =>
                        onUpdate(activePayment.id, {
                          bank: event.target.value,
                        })
                      }
                      value={activePayment.bank}
                    >
                      {pixAccounts.length === 0 && (
                        <NativeSelectOption value="">
                          Cadastre uma conta Pix
                        </NativeSelectOption>
                      )}
                      {pixAccounts.map((account) => (
                        <NativeSelectOption key={account.id} value={account.id}>
                          {account.name}
                        </NativeSelectOption>
                      ))}
                    </NativeSelect>
                  </div>
                )}
                <div>
                  <label
                    className="text-sm font-semibold"
                    htmlFor={`amount-${activePayment.id}`}
                  >
                    Valor
                  </label>
                  <Input
                    className="mt-1 h-11 text-right text-base font-bold"
                    id={`amount-${activePayment.id}`}
                    inputMode="decimal"
                    onChange={(event) =>
                      onUpdate(activePayment.id, {
                        amount: event.target.value,
                      })
                    }
                    value={activePayment.amount}
                  />
                </div>
              </div>
            </div>
          )}

          {!showTypePicker && (
            <Button
              className="h-11 w-full rounded-xl border-dashed"
              onClick={() => setShowTypePicker(true)}
              variant="outline"
            >
              <Plus /> Adicionar pagamento
            </Button>
          )}

          {showTypePicker && (
            <div className="grid grid-cols-[1fr_1fr_auto] gap-2 rounded-xl bg-muted p-2">
              <Button
                className="h-12 rounded-xl"
                onClick={() => {
                  setActivePaymentIndex(payments.length);
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
                  setActivePaymentIndex(payments.length);
                  onAdd('cash');
                  setShowTypePicker(false);
                }}
                variant="outline"
              >
                <Banknote /> Dinheiro
              </Button>
              <Button
                aria-label="Cancelar novo pagamento"
                className="size-11"
                onClick={() => setShowTypePicker(false)}
                size="icon"
                variant="ghost"
              >
                <X />
              </Button>
            </div>
          )}

          <div className="payment-stage-totals rounded-xl bg-muted p-3">
            <div className="flex justify-between text-sm">
              <span className="text-muted-foreground">Total da venda</span>
              <strong>{formatMoney(total)}</strong>
            </div>
            <div className="mt-1 flex justify-between text-sm">
              <span className="text-muted-foreground">Informado</span>
              <strong>{formatMoney(paid)}</strong>
            </div>
            <div className="mt-2 flex justify-between border-t pt-2">
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
          {remaining !== 0 && paid > 0 && (
            <div
              className="payment-stage-warning rounded-xl border border-amber-500/35 bg-amber-50 px-3 py-2 text-sm text-amber-950 dark:bg-amber-500/10 dark:text-amber-100"
              role="alert"
            >
              <p className="font-bold">
                Recebimento {remaining < 0 ? 'acima' : 'abaixo'} dos produtos
              </p>
              <p className="mt-0.5 text-xs">
                Diferença de {formatMoney(Math.abs(remaining))}. A venda pode
                ser concluída e ficará sinalizada em Vendas e nos relatórios.
              </p>
            </div>
          )}
        </div>
      </CardContent>
      <div className="grid shrink-0 grid-cols-2 gap-2 border-t p-2.5 sm:p-3">
        <Button className="h-12 rounded-xl" onClick={onBack} variant="outline">
          <ArrowLeft /> Voltar
        </Button>
        <Button className="h-12 rounded-xl" disabled={!ready} onClick={onNext}>
          {remaining !== 0 && paid > 0 ? 'Continuar com aviso' : 'Comprovante'}{' '}
          <ArrowRight className="hidden sm:block" />
        </Button>
      </div>
    </Card>
  );
}

function ReceiptStage({
  files,
  preparing,
  progressLabel,
  receiptBytes,
  receiptError,
  onFiles,
  onBack,
  onSkip,
  onNext,
}: {
  files: File[];
  preparing: boolean;
  progressLabel: string;
  receiptBytes: number;
  receiptError: string;
  onFiles: (files: File[]) => void;
  onBack: () => void;
  onSkip: () => void;
  onNext: () => void;
}) {
  return (
    <Card className={STAGE_CARD_CLASS}>
      <CardContent className="flex min-h-0 flex-1 flex-col items-center justify-center overflow-hidden p-3 text-center sm:p-6">
        <Badge variant="secondary">Comprovante opcional</Badge>
        {preparing && (
          <p
            aria-live="polite"
            className="mt-3 flex items-center gap-2 text-sm font-semibold text-primary"
          >
            <LoaderCircle className="size-4 animate-spin" />
            {progressLabel || 'Preparando comprovantes…'}
          </p>
        )}
        <div className="mt-3 grid w-full max-w-xl grid-cols-2 gap-2 sm:mt-4 sm:gap-3">
          <label
            className={`flow-receipt-option flex min-h-28 cursor-pointer flex-col items-center justify-center rounded-2xl border-2 border-dashed bg-muted/30 p-3 transition hover:bg-muted/55 sm:min-h-36 sm:rounded-3xl sm:p-5 ${preparing ? 'pointer-events-none opacity-60' : ''}`}
          >
            <span className="grid size-12 place-items-center rounded-2xl bg-card text-primary shadow-sm">
              <Camera className="size-6" />
            </span>
            <span className="mt-2 font-bold">Tirar foto</span>
            <span className="flow-stage-support mt-1 text-xs text-muted-foreground">
              Abrir a câmera
            </span>
            <input
              accept="image/*"
              capture="environment"
              className="sr-only"
              disabled={preparing}
              onChange={(event) => {
                const selectedFiles = Array.from(event.target.files ?? []);
                if (selectedFiles.length > 0) onFiles(selectedFiles);
                event.currentTarget.value = '';
              }}
              type="file"
            />
          </label>

          <label
            className={`flow-receipt-option flex min-h-28 cursor-pointer flex-col items-center justify-center rounded-2xl border-2 border-dashed bg-muted/30 p-3 transition hover:bg-muted/55 sm:min-h-36 sm:rounded-3xl sm:p-5 ${preparing ? 'pointer-events-none opacity-60' : ''}`}
          >
            <span className="grid size-12 place-items-center rounded-2xl bg-card text-primary shadow-sm">
              <Paperclip className="size-6" />
            </span>
            <span className="mt-2 font-bold">Anexar arquivo</span>
            <span className="flow-stage-support mt-1 text-xs text-muted-foreground">
              Foto ou PDF
            </span>
            <input
              accept="image/*,application/pdf"
              className="sr-only"
              disabled={preparing}
              multiple
              onChange={(event) => {
                const selectedFiles = Array.from(event.target.files ?? []);
                if (selectedFiles.length > 0) onFiles(selectedFiles);
                event.currentTarget.value = '';
              }}
              type="file"
            />
          </label>
        </div>

        {files.length > 0 && (
          <div className="mt-2 flex max-w-xl items-center gap-2 rounded-full bg-success/10 px-4 py-2 text-sm font-semibold text-success sm:mt-4">
            <FileCheck2 className="size-4 shrink-0" />
            <span className="truncate">
              {files.length === 1
                ? `${files[0].name} · ${formatMediaBytes(receiptBytes)}`
                : `${files.length} comprovantes · ${formatMediaBytes(receiptBytes)}`}
            </span>
          </div>
        )}
        {receiptError && (
          <p
            className="mt-2 w-full max-w-xl rounded-xl border border-destructive/25 bg-destructive/10 px-3 py-2 text-sm font-semibold text-destructive"
            role="alert"
          >
            {receiptError}
          </p>
        )}
      </CardContent>
      <div className="grid shrink-0 grid-cols-[auto_1fr] gap-2 border-t p-2.5 sm:p-3">
        <Button
          aria-label="Voltar"
          className="h-12 rounded-xl"
          disabled={preparing}
          onClick={onBack}
          variant="outline"
        >
          <ArrowLeft />
        </Button>
        {files.length === 0 ? (
          <Button
            className="h-12 rounded-xl"
            disabled={preparing}
            onClick={onSkip}
          >
            Pular comprovante <ArrowRight />
          </Button>
        ) : (
          <Button
            className="h-12 rounded-xl"
            disabled={preparing}
            onClick={onNext}
          >
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
  uploadBytes,
  total,
  paid,
  onBack,
  onEditItems,
  onConfirm,
  saving,
}: {
  customer: string;
  items: SaleItem[];
  payments: SalePayment[];
  receiptCount: number;
  uploadBytes: number;
  total: number;
  paid: number;
  onBack: () => void;
  onEditItems: () => void;
  onConfirm: () => void;
  saving: boolean;
}) {
  const priceDifference = getItemsPriceDifference(items);
  return (
    <Card className={STAGE_CARD_CLASS}>
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
              label="Recebido"
              value={formatMoney(paid)}
              icon={WalletCards}
            />
          </div>

          {priceDifference !== 0 && (
            <div
              className="mt-4 rounded-xl border border-amber-500/35 bg-amber-50 px-3 py-2 text-sm text-amber-950 dark:bg-amber-500/10 dark:text-amber-100"
              role="alert"
            >
              <p className="font-bold">
                Venda {formatPriceDifference(priceDifference)} dos preços
                cadastrados
              </p>
              <p className="mt-0.5 text-xs">
                A diferença não bloqueia a conclusão. Os pagamentos usam o total
                praticado de {formatMoney(total)}.
              </p>
            </div>
          )}

          {paid !== total && (
            <div
              className="mt-4 rounded-xl border border-amber-500/35 bg-amber-50 px-3 py-2 text-sm text-amber-950 dark:bg-amber-500/10 dark:text-amber-100"
              role="alert"
            >
              <p className="font-bold">
                Recebido {paid > total ? 'acima' : 'abaixo'} do total dos
                produtos
              </p>
              <p className="mt-0.5 text-xs">
                Produtos: {formatMoney(total)} · Recebido: {formatMoney(paid)} ·
                Diferença: {formatMoney(Math.abs(paid - total))}. A venda será
                salva com este aviso.
              </p>
            </div>
          )}

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
                    <ProductDetailVisual detail={item.detail} />
                    <p className="truncate font-mono text-xs text-muted-foreground">
                      SN {item.serial.normalizedValue} · {item.photos.length}{' '}
                      {item.photos.length === 1 ? 'foto' : 'fotos'}
                    </p>
                  </div>
                  <div className="shrink-0 text-right">
                    <p className="text-xs font-semibold text-muted-foreground">
                      Praticado
                    </p>
                    <strong className="block text-sm">
                      {formatMoney(item.priceCents)}
                    </strong>
                    <p
                      className={`text-xs ${item.defaultPriceCents > 0 && item.priceCents !== item.defaultPriceCents ? 'font-semibold text-amber-800 dark:text-amber-200' : 'text-muted-foreground'}`}
                    >
                      {getItemPriceReference(item)}
                    </p>
                  </div>
                </div>
              ))}
            </div>
            <Button
              className="mt-3 h-11 w-full rounded-xl border-dashed"
              disabled={saving}
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
      <div className="grid shrink-0 grid-cols-2 gap-2 border-t p-2.5 sm:p-3">
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
                Enviando {formatMediaBytes(uploadBytes)} e salvando…
              </span>
            </>
          ) : (
            <>
              <Check /> Finalizar venda
            </>
          )}
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

function ProductDetailVisual({
  detail,
  className = '',
}: {
  detail: string;
  className?: string;
}) {
  const [colorPart, ...memoryParts] = detail.split('·');
  const color = colorPart?.trim() || detail;
  const memory = memoryParts.join('·').trim();
  return (
    <span
      className={`flow-stage-support flex min-w-0 items-center gap-1.5 text-xs text-muted-foreground ${className}`}
    >
      <ProductColorSwatch color={color} />
      <span className="truncate">{color}</span>
      {memory && (
        <Badge
          className="shrink-0 px-1.5 py-0 font-extrabold"
          variant="secondary"
        >
          {memory}
        </Badge>
      )}
    </span>
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
    <Card className="flow-stage-card grid h-full place-items-center gap-0 overflow-hidden py-0">
      <CardContent className="max-w-lg p-6 text-center sm:p-10">
        <span className="mx-auto grid size-20 place-items-center rounded-full bg-success/10 text-success">
          <CheckCircle2 className="size-10" />
        </span>
        <h2 className="mt-5 text-2xl font-bold tracking-tight">
          Venda concluída
        </h2>
        <p className="mt-2 text-sm leading-6 text-muted-foreground">
          Cliente {customer} · total de {formatMoney(total)}.
        </p>
        <p className="mt-3 rounded-xl bg-success/10 px-4 py-3 text-sm font-semibold text-success">
          A venda foi salva, os pagamentos foram registrados e o estoque foi
          atualizado.
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

function mediaReadyAnnouncement(
  result: PreparedMediaSelection,
  singular: string,
  plural: string,
) {
  const duplicates = result.duplicateCount
    ? ` ${result.duplicateCount} ${result.duplicateCount === 1 ? 'arquivo repetido foi ignorado' : 'arquivos repetidos foram ignorados'}.`
    : '';
  if (result.addedCount === 0) {
    return `Nenhum arquivo novo foi adicionado.${duplicates}`;
  }
  const optimized = result.optimizedCount
    ? ` ${result.optimizedCount} ${result.optimizedCount === 1 ? 'foi otimizado' : 'foram otimizados'}, economizando ${formatMediaBytes(result.bytesSaved)}.`
    : '';
  const readyLabel =
    singular === 'foto'
      ? result.addedCount === 1
        ? 'foto pronta'
        : 'fotos prontas'
      : result.addedCount === 1
        ? `${singular} pronto`
        : `${plural} prontos`;
  return `${result.addedCount} ${readyLabel}.${optimized}${duplicates}`;
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

function getDefaultPriceInput(product: SaleProduct | null | undefined) {
  if (!product || product.defaultPriceCents <= 0) return '';
  return formatMoneyInput(product.defaultPriceCents);
}

function getItemsPriceDifference(items: SaleItem[]) {
  return items.reduce(
    (sum, item) =>
      sum +
      (item.defaultPriceCents > 0
        ? item.priceCents - item.defaultPriceCents
        : 0),
    0,
  );
}

function getItemPriceReference(item: SaleItem) {
  if (item.defaultPriceCents <= 0) return 'Sem preço padrão';
  const difference = item.priceCents - item.defaultPriceCents;
  return difference === 0
    ? 'Igual ao preço padrão'
    : `${formatPriceDifference(difference)} do padrão`;
}

function formatPriceDifference(difference: number) {
  return `${formatMoney(Math.abs(difference))} ${difference < 0 ? 'abaixo' : 'acima'}`;
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
