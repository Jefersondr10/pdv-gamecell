# PDV Gamecell

Sistema de gestão de lojas com vendas, estoque, pagamentos, despesas e fechamento financeiro. Interface em português, adaptada para computadores e celulares.

## Recursos

- Lojas independentes, usuários e permissões por loja; acesso Google configurável e login da equipe.
- Cadastros de clientes, produtos, fornecedores, vendedores, contas Pix e máquinas de cartão.
- Vendas com rascunho, classificação de atacado, data editável, status A conferir/Conciliado, correções auditadas e cancelamento.
- Filtros de vendas e dashboard por período, atacado/varejo, vendedor, status e busca por número, cliente ou produto.
- Ranking próprio de vendedores, produtos e dias por faturamento, lucro ou número de vendas, usando os mesmos filtros das vendas.
- Edição de clientes com CPF opcional, proteção contra alterações simultâneas e histórico de auditoria.
- Busca nos cadastros de clientes e produtos; edição de produtos e cadastro de novo produto durante a venda.
- Pagamentos divididos entre dinheiro, Pix e cartão, com fotografia das taxas utilizadas.
- Estoque por entradas e custo FIFO, histórico, busca de produtos e relatório.
- Controle opcional por SN/IMEI: um cadastro por modelo, entrada com custo por aparelho e escolha da unidade vendida.
- Navegação entre menus com retomada do preenchimento da venda na mesma aba, sem confirmação automática.
- Despesas fixas e variáveis, categorias e subcategorias, lembretes e fechamento com participação dos sócios.
- Calculadora de 1 a 18 parcelas em duas etapas: preenchimento e resultado, com juros adicionais internos opcionais e cópia para WhatsApp sem expor taxas.
- Pedido compartilhável sem custos ou lucro internos.

## Executar localmente

Recomendado: Node.js 24 LTS e npm. O projeto usa módulos ES e SQLite com `node:sqlite`.

```sh
npm ci
npm test
npm start
```

Abra http://127.0.0.1:3000. Em desenvolvimento, o cadastro inicial cria uma loja independente. Use dados fictícios para testar.

Os dados locais ficam em `data/pdv.sqlite`, que não faz parte deste repositório. Para personalizar a configuração, crie um arquivo `.env` a partir de `.env.example` e execute:

```sh
node --env-file=.env src/server.mjs
```

Não utilize senhas de demonstração em instalações reais.

## Prévia mobile isolada

```sh
node scripts/preview-mobile.mjs
```

Abra http://127.0.0.1:3011/mobile-preview. Essa prévia usa somente dados fictícios em memória, apagados quando o processo termina. O login de demonstração está definido no próprio script, exclusivamente para essa prévia local.

## Estrutura

- `src/`: servidor, regras de negócio, autenticação e persistência.
- `public/`: interface e recursos visuais.
- `tests/`: testes de domínio, HTTP e contratos de interface.
- `scripts/`: ferramentas de desenvolvimento, prévia e manutenção.
- `Dockerfile`: imagem da aplicação; não contém banco ou segredos de produção.

## Segurança e dados

Bancos, backups, logs, credenciais, arquivos de ambiente reais e anotações internas de operação não são versionados. As taxas nas demonstrações e testes são fictícias; cada loja deve cadastrar suas próprias condições.

Para produção são necessários HTTPS, login Google configurado, banco persistente existente, isolamento do servidor, política de acesso e backups testados. As verificações de configuração estão em `src/config.mjs`. Não exponha diretamente a prévia de desenvolvimento à internet. Adapte a identidade visual e a política de privacidade antes de usar uma instalação própria.

## Limites importantes

- Este repositório contém o código em desenvolvimento; um envio ao GitHub não atualiza automaticamente uma instalação online.
- Cancelar uma venda preserva o histórico e desfaz automaticamente no sistema o estoque, os pagamentos e os totais daquele pedido. O cancelamento pressupõe que o acerto com o cliente já foi feito fora do sistema.
- Os pagamentos são registros operacionais, sem confirmação automática por bancos ou adquirentes.
- Preenchimentos não salvos ficam somente na aba atual. Para conservar uma nova venda após fechar a aba, use Salvar rascunho; para aplicar uma edição, use Salvar alterações.
- Produtos com controle por SN/IMEI exigem aparelhos identificados antes de confirmar a saída. O estoque antigo não ganha identificações inventadas: os números reais das unidades restantes devem ser informados nas entradas.
- O caixa disponível precisa ser conferido: lucro não equivale a saldo bancário.
- Relatórios para PDF utilizam a impressão do navegador. Testes automatizados não substituem validação operacional e visual.

O histórico interno de implantação e os dados da loja não integram esta publicação.
