/** Public offer fields only: never serials, costs, customers or attachments. */
export type StockOfferRow = {
  model: string;
  color: string;
  memory: string;
  defaultPriceCents: number;
};

export type StockOfferResponse = {
  rows: StockOfferRow[];
  generatedAt: number;
};

function lineText(value: string) {
  // Product labels cannot insert WhatsApp formatting or extra message sections.
  return value
    .replace(/[\r\n\t*_~`\u200b-\u200f\u202a-\u202e\u2066-\u2069]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function normalized(value: string) {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLocaleLowerCase('pt-BR');
}

export function stockColorEmoji(color: string) {
  const name = normalized(color);
  const colors: Array<[RegExp, string]> = [
    [/laranja|orange|coral/, '🟠'],
    [/lavanda|lavender|roxo|purple|violeta/, '🟣'],
    [/rosa|pink/, '🩷'],
    [/verde[- ]?(?:azulado|acinzentado)|teal/, '🟢'],
    [/azul|blue|ultramarino|ultramarine/, '🔵'],
    [/verde|green|salvia|sage|teal/, '🟢'],
    [/amarelo|yellow|dourado|gold/, '🟡'],
    [/vermelho|red/, '🔴'],
    [/preto|black|meia[- ]?noite|midnight|grafite|graphite/, '⚫'],
    [/prateado|prata|silver|cinza|gray|grey|natural/, '🩶'],
    [/branco|white|estelar|starlight/, '⚪'],
    [/deserto|desert|marrom|brown/, '🟤'],
  ];
  return colors.find(([pattern]) => pattern.test(name))?.[1] ?? '▫️';
}

export function buildStockWhatsAppMessage(
  response: StockOfferResponse,
  storeName: string,
) {
  // Model + memory + exact price form a group. Different prices must not share colors.
  const groups = new Map<
    string,
    {
      model: string;
      memory: string;
      price: number;
      colors: Map<string, string>;
    }
  >();
  for (const row of response.rows) {
    const model = lineText(row.model);
    const memory = lineText(row.memory).replace(/\s+/g, '').toUpperCase();
    const color = lineText(row.color) || 'Cor não informada';
    const price =
      Number.isSafeInteger(row.defaultPriceCents) && row.defaultPriceCents > 0
        ? row.defaultPriceCents
        : 0;
    const key = JSON.stringify([normalized(model), normalized(memory), price]);
    const group = groups.get(key) ?? {
      model,
      memory,
      price,
      colors: new Map<string, string>(),
    };
    group.colors.set(normalized(color), color);
    groups.set(key, group);
  }
  if (groups.size === 0) return '';
  const compare = new Intl.Collator('pt-BR', {
    numeric: true,
    sensitivity: 'base',
  });
  const memorySize = (memory: string) => {
    const match = memory.match(/^(\d+(?:[.,]\d+)?)(GB|TB)$/);
    return match
      ? Number(match[1].replace(',', '.')) * (match[2] === 'TB' ? 1024 : 1)
      : 0;
  };
  const sorted = [...groups.values()].sort(
    (a, b) =>
      compare.compare(a.model, b.model) ||
      memorySize(a.memory) - memorySize(b.memory) ||
      compare.compare(a.memory, b.memory) ||
      (a.price || Infinity) - (b.price || Infinity),
  );
  const money = new Intl.NumberFormat('pt-BR', {
    style: 'currency',
    currency: 'BRL',
  });
  const updated = new Intl.DateTimeFormat('pt-BR', {
    timeZone: 'America/Sao_Paulo',
    dateStyle: 'short',
    timeStyle: 'short',
  }).format(response.generatedAt);
  const sections = sorted.map((group) =>
    [
      `*${group.model}${group.memory ? ` · ${group.memory}` : ''}*`,
      `*${group.price ? money.format(group.price / 100).replace(/\u00a0/g, ' ') : 'Preço sob consulta'}*`,
      [...group.colors.values()]
        .sort((a, b) => compare.compare(a, b))
        .map((color) => `${stockColorEmoji(color)} ${color}`)
        .join(' · '),
    ].join('\n'),
  );
  return [
    `📱 *${lineText(storeName) || 'ESTOQUE DISPONÍVEL'}*\n*ESTOQUE E PREÇOS*\n_Atualizado em ${updated}_`,
    ...sections,
    '⚠️ *Preços e disponibilidade sujeitos a alteração.*\nConfirme a disponibilidade e os dados de pagamento com o vendedor antes de comprar.',
  ].join('\n\n');
}
