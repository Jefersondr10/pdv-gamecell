export type SystemCatalogCode = {
  value: string;
  market: string;
};

export type SystemCatalogProduct = {
  key: string;
  model: string;
  color: string;
  memory: string;
  codes: readonly SystemCatalogCode[];
};

// Increment this whenever a verified variation or commercial code changes.
// Stores receive each version once, without changing their prices or active state.
export const SYSTEM_CATALOG_VERSION = 1;

type CatalogColor = {
  color: string;
  usa: readonly string[];
  japan: readonly string[];
};

const IPHONE_16 = family(
  'iPhone 16',
  ['128 GB', '256 GB', '512 GB'],
  [
    {
      color: 'Preto',
      usa: ['195949820908', '195949820953', '195949821004'],
      japan: ['4549995539042', '4549995539097', '4549995539141'],
    },
    {
      color: 'Branco',
      usa: ['195949820915', '195949820960', '195949821011'],
      japan: ['4549995539059', '4549995539103', '4549995539158'],
    },
    {
      color: 'Rosa',
      usa: ['195949820922', '195949820977', '195949821028'],
      japan: ['4549995539066', '4549995539110', '4549995539165'],
    },
    {
      color: 'Ultramarino',
      usa: ['195949820939', '195949820984', '195949821035'],
      japan: ['4549995539073', '4549995539127', '4549995539172'],
    },
    {
      color: 'Verde-azulado',
      usa: ['195949820946', '195949820991', '195949821042'],
      japan: ['4549995539080', '4549995539134', '4549995539189'],
    },
  ],
);

const IPHONE_16_PLUS = family(
  'iPhone 16 Plus',
  ['128 GB', '256 GB', '512 GB'],
  [
    {
      color: 'Preto',
      usa: ['195949721496', '195949721540', '195949721595'],
      japan: ['4549995525366', '4549995525618', '4549995525861'],
    },
    {
      color: 'Branco',
      usa: ['195949721502', '195949721557', '195949721601'],
      japan: ['4549995525410', '4549995525663', '4549995525915'],
    },
    {
      color: 'Rosa',
      usa: ['195949721519', '195949721564', '195949721618'],
      japan: ['4549995525465', '4549995525717', '4549995525960'],
    },
    {
      color: 'Ultramarino',
      usa: ['195949721526', '195949721571', '195949721625'],
      japan: ['4549995525519', '4549995525762', '4549995526011'],
    },
    {
      color: 'Verde-azulado',
      usa: ['195949721533', '195949721588', '195949721632'],
      japan: ['4549995525564', '4549995525816', '4549995526066'],
    },
  ],
);

const IPHONE_16_PRO = family(
  'iPhone 16 Pro',
  ['128 GB', '256 GB', '512 GB', '1 TB'],
  [
    {
      color: 'Titânio preto',
      usa: ['195949770234', '195949770272', '195949770319', '195949770357'],
      japan: [
        '4549995532463',
        '4549995532661',
        '4549995532869',
        '4549995533064',
      ],
    },
    {
      color: 'Titânio branco',
      usa: ['195949770241', '195949770289', '195949770326', '195949770364'],
      japan: [
        '4549995532517',
        '4549995532715',
        '4549995532913',
        '4549995533118',
      ],
    },
    {
      color: 'Titânio-deserto',
      usa: ['195949770258', '195949770296', '195949770333', '195949770371'],
      japan: [
        '4549995532562',
        '4549995532760',
        '4549995532968',
        '4549995533163',
      ],
    },
    {
      color: 'Titânio natural',
      usa: ['195949770265', '195949770302', '195949770340', '195949770388'],
      japan: [
        '4549995532616',
        '4549995532814',
        '4549995533019',
        '4549995533217',
      ],
    },
  ],
);

const IPHONE_16E = family(
  'iPhone 16e',
  ['128 GB', '256 GB', '512 GB'],
  [
    {
      color: 'Preto',
      usa: ['195950051629', '195950051643', '195950051667'],
      japan: ['4549995558999', '4549995559019', '4549995559033'],
    },
    {
      color: 'Branco',
      usa: ['195950051636', '195950051650', '195950051674'],
      japan: ['4549995559002', '4549995559026', '4549995559040'],
    },
  ],
);

