# PayTracking — Fase 1: Auditoria técnica e inventário funcional

**Data:** 29/10/2026 · **Escopo:** `public_html_6.zip` (front + endpoints, 817 arquivos incl. `vendor/`) e `app_3.zip` (núcleo PHP, 17 arquivos)
**Método:** leitura integral de todo o código próprio (~15 mil linhas; `vendor/` só inventariado) + execução das funções puras originais em PHP 8.3 para comprovar os achados críticos (ver `evidencias/`).
**Status:** diagnóstico concluído. **Nenhuma linha do sistema novo foi escrita.** Os arquivos originais não foram alterados.

> ⚠️ **Ação imediata (independe da reconstrução):** o `app/.env` e o `public_html/config_push.php` contêm **credenciais reais de produção** (senha do MySQL, `META_APP_SECRET`, `WOOVI_APP_ID`, `WOOVI_WEBHOOK_SECRET`, `APP_SECRET` e a chave privada VAPID). Eles circularam dentro dos ZIPs. Trate todas como comprometidas e **rotacione-as**. Este relatório cita apenas os nomes das variáveis, nunca os valores.

---

## 1. O que o PayTracking faz hoje

É um SaaS multiusuário (PHP puro + MySQL, hospedado na Hostinger, domínio `faturapack.com.br`) que:

1. **Rastreia o navegador** com um script próprio (`pixel.js`) colado na página de vendas. Ele dispara o Meta Pixel e, **com o mesmo `event_id`**, envia o evento para o servidor (`/api/track.php`), que o repassa à **Meta Conversions API** (deduplicação Pixel↔CAPI).
2. **Recebe as vendas por webhook**: do checkout próprio (`/api/webhook.php`, token Bearer) e de 6 gateways (`/api/webhook_gateway.php`: Kiwify, Cakto, Kirvano, Hotmart, Lowify e Wiapay). Também valida se o pagamento foi realmente aprovado, deduplica, grava a venda e envia o `Purchase` à CAPI.
3. **Liga o comprador ao visitante** ("ponte de identidade"): guarda fbp/fbc/IP/UA/UTMs por `pt_xid` e completa o Purchase do gateway, que chega servidor a servidor sem esses dados.
4. **Integra com a Meta Marketing API** via OAuth: lista contas, campanhas e conjuntos com métricas, edita orçamento, pausa/ativa e duplica.
5. **Mostra dashboards**: lucro, ROAS, CPA, funil, metas, atribuição por UTM, qualidade de correspondência (cobertura) e saúde da entrega à CAPI.
6. **Cobra assinatura** de R$ 47/mês via PIX Woovi, com trial de 7 dias e bloqueio da conta quando expira.
7. **Envia notificações push** (Web Push/VAPID) a cada venda aprovada.

---

## 2. Inventário de arquivos

Legenda dos problemas: 🔴 crítico · 🟠 alto · 🟡 médio · ⚪ baixo. Os IDs `P-xx` remetem à §8.

### 2.1 Núcleo (`app/`)

| Arquivo | Responsabilidade | Funcionalidades / dados | Dependências | Problemas | Equivalente novo |
|---|---|---|---|---|---|
| `.env` | Configuração | DB_*, APP_*, META_* (versão Graph v21.0, App ID/Secret, Login Config ID, redirect), DISPATCH_* (lote 50, 5 tentativas), WOOVI_* | — | 🔴 segredos reais (P-01); `WOOVI_PLAN_PRICE_CENTS` e `WOOVI_API_BASE` **não são lidos** pelo código (P-38) | Secret Manager + `.env.example` sem valores |
| `env.php` | Loader de .env | procura `.env` em 4 caminhos, comentários inline, aspas | — | ⚪ | Config tipada (Zod) |
| `config.php` | Constantes e sessão | APP_URL (auto-detecção do host), META_*, VAPID, DB, `app_start_session()` | env.php | 🟠 os parâmetros seguros da sessão nunca são aplicados (P-12) | `packages/config` |
| `db.php` | PDO singleton | reconexão quando ociosa >5s | config | 🟡 não define `time_zone` da sessão MySQL (P-30) | Drizzle + pool Postgres |
| `schema.sql` / `migration-public-key.sql` | Schema base | users, projects, events (UNIQUE project+event_name+event_id) | — | 🟡 o schema real é bem maior: ~20 colunas/tabelas criadas por auto-migração em runtime (P-31) | Migrações versionadas |
| `auth.php` | Autenticação | login bcrypt + rehash, logout, `require_login` + bloqueio por plano | db, billing | 🟠 sem recuperação de senha nem verificação de e-mail (P-20) | `auth/` (Firebase Auth) |
| `csrf.php` | CSRF | token por sessão, 2 nomes de campo | sessão | ⚪ | Cookie SameSite + token de API |
| `security.php` | Headers e throttle | CSP, HSTS, XFO; rate limit de login por IP (arquivo em /tmp) | — | 🟠 IP extraído de `X-Forwarded-For` falsificável → throttle contornável (P-19); CSP com `script-src 'unsafe-inline'` | Middleware + rate limit em Redis/DB |
| `helpers.php` | Utilitários | hash/normalização Meta (em, ph, fn, ln, ct, st, zp, country, ge, db, external_id), fbp/fbc, geo-IP (ipwho.is, cache 24h), tabelas `sales`/`push_subscriptions`, auto-migrações | — | 🟡 `norm_phone` não adiciona DDI; geo-IP envia IP de clientes a terceiro (P-35) | `packages/domain/meta-normalize` |
| `MetaCapi.php` | Cliente CAPI | `buildEventData` (user_data hasheado, custom_data, contents, UTMs), `send()`, `mapEventName()` (~70 aliases) | helpers | 🔴 `Refund` vira evento customizado (P-08); token na querystring; sem `events_received`/`fbtrace_id` (P-15) | `meta/capi` |
| `MetaAds.php` | Marketing API | OAuth (Business Login `config_id` ou `scope=ads_read,ads_management`), token longo, contas, campanhas, conjuntos, insights da conta, orçamento, status, cópia | config, db | 🟠 orçamento /100 fixo, errado para moedas sem centavos (P-27); token em texto puro (P-17); sem renovação/expiração tratada (P-24) | `meta/ads` |
| `gateway_adapters.php` | Adapters | verificação de assinatura e normalização dos 6 gateways | — | 🔴 heurística de centavos (P-04); `canceled`→`refund` (P-09) | `gateways/<nome>` |
| `dispatch.php` | Fila CAPI | pré-marca pixels inválidos, reserva otimista, prioridade, lote, 80 ms entre envios | MetaCapi | 🟠 retry sem backoff nem classificação de erro; falha definitiva fica silenciosa (P-14) | `capi-dispatcher` (worker) |
| `pt_instant.php` | Envio imediato | Purchase síncrono antes de responder; outros após fechar a conexão | dispatch | 🟠 webhook pode levar até ~8s (timeout da Meta) → timeout/retry do gateway (P-16) | Outbox + worker |
| `pt_identity.php` | Ponte de identidade | upsert por (projeto, xid); lookup por xid → hash do e-mail → hash dos 9 últimos dígitos do telefone; TTL 90/120 dias | — | 🟠 envenenável pelo navegador (P-11) | `tracking/identity` |
| `billing.php` | Assinatura | trial, status, cobrança Woovi (correlationID por usuário/mês), +30 dias, HMAC | db | 🔴 `billing_mark_paid` não é idempotente (P-07); bypass por e-mail fixo / user id 1 | `billing/` |

