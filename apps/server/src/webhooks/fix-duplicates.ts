import { tx } from '@pt/db';
import type { Ctx } from '../context.js';

/**
 * Junta vendas duplicadas: a mesma transação gravada como "legacy" (importada do sistema antigo)
 * E de novo pelo gateway (ex.: Hotmart PURCHASE_COMPLETE no fim da garantia). Fica UMA venda — a do
 * gateway, que tem os webhooks — na data original, sem aviso de "nova venda". A cópia antiga é
 * removida e o conteúdo dela vai inteiro para a auditoria (dá para conferir/restaurar).
 * Também marca como histórico as vendas que entraram só por confirmação tardia (sem aprovação aqui).
 */
export async function fixDuplicateSales(ctx: Ctx, orgId: string, userId: string): Promise<{ merged: number; historical: number }> {
  return tx(ctx.db, async (c) => {
    const pairs = await c.query(
      `SELECT l.id AS legacy_id, p.id AS payment_id, to_jsonb(l) AS legacy_row
         FROM payments l JOIN payments p ON p.org_id = l.org_id AND p.transaction_id = l.transaction_id AND p.provider <> 'legacy'
        WHERE l.org_id = $1 AND l.provider = 'legacy'
        FOR UPDATE OF l, p`,
      [orgId],
    );
    for (const r of pairs.rows) {
      await c.query(
        `UPDATE payments p SET
            approved_at = CASE WHEN p.status = 'approved' THEN LEAST(p.approved_at, l.approved_at) ELSE p.approved_at END,
            created_at  = LEAST(p.created_at, l.created_at),
            pixel_id    = COALESCE(p.pixel_id, l.pixel_id),
            utm_source = COALESCE(p.utm_source, l.utm_source), utm_medium = COALESCE(p.utm_medium, l.utm_medium),
            utm_campaign = COALESCE(p.utm_campaign, l.utm_campaign), utm_content = COALESCE(p.utm_content, l.utm_content),
            utm_term = COALESCE(p.utm_term, l.utm_term), utm_id = COALESCE(p.utm_id, l.utm_id),
            late_import = true, updated_at = now()
           FROM payments l WHERE p.id = $1 AND l.id = $2`,
        [r.payment_id, r.legacy_id],
      );
      await c.query('DELETE FROM payments WHERE id = $1 AND org_id = $2', [r.legacy_id, orgId]);
      await c.query(`INSERT INTO audit_log(org_id, user_id, action, target, metadata) VALUES ($1, $2, 'payment.duplicate_merged', $3, $4)`,
        [orgId, userId, r.payment_id, JSON.stringify({ removedLegacyRow: r.legacy_row })]);
    }
    // vendas que nasceram de um PURCHASE_COMPLETE (nunca aprovadas aqui): histórico, sem aviso de nova venda
    const hist = await c.query(
      `UPDATE payments p SET late_import = true
        WHERE p.org_id = $1 AND NOT p.late_import AND p.provider = 'hotmart'
          AND EXISTS (SELECT 1 FROM payment_transitions t JOIN webhook_receipts r ON r.id = t.receipt_id
                       WHERE t.payment_id = p.id AND t.from_status IS NULL AND t.to_status = 'approved' AND upper(r.gateway_event) = 'PURCHASE_COMPLETE')`,
      [orgId],
    );
    return { merged: pairs.rowCount ?? 0, historical: hist.rowCount ?? 0 };
  });
}
