export const APPLE_MEMORY_OPTIONS = [
  '16 GB',
  '32 GB',
  '64 GB',
  '128 GB',
  '256 GB',
  '512 GB',
  '1 TB',
  '2 TB',
] as const;

export const APPLE_COLOR_SUGGESTIONS = [
  'Laranja-cósmico',
  'Laranja',
  'Azul-intenso',
  'Azul-névoa',
  'Azul-céu',
  'Preto',
  'Preto-espacial',
  'Branco',
  'Branco-nuvem',
  'Azul',
  'Azul ultramarino',
  'Sálvia',
  'Verde',
  'Verde-azulado',
  'Rosa',
  'Amarelo',
  'Vermelho',
  'Roxo',
  'Meia-noite',
  'Branco estelar',
  'Prata',
  'Prateado',
  'Dourado-claro',
  'Dourado',
  'Grafite',
  'Titânio natural',
  'Titânio deserto',
  'Titânio branco',
  'Titânio preto',
] as const;

export const PRODUCT_MARKET_OPTIONS = [
  'Brasil',
  'Canadá',
  'China continental',
  'Estados Unidos',
  'Europa — Alemanha',
  'Europa — Portugal/Espanha',
  'Europa — Países Baixos',
  'Hong Kong',
  'Japão',
  'México',
  'Reino Unido',
  'Internacional',
] as const;

export function appleMemoryOptions(current?: string) {
  const options: string[] = [...APPLE_MEMORY_OPTIONS];
  if (current && !options.includes(current)) options.unshift(current);
  return options;
}
