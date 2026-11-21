# Vivaion Empresas - atividades e retornos comerciais (candidato PR #18)

Data: 2026-11-21. Base: SHA aprovado da PR #17, `7f18be1eff1dcc2c4732a813b24a03762c6a9eba`.

## Problema operacional resolvido

No painel anterior, uma ligação ou lembrete só podia ser registrado se a etapa do funil fosse alterada, criando a possibilidade de uma transição artificial ou de perda de histórico. Esta entrega adiciona atividades auditadas e agendamento de próximo retorno **independentes da mudança de status**.

## Implementação
- Migração `011_staff_followups.sql`: campo `next_followup_at` em leads, índice e restrição para não armazenar retornos em status terminais (`won`, `lost`, `closed`).
- `POST /api/staff/leads/:id/activities`: atividade `call`, `email`, `meeting`, `note`; descrição de 10–1000 caracteres; `followUpAt` opcional em formato ISO-8601 com fuso, nulo para cancelar. Não altera o status. O evento conserva o ator, data e motivo.
- Segurança: sessão staff obrigatória, origem exata nos métodos de escrita, ator ativo com perfil confirmado em transação, vendedor limitado a leads atribuídos, gestor com visão geral, lead anonimizado invisível. Acesso indevido não devolve dados do lead.
- Datas: recusa retorno excessivamente passado (mais de 5 minutos) ou além de 365 dias. Campos terminais não aceitam novo agendamento.
- Transições para status `won`, `lost` ou `closed` limpam retorno pendente e registram esta limpeza no evento de auditoria.
- `GET /api/staff/leads?followup=due|scheduled|none` pode ser combinado com filtro de status e paginação por cursor de microssegundos.
- `GET /api/staff/overview` traz contagens agregadas `dueFollowups` e `scheduledFollowups` de acordo com perfil de acesso, sem detalhes de outras equipes.
- `/operacao/` incorpora filtros e formulário de atividade, com sanitização por `textContent`, atualização do histórico e feedback acessível.
- A rotina de anonimização mantém a limpeza de retorno (defesa em profundidade).

## Política de uso
Este recurso é **acompanhamento interno**, não envio automático de e-mail ou WhatsApp. O horário agendado gera fila visual para os funcionários autorizados; não promete contato automático com cliente e não substitui o SLA ainda não aprovado. O conteúdo do campo de atividade pode conter dados pessoais, portanto exige treinamento, base legal, retenção aprovada e controle de acesso. A decisão de GO/NO-GO continua na issue #10.

## QA obrigatória
- `npm run check`, `npm run test`, `npm run db:migrate` em banco descartável exclusivo e `npm run test:integration`.
- Regressão: sem login 401; origem cruzada 403; vendedor de outro lead 404; atividades sem mudança de status; agendamento/cancelamento; prazos inválidos; filtro devido/programado; limpeza no estado terminal; revogação 401; eventos auditáveis.
- `npm run build`, `npm run test:e2e` desktop/mobile e `E2E_FULLSTACK=true` contra PostgreSQL exclusivo.
- Extrator adversarial e pacote HML do SHA final com `sourceClean:true`, hashes, ensaio rootless de rollback. Isso não é implantação real.

## Gates que continuam abertos
- PR #18 precisa de CI oficial e revisão independente de seu SHA antes de integração.
- Equipe e SLA definitivos, canal de atendimento, cron/notificações, e-mail relay com remetente, política comercial, conteúdo acadêmico e LGPD.
- Operador autorizado deve homologar a VPS (issue #14): TLS, proxy, backups, restauração, release imutável, migrações até 011, canário e rollback reais.
- O formulário `/contato/` registra `contact_requests` separadamente e necessita de caixa de entrada operacional; será tratado como entrega distinta, não resolvido por este PR.
- Pagamentos, matrículas e vagas continuam desativados. **NO-GO** e **sem merge/deploy/publicação**.
