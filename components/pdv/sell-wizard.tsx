'use client';
import { useAppBackHandler } from '@/components/pdv/use-app-back';
import { saleBackStep } from '@/lib/app-back';

import { useEffect, useMemo, useRef, useState } from 'react';
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
} from 'lucide-react';

import {
  BarcodeScanner,
  type ScanFeedback,
} from '@/components/pdv/barcode-scanner';
import { FlowFrame } from '@/components/pdv/flow-frame';
import { ProductColorSwatch } from '@/components/pdv/product-color-swatch';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  formatMediaBytes,
  MEDIA_LIMITS,
  prepareMediaSelection,
  sumFileBytes,
  type PreparedMediaSelection,
} from '@/lib/client-media';
import { createOperationId } from '@/lib/client-operation-id';
import {
  PendingOperationError,
  type RecoveryScope,
} from '@/lib/client-operation-recovery';
import { useRecoverableDraft } from '@/components/pdv/use-recoverable-draft';
import { parseMoneyInput } from '@/lib/money';
import { ReceiptReconciliationEditor } from '@/components/pdv/receipt-reconciliation-editor';
import {
  deriveReceiptReconciliation,
  receiptTargetLabel,
  type ReceiptValueInput,
} from '@/lib/receipt-reconciliation';
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

export type SaleCustomer = { id: string; name: string; phone?: string | null };
export type SalePixAccount = { id: string; name: string };
type SaleSeller = { id: string; displayName: string };

type PaymentMethod = 'pix' | 'cash';

type SalePayment = {
  id: string;
  method: PaymentMethod;
  bank: string;
  amount: string;
};

