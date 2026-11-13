# Homologação ponta a ponta — Opção A (ambiente descartável)

Este teste **não implanta serviços na VPS nem substitui o HML**. Ele executa uma API Express real, um banco PostgreSQL 18 isolado no GitHub Actions e a interface Astro compilada no mesmo host descartável.

## Passos da CI

1. Instalar dependências do lockfile e executar check, testes e migrações 001–006.
2. Gerar frontend Astro e backend Express.
3. Rodar os testes de interface estática.
4. Sincronizar o catálogo oficial embarcado de 46 formações para PostgreSQL descartável.
5. Inicializar API `127.0.0.1:8082` e servidor frontend `127.0.0.1:4322`, com proxy **apenas de teste**.
6. Verificar via navegador: pesquisar curso disponível, incluir sem preços aprovados, abrir carrinho, enviar proposta sem login, obter protocolo, validar banco e evento de auditoria, limpar o lead fictício.
7. Preservar artefatos não publicados sob SHA do commit por sete dias.

O frontend deve permanecer em `PUBLIC_SITE_LIVE=false`, API em `CORPORATE_PRICING_ENABLED=false`, com banco de nome `vivaion_empresas_test`. Não usar dados reais ou senhas da VPS.

## Critérios ainda não cobertos

- HML real na VPS com workspace autorizado no Vivaion Direto.
- Backup e restauração ensaiados no host.
- Aprovação comercial dos valores, LGPD, operação de atendimento, revisão acadêmica e autorização de deploy.
- A publicação do domínio `empresas.vivaion.com.br` e fluxo de rollback real.

Esses pontos permanecem **NO-GO** na issue #10, mesmo com CI completa verde.
