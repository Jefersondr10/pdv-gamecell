import { extractReceiptAmount } from './receipt-amount.ts';

// Engine/parser revision, independent of the saved document format version.
export const RECEIPT_READER_REVISION = 3;

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

const VALID_SHORT_BANK_IDENTITIES = new Set(['bb', 'bv', 'c6', 'xp']);

function cleanParticipantBank(value: string | null | undefined) {
  if (!value) return null;
  const cleaned = value.trim().slice(0, 150);
  const identity = normalizeReceiptIdentity(cleaned);
  if (!identity) return null;
  // OCR occasionally returns a cropped accent/symbol (for example "és" or
  // "6:") for the C6 recipient bank. Keep genuinely short brands while
  // requiring other readings to contain enough alphabetic evidence.
  if (VALID_SHORT_BANK_IDENTITIES.has(identity)) return cleaned;
  const letters = identity.replace(/\d/g, '');
  return identity.length >= 3 && letters.length >= 2 ? cleaned : null;
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
  const transferDates = [
    ...text.matchAll(
      /^\s*transferid[oa]\s+em\s+(\d{1,2}\/\d{1,2}\/\d{4}\s+(?:[aà]s\s+)?\d{1,2}:\d{2}(?::\d{2})?)\b/gim,
    ),
  ].map((match) => match[1].replace(/\s+/g, ' ').trim());
  const pixDispatchReceipt =
    /\bcomprovante\s+de\s+envio(?:\s+de)?\s+pix\b/.test(
      normalized.slice(0, 500),
    ) &&
    transferDates.length === 1;
  const originAccount = lines.findIndex((line) =>
    /^conta\s+de\s+origem$/i.test(line),
  );
  const c6 =
    originAccount >= 0 &&
    /\bbanco\s+c(?:6|[óô0])(?:\s+s\.?a\.?)?(?=\s|[.,;:)]|$)/i.test(
      lines.slice(originAccount).join(' '),
    );
  const recipientBankLine = c6
    ? lines.findIndex(
        (line, i) => i < originAccount && /^banco\s*:/i.test(line),
      )
    : -1;
  const c6Heading =
    recipientBankLine >= 0
      ? lines.slice(0, recipientBankLine).join('\n').toLowerCase()
      : '';
  const timelineDates = c6Heading.match(/\b\d{2}\/\d{2}\/\d{4}\b/g) ?? [];
  const timelineTimes = c6Heading.match(/\b\d{2}:\d{2}(?::\d{2})?\b/g) ?? [];
  // C6 shows a historical step next to the final step. OCR reads across the
  // columns: "Pix em Pix / andamento realizado!". Both steps must be dated;
  // an undated future step is not evidence that the transfer completed.
  const c6Timeline = c6 && /andamento/.test(c6Heading);
  const sequentialTimeline =
    /\bpix\s*em\s+andamento\s+\d{2}\/\d{2}\/\d{4}\s+\d{2}:\d{2}(?::\d{2})?\s+pix\s+realizado[!.]?\s+\d{2}\/\d{2}\/\d{4}\s+\d{2}:\d{2}(?::\d{2})?\b/;
  const c6Completed =
    c6Timeline &&
    timelineDates.length === 2 &&
    timelineTimes.length === 2 &&
    (/\b(?:pix|ix)\s*em\s+(?:pix|px)\s+andamento\s+realizado[!.]?\s+\d{2}\/\d{2}\/\d{4}\s+\d{2}\/\d{2}\/\d{4}\s+\d{2}:\d{2}(?::\d{2})?\s+\d{2}:\d{2}(?::\d{2})?\b/.test(
      c6Heading,
    ) ||
      sequentialTimeline.test(c6Heading));
  const currentStateText =
    c6Completed && sequentialTimeline.test(c6Heading)
      ? normalized.replace(sequentialTimeline, (timeline) =>
          timeline.replace(/^pix\s*em\s+andamento\b/, ''),
        )
      : normalized;
  const idLabel = lines.findIndex((line) =>
    /(?:id|identificador)\s+(?:de\s+|da\s+)?transa[cç][aã]o(?:\s+pix)?|end\s*to\s*end|e2e/i.test(
      line,
    ) ||
    // Low-resolution C6 images often turn "ID da Transação" into
    // "ID ca Transação". Restrict this tolerance to the already identified
    // C6 layout so unrelated long codes never become Pix evidence.
    (c6 && /^[il1]d\s+[cd][ae]\s+transa[cç][aã]o(?:\s+pix)?$/i.test(line)),
  );
  const ids = idLabel < 0 ? [] : (text.match(/\bE[A-Za-z0-9]{31}\b/g) ?? []);
  const singleTransaction = new Set(ids.map((id) => id.toUpperCase())).size === 1;
  const receiptHeading = normalized.slice(0, 700);
  // Some banks call a completed transfer "pagamento", "transação" or
  // "operação" instead of "Pix realizado". Accept those layouts only when
  // the document also contains one labelled Pix/E2E identifier; the heading
  // alone is not proof that money moved.
  const labelledCompletedReceipt =
    singleTransaction &&
    /\b(?:comprovante|confirmacao)\b/.test(receiptHeading) &&
    /\bpix\b/.test(normalized) &&
    (/\bcomprovante\s+(?:de|do)\s+pagamento(?:\s+pix)?\b/.test(
      receiptHeading,
    ) ||
      /\bcomprovante\s+de\s+transacao\b/.test(receiptHeading) ||
      /\bconfirmacao\s+de\s+operacao\b/.test(receiptHeading)) &&
    /\b(?:pix|pagamento|transferencia|transacao|operacao)\b[\s\S]{0,160}\b(?:foi\s+)?(?:realizad[oa]|concluid[oa]|efetivad[oa]|efetuad[oa]|enviad[oa]|transferid[oa]|confirmad[oa])\b/.test(
      normalized,
    );
  const rejected =
    /\b(cancelad[oa]|estornad[oa]|recusad[oa]|negad[oa])\b|\bnao\s+(?:foi\s+)?(?:realizad[oa]|concluid[oa]|efetivad[oa]|efetuad[oa]|enviad[oa]|transferid[oa]|autorizad[oa]|aprovad[oa])\b/.test(
      normalized,
    );
  const pending =
    /em\s+andamento|pixem\s+andamento|em processamento|em analise|\bpendente\b|\bfalha\b|aguardando|nao foi possivel|erro na/.test(
      currentStateText,
    );
  const state: ReceiptDocument['state'] =
    /\b(agendad[oa]|agendamento|programad[oa])\b/.test(normalized)
      ? 'scheduled'
      : rejected
        ? 'cancelled'
        : pending
          ? 'unknown'
          : c6Completed
            ? 'completed'
            : c6Timeline
              ? 'unknown'
              : pixDispatchReceipt ||
                  labelledCompletedReceipt ||
                  (/comprovante\s+(?:de|da)\s+transferencia\b/.test(
                    normalized.slice(0, 500),
                  ) &&
                    /\bpix\b/.test(normalized)) ||
                  /comprovante\s+(?:(?:de|do)\s+)?pix|pix\s+(?:foi\s+)?(?:enviado|realizado|concluido|efetuado)|(?:pagamento|transferencia)\s+(?:foi\s+)?(?:realizad[oa]|concluid[oa]|efetuad[oa])/.test(
                    normalized,
                  )
                ? 'completed'
                : 'unknown';
  const participant = (block: string[]) => {
    const fieldLabel =
      /^(?:nome|cpf(?:\s*\/\s*cnpj)?|cnpj|banco|institui[cç][aã]o(?:\s+financeira)?|ag[eê]ncia|conta|chave|tipo|valor|data|hora|id|identificador|autentica[cç][aã]o)(?:\s*:|\s*$)/i;
    const labelledValue = (label: RegExp) => {
      const index = block.findIndex((line) => label.test(line));
      if (index < 0) return null;
      const inline = block[index].replace(label, '').trim();
      if (inline) return inline;
      const next = block[index + 1];
      return next && !fieldLabel.test(next) ? next : null;
    };
    const nameLabel = /^nome\s*(?::\s*|$)/i;
    const name = block.some((line) => nameLabel.test(line))
      ? labelledValue(nameLabel)
      : block.find(
          (line, index) =>
            !fieldLabel.test(line) &&
            !(
              index > 0 &&
              fieldLabel.test(block[index - 1]) &&
              !/:\s*\S/.test(block[index - 1])
            ) &&
            !/^(cpf|cnpj|banco|institui|ag[eê]ncia|conta|chave|tipo|valor|data|id |n[º°.]|pix)/i.test(
              line,
            ),
        );
    const bank =
      labelledValue(
        /^(?:banco|institui[cç][aã]o(?:\s+financeira)?)\s*(?::\s*|$)/i,
      ) ??
      block.find(
        (line) =>
          /\b(banco|pagamento|mercado pago|nubank|itau|bradesco|santander|inter|caixa|picpay|sicredi|sicoob)\b/i.test(
            line,
          ) &&
          line !== name &&
          !fieldLabel.test(line) &&
          !/^(cpf|cnpj|chave)/i.test(line),
      );
    const doc = labelledValue(
      /^(?:cpf(?:\s*\/\s*cnpj)?|cnpj)\s*(?::\s*|$)/i,
    )?.replace(/\D/g, '');
    return {
      name: cleanParticipantName(name),
      bank: cleanParticipantBank(bank),
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
  if (c6 && recipientBankLine > 0) {
    const bankAt = lines.findIndex(
      (line, i) => i > originAccount && /^banco\s*:/i.test(line),
    );
    const receiverBlock = lines
      .slice(recipientBankLine + 1, originAccount)
      .join('\n');
    const documents =
      receiverBlock.match(/\b\d{2}\.\d{3}\.\d{3}\/\d{4}-\d{2}\b/g) ?? [];
    const nameBeforeBank = (index: number) => {
      const value = index > 0 ? cleanParticipantName(lines[index - 1]) : null;
      return value &&
        value.length >= 3 &&
        !/^(pix|banco|ag[eê]ncia|conta|cpf|cnpj|data|valor|\d)/i.test(value)
        ? value
        : null;
    };
    recipient = {
      name: nameBeforeBank(recipientBankLine),
      bank: cleanParticipantBank(
        lines[recipientBankLine].replace(/^banco\s*:\s*/i, ''),
      ),
      document: documents.length === 1 ? documents[0].replace(/\D/g, '') : null,
    };
    if (bankAt > originAccount)
      payer = {
        name: nameBeforeBank(bankAt),
        bank: cleanParticipantBank(
          lines[bankAt].replace(/^banco\s*:\s*/i, ''),
        ),
        document: null,
      };
  }
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
  const dates = transferDates.length
    ? transferDates
    : (text.match(
        /\b\d{1,2}[/-](?:\d{1,2}|[a-zç]+)[/-]\d{4}\s*(?:[aà]s\s*)?\d{1,2}:\d{2}(?::\d{2})?\b/gi,
      ) ?? []);
  const participantStarts = [paired, from, to].filter((i) => i >= 0);
  const heading = participantStarts.length
    ? lines.slice(0, Math.min(...participantStarts)).join('\n')
    : '';
  const headingAmounts = heading
    .split('\n')
    .filter((line) => /R\s*[$S]/i.test(line))
    .map((line) => extractReceiptAmount(line))
    .filter(Boolean);
  const c6CurrencyAmounts = c6
    ? lines
        .filter((line) => /R\s*[$S]/i.test(line))
        .map((line) => extractReceiptAmount(line))
        .filter(Boolean)
    : [];
  const suggestion =
    extractReceiptAmount(heading) ?? extractReceiptAmount(text);
  const c6ValueIndexes = lines
    .map((line, index) => (/^valor\s*:?$/i.test(line) ? index : -1))
    .filter((index) => index >= 0);
  const c6LabelledAmount =
    c6ValueIndexes.length === 1
      ? extractReceiptAmount(lines[c6ValueIndexes[0] + 1] ?? '')
      : null;
  const ambiguous =
    ids.length > 1 ||
    headingAmounts.length > 1 ||
    c6CurrencyAmounts.length > 1;
  const uniqueAmount =
    !ambiguous &&
    suggestion !== null &&
    (suggestion.confidence === 'high' ||
      (headingAmounts.length === 1 &&
        headingAmounts[0]!.amountCents === suggestion.amountCents) ||
      (c6 &&
        (c6LabelledAmount?.amountCents === suggestion.amountCents ||
          (c6CurrencyAmounts.length === 1 &&
            c6CurrencyAmounts[0]!.amountCents === suggestion.amountCents))));
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
      state === 'scheduled' || state === 'cancelled' || pending || rejected,
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
    result.payerBank = cleanParticipantBank(result.payerBank);
    result.recipientBank = cleanParticipantBank(result.recipientBank);
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
    found.find(
      (reading) =>
        reading.details.automaticEligible && reading.details.recipientBank,
    ) ??
    found.find((reading) => reading.details.automaticEligible) ??
    found.find(
      (reading) =>
        reading.details.state === 'completed' &&
        !reading.details.blocked &&
        !reading.details.ambiguous &&
        reading.details.recipientBank &&
        reading.details.recipientDocument,
    ) ??
    found.find(
      (reading) =>
        reading.details.state === 'completed' &&
        !reading.details.blocked &&
        !reading.details.ambiguous &&
        reading.details.recipientBank,
    ) ??
    found.find(
      (reading) =>
        reading.details.state === 'completed' &&
        !reading.details.blocked &&
        !reading.details.ambiguous,
    ) ??
    found[0] ??
    readings[0];
  if (!preferred) return extractReceiptDocument('');
  // Keep the financially eligible reading as the base. A second PSM pass may
  // repair only its missing bank label when both readings describe the same
  // completed payment and the same recipient. Never inherit amount, state,
  // transaction id or eligibility from the enrichment candidate.
  const bankEnrichment =
    preferred.details.automaticEligible && !preferred.details.recipientBank
      ? found.find((candidate) => {
          if (
            candidate === preferred ||
            candidate.amountCents !== preferred.amountCents ||
            candidate.details.state !== 'completed' ||
            candidate.details.blocked ||
            candidate.details.ambiguous ||
            !candidate.details.recipientBank
          )
            return false;
          const sameName =
            Boolean(preferred.details.recipientName) &&
            Boolean(candidate.details.recipientName) &&
            normalizeReceiptIdentity(preferred.details.recipientName!) ===
              normalizeReceiptIdentity(candidate.details.recipientName!);
          const sameDocument =
            Boolean(preferred.details.recipientDocument) &&
            preferred.details.recipientDocument ===
              candidate.details.recipientDocument;
          return sameName || sameDocument;
        })?.details.recipientBank ?? null
      : null;
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
      recipientBank: preferred.details.recipientBank ?? bankEnrichment,
      blocked,
      ambiguous,
      automaticEligible:
        preferred.details.automaticEligible && !blocked && !ambiguous,
    },
  };
}

export function needsReceiptOcrEnrichment(
  reading: ReturnType<typeof extractReceiptDocument> | null | undefined,
) {
  // Banks commonly mask CPF/CNPJ. Once the transaction and recipient bank are
  // identified, another OCR pass adds no required evidence and can corrupt IDs.
  return !reading?.details.automaticEligible || !reading.details.recipientBank;
}
