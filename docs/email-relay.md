# Integração de e-mail transacional — pendente de provedor

O portal **não** envia mensagens reais sem configurações explícitas de um relay HTTPS de e-mail transacional. Não envie tokens de confirmação ou recuperação através do browser, links de terceiros ou logs públicos.

## Contrato do relay

Configurar exclusivamente no backend:

- `MAIL_RELAY_URL`: endpoint HTTPS autorizado pela Vivaion (porta 443, sem credenciais na URL ou redirecionamentos).
- `MAIL_RELAY_ALLOWED_HOST`: **host exato** do serviço transacional, aprovado e provisionado separadamente pela operação (ex.: `relay.provedor-autorizado.com.br`). Não usar curingas, subdomínios parciais, IPs, localhost, nomes internos ou domínios de teste.
- `MAIL_RELAY_BEARER_TOKEN`: token secreto do relay.
- `MAIL_FROM`: remetente aprovado (ex.: domínio previamente verificado).

Requisição enviada pelo backend:

```http
POST /envio
Authorization: Bearer <segredo>
Content-Type: application/json

{
  "from": "no-reply@dominio-validado",
  "to": "representante@empresa.com",
  "subject": "Confirme seu e-mail | Vivaion Empresas",
  "text": "Mensagem contendo o link de uso único",
  "category": "account-verification"
}
```

Um código 2xx significa que o relay **aceitou** a mensagem; a entrega final deve ser verificada por logs e callbacks do provedor no lado do relay. Redirecionamentos e falhas produzem erro, sem aprovar a conta.

### Defesa contra SSRF e vazamento do Bearer

- O host da URL precisa coincidir **exatamente** com `MAIL_RELAY_ALLOWED_HOST`, sem aceitar host por sufixo (`relay.exemplo.com.atacante.tld`).
- Somente HTTPS na porta 443, com verificação de certificado e SNI do domínio autorizado; o cliente HTTPS nativo **não segue redirects**.
- Antes de conectar, a API consulta os endereços A/AAAA e recusa toda a resolução se **qualquer** endereço for privado, loopback, link-local, não roteável ou reservado (IPv4 e IPv6).
- A conexão é feita **diretamente ao IP já validado**, mantendo o nome permitido para o cabeçalho Host, SNI e conferência do certificado. Assim, não há segunda resolução DNS entre a validação e a conexão (proteção contra DNS rebinding).
- Se a allowlist estiver ausente ou divergente, o envio permanece indisponível (fail closed) e não expõe o Bearer.
- Em produção, recomenda-se complementar o aplicativo com regras de firewall/egress do serviço para impedir conexões de saída a redes privadas, independentemente da configuração da aplicação.
- Alterações em `MAIL_RELAY_ALLOWED_HOST` exigem revisão e controle de acesso às variáveis de ambiente; alguém com controle integral do servidor/segredos ainda pode substituir ambos os valores, o que deve ser mitigado operacionalmente.

O relay pode adaptar o JSON à API de um provedor aprovado posteriormente, sem alterar os endpoints públicos do portal.

## Fluxos de segurança

- Cadastro: valida sintaxe CNPJ, cria organização `pending`, cria usuário **sem sessão**, registra hash do token de confirmação com validade de 24h; envia e-mail após commit.
- Falha de entrega após o commit: cadastro continua pendente e a resposta indica `delivery_unconfirmed`. Reenvio genérico fica disponível, com intervalo mínimo de 60 segundos por conta. Nunca reaproveitar o token bruto.
- Login: bloqueado até `email_verified_at`, com mensagem `email_unverified`, mas continua sem confirmar a representação do CNPJ.
- Recuperação: resposta idêntica para e-mails existentes e inexistentes; token de 30 minutos, uso único; revoga todas as sessões após sucesso.
- Teste: `NODE_ENV=test` habilita somente uma caixa postal em memória acessível por import do módulo de testes, sem endpoint HTTP.
- Produção: jamais utilizar `NODE_ENV=test` nem devolver links/tokens de confirmação nas respostas.

## Pendências antes do lançamento

1. Selecionar e contratar o fornecedor de e-mail ou relay institucional.
2. Verificar remetente, SPF, DKIM, DMARC e entregabilidade.
3. Definir política de retenção e eliminação dos tokens expirados.
4. Homologar limites de envios por conta/IP, proteção contra abuso e recuperação humana.
5. Estabelecer a revisão administrativa de representantes empresariais e MFA.
