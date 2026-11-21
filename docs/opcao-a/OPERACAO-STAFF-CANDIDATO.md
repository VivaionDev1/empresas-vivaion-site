# Vivaion Empresas — Operação comercial restrita (candidato)
Data: 2026-11-20. Escopo: **apenas desenvolvimento isolado**; não concede GO de lançamento.

## Entregas técnicas
- Migração `007_staff_operations.sql`: identidades da equipe próprias, sessões independentes e chaves de atribuição, sem misturar contas empresariais.
- API `/api/staff/*`: solicitação de acesso por e-mail para usuários previamente provisionados; link de uso único válido por 15 minutos; sessão HttpOnly/SameSite Strict por 12h; logout; visão geral; listagem; detalhes; atribuição e estados de atendimento com histórico.
- Página `/operacao/`: acesso, resumo, triagem, dados de lead e histórico sem gerar HTML a partir de dados não confiáveis.
- Permissão `manager`: vê e atribui leads; `sales`: acessa apenas leads atribuídos e não altera a atribuição.
- `STAFF_PORTAL_ENABLED=false` por padrão; API retorna 404 fora de testes até ativação autorizada.
- A página é `noindex` e a sessão de equipe não autentica contas corporativas.
- Login por link utiliza fragmento URL para evitar inclusão do token no caminho e query enviados ao servidor.
- O portal não habilita pagamentos, preços, matrículas, vagas nem publicação.

## Preparação do operador (somente em HML autorizado)
1. Revisar migração 007 e aplicar em banco Vivaion Empresas dedicado; confirmar backup e restauração primeiro.
2. Escolher o provedor de e-mail transacional autorizado e configurar o relay HTTPS seguro e domínio de origem, por fora do repositório e do webroot. Os links de autenticação são enviados pelo relay existente.
3. Provisionar a equipe por processo controlado. Usar `STAFF_PROVISIONING_ENABLED=true` apenas durante a operação local autorizada, com `DATABASE_URL` no banco exclusivo, e executar:
   - `cd backend && npx tsx scripts/provision-staff.ts --action grant --email endereco-institucional --name 'Nome Completo' --role manager`
   - `cd backend && npx tsx scripts/provision-staff.ts --action grant --email endereco-institucional --name 'Nome Completo' --role sales`
   - Revogação: `cd backend && npx tsx scripts/provision-staff.ts --action revoke --email endereco-institucional`
4. Habilitar `STAFF_PORTAL_ENABLED=true` **apenas** depois de validar acesso restrito, TLS, controle de rede, política de logs, UAT, responsável de operações e LGPD.
5. Acessar `/operacao/`, pedir link por e-mail, validar login, atribuição, mudança de status, auditoria e logout com leads fictícios.
6. Não coletar contatos reais até a aprovação formal da issue #10.

## Regras do fluxo
- `received` → `assigned` → `contacted` → `proposal_sent` ou `negotiating` → `won`/`lost` → `closed`.
- Existem transições alternativas limitadas para perda/encerramento e revisão de proposta; não se pode pular livremente etapas.
- Uma atribuição exige funcionário ativo; mudanças guardam identidade do operador e justificativa em `commercial_lead_events`.
- O indicador de 48 horas é **informativo**, não um SLA institucional aprovado.
- Não existe registro público de funcionários: o primeiro gerente exige provisionamento CLI explícito.

## Validação
`npm run check`, `npm run test`, `npm run build`, `NODE_ENV=test APP_ORIGIN=http://localhost:4321 DATABASE_URL=postgresql://... npm run db:migrate` e `npm run test:integration`. Playwright verifica fluxo da interface em desktop/mobile.

## Pendências NÃO concluídas
- Provedor real de e-mails, pessoas responsáveis, SLA, fila/CRM e notificações operacionais definitivas.
- Política de retenção e exclusão de leads, autorização jurídica/LGPD e política comercial aprovada.
- Homologação operacional da VPS, publicação canário com publicador assinado, TLS/proxy/observabilidade, backup/restauração/rollback real.
- Integração oficial de checkout/pagamentos e matrículas acadêmicas; continuam intencionalmente desativadas.

Não alterar `main`, PR #15, produção ou outros sistemas para validar este candidato. Issue #14 cobre HML real; issue #10 permanece **NO-GO**.
