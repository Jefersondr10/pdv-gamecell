# Renovação visual — prévia local

## Alterações

- Base visual neutra, ações azuis, menu lateral escuro, estados ativos coerentes.
- Barra superior no computador, cartões e formulários com bordas e espaçamento mais leves.
- Menus e janelas com contraste e profundidade; foco de teclado preservado.
- Menu de ações da venda com texto em uma linha.
- Cartões de vendas empilhados em telas pequenas para não cortar cliente ou valores.
- Componentes compartilhados aplicam o estilo a vendas, entradas, estoque, cadastros e configurações.
- Estrutura dos relatórios e estilos de impressão preservados.

## Catálogo

32 variações do iPhone 18 Pro/Pro Max e 42 códigos comerciais. Ver catalog-iphone-18.md.
Sincronização preserva produtos existentes, preços, estado ativo e estoque.

## Verificação

- Navegação local: Vender, Nova entrada, Ranking, Comprovantes, Estoque, Vendas, Cadastros, Histórico de entradas e Configurações.
- Layouts em 1440×900, 390×844 e 320×740; menu da venda legível em 320 px.
- Busca por iPhone 18 retorna 32 variações; UPC 195951414713 identifica Pro / Prateado / 256 GB na entrada.
- Nenhuma entrada ou venda foi confirmada durante o teste do leitor. Câmera física não disponível neste ambiente.
- Testes: catálogo, sincronização do catálogo, scanner, permissões, preços, Pix automático, sincronização de pagamentos, navegação de retorno e visão de comprovantes.
- Tipagem, lint, guardas de interface e build VPS verificados.

## Falha pré-existente identificada na validação

O menu Comprovantes falhava no ambiente D1 local com SQLITE_TOOBIG: consulta acima do limite de tamanho.
A consulta agora reutiliza a soma já calculada de dinheiro/comprovantes e as pendências para derivar o status, sem repetir os mesmos predicados.
Os testes existentes de valores, filtros, conciliação, cancelamento, paginação e isolamento entre lojas passaram com uma nova limitação de 100 KB para cada consulta.
A tela foi reaberta com sucesso no navegador após a correção.

## Publicação

Alterações somente locais nesta entrega. Nenhuma publicação ou alteração da base de produção.
