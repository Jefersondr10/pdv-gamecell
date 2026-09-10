import { extractReceiptAmount } from './receipt-amount.ts';

export type ReceiptDocument = {
  version: 1;
  payerName: string | null;
  payerBank: string | null;
  recipientName: string | null;
  recipientBank: string | null;
  recipientDocument: string | null;
  transactionId: string | null;
  paidAtText: string | null;
  state: 'completed' | 'scheduled' | 'cancelled' | 'unknown';
  automaticEligible: boolean;
  ambiguous: boolean;
  blocked: boolean;
};

export const normalizeReceiptIdentity = (value: string) =>
  value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '');

function cleanParticipantName(value: string | null | undefined) {
  if (!value) return null;
  // Bank icons can become leading "&" or "<&" in OCR. Only remove the
  // symbol prefix, preserving letters and legitimate names such as A & B.
  return (
    value
      .replace(/^[\s<>&|•·◦]+/u, '')
      .trim()
      .slice(0, 150) || null
  );
}

// Parse labelled participants only. A logo/header never identifies the recipient.
export function extractReceiptDocument(text: string) {
  const lines = text
    .slice(0, 100_000)
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  const normalized = text
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase();
  const state: ReceiptDocument['state'] =
    /\b(agendad[oa]|agendamento|programad[oa])\b/.test(normalized)
      ? 'scheduled'
      : /\b(cancelad[oa]|estornad[oa]|nao realizad[oa]|nao concluid[oa]|recusad[oa])\b/.test(
            normalized,
          )
        ? 'cancelled'
        : /em processamento|em analise|\bpendente\b|\bfalha\b|aguardando|nao efetivad[oa]|nao foi possivel|nao enviado|erro na/.test(
              normalized,
            )
          ? 'unknown'
          : /comprovante\s+(?:de\s+)?pix|pix\s+(?:enviado|realizado|concluido)|(?:pagamento|transferencia)\s+(?:realizad[oa]|concluid[oa]|efetuad[oa])/.test(
                normalized,
              )
            ? 'completed'
            : 'unknown';
  const participant = (block: string[]) => {
    const name =
      block
        .find((line) => /^nome\s*:/i.test(line))
        ?.replace(/^nome\s*:\s*/i, '') ??
      block.find(
        (line) =>
          !/^(cpf|cnpj|banco|institui|ag[eê]ncia|conta|chave|tipo|valor|data|id |n[º°.]|pix)/i.test(
            line,
          ),
      );
    const bank =
      block
        .find((line) =>
          /^(banco|institui[cç][aã]o(?:\s+financeira)?)\s*:/i.test(line),
        )
        ?.replace(/^[^:]+:\s*/, '') ??
      block.find(
        (line) =>
          /\b(banco|pagamento|mercado pago|nubank|itau|bradesco|santander|inter|caixa|picpay|sicredi|sicoob)\b/i.test(
            line,
          ) &&
          line !== name &&
          !/^(cpf|cnpj|chave)/i.test(line),
      );
    const doc = block
      .find((line) => /^(?:cpf(?:\/cnpj)?|cnpj)\s*:/i.test(line))
      ?.replace(/^[^:]+:/, '')
      .replace(/\D/g, '');
    return {
      name: cleanParticipantName(name),
      bank: bank?.slice(0, 150) || null,
      document: doc && [11, 14].includes(doc.length) ? doc : null,
    };
  };
  const key = (line: string) => normalizeReceiptIdentity(line);
  const from = lines.findIndex((line) =>
    /^(origem|dadosdopagador|pagador|quempagou|de)$/.test(key(line)),
  );
  const to = lines.findIndex((line) =>
    /^(destino|dadosdorecebedor|recebedor|quemrecebeu|favorecido|beneficiario|para)$/.test(
      key(line),
    ),
  );
  let payer: ReturnType<typeof participant> = {
    name: null,
    bank: null,
    document: null,
  };
  let recipient = { ...payer };
  const stop = (block: string[]) => {
    const end = block.findIndex(
      (line) =>
        /^(id\s|n[º°.]|identificador|autentica|dados da transa|atendimento|ouvidoria)/i.test(
          line,
        ) ||
        /^(origem|destino|dadosdopagador|pagador|quempagou|de|dadosdorecebedor|recebedor|quemrecebeu|favorecido|beneficiario|para)$/.test(
          key(line),
        ),
    );
    return end < 0 ? block : block.slice(0, end);
  };
  if (from >= 0) payer = participant(stop(lines.slice(from + 1, from + 12)));
  if (to >= 0) recipient = participant(stop(lines.slice(to + 1, to + 12)));
  // Mercado Pago prints two consecutive participant blocks ending at CPF/CNPJ.
  const paired = lines.findIndex((line) => key(line) === 'origemedestino');
  if (paired >= 0 && to < 0) {
    const block = stop(lines.slice(paired + 1, paired + 14));
    const ends = block
      .map((line, i) => (/^(?:cpf(?:\/cnpj)?|cnpj)\s*:/i.test(line) ? i : -1))
      .filter((i) => i >= 0);
    if (ends.length === 2) {
      payer = participant(block.slice(0, ends[0] + 1));
      recipient = participant(block.slice(ends[0] + 1, ends[1] + 1));
    }
  }
  const idLabel = lines.findIndex((line) =>
    /(?:id|identificador)\s+(?:de\s+|da\s+)?transa[cç][aã]o(?:\s+pix)?|end\s*to\s*end|e2e/i.test(
      line,
    ),
  );
  const ids = idLabel < 0 ? [] : (text.match(/\bE[A-Za-z0-9]{31}\b/g) ?? []);
  const dates =
    text.match(
      /\b\d{1,2}[/-](?:\d{1,2}|[a-zç]+)[/-]\d{4}\s*(?:[aà]s\s*)?\d{1,2}:\d{2}(?::\d{2})?\b/gi,
    ) ?? [];
  const participantStarts = [paired, from, to].filter((i) => i >= 0);
  const heading = participantStarts.length
    ? lines.slice(0, Math.min(...participantStarts)).join('\n')
    : '';
  const headingAmounts = heading
    .split('\n')
    .filter((line) => /R\s*[$S]/i.test(line))
    .map((line) => extractReceiptAmount(line))
    .filter(Boolean);
  const suggestion =
    extractReceiptAmount(heading) ?? extractReceiptAmount(text);
  const ambiguous = ids.length > 1 || headingAmounts.length > 1;
  const uniqueAmount =
    !ambiguous &&
    suggestion !== null &&
    (suggestion.confidence === 'high' ||
      (headingAmounts.length === 1 &&
        headingAmounts[0]!.amountCents === suggestion.amountCents));
  const details: ReceiptDocument = {
    version: 1,
    payerName: payer.name,
    payerBank: payer.bank,
    recipientName: recipient.name,
    recipientBank: recipient.bank,
    recipientDocument: recipient.document,
    transactionId:
      new Set(ids).size === 1 ? (ids[0]?.toUpperCase() ?? null) : null,
    paidAtText: new Set(dates).size === 1 ? (dates[0] ?? null) : null,
    state,
    automaticEligible:
      state === 'completed' && ids.length === 1 && uniqueAmount,
    ambiguous,
    blocked:
      state === 'scheduled' ||
      state === 'cancelled' ||
      /em processamento|em analise|\bpendente\b|\bfalha\b|aguardando|nao efetivad[oa]|nao foi possivel|nao enviado|erro na/.test(
        normalized,
      ),
  };
  return {
    amountCents: suggestion?.amountCents ?? null,
    confidence: suggestion?.confidence ?? null,
    details,
  };
}

