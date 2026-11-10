# Contrato de integração com vivaion-site-astro (para o outro GPT)

**Repo institucional:** `selladev1/vivaion-site-astro`

**Endpoint público esperado:** `GET https://vivaion.com.br/integracoes/empresas/catalogo/v1.json`

O exportador deverá ser criado no repo institucional, não no portal Empresas.

## Fontes editoriais

- `src/data/postgraduateListing.ts` -> usar `postgraduateListingDisplayOffers`, respeitando exclusões públicas.
- `src/data/formacoesListing.ts` -> usar `formacoesListingOffers`, que JÁ incorpora `cursosLivres`.
- `src/data/courseTaxonomy.ts` -> temas disponíveis por slug.
- `src/data/pos/recorded/registry.ts` e `src/data/live-pos/livePosCatalog.ts` -> detalhes acadêmicos quando apropriado.
- `src/styles/tokens.css` -> referências de marca.

## Contrato v1

Referência executável em `contracts/src/index.ts`. Exemplo em `contracts/examples/catalog-v1.json`.

Propriedades obrigatórias por produto:

`id`, `slug`, `kind`, `title`, `summary`, `canonicalUrl`, `area`, `audienceLabel`, `audienceRestrictions`, `deliveryMode`, `commercialStage`, `tags`, `themes`, `workload`, `imageUrl`.

Para valores desconhecidos de `audienceRestrictions`, `workload` e `imageUrl`, usar `null`. `deliveryMode` pode ser `unspecified`.

`id` precisa ser exatamente `kind:slug`. `canonicalUrl` deve usar `https://vivaion.com.br`. O feed tem `schemaVersion:1`, `generatedAt` ISO 8601 com fuso e `products:[]`.

As modalidades são `live`, `recorded`, `online`, `hybrid`, `in-person`, `unspecified`. Os estados são `available`, `prelaunch`, `closed`.

O exportador deve testar unicidade, tipagem, links oficiais, produtos privados e ausência de dados comerciais.

## Proibido exportar

Preços, preços de campanha, cupons EUREKA, links de checkout, dados pessoais, tokens, webhooks, chaves Meta, produtos excluídos do catálogo público.

## Publicação e sincronização

Publicar somente após PR revisado e `npm run validate:site` aprovado. O portal Empresas sincronizará por tarefa externa isolada com `npm run catalog:sync`; inicialmente essa tarefa não está agendada. Proteger o site principal da indisponibilidade: não acoplar seu build ao portal Empresas.

Não alterar URLs, SEO, rastreamento, Eduzz ou Área do Aluno no repo institucional.
