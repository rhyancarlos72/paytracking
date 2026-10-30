-- Som de venda escolhido pelo usuário (arquivo próprio), salvo na conta para tocar em todos os aparelhos dele.
CREATE TABLE IF NOT EXISTS user_sale_sounds (
  user_id    uuid PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  name       text NOT NULL,
  mime       text NOT NULL,
  data       bytea NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);
