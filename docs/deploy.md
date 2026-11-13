# Operação e implantação (procedimento proposto, não executado)

## 1. Inventário e isolamento

Antes de qualquer alteração, identificar domínios, VirtualHosts, portas, espaço, RAM, CPU, certificados e serviços existentes na VPS. Preservar a Área do Aluno, UNYOM e site institucional.

Diretório de aplicação sugerido: `/var/www/empresas.vivaion.com.br`. Publicar o frontend estático em `frontend/dist` e executar a API como usuário próprio, vinculada à loopback na porta 8082.

Banco PostgreSQL exclusivo: `vivaion_empresas` (ou `vivaion_empresas_dev` / `vivaion_empresas_test` em ambientes não produtivos), proprietário e privilégios próprios. O backend rejeita nomes de banco fora desse prefixo, impedindo operações acidentais em `unyomdb` ou bancos acadêmicos.

## 2. Build

```bash
npm install --no-audit --no-fund
npm run check
npm run test
npm run build
```

Configurar `backend/.env` fora do repositório; o arquivo não deve ser commitado. Executar migrações contra o banco correto com `npm run db:migrate`. Para sincronizar o catálogo **após** o endpoint oficial estar publicado: `npm run catalog:sync`.

## 3. Apache (referência, não executar automaticamente)

Exemplo para adaptação à configuração real e aos certificados existentes:

```apache
<VirtualHost *:443>
    ServerName empresas.vivaion.com.br
    DocumentRoot /var/www/empresas.vivaion.com.br/frontend/dist
    # Adicionar SSLEngine, SSLCertificateFile e SSLCertificateKeyFile
    # somente após emitir certificados válidos para este host.
    ProxyPreserveHost On
    ProxyPass /api/ http://127.0.0.1:8082/api/
    ProxyPassReverse /api/ http://127.0.0.1:8082/api/
    <Directory /var/www/empresas.vivaion.com.br/frontend/dist>
        Options -Indexes
        AllowOverride None
        Require all granted
    </Directory>
</VirtualHost>
```

Requer módulos proxy, proxy_http e ssl. Configure HTTP -> HTTPS, HSTS apenas após confirmar HTTPS funcional e cadeia completa. Não copiar VirtualHost ou incluir isso diretamente sem inspeção; verificar `apachectl configtest` antes de reload.

**Certificado:** emissão Let’s Encrypt via HTTP-01 exige DNS apontando e challenge acessível; obter o IPv4 público real antes de indicar o registro A na Hostinger.

## 4. Segurança operacional

O backend deve ficar inacessível pela rede pública e somente pelo proxy local. Nunca servir `backend/.env`, `frontend/src` ou migrations via DocumentRoot.

Não ativar `PUBLIC_SITE_LIVE` antes de revisão editorial e acessibilidade. Políticas comerciais, checkout Eduzz, webhook e concessão de vagas permanecem desativados. Backups e restauração precisam ser testados, sem afetar sistemas existentes.
