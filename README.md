# PDV Gamecell

Sistema de gestão de lojas com vendas, estoque, pagamentos, despesas e fechamento financeiro. Interface em português, adaptada para computadores e celulares.

## Recursos

- Lojas independentes, usuários e permissões por loja; acesso Google configurável e login da equipe.
- Cadastros de clientes, produtos, fornecedores, vendedores, contas Pix e máquinas de cartão.
- Vendas com rascunho, classificação de atacado, data editável, correções auditadas e cancelamento.
- Pagamentos divididos entre dinheiro, Pix e cartão, com fotografia das taxas utilizadas.
- Estoque por entradas e custo FIFO, histórico, busca de produtos e relatório.
- Despesas fixas e variáveis, categorias e subcategorias, lembretes e fechamento com participação dos sócios.
- Calculadora de parcelamento e pedido compartilhável sem custos ou lucro internos.

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
- Cancelar uma venda preserva o histórico e pode gerar devolução pendente. Não há estorno bancário automático nem baixa de devoluções realizadas.
- Os pagamentos são registros operacionais, sem confirmação automática por bancos ou adquirentes.
- O caixa disponível precisa ser conferido: lucro não equivale a saldo bancário.
- Relatórios para PDF utilizam a impressão do navegador. Testes automatizados não substituem validação operacional e visual.

O histórico interno de implantação e os dados da loja não integram esta publicação.
