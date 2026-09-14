import {
  extractReceiptAmount,
  receiptAmountRelevantText,
} from './receipt-amount.ts';

// Engine/parser revision, independent of the saved document format version.
export const RECEIPT_READER_REVISION = 9;

export type ReceiptDocument = {
  version: 1;
  payerName: string | null;
  payerBank: string | null;
  recipientName: string | null;
  recipientBank: string | null;
  recipientDocument: string | null;
  transactionId: string | null;
  alternateTransactionId: string | null;
  observedTransactionId: string | null;
  paidAtText: string | null;
  state: 'completed' | 'scheduled' | 'cancelled' | 'unknown';
  automaticEligible: boolean;
  ambiguous: boolean;
  blocked: boolean;
};

export type ReceiptDataWarningKey =
  | 'completion_status'
  | 'transaction_id'
  | 'paid_at'
  | 'payer_name'
  | 'payer_bank'
  | 'recipient_name'
  | 'recipient_bank'
  | 'recipient_document';

export type ReceiptDataWarning = {
  key: ReceiptDataWarningKey;
  label: string;
  message: string;
};

export const normalizeReceiptIdentity = (value: string) =>
  value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '');

export function receiptEvidenceAliases(
  document: ReceiptDocument | null | undefined,
) {
  const aliases: string[] = [];
  if (
    document?.alternateTransactionId &&
    /^(?:mercado-pago:\d{12}|ocr-consensus:E[A-Za-z0-9]{32})$/.test(
      document.alternateTransactionId,
    )
  )
    aliases.push(document.alternateTransactionId);
  if (
    document?.transactionId &&
    /^E[A-Za-z0-9]{31}$/.test(document.transactionId)
  )
    aliases.push(document.transactionId.toUpperCase());
  return [...new Set(aliases)];
}

export function receiptEvidenceKey(
  document: ReceiptDocument | null | undefined,
) {
  return receiptEvidenceAliases(document)[0] ?? null;
}

// Missing descriptive fields must remain visible to the operator, but they do
// not invalidate a uniquely read amount. These are informational warnings;
// explicit negative states, ambiguity and known duplicate identities are
// handled separately by the financial safety checks.
export function receiptDataWarnings(
  document: ReceiptDocument | null | undefined,
): ReceiptDataWarning[] {
  const warnings: ReceiptDataWarning[] = [];
  const add = (key: ReceiptDataWarningKey, label: string, message: string) =>
    warnings.push({ key, label, message });
  if (!document || (document.state === 'unknown' && !document.blocked))
    add(
      'completion_status',
      'Situação do pagamento',
      document?.automaticEligible
        ? 'A frase de conclusão não foi identificada. O valor foi conciliado porque não há indicação de agendamento, processamento, cancelamento ou estorno.'
        : 'A frase de conclusão não foi identificada no comprovante.',
    );
  if (!receiptEvidenceKey(document))
    add(
      'transaction_id',
      'Identificador da transação',
      'Não identificado; a verificação automática de duplicidade por identificador fica indisponível.',
    );
  if (!document?.paidAtText)
    add('paid_at', 'Data e hora', 'Não identificadas no comprovante.');
  if (!document?.payerName)
    add('payer_name', 'Nome do pagador', 'Não identificado no comprovante.');
  if (!document?.payerBank)
    add('payer_bank', 'Banco pagador', 'Não identificado no comprovante.');
  if (!document?.recipientName)
    add(
      'recipient_name',
      'Nome do recebedor',
      'Não identificado no comprovante.',
    );
  if (!document?.recipientBank)
    add(
      'recipient_bank',
      'Banco recebedor',
      'Não identificado no comprovante.',
    );
  if (!document?.recipientDocument)
    add(
      'recipient_document',
      'CPF/CNPJ do recebedor',
      'Não identificado ou mascarado no comprovante.',
    );
  return warnings;
}

