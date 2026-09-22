# Reservas

Menu separado de Vendas, com cliente ativo, SNs disponíveis, observação e prazo inicial de 24 horas (editável até 90 dias, horário de Brasília). Permissões: `reservations` para consulta e `reservations.manage` para criar/alterar/liberar. Converter também exige `sell`.

Nova reserva usa o mesmo leitor da venda: câmera automática em celulares/tablets e bipador em computadores, com busca textual alternativa. A consulta é exata por SN (incluindo prefixo S), por loja; SN vendido, reservado, ambíguo ou repetido não entra na seleção. Fechar a reserva ou trocar para pesquisa encerra a câmera e cancela a consulta pendente. A disponibilidade é validada novamente ao confirmar. Teste: `npm run test:reservation-scanner`. A câmera no celular exige acesso HTTPS; um endereço HTTP na rede local não é equivalente ao localhost do computador.

Uma reserva não cria venda ou pagamento. A disponibilidade efetiva combina o estado físico da unidade com reservas ativas não vencidas. Estoque, busca de SN, histórico de SN e lista de WhatsApp usam a mesma expressão. O bloqueio expira pelo relógio do banco, sem depender de tarefas agendadas. O histórico da reserva é preservado.

Criação é idempotente pelo identificador da operação e conteúdo. Gatilhos SQLite impedem duas reservas do mesmo aparelho e bloqueiam vendas comuns de aparelhos reservados, inclusive durante disputas simultâneas. A conversão valida loja/cliente/conjunto exato de unidades, usa o envio recuperável existente e faz a conversão, venda e baixa dentro da mesma transação. Falhas revertem tudo. Alterar prazo e liberar exigem a revisão atual; reservas vencidas não são reativadas automaticamente. Cancelar a venda posteriormente libera o estoque, mas não reativa a antiga reserva.

Na conversão, conferir preços, anexar fotos obrigatórias por SN e informar dinheiro apenas se recebido. Comprovantes podem ser anexados agora ou depois e seguem o leitor e a conciliação existentes. Não há sinal/adiantamento na reserva.

Validação: `npm run test:reservations`, `npm run test:stock-whatsapp`, `npm run test:database-lifecycle`, `npm run test:permissions`, `npx tsc --noEmit`, `npm run lint`, `npm run build:vps`, `node scripts/verify-isolated-production.mjs`. A integração utiliza banco novo e sintético, nunca dados da loja real.

## Publicação

A migração aditiva `0018_stock_reservations.sql` é obrigatória antes de iniciar esta versão com um banco existente. Após autorização de publicação, usar `deploy-app-only.sh <release> <previous> <commit> reservations`. A versão inclui a migração na imagem e verifica as tabelas e proteções de estoque na saúde do aplicativo. O runner exige backup recente, cria snapshot local e migra antes da troca; uma falha de saúde restaura a aplicação anterior sem restaurar ou apagar dados. A migração não cria reservas, vendas ou recebimentos. O leitor de comprovantes não é reiniciado. Contas com permissões personalizadas precisam receber acesso a Reservas pelo responsável; as permissões existentes não são regravadas.