### 2.2 Endpoints públicos (`public_html/api`, `cron`)

| Arquivo | Responsabilidade | Entrada / saída | Problemas | Novo |
|---|---|---|---|---|
| `api/webhook.php` | Webhook do checkout próprio + destino interno dos gateways | Bearer/`X-Integration-Token` **ou** `X-Internal-Project`+`X-Internal-Auth`; HMAC opcional; JSON com aliases (`data`, `payload`, `payer`, `customer`...) → fila + `sales` + push | 🔴 P-02, P-03, P-05, P-06, P-10 | `POST /v1/webhooks/checkout` |
| `api/webhook_gateway.php` | Webhook unificado de gateways | `?gateway=&token=` (token do usuário ou do projeto); ping GET/HEAD/corpo vazio; dedup `purchase:<txn>` e `event:<source_id>`; forward HTTP loopback para webhook.php | 🔴 P-02, P-06; SSL desligado no loopback | `POST /v1/webhooks/{gateway}/{integrationId}` |
| `api/track.php` | Eventos do navegador | `?k=` chave pública (ou legado `?t=`); texto/JSON; CORS reflete qualquer origem; bloqueia só Purchase; dispatch inline do IC | 🟠 P-11, P-13; expõe a mensagem de exceção | `POST /v1/collect` |
| `api/pixel-config.php` | Resolve o pixel pelo `produto_id` | GET público → pixel_id, public_key, endpoint | 🔴 busca **global entre todos os clientes** (P-02b) | `GET /v1/pixel-config` (com escopo) |
| `api/billing_webhook.php` | Webhook da Woovi | HMAC base64 em `x-webhook-signature`; `CHARGE_COMPLETED` ou `TRANSACTION_RECEIVED` → +30 dias | 🔴 P-07 | `POST /v1/webhooks/woovi` |
| `cron/dispatch.php` | Drenagem da fila | CLI ou `?key=APP_SECRET` | 🟠 segredo em query string (logs) | Cloud Scheduler → worker |
| `push_subscribe.php` | Inscrição Web Push | POST JSON / GET `?action=unsubscribe` | 🟡 o header chama `/api/push-subscribe.php`, **que não existe** (P-34) | `POST /v1/push/subscriptions` |

### 2.3 Páginas do painel

