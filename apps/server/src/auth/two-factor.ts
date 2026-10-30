import { randomBytes } from 'node:crypto';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import type { Ctx } from '../context.js';
import { sha256Hex } from '../lib/crypto.js';
import { badRequest, unauthorized } from '../lib/errors.js';
import { auth, clientIp, parse, setSessionCookie } from '../lib/http.js';
import { hit, clear } from '../lib/rate-limit.js';
import { createSession, revokeSessions, verifyPassword } from './service.js';
import { generateRecoveryCodes, generateSecret, normalizeRecoveryCode, otpauthUrl, verifyTotp } from './totp.js';

const CHALLENGE_TTL_MS = 5 * 60_000;
const code = z.string().trim().regex(/^\d{3}\s?\d{3}$/, 'Código de 6 dígitos inválido.');

interface TfaRow {
  email: string;
  totp_secret_enc: string | null;
  totp_pending_enc: string | null;
  totp_enabled_at: Date | null;
  totp_last_counter: string | null;
  totp_recovery_hashes: string[];
}

async function loadUser(ctx: Ctx, userId: string): Promise<TfaRow> {
  const r = await ctx.db.query<TfaRow>(
    `SELECT email, totp_secret_enc, totp_pending_enc, totp_enabled_at, totp_last_counter::text, totp_recovery_hashes
       FROM users WHERE id = $1`,
    [userId],
  );
  if (!r.rows[0]) throw unauthorized();
  return r.rows[0];
}

/**
 * Confere o código do app autenticador e grava o passo usado (anti-replay). O UPDATE é condicional:
 * dois logins simultâneos com o mesmo código não passam os dois.
 */
async function checkTotp(ctx: Ctx, userId: string, row: TfaRow, input: string): Promise<boolean> {
  if (!row.totp_secret_enc) return false;
  const last = row.totp_last_counter === null ? null : Number(row.totp_last_counter);
  const counter = verifyTotp(ctx.box.decrypt(row.totp_secret_enc), input, ctx.now(), last);
  if (counter === null) return false;
  const u = await ctx.db.query(
    'UPDATE users SET totp_last_counter = $2 WHERE id = $1 AND (totp_last_counter IS NULL OR totp_last_counter < $2)',
    [userId, counter],
  );
  return (u.rowCount ?? 0) > 0;
}

/** Consome um código de recuperação (uso único). */
async function useRecoveryCode(ctx: Ctx, userId: string, input: string): Promise<boolean> {
  const norm = normalizeRecoveryCode(input);
  if (norm.length !== 8) return false;
  const u = await ctx.db.query(
    `UPDATE users SET totp_recovery_hashes = array_remove(totp_recovery_hashes, $2)
      WHERE id = $1 AND $2 = ANY(totp_recovery_hashes)`,
    [userId, sha256Hex(norm)],
  );
  return (u.rowCount ?? 0) > 0;
}

const hashCodes = (codes: string[]) => codes.map((c) => sha256Hex(normalizeRecoveryCode(c)));

/** Desafio do 2º passo do login: cifrado e com validade curta, não dá acesso a nada sozinho. */
export function issueChallenge(ctx: Ctx, userId: string): string {
  return ctx.box.encrypt(JSON.stringify({ t: '2fa', uid: userId, exp: ctx.now().getTime() + CHALLENGE_TTL_MS, n: randomBytes(8).toString('hex') }));
}

function readChallenge(ctx: Ctx, challenge: string): string {
  try {
    const c = JSON.parse(ctx.box.decrypt(challenge)) as { t?: string; uid?: string; exp?: number };
    if (c.t === '2fa' && typeof c.uid === 'string' && typeof c.exp === 'number' && c.exp > ctx.now().getTime()) return c.uid;
  } catch { /* cai no erro abaixo */ }
  throw badRequest('A verificação expirou. Entre com e-mail e senha de novo.');
}

export async function hasTwoFactor(ctx: Ctx, userId: string): Promise<boolean> {
  const r = await ctx.db.query('SELECT 1 FROM users WHERE id = $1 AND totp_enabled_at IS NOT NULL', [userId]);
  return !!r.rowCount;
}

