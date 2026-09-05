import { parseMoneyInput } from './money.ts';

export type ReceiptAmountSuggestion = {
  amountCents: number;
  confidence: 'high' | 'medium';
  matchedText: string;
};

const POSITIVE_LABELS = [
  'valor da transacao',
  'valor transferido',
  'valor enviado',
  'valor recebido',
  'valor pago',
  'valor do pix',
  'valor total',
  'total pago',
  'pagamento realizado',
  'transferencia realizada',
];
const NEGATIVE_LABELS = [
  'saldo',
  'tarifa',
  'taxa',
  'limite',
  'desconto',
  'agendamento',
  'disponivel',
];

export function extractReceiptAmount(
  sourceText: string,
): ReceiptAmountSuggestion | null {
  const lines = sourceText
    .split(/\r?\n/)
    .map((line) => line.replace(/\s+/g, ' ').trim())
    .filter(Boolean);
  const candidates: Array<ReceiptAmountSuggestion & { score: number }> = [];

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    const context = [
      lines[index - 3],
      lines[index - 2],
      lines[index - 1],
      line,
    ]
      .filter(Boolean)
      .join(' ');
    const negativeContext = [lines[index - 1], line]
      .filter(Boolean)
      .join(' ');
    const normalizedContext = normalizeText(context);
    const normalizedNegativeContext = normalizeText(negativeContext);
    const normalizedLine = normalizeText(line);
    const positive = POSITIVE_LABELS.some((label) =>
      normalizedContext.includes(label),
    );
    const negative = NEGATIVE_LABELS.some((label) =>
      normalizedNegativeContext.includes(label),
    );

    for (const match of moneyMatches(line)) {
      const amountCents = parseMoneyInput(match.value);
      if (amountCents <= 0 || amountCents > 1_000_000_000) continue;
      let score = 0;
      if (match.currency) score += 6;
      if (match.decimal) score += 2;
      if (positive) score += 10;
      if (/\bvalor\b/.test(normalizedLine)) score += 4;
      if (negative) score -= 20;
      candidates.push({
        amountCents,
        confidence: score >= 12 ? 'high' : 'medium',
        matchedText: line.slice(0, 160),
        score,
      });
    }
  }

  const best = candidates
    .filter(({ score }) => score >= 6)
    .sort(
      (left, right) =>
        right.score - left.score || right.amountCents - left.amountCents,
    )[0];
  if (!best) return null;
  const { score: _score, ...suggestion } = best;
  return suggestion;
}

function moneyMatches(line: string) {
  const matches: Array<{
    currency: boolean;
    decimal: boolean;
    value: string;
  }> = [];
  const pattern =
    /(?:R\s*[$S]\s*)?(?:\d{1,3}(?:[.\s]\d{3})+|\d+)(?:,\d{2}|\.\d{2})/gi;
  for (const match of line.matchAll(pattern)) {
    const value = match[0];
    const prefix = line.slice(Math.max(0, (match.index ?? 0) - 3), match.index);
    const currency = /R\s*[$S]/i.test(`${prefix}${value}`);
    matches.push({
      currency,
      decimal: /[,.]\d{2}$/.test(value),
      value,
    });
  }
  return matches;
}

function normalizeText(value: string) {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase();
}
