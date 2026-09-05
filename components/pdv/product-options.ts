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
  'Laranja',
  'Preto',
  'Branco',
  'Azul',
  'Azul ultramarino',
  'Verde',
  'Rosa',
  'Amarelo',
  'Vermelho',
  'Roxo',
  'Meia-noite',
  'Branco estelar',
  'Prata',
  'Dourado',
  'Grafite',
  'Titânio natural',
  'Titânio deserto',
] as const;

export function appleMemoryOptions(current?: string) {
  const options: string[] = [...APPLE_MEMORY_OPTIONS];
  if (current && !options.includes(current)) options.unshift(current);
  return options;
}
