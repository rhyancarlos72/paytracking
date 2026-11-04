import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { Ctx } from '../context.js';
import { badRequest, notFound } from '../lib/errors.js';
import { jsonSafe, parse, requirePlatformAdmin } from '../lib/http.js';
import { isPlatformAdminEmail } from '../auth/service.js';

/**
 * Admin → Usuários: quem se cadastrou, como está usando e sinais para conferir.
 * Mostra só CONTAGENS do que a conta configurou — nunca ID, nome ou chave de pixel, nem dados de
 * vendas dos clientes dela. IP sempre mascarado na tela (a comparação de IPs é feita aqui no servidor).
 */

// limites dos sinais (iguais na lista, no filtro e no detalhe)
const RISK = { failed24h: 5, ips7d: 6, sharedIp: 2, rejected7d: 20 };

export const maskIp = (ip: string | null): string | null => {
  if (!ip) return null;
  if (ip.includes(':')) return ip.split(':').slice(0, 3).join(':') + ':…';
  const p = ip.split('.');
  return p.length === 4 ? `${p[0]}.${p[1]}.•.•` : '•';
};

// IP interno/privado (proxy da hospedagem, rede local, loopback) não identifica pessoa nenhuma: fora dos sinais
const PUBLIC_IP = (col: string) => `${col} IS NOT NULL AND NOT (${col} << '10.0.0.0/8' OR ${col} << '172.16.0.0/12' OR ${col} << '192.168.0.0/16' OR ${col} << '127.0.0.0/8' OR ${col} << '100.64.0.0/10' OR ${col} << '::1/128' OR ${col} << 'fc00::/7' OR ${col} << 'fe80::/10')`;

const BASE = `
  SELECT u.id, u.email, u.name, u.created_at, u.email_verified_at IS NOT NULL AS email_verified,
         u.google_sub IS NOT NULL AS google, u.totp_enabled_at IS NOT NULL AS two_factor, u.blocked_at, u.blocked_reason,
         (SELECT max(s.last_seen_at) FROM sessions s WHERE s.user_id = u.id) AS last_seen_at,
         o.id AS org_id, o.name AS org_name, o.plan_status, o.plan_expires_at, m.role,
         (SELECT count(*) FROM memberships mm WHERE mm.user_id = u.id)::int AS orgs,
         (SELECT count(*) FROM billing_charges b WHERE b.org_id = o.id AND b.status = 'paid')::int AS paid_count,
         (SELECT COALESCE(sum(b.amount_minor), 0) FROM billing_charges b WHERE b.org_id = o.id AND b.status = 'paid')::bigint AS paid_total_minor,
         (SELECT max(b.paid_at) FROM billing_charges b WHERE b.org_id = o.id AND b.status = 'paid') AS last_paid_at,
         (SELECT count(*) FROM pixels p WHERE p.org_id = o.id)::int AS pixels,
         (SELECT count(*) FROM pixels p WHERE p.org_id = o.id AND p.active)::int AS pixels_active,
         COALESCE((SELECT array_agg(DISTINCT i.provider ORDER BY i.provider) FROM integrations i WHERE i.org_id = o.id), '{}') AS providers,
         EXISTS (SELECT 1 FROM meta_connections mc WHERE mc.org_id = o.id AND mc.status = 'active') AS meta_connected,
         (SELECT count(*) FROM payments p WHERE p.org_id = o.id AND p.status = 'approved' AND p.approved_at > now() - interval '30 days')::int AS sales_30d,
         (SELECT count(*) FROM tracking_events t WHERE t.org_id = o.id AND t.received_at > now() - interval '3 days')::int AS events_3d,
         (SELECT count(*) FROM audit_log a WHERE a.user_id = u.id AND a.action IN ('auth.login_failed', 'auth.2fa_failed') AND a.created_at > now() - interval '24 hours')::int AS failed_24h,
         (SELECT count(DISTINCT s.ip) FROM sessions s WHERE s.user_id = u.id AND ${PUBLIC_IP('s.ip')} AND s.created_at > now() - interval '7 days')::int AS ips_7d,
         (SELECT count(DISTINCT s2.user_id) FROM sessions s1 JOIN sessions s2 ON s2.ip = s1.ip AND s2.user_id <> s1.user_id
           WHERE s1.user_id = u.id AND ${PUBLIC_IP('s1.ip')} AND s1.created_at > now() - interval '30 days' AND s2.created_at > now() - interval '30 days')::int AS shared_ip_accounts,
         (SELECT count(*) FROM webhook_receipts w WHERE w.org_id = o.id AND w.outcome = 'rejected' AND w.received_at > now() - interval '7 days')::int AS rejected_7d
    FROM users u
    LEFT JOIN LATERAL (SELECT mm.org_id, mm.role FROM memberships mm WHERE mm.user_id = u.id ORDER BY (mm.role = 'owner') DESC, mm.created_at LIMIT 1) m ON true
    LEFT JOIN organizations o ON o.id = m.org_id`;