| Página (menu) | Funcionalidades | Fonte de dados | Problemas |
|---|---|---|---|
| `login.php` / `signup.php` / `logout.php` / `index.php` | login, cadastro (trial 7 dias), throttle por IP | users | P-19, P-20; senha mínima de 8 no cadastro e 10 na troca |
| `dashboard.php` (**Resumo**) | períodos hoje/ontem/7D/30D/tudo; faturamento, lucro, ROI, gasto, CPA, ARPU, ROAS, margem, ticket; resumo de lucro 7/30d; funil (cliques → LPV → IC → vendas); meta diária | `sales` + Meta (insights da conta) + `events` | 🔴 P-21, P-22, P-23 |
| `campaigns.php` (**Campanhas**) | OAuth, contas, campanhas/conjuntos, drill-down, multisseleção, KPIs, sobreposição de vendas por UTM, polling a cada 5s, orçamento inline, pausar/ativar, duplicar, colunas/cores/ordenação | Meta + `events` (Purchase) | 🟠 P-25, P-26, P-27; JS lê `data-name` inexistente |
| `capi_report.php` (**Relatórios**) | enviados/fila/falhas por pixel e evento, falhas recentes | `events` | 🟡 depende de `events`, que é apagada (P-29) |
| `events.php` (**Conversões**) | lista paginada, filtro de status, payload, reprocessar 1/todos, excluir (exceto Purchase), limpeza automática >2 dias, despacho automático | `events` | 🟠 dispara a fila **de todos os clientes** a cada visita; a limpeza só acontece quando o usuário abre a página |
| `atribuicao.php` (**Fontes**) | PV/IC/Purchase/faturamento por utm_source/campaign/medium | `events` | 🔴 soma moedas diferentes sem conversão (P-28) |
| `projects.php` (**Pixels**) | CRUD do pixel (nome, Pixel ID, token CAPI, test code, moeda, país, product_ids, regra de IC); ativar/desativar (todos); token de webhook; segredo HMAC; chave pública; snippets | `projects` | 🟠 token CAPI renderizado no HTML (P-17); excluir pixel apaga o histórico do dashboard (P-32) |
| `billing.php` (**Financeiro**) | status do plano, gera PIX (AJAX), polling de status | users + Woovi | — |
| `cobertura.php` (**Alertas**) | cobertura dos 15 parâmetros de correspondência, prontos para dedup, entrega, recordes, recomendações | `events` | 🟡 janela de 90/180 dias sobre dados apagados com 2 dias (P-29) |
| `webhooks.php` (**Integrações**) | URL de webhook por gateway, segredos, token da conta | users | 🟠 token **e** hash guardados (`gateway_token_raw`) (P-17); domínio fixo no código; Enter no campo apaga o segredo |
| `profile.php` (**Configurações**) | metas, faturamento hoje/mês/total em BRL, privacidade, troca de senha, logo (só admin) | `sales` | 🟡 "hoje" usa o fuso do PHP, não o do app (P-30) |
| `admin.php` (**Admin**) | lista de usuários, MRR estimado, +7d trial, ativar 30d, expirar, excluir | users | 🟡 e-mail do admin fixo no código; exclusão deixa órfãos |
| `_header.php` / `_footer.php` / `_styles.php` | layout, sidebar, PWA, auto-push, som de venda, WhatsApp, borrar nomes | — | `assets/sale.mp3` ausente; o SW nunca envia a mensagem `sale` |
| `_milestones.php` | "PayTracking Awards" (100k/250k/500k/1M) | — | **não é usado em nenhuma página** |
| `sw.js` / `manifest.json` | PWA ("FaturaPack") | — | marca inconsistente (PayTracking × FaturaPack × "Meta Tracking") |

### 2.4 Scripts do navegador

| Arquivo | Função | Pontos-chave |
|---|---|---|
| `pixel.js` (990 linhas) | Pixel + ponte CAPI | PageView em todo carregamento; fbp/fbc garantidos (fbclid tem prioridade); `pt_xid` em localStorage; external_id SHA-256 idêntico ao do servidor; captura de e-mail/telefone/nome dos formulários → `localStorage.pt_pii` (90 dias, texto puro); UTMs last-click; IC por clique (regra/seletor/texto/URL) com supressão de 5 min por pixel; decoração de links (`pt_ic_event_id`, `pt_fbc`, fbclid, UTMs, `xcod`/`sck` ≤240 chars); beacon/fetch keepalive/backup no unload; modo teste `?pt_test=1`; `window.tracker.track()` |
| `checkout-loader.js` / `checkout-loader-ic-only.js` | IC no checkout global | resolve o pixel pelo `produto_id`; event_id canônico → encaminhado → gerado; **moeda `BRL` fixa no código** (P-26); o loader grava `pt_pii` em cookie em texto puro |
| `assets/push-subscribe.js` | botão de push | chave VAPID pública fixa no código; elemento `#btn-ativar-push` não existe em nenhuma página |

---

## 3. Integrações identificadas

| Integração | Uso | Autenticação atual | Observações |
|---|---|---|---|
| **Meta Conversions API** | `POST /{pixel}/events` (Graph `v21.0`) | token CAPI por pixel (na querystring) | `test_event_code` por pixel ou global. **Verificar se a v21.0 ainda é suportada**: a Meta mantém cada versão por cerca de 2 anos e a v21.0 é de out/2024 |
| **Meta Pixel (fbevents.js)** | navegador | — | `trackSingle` por pixel, `eventID` para dedup |
| **Meta Marketing API** | contas, campanhas, adsets, insights, edição | OAuth Facebook Login for Business (`config_id`) ou clássico (`ads_read,ads_management`); token longo (~60d) | sem refresh; sem tratamento de expiração/revogação |
| **Kiwify** | webhook | HMAC-SHA1 do corpo em `?signature=` | valor em centavos (`charge_amount`) |
| **Cakto** | webhook | campo `secret` dentro do JSON | — |
| **Kirvano** | webhook | header `security-token` estático | — |
| **Hotmart** | webhook 2.0 | header `X-HOTMART-HOTTOK` | validação estrita: evento + status + approved_date + transação + e-mail + produto |
| **Lowify / Wiapay** | webhook | **só o token na URL**; HMAC opcional, e assinatura errada é aceita | esquemas oficiais desconhecidos (o próprio código diz isso) |
| **Checkout próprio** (EFI citado nos comentários) | webhook | Bearer + HMAC-SHA256 opcional (`X-Paytrack-Signature`) | **o código do checkout não foi enviado** |
| **Woovi/OpenPix** | cobrança PIX da assinatura | header `Authorization: <AppID>`; webhook HMAC-SHA256 base64 | confirmar o esquema de assinatura na documentação oficial |
| **Frankfurter / open.er-api.com** | câmbio para BRL | — | cache de 15 min em /tmp |
| **ipwho.is** | geolocalização por IP | — | envia IP de clientes a terceiro (LGPD) |
| **Web Push** (minishlink/web-push 10.x) | notificação de venda | VAPID | — |

---

## 4. Fluxo completo dos eventos de rastreamento

