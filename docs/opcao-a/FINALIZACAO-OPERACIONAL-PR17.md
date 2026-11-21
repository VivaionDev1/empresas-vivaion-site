# Vivaion Empresas - finalizacao operacional apos PR #16

Data: 2026-11-21. Escopo: implementacao e teste rootless somente. Nao autoriza merge, deploy nem operacao real.

## Entregas tecnicas

1. Migracao 008: outbox transacional para eventos received, assigned, overdue, deduplicacao, transacoes exclusivas (FOR UPDATE SKIP LOCKED), retries com backoff exponencial e estado dead apos 5 falhas.
2. A criacao de lead e a alteracao de responsavel enfileiram alertas dentro da transacao do PostgreSQL. A API nao faz chamada ao relay na requisicao do cliente.
3. Worker CLI backend/scripts/deliver-lead-notifications.ts, com flags NOTIFICATION_DELIVERY_ENABLED=true, STAFF_PORTAL_ENABLED=true e relay HTTPS aprovado. O worker requer agendamento externo autorizado; nao existe cron ativo instalado por este projeto.
4. E-mails de notificacao nao transportam nome, contato, mensagem, curso ou outros dados do cliente: apenas aviso generico e link para o painel autenticado.
5. O indicador de 48 horas e informativo, nao um SLA institucional.
6. Apos falha do relay de link de acesso staff, credencial nao entregue e invalidada, sem revelacao do estado da conta; nova solicitacao pode ser feita.
7. Emissao, consumo de token e atualizacao de leads sincronizam com revogacao de acesso e checam identidade ativa.
8. Teste isolado em NODE_ENV=production confirma atributos do cookie __Host-ve_staff: Secure, HttpOnly, SameSite Strict, Path /, sem Domain. Exige repeticao via HTTPS real em HML.
9. Migracao 009 e CLI para anonimizar leads terminados (won/lost/closed) e contatos respondidos/arquivados mais antigos do que prazo institucional. Retem auditoria sem metadados PII, remove snapshots, telefones, email, mensagens e eventos correlacionados. Nao altera registros ativos.

10. O painel inclui paginacao por cursor em lotes de 50 leads e apresenta contagens agregadas de fila de notificacao somente para perfis gestores; sem expor enderecos ou mensagens na visao de saude.

## Gate de notificacoes

Somente apos aprovacao de operacoes, juridico/LGPD e gestor de infra:

- Configurar MAIL_RELAY_URL, MAIL_RELAY_ALLOWED_HOST, MAIL_RELAY_BEARER_TOKEN, MAIL_FROM e APP_ORIGIN via cofre institucional, nunca no repositorio.
- Aplicar migracoes ate 010 em banco Vivaion Empresas HML exclusivo, apos backup e restauracao testada.
- Provisionar usuarios staff com o CLI backend/scripts/provision-staff.ts em ambiente autorizado.
- Validar TLS, acesso segregado, roles, cookies, origem e entrega de link no navegador real.
- Ativar STAFF_PORTAL_ENABLED=true e NOTIFICATION_DELIVERY_ENABLED=true separadamente; programar o worker com timer/cron somente pelo operador autorizado.
- Exemplo de disparo unitario dentro de backend: npx tsx scripts/deliver-lead-notifications.ts --max 20
- Monitorar contagens sent/failed/remaining, itens dead, SMTP/relay, observabilidade e rotinas de correcao. Nao incluir dados pessoais nos logs.
- Revogar acesso e interromper o worker quando necessario, mantendo o portal e os precos bloqueados por padrao.

Sem instalacao do timer, as notificacoes ficam enfileiradas e a equipe deve consultar o painel.

## Gate de retencao/LGPD

O codigo nao define prazo legal. Juridico deve aprovar por escrito finalidade, base legal, periodo por categoria, backup, contratos, direitos dos titulares, provas de identidade e sistemas externos.

Operacao conservadora: registros ativos nao sao eliminados; backup, outras bases e plataformas integradas nao sao incluidos. Os resultados nao bastam para conformidade juridica integral.

Preview: configurar APPROVED_LEAD_RETENTION_DAYS com inteiro aprovado de 30 a 3650 e executar, no diretorio backend, npx tsx scripts/retention-leads.ts preview.

