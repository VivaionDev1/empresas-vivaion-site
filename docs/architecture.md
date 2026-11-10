# Arquitetura Vivaion Empresas

## Limites e responsabilidade

O portal Empresas é um produto B2B independente. Não reutiliza o banco nem a autenticação de alunos, UNYOM ou do site público.

```text
vivaion.com.br (Astro editorial)
       |
       | HTTPS JSON catálogo /integracoes/empresas/catalogo/v1.json
       v
Backend Empresas (Node/Express) -> Postgres exclusivo
       |                           |- empresas e membros
       |                           |- catálogo sincronizado
       |                           |- propostas, pedidos e vagas
       v
empresas.vivaion.com.br (Astro estático, /api via Apache)
       |
       +-> Eduzz: FUTURA integração por API e webhook validado
       +-> Área do Aluno: FUTURA atribuição via adaptador autorizado
```

O frontend não realiza consultas autenticadas a outro domínio. O Apache encaminha `/api/` ao backend na loopback 127.0.0.1:8082. A API verifica `Origin` para toda escrita e usa sessões HttpOnly de curta duração relativa (7 dias) com token aleatório armazenado apenas como hash no banco.

## Identidade visual

Paleta institucional (referência em `vivaion-site-astro/src/styles/tokens.css`):

- Azul profundo: `#052a3b`.
- Azul institucional: `#0b5880`.
- Fundo creme: `#fffbf3`.
- Laranja: `#ffbe7e`.

Fonte de corpo Poppins (Google Fonts OFL). Cabeçalhos utilizam Bookmania apenas se uma licença e o arquivo de fonte forem disponibilizados legalmente, senão Georgia. Nenhuma fonte proprietária está incluída neste repositório.

## Contrato de catálogo

A API importa o JSON com validação Zod estrita de `contracts/src/index.ts` e preserva o último snapshot válido em PostgreSQL. A ausência de produtos do feed desativa-os no catálogo atual sem apagar históricos. ETag e hash persistidos controlam a sincronização.

O contrato **não inclui preços**. O frontend só mostra preços após o backend autorizar; enquanto isto não ocorrer, apenas consulta de produtos e solicitação de proposta.

## Fluxos

1. Contato público: formulário de solicitação cria registro sem cobrança.
2. Cadastro: valida CNPJ matematicamente, cria empresa pendente, usuário e vínculo administrativo.
3. Login: gera token de sessão e entrega cookie HttpOnly de primeira parte.
4. Painel: carrega dados de perfil, propostas/pedidos e vagas filtrados pela empresa autenticada.
5. Proposta: produtos precisam estar sincronizados; solicitação permanece `requested`.
6. Precificação: somente empresa verificada, feature flag ativada, política ativa e preço aprovado por produto.
7. Eduzz e matrículas: rotas explicitamente retornam 503 até homologação; nenhum evento é consumido como pago.

## Evolução

Antes da produção: verificação de e-mail, recuperação de conta, MFA opcional, auditoria formal da autorização por empresa, serviço de e-mail e notificações, CNPJ cadastral com validação do representante, retenção de dados, RLS ou reforço adicional do isolamento no banco e testes E2E. A solução inicial é um esqueleto funcional para homologação, não substitui essa revisão.
