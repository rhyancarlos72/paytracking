-- Índices de desempenho (auditoria): consultas que varriam a tabela inteira em escala.

-- Lista de vendas e detalhe da venda: status do Purchase por venda (subconsulta por payment_id, 50x por página)
-- e a conciliação vendas × Purchase entregue (JOIN por payment_id).
CREATE INDEX IF NOT EXISTS capi_outbox_payment_idx ON capi_outbox(payment_id) WHERE payment_id IS NOT NULL;

-- Detalhe da venda: recibos de webhook da venda.
CREATE INDEX IF NOT EXISTS webhook_receipts_payment_idx ON webhook_receipts(payment_id) WHERE payment_id IS NOT NULL;

-- Fila da CAPI: o worker busca "pendentes vencidos OU reservas expiradas" a cada ciclo. O índice antigo só cobria
-- 'pending' e a condição com OR caía numa varredura da tabela (que guarda dias de eventos já enviados).
CREATE INDEX IF NOT EXISTS capi_outbox_active_idx ON capi_outbox(next_attempt_at) WHERE status IN ('pending', 'sending');
DROP INDEX IF EXISTS capi_outbox_ready_idx;

-- Limpeza horária dos corpos de webhook cifrados (só linhas que ainda têm corpo).
CREATE INDEX IF NOT EXISTS webhook_receipts_body_time_idx ON webhook_receipts(received_at) WHERE body_enc IS NOT NULL;

-- Retenção dos recibos sem valor de auditoria (rejeitados/ignorados/duplicados) por data.
CREATE INDEX IF NOT EXISTS webhook_receipts_time_idx ON webhook_receipts(received_at) WHERE outcome <> 'processed';