export type CompletedSalePayload = {
  operationId: string;
  customerId: string;
  customer: string;
  sellerUserId?: string;
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
  receiptValues: ReceiptValueInput[];
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
  sellers = [],
  defaultSellerId = '',
  onComplete,
  onCreateCustomer,
  unavailableSerials,
  resolveSerials,
  recoveryScope,
}: {
  recoveryScope?: RecoveryScope;
  stagedSerial?: string;
  productsBySerial?: SaleProductLookup;
  customers?: SaleCustomer[];
  pixAccounts?: SalePixAccount[];
  sellers?: SaleSeller[];
  defaultSellerId?: string;
  onComplete?: (sale: CompletedSalePayload) => void | Promise<void>;
  onCreateCustomer?: (input: {
    operationId: string;
    name: string;
    phone: string;
  }) => Promise<SaleCustomer>;
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
  const [sellerUserId, setSellerUserId] = useState(defaultSellerId);
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
  const [receiptValues, setReceiptValues] = useState<ReceiptValueInput[]>([]);
  const [preparingPhotos, setPreparingPhotos] = useState(false);
  const [photoProgress, setPhotoProgress] = useState('');
  const [photoError, setPhotoError] = useState('');
  const [preparingReceipts, setPreparingReceipts] = useState(false);
  const [receiptProgress, setReceiptProgress] = useState('');
  const [receiptError, setReceiptError] = useState('');
  const [saving, setSaving] = useState(false);
  const [submitError, setSubmitError] = useState('');
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
  const operationIdRef = useRef(createOperationId());
  const checkingSerialRef = useRef(false);
  const serialLookupGenerationRef = useRef(0);
  const goBack = () => {
    if (saving || preparingPhotos || preparingReceipts) return true;
    const previous = saleBackStep(step, items.length > 0);
    if (!previous) return false;
    serialLookupGenerationRef.current += 1;
    checkingSerialRef.current = false;
    setCheckingSerial(false);
    setStep(previous);
    setAnnouncement(
      previous === 'items'
        ? 'Revise os aparelhos ou siga novamente para o pagamento.'
        : 'Etapa anterior. Os dados preenchidos foram mantidos.',
    );
    return true;
  };
  useAppBackHandler(goBack, true, 10);
  const draftValue = useMemo(
    () => ({
      step,
      customerId,
      customer,
      customerQuery,
      sellerUserId,
      pendingSerial,
      pendingProduct,
      photoFiles,
      price,
      items,
      payments,
      receiptFiles,
      receiptValues,
    }),
    [
      step,
      customerId,
      customer,
      customerQuery,
      sellerUserId,
      pendingSerial,
      pendingProduct,
      photoFiles,
      price,
      items,
      payments,
      receiptFiles,
      receiptValues,
    ],
  );
  const draft = useRecoverableDraft({
    scope: recoveryScope,
    kind: 'sale',
    operationId: operationIdRef,
    value: draftValue,
    empty: !customerId && !customerQuery && !items.length,
    done: step === 'done',
    restore: (value) => {
      setStep(value.step);
      setCustomerId(value.customerId);
      setCustomer(value.customer);
      setCustomerQuery(value.customerQuery);
      setSellerUserId(value.sellerUserId ?? defaultSellerId);
      setPendingSerial(value.pendingSerial);
      setPendingProduct(value.pendingProduct);
      setPhotoFiles(value.photoFiles);
      setPrice(value.price);
      setItems(value.items);
      itemsRef.current = value.items;
      setPayments(
        value.payments.filter((payment) => payment.method === 'cash'),
      );
      setReceiptFiles(value.receiptFiles);
      setReceiptValues(value.receiptValues);
      setAnnouncement(
        'Rascunho recuperado. O Pix agora vem somente dos comprovantes; confira os anexos e o dinheiro recebido.',
      );
    },
    confirmed: () => {
      setStep('done');
      setSaving(false);
      setSubmitError('');
      completionSentRef.current = true;
    },
  });

  useEffect(
    () => () => {
      serialLookupGenerationRef.current += 1;
      checkingSerialRef.current = false;
    },
    [],
  );

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
  const paymentsValid = payments.every(
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
      return 'Informe somente o dinheiro recebido. O Pix virá do comprovante.';
    if (step === 'receipt') return 'Anexe o comprovante ou pule esta etapa.';
    if (step === 'review')
      return 'Confira a venda completa antes de finalizar.';
    return 'Venda preparada com sucesso.';
  }, [step]);

  const reset = () => {
    serialLookupGenerationRef.current += 1;
    checkingSerialRef.current = false;
    setCheckingSerial(false);
    setStep('customer');
    setCustomerId('');
    setCustomer('');
    setCustomerQuery('');
    setSellerUserId(defaultSellerId);
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
    setReceiptValues([]);
    setPreparingReceipts(false);
    setReceiptProgress('');
    setReceiptError('');
    setSaving(false);
    setSubmitError('');
    setSerialWarning('');
    completionSentRef.current = false;
    operationIdRef.current = createOperationId();
    setAnnouncement('Nova venda. Pesquise o cliente para começar.');
  };

  const clearCheckout = () => {
    const hadCheckout = payments.length > 0 || receiptFiles.length > 0;
    setPayments([]);
    setReceiptFiles([]);
    setReceiptValues([]);
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
        maxDimension: 1_920,
        quality: 0.8,
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
      setReceiptValues((current) =>
        result.files.map(
          (_, index) => current[index] ?? { amountCents: null, source: null },
        ),
      );
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

  const acceptSerial = async (
    candidate: ScanCandidate,
  ): Promise<ScanFeedback> => {
    if (checkingSerialRef.current) return 'silent';
    const lookupGeneration = serialLookupGenerationRef.current;
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
      return 'error';
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
        if (lookupGeneration !== serialLookupGenerationRef.current) {
          return 'silent';
        }
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
        if (lookupGeneration !== serialLookupGenerationRef.current) {
          return 'silent';
        }
        setSerialWarning(
          'Não foi possível consultar este SN agora. Confira a conexão e tente novamente.',
        );
        return 'error';
      } finally {
        if (lookupGeneration === serialLookupGenerationRef.current) {
          checkingSerialRef.current = false;
          setCheckingSerial(false);
        }
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
      return 'error';
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
      return 'error';
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
    return 'success';
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
    setReceiptProgress('');
    setReceiptError('');
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
      `${method === 'pix' ? 'Pix' : 'Dinheiro'} adicionado aos pagamentos.`,
    );
  };

  const updatePayment = (id: string, patch: Partial<SalePayment>) => {
    setReceiptProgress('');
    setReceiptError('');
    setPayments((current) =>
      current.map((payment) =>
        payment.id === id ? { ...payment, ...patch } : payment,
      ),
    );
  };

  const removePayment = (id: string) => {
    setReceiptProgress('');
    setReceiptError('');
    setPayments((current) => current.filter((payment) => payment.id !== id));
    setAnnouncement('Pagamento removido.');
  };

  const goToReview = (skippedReceipt: boolean) => {
    if (skippedReceipt) {
      setReceiptFiles([]);
      setReceiptValues([]);
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
      </div>
    );
  if (draft.waiting)
    return (
      <div className="m-4 rounded-2xl border bg-card p-5">
        <h2 className="font-bold">Venda aguardando confirmação</h2>
        <p className="my-3 text-sm">
          O envio está guardado neste aparelho. Não faça outra venda com os
          mesmos aparelhos.
        </p>
        <Button
          onClick={() => window.dispatchEvent(new Event('pdv:show-operations'))}
        >
          Acompanhar envio
        </Button>
      </div>
    );
  return (
    <FlowFrame
      announcement={announcement}
      currentStep={STEP_INDEX[step]}
      description={
        step !== 'done' && draft.label
          ? `${description} ${draft.label}.`
          : description
      }
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
          onCreateCustomer={onCreateCustomer}
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
          onBack={goBack}
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
          onBack={goBack}
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
          onBack={goBack}
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
            setAnnouncement('Etapa 6. Informe o dinheiro recebido, se houver.');
          }}
          onRemove={removeItem}
          total={total}
        />
      )}

      {step === 'payments' && (
        <PaymentStage
          itemCount={items.length}
          onAdd={addPayment}
          onBack={goBack}
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
          cashCents={paid}
          files={receiptFiles}
          onBack={goBack}
          onClear={() => {
            setReceiptFiles([]);
            setReceiptValues([]);
            setReceiptProgress('');
            setReceiptError('');
            setAnnouncement('Comprovantes removidos.');
          }}
          onFiles={prepareReceipts}
          onNext={() => goToReview(false)}
          onSkip={() => goToReview(true)}
          preparing={preparingReceipts}
          progressLabel={receiptProgress}
          receiptBytes={sumFileBytes(receiptFiles)}
          receiptError={receiptError}
          receiptValues={receiptValues}
          targetCents={Math.max(0, total - paid)}
          onReceiptValueChange={(index, value) =>
            setReceiptValues((current) =>
              receiptFiles.map((_, candidateIndex) =>
                candidateIndex === index
                  ? value
                  : (current[candidateIndex] ?? {
                      amountCents: null,
                      source: null,
                    }),
              ),
            )
          }
        />
      )}

      {step === 'review' && (
        <SaleReview
          customer={customer}
          sellers={sellers}
          sellerUserId={sellerUserId}
          defaultSellerId={defaultSellerId}
          onSellerChange={setSellerUserId}
          error={submitError}
          items={items}
          onEditItems={() => {
            setStep('items');
            setAnnouncement('Revise os aparelhos antes de finalizar a venda.');
          }}
          onBack={goBack}
          onConfirm={async () => {
            if (
              defaultSellerId &&
              !sellers.some((seller) => seller.id === sellerUserId)
            ) {
              setSubmitError(
                'Selecione um vendedor ativo da loja antes de finalizar.',
              );
              return;
            }
            if (!completionSentRef.current) {
              completionSentRef.current = true;
              setSaving(true);
              setSubmitError('');
              try {
                await onComplete?.({
                  operationId: operationIdRef.current,
                  customerId,
                  customer,
                  sellerUserId: sellerUserId || undefined,
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
                  receiptValues,
                  productsTotalCents: total,
                  receivedTotalCents: paid,
                  receivedDifferenceCents: paid - total,
                });
              } catch (error) {
                completionSentRef.current = false;
                if (error instanceof PendingOperationError)
                  draft.setWaiting(true);
                setSaving(false);
                const message =
                  error instanceof Error
                    ? error.message
                    : 'Não foi possível salvar a venda.';
                setSubmitError(message);
                setAnnouncement(message);
                return;
              }
            }
            setStep('done');
            setSaving(false);
            setAnnouncement(
              receiptFiles.length > 0
                ? 'Venda concluída. O comprovante já está em leitura automática.'
                : payments.length === 0
                  ? 'Venda concluída sem pagamento informado.'
                  : `Venda concluída com recebimento de ${formatMoney(paid)}.`,
            );
          }}
          paid={paid}
          payments={payments}
          receiptCount={receiptFiles.length}
          receiptValues={receiptValues}
          uploadBytes={sumFileBytes([
            ...items.flatMap((item) => item.photos),
            ...receiptFiles,
          ])}
          total={total}
          saving={saving}
        />
      )}

      {step === 'done' && (
        <SaleCompletion
          customer={customer}
          onReset={reset}
          productsTotal={total}
          receiptCount={receiptFiles.length}
          receivedTotal={paid}
        />
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
  onCreateCustomer,
  onNext,
}: {
  customer: string;
  customers: SaleCustomer[];
  query: string;
  onQueryChange: (value: string) => void;
  onSelect: (customer: SaleCustomer) => void;
  onCreateCustomer?: (input: {
    operationId: string;
    name: string;
    phone: string;
  }) => Promise<SaleCustomer>;
  onNext: () => void;
}) {
  const [createOpen, setCreateOpen] = useState(false);
  const [newName, setNewName] = useState('');
  const [newPhone, setNewPhone] = useState('');
  const [createError, setCreateError] = useState('');
  const [creating, setCreating] = useState(false);
  const createOperationIdRef = useRef(createOperationId());
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
          {!customer && canSearch && onCreateCustomer && (
            <Button
              className="mt-3 h-11 w-full rounded-xl border-dashed lg:mt-4"
              onClick={() => {
                setNewName(query.trim());
                setNewPhone('');
                setCreateError('');
                createOperationIdRef.current = createOperationId();
                setCreateOpen(true);
              }}
              variant="outline"
            >
              <Plus />{' '}
              {matches.length > 0
                ? 'Cadastrar outro cliente'
                : 'Cadastrar novo cliente'}
            </Button>
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
      <Dialog
        onOpenChange={(open) => {
          if (!creating) setCreateOpen(open);
        }}
        open={createOpen}
      >
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Novo cliente</DialogTitle>
            <DialogDescription>
              Cadastre sem sair da venda. O telefone é opcional.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <label
              className="block text-sm font-semibold"
              htmlFor="sale-new-customer-name"
            >
              Nome
            </label>
            <Input
              id="sale-new-customer-name"
              maxLength={120}
              onChange={(event) => setNewName(event.target.value)}
              value={newName}
            />
            <label
              className="block text-sm font-semibold"
              htmlFor="sale-new-customer-phone"
            >
              Telefone{' '}
              <span className="font-normal text-muted-foreground">
                (opcional)
              </span>
            </label>
            <Input
              id="sale-new-customer-phone"
              inputMode="tel"
              maxLength={40}
              onChange={(event) => setNewPhone(event.target.value)}
              value={newPhone}
            />
            {createError && (
              <p
                className="rounded-xl bg-destructive/10 p-3 text-sm font-semibold text-destructive"
                role="alert"
              >
                {createError}
              </p>
            )}
          </div>
          <DialogFooter>
            <Button
              disabled={creating}
              onClick={() => setCreateOpen(false)}
              variant="outline"
            >
              Cancelar
            </Button>
            <Button
              disabled={creating || newName.trim().length < 2}
              onClick={async () => {
                setCreateError('');
                const normalizedName = newName
                  .trim()
                  .toLocaleLowerCase('pt-BR');
                const normalizedPhone = comparablePhone(newPhone);
                const duplicate = customers.find(
                  (entry) =>
                    entry.name.trim().toLocaleLowerCase('pt-BR') ===
                      normalizedName &&
                    (normalizedPhone.length === 0 ||
                      comparablePhone(entry.phone ?? '') === normalizedPhone),
                );
                if (duplicate) {
                  setCreateError(
                    'Este cliente já está cadastrado. Feche esta janela e selecione-o na pesquisa.',
                  );
                  return;
                }
                setCreating(true);
                try {
                  const created = await onCreateCustomer!({
                    operationId: createOperationIdRef.current,
                    name: newName.trim(),
                    phone: newPhone.trim(),
                  });
                  onSelect(created);
                  setCreateOpen(false);
                } catch (error) {
                  setCreateError(
                    error instanceof Error
                      ? error.message
                      : 'Não foi possível cadastrar o cliente.',
                  );
                } finally {
                  setCreating(false);
                }
              }}
            >
              {creating && <LoaderCircle className="animate-spin" />}
              Salvar cliente
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
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
  onAccepted: (candidate: ScanCandidate) => Promise<ScanFeedback>;
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
              model={product.product}
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
              <ProductDetailVisual
                detail={product.detail}
                model={product.product}
              />
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
            className="mt-3 rounded-xl border border-border bg-muted/50 px-3 py-2 text-sm text-foreground"
            id="sale-price-guidance"
            role="note"
          >
            <p className="font-bold">
              {hasDefaultPrice
                ? `Preço preenchido: ${formatMoney(product.defaultPriceCents)}`
                : 'Preço padrão ainda não configurado'}
            </p>
            <p className="flow-stage-support mt-0.5 text-xs">
              Você pode alterar livremente. O valor digitado será usado nesta
              venda sem gerar aviso sobre o preço padrão.
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
  return (
    <Card className={STAGE_CARD_CLASS}>
      <CardContent className="min-h-0 flex-1 overflow-hidden p-3 sm:p-4">
        <div className="mx-auto max-w-2xl">
          <div
            className="rounded-2xl border bg-secondary p-3 sm:p-4"
            role="note"
          >
            <div className="flex items-center justify-between gap-3">
              <div>
                <p className="font-bold">Aparelhos desta venda</p>
                <p className="flow-stage-support mt-1 text-sm text-muted-foreground">
                  Cada SN é um aparelho. O pagamento será do total da venda.
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
                  <ProductDetailVisual
                    detail={item.detail}
                    model={item.product}
                  />
                  <p className="truncate font-mono text-xs text-muted-foreground">
                    SN {item.serial.normalizedValue}
                  </p>
                </div>
                <div className="shrink-0 text-right">
                  <p className="text-xs font-semibold text-muted-foreground">
                    Praticado
                  </p>
                  <strong className="block text-sm">
                    {formatMoney(item.priceCents)}
                  </strong>
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
  pixAccounts: SalePixAccount[];
  ready: boolean;
  onAdd: (method: PaymentMethod) => void;
  onUpdate: (id: string, patch: Partial<SalePayment>) => void;
  onRemove: (id: string) => void;
  onBack: () => void;
  onNext: () => void;
}) {
  return (
    <Card className={STAGE_CARD_CLASS}>
      <CardContent className="min-h-0 flex-1 overflow-y-auto p-4 sm:p-6">
        <div className="mx-auto max-w-2xl space-y-4">
          <div className="rounded-xl bg-secondary p-4">
            <h3 className="text-lg font-bold">
              Recebeu alguma parte em dinheiro?
            </h3>
            <p className="mt-1 text-sm text-muted-foreground">
              Informe somente o dinheiro recebido. Na próxima etapa, o sistema
              lê o valor e o banco do comprovante Pix — sem digitar essas
              informações.
            </p>
          </div>
          {payments
            .filter((p) => p.method === 'cash')
            .map((payment) => (
              <div
                key={payment.id}
                className="flex items-end gap-2 rounded-xl border p-3"
              >
                <label
                  htmlFor={`cash-${payment.id}`}
                  className="flex-1 text-sm font-semibold"
                >
                  Dinheiro recebido
                  <Input
                    id={`cash-${payment.id}`}
                    className="mt-1 h-12 text-right text-lg font-bold"
                    inputMode="decimal"
                    value={payment.amount}
                    onChange={(event) =>
                      onUpdate(payment.id, { amount: event.target.value })
                    }
                  />
                </label>
                <Button
                  size="icon"
                  variant="ghost"
                  aria-label="Remover dinheiro recebido"
                  onClick={() => onRemove(payment.id)}
                >
                  <Trash2 />
                </Button>
              </div>
            ))}
          <Button
            className="h-12 w-full"
            variant="outline"
            onClick={() => onAdd('cash')}
          >
            <Banknote /> Informar dinheiro recebido
          </Button>
          <div className="space-y-2 rounded-xl bg-muted p-4">
            <p className="flex justify-between">
              <span>Valor da venda</span>
              <strong>{formatMoney(total)}</strong>
            </p>
            <p className="flex justify-between">
              <span>Dinheiro recebido</span>
              <strong>{formatMoney(paid)}</strong>
            </p>
            <p className="flex justify-between border-t pt-2">
              <span>
                {remaining < 0 ? 'Acima da venda' : 'Saldo para conferir'}
              </span>
              <strong>{formatMoney(Math.abs(remaining))}</strong>
            </p>
          </div>
          <p className="text-sm text-muted-foreground">
            Pode continuar sem dinheiro e sem comprovante. A venda fica salva
            com pagamento pendente para anexar o comprovante depois.
          </p>
        </div>
      </CardContent>
      <div className="grid shrink-0 grid-cols-2 gap-2 border-t p-3">
        <Button className="h-12" variant="outline" onClick={onBack}>
          <ArrowLeft /> Voltar
        </Button>
        <Button className="h-12" disabled={!ready} onClick={onNext}>
          Comprovante <ArrowRight />
        </Button>
      </div>
    </Card>
  );
}

function ReceiptStage({
  cashCents,
  files,
  receiptValues,
  targetCents,
  preparing,
  progressLabel,
  receiptBytes,
  receiptError,
  onFiles,
  onBack,
  onClear,
  onSkip,
  onNext,
  onReceiptValueChange,
}: {
  cashCents: number;
  files: File[];
  receiptValues: ReceiptValueInput[];
  targetCents: number;
  preparing: boolean;
  progressLabel: string;
  receiptBytes: number;
  receiptError: string;
  onFiles: (files: File[]) => void;
  onBack: () => void;
  onClear: () => void;
  onSkip: () => void;
  onNext: () => void;
  onReceiptValueChange: (index: number, value: ReceiptValueInput) => void;
}) {
  return (
    <Card className={STAGE_CARD_CLASS}>
      <CardContent className="flex min-h-0 flex-1 flex-col items-center overflow-y-auto p-3 text-center overscroll-contain sm:p-6">
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
          <div className="mt-2 flex w-full max-w-xl items-center gap-2 rounded-2xl bg-success/10 px-3 py-2 text-sm font-semibold text-success sm:mt-4">
            <FileCheck2 className="size-4 shrink-0" />
            <span className="truncate">
              {files.length === 1
                ? `${files[0].name} · ${formatMediaBytes(receiptBytes)}`
                : `${files.length} comprovantes · ${formatMediaBytes(receiptBytes)}`}
            </span>
            <Button
              className="ml-auto h-8 shrink-0 px-2 text-xs"
              disabled={preparing}
              onClick={onClear}
              size="sm"
              type="button"
              variant="ghost"
            >
              Limpar
            </Button>
          </div>
        )}
        <ReceiptReconciliationEditor
          cashCents={cashCents}
          className="mt-3 max-w-xl"
          disabled={preparing}
          files={files}
          onValueChange={onReceiptValueChange}
          targetCents={targetCents}
          values={receiptValues}
        />
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
  sellers,
  sellerUserId,
  defaultSellerId,
  onSellerChange,
  error,
  items,
  payments,
  receiptCount,
  receiptValues,
  uploadBytes,
  total,
  paid,
  onBack,
  onEditItems,
  onConfirm,
  saving,
}: {
  customer: string;
  sellers: SaleSeller[];
  sellerUserId: string;
  defaultSellerId: string;
  onSellerChange: (id: string) => void;
  error: string;
  items: SaleItem[];
  payments: SalePayment[];
  receiptCount: number;
  receiptValues: ReceiptValueInput[];
  uploadBytes: number;
  total: number;
  paid: number;
  onBack: () => void;
  onEditItems: () => void;
  onConfirm: () => void;
  saving: boolean;
}) {
  const reconciliation = deriveReceiptReconciliation(
    receiptValues,
    Math.max(0, total - paid),
  );
  const receiptReading =
    receiptCount > 0 &&
    paid <= total &&
    reconciliation.status === 'pending' &&
    !reconciliation.reviewReceiptCount;
  const receivedAfterReading = paid + reconciliation.confirmedTotalCents;
  return (
    <Card className={STAGE_CARD_CLASS}>
      <CardContent className="min-h-0 flex-1 overflow-y-auto p-4 overscroll-contain sm:p-6">
        <div className="mx-auto max-w-3xl">
          {defaultSellerId && (
            <div className="mb-4 rounded-2xl border bg-background p-3 sm:p-4">
              <label
                className="mb-2 flex items-center gap-2 text-sm font-bold"
                htmlFor="sale-seller"
              >
                <UserRound className="size-4 text-primary" /> Vendedor da venda
              </label>
              <Select
                disabled={saving}
                items={sellers.map((seller) => ({
                  value: seller.id,
                  label: `${seller.displayName}${seller.id === defaultSellerId ? ' (você)' : ''}`,
                }))}
                value={
                  sellers.some((seller) => seller.id === sellerUserId)
                    ? sellerUserId
                    : null
                }
                onValueChange={(value) => {
                  if (value) onSellerChange(value);
                }}
              >
                <SelectTrigger
                  id="sale-seller"
                  size="lg"
                  className="w-full rounded-xl text-base font-semibold"
                >
                  <SelectValue placeholder="Selecione um vendedor ativo" />
                </SelectTrigger>
                <SelectContent
                  alignItemWithTrigger={false}
                  className="rounded-xl p-1"
                >
                  {sellers.map((seller) => (
                    <SelectItem
                      key={seller.id}
                      value={seller.id}
                      className="min-h-11 rounded-lg px-3 text-base font-medium"
                    >
                      {seller.displayName}
                      {seller.id === defaultSellerId ? ' (você)' : ''}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className="mt-2 text-sm text-muted-foreground">
                A venda contará para este vendedor. O sistema também registra
                quem finalizou.
              </p>
            </div>
          )}
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
              label="Dinheiro recebido"
              value={paid > 0 ? formatMoney(paid) : 'Não informado'}
              icon={WalletCards}
            />
          </div>

          {receiptReading && (
            <output
              className="mt-4 block rounded-xl border border-sky-500/35 bg-sky-50 px-3 py-2 text-sm text-sky-950 dark:bg-sky-500/10 dark:text-sky-100"
            >
              <p className="font-bold">Comprovante em leitura</p>
              <p className="mt-0.5 text-xs">
                O Pix será identificado pelo comprovante depois que a venda for
                salva. O valor recebido e o status serão atualizados
                automaticamente.
              </p>
            </output>
          )}

          {!receiptReading && receivedAfterReading !== total && (
            <div
              className="mt-4 rounded-xl border border-amber-500/35 bg-amber-50 px-3 py-2 text-sm text-amber-950 dark:bg-amber-500/10 dark:text-amber-100"
              role="alert"
            >
              <p className="font-bold">
                {receivedAfterReading < total
                  ? `Falta receber ${formatMoney(total - receivedAfterReading)}`
                  : `Recebido a mais ${formatMoney(receivedAfterReading - total)}`}
              </p>
              <p className="mt-0.5 text-xs">
                Valor da venda: {formatMoney(total)}
                {paid > 0 && <> · Dinheiro recebido: {formatMoney(paid)}</>}
                {reconciliation.confirmedTotalCents > 0 && (
                  <>
                    {' '}
                    · Pix identificado:{' '}
                    {formatMoney(reconciliation.confirmedTotalCents)}
                  </>
                )}
                . A venda será salva com este aviso e poderá receber o
                comprovante depois.
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
                    <ProductDetailVisual
                      detail={item.detail}
                      model={item.product}
                    />
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
                  {payments.length === 0
                    ? 'Nenhum dinheiro informado'
                    : 'Recebido em dinheiro'}
                </span>
                {payments.length > 0 && <strong>{formatMoney(paid)}</strong>}
              </div>
            </div>
            <div className="rounded-2xl bg-muted p-4 text-sm">
              <div className="flex items-center justify-between gap-3">
                <span className="font-semibold">Comprovante</span>
                <strong>
                  {receiptCount > 0
                    ? `${receiptCount} ${receiptCount === 1 ? 'anexado' : 'anexados'}`
                    : reconciliation.status === 'not_required'
                      ? 'Anexar depois em Vendas'
                      : 'Pulado'}
                </strong>
              </div>
              {receiptCount > 0 && (
                <p
                  className={`mt-2 text-xs font-bold ${
                    reconciliation.status === 'reconciled'
                      ? 'text-success'
                      : reconciliation.status === 'divergent'
                        ? 'text-destructive'
                        : 'text-amber-800 dark:text-amber-200'
                  }`}
                >
                  {reconciliation.status === 'reconciled'
                    ? `Comprovantes conferem com o ${receiptTargetLabel(paid)}`
                    : reconciliation.status === 'divergent'
                      ? `${(reconciliation.differenceCents ?? 0) < 0 ? 'Falta' : 'Sobra'} ${formatMoney(Math.abs(reconciliation.differenceCents ?? 0))} nos comprovantes · verificar venda`
                      : reconciliation.reviewReceiptCount
                        ? 'O comprovante precisará ser verificado'
                        : 'Leitura em andamento · você já pode salvar a venda'}
                </p>
              )}
            </div>
          </div>
        </div>
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
  model,
  className = '',
}: {
  detail: string;
  model: string;
  className?: string;
}) {
  const [colorPart, ...memoryParts] = detail.split('·');
  const color = colorPart?.trim() || detail;
  const memory = memoryParts.join('·').trim();
  return (
    <span
      className={`grid w-full max-w-60 grid-cols-[minmax(0,1fr)_4rem] items-center gap-1.5 text-xs text-muted-foreground ${className}`}
    >
      <span className="flex min-w-0 items-center gap-1.5">
        <ProductColorSwatch color={color} model={model} />
        <span className="truncate" title={color}>
          {color}
        </span>
      </span>
      {memory && (
        <Badge
          className="w-16 justify-center whitespace-nowrap px-1.5 py-0 font-extrabold tabular-nums"
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
  productsTotal,
  receiptCount,
  receivedTotal,
  onReset,
}: {
  customer: string;
  productsTotal: number;
  receiptCount: number;
  receivedTotal: number;
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
          Cliente {customer} · produtos de {formatMoney(productsTotal)}.
        </p>
        <p
          className={`mt-3 rounded-xl px-4 py-3 text-sm font-semibold ${receiptCount > 0 ? 'bg-sky-500/10 text-sky-900 dark:text-sky-100' : receivedTotal !== productsTotal || receivedTotal === 0 ? 'bg-amber-500/10 text-amber-900 dark:text-amber-100' : 'bg-success/10 text-success'}`}
        >
          {receiptCount > 0
            ? `${receiptCount} ${receiptCount === 1 ? 'comprovante enviado' : 'comprovantes enviados'} para leitura automática. O Pix, o valor recebido e o status serão atualizados assim que a leitura terminar. O estoque foi atualizado.`
            : receivedTotal === 0
              ? 'A venda foi salva com pagamento pendente e o estoque foi atualizado.'
              : receivedTotal < productsTotal
                ? `Recebido ${formatMoney(receivedTotal)}. Falta receber ${formatMoney(productsTotal - receivedTotal)}; anexe o comprovante depois em Vendas. O estoque foi atualizado.`
                : receivedTotal > productsTotal
                  ? `Recebido ${formatMoney(receivedTotal)}. Confira o valor excedente de ${formatMoney(receivedTotal - productsTotal)}. O estoque foi atualizado.`
                  : `Recebimento de ${formatMoney(receivedTotal)} registrado e estoque atualizado.`}
        </p>
        <Button className="mt-5 h-12 rounded-xl px-6" onClick={onReset}>
          <RotateCcw /> Fazer nova venda
        </Button>
      </CardContent>
    </Card>
  );
}

function createLocalId(prefix: string) {
  return `${prefix}-${createOperationId()}`;
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

function comparablePhone(value: string) {
  return value.replace(/\D/g, '');
}

function getDefaultPriceInput(product: SaleProduct | null | undefined) {
  if (!product || product.defaultPriceCents <= 0) return '';
  return formatMoneyInput(product.defaultPriceCents);
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
