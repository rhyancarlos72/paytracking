-- Origem de cada cadastro no PayTracking (para o pixel da própria plataforma enviar Lead e Purchase
-- da assinatura à Meta com os mesmos identificadores do clique no anúncio).
CREATE TABLE IF NOT EXISTS signup_attribution (
  user_id     uuid PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  org_id      uuid REFERENCES organizations(id) ON DELETE CASCADE,
  fbp         text,
  fbc         text,
  client_ip   inet,
  user_agent  text,
  utm_source  text, utm_medium text, utm_campaign text, utm_content text, utm_term text, utm_id text,
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS signup_attribution_org_idx ON signup_attribution(org_id);