const RISK_SQL = `(failed_24h >= ${RISK.failed24h} OR ips_7d >= ${RISK.ips7d} OR shared_ip_accounts >= ${RISK.sharedIp} OR rejected_7d >= ${RISK.rejected7d})`;
const FILTERS: Record<string, string> = {
  all: 'true',
  risk: RISK_SQL,
  blocked: 'blocked_at IS NOT NULL',
  unpaid: `paid_count = 0 AND COALESCE(plan_status, '') <> 'exempt'`,
  paid: 'paid_count > 0',
  no_pixel: 'pixels = 0',
  trial: `plan_status = 'trial'`,
};

type Row = Record<string, any>;
function flags(r: Row): Array<{ code: string; label: string }> {
  const f: Array<{ code: string; label: string }> = [];
  if (r.failed_24h >= RISK.failed24h) f.push({ code: 'failed_logins', label: `${r.failed_24h} tentativas de senha/código erradas em 24 h` });
  if (r.ips_7d >= RISK.ips7d) f.push({ code: 'many_ips', label: `Entrou de ${r.ips_7d} IPs diferentes em 7 dias (conta compartilhada?)` });
  if (r.shared_ip_accounts >= RISK.sharedIp) f.push({ code: 'shared_ip', label: `Mesmo IP de ${r.shared_ip_accounts} outras contas em 30 dias (várias contas no teste grátis? pode ser IP de operadora)` });
  if (r.rejected_7d >= RISK.rejected7d) f.push({ code: 'rejected_webhooks', label: `${r.rejected_7d} webhooks recusados em 7 dias (token/assinatura inválidos)` });
  return f;
}

const present = (r: Row) => ({
  id: r.id, email: r.email, name: r.name, createdAt: r.created_at, lastSeenAt: r.last_seen_at,
  emailVerified: r.email_verified, google: r.google, twoFactor: r.two_factor,
  blocked: r.blocked_at ? { at: r.blocked_at, reason: r.blocked_reason } : null,
  org: r.org_id ? { id: r.org_id, name: r.org_name, role: r.role, planStatus: r.plan_status, planExpiresAt: r.plan_expires_at, count: r.orgs } : null,
  billing: { paidCount: r.paid_count, paidTotalMinor: r.paid_total_minor, lastPaidAt: r.last_paid_at },
  usage: { pixels: r.pixels, pixelsActive: r.pixels_active, providers: r.providers, metaConnected: r.meta_connected, sales30d: r.sales_30d, events3d: r.events_3d },
  flags: flags(r),
});

