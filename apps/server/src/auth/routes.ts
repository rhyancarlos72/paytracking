import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { Ctx } from '../context.js';
import { hit, clear } from '../lib/rate-limit.js';
import { badRequest, unauthorized } from '../lib/errors.js';
import { auth, clearSessionCookie, clientIp, parse, setSessionCookie } from '../lib/http.js';
import {
  authenticate, consumeToken, createSession, createUserWithOrg, hashPassword, issueToken, planState,
  revokeSessions, validatePassword, verifyPassword,
} from './service.js';
import { hasTwoFactor, issueChallenge, securityAlert } from './two-factor.js';

const email = z.string().trim().toLowerCase().email('E-mail inválido').max(190);

export function authRoutes(app: FastifyInstance, ctx: Ctx) {
  const secure = ctx.config.isProd;

  async function sendVerification(userId: string, to: string) {
    const token = await issueToken(ctx, userId, 'email_verify', 60 * 24 * 3);
    await ctx.mailer.send({
      to,
      subject: 'Bem-vindo! Confirme seu e-mail — PayTracking',
      text: `Sua conta foi criada e o teste grátis de ${ctx.config.PLAN_TRIAL_DAYS} dias já começou.\n\nFalta só confirmar que este e-mail é seu: ${ctx.config.APP_URL}/verificar-email?token=${token}\n\nO link expira em 3 dias. Com o e-mail confirmado, você consegue recuperar o acesso se esquecer a senha.`,
    });
  }

  app.post('/v1/auth/signup', async (req, reply) => {
    await hit(ctx.db, `signup:ip:${clientIp(req)}`, 10, 3600);
    const body = parse(z.object({
      email, password: z.string(), name: z.string().trim().max(120).optional(), orgName: z.string().trim().max(120).optional(),
    }), req.body);
    const { userId, orgId } = await createUserWithOrg(ctx, body);
    const s = await createSession(ctx, userId, { ip: clientIp(req), ua: req.headers['user-agent'], orgId });
    setSessionCookie(reply, s.token, s.expires, secure);
    await sendVerification(userId, body.email).catch((e) => ctx.log.error({ err: String(e) }, 'falha ao enviar verificação'));
    return reply.code(201).send({ ok: true });
  });

  app.post('/v1/auth/login', async (req, reply) => {
    const body = parse(z.object({ email, password: z.string().min(1).max(200) }), req.body);
    const ipBucket = `login:ip:${clientIp(req)}`;
    const emailBucket = `login:email:${body.email}`;
    await hit(ctx.db, ipBucket, 30, 900);
    await hit(ctx.db, emailBucket, 8, 900);
    const user = await authenticate(ctx, body.email, body.password);
    if (!user) throw unauthorized('E-mail ou senha incorretos.');
    await clear(ctx.db, emailBucket);
    // senha certa + verificação em duas etapas ativa: ainda sem sessão, pede o código do app
    if (await hasTwoFactor(ctx, user.id)) return { ok: false, twoFactorRequired: true, challenge: issueChallenge(ctx, user.id) };
    const s = await createSession(ctx, user.id, { ip: clientIp(req), ua: req.headers['user-agent'] });
    setSessionCookie(reply, s.token, s.expires, secure);
    return { ok: true };
  });

  app.post('/v1/auth/logout', async (req, reply) => {
    if (req.auth) await ctx.db.query('UPDATE sessions SET revoked_at = now() WHERE id = $1', [req.auth.sessionId]);
    clearSessionCookie(reply, secure);
    return { ok: true };
  });

  app.get('/v1/auth/me', async (req) => {
    const a = auth(req);
    const orgs = await ctx.db.query(
      `SELECT o.id, o.name, m.role FROM memberships m JOIN organizations o ON o.id = m.org_id WHERE m.user_id = $1 ORDER BY o.name`,
      [a.user.id],
    );
    const plan = planState(a.org, ctx.now());
    return {
      user: a.user,
      role: a.role,
      org: {
        id: a.org.id, name: a.org.name, reportingCurrency: a.org.reporting_currency, timezone: a.org.timezone,
        goalDailyMinor: a.org.goal_daily_minor.toString(), goalMonthlyMinor: a.org.goal_monthly_minor.toString(),
      },
      plan: { ...plan, expiresAt: a.org.plan_expires_at, priceMinor: ctx.config.PLAN_PRICE_MINOR },
      orgs: orgs.rows,
    };
  });

  app.post('/v1/auth/switch-org', async (req) => {
    const a = auth(req);
    const { orgId } = parse(z.object({ orgId: z.string().uuid() }), req.body);
    const m = await ctx.db.query('SELECT 1 FROM memberships WHERE org_id = $1 AND user_id = $2', [orgId, a.user.id]);
    if (!m.rowCount) throw badRequest('Organização não encontrada.');
    await ctx.db.query('UPDATE sessions SET active_org_id = $1 WHERE id = $2', [orgId, a.sessionId]);
    return { ok: true };
  });

  app.post('/v1/auth/forgot-password', async (req) => {
    await hit(ctx.db, `forgot:ip:${clientIp(req)}`, 10, 3600);
    const body = parse(z.object({ email }), req.body);
    const u = await ctx.db.query<{ id: string }>('SELECT id FROM users WHERE email = $1', [body.email]);
    const row = u.rows[0];
    if (row) {
      const token = await issueToken(ctx, row.id, 'password_reset', 60);
      await ctx.mailer.send({
        to: body.email,
        subject: 'Redefinição de senha — PayTracking',
        text: `Recebemos um pedido para criar uma nova senha na sua conta.\n\nPara escolher a nova senha: ${ctx.config.APP_URL}/redefinir-senha?token=${token}\n\nO link vale por 1 hora e funciona uma única vez. Se não foi você, ignore este e-mail: sua senha atual continua valendo.`,
      });
    }
    // Resposta idêntica exista ou não a conta (evita enumeração de e-mails).
    return { ok: true };
  });

  app.post('/v1/auth/reset-password', async (req) => {
    await hit(ctx.db, `reset:ip:${clientIp(req)}`, 20, 3600);
    const body = parse(z.object({ token: z.string().min(20), password: z.string() }), req.body);
    validatePassword(body.password);
    const userId = await consumeToken(ctx, body.token, 'password_reset');
    if (!userId) throw badRequest('Link inválido ou expirado. Solicite um novo.');
    await ctx.db.query('UPDATE users SET password_hash = $1, updated_at = now() WHERE id = $2', [await hashPassword(body.password), userId]);
    await revokeSessions(ctx, userId);
    await ctx.db.query(`INSERT INTO audit_log(user_id, action) VALUES ($1, 'auth.password_reset')`, [userId]);
    const to = await ctx.db.query<{ email: string }>('SELECT email FROM users WHERE id = $1', [userId]);
    if (to.rows[0]) await securityAlert(ctx, req, to.rows[0].email, 'Sua senha foi redefinida');
    return { ok: true };
  });

  app.post('/v1/auth/verify-email', async (req) => {
    const body = parse(z.object({ token: z.string().min(20) }), req.body);
    const userId = await consumeToken(ctx, body.token, 'email_verify');
    if (!userId) throw badRequest('Link inválido ou expirado.');
    await ctx.db.query('UPDATE users SET email_verified_at = now() WHERE id = $1', [userId]);
    return { ok: true };
  });

  app.post('/v1/auth/resend-verification', async (req) => {
    const a = auth(req);
    await hit(ctx.db, `verify:user:${a.user.id}`, 5, 3600);
    if (!a.user.emailVerified) await sendVerification(a.user.id, a.user.email);
    return { ok: true };
  });

  app.post('/v1/auth/change-password', async (req) => {
    const a = auth(req);
    await hit(ctx.db, `chpw:user:${a.user.id}`, 10, 900);
    const body = parse(z.object({ currentPassword: z.string().min(1), newPassword: z.string() }), req.body);
    validatePassword(body.newPassword);
    if (body.newPassword === body.currentPassword) throw badRequest('A nova senha deve ser diferente da atual.');
    const r = await ctx.db.query<{ password_hash: string }>('SELECT password_hash FROM users WHERE id = $1', [a.user.id]);
    if (!(await verifyPassword(body.currentPassword, r.rows[0]?.password_hash ?? ''))) throw badRequest('Senha atual incorreta.');
    await ctx.db.query('UPDATE users SET password_hash = $1, updated_at = now() WHERE id = $2', [await hashPassword(body.newPassword), a.user.id]);
    const revoked = await revokeSessions(ctx, a.user.id, a.sessionId);
    await ctx.db.query(`INSERT INTO audit_log(org_id, user_id, action) VALUES ($1, $2, 'auth.password_changed')`, [a.org.id, a.user.id]);
    await securityAlert(ctx, req, a.user.email, 'Sua senha foi alterada');
    return { ok: true, revokedSessions: revoked };
  });

  app.get('/v1/auth/sessions', async (req) => {
    const a = auth(req);
    const r = await ctx.db.query(
      `SELECT left(id, 12) AS id, host(ip) AS ip, user_agent, created_at, last_seen_at, (id = $2) AS current
         FROM sessions WHERE user_id = $1 AND revoked_at IS NULL AND expires_at > now() ORDER BY last_seen_at DESC`,
      [a.user.id, a.sessionId],
    );
    return { sessions: r.rows };
  });

  app.post('/v1/auth/sessions/revoke-others', async (req) => {
    const a = auth(req);
    return { revoked: await revokeSessions(ctx, a.user.id, a.sessionId) };
  });

  app.patch('/v1/auth/preferences', async (req) => {
    const a = auth(req);
    const body = parse(z.object({ hideEmail: z.boolean().optional(), hideNames: z.boolean().optional(), name: z.string().trim().max(120).optional() }), req.body);
    await ctx.db.query(
      'UPDATE users SET hide_email = COALESCE($2, hide_email), name = COALESCE($3, name), hide_names = COALESCE($4, hide_names), updated_at = now() WHERE id = $1',
      [a.user.id, body.hideEmail ?? null, body.name ?? null, body.hideNames ?? null],
    );
    return { ok: true };
  });
}
