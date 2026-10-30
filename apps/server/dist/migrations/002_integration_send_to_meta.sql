-- Modo sombra por integração: grava pagamentos e eventos, mas não enfileira nada para a Meta.
-- Usado enquanto outro sistema (ex.: o PHP antigo) ainda envia as conversões. Aditiva.
ALTER TABLE integrations ADD COLUMN IF NOT EXISTS send_to_meta boolean NOT NULL DEFAULT true;
