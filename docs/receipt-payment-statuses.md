# Comprovantes, preços e status da venda

## Precedência do total pago

- Um novo envio de comprovantes ou correção explícita de valores cria uma solicitação persistida de atualização do pagamento, desde que o usuário tenha permissão de pagamentos.
- O servidor espera todos os comprovantes ativos terem valores positivos; nunca usa uma soma parcial. Fotos de aparelhos não entram nessa soma.
- Com um pagamento, ajusta seu valor e mantém a forma/conta. Com vários, exige a escolha explícita de qual pagamento absorve a diferença.
- Uma edição manual de pagamento posterior invalida a solicitação anterior, inclusive se a leitura terminar depois. Repetir uma operação antiga não reativa a solicitação.
- Se pagamento e comprovantes forem salvos juntos, a correção manual prevalece. A proteção persiste nas tentativas após falha parcial.
- Usuários sem permissão de pagamentos não podem aproveitar uma solicitação pendente de outra pessoa para modificar valores financeiros.
- Excluir comprovante não exclui nem reduz pagamentos. Para aplicar comprovantes já salvos, use **Usar total dos comprovantes**.
- Ao substituir um arquivo, exclua o anterior: todos os comprovantes ativos são somados. A conferência documental não confirma crédito bancário nem autenticidade do arquivo.

## Preços e status

Em Vendas → abrir venda → Editar → Preços desta venda, quem possui `sales.prices` pode alterar cada preço por SN. O total vendido é recalculado sem alterar pagamentos, estoque ou preço padrão. A prévia compara o novo total com pagamentos e comprovantes; salvar atualiza o status.

Os status automáticos são padrão para todas as lojas, não são registros editáveis em `order_statuses`. A prioridade é: Cancelado, Sem valor de venda, Sem comprovante, Verificar comprovante, Comprovante em leitura, Pagamento pendente, Pagamento acima da venda, Sem foto do aparelho, Conciliado. Outras pendências continuam visíveis nos detalhes. Conciliação completa requer preços válidos, pagamentos e comprovantes coincidentes e foto em cada aparelho. Um valor manual válido prevalece sobre o estado de uma leitura antiga.

Os acompanhamentos personalizados existentes são preservados e identificados separadamente. Não substituem o status automático. O filtro legado `pending` continua abrangendo todas as pendências. SQL e interface usam a mesma prioridade, verificada por testes.

## Publicação

A migração aditiva `0014_receipt_payment_sync` deve ser aplicada no Hostinger antes de disponibilizar esta versão. Não altera pagamentos existentes. O procedimento `scripts/hostinger/deploy-receipts-prices.sh` executa a cadeia com cópia de segurança local e mantém os dados atuais em caso de retorno da aplicação anterior. O processamento financeiro roda no servidor independentemente de o navegador permanecer aberto.

Validações: `test:receipt-payment-sync`, `test:sale-status`, `test:original-sale-payments`, `test:sale-prices`, `test:receipt-delete`, `test:receipt-migration`, `test:sales-filters`, `test:sales-pdf`, TypeScript/lint e integração completa em banco sintético (`scripts/verify-isolated-production.mjs`, após `build:vps`). Não usar lojas reais para testes.
