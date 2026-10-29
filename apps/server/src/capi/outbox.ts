import type { MetaServerEvent } from '@pt/domain';

type Q = { query: (sql: string, params?: unknown[]) => Promise<{ rows: any[]; rowCount: number | null }> };

export interface EnqueueInput {
  orgId: string;
  pixelId: string;
  event: MetaServerEvent;
  paymentId?: string | null;
  trackingEventId?: number | bigint | null;
  correlationId?: string | null;
}

/**
 * Enfileira um evento para a CAPI. A chave UNIQUE (pixel, evento, event_id) garante que
 * reprocessar/reenviar nunca duplique a conversão (cenários 5 e 10).
 * Retorna o id do outbox ou null se o evento já existia.
 */
export async function enqueueCapi(c: Q, i: EnqueueInput): Promise<number | null> {
  const r = await c.query(
    `INSERT INTO capi_outbox(org_id, pixel_id, event_name, event_id, payload, payment_id, tracking_event_id, correlation_id)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
     ON CONFLICT (pixel_id, event_name, event_id) DO NOTHING RETURNING id`,
    [i.orgId, i.pixelId, i.event.event_name, i.event.event_id, JSON.stringify(i.event), i.paymentId ?? null,
      i.trackingEventId ?? null, i.correlationId ?? null],
  );
  return r.rows[0] ? Number(r.rows[0].id) : null;
}

/** Registra/incrementa um alerta aberto (deduplicado por chave). */
export async function raiseAlert(
  c: Q, orgId: string, a: { kind: string; severity: 'info' | 'warning' | 'critical'; dedupKey: string; title: string; detail?: string },
): Promise<void> {
  await c.query(
    `INSERT INTO alerts(org_id, kind, severity, dedup_key, title, detail) VALUES ($1, $2, $3, $4, $5, $6)
     ON CONFLICT (org_id, dedup_key) WHERE resolved_at IS NULL
     DO UPDATE SET occurrences = alerts.occurrences + 1, last_seen_at = now(), detail = EXCLUDED.detail`,
    [orgId, a.kind, a.severity, a.dedupKey, a.title, a.detail ?? null],
  );
}

export async function resolveAlert(c: Q, orgId: string, dedupKey: string): Promise<void> {
  await c.query('UPDATE alerts SET resolved_at = now() WHERE org_id = $1 AND dedup_key = $2 AND resolved_at IS NULL', [orgId, dedupKey]);
}
