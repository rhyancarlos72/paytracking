-- PayTracking — schema inicial (PostgreSQL 16). Ver docs/fase-2-arquitetura/MODELO-DE-DADOS.md
CREATE EXTENSION IF NOT EXISTS citext;
CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- ===================================================================== identidade
CREATE TABLE users (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email             citext NOT NULL UNIQUE,
  password_hash     text NOT NULL,
  name              text,
  email_verified_at timestamptz,
  is_platform_admin boolean NOT NULL DEFAULT false,
  hide_email        boolean NOT NULL DEFAULT false,
  legacy_user_id    bigint UNIQUE,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE sessions (
  id            text PRIMARY KEY,                    -- sha256(token) — o token bruto só existe no cookie
  user_id       uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  active_org_id uuid,
  ip            inet,
  user_agent    text,
  created_at    timestamptz NOT NULL DEFAULT now(),
  last_seen_at  timestamptz NOT NULL DEFAULT now(),
  expires_at    timestamptz NOT NULL,
  revoked_at    timestamptz
);
CREATE INDEX sessions_user_idx ON sessions(user_id);

CREATE TABLE auth_tokens (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  kind       text NOT NULL CHECK (kind IN ('password_reset', 'email_verify')),
  token_hash text NOT NULL UNIQUE,
  expires_at timestamptz NOT NULL,
  used_at    timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE rate_limits (
  bucket     text PRIMARY KEY,
  count      integer NOT NULL,
  window_end timestamptz NOT NULL
);

-- ===================================================================== organizações
CREATE TABLE organizations (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name               text NOT NULL,
  reporting_currency char(3) NOT NULL DEFAULT 'BRL',
  timezone           text NOT NULL DEFAULT 'America/Sao_Paulo',
  goal_daily_minor   bigint NOT NULL DEFAULT 0,
  goal_monthly_minor bigint NOT NULL DEFAULT 0,
  plan_status        text NOT NULL DEFAULT 'trial' CHECK (plan_status IN ('trial', 'active', 'expired', 'exempt')),
  plan_expires_at    timestamptz,
  plan_started_at    timestamptz,
  legacy_user_id     bigint UNIQUE,
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE memberships (
  org_id     uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  user_id    uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role       text NOT NULL CHECK (role IN ('owner', 'admin', 'analyst', 'viewer')),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (org_id, user_id)
);
CREATE INDEX memberships_user_idx ON memberships(user_id);

CREATE TABLE invitations (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id      uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  email       citext NOT NULL,
  role        text NOT NULL CHECK (role IN ('admin', 'analyst', 'viewer')),
  token_hash  text NOT NULL UNIQUE,
  invited_by  uuid REFERENCES users(id) ON DELETE SET NULL,
  expires_at  timestamptz NOT NULL,
  accepted_at timestamptz,
  created_at  timestamptz NOT NULL DEFAULT now()
);

-- ===================================================================== pixels
CREATE TABLE pixels (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id            uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  name              text NOT NULL CHECK (length(name) BETWEEN 1 AND 120),
  meta_pixel_id     text NOT NULL CHECK (meta_pixel_id ~ '^\d{6,32}$'),
  capi_token_enc    text,                          -- AES-256-GCM (lib/crypto) — nunca vai ao navegador
  test_event_code   text,
  currency          char(3) NOT NULL DEFAULT 'BRL',
  country           char(2) NOT NULL DEFAULT 'BR',
  public_key        text NOT NULL UNIQUE,          -- vai no navegador (não é segredo)
  active            boolean NOT NULL DEFAULT true,
  ic_rule_type      text NOT NULL DEFAULT 'none' CHECK (ic_rule_type IN ('none', 'contains', 'equals', 'starts_with')),
  ic_rule_value     text,
  send_refund_event boolean NOT NULL DEFAULT true,
  allowed_origins   text[] NOT NULL DEFAULT '{}',  -- vazio = qualquer origem (compatível com o legado)
  legacy_project_id bigint UNIQUE,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX pixels_org_idx ON pixels(org_id);

CREATE TABLE pixel_products (
  org_id     uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  pixel_id   uuid NOT NULL REFERENCES pixels(id) ON DELETE CASCADE,
  product_id text NOT NULL,
  PRIMARY KEY (org_id, product_id)                 -- um produto pertence a UM pixel por organização (P-02b)
);
CREATE INDEX pixel_products_pixel_idx ON pixel_products(pixel_id);

-- ===================================================================== integrações (gateways / checkout)
CREATE TABLE integrations (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id           uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  provider         text NOT NULL CHECK (provider IN ('checkout', 'kiwify', 'cakto', 'kirvano', 'hotmart', 'lowify', 'wiapay')),
  name             text NOT NULL,
  token_hash       text NOT NULL,                  -- sha256 do token da URL/Bearer (compatível com o legado)
  token_hint       text NOT NULL,                  -- últimos 4 caracteres, para identificação na UI
  secret_enc       text,                           -- segredo do gateway (AES-256-GCM)
  default_pixel_id uuid REFERENCES pixels(id) ON DELETE SET NULL,
  amount_unit      text NOT NULL DEFAULT 'major' CHECK (amount_unit IN ('major', 'minor')),
  active           boolean NOT NULL DEFAULT true,
  last_received_at timestamptz,
  legacy_source    text,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX integrations_org_idx ON integrations(org_id);
-- o legado usava UM token por conta para todos os gateways: unicidade por (token, provedor)
CREATE UNIQUE INDEX integrations_token_uq ON integrations(token_hash, provider);

-- Registro de TODO webhook recebido (auditoria, diagnóstico e reprocessamento).
CREATE TABLE webhook_receipts (
  id               bigserial PRIMARY KEY,
  org_id           uuid REFERENCES organizations(id) ON DELETE CASCADE,
  integration_id   uuid REFERENCES integrations(id) ON DELETE SET NULL,
  provider         text NOT NULL,
  correlation_id   uuid NOT NULL DEFAULT gen_random_uuid(),
  idempotency_key  text,
  received_at      timestamptz NOT NULL DEFAULT now(),
  signature_ok     boolean,
  signature_method text,
  outcome          text NOT NULL CHECK (outcome IN ('processed', 'duplicate', 'ignored', 'rejected', 'failed')),
  reason           text,
  gateway_event    text,
  transaction_id   text,
  payment_id       uuid,
  body_sha256      text NOT NULL,
  body_enc         text,                           -- corpo cru cifrado (retenção limitada) para reprocessar
  processing_ms    integer
);
CREATE UNIQUE INDEX webhook_receipts_idem_uq ON webhook_receipts(integration_id, idempotency_key)
  WHERE idempotency_key IS NOT NULL AND outcome = 'processed';
CREATE INDEX webhook_receipts_org_time_idx ON webhook_receipts(org_id, received_at DESC);

-- ===================================================================== pagamentos (fonte da verdade de vendas)
CREATE TABLE payments (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id               uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  pixel_id             uuid REFERENCES pixels(id) ON DELETE SET NULL,
  integration_id       uuid REFERENCES integrations(id) ON DELETE SET NULL,
  provider             text NOT NULL,
  transaction_id       text NOT NULL CHECK (length(transaction_id) <= 128),
  status               text NOT NULL CHECK (status IN ('pending', 'approved', 'refunded', 'chargeback', 'canceled', 'failed')),
  amount_minor         bigint CHECK (amount_minor IS NULL OR amount_minor >= 0),
  currency             char(3),
  customer_email_hash  text,
  products             jsonb NOT NULL DEFAULT '[]',
  utm_source           text, utm_medium text, utm_campaign text, utm_content text, utm_term text, utm_id text,
  purchase_event_id    text,
  created_at           timestamptz NOT NULL DEFAULT now(),
  updated_at           timestamptz NOT NULL DEFAULT now(),
  pending_at           timestamptz,
  approved_at          timestamptz,
  reversed_at          timestamptz,                -- reembolso/chargeback
  canceled_at          timestamptz,
  UNIQUE (org_id, provider, transaction_id)        -- idempotência por transação (P-05/P-06)
);
CREATE INDEX payments_org_approved_idx ON payments(org_id, approved_at) WHERE approved_at IS NOT NULL;
CREATE INDEX payments_org_created_idx ON payments(org_id, created_at);
CREATE INDEX payments_org_reversed_idx ON payments(org_id, reversed_at) WHERE reversed_at IS NOT NULL;

CREATE TABLE payment_transitions (
  id          bigserial PRIMARY KEY,
  payment_id  uuid NOT NULL REFERENCES payments(id) ON DELETE CASCADE,
  from_status text,
  to_status   text NOT NULL,
  receipt_id  bigint REFERENCES webhook_receipts(id) ON DELETE SET NULL,
  occurred_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX payment_transitions_payment_idx ON payment_transitions(payment_id);

-- ===================================================================== rastreamento do navegador
CREATE TABLE tracking_events (
  id           bigserial PRIMARY KEY,
  org_id       uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  pixel_id     uuid NOT NULL REFERENCES pixels(id) ON DELETE CASCADE,
  event_name   text NOT NULL,
  event_id     text NOT NULL,
  source       text NOT NULL CHECK (source IN ('browser', 'server')),
  value_minor  bigint,
  currency     char(3),
  page_url     text,
  utm_source   text, utm_medium text, utm_campaign text, utm_content text, utm_term text, utm_id text,
  match_keys   text[] NOT NULL DEFAULT '{}',
  received_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (pixel_id, event_name, event_id)          -- dedup de reenvios (beacon + fetch)
);
CREATE INDEX tracking_events_org_time_idx ON tracking_events(org_id, received_at);

CREATE TABLE visitor_identities (
  org_id       uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  xid          text NOT NULL,
  fbp          text, fbc text, client_ip inet, user_agent text, country char(2),
  email_hash   text, phone_hash text,
  source_url   text,
  utm_source   text, utm_medium text, utm_campaign text, utm_content text, utm_term text, utm_id text,
  checkout_seen boolean NOT NULL DEFAULT false,    -- identidade vista no checkout (InitiateCheckout)
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (org_id, xid)
);
CREATE INDEX visitor_identities_email_idx ON visitor_identities(org_id, email_hash, updated_at DESC) WHERE email_hash IS NOT NULL;
CREATE INDEX visitor_identities_phone_idx ON visitor_identities(org_id, phone_hash, updated_at DESC) WHERE phone_hash IS NOT NULL;

-- ===================================================================== outbox da Meta CAPI
CREATE TABLE capi_outbox (
  id               bigserial PRIMARY KEY,
  org_id           uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  pixel_id         uuid NOT NULL REFERENCES pixels(id) ON DELETE CASCADE,
  event_name       text NOT NULL,
  event_id         text NOT NULL,
  payload          jsonb NOT NULL,                 -- server event pronto (PII já hasheada)
  status           text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'sending', 'sent', 'dead')),
  attempts         integer NOT NULL DEFAULT 0,
  next_attempt_at  timestamptz NOT NULL DEFAULT now(),
  locked_until     timestamptz,
  last_error       text,
  last_error_class text,
  last_http_status integer,
  events_received  integer,
  fbtrace_id       text,
  payment_id       uuid REFERENCES payments(id) ON DELETE SET NULL,
  tracking_event_id bigint REFERENCES tracking_events(id) ON DELETE SET NULL,
  correlation_id   uuid,
  created_at       timestamptz NOT NULL DEFAULT now(),
  sent_at          timestamptz,
  UNIQUE (pixel_id, event_name, event_id)          -- reprocessar nunca duplica (cenário 10)
);
CREATE INDEX capi_outbox_ready_idx ON capi_outbox(next_attempt_at) WHERE status = 'pending';
CREATE INDEX capi_outbox_org_time_idx ON capi_outbox(org_id, created_at DESC);

CREATE TABLE capi_attempts (
  id            bigserial PRIMARY KEY,
  outbox_id     bigint NOT NULL REFERENCES capi_outbox(id) ON DELETE CASCADE,
  attempted_at  timestamptz NOT NULL DEFAULT now(),
  http_status   integer,
  duration_ms   integer,
  outcome       text NOT NULL,
  error_code    integer,
  message       text,
  fbtrace_id    text
);
CREATE INDEX capi_attempts_outbox_idx ON capi_attempts(outbox_id);

-- ===================================================================== Meta Ads
CREATE TABLE meta_connections (
  org_id                 uuid PRIMARY KEY REFERENCES organizations(id) ON DELETE CASCADE,
  connected_by           uuid REFERENCES users(id) ON DELETE SET NULL,
  access_token_enc       text NOT NULL,
  token_expires_at       timestamptz,
  scopes                 text[] NOT NULL DEFAULT '{}',
  selected_ad_account_id text,
  ad_account_currency    char(3),
  status                 text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'expired', 'revoked', 'error')),
  last_error             text,
  created_at             timestamptz NOT NULL DEFAULT now(),
  updated_at             timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE oauth_states (
  state      text PRIMARY KEY,
  org_id     uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  user_id    uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at timestamptz NOT NULL
);

CREATE TABLE meta_insights_cache (
  org_id     uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  cache_key  text NOT NULL,
  data       jsonb NOT NULL,
  fetched_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (org_id, cache_key)
);

-- ===================================================================== câmbio
CREATE TABLE fx_rates (
  rate_date date NOT NULL,
  base      char(3) NOT NULL,
  quote     char(3) NOT NULL,
  rate      numeric(20, 8) NOT NULL CHECK (rate > 0),
  source    text NOT NULL,
  fetched_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (rate_date, base, quote)
);

-- ===================================================================== assinatura (Woovi)
CREATE TABLE billing_charges (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id             uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  correlation_id     text NOT NULL UNIQUE,
  provider_charge_id text,
  amount_minor       bigint NOT NULL,
  status             text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'paid', 'expired')),
  br_code            text,
  qr_code_image      text,
  payment_link_url   text,
  period_days        integer NOT NULL DEFAULT 30,
  paid_at            timestamptz,
  expires_at         timestamptz,
  created_at         timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX billing_charges_org_idx ON billing_charges(org_id, created_at DESC);

-- ===================================================================== notificações, alertas, auditoria
CREATE TABLE push_subscriptions (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  org_id     uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  endpoint   text NOT NULL UNIQUE,
  p256dh     text NOT NULL,
  auth       text NOT NULL,
  user_agent text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE alerts (
  id          bigserial PRIMARY KEY,
  org_id      uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  kind        text NOT NULL,
  severity    text NOT NULL CHECK (severity IN ('info', 'warning', 'critical')),
  dedup_key   text NOT NULL,
  title       text NOT NULL,
  detail      text,
  occurrences integer NOT NULL DEFAULT 1,
  first_seen_at timestamptz NOT NULL DEFAULT now(),
  last_seen_at  timestamptz NOT NULL DEFAULT now(),
  resolved_at timestamptz
);
CREATE UNIQUE INDEX alerts_open_uq ON alerts(org_id, dedup_key) WHERE resolved_at IS NULL;

CREATE TABLE audit_log (
  id         bigserial PRIMARY KEY,
  org_id     uuid REFERENCES organizations(id) ON DELETE CASCADE,
  user_id    uuid REFERENCES users(id) ON DELETE SET NULL,
  action     text NOT NULL,
  target     text,
  metadata   jsonb NOT NULL DEFAULT '{}',
  ip         inet,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX audit_log_org_idx ON audit_log(org_id, created_at DESC);
