# Gates antes de uso comercial ou publicação em produção

- [ ] Revisar dependências e fixar `package-lock.json` gerado em ambiente confiável.
- [ ] Executar CI e testes locais com PostgreSQL de desenvolvimento.
- [ ] Testes de isolamento entre no mínimo duas empresas e papéis.
- [ ] Verificação de e-mail antes de concessão de acesso operacional.
- [ ] Recuperação segura de senha e política de MFA opcional.
- [ ] Revisão da UX de consentimento, aviso de privacidade e retenção (LGPD).
- [ ] Integração cadastral CNPJ + comprovação de representação + fluxo administrativo de aprovação.
- [ ] Habilitar log estruturado de auditoria, alertas e monitoramento.
- [ ] Validar CNPJ alfanumérico com casos de teste oficiais.
- [ ] Validar ambiente de checkout Eduzz, produtos, quantidades, valores e emissão fiscal.
- [ ] Implementar verificação assinada de webhooks + processamento idempotente + reconciliação.
- [ ] Comprovar que eventos Meta Purchase não duplicam o rastreamento existente em vivaion.com.br.
- [ ] Homologar concessão/revogação de vagas na Área do Aluno por API autorizada; não acessar tabelas diretamente.
- [ ] Definir catálogo em produção, frequência de sincronização e alertas de stale feed.
- [ ] Análise de segurança HTTP (cookies, CSP, CSRF, XSS, rate limit, proteção de credenciais).
- [ ] Habilitar backups, restauração testada, rollback e controle de acesso operacional.
- [ ] Aprovar ambiente de produção, DNS, SSL e acessos antes do deploy.

Flags padrão: `CORPORATE_PRICING_ENABLED=false` e `PUBLIC_SITE_LIVE=false`.

O simples cadastro de empresa não habilita preços, benefícios, matrícula ou checkout. Não há integração real com Eduzz ou Área do Aluno neste commit.

## Identidade por e-mail (iteracao #2)

- [x] Fluxo de confirmacao de e-mail com token hash SHA-256, expiracao e uso unico.
- [x] Bloqueio de sessao para contas sem e-mail confirmado.
- [x] Redefinicao de senha com revogacao de sessoes.
- [x] Restrições SQL cruzadas entre empresa, pedido, vagas e colaborador.
- [ ] Provedor de envio de e-mail validado, reputacao de dominio (SPF/DKIM/DMARC) e tratamento de falhas.
- [ ] Verificacao humana da representacao legal do CNPJ e do direito de administrar a empresa.
- [ ] MFA, monitoramento de tentativas distribuidas e fluxo de revogacao administrativa.