const IPHONE_17 = family(
  'iPhone 17',
  ['256 GB', '512 GB'],
  [
    {
      color: 'Preto',
      usa: ['195950642803', '195950642858'],
      japan: ['4549995649154', '4549995649208'],
    },
    {
      color: 'Branco',
      usa: ['195950642810', '195950642865'],
      japan: ['4549995649161', '4549995649215'],
    },
    {
      color: 'Azul-névoa',
      usa: ['195950642827', '195950642872'],
      japan: ['4549995649178', '4549995649222'],
    },
    {
      color: 'Lavanda',
      usa: ['195950642834', '195950642889'],
      japan: ['4549995649185', '4549995649239'],
    },
    {
      color: 'Sálvia',
      usa: ['195950642841', '195950642896'],
      japan: ['4549995649192', '4549995649246'],
    },
  ],
);

const IPHONE_AIR = family(
  'iPhone Air',
  ['256 GB', '512 GB', '1 TB'],
  [
    {
      color: 'Preto-espacial',
      usa: ['195950621303', '195950621464', '195950621624'],
      japan: ['4549995647501', '4549995647549', '4549995647587'],
    },
    {
      color: 'Branco-nuvem',
      usa: ['195950621341', '195950621501', '195950621662'],
      japan: ['4549995647518', '4549995647556', '4549995647594'],
    },
    {
      color: 'Dourado-claro',
      usa: ['195950621389', '195950621549', '195950621709'],
      japan: ['4549995647525', '4549995647563', '4549995647600'],
    },
    {
      color: 'Azul-céu',
      usa: ['195950621426', '195950621587', '195950621747'],
      japan: ['4549995647532', '4549995647570', '4549995647617'],
    },
  ],
);

const IPHONE_17_PRO = family(
  'iPhone 17 Pro',
  ['256 GB', '512 GB', '1 TB'],
  [
    {
      color: 'Prateado',
      usa: ['195950626162', '195950626193', '195950626223'],
      japan: ['4549995648294', '4549995648324', '4549995648355'],
    },
    {
      color: 'Laranja-cósmico',
      usa: ['195950626179', '195950626209', '195950626230'],
      japan: ['4549995648300', '4549995648331', '4549995648362'],
    },
    {
      color: 'Azul-intenso',
      usa: ['195950626186', '195950626216', '195950626247'],
      japan: ['4549995648317', '4549995648348', '4549995648379'],
    },
  ],
);

const IPHONE_17_PRO_MAX = family(
  'iPhone 17 Pro Max',
  ['256 GB', '512 GB', '1 TB', '2 TB'],
  [
    {
      color: 'Prateado',
      usa: ['195950637151', '195950638028', '195950638059', '195950638080'],
      japan: [
        '4549995649284',
        '4549995649314',
        '4549995649345',
        '4549995649376',
      ],
    },
    {
      color: 'Laranja-cósmico',
      usa: ['195950638004', '195950638035', '195950638066', '195950638097'],
      japan: [
        '4549995649291',
        '4549995649321',
        '4549995649352',
        '4549995649383',
      ],
    },
    {
      color: 'Azul-intenso',
      usa: ['195950638011', '195950638042', '195950638073', '195950638103'],
      japan: [
        '4549995649307',
        '4549995649338',
        '4549995649369',
        '4549995649390',
      ],
    },
  ],
);

const IPHONE_17E = family(
  'iPhone 17e',
  ['256 GB', '512 GB'],
  [
    {
      color: 'Preto',
      usa: ['195951041155', '195951041186'],
      japan: ['4549995677485', '4549995677638'],
    },
    {
      color: 'Branco',
      usa: ['195951041162', '195951041193'],
      japan: ['4549995677539', '4549995677683'],
    },
    {
      color: 'Rosa-pálido',
      usa: ['195951041179', '195951041209'],
      japan: ['4549995677584', '4549995677737'],
    },
  ],
);

export const SYSTEM_CATALOG_PRODUCTS: readonly SystemCatalogProduct[] = [
  ...IPHONE_16,
  ...IPHONE_16_PLUS,
  ...IPHONE_16_PRO,
  ...IPHONE_16E,
  ...IPHONE_17,
  ...IPHONE_AIR,
  ...IPHONE_17_PRO,
  ...IPHONE_17_PRO_MAX,
  ...IPHONE_17E,
];

function family(
  model: string,
  memories: readonly string[],
  colors: readonly CatalogColor[],
): SystemCatalogProduct[] {
  return colors.flatMap(({ color, usa, japan }) =>
    memories.map((memory, index) => ({
      key: [model, color, memory].map(catalogKeyPart).join('-'),
      model,
      color,
      memory,
      codes: [
        { value: usa[index] ?? '', market: 'Estados Unidos' },
        { value: japan[index] ?? '', market: 'Japão' },
      ],
    })),
  );
}

function catalogKeyPart(value: string) {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}
