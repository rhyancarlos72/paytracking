import { isPublicIp, sha256, UTM_KEYS } from '@pt/domain';

type Q = { query: (sql: string, params?: unknown[]) => Promise<{ rows: any[]; rowCount: number | null }> };

/**
 * Ponte de identidade (porta de app/pt_identity.php).
 * O Purchase chega servidor-a-servidor sem fbp/fbc/IP/UA; recuperamos o que o navegador
 * registrou no PageView/InitiateCheckout pelo pt_xid (levado no xcod/sck) ou, na falta,
 * pelo hash do e-mail/telefone.
 *
 * Mitigação de envenenamento (P-11): a busca por e-mail/telefone só considera identidades
 * que passaram pelo checkout (checkout_seen) e escolhe a mais recente; o navegador nunca
 * sobrescreve e-mail/telefone já gravados para um xid.
 */

export const emailLookupHash = (email: string | null | undefined): string | null => {
  const e = (email ?? '').trim().toLowerCase();
  return e.includes('@') ? sha256(e) : null;
};

/** 9 últimos dígitos: imune a variações de DDI/DDD. */
export const phoneLookupHash = (phone: string | null | undefined): string | null => {
  const d = String(phone ?? '').replace(/\D+/g, '');
  return d.length >= 8 ? sha256(d.slice(-9)) : null;
};

export interface IdentityInput {
  xid: string;
  fbp?: string | null;
  fbc?: string | null;
  ip?: string | null;
  userAgent?: string | null;
  country?: string | null;
  email?: string | null;
  phone?: string | null;
  sourceUrl?: string | null;
  utms?: Record<string, string | null | undefined>;
  checkoutSeen?: boolean;
}

const clip = (v: unknown, n: number) => (typeof v === 'string' && v.trim() ? v.trim().slice(0, n) : null);

export async function rememberIdentity(c: Q, orgId: string, i: IdentityInput): Promise<void> {
  const xid = clip(i.xid, 100);
  if (!xid) return;
  const u = i.utms ?? {};
  await c.query(
    `INSERT INTO visitor_identities(org_id, xid, fbp, fbc, client_ip, user_agent, country, email_hash, phone_hash, source_url,
                                    utm_source, utm_medium, utm_campaign, utm_content, utm_term, utm_id, checkout_seen)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17)
     ON CONFLICT (org_id, xid) DO UPDATE SET
       fbp = COALESCE(EXCLUDED.fbp, visitor_identities.fbp),
       fbc = COALESCE(EXCLUDED.fbc, visitor_identities.fbc),
       client_ip = COALESCE(EXCLUDED.client_ip, visitor_identities.client_ip),
       user_agent = COALESCE(EXCLUDED.user_agent, visitor_identities.user_agent),
       country = COALESCE(EXCLUDED.country, visitor_identities.country),
       email_hash = COALESCE(visitor_identities.email_hash, EXCLUDED.email_hash),
       phone_hash = COALESCE(visitor_identities.phone_hash, EXCLUDED.phone_hash),
       source_url = COALESCE(EXCLUDED.source_url, visitor_identities.source_url),
       utm_source = COALESCE(EXCLUDED.utm_source, visitor_identities.utm_source),
       utm_medium = COALESCE(EXCLUDED.utm_medium, visitor_identities.utm_medium),
       utm_campaign = COALESCE(EXCLUDED.utm_campaign, visitor_identities.utm_campaign),
       utm_content = COALESCE(EXCLUDED.utm_content, visitor_identities.utm_content),
       utm_term = COALESCE(EXCLUDED.utm_term, visitor_identities.utm_term),
       utm_id = COALESCE(EXCLUDED.utm_id, visitor_identities.utm_id),
       checkout_seen = visitor_identities.checkout_seen OR EXCLUDED.checkout_seen,
       updated_at = now()`,
    [
      orgId, xid, clip(i.fbp, 255), clip(i.fbc, 255), isPublicIp(i.ip) ? i.ip : null, clip(i.userAgent, 512),
      clip(i.country, 2)?.toUpperCase() ?? null, emailLookupHash(i.email), phoneLookupHash(i.phone), clip(i.sourceUrl, 1000),
      ...UTM_KEYS.map((k) => clip(u[k], 255)), !!i.checkoutSeen,
    ],
  );
}

export interface Identity {
  xid: string;
  fbp: string | null;
  fbc: string | null;
  client_ip: string | null;
  user_agent: string | null;
  country: string | null;
  source_url: string | null;
  utm_source: string | null; utm_medium: string | null; utm_campaign: string | null;
  utm_content: string | null; utm_term: string | null; utm_id: string | null;
}

export async function findIdentity(
  c: Q, orgId: string, keys: { xid?: string | null; email?: string | null; phone?: string | null },
): Promise<Identity | null> {
  const cols = `xid, fbp, fbc, host(client_ip) AS client_ip, user_agent, country, source_url,
                utm_source, utm_medium, utm_campaign, utm_content, utm_term, utm_id`;
  if (keys.xid) {
    const r = await c.query(
      `SELECT ${cols} FROM visitor_identities WHERE org_id = $1 AND xid = $2 AND updated_at > now() - interval '90 days'`,
      [orgId, keys.xid.trim().slice(0, 100)],
    );
    if (r.rows[0]) return r.rows[0];
  }
  for (const [col, hash] of [['email_hash', emailLookupHash(keys.email)], ['phone_hash', phoneLookupHash(keys.phone)]] as const) {
    if (!hash) continue;
    const r = await c.query(
      `SELECT ${cols} FROM visitor_identities
        WHERE org_id = $1 AND ${col} = $2 AND checkout_seen AND updated_at > now() - interval '90 days'
        ORDER BY updated_at DESC LIMIT 1`,
      [orgId, hash],
    );
    if (r.rows[0]) return r.rows[0];
  }
  return null;
}