export function receiptTransactionDisplay(
  document: ReceiptDocument | null | undefined,
) {
  const alternate = document?.alternateTransactionId;
  if (alternate?.startsWith('mercado-pago:'))
    return {
      label: 'ID da transação Mercado Pago',
      value: alternate.slice('mercado-pago:'.length),
    };
  if (alternate?.startsWith('ocr-consensus:'))
    return {
      label: 'Identificador reconhecido',
      value: alternate.slice('ocr-consensus:'.length),
    };
  return {
    label: 'Identificador Pix',
    value: document?.transactionId ?? null,
  };
}

function cleanParticipantName(value: string | null | undefined) {
  if (!value) return null;
  // Bank icons can become leading "&" or "<&" in OCR. Only remove the
  // symbol prefix, preserving letters and legitimate names such as A & B.
  const cleaned = value
    .replace(/^[\s<>&|•·◦]+/u, '')
    .trim()
    .slice(0, 150);
  if (!cleaned) return null;
  // Payment-provider icons occasionally become isolated OCR words. They are
  // not participant names and must not hide the real name on the next line.
  if (['bind'].includes(normalizeReceiptIdentity(cleaned))) return null;
  return cleaned;
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
  // Some text-based bank PDFs embed an incomplete ArialUnicode map. Poppler
  // then returns U+FFFD in place of accented glyphs (for example
  // "Transa��o" and "Institui��o"). Keep the regular normalized text for
  // existing readers and a second, narrowly used form for those labels.
  const normalizedLoose = normalized.replace(/\uFFFD+/g, '');
  const transferDates = [
    ...text.matchAll(
      /^\s*transferid[oa]\s+em\s+(\d{1,2}\/\d{1,2}\/\d{4}\s+(?:[aà]s\s+)?\d{1,2}:\d{2}(?::\d{2})?)\b/gim,
    ),
  ].map((match) => match[1].replace(/\s+/g, ' ').trim());
  const pixDispatchReceipt =
    /\bcomprovante\s+de\s+envio(?:\s+de)?\s+pix\b/.test(
      normalized.slice(0, 500),
    ) && new Set(transferDates).size === 1;
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
  const timelineTimes = [
    ...(c6Heading.match(/\b\d{2}:\d{2}(?::\d{2})?\b/g) ?? []),
    ...(c6Heading.match(/(?<![\d/])(?:[01]\d|2[0-3])[0-5]\d(?![\d/:])/g) ?? []),
  ];
  // C6 shows a historical step next to the final step. OCR reads across the
  // columns: "Pix em Pix / andamento realizado!". Both steps must be dated;
  // an undated future step is not evidence that the transfer completed.
  const c6Timeline = c6 && /andamento/.test(c6Heading);
  const sequentialTimeline =
    /\bpix\s*em\s+andamento\s+\d{2}\/\d{2}\/\d{4}\s+(?:\d{2}:\d{2}(?::\d{2})?|(?:[01]\d|2[0-3])[0-5]\d)\s+pix\s+realizado[!.]?\s+\d{2}\/\d{2}\/\d{4}\s+(?:\d{2}:\d{2}(?::\d{2})?|(?:[01]\d|2[0-3])[0-5]\d)\b/;
  const c6Completed =
    c6Timeline &&
    !/\bdata\s+da\s+consulta\b/.test(c6Heading) &&
    timelineDates.length === 2 &&
    timelineTimes.length === 2 &&
    (/\b(?:pix|ix)\s*em\s+(?:pix|px)\s+andamento\s+realizado[!.]?\s+\d{2}\/\d{2}\/\d{4}\s+\d{2}\/\d{2}\/\d{4}\s+(?:\d{2}:\d{2}(?::\d{2})?|(?:[01]\d|2[0-3])[0-5]\d)[\s,;|]+(?:\d{2}:\d{2}(?::\d{2})?|(?:[01]\d|2[0-3])[0-5]\d)\b/.test(
      c6Heading,
    ) ||
      sequentialTimeline.test(c6Heading));
  const currentStateText = c6Completed
    ? normalized.replace(sequentialTimeline, (timeline) =>
        timeline.replace(/^pix\s*em\s+andamento\b/, ''),
      )
    : normalized;
  const idLabel = lines.findIndex(
    (line) =>
      /(?:id|identificador)(?:\s*\/\s*|\s+)(?:de\s+|da\s*)?transa[cç](?:[aã]o|\.{2,}|…)(?:\s+pix)?|c[oó]digo\s+da\s+transa[cç][aã]o\s+pix|^[il1]d[f/]\s*transa[cç][aã]o|identifica[cç][aã]o\s*:|end\s*to\s*end|e2e/i.test(
        line,
      ) ||
      /\bidentifica(?:cao|o)\s*:|\b(?:id|identificador)\s+(?:de\s+|da\s*)?transa(?:cao|o)(?:\s+pix)?|\bend\s*to\s*end\b|\be2e\b/i.test(
        line
          .normalize('NFD')
          .replace(/[\u0300-\u036f\uFFFD]/g, '')
          .toLowerCase(),
      ) ||
      // Low-resolution C6 images often turn "ID da Transação" into
      // "ID ca Transação". Restrict this tolerance to the already identified
      // C6 layout so unrelated long codes never become Pix evidence.
      (c6 && /^[il1]d\s*[cd][ae]\s*transa[cç][aã]o(?:\s+pix)?$/i.test(line)),
  );
  // Pix EndToEndId is kept strict. Some providers also print their own
  // strongly-labelled transaction number; retain that as a separate durable
  // identity instead of pretending a malformed OCR token is an E2E id.
  const joinedId = (() => {
    if (idLabel < 0) return null;
    let candidate = '';
    for (const line of lines.slice(idLabel + 1, idLabel + 4)) {
      const fragment = line.replace(/\s+/g, '');
      if (!candidate) {
        if (!/^E[A-Za-z0-9]+$/.test(fragment)) continue;
        candidate = fragment;
      } else if (/^[A-Za-z0-9]+$/.test(fragment) && candidate.length < 32) {
        candidate += fragment;
      } else break;
      if (candidate.length >= 32) break;
    }
    return /^E[A-Za-z0-9]{31}$/.test(candidate) ? candidate : null;
  })();
  const ids =
    idLabel < 0
      ? []
      : [...(text.match(/\bE[A-Za-z0-9]{31}\b/g) ?? []), joinedId].filter(
          (id): id is string => Boolean(id),
        );
  const uniqueIds = [...new Set(ids.map((id) => id.toUpperCase()))];
  const observedIds =
    idLabel < 0
      ? []
      : [
          ...new Set(
            (text.match(/\bE[A-Za-z0-9]{32}\b/g) ?? []).map((id) =>
              id.toUpperCase(),
            ),
          ),
        ];
  const mercadoPagoTransactionLabels = lines
    .map((line, index) =>
      /transa[cç][aã]o\s+do\s+mercado\s+pago/i.test(line) ? index : -1,
    )
    .filter((index) => index >= 0);
  const mercadoPagoTransactionNumbers = [
    ...new Set(
      mercadoPagoTransactionLabels.flatMap(
        (index) =>
          lines
            .slice(index, index + 3)
            .join(' ')
            .match(/\b\d{12}\b/g) ?? [],
      ),
    ),
  ];
  const alternateTransactionId =
    mercadoPagoTransactionNumbers.length === 1
      ? `mercado-pago:${mercadoPagoTransactionNumbers[0]}`
      : null;
  const singleTransaction =
    uniqueIds.length === 1 || Boolean(alternateTransactionId);
  const receiptHeading = normalized.slice(0, 700);
  const looseReceiptHeading = normalizedLoose.slice(0, 700);
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
  // Itaú's corporate SISPag receipt describes a completed Pix by its
  // timestamp and transfer type, without the generic phrases used by consumer
  // apps. Photos commonly crop the authentication footer, so use the stable
  // labelled header plus a unique E2E; global pending/cancelled checks below
  // still take precedence.
  const itauSisPagCompleted =
    uniqueIds.length === 1 &&
    /\bvia\s+sispag\s+no\s+app\s+itau\b/.test(normalized) &&
    /\btipo\s+de\s+transferencia\b/.test(normalized) &&
    /\bpix\s+transferencia\b/.test(normalized);
  const providerDispatchCompleted =
    uniqueIds.length === 1 &&
    ((/\bcomprovante\s+de\s+envio(?:\s+de)?\s+pix\b/.test(receiptHeading) &&
      /\bcodigo\s+da\s+transacao\s+pix\b/.test(normalized)) ||
      (/\bcomprovante\s+(?:do|de)\s+pagamento\b/.test(receiptHeading) &&
        /\btipo\s+de\s+transferencia\s*:?\s*pix\b/.test(normalized)));
  const bradescoDebitedCompleted =
    uniqueIds.length === 1 &&
    /\bdados\s+de\s+quem\s+recebeu\b/.test(normalized) &&
    /\bdados\s+da\s+transferencia\b/.test(normalized) &&
    /\bdebitado\s+da\b/.test(normalized) &&
    /\binstituicao\s+origem\b[\s\S]{0,80}\bbradesco\b/.test(normalized);
  // Bradesco Net Empresa uses a stable footer saying that the transaction
  // "foi realizada" while also warning, as standard boilerplate, that it is
  // subject to analysis and that the credit will occur shortly. That footer
  // appears even on the generated Pix receipt and must not by itself turn the
  // document into a pending payment. Scope the exception to this exact layout
  // and require one canonical E2E identifier; other pending wording continues
  // to block reconciliation.
  const bradescoNetEmpresaCompleted =
    uniqueIds.length === 1 &&
    /\bcomprovante\s+de\s+transa(?:cao|o)\s+banc(?:aria|ria)\b/.test(
      looseReceiptHeading,
    ) &&
    /\bpix\b/.test(looseReceiptHeading) &&
    /\bdata\s+da\s+opera(?:cao|o)\b/.test(normalizedLoose) &&
    /\bn(?:o|º)?\s+de\s+controle\b/.test(normalizedLoose) &&
    /\bconta\s+de\s+d(?:e)?bito\b/.test(normalizedLoose) &&
    /\bnome\s+do\s+favorecido\b/.test(normalizedLoose) &&
    /\binstitui(?:cao|o)\s+destino\b/.test(normalizedLoose) &&
    /\binstitui(?:cao|o)\s+origem\b[\s\S]{0,80}\bbradesco\b/.test(
      normalizedLoose,
    ) &&
    /\ba\s+transa(?:cao|o)\s+acima\s+foi\s+realizada\s+por\s+meio\s+do\s+bradesco\s+net\s+empresa\b/.test(
      normalizedLoose,
    );
  const labelledEffectiveStatus =
    singleTransaction &&
    /\bsituacao\s*:?[\s\S]{0,30}\b(?:efetivad[oa]|concluid[oa]|realizad[oa])\b/.test(
      normalized,
    );
  const rejected =
    /\b(cancelad[oa]|estornad[oa]|recusad[oa]|negad[oa])\b|\bnao\s+(?:foi\s+)?(?:realizad[oa]|concluid[oa]|efetivad[oa]|efetuad[oa]|enviad[oa]|transferid[oa]|autorizad[oa]|aprovad[oa])\b/.test(
      normalized,
    );
  const pendingStateText = bradescoNetEmpresaCompleted
    ? currentStateText
        .replace(/\uFFFD+/g, '')
        .replace(
          /\ba\s+transa(?:cao|o)\s+acima\s+foi\s+realizada\s+por\s+meio\s+do\s+bradesco\s+net\s+empresa\s+e\s+(?:esta|est)\s+sujeit[oa]\s+a\s+(?:analise|anlise)\.?\s+o\s+cr(?:e)?dito\s+ser(?:a)?\s+efetuado\s+em\s+instantes\.?/g,
          '',
        )
    : currentStateText.replace(/\uFFFD+/g, '');
  const pending =
    /em\s+andamento|pixem\s+andamento|em processamento|em (?:analise|anlise)|sujeit[oa]\s+a\s+(?:analise|anlise)|cr(?:e)?dito\s+ser(?:a)?\s+efetuado\s+em\s+instantes|\bpendente\b|\bfalha\b|aguardando|nao foi possivel|erro na/.test(
      pendingStateText,
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
            : itauSisPagCompleted
              ? 'completed'
              : providerDispatchCompleted
                ? 'completed'
                : bradescoDebitedCompleted
                  ? 'completed'
                  : bradescoNetEmpresaCompleted
                    ? 'completed'
                    : labelledEffectiveStatus
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
      /^(?:nome|cpf(?:\s*\/\s*cnpj)?|cnpj|banco|institui[cç][aã]o(?:\s+(?:financeira|destino|origem))?|ag[eê]ncia|conta|chave|tipo|valor|data|hora|id|identificador|autentica[cç][aã]o)(?:\s*:|\s*$)/i;
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
            ) &&
            cleanParticipantName(line) !== null,
        );
    const bank =
      labelledValue(
        /^(?:banco|institui[cç][aã]o(?:\s+(?:financeira|destino|origem))?)\s*(?::\s*|$)/i,
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
    /^(origem|dadosdopagador|pagador|quempagou|de|debitadoda)$/.test(key(line)),
  );
  const to = lines.findIndex((line) =>
    /^(destino|dadosdorecebedor|dadosdequemrecebeu|recebedor|quemrecebeu|favorecido|beneficiario|para)$/.test(
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
        /^(id\s|n[º°.]|identifica|autentica|dados da transa|atendimento|ouvidoria)/i.test(
          line,
        ) ||
        /^(origem|destino|dadosdopagador|pagador|quempagou|de|debitadoda|dadosdorecebedor|dadosdequemrecebeu|recebedor|quemrecebeu|favorecido|beneficiario|para)$/.test(
          key(line),
        ),
    );
    return end < 0 ? block : block.slice(0, end);
  };
  if (from >= 0) payer = participant(stop(lines.slice(from + 1, from + 12)));
  if (to >= 0) recipient = participant(stop(lines.slice(to + 1, to + 12)));
  if (itauSisPagCompleted && to >= 0 && !recipient.bank) {
    const institution = stop(lines.slice(to + 1, to + 12)).find(
      (line) =>
        line !== recipient.name &&
        /\b(?:ip|institui[cç][aã]o\s+(?:de\s+)?pagamento)\b/i.test(line),
    );
    if (institution)
      recipient = { ...recipient, bank: cleanParticipantBank(institution) };
  }
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
        bank: cleanParticipantBank(lines[bankAt].replace(/^banco\s*:\s*/i, '')),
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
  let bradescoOperationDate: string | null = null;
  if (bradescoNetEmpresaCompleted) {
    const corruptedAccent = '(?:[cç][aã]o|\\uFFFD+o|o)';
    const labelledValue = (label: RegExp) => {
      const index = lines.findIndex((line) => label.test(line));
      if (index < 0) return null;
      const inline = lines[index].replace(label, '').trim();
      if (inline) return inline;
      return lines[index + 1]?.trim() || null;
    };
    const company = labelledValue(/^empresa\s*:\s*/i)?.split(
      /\s*\|\s*(?:cpf|cnpj)\s*:/i,
    )[0];
    const recipientDocumentValue = labelledValue(/^cnpj\s*\/\s*cpf\s*:\s*/i);
    let recipientDocument = recipientDocumentValue?.replace(/\D/g, '') ?? '';
    // This corporate Bradesco layout pads a CNPJ with one leading zero.
    if (recipientDocument.length === 15 && recipientDocument.startsWith('0'))
      recipientDocument = recipientDocument.slice(1);
    const operationLabel = new RegExp(
      `^data\\s+da\\s+opera${corruptedAccent}\\s*:\\s*`,
      'i',
    );
    bradescoOperationDate =
      labelledValue(operationLabel)?.match(
        /\b\d{1,2}\/\d{1,2}\/\d{4}\s*-\s*\d{1,2}h\d{2}(?::\d{2})?\b/i,
      )?.[0] ?? null;
    payer = {
      name: cleanParticipantName(company),
      bank: cleanParticipantBank(
        labelledValue(
          new RegExp(`^institui${corruptedAccent}\\s+origem\\s*:\\s*`, 'i'),
        ),
      ),
      document: null,
    };
    recipient = {
      name: cleanParticipantName(
        labelledValue(/^nome\s+do\s+favorecido\s*:\s*/i),
      ),
      bank: cleanParticipantBank(
        labelledValue(
          new RegExp(`^institui${corruptedAccent}\\s+destino\\s*:\\s*`, 'i'),
        ),
      ),
      document: [11, 14].includes(recipientDocument.length)
        ? recipientDocument
        : null,
    };
  }
  const dates = transferDates.length
    ? transferDates
    : [
        ...(bradescoOperationDate ? [bradescoOperationDate] : []),
        ...(text.match(
          /\b\d{1,2}[/-](?:\d{1,2}|[a-zç]+)[/-]\d{4}\s*(?:[aà]s\s*)?\d{1,2}:\d{2}(?::\d{2})?\b/gi,
        ) ?? []),
        ...(text.match(
          /\b\d{1,2}\s+(?:jan(?:eiro)?|fev(?:ereiro)?|mar(?:[cç]o)?|abr(?:il)?|mai(?:o)?|jun(?:ho)?|jul(?:ho)?|ago(?:sto)?|set(?:embro)?|out(?:ubro)?|nov(?:embro)?|dez(?:embro)?)\.?\s+\d{4}\s*,?\s*\d{1,2}:\d{2}(?::\d{2})?\b/gi,
        ) ?? []),
      ];
  const participantStarts = [paired, from, to].filter((i) => i >= 0);
  const heading = participantStarts.length
    ? lines.slice(0, Math.min(...participantStarts)).join('\n')
    : '';
  // Ignore clearly promotional/footer values before determining uniqueness.
  // The amount extractor applies the same filter when selecting a value; the
  // filtered line collection also prevents an advertisement from fabricating
  // an ambiguity against a valid transaction.
  const amountLines = receiptAmountRelevantText(text)
    .split(/\r?\n/)
    .filter(Boolean);
  const amountHeading = receiptAmountRelevantText(heading);
  const receiptSectionStarts = lines
    .map((line, index) =>
      /^(?:comprovante|confirma[cç][aã]o)\s+(?:(?:de|do|da)\s+)?(?:pix|envio(?:\s+de)?\s+pix|transfer[eê]ncia|pagamento|transa[cç][aã]o)\b/i.test(
        `${line} ${lines[index + 1] ?? ''}`,
      )
        ? index
        : -1,
    )
    .filter((index) => index >= 0);
  const receiptSectionAmounts = receiptSectionStarts
    .map((start, index) => {
      const next = receiptSectionStarts[index + 1] ?? lines.length;
      return extractReceiptAmount(
        lines.slice(start, Math.min(next, start + 40)).join('\n'),
      );
    })
    .filter(Boolean);
  const headingAmounts = amountHeading
    .split('\n')
    .filter((line) => /R\s*[$S]/i.test(line))
    .map((line) => extractReceiptAmount(line))
    .filter(Boolean);
  const strongLayoutCurrencyAmounts =
    c6 || bradescoDebitedCompleted || bradescoNetEmpresaCompleted
      ? amountLines
          .filter((line) => /R\s*[$S]/i.test(line))
          .map((line) => extractReceiptAmount(line))
          .filter(Boolean)
      : [];
  const documentCurrencyAmounts = amountLines
    .filter((line) => /R\s*[$S]/i.test(line))
    .map((line) => extractReceiptAmount(line))
    .filter(Boolean);
  const suggestion =
    extractReceiptAmount(amountHeading) ?? extractReceiptAmount(text);
  const valueIndexes = lines
    .map((line, index) => (/^valor\s*:?$/i.test(line) ? index : -1))
    .filter((index) => index >= 0);
  const labelledAmount =
    valueIndexes.length === 1
      ? extractReceiptAmount(lines[valueIndexes[0] + 1] ?? '')
      : null;
  const uniqueHeadingAmounts = new Set(
    headingAmounts.map((amount) => amount!.amountCents),
  );
  const uniqueReceiptSectionAmounts = new Set(
    receiptSectionAmounts.map((amount) => amount!.amountCents),
  );
  const uniqueStrongLayoutCurrencyAmounts = new Set(
    strongLayoutCurrencyAmounts.map((amount) => amount!.amountCents),
  );
  const uniqueDocumentCurrencyAmounts = new Set(
    documentCurrencyAmounts.map((amount) => amount!.amountCents),
  );
  const ambiguous =
    uniqueIds.length > 1 ||
    observedIds.length > 1 ||
    (uniqueIds.length > 0 && observedIds.length > 0) ||
    mercadoPagoTransactionNumbers.length > 1 ||
    uniqueHeadingAmounts.size > 1 ||
    uniqueReceiptSectionAmounts.size > 1 ||
    uniqueStrongLayoutCurrencyAmounts.size > 1 ||
    uniqueDocumentCurrencyAmounts.size > 1;
  const uniqueAmount =
    !ambiguous &&
    suggestion !== null &&
    (suggestion.confidence === 'high' ||
      (uniqueHeadingAmounts.size === 1 &&
        headingAmounts[0]!.amountCents === suggestion.amountCents) ||
      (uniqueReceiptSectionAmounts.size === 1 &&
        receiptSectionAmounts[0]!.amountCents === suggestion.amountCents) ||
      (uniqueDocumentCurrencyAmounts.size === 1 &&
        documentCurrencyAmounts[0]!.amountCents === suggestion.amountCents) ||
      ((c6 || bradescoDebitedCompleted || bradescoNetEmpresaCompleted) &&
        (labelledAmount?.amountCents === suggestion.amountCents ||
          (uniqueStrongLayoutCurrencyAmounts.size === 1 &&
            strongLayoutCurrencyAmounts[0]!.amountCents ===
              suggestion.amountCents))));
  const details: ReceiptDocument = {
    version: 1,
    payerName: payer.name,
    payerBank: payer.bank,
    recipientName: recipient.name,
    recipientBank: recipient.bank,
    recipientDocument: recipient.document,
    transactionId: uniqueIds.length === 1 ? uniqueIds[0] : null,
    alternateTransactionId,
    observedTransactionId: observedIds.length === 1 ? observedIds[0] : null,
    paidAtText: new Set(dates).size === 1 ? (dates[0] ?? null) : null,
    state,
    // A unique amount is the financial evidence requested by the workflow.
    // Missing descriptive metadata or a missing generic completion phrase is
    // reported separately; only explicit negative states and ambiguity block.
    automaticEligible:
      uniqueAmount &&
      !ambiguous &&
      !(state === 'scheduled' || state === 'cancelled' || pending || rejected),
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
      'alternateTransactionId',
      'observedTransactionId',
      'paidAtText',
    ] as const) {
      if (
        (field === 'alternateTransactionId' ||
          field === 'observedTransactionId') &&
        doc[field] === undefined
      ) {
        result[field] = null;
        continue;
      }
      if (
        doc[field] !== null &&
        (typeof doc[field] !== 'string' || doc[field].length > 150)
      )
        return null;
      result[field] = doc[field];
    }
    if (
      result.transactionId !== null &&
      !/^E[A-Za-z0-9]{31}$/.test(result.transactionId)
    )
      return null;
    if (
      result.alternateTransactionId !== null &&
      !/^(?:mercado-pago:\d{12}|ocr-consensus:E[A-Za-z0-9]{32})$/.test(
        result.alternateTransactionId,
      )
    )
      return null;
    if (
      result.observedTransactionId !== null &&
      !/^E[A-Za-z0-9]{32}$/.test(result.observedTransactionId)
    )
      return null;
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
  const monthToken = date[2].normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  const month = /^\d+$/.test(monthToken)
    ? Number(monthToken)
    : months.findIndex((name) =>
        name
          .normalize('NFD')
          .replace(/[\u0300-\u036f]/g, '')
          .startsWith(monthToken),
      ) + 1;
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
    [
      'Identificador da instituição',
      doc.alternateTransactionId?.startsWith('mercado-pago:')
        ? doc.alternateTransactionId.slice('mercado-pago:'.length)
        : null,
    ],
  ].map(([label, value]) => `${label}: ${value || 'Não identificado'}`);
}

