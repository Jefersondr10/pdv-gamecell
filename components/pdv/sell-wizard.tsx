'use client';

import { useMemo, useState } from 'react';
import {
  ArrowLeft,
  ArrowRight,
  Banknote,
  Camera,
  Check,
  CheckCircle2,
  CircleUserRound,
  Plus,
  RotateCcw,
  ScanBarcode,
  Smartphone,
  UserRound,
  WalletCards,
} from 'lucide-react';

import { BarcodeScanner } from '@/components/pdv/barcode-scanner';
import { FlowFrame } from '@/components/pdv/flow-frame';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { NativeSelect, NativeSelectOption } from '@/components/ui/native-select';
import {
  normalizeCandidate,
  type ScanCandidate,
} from '@/lib/scanner';

type SaleStep =
  | 'customer'
  | 'serial'
  | 'photo'
  | 'price'
  | 'payments'
  | 'review'
  | 'done';

type SaleItem = {
  serial: ScanCandidate;
  product: string;
  detail: string;
  photoCount: number;
  priceCents: number;
};

const SALE_STEPS = ['Cliente', 'SN', 'Foto', 'Preço', 'Pagamento', 'Revisão'] as const;
const RECENT_CUSTOMERS = ['Rafael Martins', 'Camila Souza', 'Bruno Lima'];

const STEP_INDEX: Record<SaleStep, number> = {
  customer: 0,
  serial: 1,
  photo: 2,
  price: 3,
  payments: 4,
  review: 5,
  done: 5,
};

