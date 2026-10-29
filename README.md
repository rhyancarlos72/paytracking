# PayTracking

Rastreamento de conversões para quem vende com Meta Ads: recebe os webhooks dos gateways
(Kiwify, Cakto, Kirvano, Hotmart, Lowify, Wiapay e checkout próprio), confirma o pagamento,
envia o `Purchase` à **Meta Conversions API** com deduplicação contra o Pixel do navegador e
mostra no painel a receita confirmada ao lado do investimento em anúncios.

Reconstrução em TypeScript do sistema PHP original. O código antigo **não** foi alterado; o
diagnóstico está em [`docs/fase-1-auditoria/RELATORIO-AUDITORIA.md`](docs/fase-1-auditoria/RELATORIO-AUDITORIA.md)
e as decisões em [`docs/fase-2-arquitetura/ADR.md`](docs/fase-2-arquitetura/ADR.md).

## Regras que o sistema garante

- **Compra só com pagamento aprovado.** PIX gerado, boleto emitido, `unpaid`, `waiting_payment` etc. ficam como *pendente* e nunca geram `Purchase` nem entram na receita.
- **Webhook idempotente.** O mesmo evento repetido não cria venda nem evento novo; cada recebimento fica registrado com motivo (processado, duplicado, ignorado, rejeitado).
- **“Enviado” só com confirmação da Meta** (`events_received ≥ 1`). Falhas voltam para a fila com espera crescente; erros definitivos geram alerta e podem ser reprocessados com o mesmo `event_id`.
- **Dinheiro em unidades menores** (`bigint`, centavos), com a unidade declarada por integração. Sem heurística de “parece centavos”. Conversão de moeda só com cotação real do dia; sem cotação, o valor aparece como “não convertido”, nunca como 1:1.
- **Isolamento por organização** em todas as consultas, com testes de acesso cruzado.
- **Segredos cifrados no banco** (AES-256-GCM) e nunca enviados ao navegador ou aos logs.

## Estrutura

```
apps/
  server/     API Fastify + worker da CAPI + migrações (Node 22)
  web/        painel React + Vite + Tailwind (claro/escuro, responsivo)
packages/
  domain/     regras puras: dinheiro, câmbio, status de pagamento, eventos Meta, períodos
  gateways/   adaptadores de webhook (assinatura, normalização, status)
  db/         pool Postgres, migrações SQL versionadas
  pixel/      pixel.js e checkout-loader.js (navegador, ~13 KB)
docs/         auditoria, arquitetura, métricas, deploy, migração, operação
```

## Rodando localmente

Requisitos: Node 22, pnpm 10, PostgreSQL 16.

```bash
pnpm install
```

```bash
cp .env.example .env   # preencha DATABASE_URL e ENCRYPTION_KEY
```

```bash
pnpm db:migrate
```

```bash
pnpm dev               # API em :8080 (com worker embutido) e painel em :5173
```

Dados de demonstração (rotulados `[DEMONSTRAÇÃO]`, nunca enviados à Meta; recusa rodar em produção):

```bash
pnpm --filter @pt/server seed:demo
```

## Testes

```bash
pnpm typecheck
```

```bash
pnpm test              # unitários + integração (cria um banco temporário por arquivo)
```

Os testes de integração usam `TEST_DATABASE_URL` (padrão `postgres://paytracking:paytracking@localhost:5432/paytracking_test`; o usuário precisa poder criar bancos).

Ponta a ponta, contra o build de produção (sobe um mock da Graph API em :8099):

```bash
pnpm build
```

```bash
META_GRAPH_BASE_URL=http://localhost:8099 EMBEDDED_WORKER=true MIGRATE_ON_START=true node apps/server/dist/server.js
```

```bash
node apps/web/e2e/smoke.mjs
```

## URLs de webhook

| Origem | URL |
|---|---|
| Gateways (novo) | `POST /v1/webhooks/{gateway}/{token}` |
| Checkout próprio | `POST /v1/webhooks/checkout` com `Authorization: Bearer {token}` |
| Legado (continua aceito) | `POST /api/webhook_gateway.php?gateway=…&token=…` e `POST /api/webhook.php` |
| Pixel do navegador | `/pixel.js`, `/checkout-loader.js` (e o antigo `/checkout-loader-ic-only.js`) |

A importação do banco antigo mantém os mesmos tokens, então as URLs já cadastradas nos gateways não precisam ser trocadas. Veja [`docs/PLANO-MIGRACAO.md`](docs/PLANO-MIGRACAO.md).

## Documentação

- [Métricas e definições](docs/METRICAS.md)
- [Modelo de dados](docs/MODELO-DADOS.md)
- [Deploy (Cloud Run + Cloud SQL)](docs/DEPLOY.md)
- [Plano de migração do legado](docs/PLANO-MIGRACAO.md)
- [Operação, observabilidade e alertas](docs/OPERACAO.md)
- [Design system do painel](docs/DESIGN-SYSTEM.md)
