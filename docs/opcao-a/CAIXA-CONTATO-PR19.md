# Vivaion Empresas — caixa de entrada de contatos gerais (candidato PR #19)

Data: 2026-11-21. Dependência de desenvolvimento: PR #18 / commit `b40e51220ca275706bd68bab6262d5f340234895`, sem merge nem deploy.

## Motivação
O formulário `/contato/` da Versão A registrava contatos na tabela `contact_requests`, mas não havia uma interface de atendimento acessível à equipe. A PR #19 disponibiliza essa caixa de entrada para gestores autorizados, sem converter automaticamente a mensagem em proposta comercial, pagamento, matrícula ou reserva de vagas.

## Implementado

1. Migração 012: protocolo de idempotência `request_key`, impressão de conteúdo `payload_sha256`, data de ciência do aviso de privacidade, `updated_at`, índices de contato e `contact_request_events` com auditoria de ator e metadados.
2. `POST /api/contact` exige campos validados, `requestKey` UUID e `privacyAcknowledged=true`. Repetição da mesma mensagem/chave responde com o mesmo protocolo sem criar contatos duplicados; chave com dados diferentes gera 409. Honeypot continua aceitando sem registrar spam, e rate limit permanece habilitado fora dos testes. Nada é enviado automaticamente por e-mail ou WhatsApp.
3. `/contato/` inclui checkbox obrigatório de ciência do aviso preliminar de privacidade, mantém `requestKey` entre tentativas, exibe protocolo após registro e rotaciona a chave somente depois de sucesso. Com `PUBLIC_SITE_LIVE=false`, o usuário ainda revisa uma mensagem no WhatsApp, sem persistência no banco; isso **não** libera o site.
4. APIs restritas para gestor `GET /api/staff/contacts` (status e cursor com precisão de microssegundos), `GET /contacts/overview`, `GET /contacts/:id`, `PATCH /contacts/:id` (apenas `new→responded/archived`, `responded→archived`) e `POST /contacts/:id/activities` (ligação, e-mail, anotação). Vendedor recebe 403, anônimo 401; escritas verificam novamente que a identidade está ativa e tem papel de gestor, com transação e auditoria.
5. Painel `/operacao/`: seção de mensagens gerais somente para gestores, filtros, paginação, detalhes, histórico e notas. Dados vindos de mensagens externas são inseridos em DOM com `textContent`, não HTML arbitrário.
6. Retenção: `backend/src/privacy.ts` remove `request_key`, hash do payload e metadados potencialmente identificáveis de `contact_request_events` para contatos elegíveis já respondidos ou arquivados, retendo apenas evento mínimo de anonimização. Prazo e ativação continuam dependentes de aprovação jurídica.

## Ensaios e critérios de revisão

- Testar com API/postgres isolados: consentimento ausente 400; protocolo novo 202; replay com dados iguais 200; replay divergente 409; honeypot 202 sem registro; eventos de recebimento e atualização; RBAC gestor/vendedor; sessões e origem.
- Paginação: 61 contatos com timestamp idêntico e microssegundos `.654321`, páginas de 50/11, sem omissão nem duplicação.
- Fluxo manager: consulta, anotação sem alterar status, transição autorizada, rejeição de transição inválida, privacidade e isolamento.
- Playwright desktop/mobile: confirmação de privacidade, payload, manager inbox, sanitização de HTML e ausência da caixa para vendedores.
- Full-stack real em PostgreSQL descartável: formulário público → protocolo → registro/auditoria → login staff fictício → caixa de entrada → atividade → resposta → auditoria → limpeza de dados de teste.
- `npm run check`, `npm run test`, `npm run db:migrate`, `npm run test:integration`, `npm run build`, `npm run test:e2e`, testes do extrator, auditoria de dependências e pacote limpo do SHA final.

## Limites institucionais

- **Não existe envio automático de resposta:** o status `responded` deve ser marcado somente depois que o gestor realizar contato pelo canal institucional aprovado.
- **A caixa não implementa gestão automática de equipe de vendas:** mensagens são de leitura e triagem exclusiva por gestores. Encaminhamento deve seguir rotina aprovada por operações.
- Aviso de privacidade ainda é preliminar, sem validação jurídica do controlador, base legal e retenção; política final, canais do titular e contratos devem ser aprovados para qualquer operação real.
- Sem e-mail transacional configurado/autorizado, destinatários, SLA, política comercial, revisões editoriais, release assinado ou homologação real na VPS, **NO-GO** se mantém.
- Para homologar, usar somente banco `vivaion_empresas*` isolado, artefato assinado do SHA revisado e publicador institucional. Issue #14 requer backup/restauração/rollback reais e testes HTTPS. Issue #10 determina o GO/NO-GO separado.
- PR #19 é candidata incremental sobre PR #18 e exige CI + revisão independente do seu commit antes de qualquer integração. Não alterar `main`, DNS, Apache, systemd ou produção por inferência de aprovação técnica.
