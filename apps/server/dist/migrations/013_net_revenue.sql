-- Lucro real: valor LÍQUIDO de cada venda (o que fica com a conta depois da taxa do gateway e das comissões),
-- na mesma moeda da venda. NULL = o gateway não informou; o relatório usa a taxa estimada da organização.
ALTER TABLE payments ADD COLUMN IF NOT EXISTS net_minor bigint CHECK (net_minor IS NULL OR net_minor >= 0);

-- Taxa estimada (em pontos-base: 990 = 9,90%) aplicada às vendas sem valor líquido informado.
ALTER TABLE organizations ADD COLUMN IF NOT EXISTS fee_estimate_bp integer NOT NULL DEFAULT 0
  CHECK (fee_estimate_bp >= 0 AND fee_estimate_bp <= 9000);
