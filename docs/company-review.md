# Procedimento de verificação empresarial (futuro uso homologado)

A confirmação matemática do CNPJ **não é suficiente** para ativar o status `verified`. Um operador autorizado precisa comprovar:

1. Existência/situação cadastral da empresa em fonte oficial apropriada.
2. Identidade do solicitante e autorização para representar o CNPJ.
3. E-mail administrativo confirmado.
4. Registro de evidência e justificativa em sistema de auditoria institucional.

O portal não expõe rotas HTTP públicas para aprovar empresas. Em ambiente isolado de homologação, após avaliação manual e permissão administrativa sobre o banco empresarial:

```bash
COMPANY_REVIEW_ENABLED=true npm run company:review --workspace=@vivaion/empresas-backend -- \
  --company-id "UUID-DA-EMPRESA" \
  --status verified \
  --operator "identificador-do-revisor" \
  --evidence-ref "protocolo-de-auditoria-123" \
  --reason "Verificacao cadastral e poderes de representacao aprovados"
```

A operação valida o e-mail confirmado de pelo menos um administrador antes de habilitar o status e registra operador, status anterior, status novo, referência da evidência e justificativa em `audit_events`.

**Não** coloque imagens de documentos, CPF ou outras informações sensíveis no campo `evidence-ref` ou no repositório. A prova deve ficar em sistema separado com controles de acesso e retenção próprios.

A execução real em produção requer configuração e aprovação operacionais independentes. `COMPANY_REVIEW_ENABLED` é false por omissão. Sem a autorização administrativa, nenhum usuário pode autoaprovar o próprio CNPJ.
