-- Venda que só chegou por uma confirmação tardia (ex.: Hotmart PURCHASE_COMPLETE, fim da garantia)
-- sem nunca ter passado pelo PayTracking: entra como histórico (sem aviso de nova venda nem Purchase).
ALTER TABLE payments ADD COLUMN IF NOT EXISTS late_import boolean NOT NULL DEFAULT false;