export function SellWizard({ stagedSerial = '' }: { stagedSerial?: string }) {
  const initialSerial = stagedSerial
    ? normalizeCandidate(stagedSerial, 'manual_code_128', 'apple_serial')
    : null;
  const [step, setStep] = useState<SaleStep>('customer');
  const [customer, setCustomer] = useState('');
  const [newCustomerName, setNewCustomerName] = useState('');
  const [pendingSerial, setPendingSerial] = useState<ScanCandidate | null>(initialSerial);
  const [photoCount, setPhotoCount] = useState(0);
  const [price, setPrice] = useState('9.999,00');
  const [items, setItems] = useState<SaleItem[]>([]);
  const [pixAmount, setPixAmount] = useState('0,00');
  const [cashAmount, setCashAmount] = useState('0,00');
  const [pixBank, setPixBank] = useState('nubank');
  const [announcement, setAnnouncement] = useState(
    'Etapa 1. Selecione ou cadastre o cliente.',
  );

  const total = useMemo(
    () => items.reduce((sum, item) => sum + item.priceCents, 0),
    [items],
  );
  const paid = useMemo(
    () => parseMoney(pixAmount) + parseMoney(cashAmount),
    [pixAmount, cashAmount],
  );
  const remaining = total - paid;

  const description = useMemo(() => {
    if (step === 'customer') return 'Uma decisão por tela, começando pelo cliente.';
    if (step === 'serial') return 'Localize o aparelho pelo número de série.';
    if (step === 'photo') return 'Vincule a foto deste aparelho.';
    if (step === 'price') return 'Informe o preço unitário.';
    if (step === 'payments') return 'Divida o recebimento entre Pix e dinheiro.';
    if (step === 'review') return 'Confira a venda completa antes de finalizar.';
    return 'Venda preparada com sucesso.';
  }, [step]);

  const reset = () => {
    setStep('customer');
    setCustomer('');
    setNewCustomerName('');
    setPendingSerial(null);
    setPhotoCount(0);
    setPrice('9.999,00');
    setItems([]);
    setPixAmount('0,00');
    setCashAmount('0,00');
    setAnnouncement('Nova venda. Selecione ou cadastre o cliente.');
  };

  const acceptSerial = (candidate: ScanCandidate) => {
    if (items.some((item) => item.serial.normalizedValue === candidate.normalizedValue)) {
      setAnnouncement(`O SN ${candidate.normalizedValue} já está nesta venda e foi ignorado.`);
      return;
    }
    setPendingSerial(candidate);
    setAnnouncement(`SN ${candidate.normalizedValue} localizado e disponível.`);
  };

  const addPendingItem = () => {
    if (!pendingSerial) return;
    const priceCents = parseMoney(price);
    if (priceCents <= 0) return;
    const nextItems = [
      ...items,
      {
        serial: pendingSerial,
        product: 'iPhone 17 Pro Max',
        detail: 'Deep Blue · 256 GB',
        photoCount,
        priceCents,
      },
    ];
    const nextTotal = nextItems.reduce((sum, item) => sum + item.priceCents, 0);
    setItems(nextItems);
    setPendingSerial(null);
    setPhotoCount(0);
    setPrice('9.999,00');
    setPixAmount(formatMoneyInput(nextTotal));
    setCashAmount('0,00');
    setStep('payments');
    setAnnouncement('Etapa 5. Confira os pagamentos da venda.');
  };

  const editLastItem = () => {
    const lastItem = items.at(-1);
    if (!lastItem) return;
    setItems((current) => current.slice(0, -1));
    setPendingSerial(lastItem.serial);
    setPhotoCount(lastItem.photoCount);
    setPrice(formatMoneyInput(lastItem.priceCents));
    setStep('price');
    setAnnouncement('Edite o preço do último aparelho.');
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
          newCustomerName={newCustomerName}
          onChangeNewName={setNewCustomerName}
          onNext={() => {
            setStep('serial');
            setAnnouncement('Etapa 2. Bipe o número de série do aparelho.');
          }}
          onSelect={setCustomer}
          onUseNew={() => {
            const name = newCustomerName.trim();
            if (!name) return;
            setCustomer(name);
            setNewCustomerName('');
            setAnnouncement(`${name} selecionado.`);
          }}
        />
      )}

      {step === 'serial' && (
        <SaleSerialStage
          candidate={pendingSerial}
          onAccepted={acceptSerial}
          onBack={() => setStep(items.length > 0 ? 'review' : 'customer')}
          onConfirm={() => {
            setStep('photo');
            setAnnouncement('Etapa 3. Fotografe o aparelho.');
          }}
          onRescan={() => {
            setPendingSerial(null);
            setAnnouncement('Faça uma nova leitura do SN.');
          }}
        />
      )}

      {step === 'photo' && pendingSerial && (
        <SalePhotoStage
          candidate={pendingSerial}
          onBack={() => setStep('serial')}
          onFiles={(count) => {
            setPhotoCount(count);
            setAnnouncement(`${count} ${count === 1 ? 'foto vinculada' : 'fotos vinculadas'} ao aparelho.`);
          }}
          onNext={() => {
            setStep('price');
            setAnnouncement('Etapa 4. Informe o preço do aparelho.');
          }}
          photoCount={photoCount}
        />
      )}

      {step === 'price' && pendingSerial && (
        <PriceStage
          candidate={pendingSerial}
          onBack={() => setStep('photo')}
          onChange={setPrice}
          onNext={addPendingItem}
          value={price}
        />
      )}

      {step === 'payments' && (
        <PaymentStage
          cashAmount={cashAmount}
          onBack={editLastItem}
          onCashChange={setCashAmount}
          onNext={() => {
            setStep('review');
            setAnnouncement('Etapa 6. Revise e finalize a venda.');
          }}
          onPixAmountChange={setPixAmount}
          onPixBankChange={setPixBank}
          paid={paid}
          pixAmount={pixAmount}
          pixBank={pixBank}
          remaining={remaining}
          total={total}
        />
      )}

      {step === 'review' && (
        <SaleReview
          customer={customer}
          items={items}
          onAddAnother={() => {
            setPendingSerial(null);
            setPhotoCount(0);
            setStep('serial');
            setAnnouncement('Bipe o SN do próximo aparelho.');
          }}
          onBack={() => setStep('payments')}
          onConfirm={() => {
            setStep('done');
            setAnnouncement(`Venda concluída no valor de ${formatMoney(total)}.`);
          }}
          paid={paid}
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
  newCustomerName,
  onSelect,
  onChangeNewName,
  onUseNew,
  onNext,
}: {
  customer: string;
  newCustomerName: string;
  onSelect: (name: string) => void;
  onChangeNewName: (name: string) => void;
  onUseNew: () => void;
  onNext: () => void;
}) {
  return (
    <Card className="flex h-full min-h-0 flex-col overflow-hidden">
      <CardContent className="min-h-0 flex-1 overflow-y-auto p-4 overscroll-contain sm:p-6">
        <div className="mx-auto max-w-2xl">
          <div className="flex items-center gap-3">
            <span className="grid size-12 place-items-center rounded-2xl bg-secondary text-primary">
              <CircleUserRound className="size-6" />
            </span>
            <div>
              <h2 className="text-lg font-bold">Quem está comprando?</h2>
              <p className="text-sm text-muted-foreground">Selecione um cliente recente ou cadastre pelo nome.</p>
            </div>
          </div>

          <div className="mt-5 grid gap-2 sm:grid-cols-3">
            {RECENT_CUSTOMERS.map((name) => (
              <Button
                className="h-14 justify-start rounded-2xl px-4"
                key={name}
                onClick={() => onSelect(name)}
                variant={customer === name ? 'secondary' : 'outline'}
              >
                <UserRound />
                <span className="truncate">{name}</span>
                {customer === name && <Check className="ml-auto text-success" />}
              </Button>
            ))}
          </div>

          <div className="mt-5 rounded-2xl border bg-muted/25 p-4">
            <label className="text-sm font-semibold" htmlFor="new-sale-customer">
              Novo cliente
            </label>
            <div className="mt-2 grid grid-cols-[1fr_auto] gap-2">
              <Input
                className="h-12 text-base"
                id="new-sale-customer"
                onChange={(event) => onChangeNewName(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') onUseNew();
                }}
                placeholder="Nome do cliente"
                value={newCustomerName}
              />
              <Button className="h-12 rounded-xl" disabled={!newCustomerName.trim()} onClick={onUseNew}>
                <Plus /> Usar
              </Button>
            </div>
          </div>

          {customer && (
            <div className="mt-4 flex items-center gap-2 rounded-xl bg-success/10 px-4 py-3 text-sm font-semibold text-success">
              <Check className="size-4" /> {customer} selecionado
            </div>
          )}
        </div>
      </CardContent>
      <div className="shrink-0 border-t p-3 text-right sm:p-4">
        <Button className="h-12 w-full rounded-xl sm:w-auto sm:min-w-56" disabled={!customer} onClick={onNext}>
          Bipar aparelho <ArrowRight />
        </Button>
      </div>
    </Card>
  );
}

