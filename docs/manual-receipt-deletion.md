# Exclusão manual e leitura de valores inteiros

## Uso

Em Vendas → abrir venda → Editar → Comprovantes, cada arquivo salvo oferece **Excluir** a quem possui `sales.receipts.delete`. A confirmação identifica o arquivo e informa que venda/pagamentos não mudam e outros rascunhos não são salvos. Proprietários e administradores com permissões padrão têm acesso; funcionários precisam de liberação explícita em permissões. Vendas canceladas preservam os comprovantes.

Após confirmação do servidor, o comprovante some do editor, dos detalhes e da lista sem recarregar a página. A conciliação e os limites de anexos são recalculados. Valores manuais ainda não salvos dos outros arquivos ficam preservados. A ação tem operação idempotente e auditoria de autor, data e metadados anteriores. Não há exclusão automática de comprovantes nem alteração dos pagamentos.

## Segurança e persistência

`DELETE /api/sales/:id/receipts/:receiptId` exige sessão, mesma origem, CSRF e permissão dedicada. O servidor resolve o arquivo apenas pelo ID da mesma loja/venda e somente `kind=receipt`. Auditoria, outbox e remoção de metadados/job OCR pertencem à mesma transação. O worker OCR nunca recria um anexo excluído; atualizações tardias não encontram o registro/job.

A remoção física ocorre somente depois do commit. Uma falha deixa tarefa durável em `file_deletion_jobs`; um worker independente do OCR tenta novamente. A venda já reflete a remoção e futuras consultas à URL autenticada retornam 404. Cópias já baixadas ou backups anteriores seguem sua retenção normal; isto não é promessa de apagar cópias externas. Nenhum comprovante real foi removido para testar esta função.

## Leitura

O extrator compartilhado interpreta tokens inteiros como `R$ 19.650` e `R$ 15.000` sem recortar os zeros. Valida números inteiros completos, milhares por ponto/espaço e decimais; rejeita CPF/CNPJ, datas, telefone, IDs, saldo e tokens incompletos. R$15 continua sendo quinze reais. Não há correção em massa de valores antigos; a correção manual existente permanece disponível em Valor da transação.

As duas imagens enviadas foram processadas localmente com Tesseract português e retornaram respectivamente 1965000 e 1500000 centavos. Isso não garante acerto em qualquer comprovante: o usuário continua podendo conferir e corrigir a leitura.

## Publicação pendente

O sistema público ainda exige autorização do usuário para publicação. Antes do corte:

1. Construir e validar aplicativo **e imagem OCR** do mesmo código (`deploy/hostinger/Dockerfile` e `Dockerfile.ocr`). Só atualizar o aplicativo NÃO corrige o leitor do servidor.
2. Verificar backup recente, aplicar `apply-receipt-delete-migration.mjs` (cadeia aditiva, cópia SQLite local, checksum e preservação) antes de substituir o aplicativo.
3. Atualizar a referência `PDV_OCR_IMAGE` do serviço receipt-engine, verificar saúde e teste sintético de valor inteiro. Seguir o processo de rollback de imagem, sem restaurar dados antigos por cima de vendas novas.
4. Validar `/api/health`, que exige `file_deletion_jobs`, e atualizar também o frontend/Sites de acesso existente após aprovação.

Testes automatizados: `test:receipt-delete`, `test:receipt-amount`, `test:receipt-jobs`, `test:receipt-migration`, `test:permissions`, `test:receipt-reconciliation`, TypeScript e lint. A integração HTTP inclui negação da nova ação a funcionário sem permissão. Validação visual/interação manual em navegador não executada neste pedido.