```
Página de vendas (pixel.js)
 ├─ PageView: fbq('trackSingle', PageView, {eventID: X})  +  POST /api/track.php?k=<public_key> {event:'page_view', event_id: X, fbp, fbc, external_id:pt_xid, UTMs, PII do form}
 ├─ (modo clique) IC no clique → mesmo esquema com event_id Y; supressão de 5 min (localStorage pt_ic_<pixel>)
 └─ Clique para o checkout: decora a URL com pt_ic_event_id, pt_fbc, fbclid, UTMs, src, xcod/sck=external_id&fbp&fbclid&utm_*

Checkout global (checkout-loader-ic-only.js)
 └─ GET /api/pixel-config.php?produto_id → pixel; IC com event_id canônico|encaminhado|gerado; espera até 2,5s por PII; Pixel + /api/track.php

/api/track.php
 auth por public_key → mapEventName → rejeita Purchase (422) → IP público real → geo-IP (só país)
 → buildEventData → pt_identity_remember(xid) → INSERT events(queued, source=pixel) [UNIQUE → duplicado = 200]
 → IC: dispatch síncrono (lote 5) → resposta → dispatch em background
```

Fatos relevantes:
- **InitiateCheckout no servidor está desativado**: todo IC que chega por webhook é ignorado. O IC vem só do navegador, para casar o `event_id`.
- O par Pixel↔CAPI depende do **mesmo `event_id`**. A Meta deduplica o par. A tabela `events` deduplica reenvios por (projeto, evento, event_id).
- `events` funciona como fila **e** histórico. Eventos que não são Purchase são apagados após 2 dias, mas só quando o usuário abre `events.php`.

## 5. Fluxo de confirmação de pagamentos

```
Gateway → /api/webhook_gateway.php?gateway=G&token=T
  token do usuário (preferido) ou do projeto → assinatura do gateway → normaliza → dedup permanente
  (gateway_webhook_dedup: 'purchase:<txn>' e 'event:<source_id>', status processing→processed)
  → forward HTTP para /api/webhook.php (loopback 127.0.0.1) com X-Internal-Auth = HMAC(project_id, APP_SECRET)

/api/webhook.php
  auth → HMAC opcional → mapEventName(event)
  → Hotmart: 2ª barreira estrita
  → Purchase exige paytrack_purchase_is_paid(): status explícito pago | evento inequívoco
  → InitiateCheckout: ignorado
  → transaction_id obrigatório; valor > 0 obrigatório para Purchase
  → moeda: do payload, senão a do pixel (padrão BRL)
  → ponte de identidade (fbp/fbc/IP/UA/URL/UTMs/geo)
  → roteamento por product_ids (mesmo usuário, pixel mais recente)
  → event_id por tipo (purchase_event_id...) ou transaction_id
  → webhook_dedup (permanente) + precheck em sales
  → INSERT events → record_sale() → push "Venda Aprovada!"
  → Purchase: envio SÍNCRONO à CAPI antes de responder; demais: após responder
```

**Estados de pagamento hoje:** só existem "aprovado" (vira `sales` + Purchase) e "reembolso" (vira o evento customizado `Refund` na Meta). **Pagamentos pendentes não são armazenados.** Por isso o pedido "quantidade de pagamentos pendentes" do dashboard **não tem base de dados atual**: seria uma funcionalidade nova, que exige persistir o ciclo de vida do pedido.

## 6. Como os eventos são enviados à Meta

- **Payload:** `event_name`, `event_time`, `event_id`, `action_source=website`, `event_source_url`, `user_data` (em, ph, fn, ln, ct, st, zp, country, ge, db hasheados em SHA-256; `external_id` = hash do CPF + hash do pt_xid; fbp/fbc/IP/UA em claro), `custom_data` (value/currency só em Purchase, IC, AddToCart, ViewContent e AddPaymentInfo; contents/content_ids/num_items; order_id; UTMs).
- **Transporte:** `POST graph.facebook.com/v21.0/{pixel}/events?access_token=...` com 1 evento por chamada, timeout de 8s.
- **"Enviado"** = HTTP 2xx. Não lê `events_received`, não guarda `fbtrace_id` nem o corpo da resposta de sucesso.
- **Retry:** cada chamada ao dispatcher reenvia `failed` com `attempts < 5`, **sem backoff e sem distinguir erro permanente** (ex.: token inválido) de temporário (rate limit, 5xx). Após 5 tentativas o evento fica `failed` para sempre, sem alerta.
- **Gatilhos:** a própria requisição (instantâneo), `track.php`, abertura de `events.php`, `cron/dispatch.php` (se configurado), reprocessamento manual.

## 7. Regras de moeda identificadas

| Camada | Regra atual |
|---|---|
| Evento enviado à Meta | moeda **original**: payload do gateway → senão a moeda do pixel (padrão BRL). PageView nunca leva value/currency. **Correto, preservar.** |
| Loaders de checkout | **`currency: 'BRL'` fixo** no IC, mesmo para pixel EUR (P-26) |
| `pixel.js` | `data-currency` do snippet (moeda do pixel) quando o evento não informa |
| Armazenamento | `events.value DECIMAL(12,2)` + `currency`; `sales.value DECIMAL(12,2)` + `currency` (original). Purchase recebe `round(value, 2)` em float |
| Exibição | tudo convertido para **BRL na hora da exibição, com a cotação de hoje** (`Currency::toBrl`): vendas (dashboard, perfil, campanhas) e métricas da Meta (gasto, receita, orçamento, CPC) da moeda da conta de anúncios |
| Câmbio | Frankfurter → open.er-api → cache antigo → **taxa 1.0** (EUR mostrado como BRL sem aviso) |
| Edição de orçamento | o usuário digita em BRL → convertido para a moeda da conta com a cotação de hoje → ×100 → Meta. Com fallback 1.0, R$ 100 viram **100 EUR** (P-25) |
| Atribuição | **soma EUR+USD+BRL sem converter**, rotulado com `MAX(currency)` (P-28). O mesmo bug já foi corrigido em `profile.php`, mas não aqui |
| Orçamentos Meta | `/100` e `×100` fixos. Errado para moedas sem casas decimais que o próprio painel oferece (JPY, CLP, PYG) (P-27) |