function SaleSerialStage({
  candidate,
  onAccepted,
  onBack,
  onConfirm,
  onRescan,
}: {
  candidate: ScanCandidate | null;
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
          onAccepted={onAccepted}
          onBack={onBack}
          title="2. Bipar somente o SN"
        />
      </div>
    );
  }

  return (
    <Card className="flex h-full min-h-0 flex-col overflow-hidden">
      <CardContent className="grid min-h-0 flex-1 place-items-center p-5 text-center sm:p-8">
        <div className="max-w-md">
          <span className="mx-auto grid size-16 place-items-center rounded-2xl bg-success/10 text-success">
            <Smartphone className="size-8" />
          </span>
          <p className="eyebrow mt-5">Aparelho disponível</p>
          <h2 className="mt-1 text-xl font-bold">iPhone 17 Pro Max</h2>
          <p className="text-sm text-muted-foreground">Deep Blue · 256 GB</p>
          <p className="mx-auto mt-4 w-fit rounded-xl bg-muted px-4 py-2 font-mono text-sm font-bold">
            SN {candidate.normalizedValue}
          </p>
        </div>
      </CardContent>
      <div className="grid shrink-0 grid-cols-2 gap-2 border-t p-3 sm:p-4">
        <Button className="h-12 rounded-xl" onClick={onRescan} variant="outline">
          <ScanBarcode /> Ler novamente
        </Button>
        <Button className="h-12 rounded-xl" onClick={onConfirm}>
          Confirmar aparelho <ArrowRight />
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
      <CardContent className="flex min-h-0 flex-1 flex-col items-center justify-center p-4 text-center sm:p-8">
        <Badge variant="secondary">SN {candidate.normalizedValue}</Badge>
        <label className="mt-4 flex w-full max-w-xl cursor-pointer flex-col items-center rounded-3xl border-2 border-dashed bg-muted/30 p-6 transition hover:bg-muted/55 sm:p-10">
          <span className="grid size-16 place-items-center rounded-2xl bg-card text-primary shadow-sm">
            <Camera className="size-7" />
          </span>
          <span className="mt-4 text-base font-bold">Fotografar aparelho</span>
          <span className="mt-1 text-sm text-muted-foreground">A foto ficará vinculada a este SN.</span>
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
        <Button className="h-12 rounded-xl" onClick={onBack} variant="outline"><ArrowLeft /> Voltar</Button>
        <Button className="h-12 rounded-xl" disabled={photoCount === 0} onClick={onNext}>Informar preço <ArrowRight /></Button>
      </div>
    </Card>
  );
}