export function preferReceiptReading(
  readings: Array<ReturnType<typeof extractReceiptDocument>>,
) {
  const found = readings.filter((reading) => reading.amountCents !== null);
  const completed = (reading: (typeof found)[number]) =>
    reading.details.automaticEligible && reading.details.state === 'completed';
  const preferred =
    found.find(
      (reading) =>
        completed(reading) &&
        reading.details.recipientBank &&
        reading.details.recipientDocument,
    ) ??
    found.find(
      (reading) => completed(reading) && reading.details.recipientBank,
    ) ??
    found.find(completed) ??
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
      ? (found.find((candidate) => {
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
        })?.details.recipientBank ?? null)
      : null;
  const amountConflict =
    new Set(found.map((reading) => reading.amountCents)).size > 1;
  const evidenceAliasSets = found
    .map((reading) => new Set(receiptEvidenceAliases(reading.details)))
    .filter((aliases) => aliases.size > 0);
  const connectedAliases = new Set(evidenceAliasSets[0] ?? []);
  const disconnectedAliasSets = evidenceAliasSets.slice(1);
  for (let changed = true; changed;) {
    changed = false;
    for (let index = disconnectedAliasSets.length - 1; index >= 0; index--) {
      const aliases = disconnectedAliasSets[index];
      if (![...aliases].some((alias) => connectedAliases.has(alias))) continue;
      aliases.forEach((alias) => connectedAliases.add(alias));
      disconnectedAliasSets.splice(index, 1);
      changed = true;
    }
  }
  const idConflict = disconnectedAliasSets.length > 0;
  const observedIds = found
    .map((reading) => reading.details.observedTransactionId)
    .filter((id): id is string => Boolean(id));
  const observedConsensus =
    observedIds.length >= 2 && new Set(observedIds).size === 1
      ? observedIds[0]
      : null;
  const consensusEligible =
    Boolean(observedConsensus) &&
    evidenceAliasSets.length === 0 &&
    found.every(
      (reading) =>
        reading.amountCents === preferred.amountCents &&
        reading.details.state === 'completed' &&
        !reading.details.blocked &&
        !reading.details.ambiguous,
    );
  const blocked = readings.some((reading) => reading.details.blocked);
  const ambiguous =
    amountConflict ||
    idConflict ||
    (evidenceAliasSets.length === 0 && new Set(observedIds).size > 1) ||
    readings.some((reading) => reading.details.ambiguous);
  return {
    ...preferred,
    details: {
      ...preferred.details,
      recipientBank: preferred.details.recipientBank ?? bankEnrichment,
      alternateTransactionId:
        preferred.details.alternateTransactionId ??
        (consensusEligible ? `ocr-consensus:${observedConsensus}` : null),
      blocked,
      ambiguous,
      automaticEligible:
        (preferred.details.automaticEligible || consensusEligible) &&
        !blocked &&
        !ambiguous,
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
