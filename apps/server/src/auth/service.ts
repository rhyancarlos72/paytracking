import bcrypt from 'bcryptjs';
import { tx } from '@pt/db';
import type { Ctx } from '../context.js';
import { randomToken, sha256Hex } from '../lib/crypto.js';
import { badRequest, conflict } from '../lib/errors.js';

export type Role = 'owner' | 'admin' | 'analyst' | 'viewer';
export const ROLE_RANK: Record<Role, number> = { viewer: 0, analyst: 1, admin: 2, owner: 3 };

export interface OrgSummary {
  id: string;
  name: string;
  reporting_currency: string;
  timezone: string;
  plan_status: 'trial' | 'active' | 'expired' | 'exempt';
  plan_expires_at: Date | null;
  goal_daily_minor: bigint;
  goal_monthly_minor: bigint;
}

export interface AuthContext {
  sessionId: string;
  user: { id: string; email: string; name: string | null; isPlatformAdmin: boolean; emailVerified: boolean; hideEmail: boolean; hideNames: boolean; twoFactorEnabled: boolean };
  org: OrgSummary;
  role: Role;
}

const BCRYPT_COST = 12;

export function validatePassword(pw: string): void {
  if (pw.length < 10 || pw.length > 200) throw badRequest('A senha deve ter entre 10 e 200 caracteres.');
  if (!/[A-Z]/.test(pw) || !/[a-z]/.test(pw) || !/\d/.test(pw)) {
    throw badRequest('A senha precisa conter letra maiúscula, minúscula e número.');
  }
}

export const hashPassword = (pw: string) => bcrypt.hash(pw, BCRYPT_COST);

/** Aceita hashes bcrypt do PHP ($2y$) — usuários migrados não precisam trocar a senha. */
export async function verifyPassword(pw: string, hash: string): Promise<boolean> {
  try {
    return await bcrypt.compare(pw, hash);
  } catch {
    return false;
  }
}

/** Hash real usado para equalizar o tempo de resposta quando o e-mail não existe. */
let dummyHash: Promise<string> | null = null;
const getDummyHash = () => (dummyHash ??= bcrypt.hash('paytracking-timing-equalizer', BCRYPT_COST));

export function planState(org: Pick<OrgSummary, 'plan_status' | 'plan_expires_at'>, now: Date) {
  if (org.plan_status === 'exempt') return { status: 'exempt' as const, daysLeft: null, blocked: false };
  const exp = org.plan_expires_at;
  const expired = !exp || exp.getTime() < now.getTime();
  const daysLeft = exp ? Math.max(0, Math.ceil((exp.getTime() - now.getTime()) / 86_400_000)) : 0;
  return { status: expired ? ('expired' as const) : org.plan_status, daysLeft, blocked: expired };
}

export async function createUserWithOrg(
  ctx: Ctx,
  input: { email: string; password?: string; name?: string | null; orgName?: string | null; googleSub?: string },
): Promise<{ userId: string; orgId: string }> {
  // conta criada pelo Google nasce sem senha conhecida (hash de um valor aleatório descartado);
  // se quiser, a pessoa cria uma senha depois em "Esqueci a senha"
  if (input.password === undefined && !input.googleSub) throw badRequest('Informe uma senha.');
  if (input.password !== undefined) validatePassword(input.password);
  const email = input.email.trim().toLowerCase();
  const hash = await hashPassword(input.password ?? randomToken(32));
  const trialEnd = new Date(ctx.now().getTime() + ctx.config.PLAN_TRIAL_DAYS * 86_400_000);
  return tx(ctx.db, async (c) => {
    const exists = await c.query('SELECT 1 FROM users WHERE email = $1', [email]);
    if (exists.rowCount) throw conflict('Já existe uma conta com este e-mail. Faça login.');
    const isAdmin = ctx.config.platformAdmins.has(email);
    const u = await c.query<{ id: string }>(
      `INSERT INTO users(email, password_hash, name, is_platform_admin, google_sub, email_verified_at)
       VALUES ($1, $2, $3, $4, $5, CASE WHEN $5::text IS NULL THEN NULL ELSE now() END) RETURNING id`,
      [email, hash, input.name?.trim() || null, isAdmin, input.googleSub ?? null],
    );
    const userId = u.rows[0]!.id;
    const o = await c.query<{ id: string }>(
      `INSERT INTO organizations(name, plan_status, plan_expires_at, plan_started_at) VALUES ($1, $2, $3, now()) RETURNING id`,
      [input.orgName?.trim() || input.name?.trim() || email.split('@')[0], isAdmin ? 'exempt' : 'trial', isAdmin ? null : trialEnd],
    );
    const orgId = o.rows[0]!.id;
    await c.query(`INSERT INTO memberships(org_id, user_id, role) VALUES ($1, $2, 'owner')`, [orgId, userId]);
    await c.query(`INSERT INTO audit_log(org_id, user_id, action) VALUES ($1, $2, 'account.created')`, [orgId, userId]);
    return { userId, orgId };
  });
}

