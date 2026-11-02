import type { Ctx } from '../context.js';

/**
 * Limpeza dos eventos (pedido do dono): brutos com mais de EVENT_RETENTION_DAYS (3) dias são apagados;
 * Purchase só com mais de PURCHASE_EVENT_RETENTION_DAYS (6). Antes de apagar, cada linha é somada
 * no resumo por hora (tracking_rollup / capi_rollup) NO MESMO comando SQL — os relatórios leem
 * "recentes + resumo" pelas views tracking_counts / capi_counts e os totais não mudam.
 *
 * Não toca em: payments (vendas, faturamento, campanhas), visitor_identities (ligam vendas atrasadas
 * à campanha) e itens da fila ainda não entregues (pending/sending).
 */
const HOUR = `date_trunc('hour', %s AT TIME ZONE 'UTC') AT TIME ZONE 'UTC'`;

export async function cleanupEvents(ctx: Ctx): Promise<{ trackingEvents: number; capiEvents: number; purchasesArchived: number }> {
  const days = ctx.config.EVENT_RETENTION_DAYS;
  const purchaseDays = ctx.config.PURCHASE_EVENT_RETENTION_DAYS;
  // limite por evento: Purchase fica mais tempo
  const expired = (col: string) =>
    `${col} < now() - make_interval(days => CASE WHEN event_name = 'Purchase' THEN $2::int ELSE $1::int END)`;
  const c = await ctx.db.connect();
  try {
    await c.query('BEGIN');
    // 1) o resultado da entrega do Purchase passa a morar na venda
    const archived = await c.query(
      `UPDATE payments p SET purchase_capi_status = o.status, purchase_capi_sent_at = o.sent_at
         FROM capi_outbox o
        WHERE o.payment_id = p.id AND o.event_name = 'Purchase' AND o.status IN ('sent', 'dead') AND ${expired('o.created_at')}`,
      [days, purchaseDays],
    );
    // 2) fila da Meta: resume e apaga (só o que já terminou)
    const capi = await c.query(
      `WITH del AS (
         DELETE FROM capi_outbox WHERE status IN ('sent', 'dead') AND ${expired('created_at')}
         RETURNING org_id, pixel_id, ${HOUR.replace('%s', 'created_at')} AS hour, event_name, status
       ), agg AS (
         SELECT org_id, pixel_id, hour, event_name, status, count(*)::int AS n FROM del GROUP BY 1, 2, 3, 4, 5
       ), ins AS (
         INSERT INTO capi_rollup(key, org_id, pixel_id, hour, event_name, status, n)
         SELECT md5(concat_ws('|', org_id, pixel_id, extract(epoch FROM hour), event_name, status)), org_id, pixel_id, hour, event_name, status, n FROM agg
         ON CONFLICT (key) DO UPDATE SET n = capi_rollup.n + EXCLUDED.n RETURNING 1
       )
       SELECT (SELECT count(*) FROM del)::int AS deleted, (SELECT count(*) FROM ins)::int AS buckets`,
      [days, purchaseDays],
    );
    // 3) eventos do navegador/servidor: resume e apaga
    const tracking = await c.query(
      `WITH del AS (
         DELETE FROM tracking_events WHERE ${expired('received_at')}
         RETURNING org_id, pixel_id, ${HOUR.replace('%s', 'received_at')} AS hour, event_name, source,
                   utm_source, utm_medium, utm_campaign, utm_content, utm_term, utm_id,
                   ARRAY(SELECT DISTINCT k FROM unnest(match_keys) k ORDER BY 1) AS match_keys
       ), agg AS (
         SELECT org_id, pixel_id, hour, event_name, source, utm_source, utm_medium, utm_campaign, utm_content, utm_term, utm_id, match_keys, count(*)::int AS n
           FROM del GROUP BY 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12
       ), ins AS (
       INSERT INTO tracking_rollup(key, org_id, pixel_id, hour, event_name, source, utm_source, utm_medium, utm_campaign, utm_content, utm_term, utm_id, match_keys, n)
       SELECT md5(concat_ws('|', org_id, pixel_id, extract(epoch FROM hour), event_name, source,
                  coalesce(utm_source, E'\\x01'), coalesce(utm_medium, E'\\x01'), coalesce(utm_campaign, E'\\x01'), coalesce(utm_content, E'\\x01'),
                  coalesce(utm_term, E'\\x01'), coalesce(utm_id, E'\\x01'), array_to_string(match_keys, ','))),
              org_id, pixel_id, hour, event_name, source, utm_source, utm_medium, utm_campaign, utm_content, utm_term, utm_id, match_keys, n
         FROM agg
       ON CONFLICT (key) DO UPDATE SET n = tracking_rollup.n + EXCLUDED.n RETURNING 1
       )
       SELECT (SELECT count(*) FROM del)::int AS deleted, (SELECT count(*) FROM ins)::int AS buckets`,
      [days, purchaseDays],
    );
    await c.query('COMMIT');
    return { trackingEvents: tracking.rows[0]?.deleted ?? 0, capiEvents: capi.rows[0]?.deleted ?? 0, purchasesArchived: archived.rowCount ?? 0 };
  } catch (e) {
    await c.query('ROLLBACK').catch(() => undefined);
    throw e;
  } finally {
    c.release();
  }
}
