# Vivaion Empresas — Opção A: catalogação e execução

**Situação em 2026-11-11:** proposta de consolidação do código HML numa branch de revisão, sem deploy. Este documento não aprova preços, dados pessoais, pagamentos nem publicação.

## Escopo da Opção A
- Catálogo institucional de cursos e páginas informativas.
- Carrinho de simulação de valores, sem cobrança, reserva de preços ou matrícula.
- Solicitação comercial rastreável sem login obrigatório.
- Atendimento e revisão de propostas pela equipe.
- Controle de qualidade, acessibilidade, LGPD e operação.

## Snapshot auditado
- VPS de origem: `/srv/vivaion-empresas-preview` (somente leitura).
- HML: `empresas-hml.vivaion.com.br`, API local `127.0.0.1:8091`.
- Catálogo: 46 cursos, 37 disponíveis e 9 pré-lançamentos.
- Preços: 37 linhas geradas a partir de páginas oficiais; 28 promocionais na execução de 2026-11-11.
- Páginas individuais de cursos e carrinho informativo já existem no HML.
- Deploy de produção, checkout Eduzz e atribuição automática de vagas permanecem **fora do escopo**.

## Bloqueios rastreados para concluir A
- [ ] A0: revisão e CI da consolidação da versão HML.
- [ ] A1: validar conteúdo, imagens, grade e docentes; agendar atualização do catálogo.
- [ ] A2: obter aprovação comercial expressa para descontos, promoções e validade.
- [ ] A3: criar endpoint público com proteção antiabuso para solicitação de proposta; persistir snapshot de itens, quantidades, contato e preço informativo, com referência única.
- [ ] A4: implementar ou integrar painel interno de leads e histórico de atendimento com RBAC.
- [ ] A5: revisão UX mobile, acessibilidade e textos de benefícios.
- [ ] A6: finalizar LGPD, backups testados, logging, alertas, idempotência e políticas de retenção.
- [ ] A7: piloto supervisionado e aprovação específica para publicar em produção.

## Limites técnicos
1. Não confundir simulação, proposta negociada, pedido e pagamento.
2. Nunca prometer matrícula ou desconto vinculante sem aprovação.
3. Histórico de propostas deverá usar identificadores estáveis de empresa, produto e evento para permitir Opção B com vagas e progresso acadêmico.
4. O código do HML não deve ser sobrescrito pela branch sem QA e autorização.
5. **Vivaion Direto 1.0.0a3** ainda não tem o repositório Empresas registrado para workspace_edit; não foi usado para bypass ou escrita no serviço ativo.
6. Os leitores Vivaion Direto ocultam padrões que parecem segredos. Arquivos copiados para esta branch foram selecionados e, quando necessário, reconstruídas apenas expressões não secretas verificáveis; revisar diffs antes de qualquer merge.

## Aceitação mínima A0
- `npm ci --no-audit --no-fund`
- `npm run check`
- `npm run test`
- `npm run build`
- `npm run test:e2e` com mocks de catálogo/precificação para não exigir a API real
- Revisão de permissões, dependências, migração 005, scripts de importação e ausência de segredos no diff
