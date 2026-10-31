import { ADAPTERS } from '@pt/gateways';
import { UTM_KEYS } from '@pt/domain';
import type { Ctx } from '../context.js';
import { findIdentity } from '../tracking/identity.js';
import { parsePayload } from './ingest.js';

/**
 * Recupera a campanha (UTMs) de vendas que entraram sem ela — típico da Hotmart, que só devolve
 * xcod/sck/src. Relê o webhook guardado (cifrado, até WEBHOOK_BODY_RETENTION_DAYS), acha o
 * visitante pela ponte de identidade e preenche SÓ as UTMs vazias. Não muda status nem valor e
 * não envia nada à Meta.
 */
export async function recoverPaymentUtms(ctx: Ctx, orgId: string): Promise<{ checked: number; recovered: number }> {
  const r = await ctx.db.query<{ id: string; provider: string; body_enc: string; default_pixel_id: string | null; amount_unit: string | null }>(
    `SELECT DISTINCT ON (p.id) p.id, p.provider, w.body_enc, i.default_pixel_id, i.amount_unit
       FROM payments p
       JOIN webhook_receipts w ON w.payment_id = p.id AND w.body_enc IS NOT NULL
       LEFT JOIN integrations i ON i.id = w.integration_id
      WHERE p.org_id = $1 AND p.utm_campaign IS NULL AND p.utm_content IS NULL AND p.utm_medium IS NULL
      ORDER BY p.id, w.received_at DESC
      LIMIT 2000`,
    [orgId],
  );
  let recovered = 0;
  for (const row of r.rows) {
    const adapter = ADAPTERS[row.provider as keyof typeof ADAPTERS];
    if (!adapter) continue;
    let payload: Record<string, unknown> | null = null;
    try { payload = parsePayload(ctx.box.decrypt(row.body_enc)); } catch { continue; }
    if (!payload) continue;
    const n = adapter.normalize(payload, { defaultCurrency: 'BRL', amountUnit: (row.amount_unit ?? undefined) as never, now: ctx.now });
    if (n.kind === 'ignored') continue;
    const t = n.tracking;
    const identity = await findIdentity(ctx.db, orgId, { xid: t.externalId ?? n.customer.externalId, email: n.customer.email, phone: n.customer.phone });
    const utms = UTM_KEYS.map((k) => t[k] ?? identity?.[k] ?? null);
    if (!utms.some(Boolean) || (!utms[1] && !utms[2] && !utms[3])) continue; // sem campanha/conjunto/anúncio: nada a recuperar
    const u = await ctx.db.query(
      `UPDATE payments SET utm_source = COALESCE(utm_source, $2), utm_medium = COALESCE(utm_medium, $3), utm_campaign = COALESCE(utm_campaign, $4),
              utm_content = COALESCE(utm_content, $5), utm_term = COALESCE(utm_term, $6), utm_id = COALESCE(utm_id, $7), updated_at = now()
        WHERE id = $1 AND org_id = $8`,
      [row.id, ...utms, orgId],
    );
    recovered += u.rowCount ?? 0;
  }
  return { checked: r.rows.length, recovered };
}
