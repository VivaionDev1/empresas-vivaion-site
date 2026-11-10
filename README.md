# Vivaion Empresas

Portal corporativo da Vivaion, para `empresas.vivaion.com.br`.

**Situação:** fundação em desenvolvimento, sem deploy de produção. Nenhum preço empresarial, checkout, webhook ou matrícula acadêmica está ativo. O catálogo é demonstrativo até a publicação do feed institucional.

## Arquitetura

- `frontend/`: Astro + TypeScript, páginas institucionais, catálogo pesquisável, cadastro e painel.
- `backend/`: Express + TypeScript, PostgreSQL próprio, autenticação por cookie HttpOnly e RBAC multiempresa.
- `contracts/`: contrato Zod v1 do catálogo editorial exportado pelo site `vivaion.com.br`.
- `docs/`: arquitetura, interface com o site principal, segurança e operação.

## Execução local (Node.js >= 22, PostgreSQL dedicado)

1. `npm install`
2. `cp backend/.env.example backend/.env` e configure credenciais de **banco de desenvolvimento exclusivo**.
3. Crie o banco e usuário PostgreSQL de desenvolvimento.
4. `npm run db:migrate`
5. Terminal 1: `npm run dev:backend` (127.0.0.1:8082)
6. Terminal 2: `npm run dev:frontend` (127.0.0.1:4321, proxy /api local)

Abra `http://localhost:4321`. A página de catálogo mostrará exemplos **identificados como demonstração** até o feed oficial ser disponibilizado e sincronizado.

## Comandos de qualidade

- `npm run check`: análise estática dos projetos.
- `npm run test`: testes do contrato, CNPJ, senhas e precificação.
- `npm run build`: compila o backend e gera o frontend estático.
- `npm run catalog:sync`: sincroniza o catálogo versionado (depende do endpoint institucional e PostgreSQL). Não é executado automaticamente no desenvolvimento.

## Integrações e segurança

O feed esperado é `https://vivaion.com.br/integracoes/empresas/catalogo/v1.json`. A fonte é exclusivamente editorial, sem preço ou links de checkout. O cálculo corporativo utiliza valores aprovados em tabelas isoladas no backend.

O cadastro CNPJ inicia com status `pending`. A validade matemática do CNPJ não comprova vínculo de representação. A conferência cadastral e a aprovação são externas ao cadastro público.

Ao consultar e preparar integrações, **não** altere `selladev1/vivaion-site-astro`, UNYOM ou a Área do Aluno neste repositório. Não reutilize segredos, tokens ou bancos de produção. Veja `docs/security-gates.md`.

## Publicação

Consulte `docs/deploy.md`. Não habilite `PUBLIC_SITE_LIVE=true`, `CORPORATE_PRICING_ENABLED=true`, pagamentos ou matrículas antes da homologação e revisão de segurança.

## Status de implementação

| Fase | Estado |
| --- | --- |
| Monorepo, CI, contratos | Implementada, aguardando CI |
| Identidade e páginas públicas | Implementadas, aguardando revisão visual |
| Catálogo via JSON | Consumidor implementado; endpoint ainda pendente |
| Autenticação e CNPJ | Base implementada; verificação cadastral, recuperação e MFA pendentes |
| Descontos | Motor de cálculo implementado; sem política ativa |
| Pagamento | Modelagem inicial; checkout e webhook desativados |
| Vagas e matrículas | Modelagem e visualização; atribuição desativada |
| Publicação | Não realizada |

## Iteração de segurança #2 (branch separada)

- A integridade entre `orders`, `order_items`, `seats` e `memberships` agora é reforçada por chaves estrangeiras compostas; dados de empresas diferentes não podem ser vinculados.
- O cadastro não entrega sessão antes da verificação de e-mail, que usa link de uso único válido por 24 horas.
- Recuperação de senha via token de uso único válido por 30 minutos, com revogação das sessões anteriores.
- **Sem provedor de e-mail configurado, o cadastro e a recuperação respondem 503.** Isso é intencional. Configurar um relay HTTPS transacional autorizado antes de homologar essas funcionalidades.
- A verificação de e-mail não aprova o CNPJ nem o representante, e a política de preços segue desativada.
- Testes de integração foram ampliados, sem publicar ou migrar bancos existentes.