Histórico EUR↔BRL encontrado nos comentários: (a) pixel EUR marcava BRL → criou-se a moeda por pixel; (b) perfil somava moedas misturadas → passou a converter; (c) orçamento passou a converter BRL→moeda da conta. **Pendente:** os loaders ainda usam BRL fixo, a atribuição ainda mistura moedas e a conversão usa a cotação do dia (os totais históricos mudam todo dia).

---

## 8. Problemas, riscos e inconsistências

### 🔴 Críticos

| ID | Problema | Evidência | Impacto |
|---|---|---|---|
| **P-01** | Credenciais reais de produção nos ZIPs (`.env`, `config_push.php`); `APP_SECRET` com 8 caracteres e início previsível | arquivos | Acesso ao banco, ao app Meta e à Woovi; forjar autenticação interna |
| **P-02** | **Compras aprovadas de Kiwify, Cakto, Kirvano, Lowify e Wiapay são descartadas.** O adapter encaminha `event='purchase'` sem nenhum campo de status, e `paytrack_purchase_is_paid()` exige status ou um evento "inequívoco", que `purchase` não é. Só a Hotmart passa | **comprovado** em `evidencias/verify-output.txt` §1 | Sem venda no painel, sem Purchase na Meta. E a chave `purchase:<txn>` fica marcada como processada para sempre: corrigir o código não recupera essas vendas, que só voltariam com reprocessamento manual dos payloads |
| **P-02b** | `pixel-config.php` resolve `produto_id` **entre todos os clientes** e escolhe o pixel mais recente | código | Outro cliente que cadastre o mesmo product_id passa a receber os InitiateCheckout do checkout de outra conta (vazamento entre tenants) |
| **P-03** | Detecção de "pago" por **substring**: `unpaid`, `not_paid` e `disapproved` contam como **pago** | **comprovado** §4 | Compras falsas na Meta e no faturamento |
| **P-04** | Heurística de centavos nos adapters: inteiro ≥1000 é dividido por 100; abaixo disso fica como está | **comprovado** §2: 997 centavos (R$ 9,97) vira **R$ 997**; R$ 1000 vira **R$ 10** | Receita e valor da conversão errados na Meta |
| **P-05** | A reserva em `webhook_dedup` é gravada **antes** do INSERT na fila. Se o INSERT falha por erro não-duplicado, responde 500, o gateway tenta de novo e a nova tentativa é tratada como duplicada | código | Venda perdida definitivamente |
| **P-06** | `record_sale()` engole exceções. A autenticação interna `HMAC(project_id, APP_SECRET)` é estática, sem timestamp: o valor nunca muda, então é reutilizável para sempre e contorna a assinatura do gateway | código | Venda some do dashboard; com `APP_SECRET` fraco, dá para forjar Purchase |
| **P-07** | Renovação da assinatura **não é idempotente**: cada entrega do webhook (retries e os dois tipos de evento aceitos) soma +30 dias | código | Receita de assinatura perdida |

### 🟠 Altos

| ID | Problema |
|---|---|
| P-08 | Reembolso/chargeback vira o evento customizado `Refund` na Meta (não é evento padrão) e **não abate** a venda em `sales` → dashboard e ROAS inflados |
| P-09 | Em Lowify/Wiapay, `canceled` vira `refund` (cancelar um pendente não é reembolso). Hotmart `PURCHASE_CANCELED` também vira refund |
| P-10 | HMAC do checkout próprio só é validado **se o header vier**: ativar a assinatura não impede requisições sem assinatura (sensação falsa de proteção) |
| P-11 | `track.php` aceita `Refund`/`Lead`/`AddToCart` vindos do navegador com a chave pública (injeção de eventos no pixel do cliente) e grava `email_hash` arbitrário na ponte de identidade (dá para sequestrar a atribuição do Purchase de outra pessoa) |
| P-12 | `_bootstrap.php` chama `session_start()` antes de `app_start_session()`, então `secure`/`httponly`/`SameSite`/nome da sessão **nunca são aplicados** |
| P-13 | CORS reflete qualquer origem; a mensagem de exceção é devolvida ao cliente |
| P-14 | Retry sem backoff nem classificação; falha definitiva sem alerta; sem tratamento de rate limit |
| P-15 | Sucesso = HTTP 2xx, sem conferir `events_received`; sem `fbtrace_id`; token CAPI na URL |
| P-16 | Purchase enviado de forma síncrona dentro do webhook (até ~8s) → risco de timeout e retry no gateway |
| P-17 | Segredos em texto puro no banco (token CAPI, token Meta, segredos de gateway, `gateway_token_raw`). O token CAPI vai no HTML (`data-edit`) |
| P-18 | Lowify/Wiapay autenticados só pelo token na URL (aparece em logs de acesso); assinatura inválida é aceita |
| P-19 | Throttle de login confia em `X-Forwarded-For`/`CF-Connecting-IP` sem checar o proxy, então é contornável |
| P-20 | Sem recuperação de senha, verificação de e-mail ou revogação de sessões |
| P-21 | Dashboard: vendas/receita = `max(Meta, local)`. A Meta inclui os próprios Purchases enviados pela ferramenta, então as fontes se sobrepõem e o critério não aparece na tela. "Faturamento Líquido" é bruto (taxa = 0) |
| P-22 | Funil 7D/30D lê `events`, que perde PageView/IC após 2 dias → números artificialmente baixos |
| P-23 | A "meta diária" é comparada com a receita do **período selecionado** (em 30D, a receita de 30 dias contra a meta de um dia) |
| P-24 | Expiração/revogação do token Meta só aparece como erro genérico; não há renovação nem aviso antes de expirar |
| P-25 | Edição de orçamento com fallback de câmbio 1.0 pode gravar um orçamento ~6× maior na conta EUR/USD |
| P-26 | Loaders de checkout com `currency: 'BRL'` fixo; `pixel-config` não devolve a moeda do pixel |