export function parseReceiptDocument(value: unknown): ReceiptDocument | null {
  try {
    const doc = typeof value === 'string' ? JSON.parse(value) : value;
    if (
      !doc ||
      doc.version !== 1 ||
      !['completed', 'scheduled', 'cancelled', 'unknown'].includes(doc.state)
    )
      return null;
    const result = {
      version: 1,
      state: doc.state,
      automaticEligible: doc.automaticEligible === true,
      ambiguous: doc.ambiguous === true,
      blocked: doc.blocked === true,
    } as ReceiptDocument;
    for (const field of [
      'payerName',
      'payerBank',
      'recipientName',
      'recipientBank',
      'recipientDocument',
      'transactionId',
      'paidAtText',
    ] as const) {
      if (
        doc[field] !== null &&
        (typeof doc[field] !== 'string' || doc[field].length > 150)
      )
        return null;
      result[field] = doc[field];
    }
    // Normalize saved readings at the read boundary too, without rewriting
    // the original document or changing amounts, bank data or identifiers.
    result.payerName = cleanParticipantName(result.payerName);
    result.recipientName = cleanParticipantName(result.recipientName);
    return result;
  } catch {
    return null;
  }
}

export function shortReceiptDate(value: string | null) {
  if (!value) return 'Não identificada';
  const months = [
    'janeiro',
    'fevereiro',
    'março',
    'abril',
    'maio',
    'junho',
    'julho',
    'agosto',
    'setembro',
    'outubro',
    'novembro',
    'dezembro',
  ];
  const normalized = value.toLowerCase().replace(/\s+de\s+/g, '/');
  const date = normalized.match(
    /(\d{1,2})[/\-.\s]+(\d{1,2}|[a-zç]+)[/\-.\s]+(\d{4})/,
  );
  const time = value.match(/(\d{1,2}):(\d{2})(?::\d{2})?/);
  if (!date) return value;
  const month = /^\d+$/.test(date[2])
    ? Number(date[2])
    : months.indexOf(date[2]) + 1;
  if (month < 1 || month > 12 || Number(date[1]) < 1 || Number(date[1]) > 31)
    return value;
  return `${date[1].padStart(2, '0')}/${String(month).padStart(2, '0')}/${date[3]}${time ? ` · ${time[1].padStart(2, '0')}:${time[2]}` : ''}`;
}