export async function authenticate(ctx: Ctx, email: string, password: string): Promise<{ id: string } | null> {
  const r = await ctx.db.query<{ id: string; password_hash: string }>(
    'SELECT id, password_hash FROM users WHERE email = $1',
    [email.trim().toLowerCase()],
  );
  const row = r.rows[0];
  const ok = await verifyPassword(password, row?.password_hash ?? (await getDummyHash()));
  if (!row || !ok) return null;
  // Rehash transparente de hashes legados ($2y$ / custo menor).
  if (!row.password_hash.startsWith(`$2a$${BCRYPT_COST}$`) && !row.password_hash.startsWith(`$2b$${BCRYPT_COST}$`)) {
    await ctx.db.query('UPDATE users SET password_hash = $1, updated_at = now() WHERE id = $2', [await hashPassword(password), row.id]);
  }
  return { id: row.id };
}

export async function createSession(ctx: Ctx, userId: string, meta: { ip?: string; ua?: string; orgId?: string | null }) {
  const token = randomToken(32);
  const expires = new Date(ctx.now().getTime() + ctx.config.SESSION_TTL_DAYS * 86_400_000);
  await ctx.db.query(
    'INSERT INTO sessions(id, user_id, active_org_id, ip, user_agent, expires_at) VALUES ($1, $2, $3, $4, $5, $6)',
    [sha256Hex(token), userId, meta.orgId ?? null, meta.ip ?? null, meta.ua?.slice(0, 300) ?? null, expires],
  );
  return { token, expires };
}

export async function revokeSessions(ctx: Ctx, userId: string, exceptSessionId?: string): Promise<number> {
  const r = await ctx.db.query(
    'UPDATE sessions SET revoked_at = now() WHERE user_id = $1 AND revoked_at IS NULL AND ($2::text IS NULL OR id <> $2)',
    [userId, exceptSessionId ?? null],
  );
  return r.rowCount ?? 0;
}

/** Resolve a sessão do cookie, renova o prazo (expiração deslizante) e carrega org + papel. */
export async function resolveSession(ctx: Ctx, token: string): Promise<AuthContext | null> {
  const id = sha256Hex(token);
  const r = await ctx.db.query(
    `SELECT s.id AS session_id, s.active_org_id, s.expires_at, s.last_seen_at,
            u.id AS user_id, u.email, u.name, u.is_platform_admin, u.email_verified_at, u.hide_email, u.hide_names, u.totp_enabled_at
       FROM sessions s JOIN users u ON u.id = s.user_id
      WHERE s.id = $1 AND s.revoked_at IS NULL AND s.expires_at > now()`,
    [id],
  );
  const s = r.rows[0];
  if (!s) return null;
  const m = await ctx.db.query(
    `SELECT m.role, o.id, o.name, o.reporting_currency, o.timezone, o.plan_status, o.plan_expires_at,
            o.goal_daily_minor, o.goal_monthly_minor
       FROM memberships m JOIN organizations o ON o.id = m.org_id
      WHERE m.user_id = $1
      ORDER BY (o.id = $2) DESC, m.created_at ASC LIMIT 1`,
    [s.user_id, s.active_org_id],
  );
  const org = m.rows[0];
  if (!org) return null;
  if (Date.now() - new Date(s.last_seen_at).getTime() > 5 * 60_000) {
    await ctx.db.query(
      'UPDATE sessions SET last_seen_at = now(), expires_at = now() + make_interval(days => $2) WHERE id = $1',
      [id, ctx.config.SESSION_TTL_DAYS],
    );
  }
  return {
    sessionId: s.session_id,
    user: {
      id: s.user_id, email: s.email, name: s.name, isPlatformAdmin: s.is_platform_admin,
      emailVerified: !!s.email_verified_at, hideEmail: s.hide_email, hideNames: s.hide_names, twoFactorEnabled: !!s.totp_enabled_at,
    },
    role: org.role,
    org: {
      id: org.id, name: org.name, reporting_currency: org.reporting_currency.trim(), timezone: org.timezone,
      plan_status: org.plan_status, plan_expires_at: org.plan_expires_at,
      goal_daily_minor: org.goal_daily_minor, goal_monthly_minor: org.goal_monthly_minor,
    },
  };
}

export async function issueToken(ctx: Ctx, userId: string, kind: 'password_reset' | 'email_verify', ttlMin: number): Promise<string> {
  const token = randomToken(32);
  await ctx.db.query(
    `INSERT INTO auth_tokens(user_id, kind, token_hash, expires_at) VALUES ($1, $2, $3, now() + make_interval(mins => $4))`,
    [userId, kind, sha256Hex(token), ttlMin],
  );
  return token;
}

/** Consome um token de uso único; retorna o user_id ou null. */
export async function consumeToken(ctx: Ctx, token: string, kind: 'password_reset' | 'email_verify'): Promise<string | null> {
  const r = await ctx.db.query<{ user_id: string }>(
    `UPDATE auth_tokens SET used_at = now()
      WHERE token_hash = $1 AND kind = $2 AND used_at IS NULL AND expires_at > now()
      RETURNING user_id`,
    [sha256Hex(token), kind],
  );
  return r.rows[0]?.user_id ?? null;
}
