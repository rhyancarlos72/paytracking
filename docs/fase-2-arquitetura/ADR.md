# Fase 2 — Decisões de arquitetura (ADRs)

Cada decisão registra o contexto, a escolha, as alternativas e as consequências. Todas derivam da auditoria (`docs/fase-1-auditoria`).

## ADR-001 · PostgreSQL como banco principal (em vez de Firestore)

- **Contexto:** o núcleo é um ledger financeiro (pagamentos, reembolsos, conciliação com eventos enviados à Meta e com campanhas). Os incidentes P-02, P-05 e P-07 vieram justamente da falta de idempotência transacional.
- **Decisão:** PostgreSQL 16, com `UNIQUE` para idempotência, transações ACID agrupando "receber → registrar pagamento → enfileirar CAPI" e SQL para agregações por período, moeda e campanha.
- **Alternativa:** Firestore. Rejeitada por não ter restrição de unicidade, por ter agregação limitada e cobrada por leitura e por não ter JOIN para conciliação.
- **Consequência:** em produção, Cloud SQL (ou Neon/Supabase). Firebase continua opcional para Hosting.

## ADR-002 · Autenticação própria com sessões revogáveis

- **Contexto:** os usuários atuais têm hashes bcrypt (`password_hash` do PHP, prefixo `$2y$`).
- **Decisão:** e-mail + senha com bcrypt, compatível com os hashes antigos, então ninguém precisa trocar de senha. A sessão vive em cookie `HttpOnly; Secure; SameSite=Lax` com token aleatório de 256 bits, guardado só como SHA-256 em `sessions`, revogável e com expiração deslizante. Inclui recuperação de senha, verificação de e-mail e revogação de todas as sessões ao trocar a senha.
- **Alternativa:** Firebase Auth, que também importa bcrypt. Fica como opção futura atrás da interface `auth/`. Não foi usada agora porque exigiria um projeto Firebase que ainda não existe e impediria testar de ponta a ponta localmente.

## ADR-003 · Multi-tenant por organização

- Toda entidade de negócio carrega `org_id`. O usuário entra numa organização via `memberships` com papel `owner | admin | analyst | viewer`.
- Toda rota autenticada resolve `org_id` a partir da sessão e do membership, nunca do corpo da requisição, e os repositórios exigem `orgId`.
- Permissões: `viewer` só lê; `analyst` lê e reprocessa eventos; `admin` altera pixels, integrações e Meta; `owner` cuida de membros e assinatura.
- `pixel_products` tem `UNIQUE(org_id, product_id)` e a resolução de pixel por produto exige a chave pública do pixel ou a integração, o que fecha P-02b.

## ADR-004 · Pipeline de eventos com outbox transacional

```
webhook → verifica origem → idempotência (webhook_receipts UNIQUE)
       → [transação] upsert payments (máquina de estados) + capi_outbox (UNIQUE pixel+evento+event_id)
       → 2xx imediato
worker → SELECT … FOR UPDATE SKIP LOCKED → POST Meta → capi_attempts
       → sent só com events_received ≥ 1
       → erro temporário: backoff exponencial + jitter · erro permanente: dead + alerta
```

- O envio à Meta nunca acontece dentro do webhook (corrige P-16). Uma falha da Meta não perde o evento original, que continua em `webhook_receipts`, com o corpo cifrado.
- Reprocessar recoloca o mesmo registro do outbox. O `event_id` é estável e a Meta deduplica, então reprocessar não duplica receita nem conversões.

## ADR-005 · Dinheiro em inteiros, conversão explícita

- `amount_minor BIGINT` + `currency CHAR(3)`, com o expoente ISO 4217 por moeda (JPY/CLP/PYG = 0).
- Parsing de valores é exato, sobre a string, sem float. Cada adapter declara a unidade do gateway: sem heurística (corrige P-04).
- A conversão para a moeda de relatório da organização usa `fx_rates` **da data da transação**. Sem cotação, o valor fica marcado como "não convertido" e sai do total com aviso: nada de fallback 1.0.
- O orçamento da Meta é editado **na moeda da conta**, sem conversão (corrige P-25 e P-27).

## ADR-006 · Classificação de status por correspondência exata

- Cada adapter mapeia os status/eventos documentados de cada gateway para `pending | approved | refunded | chargeback | canceled | failed`. Status desconhecido → `ignored(unknown_status)`. Nunca por substring (corrige P-03).
- `Purchase` só é enfileirado na transição para `approved` e só uma vez por transação.

## ADR-007 · Stack

| Camada | Escolha |
|---|---|
| Monorepo | pnpm workspaces · TypeScript strict |
| Servidor | Node 22 + Fastify 5 + Zod; dois entrypoints na mesma imagem: `server` (API) e `worker` |
| Banco | PostgreSQL 16 via `pg`, migrações SQL versionadas |
| Web | React 18 + Vite + Tailwind + TanStack Query + React Router + React Hook Form/Zod + Recharts + lucide |
| Pixel | TypeScript → IIFE ES2017 (esbuild), servido pelo servidor |
| Testes | Vitest (unidade e integração com Postgres real) + Playwright (smoke do build) |
| CI | GitHub Actions com serviço Postgres: lint, typecheck, testes, build, `pnpm audit`, gitleaks |
| Deploy | Docker → Cloud Run (`server` e `worker`); Cloud SQL; Secret Manager; Cloud Scheduler opcional |

## ADR-008 · Compatibilidade com integrações existentes

- O formato de payload do webhook do checkout próprio e os nomes de evento aceitos são **preservados**: aliases `data`, `payload`, `payer`, `customer`... e `mapEventName`.
- Os gateways mantêm o esquema de autenticação de cada um: Kiwify HMAC-SHA1, Cakto `secret` no JSON, Kirvano `security-token`, Hotmart `X-HOTMART-HOTTOK`.
- Lowify/Wiapay: o segredo do caminho da URL continua sendo o método principal. Se houver segredo configurado, ele passa a ser **obrigatório**.
- O evento customizado `Refund` continua sendo enviado (comportamento antigo), mas pode ser desligado por pixel, e o reembolso agora abate o faturamento.
- O `pixel.js` novo mantém os mesmos atributos `data-*`, as mesmas chaves de `localStorage` (`pt_xid`, `pt_utms`, `pt_ic_<pixel>`) e a decoração `xcod`/`sck`.
