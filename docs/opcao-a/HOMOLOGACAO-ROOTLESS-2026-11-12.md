# Vivaion Empresas — Homologação local rootless
**Data:** 12/11/2026 (Brasília)  
**Ambiente:** `chat-empresas-9d90826c` — contêiner `root-direto-96e0c29c8b482506` do Vivaion Direto  
**Commit:** `9d90826c91887e2120658bc58afc551e12bd06c6` (PR #11; dependências #7 → #8 → #9)  
**Estado:** testes locais de sandbox aprovados; **NO-GO** para HML ativo e produção.

## Condições comprovadas

- O executor `workspace_exec` agora funciona; anteriormente a criação do contêiner era impedida por uma falha no operador. O teste `pwd` e a execução subsequente foram bem-sucedidos.
- Runtime exclusivamente dentro do contêiner rootless: Ubuntu 24.04.5, Node.js **22.23.4** e npm 10.9.9. Node foi baixado do site oficial e verificado com o arquivo `SHASUMS256.txt`.
- Dependências instaladas com `npm ci --no-audit --no-fund`.
- PostgreSQL **16.15** no contêiner (diferente do PostgreSQL 18 usado na CI do GitHub), banco descartável **`vivaion_empresas_hml_9d90826c`**; acesso por socket local, sem segredos de produção.
- `npm run check`: passou, 0 erros, 0 warnings, 1 hint.
- `npm run test`: passou.
- `npm run db:migrate`: passou, migrações 001–006 aplicadas.
- `npm run test:integration`: passou, incluindo isolamento de contas, validação de propostas e preços não aprovados.
- `npm run build`: passou, **63 páginas estáticas** geradas.
- `npx playwright install --with-deps chromium`: passou no contêiner.
- `npm run test:e2e`: **18 passaram**, 2 propositalmente ignorados por dependerem do backend real.
- Catálogo do repositório sincronizado localmente: **46 cursos**.
- Playwright integrado, `E2E_FULLSTACK=true`, com **API Express real em `127.0.0.1:8082`** e servidor estático em `127.0.0.1:4322`: **2 testes passaram** (desktop e mobile).
- Jornada testada: catálogo → carrinho sem preço autorizado (“Sob consulta”) → proposta sem login → protocolo → conferência do registro e evento de auditoria no PostgreSQL → limpeza das propostas fictícias.
- `npm audit --omit=dev --json`: **0 vulnerabilidades reportadas**, inclusive 0 moderadas, altas e críticas na execução local.

## Ensaio de backup/restauração descartável

- `pg_dump -Fc` do banco de testes → `pg_restore --no-owner --no-acl` em **outro banco descartável** `vivaion_empresas_restore_9d90826c`.
- Antes e depois: **20 tabelas**, **6 migrações**, **46 produtos ativos**, **0 leads** e **0 eventos de leads**.
- Resultado: **PASSOU**. Banco restaurado e arquivo do dump de teste foram eliminados após a conferência.
- **Limite importante:** este ensaio não comprova backup/restauração do banco operacional da VPS, do sistema de arquivos, do proxy HTTP ou de serviços systemd.

## Isolamento e integridade

- `git rev-parse HEAD` permanece em `9d90826c91887e2120658bc58afc551e12bd06c6`.
- Sem mudanças em arquivos Git rastreados. Apenas documentação nova, não commitada, em `docs/opcao-a/`.
- A API, o PostgreSQL e o Playwright utilizados são locais ao contêiner; **não houve implantação em empresas-hml.vivaion.com.br nem em empresas.vivaion.com.br**.
- `CORPORATE_PRICING_ENABLED=false` e `PUBLIC_SITE_LIVE=false` durante os testes. Sem Eduzz, cobrança, matrícula nem dados pessoais reais.

## Pendências para liberar publicação — issue #10

1. Instalar a versão integrada em HML operacional **autorizado**, em release imutável; validar TLS, cabeçalhos HTTP, proxy `/api`, health/readiness e observabilidade reais.
2. Executar plano de backup/restauração e rollback **da VPS** com evidências, sem afetar sistemas acadêmicos/UNYOM.
3. Aprovar política comercial de preços e descontos; manter “Sob consulta” até autorização.
4. Aprovar aviso de privacidade e retenção LGPD, revisar segurança dos leads.
5. Definir responsável pelo atendimento, fluxo operacional, monitoramento de solicitações e SLA.
6. Revisar catálogo/editorial e obter autorização expressa de implantação pelo publicador institucional.
7. Integrar PRs na ordem #7 → #8 → #9 → #11 após verificações de merge e revisão das bases.

**Decisão:** GO apenas para **testes técnicos em sandbox rootless**; NO-GO para publicação pública.