function PriceStage({
  candidate,
  value,
  onChange,
  onBack,
  onNext,
}: {
  candidate: ScanCandidate;
  value: string;
  onChange: (value: string) => void;
  onBack: () => void;
  onNext: () => void;
}) {
  const valid = parseMoney(value) > 0;
  return (
    <Card className="flex h-full min-h-0 flex-col overflow-hidden">
      <CardContent className="grid min-h-0 flex-1 place-items-center p-5 sm:p-8">
        <div className="w-full max-w-lg">
          <div className="flex items-center gap-3 rounded-2xl border bg-background p-4">
            <span className="grid size-12 shrink-0 place-items-center rounded-xl bg-secondary text-primary"><Smartphone className="size-6" /></span>
            <div className="min-w-0"><p className="truncate font-bold">iPhone 17 Pro Max</p><p className="truncate text-sm text-muted-foreground">SN {candidate.normalizedValue}</p></div>
          </div>
          <label className="mt-5 block text-sm font-semibold" htmlFor="sale-price">Preço unitário</label>
          <div className="relative mt-2">
            <span className="absolute left-4 top-1/2 -translate-y-1/2 text-base font-bold text-muted-foreground">R$</span>
            <Input
              className="h-16 pl-12 text-right text-2xl font-extrabold"
              id="sale-price"
              inputMode="decimal"
              onChange={(event) => onChange(event.target.value)}
              value={value}
            />
          </div>
          <p className="mt-2 text-sm text-muted-foreground">A soma da venda e dos pagamentos será calculada automaticamente.</p>
        </div>
      </CardContent>
      <div className="grid shrink-0 grid-cols-2 gap-2 border-t p-3 sm:p-4">
        <Button className="h-12 rounded-xl" onClick={onBack} variant="outline"><ArrowLeft /> Voltar</Button>
        <Button className="h-12 rounded-xl" disabled={!valid} onClick={onNext}>Pagamentos <ArrowRight /></Button>
      </div>
    </Card>
  );
}

function PaymentStage({
  total,
  paid,
  remaining,
  pixAmount,
  cashAmount,
  pixBank,
  onPixAmountChange,
  onCashChange,
  onPixBankChange,
  onBack,
  onNext,
}: {
  total: number;
  paid: number;
  remaining: number;
  pixAmount: string;
  cashAmount: string;
  pixBank: string;
  onPixAmountChange: (value: string) => void;
  onCashChange: (value: string) => void;
  onPixBankChange: (value: string) => void;
  onBack: () => void;
  onNext: () => void;
}) {
  return (
    <Card className="flex h-full min-h-0 flex-col overflow-hidden">
      <CardContent className="min-h-0 flex-1 overflow-y-auto p-4 overscroll-contain sm:p-6">
        <div className="mx-auto max-w-2xl space-y-3">
          <div className="grid gap-3 rounded-2xl border bg-background p-4 sm:grid-cols-[120px_1fr_1fr] sm:items-end">
            <div className="flex items-center gap-2 font-bold"><WalletCards className="size-5 text-primary" /> Pix</div>
            <div><label className="text-sm font-semibold" htmlFor="pix-bank">Banco</label><NativeSelect className="mt-1 h-12 w-full" id="pix-bank" onChange={(event) => onPixBankChange(event.target.value)} value={pixBank}><NativeSelectOption value="nubank">Nubank</NativeSelectOption><NativeSelectOption value="itau">Itaú</NativeSelectOption><NativeSelectOption value="inter">Inter</NativeSelectOption></NativeSelect></div>
            <div><label className="text-sm font-semibold" htmlFor="pix-amount">Valor</label><Input className="mt-1 h-12 text-right text-base font-bold" id="pix-amount" inputMode="decimal" onChange={(event) => onPixAmountChange(event.target.value)} value={pixAmount} /></div>
          </div>
          <div className="grid gap-3 rounded-2xl border bg-background p-4 sm:grid-cols-[120px_1fr] sm:items-end">
            <div className="flex items-center gap-2 font-bold"><Banknote className="size-5 text-primary" /> Dinheiro</div>
            <div><label className="text-sm font-semibold" htmlFor="cash-amount">Valor</label><Input className="mt-1 h-12 text-right text-base font-bold" id="cash-amount" inputMode="decimal" onChange={(event) => onCashChange(event.target.value)} value={cashAmount} /></div>
          </div>
          <div className="rounded-2xl bg-muted p-4">
            <div className="flex justify-between text-sm"><span className="text-muted-foreground">Total da venda</span><strong>{formatMoney(total)}</strong></div>
            <div className="mt-2 flex justify-between text-sm"><span className="text-muted-foreground">Informado</span><strong>{formatMoney(paid)}</strong></div>
            <div className="mt-3 flex justify-between border-t pt-3"><span className="font-bold">Restante</span><strong className={remaining === 0 ? 'text-success' : 'text-destructive'}>{formatMoney(Math.abs(remaining))}</strong></div>
          </div>
        </div>
      </CardContent>
      <div className="grid shrink-0 grid-cols-2 gap-2 border-t p-3 sm:p-4">
        <Button className="h-12 rounded-xl" onClick={onBack} variant="outline"><ArrowLeft /> Voltar</Button>
        <Button className="h-12 rounded-xl" disabled={remaining !== 0 || !pixBank} onClick={onNext}>Revisar venda <ArrowRight /></Button>
      </div>
    </Card>
  );
}

