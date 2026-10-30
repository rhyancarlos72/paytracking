import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { Ctx } from '../context.js';
import { badRequest, notFound } from '../lib/errors.js';
import { jsonSafe, parse, requirePlatformAdmin } from '../lib/http.js';
import { audit } from '../orgs/routes.js';

/** Administração da plataforma (antes: e-mail fixo no código; agora: PLATFORM_ADMIN_EMAILS / users.is_platform_admin). */
export function adminRoutes(app: FastifyInstance, ctx: Ctx) {
  /** Canal de e-mail ativo e envio de teste para o próprio admin (confere SMTP/Resend). */
  app.post('/v1/admin/test-email', async (req) => {
    const a = requirePlatformAdmin(req);
    try {
      await ctx.mailer.send({
        to: a.user.email,
        subject: 'Teste de e-mail — PayTracking',
        text: `Este é um e-mail de teste.\n\nSe chegou, a recuperação de senha, a confirmação de e-mail e os convites estão funcionando.\n\nPainel: ${ctx.config.APP_URL}`,
      });
      return { ok: true, channel: ctx.mailer.kind, to: a.user.email };
    } catch (e) {
      return { ok: false, channel: ctx.mailer.kind, error: (e as Error).message.slice(0, 300) };
    }
  });

  app.get('/v1/admin/overview', async (req) => {
    requirePlatformAdmin(req);
    const totals = await ctx.db.query(
      `SELECT count(*)::int AS orgs,
              count(*) FILTER (WHERE plan_status = 'active' AND plan_expires_at > now())::int AS active,
              count(*) FILTER (WHERE plan_status = 'trial' AND plan_expires_at > now())::int AS trial,
              count(*) FILTER (WHERE plan_status <> 'exempt' AND (plan_expires_at IS NULL OR plan_expires_at <= now()))::int AS expired,
              count(*) FILTER (WHERE plan_status = 'exempt')::int AS exempt
         FROM organizations`,
    );
    const mrr = await ctx.db.query(
      `SELECT COALESCE(sum(amount_minor), 0)::bigint AS minor FROM billing_charges WHERE status = 'paid' AND paid_at > now() - interval '30 days'`,
    );
    return jsonSafe({ ...totals.rows[0], revenueLast30dMinor: mrr.rows[0]?.minor ?? 0n });
  });

  app.get('/v1/admin/orgs', async (req) => {
    requirePlatformAdmin(req);
    const q = parse(z.object({ q: z.string().max(120).optional(), status: z.enum(['all', 'trial', 'active', 'expired', 'exempt']).default('all') }), req.query);
    const r = await ctx.db.query(
      `SELECT o.id, o.name, o.plan_status, o.plan_expires_at, o.created_at,
              (SELECT u.email FROM memberships m JOIN users u ON u.id = m.user_id WHERE m.org_id = o.id AND m.role = 'owner' ORDER BY m.created_at LIMIT 1) AS owner_email,
              (SELECT count(*) FROM pixels p WHERE p.org_id = o.id)::int AS pixels,
              (SELECT count(*) FROM payments p WHERE p.org_id = o.id AND p.status = 'approved' AND p.approved_at > now() - interval '30 days')::int AS sales_30d,
              (SELECT max(paid_at) FROM billing_charges b WHERE b.org_id = o.id AND b.status = 'paid') AS last_paid_at
         FROM organizations o
        WHERE ($1::text IS NULL OR o.name ILIKE $1 OR EXISTS (SELECT 1 FROM memberships m JOIN users u ON u.id = m.user_id WHERE m.org_id = o.id AND u.email ILIKE $1))
          AND ($2 = 'all'
               OR ($2 = 'exempt' AND o.plan_status = 'exempt')
               OR ($2 = 'expired' AND o.plan_status <> 'exempt' AND (o.plan_expires_at IS NULL OR o.plan_expires_at <= now()))
               OR ($2 IN ('trial', 'active') AND o.plan_status = $2 AND o.plan_expires_at > now()))
        ORDER BY o.created_at DESC LIMIT 500`,
      [q.q ? `%${q.q}%` : null, q.status],
    );
    return { orgs: r.rows };
  });

  app.post('/v1/admin/orgs/:id/plan', async (req) => {
    const a = requirePlatformAdmin(req);
    const { id } = parse(z.object({ id: z.string().uuid() }), req.params);
    const b = parse(z.object({ action: z.enum(['extend_trial', 'activate', 'expire', 'exempt']), days: z.coerce.number().int().min(1).max(3650).default(30) }), req.body);
    if (b.action === 'expire' && id === a.org.id) throw badRequest('Você não pode expirar a própria organização.');
    const sql: Record<typeof b.action, string> = {
      extend_trial: `UPDATE organizations SET plan_status = 'trial', plan_expires_at = GREATEST(COALESCE(plan_expires_at, now()), now()) + make_interval(days => $2) WHERE id = $1`,
      activate: `UPDATE organizations SET plan_status = 'active', plan_expires_at = now() + make_interval(days => $2) WHERE id = $1`,
      expire: `UPDATE organizations SET plan_status = 'expired', plan_expires_at = now() WHERE id = $1 AND $2::int IS NOT NULL`,
      exempt: `UPDATE organizations SET plan_status = 'exempt', plan_expires_at = NULL WHERE id = $1 AND $2::int IS NOT NULL`,
    };
    const r = await ctx.db.query(sql[b.action], [id, b.days]);
    if (!r.rowCount) throw notFound('Organização não encontrada.');
    await audit(ctx, id, a.user.id, `admin.plan_${b.action}`, id, { days: b.days });
    return { ok: true };
  });

  app.delete('/v1/admin/orgs/:id', async (req) => {
    const a = requirePlatformAdmin(req);
    const { id } = parse(z.object({ id: z.string().uuid() }), req.params);
    const { confirm } = parse(z.object({ confirm: z.literal('EXCLUIR') }), req.body);
    if (id === a.org.id) throw badRequest('Você não pode excluir a própria organização.');
    void confirm;
    const r = await ctx.db.query('DELETE FROM organizations WHERE id = $1', [id]);
    if (!r.rowCount) throw notFound('Organização não encontrada.');
    await audit(ctx, null, a.user.id, 'admin.org_deleted', id);
    return { ok: true };
  });
}
