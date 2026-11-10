# API empresarial — v0.1

**Base:** mesmo domínio do frontend, prefixo `/api`. O backend só deve escutar na interface local `127.0.0.1:8082`.

| Método | Rota | Autenticação | Estado |
| --- | --- | --- | --- |
| GET | /api/health | pública | funcional |
| GET | /api/ready | pública | depende do PostgreSQL |
| GET | /api/catalog | pública | snapshot sincronizado |
| POST | /api/contact | pública | salva contato com rate limit |
| POST | /api/auth/register | pública | empresa começa pendente |
| POST | /api/auth/login | pública | sessão HttpOnly |
| POST | /api/auth/logout | cookie | encerra sessão |
| GET | /api/auth/me | cookie | perfil e empresa |
| GET | /api/companies/me | cookie | empresa ativa |
| GET | /api/companies/me/people | admin/gestor | membros da própria empresa |
| GET | /api/orders | cookie | solicitações/pedidos da empresa |
| GET | /api/seats | cookie | vagas da empresa |
| POST | /api/proposals | admin/gestor/financeiro | solicitação sem cobrança |
| GET | /api/pricing/status | pública | disponibilidade de preços |
| POST | /api/pricing/quote | verificada + perfil autorizado | bloqueada por padrão |
| POST | /api/checkout | perfil autorizado | 503: aguardando Eduzz |
| POST | /api/seats/assign | perfil autorizado | 503: aguardando Área do Aluno |
| POST | /api/companies/lookup | cookie | 503: consulta de CNPJ desativada |
| POST | /api/integrations/eduzz/webhook | pública | 503: nenhum processamento |

**Escritas:** exigem header `Origin` correspondente a `APP_ORIGIN`; backend não tem CORS liberado. Requisições do frontend utilizam `/api` no mesmo domínio. CSRF deve ser submetido a testes de segurança adicionais antes da produção.

**Segurança:** confirmação matemática do CNPJ não concede status verificado; registros permanecem pendentes até revisão independente. Status de preços e produtos não cria pedido pagável. Não incluir informações confidenciais em respostas ou logs de erro.
