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

Em Vendas → abrir venda → Produtos → **Editar preços**, quem possui `sales.prices` pode alterar cada preço por SN diretamente nos detalhes. O acesso anterior em Editar → Preços desta venda continua disponível. O total vendido é recalculado sem alterar pagamentos, estoque ou preço padrão. A prévia compara o novo total com pagamentos e comprovantes; salvar atualiza o status. A edição destaca os itens modificados, impede sair enquanto salva e exige salvar ou cancelar antes de outra ação. Valores negativos digitados são rejeitados, não convertidos para positivos.

Os status automáticos são padrão para todas as lojas, não são registros editáveis em `order_statuses`. A prioridade é: Cancelado, Sem valor de venda, Sem comprovante, Verificar comprovante, Comprovante em leitura, Pagamento pendente, Pagamento acima da venda, Sem foto do aparelho, Conciliado. Outras pendências continuam visíveis nos detalhes. Conciliação completa requer preços válidos, pagamentos e comprovantes coincidentes e foto em cada aparelho. Um valor manual válido prevalece sobre o estado de uma leitura antiga.

Os acompanhamentos personalizados existentes são preservados e identificados separadamente. Não substituem o status automático. O filtro legado `pending` continua abrangendo todas as pendências. SQL e interface usam a mesma prioridade, verificada por testes.

## Publicação

A migração aditiva `0014_receipt_payment_sync` deve ser aplicada no Hostinger antes de disponibilizar esta versão. Não altera pagamentos existentes. O procedimento `scripts/hostinger/deploy-receipts-prices.sh` executa a cadeia com cópia de segurança local e mantém os dados atuais em caso de retorno da aplicação anterior. O processamento financeiro roda no servidor independentemente de o navegador permanecer aberto.

Validações: `test:receipt-payment-sync`, `test:sale-status`, `test:original-sale-payments`, `test:sale-prices`, `test:receipt-delete`, `test:receipt-migration`, `test:sales-filters`, `test:sales-pdf`, TypeScript/lint e integração completa em banco sintético (`scripts/verify-isolated-production.mjs`, após `build:vps`). Não usar lojas reais para testes.

## Revisão de 09/09/2026

- Os nove status automáticos aparecem individualmente em Configurações, sempre obrigatórios, sem edição ou desativação. Novos acompanhamentos manuais não podem usar os nomes reservados. Registros legados homônimos continuam preservados e sinalizados como manuais antigos.
- Vendas, detalhes e relatórios só usam apresentação de conciliação completa quando a regra automática inteira é satisfeita. Pago informado e comprovantes são apresentados separadamente; igualdade manual não encobre divergência documental.
- Comprovantes compara venda, pagamento informado e documentos. O filtro amplo **Pendências de conferência** inclui diferenças e ausência de valores/arquivos; **Sem valor válido / em leitura** é o subconjunto sem leitura válida. Esse conjunto é diferente do status principal **Verificar comprovante** de Vendas. Diferenças entre pedidos não se compensam.
- Caso de regressão: venda de R$34.730,00 e comprovantes de R$34.650,00 continuam em revisão tanto antes quanto depois de o pagamento informado ser ajustado para R$34.650,00. O aviso mostra R$80,00 abaixo da venda.
- Não há atualização retroativa silenciosa de pagamentos. Comprovantes antigos, sem solicitação de sincronização, podem ser aplicados com **Usar total dos comprovantes**, com permissão, conferência de concorrência e auditoria.
- O aviso de aplicação usa o preço atual do pedido imediatamente após editar preços, sem depender da próxima consulta periódica.
- Os produtos nos detalhes usam cartões compactos em colunas conforme a largura disponível. Fotos continuam vinculadas ao SN e podem ser abertas.
- **Conciliado** é reservado ao status completo; o resumo parcial usa **Comprovantes iguais ao valor da venda**. Recibos zerados, negativos ou sem valor inteiro válido não concluem a conferência documental.
- Histórico do cliente recebe o mesmo status automático calculado no servidor, inclusive para perfis com acesso apenas ao histórico, sem liberar fotos ou comprovantes.
- Vendas distingue **Status principal** de **Contém pendência**. A decisão de manter ou remover o acompanhamento manual está aguardando definição do usuário; nenhum cadastro ou vínculo histórico foi excluído nesta revisão.

## Relatório por link

Em Vendas → Relatório de vendas, **Copiar link** preserva loja, nível e filtros. Há campo de cópia manual se a área de transferência não estiver disponível. O relatório é uma visão dos dados atuais, não um retrato imutável. Hoje/ontem/últimos dias são relativos à data em que o link é aberto; use um dia ou mês específico para conferência de período fixo.

O link não contém credenciais nem libera acesso público aos dados. Exige login na loja correspondente e permissão de Vendas. Login por senha ou Google preserva a rota interna validada; destinos externos são rejeitados. Trocar de loja não traz dados de outra loja sem autorização. Abrir venda, foto ou comprovante continua usando os endpoints autenticados existentes. Editar/fechar retorna ao relatório sem sobrepor diálogos; o botão Atualizar recarrega os dados.

## Leitor de SN

A leitura precisa de três observações consecutivas do mesmo candidato em pelo menos 250 ms. Candidatos alternados, falha de leitura ou quadro vazio interrompem a sequência. Após aceitar um código, outro só é aceito depois de seis quadros sem código. Os testes cobrem FK77X4P22V versus FK77X4P33V. Nenhum SN existente foi corrigido automaticamente. Ainda é necessária validação com a câmera física do iPhone; consenso reduz leituras transitórias, mas não prova que um decodificador nunca repetirá um resultado incorreto.

## Segurança e limites desta revisão

O alerta de dependências foi examinado separadamente. Os pacotes sinalizados incluem dependências das ferramentas Cloudflare/Miniflare, de desenvolvimento e geração de esquema. A exposição dos alertas altos no caminho efetivamente executado pelo servidor Linux não foi demonstrada, o que **não** equivale a ausência de vulnerabilidades. Não foi aplicado `npm audit fix --force`: a solução sugerida para parte da cadeia faz downgrade ou deixa outro pacote sinalizado. Atualizar essa cadeia com testes próprios permanece manutenção pendente; bibliotecas nativas do OCR exigem avaliação separada. A prévia de desenvolvimento permanece restrita a 127.0.0.1.

Validações adicionais: `test:sale-financial-summary`, `test:sales-report-link`, consenso em `test:scanner`, retorno em `test:app-back`, paridade automática TS/SQL, filtros financeiros e login de retorno com cookie assinado em banco sintético. Não foram modificados pedidos, pagamentos ou códigos reais durante os testes.