### 🟡 Médios / ⚪ Baixos

P-27 orçamento ÷100 para JPY/CLP/PYG · P-28 atribuição mistura moedas · P-29 relatórios de 30–180 dias sobre dados apagados em 2 dias · P-30 fusos misturados (MySQL `NOW()` sem `time_zone` na sessão; `date()` do PHP sem `date_default_timezone_set`; o código assume UTC) · P-31 schema real fruto de ~20 `ALTER TABLE` em runtime · P-32 excluir pixel/usuário apaga o histórico do dashboard (o JOIN em `projects`) e deixa órfãos · P-33 Purchase/PageView usam o **país do pixel** como dado de correspondência quando não sabem o do visitante (dado inferido) · P-34 auto-push chama rota inexistente; `sale.mp3` ausente; SW não avisa a página · P-35 PII em localStorage/cookie em texto puro por 90 dias e IP enviado ao ipwho.is, sem consentimento (LGPD) · P-36 `events.php` dispara a fila de **todos** os clientes · P-37 Purchase de gateway sem identidade vai sem `client_user_agent` (a Meta exige esse campo em eventos `website`; verificar a taxa de rejeição) · P-38 variáveis `.env` não usadas · P-39 `vendor/` dentro do `public_html` sem bloqueio · P-40 marca inconsistente (PayTracking / FaturaPack / Meta Tracking).

---

## 9. Funcionalidades a preservar

Comportamentos corretos e valiosos que **devem ser reproduzidos e testados**:

1. Dedup Pixel↔CAPI pelo mesmo `event_id`; IC **apenas** do navegador; Purchase **apenas** do servidor.
2. Rejeição de Purchase vindo do navegador; Purchase exige confirmação financeira e valor > 0.
3. Validação estrita da Hotmart (evento + status + approved_date + transação + comprador + produto).
4. Idempotência permanente por transação (separada da fila), agora sem os furos P-05/P-06.
5. Normalização e hash conforme a Meta; `external_id` múltiplo (CPF + pt_xid) com hash idêntico entre Pixel e CAPI.
6. Ponte de identidade (xid → e-mail → telefone) e transporte do xid via `xcod`/`sck`.
7. fbc a partir do fbclid (o fbclid novo tem prioridade); não fabricar fbc; não enviar IP privado nem IP/UA de gateway.
8. Moeda original no evento da Meta; moeda/país por pixel; PageView sem value.
9. Roteamento de Purchase/IC por `product_ids` (agora restrito ao tenant e com unicidade).
10. Supressão de IC (5 min por pixel), decoração de links, beacon/keepalive.
11. Despacho com prioridade da venda recém-chegada; pré-marcação de pixels mal configurados com mensagem clara.
12. Páginas: Resumo, Campanhas (com ações), Relatório CAPI, Conversões (reprocessar/inspecionar), Fontes, Pixels, Integrações, Cobertura, Configurações (metas), Financeiro, Admin.
13. Meta: Business Login (`config_id`), token longo, paginação completa, extração de compra sem contagem dupla (1 action_type canônico), janelas por datas no fuso do app.
14. Assinatura Woovi com trial e bloqueio (agora idempotente).
15. Push de venda; modo teste do pixel; diagnóstico do OAuth.

---

## 10. Arquitetura recomendada (proposta, **requer sua decisão**)

### Decisão central: banco de dados

| Opção | Prós | Contras |
|---|---|---|
| **A. Firebase completo** (Functions v2 + Firestore + Auth + Hosting + Cloud Tasks) | sem servidor para gerenciar; regras de segurança nativas; custo zero parado | **Sem restrição de unicidade** (idempotência emulada com ID de documento + transação); agregações por período/moeda/campanha caras (cobrança por leitura) e limitadas; reconciliação venda↔evento↔campanha sem JOIN; relatórios de 30–180 dias exigem pré-agregação complexa |
| **B. Recomendada — híbrida no Google Cloud/Firebase:** Firebase Auth + Firebase Hosting (web) + **Cloud Run** (API e worker em Node/TS) + **PostgreSQL** (Cloud SQL, ou Neon/Supabase para baratear) + Secret Manager + Cloud Scheduler | `UNIQUE` real para idempotência; transações ACID para o ledger financeiro; SQL para dashboards/reconciliação; isolamento por `org_id` + Row-Level Security; migração do MySQL atual é direta | Banco com custo mínimo mensal; uma peça a mais para operar |

O domínio é **financeiro e relacional** (pedidos, pagamentos, reembolsos, conciliação com eventos e campanhas, somatórios por moeda e período). Por isso recomendo a **opção B**. Mantém Firebase onde ele é forte (Auth, Hosting, App Check) e usa Postgres onde a consistência é crítica. O Firebase Auth aceita importar hashes bcrypt: os usuários atuais migram **sem trocar de senha**.

### Desenho proposto

