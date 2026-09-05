import type { Metadata } from 'next';

import { LegalPage, LegalSection } from '@/components/pdv/legal-page';

export const metadata: Metadata = {
  title: 'Termos de Uso · AtacadoApple PDV',
  description: 'Condições de uso do AtacadoApple PDV.',
};

export default function TermsPage() {
  return (
    <LegalPage
      introduction="Ao criar uma loja ou utilizar o AtacadoApple PDV, você concorda com estas condições de uso."
      title="Termos de Uso"
    >
      <LegalSection title="Finalidade do sistema">
        <p>
          O AtacadoApple PDV oferece recursos de cadastro, entrada, estoque,
          venda, pagamento, cancelamento, relatórios e rastreabilidade por
          número de série. O sistema apoia a operação da loja, mas não substitui
          a conferência contábil, fiscal ou física dos produtos.
        </p>
      </LegalSection>

      <LegalSection title="Conta principal e equipe">
        <p>
          Quem cria a loja é responsável pela conta principal, pela exatidão dos
          dados e pelos usuários adicionados no menu de configurações. Senhas
          são pessoais e não devem ser compartilhadas. O proprietário deve
          desativar prontamente acessos que não sejam mais necessários.
        </p>
      </LegalSection>

      <LegalSection title="Uso permitido">
        <p>
          O serviço deve ser usado somente para operações legítimas. É proibido
          tentar acessar outra loja, contornar controles de segurança, enviar
          arquivos maliciosos, sobrecarregar a infraestrutura ou cadastrar
          conteúdo que viole direitos de terceiros.
        </p>
      </LegalSection>

      <LegalSection title="Registros e conferência">
        <p>
          O usuário deve conferir cliente, modelo, SN, valor, forma de
          pagamento, fotos e comprovantes antes de finalizar uma operação.
          Cancelamentos restauram o estoque conforme o registro do sistema e
          permanecem no histórico para auditoria.
        </p>
      </LegalSection>

      <LegalSection title="Disponibilidade e proteção dos dados">
        <p>
          Empregamos medidas razoáveis para manter o serviço seguro e
          disponível, mas manutenções e falhas externas podem causar
          interrupções. A loja deve conservar documentos fiscais e cópias
          adicionais que sejam exigidos por sua atividade.
        </p>
      </LegalSection>

      <LegalSection title="Alterações e contato">
        <p>
          Estes termos podem ser atualizados para refletir melhorias, segurança
          ou requisitos legais. Mudanças relevantes serão informadas no próprio
          sistema. Dúvidas podem ser enviadas para{' '}
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
