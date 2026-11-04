-- Admin → Usuários: bloqueio de acesso pelo dono da plataforma e consulta rápida da atividade.
-- Só aditiva.
ALTER TABLE users ADD COLUMN IF NOT EXISTS blocked_at timestamptz;
ALTER TABLE users ADD COLUMN IF NOT EXISTS blocked_reason text;
CREATE INDEX IF NOT EXISTS audit_log_user_idx ON audit_log(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS sessions_ip_idx ON sessions(ip);
