import type { Metadata } from 'next';

import { LegalPage, LegalSection } from '@/components/pdv/legal-page';

export const metadata: Metadata = {
  title: 'Política de Privacidade · AtacadoApple PDV',
  description: 'Como o AtacadoApple PDV trata os dados da conta e da loja.',
};

export default function PrivacyPage() {
  return (
    <LegalPage
      introduction="Esta política explica quais dados o sistema utiliza para operar sua loja, proteger o acesso e manter a rastreabilidade das operações."
      title="Política de Privacidade"
    >
      <LegalSection title="Dados que tratamos">
        <p>
          Podemos tratar nome, e-mail, foto de perfil e identificador da conta
          Google, ou usuário e senha protegida quando o acesso é feito sem
          Google. Também armazenamos os dados operacionais inseridos pela loja,
          como produtos, clientes, números de série, preços, pagamentos, fotos,
          comprovantes, usuários da equipe e registros de auditoria.
        </p>
      </LegalSection>

      <LegalSection title="Para que usamos os dados">
        <p>
          Os dados são usados para autenticar usuários, separar cada loja,
          controlar estoque e vendas, gerar relatórios, preservar o histórico e
          prevenir fraude ou acesso indevido. Não vendemos dados pessoais.
        </p>
      </LegalSection>

      <LegalSection title="Compartilhamento e armazenamento">
        <p>
          Utilizamos fornecedores de infraestrutura e autenticação, incluindo o
          Google quando essa forma de entrada é escolhida. Esses fornecedores
          recebem apenas os dados necessários para prestar o serviço. As
          informações de uma loja não são exibidas a usuários de outra loja.
        </p>
      </LegalSection>

      <LegalSection title="Fotos, comprovantes e dados de clientes">
        <p>
          O responsável pela loja deve anexar somente arquivos necessários à
          operação e garantir que possui autorização para cadastrar dados de
          clientes e imagens. Comprovantes são opcionais; fotos de aparelhos e
          entradas servem à rastreabilidade do estoque.
        </p>
        <p>
          Quando a conferência automática de um comprovante é usada, a leitura
          da foto ou do PDF acontece localmente no aparelho do usuário. O texto
          reconhecido não é enviado a um serviço externo nem armazenado pelo
          sistema; somente o valor da transação encontrado é salvo junto à
          venda. Esse valor pode ser conferido e corrigido manualmente.
        </p>
      </LegalSection>

      <LegalSection title="Segurança e conservação">
        <p>
          Aplicamos controle de acesso por função, sessões protegidas,
          isolamento por loja, limites de envio e registro de ações importantes.
          Os dados são mantidos enquanto a conta estiver ativa ou pelo período
          necessário para cumprir obrigações e resolver solicitações legítimas.
        </p>
      </LegalSection>

      <LegalSection title="Seus direitos e contato">
        <p>
          O titular pode solicitar informações, correção ou exclusão de dados,
          observados os registros que precisem ser conservados por obrigação
          legal. Para dúvidas ou solicitações, escreva para{' '}
          <a
            className="font-semibold text-blue-700 hover:underline"
            href="mailto:jefersondr10@gmail.com"
          >
            jefersondr10@gmail.com
          </a>
          .
        </p>
      </LegalSection>
    </LegalPage>
  );
}
