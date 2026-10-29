import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { tx } from '@pt/db';
import { parseAmount } from '@pt/domain';
import type { Ctx } from '../context.js';
import { randomToken, sha256Hex } from '../lib/crypto.js';
import { badRequest, conflict, forbidden, notFound } from '../lib/errors.js';
import { auth, parse, requireRole } from '../lib/http.js';
import { hit } from '../lib/rate-limit.js';

const TIMEZONES = new Set(Intl.supportedValuesOf('timeZone'));

export async function audit(ctx: Ctx, orgId: string | null, userId: string | null, action: string, target?: string, metadata: object = {}) {
  await ctx.db.query('INSERT INTO audit_log(org_id, user_id, action, target, metadata) VALUES ($1, $2, $3, $4, $5)', [
    orgId, userId, action, target ?? null, JSON.stringify(metadata),
  ]);
}

export function orgRoutes(app: FastifyInstance, ctx: Ctx) {
  app.patch('/v1/org', async (req) => {
    const a = requireRole(req, 'admin');
    const body = parse(z.object({
      name: z.string().trim().min(1).max(120).optional(),
      reportingCurrency: z.string().regex(/^[A-Z]{3}$/).optional(),
      timezone: z.string().refine((t) => TIMEZONES.has(t), 'Fuso horário inválido').optional(),
      goalDaily: z.string().max(30).optional(),
      goalMonthly: z.string().max(30).optional(),
    }), req.body);
    const cur = body.reportingCurrency ?? a.org.reporting_currency;
    const goal = (v?: string) => (v === undefined ? null : (parseAmount(v === '' ? '0' : v, cur, 'major') ?? null));
    const gd = goal(body.goalDaily);
    const gm = goal(body.goalMonthly);
    if ((body.goalDaily !== undefined && gd === null) || (body.goalMonthly !== undefined && gm === null)) throw badRequest('Meta inválida.');
    await ctx.db.query(
      `UPDATE organizations SET name = COALESCE($2, name), reporting_currency = COALESCE($3, reporting_currency),
              timezone = COALESCE($4, timezone), goal_daily_minor = COALESCE($5, goal_daily_minor),
              goal_monthly_minor = COALESCE($6, goal_monthly_minor), updated_at = now() WHERE id = $1`,
      [a.org.id, body.name ?? null, body.reportingCurrency ?? null, body.timezone ?? null, gd, gm],
    );
    await audit(ctx, a.org.id, a.user.id, 'org.updated', a.org.id, { fields: Object.keys(body) });
    return { ok: true };
  });

  app.get('/v1/org/members', async (req) => {
    const a = requireRole(req, 'viewer');
    const members = await ctx.db.query(
      `SELECT u.id, u.email, u.name, m.role, m.created_at FROM memberships m JOIN users u ON u.id = m.user_id
        WHERE m.org_id = $1 ORDER BY m.created_at`,
      [a.org.id],
    );
    const invites = ROLE_OK(a.role) ? await ctx.db.query(
      `SELECT id, email, role, expires_at, created_at FROM invitations
        WHERE org_id = $1 AND accepted_at IS NULL AND expires_at > now() ORDER BY created_at DESC`,
      [a.org.id],
    ) : { rows: [] };
    return { members: members.rows, invitations: invites.rows };
  });

  app.post('/v1/org/invitations', async (req) => {
    const a = requireRole(req, 'owner');
    await hit(ctx.db, `invite:org:${a.org.id}`, 30, 3600);
    const body = parse(z.object({ email: z.string().trim().toLowerCase().email(), role: z.enum(['admin', 'analyst', 'viewer']) }), req.body);
    const token = randomToken(32);
    await ctx.db.query(
      `INSERT INTO invitations(org_id, email, role, token_hash, invited_by, expires_at) VALUES ($1, $2, $3, $4, $5, now() + interval '7 days')`,
      [a.org.id, body.email, body.role, sha256Hex(token), a.user.id],
    );
    await ctx.mailer.send({
      to: body.email,
      subject: `Convite para ${a.org.name} — PayTracking`,
      text: `Você foi convidado(a) para a organização "${a.org.name}".\nAceite em: ${ctx.config.APP_URL}/convite?token=${token}\n\nO convite expira em 7 dias.`,
    });
    await audit(ctx, a.org.id, a.user.id, 'member.invited', body.email, { role: body.role });
    return { ok: true };
  });

  app.delete('/v1/org/invitations/:id', async (req) => {
    const a = requireRole(req, 'owner');
    const { id } = parse(z.object({ id: z.string().uuid() }), req.params);
    await ctx.db.query('DELETE FROM invitations WHERE id = $1 AND org_id = $2', [id, a.org.id]);
    return { ok: true };
  });

  /** Aceitar convite: o e-mail da conta logada precisa ser o convidado. */
  app.post('/v1/invitations/accept', async (req) => {
    const a = auth(req);
    const { token } = parse(z.object({ token: z.string().min(20) }), req.body);
    return tx(ctx.db, async (c) => {
      const r = await c.query(
        `SELECT id, org_id, email, role FROM invitations
          WHERE token_hash = $1 AND accepted_at IS NULL AND expires_at > now() FOR UPDATE`,
        [sha256Hex(token)],
      );
      const inv = r.rows[0];
      if (!inv) throw badRequest('Convite inválido ou expirado.');
      if (String(inv.email).toLowerCase() !== a.user.email.toLowerCase()) throw forbidden('Este convite foi enviado para outro e-mail.');
      await c.query(
        `INSERT INTO memberships(org_id, user_id, role) VALUES ($1, $2, $3) ON CONFLICT (org_id, user_id) DO NOTHING`,
        [inv.org_id, a.user.id, inv.role],
      );
      await c.query('UPDATE invitations SET accepted_at = now() WHERE id = $1', [inv.id]);
      await c.query('UPDATE sessions SET active_org_id = $1 WHERE id = $2', [inv.org_id, a.sessionId]);
      return { ok: true, orgId: inv.org_id };
    });
  });

  app.patch('/v1/org/members/:userId', async (req) => {
    const a = requireRole(req, 'owner');
    const { userId } = parse(z.object({ userId: z.string().uuid() }), req.params);
    const { role } = parse(z.object({ role: z.enum(['owner', 'admin', 'analyst', 'viewer']) }), req.body);
    if (userId === a.user.id) throw badRequest('Você não pode alterar o próprio papel.');
    const r = await ctx.db.query('UPDATE memberships SET role = $3 WHERE org_id = $1 AND user_id = $2', [a.org.id, userId, role]);
    if (!r.rowCount) throw notFound('Membro não encontrado.');
    await audit(ctx, a.org.id, a.user.id, 'member.role_changed', userId, { role });
    return { ok: true };
  });

  app.delete('/v1/org/members/:userId', async (req) => {
    const a = requireRole(req, 'owner');
    const { userId } = parse(z.object({ userId: z.string().uuid() }), req.params);
    if (userId === a.user.id) throw badRequest('Você não pode remover a si mesmo.');
    const owners = await ctx.db.query(`SELECT count(*)::int AS n FROM memberships WHERE org_id = $1 AND role = 'owner' AND user_id <> $2`, [a.org.id, userId]);
    if ((owners.rows[0]?.n ?? 0) < 1) throw conflict('A organização precisa de pelo menos um proprietário.');
    await ctx.db.query('DELETE FROM memberships WHERE org_id = $1 AND user_id = $2', [a.org.id, userId]);
    await ctx.db.query('UPDATE sessions SET active_org_id = NULL WHERE user_id = $1 AND active_org_id = $2', [userId, a.org.id]);
    await audit(ctx, a.org.id, a.user.id, 'member.removed', userId);
    return { ok: true };
  });

  app.get('/v1/org/audit', async (req) => {
    const a = requireRole(req, 'admin');
    const r = await ctx.db.query(
      `SELECT l.action, l.target, l.metadata, l.created_at, u.email AS user_email
         FROM audit_log l LEFT JOIN users u ON u.id = l.user_id WHERE l.org_id = $1 ORDER BY l.id DESC LIMIT 200`,
      [a.org.id],
    );
    return { entries: r.rows };
  });
}

const ROLE_OK = (r: string) => r === 'owner' || r === 'admin';
