-- Configurações internas da instância (ex.: chaves VAPID do Web Push geradas automaticamente).
-- Valores sensíveis ficam cifrados pela aplicação (SecretBox). Aditiva.
CREATE TABLE IF NOT EXISTS app_settings (
  key        text PRIMARY KEY,
  value      text NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- último push entregue com sucesso em cada dispositivo (exibido em Configurações → Notificações)
ALTER TABLE push_subscriptions ADD COLUMN IF NOT EXISTS last_success_at timestamptz;
