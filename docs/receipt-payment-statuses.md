# Comprovantes, preços e status da venda

## Precedência do total pago

- Um novo envio de comprovantes ou correção explícita de valores cria uma solicitação persistida de atualização do pagamento, desde que o usuário tenha permissão de pagamentos.
- O servidor espera todos os comprovantes ativos terem valores positivos; nunca usa uma soma parcial. Fotos de aparelhos não entram nessa soma.
- Com um pagamento Pix, ajusta apenas seu valor e mantém a conta. Com vários Pix, exige a escolha explícita de qual Pix absorve a diferença. Dinheiro nunca é alvo dessa atualização: o total recebido passa a ser dinheiro preservado + comprovantes. Sem Pix cadastrado, solicita revisão, sem converter dinheiro em Pix nem inventar uma conta.
- Uma edição manual de pagamento posterior invalida a solicitação anterior, inclusive se a leitura terminar depois. Repetir uma operação antiga não reativa a solicitação.
- Se pagamento e comprovantes forem salvos juntos, a correção manual prevalece. A proteção persiste nas tentativas após falha parcial.
- Usuários sem permissão de pagamentos não podem aproveitar uma solicitação pendente de outra pessoa para modificar valores financeiros.
- Excluir comprovante não exclui nem reduz pagamentos. Para aplicar comprovantes já salvos, use **Usar total dos comprovantes**.
- Ao substituir um arquivo, exclua o anterior: todos os comprovantes ativos são somados. A conferência documental não confirma crédito bancário nem autenticidade do arquivo.

## Preços e status

Em Vendas → abrir venda → Produtos → **Editar preços**, quem possui `sales.prices` pode alterar cada preço por SN diretamente nos detalhes. O acesso anterior em Editar → Preços desta venda continua disponível. O total vendido é recalculado sem alterar pagamentos, estoque ou preço padrão. A prévia compara o novo total com todos os pagamentos e, separadamente, comprovantes com Pix; salvar atualiza o status. A edição destaca os itens modificados, impede sair enquanto salva e exige salvar ou cancelar antes de outra ação. Valores negativos digitados são rejeitados, não convertidos para positivos.

Somente **Cancelado** e **Conciliado** são automáticos, padrão para todas as lojas, sem edição ou desativação. Conciliação completa requer preços válidos, Pix + dinheiro iguais à venda, comprovantes iguais ao Pix e foto em cada aparelho. Sem Pix nem comprovantes, a conferência documental não é exigida; dinheiro é informado e conferido manualmente. Comprovantes anexados sem Pix continuam exigindo revisão, não são ignorados. Um valor de comprovante corrigido manualmente prevalece sobre o estado de uma leitura antiga. Escolher um nome ou cor de status nunca conclui a conferência financeira.

Os demais status são cadastrados, editados, ativados/desativados e escolhidos pela loja. Cadastros existentes como Pagamento pendente voltam a ser apresentados pelo próprio nome, sem prefixo “Manual antigo”. Nenhum vínculo histórico é excluído. A precedência existente é mantida: Cancelado, depois Conciliado quando a conferência estiver completa, depois o status escolhido, ou Sem status. O status escolhido fica guardado e reaparece se uma mudança posterior gerar pendência.

Preço ausente, comprovante ausente/inválido/em leitura, pagamento abaixo/acima da venda e foto ausente são **avisos de conferência separados**, não status atribuídos automaticamente. Todos continuam impedindo conciliação completa. São mostrados em Vendas, detalhes, edição, histórico de clientes, Comprovantes e relatórios.

Os novos filtros de status usam `statusScope=display` e correspondem ao status visível. Links antigos, sem esse parâmetro, continuam filtrando o cadastro salvo (`saved`), inclusive quando a venda já foi conciliada ou cancelada. Cadastros inativos associados permanecem visíveis; referências reservadas, inexistentes ou de outra loja não viram status manual. Filtros antigos por avisos e `pending` continuam funcionando. SQL e interface usam a mesma regra, verificada por testes.

## Publicação

A migração aditiva `0014_receipt_payment_sync` deve ser aplicada no Hostinger antes de disponibilizar esta versão. Não altera pagamentos existentes. O procedimento `scripts/hostinger/deploy-receipts-prices.sh` executa a cadeia com cópia de segurança local e mantém os dados atuais em caso de retorno da aplicação anterior. O processamento financeiro roda no servidor independentemente de o navegador permanecer aberto.

Validações: `test:receipt-payment-sync`, `test:sale-status`, `test:original-sale-payments`, `test:sale-prices`, `test:receipt-delete`, `test:receipt-migration`, `test:sales-filters`, `test:sales-pdf`, TypeScript/lint e integração completa em banco sintético (`scripts/verify-isolated-production.mjs`, após `build:vps`). Não usar lojas reais para testes.

## Revisão de 09/09/2026