export function receiptDocumentLines(doc: ReceiptDocument) {
  return [
    ['Data/hora', shortReceiptDate(doc.paidAtText)],
    ['Pagador', doc.payerName],
    ['Banco pagador', doc.payerBank],
    ['Recebedor', doc.recipientName],
    ['Banco recebedor', doc.recipientBank],
    [
      'CPF/CNPJ do recebedor',
      doc.recipientDocument ? `***${doc.recipientDocument.slice(-4)}` : null,
    ],
    ['Identificador Pix', doc.transactionId],
  ].map(([label, value]) => `${label}: ${value || 'Não identificado'}`);
}

export function preferReceiptReading(
  readings: Array<ReturnType<typeof extractReceiptDocument>>,
) {
  const found = readings.filter((reading) => reading.amountCents !== null);
  const preferred =
    found.find(
      (reading) =>
        reading.details.automaticEligible &&
        reading.details.recipientBank &&
        reading.details.recipientDocument,
    ) ??
    found[0] ??
    readings[0];
  if (!preferred) return extractReceiptDocument('');
  const amountConflict =
    new Set(found.map((reading) => reading.amountCents)).size > 1;
  const idConflict =
    new Set(
      found.map((reading) => reading.details.transactionId).filter(Boolean),
    ).size > 1;
  const blocked = readings.some((reading) => reading.details.blocked);
  const ambiguous =
    amountConflict ||
    idConflict ||
    readings.some((reading) => reading.details.ambiguous);
  return {
    ...preferred,
    details: {
      ...preferred.details,
      blocked,
      ambiguous,
      automaticEligible:
        preferred.details.automaticEligible && !blocked && !ambiguous,
    },
  };
}