export function adminUserRoutes(app: FastifyInstance, ctx: Ctx) {
  app.get('/v1/admin/users', async (req) => {
    requirePlatformAdmin(req);
    const q = parse(z.object({
      q: z.string().trim().max(120).optional(),
      filter: z.enum(['all', 'risk', 'blocked', 'unpaid', 'paid', 'no_pixel', 'trial']).default('all'),
      page: z.coerce.number().int().min(1).max(1000).default(1),
    }), req.query);
    const term = q.q ? `%${q.q.replace(/[%_\\]/g, (c) => `\\${c}`)}%` : null;
    const where = `(${FILTERS[q.filter]}) AND ($1::text IS NULL OR email ILIKE $1 OR name ILIKE $1 OR org_name ILIKE $1)`;
    const [rows, counts] = await Promise.all([
      ctx.db.query(`WITH b AS (${BASE}) SELECT * FROM b WHERE ${where} ORDER BY ${q.filter === 'risk' ? 'failed_24h DESC, shared_ip_accounts DESC,' : ''} created_at DESC LIMIT 50 OFFSET $2`, [term, (q.page - 1) * 50]),
      ctx.db.query(`WITH b AS (${BASE}) SELECT count(*)::int AS total, count(*) FILTER (WHERE ${RISK_SQL})::int AS risk,
              count(*) FILTER (WHERE blocked_at IS NOT NULL)::int AS blocked, count(*) FILTER (WHERE paid_count > 0)::int AS paid,
              count(*) FILTER (WHERE pixels = 0)::int AS no_pixel FROM b WHERE ($1::text IS NULL OR email ILIKE $1 OR name ILIKE $1 OR org_name ILIKE $1)`, [term]),
    ]);
    return jsonSafe({ users: rows.rows.map(present), counts: counts.rows[0], page: q.page, pageSize: 50 });
  });

  app.get('/v1/admin/users/:id', async (req) => {
    requirePlatformAdmin(req);
    const { id } = parse(z.object({ id: z.string().uuid() }), req.params);
    const r = await ctx.db.query(`WITH b AS (${BASE}) SELECT * FROM b WHERE id = $1`, [id]);
    if (!r.rows[0]) throw notFound('Usuário não encontrado.');
    const [sessions, activity, orgs] = await Promise.all([
      ctx.db.query(
        `SELECT host(ip) AS ip, user_agent, created_at, last_seen_at, (revoked_at IS NULL AND expires_at > now()) AS active
           FROM sessions WHERE user_id = $1 ORDER BY last_seen_at DESC LIMIT 15`, [id]),
      // só o tipo da ação, quando e de onde — sem detalhes (que podem ter nomes de pixel/campanha)
      ctx.db.query(`SELECT action, created_at, host(ip) AS ip FROM audit_log WHERE user_id = $1 ORDER BY id DESC LIMIT 60`, [id]),
      ctx.db.query(
        `SELECT o.id, o.name, m.role, o.plan_status, o.plan_expires_at FROM memberships m JOIN organizations o ON o.id = m.org_id
          WHERE m.user_id = $1 ORDER BY m.created_at`, [id]),
    ]);
    return jsonSafe({
      user: present(r.rows[0]),
      orgs: orgs.rows,
      sessions: sessions.rows.map((s) => ({ ip: maskIp(s.ip), device: s.user_agent ? String(s.user_agent).slice(0, 160) : null, createdAt: s.created_at, lastSeenAt: s.last_seen_at, active: s.active })),
      activity: activity.rows.map((a) => ({ action: a.action, at: a.created_at, ip: maskIp(a.ip) })),
    });
  });

  app.post('/v1/admin/users/:id/block', async (req) => {
    const admin = requirePlatformAdmin(req);
    const { id } = parse(z.object({ id: z.string().uuid() }), req.params);
    const b = parse(z.object({ blocked: z.boolean(), reason: z.string().trim().max(200).optional() }), req.body);
    const u = await ctx.db.query<{ email: string; email_verified_at: Date | null }>('SELECT email, email_verified_at FROM users WHERE id = $1', [id]);
    if (!u.rows[0]) throw notFound('Usuário não encontrado.');
    if (id === admin.user.id) throw badRequest('Você não pode bloquear a própria conta.');
    if (isPlatformAdminEmail(ctx, u.rows[0].email, true)) throw badRequest('Não é possível bloquear um administrador da plataforma.');
    if (b.blocked) {
      await ctx.db.query('UPDATE users SET blocked_at = COALESCE(blocked_at, now()), blocked_reason = $2, updated_at = now() WHERE id = $1', [id, b.reason || null]);
      await ctx.db.query('UPDATE sessions SET revoked_at = now() WHERE user_id = $1 AND revoked_at IS NULL', [id]); // sai na hora de todos os aparelhos
    } else {
      await ctx.db.query('UPDATE users SET blocked_at = NULL, blocked_reason = NULL, updated_at = now() WHERE id = $1', [id]);
    }
    await ctx.db.query(`INSERT INTO audit_log(user_id, action, target, metadata) VALUES ($1, $2, $3, $4)`,
      [admin.user.id, b.blocked ? 'admin.user_blocked' : 'admin.user_unblocked', id, JSON.stringify(b.reason ? { reason: b.reason } : {})]);
    return { ok: true, blocked: b.blocked };
  });
}