- Conciliado e Cancelado aparecem individualmente em Configurações, sempre obrigatórios, sem edição ou desativação. Só esses dois nomes são reservados. Registros legados homônimos são preservados e podem ser renomeados; não podem ser reativados ou atribuídos novamente com nome reservado. A normalização é compartilhada com a chave persistida do cadastro.
- Vendas, detalhes e relatórios só usam apresentação de conciliação completa quando a regra automática inteira é satisfeita. Pago informado e comprovantes são apresentados separadamente; igualdade manual não encobre divergência documental.
- Comprovantes compara venda, pagamento informado e documentos. O filtro amplo **Pendências de conferência** inclui diferenças e ausência de valores/arquivos; **Sem valor válido / em leitura** é o subconjunto sem leitura válida. Esse filtro financeiro é independente do status escolhido na venda. Diferenças entre pedidos não se compensam.
- Caso de regressão: venda de R$34.730,00, Pix de R$34.730,00 e comprovantes de R$34.650,00 mostram diferença documental de R$80,00. Depois de aplicar o comprovante ao Pix, documentos conferem, mas permanecem R$80,00 de pagamento pendente em relação à venda.
- Pagamento misto: venda de R$7.100,00, Pix de R$4.100,00, dinheiro de R$3.000,00 e comprovantes de R$4.100,00 conferem. Não há diferença documental de R$3.000,00. Reaplicar comprovantes de R$4.000,00 ajusta somente o Pix e mantém dinheiro em R$3.000,00: recebido de R$7.000,00, com R$100,00 ainda pendentes na venda.
- Não há atualização retroativa silenciosa de pagamentos. Comprovantes antigos, sem solicitação de sincronização, podem ser aplicados com **Usar total dos comprovantes**, com permissão, conferência de concorrência e auditoria.
- O aviso de aplicação usa o preço atual do pedido imediatamente após editar preços, sem depender da próxima consulta periódica.
- Os produtos nos detalhes usam cartões compactos em colunas conforme a largura disponível. Fotos continuam vinculadas ao SN e podem ser abertas.
- **Conciliado** é reservado ao status completo; o resumo parcial usa **Comprovantes iguais ao Pix informado**. Recibos zerados, negativos ou sem valor inteiro válido não concluem a conferência documental.
- Histórico do cliente recebe o mesmo status efetivo e avisos calculados no servidor, inclusive para perfis com acesso apenas ao histórico, sem liberar fotos ou comprovantes.
- Vendas separa o filtro de status dos avisos de conferência. O cadastro manual continua disponível por decisão do usuário; nenhum cadastro ou vínculo histórico foi excluído nesta revisão.
- O resumo dos produtos na lista de vendas inclui modelo, cor e memória. Mantém duas linhas no máximo e o resumo de aparelhos adicionais; o título completo lista todas as variações.

## Relatório por link

Em Vendas → Relatório de vendas, **Copiar link** preserva loja, nível e filtros. Há campo de cópia manual se a área de transferência não estiver disponível. O relatório é uma visão dos dados atuais, não um retrato imutável. Hoje/ontem/últimos dias são relativos à data em que o link é aberto; use um dia ou mês específico para conferência de período fixo.

O link não contém credenciais nem libera acesso público aos dados. Exige login na loja correspondente e permissão de Vendas. Login por senha ou Google preserva a rota interna validada; destinos externos são rejeitados. Trocar de loja não traz dados de outra loja sem autorização. Abrir venda, foto ou comprovante continua usando os endpoints autenticados existentes. Editar/fechar retorna ao relatório sem sobrepor diálogos; o botão Atualizar recarrega os dados.

## Leitor de SN

A leitura precisa de três observações consecutivas do mesmo candidato em pelo menos 250 ms. Candidatos alternados, falha de leitura ou quadro vazio interrompem a sequência. Após aceitar um código, outro só é aceito depois de seis quadros sem código. Os testes cobrem FK77X4P22V versus FK77X4P33V. Nenhum SN existente foi corrigido automaticamente. Ainda é necessária validação com a câmera física do iPhone; consenso reduz leituras transitórias, mas não prova que um decodificador nunca repetirá um resultado incorreto.

## Segurança e limites desta revisão

O alerta de dependências foi examinado separadamente. Os pacotes sinalizados incluem dependências das ferramentas Cloudflare/Miniflare, de desenvolvimento e geração de esquema. A exposição dos alertas altos no caminho efetivamente executado pelo servidor Linux não foi demonstrada, o que **não** equivale a ausência de vulnerabilidades. Não foi aplicado `npm audit fix --force`: a solução sugerida para parte da cadeia faz downgrade ou deixa outro pacote sinalizado. Atualizar essa cadeia com testes próprios permanece manutenção pendente; bibliotecas nativas do OCR exigem avaliação separada. A prévia de desenvolvimento permanece restrita a 127.0.0.1.

Validações adicionais: `test:sale-financial-summary`, `test:sales-report-link`, consenso em `test:scanner`, retorno em `test:app-back`, paridade automática TS/SQL, filtros financeiros e login de retorno com cookie assinado em banco sintético. Não foram modificados pedidos, pagamentos ou códigos reais durante os testes.
