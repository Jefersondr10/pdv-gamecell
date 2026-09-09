# Alterar preços de uma venda já realizada

Em Vendas → abrir venda → Editar → Preços desta venda → Editar preços, altere o valor de cada aparelho identificado por modelo/variação/SN. Campos modificados são destacados e o painel compara o total anterior, o novo total e os pagamentos registrados. **Salvar preços da venda** salva apenas os preços; os outros rascunhos permanecem abertos. Salvar alterações geral fica desabilitado enquanto a edição de preços não for salva ou cancelada.

Permissão dedicada `sales.prices`: habilitada para proprietário/administrador com permissões padrão, explicitamente configurável para funcionários. O servidor exige sessão, mesma origem, CSRF, loja correta e venda concluída. Vendas canceladas não podem ter preços alterados.

Somente preço vendido dos itens, total vendido e diferenças derivadas mudam. Não se altera catálogo, preço padrão, valor de referência histórico, recebimentos, estoque, SN ou composição da venda. Não há crédito/reembolso/pagamento automático. A conciliação compara novamente o novo total com Pix + dinheiro e os comprovantes apenas com Pix. Alterar o preço da venda não muda o valor Pix esperado nos comprovantes; divergências devem ser conferidas.

A auditoria registra operador, data, preços por SN e totais antes/depois. A transação compara revisão e preços anteriores, prevenindo perda de alterações concorrentes, inclusive mudanças que voltam ao mesmo valor. Uma repetição após resposta perdida reutiliza o identificador da operação. Pedidos sem alteração de preço são rejeitados sem escrita.

O primeiro evento de alteração preserva o preço original para reenvio/recuperação da operação de criação, inclusive registros antigos sem fingerprint. Novas vendas também guardam total e recebimento iniciais na auditoria de criação. Uma repetição da criação nunca desfaz a correção posterior nem inventa um valor recebido usando o total novo.

Verificação: testes `test:sale-prices`, permissões, lint, TypeScript e integração standalone com banco novo e sintético. A integração cobre CSRF/permissão, alteração/repetição, preservação de pagamentos/SN/referência, recuperação da criação moderna e legada. Nenhuma venda real foi modificada. Publicação ainda depende da aprovação do usuário para o sistema público existente.
