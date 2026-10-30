-- Modo privado ("olho"): esconde nomes de campanhas e pixels no painel e nas notificações do usuário.
ALTER TABLE users ADD COLUMN IF NOT EXISTS hide_names boolean NOT NULL DEFAULT false;