Aplicacao apenas com autorizacao documentada: PRIVACY_RETENTION_ENABLED=true npx tsx scripts/retention-leads.ts apply acknowledge-institutional-approval. Lotes de ate 50; sem imprimir identificadores pessoais.

## Inspecao da VPS em modo de leitura

- Unidade vivaion-empresas-hml-api.service ativa e habilitada, apontando para /srv/vivaion-empresas-preview e nao para release imutavel.
- Configuracao Apache HML SSL: DocumentRoot /srv/vivaion-empresas-preview/frontend/dist; ProxyPass /api/ para 127.0.0.1:8091/api/; X-Robots-Tag noindex/nofollow/noarchive.
- Diretorio de certificado empresas-hml.vivaion.com.br encontrado. Presenca do diretorio nao garante validade, renovacao ou vhost habilitado.
- Requisicoes HTTPS via workspace rootless atingiram timeout de 12 segundos; DNS do dominio empresas.vivaion.com.br nao resolveu naquele ambiente. Isso nao prova indisponibilidade publica.
- Nenhum arquivo, serviço, certificado, vhost ou banco na VPS foi modificado.

## Issue #14 - passos exclusivos do publicador institucional

1. Validar rede, DNS, HTTPS/TLS, Apache habilitado, firewall, headers, CSP, HSTS, integridade de certificados e bloqueio de HML a usuarios nao autorizados.
2. Selecionar SHA aprovado. Usar artefato CI da propria PR com sourceClean:true, channel:hml, publicSiteLive:false, hashes e atestado. Rejeitar pacote local --allow-dirty.
3. Fazer backup e restauracao REAL de banco HML exclusivo; preservar sistema anterior e testar rollback em release imutavel, sem sobrepor /srv/vivaion-empresas-preview.
4. Aplicar migracoes ate 010 no ambiente HML sob janela de mudanca aprovada e plano de reversao.
5. Validar API no loopback, proxy, readiness, catalogo, limites de abuso, 503 de precos nao aprovados, fluxo de proposta ficticia e remocao de seus dados.
6. Testar cookies __Host em HTTPS real, relay falhando, revogacao concorrente, eventos de auditoria e notificacoes desativadas por padrao.
7. Registrar evidencias com SHA, operador, horario e verificacao do rollback na issue #14.

## Issue #10 - GO/NO-GO

Ainda dependem de autorizacao: politica comercial, LGPD, editorial e catalogo, equipe e SLA, e-mail real, monitoramento, UX final, publicador assinado e decisao expressa de merge e publicacao. Pagamentos e matriculas continuam desligados.

Testes locais necessarios: npm run check, npm run test, npm run db:migrate (somente DB isolado), npm run test:integration, npm run build, npm run test:e2e, E2E full-stack, suite adversarial do extrator e verificacao do pacote no SHA final.

NO-GO mantido. Nenhuma operacao em producao decorre desta documentacao.


## Correcao da revisao CHANGES_REQUESTED no commit 4b8e05aa (P1 / P2)

P1: paginacao preserva microsegundos do PostgreSQL via to_char(... AT TIME ZONE UTC,
YYYY-MM-DDTHH24:MI:SS.USZ). A mesma string exata segue no cursor base64url, sem
Date.toISOString() nem arredondamento. Ordenacao e filtro SQL permanecem pelo par
(created_at,id). Regressao: 123 leads com o MESMO timestamp e fracao de microsegundos
.123456, distribuidos em 3 paginas (50/50/23) sem perda, repeticao ou cursor truncado.

P2: migracao 010 introduz estado terminal cancelled e timestamp cancelled_at; trigger
no PostgreSQL cancela pendencias na mudanca de status ativo ou papel do usuario,
inclusive em SQL administrativo e antes de concluir reativacao. CLI grant/revoke
tambem cancela pendencias e worker faz saneamento defensivo de filas de inativos.
Mensagens canceladas nao sao reenviadas por retry/reabilitacao; o painel de gestores
separa contagens pending/sent/dead/cancelled. Operacao de reversao nao recria alertas
historicos: novos alertas requerem novos eventos, sujeitos a politica operacional.

O teste de regressao cobre desativacao, reativacao e recuperacao de fila obsoleta
com destinatario ficticio no banco isolado.

Sem deploy, coleta real, aprovacao juridica ou mudanca do NO-GO.
