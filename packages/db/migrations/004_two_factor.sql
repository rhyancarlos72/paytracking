-- Verificação em duas etapas (TOTP, RFC 6238) por usuário. Segredos cifrados pela aplicação. Aditiva.
ALTER TABLE users ADD COLUMN IF NOT EXISTS totp_secret_enc text;
ALTER TABLE users ADD COLUMN IF NOT EXISTS totp_pending_enc text;          -- durante a ativação, até confirmar o 1º código
ALTER TABLE users ADD COLUMN IF NOT EXISTS totp_enabled_at timestamptz;
ALTER TABLE users ADD COLUMN IF NOT EXISTS totp_last_counter bigint;       -- impede reutilizar o mesmo código
ALTER TABLE users ADD COLUMN IF NOT EXISTS totp_recovery_hashes text[] NOT NULL DEFAULT '{}';
