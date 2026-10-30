-- Login com Google: identificador estável da conta Google (claim "sub"), único por usuário.
ALTER TABLE users ADD COLUMN IF NOT EXISTS google_sub text;
CREATE UNIQUE INDEX IF NOT EXISTS users_google_sub_key ON users(google_sub) WHERE google_sub IS NOT NULL;
