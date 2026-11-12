# Vivaion Empresas — Release Candidate da Opção A

## Escopo e estado

Este release candidate fornece catálogo de formações, carrinho de prévia e captação de solicitações comerciais sem autenticação ou cobrança. **O pipeline automatizado verde não aprova a publicação pública.**

- Branch de consolidação: `feat/empresas-opcao-a-consolidacao-20261111` (PR #7).
- Captação de propostas: `feat/empresas-opcao-a-propostas-publicas` (PR #8).
- Hardening de pré-publicação: `feat/empresas-opcao-a-release-hardening` (PR dependente).
- Sem checkout, webhooks Eduzz, gestão de vagas ou integração Student.
- Não misturar HML com produção ou executar migrações em bancos UNYOM/acadêmicos.

## Regras obrigatórias de publicação

1. Revisor comercial deve **assinar uma versão da política** de desconto: percentuais, faixas, convivência com promoções, prazo de validade e responsabilidade pela aprovação. A sincronização de preços é **importação de dados**, não aprovação. Valores novos ou alterados ficam sem aprovação; o público vê **'Sob consulta'**.
2. Validação jurídica deve aprovar aviso de privacidade, base legal, prazo de retenção, canal de direitos do titular e as condições de tratamento dos leads. O aviso atual da página /privacidade/ é preliminar; substituí-lo antes de captar contatos publicamente.
3. Equipe comercial deve homologar processo de recebimento e atendimento. O cadastro de lead grava no PostgreSQL, mas **não envia notificação automaticamente**; sem painel/CRM ou atendimento definido, leads podem ficar sem resposta.
4. Confirmar consentimento informativo, antibot, rate limits e política de exclusão. Proibir logs contendo PII e nunca usar dados reais para smoke tests.
5. Auditoria e segurança devem aprovar HML, proteção de administração, backups com restauração ensaiada, alarme de falha e política de resposta a incidentes.
6. Não ativar `PUBLIC_SITE_LIVE` enquanto o conteúdo e o fluxo não estiverem aprovados. Na produção, configurar `APP_ORIGIN`, TLS, proxy API e CSP coerente com domínio.
7. Publicador assinado deve ter autorização específica de implantação; o Vivaion Direto MCP não oferece deploy de host ou publicação de produção.
8. PRs são encadeadas: #1 fundação → #6 segurança → #7 catálogo → #8 propostas → hardening. Merge só por autorização de release, sem pular revisões.

## Matriz de testes

| Gate | Critério |
|---|---|
| CI | npm ci, check, testes unitários, integração contra PostgreSQL 18 isolado, build, Playwright desktop/mobile |
| Proposta | cadastro sem conta, protocolo único, prevenção de replay, limites de itens, título oficial e sem preço vinculante |
| Privacidade | titular sabe finalidade, canal de contato, prazo de retenção, acesso restrito |
| Preços | imports não ativam descontos; preços alterados perdem aprovação e precisam de revisão manual |
| Catálogo | 46 produtos revisados, 9 pré-lançamentos diferenciados, links e docentes conferidos |
| Mobile | 390px e 768px, teclado, leitores de tela, estados de erro/indisponibilidade |
| Recuperação | backup/restauração e rollback verificados no ambiente isolado |
| Operações | lead recebida → designada → contatada → proposta enviada → concluída; fluxo com responsável real |
| Publicação | TLS, DNS, noindex de HML, canonical de produção, check de 404, logs, alarmes, rollback |

## Procedimento de release, quando autorizado

- Criar artefato imutável pela CI com SHA e checksum; não publicar diretamente de diretório editado manualmente.
- Criar banco `vivaion_empresas*` exclusivo e fazer backup restaurável antes de migrações.
- Validar migrações até 006 num banco descartável e depois no ambiente de staging autorizado.
- Configurar serviço API local em loopback, proxy HTTPS e variáveis protegidas fora do DocumentRoot.
- Verificar permissões, diretórios estáticos, controles de cache, cookies e rotas API.
- Testar com leads fictícios e remover dados de homologação após validação.
- Obter aprovação comercial, jurídica, segurança e operativa. Registrar responsáveis e data.
- Publicar via fluxo de release autorizado com opção de voltar ao build anterior; monitorar pós-deploy.
- **Não** iniciar checkout, Eduzz, faturamento, vagas ou matrículas.

## Operação temporária de leads

Até existir um backoffice institucional, `backend/scripts/operate-leads.ts` permite operações **apenas a um operador autorizado no shell da VPS**, com `LEAD_OPERATIONS_ENABLED=true`. A listagem é limitada e não contém e-mail/telefone/mensagem. Uma revisão muda estado sob transação e registra ator + justificativa, mas o nome informado pelo operador **não é autenticação forte**; esta ferramenta não substitui RBAC e auditoria de um painel.

Não habilitar essa função para funcionários não treinados nem utilizá-la como justificativa isolada para abrir o portal público.

## Pendências que requerem aprovação humana

- Política comercial, conformidade LGPD, publicação de conteúdo e nomeação de responsáveis.
- Recebimento operacional de leads, aviso de privacidade final e canal oficial de contato.
- Execução e evidências do restore drill na VPS e implantação HML isolada.
- Autorização explícita de cutover e acesso ao publicador assinado, que este MCP não expõe.