function SaleReview({
  customer,
  items,
  total,
  paid,
  onBack,
  onAddAnother,
  onConfirm,
}: {
  customer: string;
  items: SaleItem[];
  total: number;
  paid: number;
  onBack: () => void;
  onAddAnother: () => void;
  onConfirm: () => void;
}) {
  return (
    <Card className="flex h-full min-h-0 flex-col overflow-hidden">
      <CardContent className="min-h-0 flex-1 overflow-y-auto p-4 overscroll-contain sm:p-6">
        <div className="mx-auto max-w-3xl">
          <div className="grid gap-3 sm:grid-cols-3">
            <SummaryTile label="Cliente" value={customer} icon={CircleUserRound} />
            <SummaryTile label="Itens" value={String(items.length)} icon={Smartphone} />
            <SummaryTile label="Total" value={formatMoney(total)} icon={WalletCards} />
          </div>
          <section className="mt-4 rounded-2xl border bg-background p-4">
            <div className="flex items-center justify-between"><h2 className="font-bold">Aparelhos</h2><Badge variant="secondary">{items.length}</Badge></div>
            <div className="mt-3 space-y-2">
              {items.map((item) => (
                <div className="flex items-center gap-3 rounded-xl bg-muted/50 p-3" key={item.serial.normalizedValue}>
                  <Smartphone className="size-5 shrink-0 text-primary" />
                  <div className="min-w-0 flex-1"><p className="truncate text-sm font-bold">{item.product}</p><p className="truncate font-mono text-xs text-muted-foreground">SN {item.serial.normalizedValue} · {item.photoCount} foto</p></div>
                  <strong className="text-sm">{formatMoney(item.priceCents)}</strong>
                </div>
              ))}
            </div>
            <Button className="mt-3 h-11 w-full rounded-xl border-dashed" onClick={onAddAnother} variant="outline"><Plus /> Adicionar outro aparelho</Button>
          </section>
          <div className="mt-4 flex items-center justify-between rounded-2xl bg-success/10 p-4 text-sm"><span className="font-semibold text-success">Pagamentos conferidos</span><strong>{formatMoney(paid)}</strong></div>
        </div>
      </CardContent>
      <div className="grid shrink-0 grid-cols-2 gap-2 border-t p-3 sm:p-4">
        <Button className="h-12 rounded-xl" onClick={onBack} variant="outline"><ArrowLeft /> Voltar</Button>
        <Button className="h-12 rounded-xl" onClick={onConfirm}><Check /> Finalizar venda</Button>
      </div>
    </Card>
  );
}

function SummaryTile({ label, value, icon: Icon }: { label: string; value: string; icon: typeof Smartphone }) {
  return <div className="flex items-center gap-3 rounded-2xl border bg-background p-3"><span className="grid size-10 shrink-0 place-items-center rounded-xl bg-secondary text-primary"><Icon className="size-5" /></span><div className="min-w-0"><p className="text-xs font-semibold text-muted-foreground">{label}</p><p className="truncate text-sm font-bold">{value}</p></div></div>;
}

function SaleCompletion({ customer, total, onReset }: { customer: string; total: number; onReset: () => void }) {
  return (
    <Card className="grid h-full place-items-center overflow-hidden">
      <CardContent className="max-w-lg p-6 text-center sm:p-10">
        <span className="mx-auto grid size-20 place-items-center rounded-full bg-success/10 text-success"><CheckCircle2 className="size-10" /></span>
        <h2 className="mt-5 text-2xl font-bold tracking-tight">Venda preparada</h2>
        <p className="mt-2 text-sm leading-6 text-muted-foreground">Cliente {customer} · total de {formatMoney(total)}.</p>
        <p className="mt-3 rounded-xl bg-amber-500/10 px-4 py-3 text-sm text-amber-900">Esta é uma demonstração: nenhum estoque ou pagamento real foi alterado.</p>
        <Button className="mt-5 h-12 rounded-xl px-6" onClick={onReset}><RotateCcw /> Fazer nova venda</Button>
      </CardContent>
    </Card>
  );
}

function parseMoney(value: string) {
  const normalized = value.replace(/\./g, '').replace(',', '.').replace(/[^\d.]/g, '');
  return Math.round((Number.parseFloat(normalized) || 0) * 100);
}

function formatMoney(cents: number) {
  return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(cents / 100);
}

function formatMoneyInput(cents: number) {
  return new Intl.NumberFormat('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(cents / 100);
}
