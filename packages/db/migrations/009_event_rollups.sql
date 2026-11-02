-- Limpeza de eventos sem perder os números: antes de apagar os eventos brutos (3 dias; Purchase 6 dias),
-- as CONTAGENS viram um resumo por hora. Nada de dado pessoal no resumo (só nome do evento, UTMs e
-- quais chaves de correspondência existiam). Vendas, faturamento e campanhas vêm de `payments`
-- e não são afetados. Migração só aditiva.

CREATE TABLE IF NOT EXISTS tracking_rollup (
  key          text PRIMARY KEY,                    -- md5 da combinação (evita índice largo com UTMs longas)
  org_id       uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  pixel_id     uuid NOT NULL REFERENCES pixels(id) ON DELETE CASCADE,
  hour         timestamptz NOT NULL,
  event_name   text NOT NULL,
  source       text NOT NULL,
  utm_source   text, utm_medium text, utm_campaign text, utm_content text, utm_term text, utm_id text,
  match_keys   text[] NOT NULL DEFAULT '{}',
  n            integer NOT NULL
);
CREATE INDEX IF NOT EXISTS tracking_rollup_org_time_idx ON tracking_rollup(org_id, hour);

CREATE TABLE IF NOT EXISTS capi_rollup (
  key          text PRIMARY KEY,
  org_id       uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  pixel_id     uuid NOT NULL REFERENCES pixels(id) ON DELETE CASCADE,
  hour         timestamptz NOT NULL,
  event_name   text NOT NULL,
  status       text NOT NULL,
  n            integer NOT NULL
);
CREATE INDEX IF NOT EXISTS capi_rollup_org_time_idx ON capi_rollup(org_id, hour);

-- resultado da entrega do Purchase guardado na própria venda (o registro da fila é apagado depois)
ALTER TABLE payments ADD COLUMN IF NOT EXISTS purchase_capi_status text;
ALTER TABLE payments ADD COLUMN IF NOT EXISTS purchase_capi_sent_at timestamptz;

-- leitura única: eventos recentes (linha a linha) + resumo dos antigos
CREATE OR REPLACE VIEW tracking_counts AS
  SELECT org_id, pixel_id, received_at AS at, event_name, source,
         utm_source, utm_medium, utm_campaign, utm_content, utm_term, utm_id, match_keys, 1 AS n
    FROM tracking_events
  UNION ALL
  SELECT org_id, pixel_id, hour, event_name, source,
         utm_source, utm_medium, utm_campaign, utm_content, utm_term, utm_id, match_keys, n
    FROM tracking_rollup;

CREATE OR REPLACE VIEW capi_counts AS
  SELECT org_id, pixel_id, created_at AS at, event_name, status, 1 AS n FROM capi_outbox
  UNION ALL
  SELECT org_id, pixel_id, hour, event_name, status, n FROM capi_rollup;