```
paytracking/                      (monorepo pnpm + Turborepo, TypeScript strict)
├─ apps/web        React 18 + Vite + TS + Tailwind + Radix/shadcn + TanStack Query + React Router + RHF/Zod + ECharts/Recharts
├─ apps/api        Fastify + Zod — painel (REST), /v1/collect, /v1/webhooks/*, OAuth Meta
├─ apps/worker     consumidores: capi-dispatcher, meta-insights-sync, fx-rates, reconciliação, retenção
├─ packages/domain regras puras e 100% testadas: mapeamento de eventos, máquina de estados de pagamento, Money (inteiros em unidade mínima + ISO 4217), normalização Meta
├─ packages/gateways  1 adapter por gateway: verify() / parse() / normalize() + fixtures reais
├─ packages/db     Drizzle ORM + migrações versionadas + RLS
├─ packages/pixel  pixel.js/loaders em TS → bundle ES5 mínimo (esbuild), versionado
└─ docs/, .github/workflows (lint, typecheck, test, build, audit, gitleaks)
```

**Pipeline de eventos:** recebimento → verificação da origem (assinatura do gateway, timestamp anti-replay quando suportado) → validação Zod → `webhook_receipts` (bruto, com hash; `UNIQUE` idempotency_key) → **na mesma transação**: upsert de `payments` (máquina de estados: `created → pending → approved → refunded/chargeback/canceled`) + `capi_outbox` (`UNIQUE` pixel+event_name+event_id) → resposta 2xx rápida → worker envia com backoff exponencial e jitter, classificando o erro (permanente × temporário × rate limit), grava `capi_attempts` (status, `events_received`, `fbtrace_id`) → marca `sent` só com confirmação → alerta após N falhas.

**Modelo de dados (rascunho, detalhado na Fase 2):** organizations, memberships (owner/admin/analyst/viewer), users, pixels, pixel_products (`UNIQUE(org, product_id)`), integrations (segredos criptografados com envelope/KMS), webhook_receipts, orders/payments + payment_events, tracking_events (retenção configurável), visitor_identities, capi_outbox, capi_attempts, meta_connections (token criptografado, escopos, expiração), ad_accounts, insights_daily (por campanha/adset, moeda da conta), fx_rates (data, par, taxa, fonte), subscriptions/billing_charges (`UNIQUE` charge_id), push_subscriptions, audit_log.

**Fonte da verdade (proposta):** faturamento e vendas = `payments` aprovados menos reembolsos (local); gasto = `insights_daily` da Meta; a comparação Meta × local passa a ser exibida **lado a lado** e explicada, em vez de `max()`.

**Moeda:** valores em inteiros na unidade mínima com o expoente ISO de cada moeda; conversão sempre explícita para a moeda de relatório da organização, **com a cotação da data da transação** (guardando `fx_rate_id`); sem fallback 1.0 (sem cotação = valor marcado "não convertido").

---

## 11. Arquivos e informações faltando

1. **Código do checkout próprio** (`checkout.php`, `paytrack_dispatch.php`, integração EFI): é ele que gera `CHECKOUT_EVENT_IDS`, `purchase_event_id` e a assinatura `PAYTRACK_SECRET`.
2. `install.php` (citado na allowlist de billing) e `assets/sale.mp3` (citado no header).
3. **Payloads reais (anonimizados) de cada gateway**, sobretudo a unidade do valor em Lowify, Wiapay, Cakto e Kirvano, e os eventos de reembolso, chargeback e cancelamento.
4. Confirmação do **esquema de assinatura** de Woovi, Lowify e Wiapay na documentação oficial.
5. **Dump do schema real do MySQL** (pós-auto-migrações) e estatísticas: nº de usuários, pixels, eventos/dia, vendas/dia, moedas em uso, fuso do servidor MySQL.
6. **App Meta:** status do App Review de `ads_read`/`ads_management`, configuração do Business Login, se a v21.0 segue suportada, domínios cadastrados.
7. Quais **gateways estão de fato em produção** e se existe cron configurado para `cron/dispatch.php`.
8. **Destinos de implantação:** organização/nome do repositório GitHub, projeto Firebase/GCP, domínio final (mantém `faturapack.com.br`?) e ambientes.
9. **Decisões de negócio:** marca oficial (PayTracking × FaturaPack); fonte da verdade do dashboard; política de câmbio; tratamento de reembolso na Meta; preço/trial; se o produto continua multiusuário com "organizações" (equipes).
10. Política de privacidade e consentimento (LGPD) para a captura de PII pelo pixel.

---

## 12. Plano de migração por etapas

| Fase | Entregas | Critério de validação |
|---|---|---|
| **0. Contenção (agora, no sistema atual)** | rotação de todos os segredos; correção mínima de P-02/P-03/P-07 no PHP **se você autorizar**; inventário dos webhooks perdidos | segredos antigos revogados; compra Kiwify de teste vira venda |
| **1. Auditoria** ✅ | este relatório + matriz | aprovação sua |
| **2. Arquitetura** | ADRs (banco, auth, filas, hosting), modelo de dados completo, contratos de API (OpenAPI), estratégia de segredos e ambientes (dev/staging/prod) | ADRs aprovados |
| **3. Design system** | tokens (claro/escuro), tipografia, componentes base, layout, estados vazio/erro/carregando | Storybook navegável; contraste AA; teclado |
| **4. Núcleo** | auth + orgs + RBAC; pixels; `/v1/collect`; adapters com fixtures; payments + outbox + dispatcher; Meta OAuth/insights; dashboard | testes de domínio ≥90%; testes de integração com Postgres real; cenários 1–19 do prompt |
| **5. Segurança e desempenho** | RLS + testes cruzados entre organizações, rate limit, CSP estrita, criptografia de segredos, índices, pré-agregação diária | relatório de pentest interno; p95 da API < 300 ms |
| **6. Homologação em paralelo (shadow)** | migração MySQL→Postgres (script idempotente); gateways enviam **também** ao novo endpoint; CAPI do novo em `test_event_code`; relatório comparativo diário | divergência de vendas = 0 (ou explicada caso a caso); valores por moeda batendo |
| **7. Produção** | cutover por organização; o PHP fica somente leitura por 30 dias como rollback | checklist de produção; monitoramento e alertas ativos; plano de reversão testado |

