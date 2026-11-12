# Vivaion Empresas — Pacote e procedimento de homologação HML

**Estado:** candidato de homologação, não aprovado para produção. **Não executar este procedimento na VPS sem operador de implantação autorizado.**

## Identidade do pacote

Um build de CI em checkout Git limpo gera um arquivo `empresas-hml-<commit>.tgz`, um checksum `.tgz.sha256` e um `release-manifest.json` com uma lista explícita de arquivos e hashes individuais SHA-256. O pacote é **somente HML** e contém:

- `frontend/dist` (Astro estático, com `noindex, nofollow`);
- `backend/dist` (Express compilado e scripts compilados de migração);
- `contracts/dist` e metadados dos três workspaces npm;
- `backend/migrations` (SQL 001–006);
- `data/catalog-v1.json` e `data/course-details.json`;
- `package.json` e `package-lock.json` para `npm ci --omit=dev`.

Arquivos de ambiente, segredos, `.git`, `node_modules`, testes e arquivos não permitidos **não são empacotados**. O checksum detecta alteração acidental/corrupção, **não autentica o publicador**. A autorização/assinatura do artefato e do deploy é uma etapa separada.

## Comandos no workspace isolado

Depois de `npm ci`, `npm run build` (com `PUBLIC_SITE_LIVE=false` e `CORPORATE_PRICING_ENABLED=false`):

```sh
npm run release:candidate
npm run release:verify -- ".release-out/empresas-hml-$(git rev-parse HEAD)"
npm run release:rehearse -- ".release-out/empresas-hml-$(git rev-parse HEAD)"
```

O comando `release:candidate` exige Git limpo, commit exato e index do Astro com `noindex, nofollow`. O parâmetro `--allow-dirty` só existe para ensaio **não publicável** e produz `sourceClean:false` no manifesto. Um artefato com `sourceClean:false` não pode ser tratado como liberação.

O `release:verify` compara checksum do tar, manifesto individual, conteúdo e metadados de HML. O `release:rehearse` verifica a troca atômica e a reversão de um link simbólico **dentro de `.release-rehearsal` neste workspace**. Ele **não** atua sobre Apache, systemd, banco operacional ou symlink de produção.

## Critérios para publicar em HML real (responsável da VPS)

1. Liberar e identificar um responsável pelo publicador assinado, com permissão específica para HML.
2. Verificar assinatura externa do artefato aprovado, commit do manifesto, SHA-256, política de `sourceClean:true`, `channel:hml`, `publicSiteLive:false` e os checks da CI do SHA.
3. Proteger HML contra acesso indevido; não expor formulários com dados pessoais reais enquanto LGPD/atendimento não forem aprovados.
4. Criar nova pasta de release **sem sobrescrever a versão ativa**, fazer backup/restore drill do banco HML (sem dados reais) e aplicar migrações 001–006 no banco `vivaion_empresas*` exclusivo, via `node dist/scripts/migrate.js` a partir de `backend/`.
5. Instalar dependências exatas (`npm ci --omit=dev --no-audit --no-fund`) dentro da pasta nova, sem usar credenciais do repositório original. Manter `DATABASE_URL`, `APP_ORIGIN`, `HOST=127.0.0.1`, `CORPORATE_PRICING_ENABLED=false` e demais variáveis protegidas fora do DocumentRoot.
6. Testar o serviço API **em porta de homologação separada** com `/api/ready` e `/api/catalog` e confirmar `/api/commercial/catalog` devolvendo 503 enquanto não houver aprovação de preços.
7. Testar proxy `/api`, HTTPS, `noindex`, headers de segurança, política de logs, rate limits e cenário de proposta fictícia end-to-end, inclusive protocolo e auditoria do lead.
8. Registrar snapshot/rollback **das versões e do estado do banco HML**; em caso de falha, o publicador deve reverter para o último SHA aprovado e restaurar backup se necessário.
9. Exigir autorização explícita de troca de versão do HML e anotar SHA, hora, responsável, resultados de smoke, métricas e plano de retorno na issue #10.
10. Antes da produção, obter aprovação comercial (preços/descontos), jurídica/LGPD (dados, aviso e retenção), editorial (catálogo) e operações (SLA, notificações, triagem). Não copiar configuração de HML/Basic Auth para produção por conveniência.

### Limites e proibições

- **Nunca** usar esse script para sobrescrever `/srv/vivaion-empresas-preview` ou `/var/www/empresas.vivaion.com.br`; o script gera e ensaia pacotes apenas no workspace privado.
- Não confundir sucesso no sandbox rootless com deploy e restauração efetivamente validados na VPS.
- Não ativar `PUBLIC_SITE_LIVE`, checkout Eduzz, pagamentos, matrículas, vagas ou sincronização acadêmica.
- Não usar nem divulgar credenciais reais nos relatórios e logs.
- Este documento não substitui a assinatura do publicador nem muda o estado **NO-GO da issue #10**.

## Referências de acompanhamento

- PRs encadeadas: #7 → #8 → #9 → #11 → PR do pacote de release.
- Homologação rootless com 20 testes de navegador aprovados e restauração de PostgreSQL 16: `docs/opcao-a/HOMOLOGACAO-ROOTLESS-2026-11-12.md` no workspace.
- Issue #10: gates de HML/produção e aprovações institucionais.
