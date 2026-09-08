# Catálogo regional — verificação de 08/09/2026

Versão 3: 108 códigos comerciais adicionais, 350 GTINs únicos ao todo, mantendo as 116 combinações de modelo/cor/memória existentes. A sincronização apenas acrescenta referências: não cria estoque e não altera preços, situação ativa, códigos manuais ou vendas das lojas.

Cada código adicional tem part number e fontes públicas individuais em `lib/system-catalog-regional.ts`. Nenhum código foi gerado por sequência. A validação automatizada confere dígito verificador, unicidade entre variantes, correspondência exata da variante e limite de códigos por produto.

## Cobertura desta rodada

- Brasil: 22 códigos. iPhone 17 base completo (10); iPhone 16 base 128/256 GB (10); iPhone 16e 128 GB (2).
- Índia: 71 códigos distintos, incluindo os 10 também encontrados em ofertas paraguaias. iPhone 17 base, 17 Pro, 17 Pro Max, 16 base, 16e e 17e completos; Air 11 de 12 variações; duas referências adicionais do iPhone 15.
- China continental: 10 códigos CH/A do iPhone 15 base, todas as cinco cores em 128/256 GB.
- Vendidos no Paraguai: 15 referências de aparelhos importados HN/A, BE/A ou VC/A. Oito também estão no lote indiano e foram unificadas; não há duplicação do GTIN.

## Limites importantes

“Vendido no Paraguai” identifica o mercado onde a oferta foi verificada, não uma versão exclusiva paraguaia. O país de fabricação não é determinado pelo prefixo do código de barras. Pacotes de mercados diferentes podem ter códigos diferentes para a mesma combinação comercial.

Continuam sem cobertura completa: Brasil 16 512 GB e linhas Pro/Pro Max, Índia Air azul-céu 1 TB, China 15 512 GB, China 16/17 e demais referências não explicitamente comprovadas. Códigos futuros devem ser confirmados pela embalagem ou por fonte que identifique conjuntamente GTIN, part number, modelo, cor e memória.

A Relise mostra alguns códigos chineses como EAN-13 com zero inicial; o catálogo guarda o UPC-A equivalente, mantendo a normalização para 14 dígitos no banco. Exemplo: `0195949034701` e `195949034701` identificam o mesmo GTIN. Há páginas de varejo com descrições copiadas de outra região; quando necessário foram cruzadas fontes que mostram SKU e código explicitamente, como o iPhone 17 Pro Max 512 GB azul-intenso MFYU4BE/A.

## Referências de metodologia e amostras

- [GS1 — prefixos não indicam país de origem](https://support.gs1.org/support/solutions/articles/43000734188-does-the-gs1-prefix-first-3-digits-of-the-ean-13-barcode-number-show-the-country-of-origin-)
- [Fast Shop — iPhone 17 preto 256 GB BR/A](https://site.fastshop.com.br/iphone-17-apple--256gb--preto--tela-de-6-3---5g-e-camera-de-48mp-aemg6j4brapto_prd-167316/p)
- [Inspire — iPhone 17 preto 256 GB HN/A](https://inspireonline.in/products/iphone-17-mg6j4hn-a)
- [Relise — iPhone 15 preto 128 GB CH/A](https://relise.ru/smartfony/smartfony-apple/smartfon-apple-mtld3ch-a-26469-02)
- [iShop — MFYU4BE/A com código explícito](https://cr.tiendasishop.com/products/iphone-17-pro-mfyu4be-a)
