# Deploy — Google Cloud Run + Cloud SQL (PostgreSQL) + Secret Manager

Uma única imagem Docker serve a API, o painel e o `pixel.js`. O worker que envia os eventos à
Meta roda **dentro do mesmo serviço** (`EMBEDDED_WORKER=true`). Várias instâncias podem rodar ao
mesmo tempo: a fila é reservada com `FOR UPDATE SKIP LOCKED`, então nenhum evento sai duas vezes.

> Nada aqui foi executado contra uma conta real. Os comandos são o roteiro; revise nomes, região
> e custos antes de rodar. Nenhum passo apaga dados.

## 0. Variáveis usadas nos comandos

```bash
export PROJECT=seu-projeto REGION=southamerica-east1 INSTANCE=paytracking-db SERVICE=paytracking
```

```bash
export IMAGE=$REGION-docker.pkg.dev/$PROJECT/paytracking/app
```

## 1. Infraestrutura (uma vez)

```bash
gcloud services enable run.googleapis.com sqladmin.googleapis.com secretmanager.googleapis.com artifactregistry.googleapis.com cloudbuild.googleapis.com --project $PROJECT
```

```bash
gcloud artifacts repositories create paytracking --repository-format=docker --location=$REGION --project $PROJECT
```

Banco (PostgreSQL 16, backups diários e recuperação por ponto no tempo ligados):

```bash
gcloud sql instances create $INSTANCE --database-version=POSTGRES_16 --region=$REGION --tier=db-custom-1-3840 --backup-start-time=05:00 --enable-point-in-time-recovery --project $PROJECT
```

```bash
gcloud sql databases create paytracking --instance=$INSTANCE --project $PROJECT
```

```bash
gcloud sql users create paytracking --instance=$INSTANCE --password="$(openssl rand -base64 24)" --project $PROJECT
```

Guarde a senha gerada direto no Secret Manager (passo 2); não a cole em chat nem em arquivo.

Conta de serviço do app, com acesso só ao que precisa:

```bash
gcloud iam service-accounts create paytracking-run --project $PROJECT
```

```bash
for role in roles/cloudsql.client roles/secretmanager.secretAccessor; do gcloud projects add-iam-policy-binding $PROJECT --member=serviceAccount:paytracking-run@$PROJECT.iam.gserviceaccount.com --role=$role; done
```

## 2. Segredos

Cada segredo é criado lendo da entrada padrão, sem passar pelo histórico do shell:

```bash
openssl rand -base64 32 | tr -d '\n' | gcloud secrets create ENCRYPTION_KEY --data-file=- --project $PROJECT
```

```bash
read -rs V && printf %s "$V" | gcloud secrets create DATABASE_URL --data-file=- --project $PROJECT
```

Formato do `DATABASE_URL` pelo socket do Cloud SQL:
`postgres://paytracking:SENHA@/paytracking?host=/cloudsql/PROJETO:REGIAO:INSTANCIA`

Repita o `read -rs` para `META_APP_SECRET`, `WOOVI_WEBHOOK_SECRET`, `WOOVI_APP_ID`,
`VAPID_PRIVATE_KEY` e `RESEND_API_KEY`.

**Importante:** use valores **novos**. Os segredos do sistema antigo circularam nos ZIPs
(relatório, P-01) e devem ser considerados comprometidos: gere um novo App Secret no painel da
Meta, novo segredo de webhook e App ID na Woovi, novo par VAPID (`npx web-push generate-vapid-keys`)
e nova senha do MySQL antigo.

`ENCRYPTION_KEY` cifra os tokens guardados no banco. **Perdê-la torna esses tokens ilegíveis**:
mantenha o Secret Manager com versões habilitadas e nunca destrua versões antigas.

## 3. Imagem

```bash
gcloud builds submit --tag $IMAGE:$(git rev-parse --short HEAD) --project $PROJECT
```

## 4. Migrações (antes de cada deploy)

Backup sob demanda antes de migrar:

```bash
gcloud sql backups create --instance=$INSTANCE --description="antes-de-$(git rev-parse --short HEAD)" --project $PROJECT
```

Job de migração (criado uma vez, atualizado a cada versão):

```bash
gcloud run jobs deploy paytracking-migrate --image $IMAGE:$(git rev-parse --short HEAD) --region $REGION --command node --args dist/scripts/migrate.js --set-cloudsql-instances $PROJECT:$REGION:$INSTANCE --set-secrets DATABASE_URL=DATABASE_URL:latest --service-account paytracking-run@$PROJECT.iam.gserviceaccount.com --project $PROJECT
```

```bash
gcloud run jobs execute paytracking-migrate --region $REGION --wait --project $PROJECT
```

As migrações são versionadas (`packages/db/migrations/NNN_*.sql`), aplicadas em ordem, uma
única vez, sob trava (`pg_advisory_lock`). Regra do projeto: **só migrações aditivas** (criar
tabela/coluna/índice). Remoções acontecem em uma versão posterior, depois que nenhuma revisão
em produção usa a coluna. Assim a revisão anterior continua funcionando se for preciso voltar.

## 5. Serviço