---

## Anexo A — Matriz de rastreabilidade

| ID | Funcionalidade atual | Origem | Novo módulo | Testes previstos |
|---|---|---|---|---|
| F01 | Cadastro com trial de 7 dias | signup.php, billing.php | auth, billing | e2e signup; trial calculado |
| F02 | Login + throttle | login.php, security.php | auth (Firebase) + rate-limit | brute-force bloqueado; IP via proxy confiável |
| F03 | Logout / troca de senha | logout.php, profile.php | auth | revogação de sessões |
| F04 | Recuperação de senha (**nova**) | — | auth | e2e reset |
| F05 | Ocultar e-mail / borrar nomes | profile.php, _footer.php | web/preferences | unit |
| F06 | Metas diária e mensal | profile.php, dashboard.php | goals | meta comparada com a janela certa (P-23) |
| F07 | Faturamento hoje/mês/total | profile.php | reports | fuso do app; multimoeda |
| F08 | Logo da plataforma (admin) | profile.php | admin/branding | upload validado |
| F09 | CRUD de pixels | projects.php | pixels | isolamento entre organizações |
| F10 | Ativar/desativar (todos) | projects.php | pixels | eventos param |
| F11 | Token de integração (mostrado 1×) | projects.php, webhooks.php | integrations | só hash armazenado |
| F12 | Segredo HMAC do webhook | projects.php | integrations | assinatura **obrigatória** quando ativa |
| F13 | Chave pública do pixel | projects.php | pixels | — |
| F14 | Snippets de instalação | projects.php | pixels/ui | snapshot |
| F15–F25 | pixel.js (PageView, fbp/fbc, xid, AM, PII, UTMs, IC por clique, decoração, onload, modo teste, API, transporte) | pixel.js | packages/pixel | testes de browser (Playwright) para cada regra |
| F26 | Loaders de checkout | checkout-loader*.js | packages/pixel | moeda do pixel (P-26) |
| F27 | pixel-config | api/pixel-config.php | api/collect | escopo por tenant (P-02b) |
| F28 | Ingestão do navegador | api/track.php | api/collect | Purchase rejeitado; eventos permitidos por lista; CORS por domínio cadastrado |
| F29 | Ponte de identidade | pt_identity.php | tracking/identity | não envenenável (P-11) |
| F30 | Webhook do checkout próprio | api/webhook.php | webhooks/checkout | aliases; validação; event_id por tipo |
| F31 | Webhook dos 6 gateways | webhook_gateway.php, gateway_adapters.php | gateways/* | fixture por evento e gateway; assinatura válida/inválida; ping |
| F32 | Validação estrita da Hotmart | adapters + webhook.php | gateways/hotmart | fail-closed |
| F33 | Idempotência permanente | webhook_dedup, gateway_webhook_dedup | payments (UNIQUE) | duplicado, simultâneo, falha no meio (P-05) |
| F34 | Histórico de vendas | sales | payments | reembolso abate (P-08) |
| F35 | Push de venda | PushNotifier, sw.js | notifications | 1 push por venda |
| F36–F38 | Fila, despacho instantâneo, cron | dispatch.php, pt_instant.php, cron | worker/capi-dispatcher | backoff; erro permanente; rate limit; reprocesso sem duplicar |
| F39 | Conversões (lista/inspecionar/reprocessar/excluir) | events.php | web/events + api | só da própria org |
| F40 | Relatório CAPI | capi_report.php | reports/capi | contagens batem com attempts |
| F41 | Cobertura e dedup | cobertura.php | reports/coverage | agregados diários |
| F42 | Atribuição por UTM | atribuicao.php | reports/attribution | moedas convertidas (P-28) |
| F43 | Dashboard | dashboard.php | reports/dashboard | total = soma dos registros (cenário 16) |
| F44 | OAuth Meta | MetaAds.php, campaigns.php | meta/oauth | state inválido; código expirado; token revogado |
| F45–F46 | Contas, campanhas, conjuntos, insights | MetaAds.php | meta/ads + insights_daily | paginação; rate limit (erros 17/613) |
| F47 | Sobreposição de vendas por UTM + tempo real | campaigns.php | reports/campaigns | casamento por id/nome |
| F48 | Orçamento / status / duplicar | campaigns.php | meta/ads (permissão `ads_management`) | sem permissão → erro claro; moeda sem casas decimais (P-27) |
| F49 | Preferências de tabela | campaigns.php | web | — |
| F50 | Conversão de moeda | Currency.php | domain/money + fx_rates | BRL, EUR, USD, JPY; nulos; arredondamento; sem fallback 1.0 |
| F51 | Assinatura Woovi | billing.php, billing_webhook.php | billing | webhook repetido = 1 renovação (P-07) |
| F52 | Admin | admin.php | admin (papel `platform_admin`) | não-admin bloqueado |
| F53 | PWA | manifest, sw.js | web | — |
| F54 | Suporte WhatsApp | _footer.php | web | — |
| F55 | Awards (não usado hoje) | _milestones.php | backlog — decidir se entra | — |
| F56 | CSRF, headers, CSP | csrf.php, security.php | api/security | CSP sem unsafe-inline |
| F57 | Auto-migrações | helpers.php etc. | packages/db (migrações versionadas) | migração do zero e incremental |