/** Aviso de segurança por e-mail. Falha de envio nunca bloqueia a ação. */
export async function securityAlert(ctx: Ctx, req: FastifyRequest, to: string, what: string) {
  const when = ctx.now().toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' });
  const device = String(req.headers['user-agent'] ?? 'desconhecido').slice(0, 120);
  await ctx.mailer.send({
    to,
    subject: `Alerta de segurança: ${what} — PayTracking`,
    text: `${what} na sua conta PayTracking.\n\nQuando: ${when} (horário de Brasília)\nIP: ${clientIp(req)}\nDispositivo: ${device}\n\nFoi você? Então está tudo certo. Se não foi, troque sua senha agora e encerre as outras sessões em Configurações → Segurança: ${ctx.config.APP_URL}/configuracoes?aba=seguranca`,
  }).catch((e) => ctx.log.error({ err: String(e) }, 'falha ao enviar alerta de segurança'));
}

export function twoFactorRoutes(app: FastifyInstance, ctx: Ctx) {
  const secure = ctx.config.isProd;

  // 2º passo do login: código do app autenticador ou um código de recuperação
  app.post('/v1/auth/login/2fa', async (req, reply) => {
    await hit(ctx.db, `2fa:ip:${clientIp(req)}`, 30, 900);
    const body = parse(z.object({
      challenge: z.string().min(20).max(2000),
      code: code.optional(),
      recoveryCode: z.string().trim().min(8).max(20).optional(),
    }).refine((b) => !!b.code !== !!b.recoveryCode, 'Informe o código do app ou um código de recuperação.'), req.body);
    const userId = readChallenge(ctx, body.challenge);
    const bucket = `2fa:user:${userId}`;
    await hit(ctx.db, bucket, 6, 900);
    const row = await loadUser(ctx, userId);
    if (!row.totp_enabled_at) throw badRequest('A verificação expirou. Entre com e-mail e senha de novo.');
    const ok = body.code ? await checkTotp(ctx, userId, row, body.code) : await useRecoveryCode(ctx, userId, body.recoveryCode!);
    if (!ok) throw unauthorized(body.code ? 'Código incorreto ou já usado. Confira o horário do celular e use o código atual.' : 'Código de recuperação inválido ou já usado.');
    await clear(ctx.db, bucket);
    const s = await createSession(ctx, userId, { ip: clientIp(req), ua: req.headers['user-agent'] });
    setSessionCookie(reply, s.token, s.expires, secure);
    if (body.recoveryCode) {
      const left = (await loadUser(ctx, userId)).totp_recovery_hashes.length;
      await ctx.db.query(`INSERT INTO audit_log(user_id, action, metadata, ip) VALUES ($1, 'auth.2fa_recovery_used', $2, $3)`, [userId, { left }, clientIp(req) || null]);
      await securityAlert(ctx, req, row.email, `Um código de recuperação foi usado para entrar (restam ${left})`);
      return { ok: true, recoveryCodesLeft: left };
    }
    return { ok: true };
  });

  app.get('/v1/auth/2fa', async (req) => {
    const a = auth(req);
    const row = await loadUser(ctx, a.user.id);
    return { enabled: !!row.totp_enabled_at, enabledAt: row.totp_enabled_at, recoveryCodesLeft: row.totp_recovery_hashes.length };
  });

  // Gera um segredo novo (fica pendente até confirmar com um código)
  app.post('/v1/auth/2fa/setup', async (req) => {
    const a = auth(req);
    await hit(ctx.db, `2fa-setup:user:${a.user.id}`, 10, 3600);
    const row = await loadUser(ctx, a.user.id);
    if (row.totp_enabled_at) throw badRequest('A verificação em duas etapas já está ativa.');
    const secret = generateSecret();
    await ctx.db.query('UPDATE users SET totp_pending_enc = $2 WHERE id = $1', [a.user.id, ctx.box.encrypt(secret)]);
    return { secret, otpauthUrl: otpauthUrl(secret, row.email) };
  });

  app.post('/v1/auth/2fa/enable', async (req) => {
    const a = auth(req);
    await hit(ctx.db, `2fa-manage:user:${a.user.id}`, 10, 900);
    const body = parse(z.object({ code }), req.body);
    const row = await loadUser(ctx, a.user.id);
    if (row.totp_enabled_at) throw badRequest('A verificação em duas etapas já está ativa.');
    if (!row.totp_pending_enc) throw badRequest('Comece pela leitura do QR code.');
    const secret = ctx.box.decrypt(row.totp_pending_enc);
    const counter = verifyTotp(secret, body.code, ctx.now(), null);
    if (counter === null) throw badRequest('Código incorreto. Confira se o horário do celular está automático e tente o código atual.');
    const codes = generateRecoveryCodes();
    await ctx.db.query(
      `UPDATE users SET totp_secret_enc = $2, totp_pending_enc = NULL, totp_enabled_at = now(), totp_last_counter = $3,
              totp_recovery_hashes = $4 WHERE id = $1`,
      [a.user.id, row.totp_pending_enc, counter, hashCodes(codes)],
    );
    // outras sessões abertas antes da ativação deixam de valer
    const revoked = await revokeSessions(ctx, a.user.id, a.sessionId);
    await ctx.db.query(`INSERT INTO audit_log(org_id, user_id, action) VALUES ($1, $2, 'auth.2fa_enabled')`, [a.org.id, a.user.id]);
    await securityAlert(ctx, req, row.email, 'A verificação em duas etapas foi ativada');
    return { ok: true, recoveryCodes: codes, revokedSessions: revoked };
  });

  app.post('/v1/auth/2fa/disable', async (req) => {
    const a = auth(req);
    await hit(ctx.db, `2fa-manage:user:${a.user.id}`, 10, 900);
    const body = parse(z.object({ password: z.string().min(1).max(200), code: z.string().trim().min(6).max(20) }), req.body);
    const pw = await ctx.db.query<{ password_hash: string }>('SELECT password_hash FROM users WHERE id = $1', [a.user.id]);
    if (!(await verifyPassword(body.password, pw.rows[0]?.password_hash ?? ''))) throw badRequest('Senha incorreta.');
    const row = await loadUser(ctx, a.user.id);
    if (!row.totp_enabled_at) return { ok: true };
    const ok = /^\d{3}\s?\d{3}$/.test(body.code) ? await checkTotp(ctx, a.user.id, row, body.code) : await useRecoveryCode(ctx, a.user.id, body.code);
    if (!ok) throw badRequest('Código incorreto ou já usado.');
    await ctx.db.query(
      `UPDATE users SET totp_secret_enc = NULL, totp_pending_enc = NULL, totp_enabled_at = NULL, totp_last_counter = NULL,
              totp_recovery_hashes = '{}' WHERE id = $1`,
      [a.user.id],
    );
    const revoked = await revokeSessions(ctx, a.user.id, a.sessionId);
    await ctx.db.query(`INSERT INTO audit_log(org_id, user_id, action) VALUES ($1, $2, 'auth.2fa_disabled')`, [a.org.id, a.user.id]);
    await securityAlert(ctx, req, row.email, 'A verificação em duas etapas foi desativada');
    return { ok: true, revokedSessions: revoked };
  });

  app.post('/v1/auth/2fa/recovery-codes', async (req) => {
    const a = auth(req);
    await hit(ctx.db, `2fa-manage:user:${a.user.id}`, 10, 900);
    const body = parse(z.object({ code }), req.body);
    const row = await loadUser(ctx, a.user.id);
    if (!row.totp_enabled_at) throw badRequest('Ative a verificação em duas etapas primeiro.');
    if (!(await checkTotp(ctx, a.user.id, row, body.code))) throw badRequest('Código incorreto ou já usado.');
    const codes = generateRecoveryCodes();
    await ctx.db.query('UPDATE users SET totp_recovery_hashes = $2 WHERE id = $1', [a.user.id, hashCodes(codes)]);
    await ctx.db.query(`INSERT INTO audit_log(org_id, user_id, action) VALUES ($1, $2, 'auth.2fa_recovery_regenerated')`, [a.org.id, a.user.id]);
    return { ok: true, recoveryCodes: codes };
  });
}