```bash
gcloud run deploy $SERVICE --image $IMAGE:$(git rev-parse --short HEAD) --region $REGION --service-account paytracking-run@$PROJECT.iam.gserviceaccount.com --add-cloudsql-instances $PROJECT:$REGION:$INSTANCE --min-instances 1 --no-cpu-throttling --concurrency 80 --timeout 60 --allow-unauthenticated --set-secrets DATABASE_URL=DATABASE_URL:latest,ENCRYPTION_KEY=ENCRYPTION_KEY:latest,META_APP_SECRET=META_APP_SECRET:latest,WOOVI_WEBHOOK_SECRET=WOOVI_WEBHOOK_SECRET:latest,WOOVI_APP_ID=WOOVI_APP_ID:latest,VAPID_PRIVATE_KEY=VAPID_PRIVATE_KEY:latest,RESEND_API_KEY=RESEND_API_KEY:latest --set-env-vars NODE_ENV=production,TRUST_PROXY=1,EMBEDDED_WORKER=true,APP_URL=https://app.seudominio.com.br,PUBLIC_API_URL=https://app.seudominio.com.br,META_APP_ID=SEU_APP_ID,VAPID_PUBLIC_KEY=SUA_CHAVE_PUBLICA,PLATFORM_ADMIN_EMAILS=voce@seudominio.com.br --project $PROJECT
```

Por que cada opção:
- `--min-instances 1 --no-cpu-throttling`: o worker precisa de CPU fora das requisições para esvaziar a fila.
- `TRUST_PROXY=1`: o Cloud Run acrescenta o IP real ao `X-Forwarded-For`; confiar em mais que isso permitiria ao cliente forjar o IP. Com `NODE_ENV=production` o servidor recusa subir com `TRUST_PROXY=true`.
- `APP_URL` = `PUBLIC_API_URL`: painel e API na mesma origem, então o cookie de sessão fica `SameSite=Lax` sem CORS.

Domínio: mapeie `app.seudominio.com.br` para o serviço (Cloud Run → Gerenciar domínios
personalizados, ou um Load Balancer HTTPS). Na Meta, cadastre o redirecionamento OAuth
`https://app.seudominio.com.br/v1/meta/callback`.

## 6. Verificação depois do deploy

```bash
curl -fsS https://app.seudominio.com.br/healthz
```

Depois:
1. Entre no painel, crie um pixel e clique em **Testar token** (valida Pixel ID e token na Graph API sem enviar evento).
2. Preencha o código de teste do Gerenciador de Eventos no pixel, abra a página de vendas com o snippet e confira o PageView em “Eventos de teste” da Meta.
3. Diagnóstico → a fila deve mostrar o evento como **Enviado** (com `fbtrace_id`). Depois apague o código de teste do pixel.
4. Faça uma venda de teste real em cada gateway (valor mínimo) e confira em Vendas e no Gerenciador de Eventos.

## 7. Rollback

As imagens são imutáveis e marcadas pelo commit. Para voltar o tráfego para a revisão anterior:

```bash
gcloud run revisions list --service $SERVICE --region $REGION --project $PROJECT
```

```bash
gcloud run services update-traffic $SERVICE --to-revisions=NOME_DA_REVISAO_ANTERIOR=100 --region $REGION --project $PROJECT
```

Como as migrações são aditivas, a revisão anterior funciona com o banco novo. Restaurar o
backup só é necessário se uma migração corromper dados: isso **perde as vendas recebidas desde o
backup**, então prefira corrigir para frente. Webhooks recebidos ficam em `webhook_receipts`
(com o corpo cifrado por `WEBHOOK_BODY_RETENTION_DAYS`), o que permite reprocessar.

## 8. Checklist de produção

- [ ] Todos os segredos novos (nenhum reaproveitado do sistema antigo) e só no Secret Manager
- [ ] `NODE_ENV=production`, `TRUST_PROXY=1`, URLs `https://`
- [ ] Backups automáticos e PITR ligados no Cloud SQL; um restore testado em instância separada
- [ ] `PLATFORM_ADMIN_EMAILS` com apenas os e-mails da equipe
- [ ] App da Meta em modo Live, com `ads_read`/`ads_management` aprovados e o redirect cadastrado
- [ ] Webhook da Woovi apontando para `/api/billing_webhook.php` (ou `/v1/webhooks/woovi`) com o segredo novo
- [ ] Alertas do Cloud Monitoring (ver `docs/OPERACAO.md`)
- [ ] Venda de teste aprovada e reembolsada em cada gateway usado, conferida no painel e na Meta
- [ ] `META_GRAPH_BASE_URL` e `META_TEST_EVENT_CODE` **vazios** em produção

## Alternativa: hospedagem Node.js por painel (sem Docker)

Para plataformas que pedem “framework / comando de construção / arquivo de entrada” (ex.: hPanel):

| Campo | Valor |
|---|---|
| Framework / tipo | Fastify (ou Express / Other) |
| Comando de construção | `pnpm run build` |
| Gerenciador de pacotes | `pnpm` (o projeto fixa 11.24.0) |
| Diretório de saída | em branco |
| Arquivo de entrada | `server.js` (o da raiz) |

Como funciona:
- `server.js` na raiz é CommonJS e carrega `apps/server/dist/server.js` com `import()`: funciona com
  `node server.js` e com hospedagens que carregam a entrada via `require()` (LiteSpeed/Passenger).
- `apps/server/dist` é **autossuficiente** (dependências, painel em `dist/web`, pixel em `dist/pixel`,
  migrações) e fica versionado: o workflow `build-dist.yml` o regenera a cada push. Se o painel
  exigir diretório de saída, use `apps/server/dist` com entrada `server.js`.
- `PORT` pode ser número ou caminho de socket (a hospedagem decide); deixe em branco no painel.
- Se a inicialização falhar (variável faltando, banco inacessível), o processo **não cai**: responde
  `503` com `{"ok":false,"motivo":"..."}` (sem valores secretos) e tenta de novo a cada 30 s.
- Banco: PostgreSQL 16+ (ex.: Neon, URL com `-pooler`). Use `MIGRATE_ON_START=true` e `EMBEDDED_WORKER=true`.
- Com a fila vazia o worker dorme até 10 min (`CAPI_IDLE_POLL_SECONDS`), e evento novo o acorda na
  hora: o Neon consegue suspender a compute ociosa.
