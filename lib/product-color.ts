// UI approximations of device finishes, not manufacturer color specifications.
// Specific names must precede generic colors (e.g. verde-azulado before azul).
const NAMED_COLORS: Array<[RegExp, string]> = [
  [/bordo|burgundy/, '#6b3445'],
  [/glacial|glacier/, '#b6d2dc'],
  [/lavanda|lavender/, '#b9abd9'],
  [/rosa[- ]?palido|soft pink|pale pink/, '#f2dce5'],
  [/rosa|pink/, '#eda4cc'],
  [/verde[- ]?(?:azulado|acinzentado)|teal/, '#91b9b2'],
  [/ultramarino|ultramarine/, '#8897d4'],
  [/azul[- ]?intenso|deep blue/, '#394768'],
  [/azul[- ]?ceu|sky blue/, '#b6cddd'],
  [/azul[- ]?nevoa|mist blue/, '#b8c5db'],
  [/azul|blue/, '#6796c4'],
  [/salvia|sage/, '#aeb9a0'],
  [/verde|green/, '#85aa8c'],
  [/laranja|orange|coral/, '#eb925e'],
  [/amarelo|yellow/, '#ecd779'],
  [/vermelho|red/, '#d43d4c'],
  [/roxo|purple|violeta/, '#a08ccc'],
  [/meia[- ]?noite|midnight|preto|black/, '#30343b'],
  [/branco[- ]?nuvem|cloud white/, '#f3f3ef'],
  [/branco estelar|starlight/, '#ede7d9'],
  [/branco|white/, '#f1f2f0'],
  [/prateado|prata|silver/, '#cdd1d4'],
  [/dourado[- ]?claro|light gold/, '#e7d9bd'],
  [/dourado|gold/, '#d5bc8c'],
  [/deserto|desert/, '#cfb9a3'],
  [/natural/, '#b8b4aa'],
  [/grafite|graphite|cinza|gray|grey/, '#777b80'],
];

function normalize(value: string) {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[\u2010-\u2015]/g, '-')
    .toLowerCase();
}

export function productColorValue(color: string, model = '') {
  const name = normalize(color);
  // The base 15 uses lighter finishes than the similarly named base 16.
  if (/^iphone\s*15(?:\s+plus)?$/i.test(model.trim())) {
    const finishes: Array<[RegExp, string]> = [
      [/rosa|pink/, '#f2cddd'],
      [/azul|blue/, '#d5e5e9'],
      [/verde|green/, '#d5dfca'],
      [/amarelo|yellow/, '#ede8c7'],
      [/preto|black/, '#363a3d'],
    ];
    const finish = finishes.find(([pattern]) => pattern.test(name));
    if (finish) return finish[1];
  }
  if (
    /^iphone\s*16(?:\s+plus)?$/i.test(model.trim()) &&
    /rosa|pink/.test(name)
  ) {
    return '#ed9bcc';
  }
  // Unknown names must not invent an unrelated colored dot.
  return NAMED_COLORS.find(([pattern]) => pattern.test(name))?.[1] ?? '#cbd0d6';
}
