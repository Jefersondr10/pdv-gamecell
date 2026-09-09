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
const IDENTIFIER_LINE =
  /\b(?:cpf|cnpj|documento|identificador|id|autenticacao|controle|e2e|chave|telefone|celular|agencia|conta|data|hora|protocolo|codigo|nsu|linha digitavel|numero|n[º°.]|end.to.end)\b/;

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
    const context = [lines[index - 3], lines[index - 2], lines[index - 1], line]
      .filter(Boolean)
      .join(' ');
    const negativeContext = lines[index - 1] ?? '';
    const normalizedContext = normalizeText(context);
    const normalizedNegativeContext = normalizeText(negativeContext);
    const normalizedLine = normalizeText(line);
    const positive = POSITIVE_LABELS.some((label) =>
      normalizedContext.includes(label),
    );

    for (const match of moneyMatches(line)) {
      const prefix = normalizeText(line.slice(0, match.index));
      const positivePosition = Math.max(
        ...[...POSITIVE_LABELS, 'valor'].map((label) =>
          prefix.lastIndexOf(label),
        ),
      );
      const negativePosition = Math.max(
        ...NEGATIVE_LABELS.map((label) => prefix.lastIndexOf(label)),
      );
      // Amount and balance/tariff can share an OCR/PDF line. Associate each
      // candidate with its preceding label instead of penalizing the full line.
      const negative =
        positivePosition >= 0 || negativePosition >= 0
          ? negativePosition > positivePosition
          : NEGATIVE_LABELS.some((label) =>
              normalizedNegativeContext.includes(label),
            );
      if (!match.currency && IDENTIFIER_LINE.test(normalizedLine)) continue;
      // Bare integers must have an explicit amount label, not merely inherit
      // one from an earlier line containing a document or transaction number.
      if (
        !match.currency &&
        !match.decimal &&
        !POSITIVE_LABELS.some((label) => normalizedLine.includes(label))
      )
        continue;
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
    index: number;
  }> = [];
  // Capture the WHOLE numeric token first. A decimal-only regex backtracks
  // and mistakes the prefix of 19.650 for 19.65, silently losing a zero.
  const pattern =
    /(?:R\s*[$S]\s*)?(?:\d{1,3}(?: \d{3})+(?:[.,]\d+)?|\d[\d.,]*)/gi;
  for (const match of line.matchAll(pattern)) {
    const raw = match[0];
    const start = match.index ?? 0;
    const before = line[start - 1] ?? '';
    const after = line[start + raw.length] ?? '';
    if (/[\p{L}\d.,/+:-]/u.test(before) || /[\p{L}\d.,/+:-]/u.test(after))
      continue;
    const currency = /^R\s*[$S]/i.test(raw);
    if (!currency && (before === '(' || after === ')')) continue;
    let value = raw.replace(/^R\s*[$S]\s*/i, '').trim();
    // Do not salvage the prefix of malformed, space-grouped amounts.
    const following = line.slice(start + raw.length);
    if (
      !/[.,]/.test(value) &&
      /^ +\d/.test(following) &&
      !/^ +\d+[/:]/.test(following)
    )
      continue;
    // Spaces are grouping separators only in complete groups of three.
    if (/\s/.test(value)) {
      if (!/^\d{1,3}(?: \d{3})+(?:,\d{2}|\.\d{2})?$/.test(value)) continue;
      value = value.replace(/ /g, '');
    }
    const br = /^(?:\d{1,3}(?:\.\d{3})+|\d+),\d{2}$/.test(value);
    const dot = /^(?:\d{1,3}(?:,\d{3})+|\d+)\.\d{2}$/.test(value);
    const integer = /^(?:\d{1,9}|\d{1,3}(?:\.\d{3})+)$/.test(value);
    if (!br && !dot && !integer) continue;
    matches.push({
      currency,
      decimal: br || dot,
      value,
      index: start,
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
