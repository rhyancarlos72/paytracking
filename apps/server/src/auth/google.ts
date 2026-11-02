import { createHash, randomBytes } from 'node:crypto';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type { Ctx } from '../context.js';
import { clientIp, setSessionCookie } from '../lib/http.js';
import { hit } from '../lib/rate-limit.js';
import { createSession, createUserWithOrg, onEmailVerified } from './service.js';
import { hasTwoFactor, issueChallenge, securityAlert } from './two-factor.js';
import { trackSignup } from '../platform/tracking.js';

/**
 * Login com Google (OpenID Connect, fluxo "authorization code" + PKCE).
 * - state, nonce e o verificador PKCE ficam num cookie cifrado, httpOnly, de 10 min;
 * - o id_token vem direto do Google pela troca do código (TLS, com o segredo do cliente), então
 *   basta validar iss/aud/exp/nonce (OIDC Core 3.1.3.7) — sem confiar em nada vindo do navegador;
 * - só e-mail verificado pelo Google; conta existente com o mesmo e-mail é vinculada;
 * - quem tem verificação em duas etapas ainda precisa digitar o código.
 */
const AUTH_URL = 'https://accounts.google.com/o/oauth2/v2/auth';
const TOKEN_URL = 'https://oauth2.googleapis.com/token';
const COOKIE = 'pt_google';
const COOKIE_PATH = '/v1/auth/google';
const TTL_MS = 10 * 60_000;

interface Flow { state: string; nonce: string; verifier: string; back: string; exp: number }
interface IdToken { iss?: string; aud?: string; exp?: number; nonce?: string; sub?: string; email?: string; email_verified?: boolean | string; name?: string }

const b64url = (b: Buffer) => b.toString('base64url');
const safeBack = (v: unknown) => (typeof v === 'string' && v.startsWith('/') && !v.startsWith('//') && !v.startsWith('/\\') ? v.slice(0, 300) : '/');

export function decodeJwtPayload(jwt: string): IdToken | null {
  const part = jwt.split('.')[1];
  if (!part) return null;
  try {
    return JSON.parse(Buffer.from(part, 'base64url').toString('utf8')) as IdToken;
  } catch {
    return null;
  }
}

export const googleEnabled = (ctx: Ctx) => !!(ctx.config.GOOGLE_CLIENT_ID && ctx.config.GOOGLE_CLIENT_SECRET);

export function googleRoutes(app: FastifyInstance, ctx: Ctx) {
  const secure = ctx.config.isProd;
  const redirectUri = `${ctx.config.PUBLIC_API_URL.replace(/\/$/, '')}/v1/auth/google/callback`;
  const appUrl = ctx.config.APP_URL.replace(/\/$/, '');

  const fail = (reply: FastifyReply, code: string) => {
    reply.clearCookie(COOKIE, { path: COOKIE_PATH });
    return reply.redirect(`${appUrl}/entrar?erro=${encodeURIComponent(code)}`, 302);
  };

  app.get('/v1/auth/providers', async () => ({ google: googleEnabled(ctx) }));

  app.get('/v1/auth/google/start', async (req, reply) => {
    if (!googleEnabled(ctx)) return fail(reply, 'google_desativado');
    await hit(ctx.db, `google:ip:${clientIp(req)}`, 30, 900);
    const flow: Flow = {
      state: b64url(randomBytes(24)), nonce: b64url(randomBytes(24)), verifier: b64url(randomBytes(48)),
      back: safeBack((req.query as Record<string, unknown>).voltar), exp: ctx.now().getTime() + TTL_MS,
    };
    reply.setCookie(COOKIE, ctx.box.encrypt(JSON.stringify(flow)), {
      path: COOKIE_PATH, httpOnly: true, secure, sameSite: 'lax', maxAge: TTL_MS / 1000,
    });
    const q = new URLSearchParams({
      client_id: ctx.config.GOOGLE_CLIENT_ID, redirect_uri: redirectUri, response_type: 'code', scope: 'openid email profile',
      state: flow.state, nonce: flow.nonce, code_challenge: b64url(createHash('sha256').update(flow.verifier).digest()),
      code_challenge_method: 'S256', prompt: 'select_account',
    });
    return reply.redirect(`${AUTH_URL}?${q}`, 302);
  });

  app.get('/v1/auth/google/callback', async (req: FastifyRequest, reply) => {
    if (!googleEnabled(ctx)) return fail(reply, 'google_desativado');
    const q = req.query as Record<string, string | undefined>;
    if (q.error) return fail(reply, q.error === 'access_denied' ? 'google_cancelado' : 'google_falhou');
    let flow: Flow;
    try {
      flow = JSON.parse(ctx.box.decrypt(String(req.cookies[COOKIE] ?? ''))) as Flow;
    } catch {
      return fail(reply, 'google_expirou');
    }
    // state amarra a resposta a ESTE navegador (impede login forçado / CSRF no OAuth)
    if (!q.state || q.state !== flow.state || flow.exp < ctx.now().getTime() || !q.code) return fail(reply, 'google_expirou');
    reply.clearCookie(COOKIE, { path: COOKIE_PATH });

    let token: IdToken | null = null;
    try {
      const r = await ctx.fetch(TOKEN_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          code: q.code, client_id: ctx.config.GOOGLE_CLIENT_ID, client_secret: ctx.config.GOOGLE_CLIENT_SECRET,
          redirect_uri: redirectUri, grant_type: 'authorization_code', code_verifier: flow.verifier,
        }).toString(),
        signal: AbortSignal.timeout(10_000),
      });
      const body = (await r.json().catch(() => null)) as { id_token?: string } | null;
      if (!r.ok || !body?.id_token) {
        ctx.log.warn({ status: r.status }, 'google: troca do código falhou');
        return fail(reply, 'google_falhou');
      }
      token = decodeJwtPayload(body.id_token);
    } catch (e) {
      ctx.log.warn({ err: String(e) }, 'google: sem resposta');
      return fail(reply, 'google_falhou');
    }
    const nowSec = ctx.now().getTime() / 1000;
    if (
      !token || !['accounts.google.com', 'https://accounts.google.com'].includes(String(token.iss))
      || token.aud !== ctx.config.GOOGLE_CLIENT_ID || !token.exp || token.exp < nowSec
      || token.nonce !== flow.nonce || !token.sub || !token.email
    ) return fail(reply, 'google_falhou');
    if (token.email_verified !== true && token.email_verified !== 'true') return fail(reply, 'google_email_nao_verificado');

    const email = token.email.trim().toLowerCase();
    const sub = String(token.sub);
    let userId: string;
    let created = false;
    const bySub = await ctx.db.query<{ id: string }>('SELECT id FROM users WHERE google_sub = $1', [sub]);
    if (bySub.rows[0]) userId = bySub.rows[0].id;
    else {
      const byEmail = await ctx.db.query<{ id: string; google_sub: string | null }>('SELECT id, google_sub FROM users WHERE email = $1', [email]);
      const existing = byEmail.rows[0];
      if (existing) {
        // e-mail já é de outra conta Google: não troca o vínculo silenciosamente
        if (existing.google_sub && existing.google_sub !== sub) return fail(reply, 'google_outra_conta');
        await ctx.db.query('UPDATE users SET google_sub = $2, email_verified_at = COALESCE(email_verified_at, now()), updated_at = now() WHERE id = $1', [existing.id, sub]);
        userId = existing.id;
        await onEmailVerified(ctx, userId);
        await ctx.db.query(`INSERT INTO audit_log(user_id, action, ip) VALUES ($1, 'auth.google_linked', $2)`, [userId, clientIp(req) || null]);
        await securityAlert(ctx, req, email, 'O login com Google foi conectado');
      } else {
        await hit(ctx.db, `signup:ip:${clientIp(req)}`, 10, 3600);
        const r = await createUserWithOrg(ctx, { email, name: token.name?.slice(0, 120) ?? null, googleSub: sub });
        userId = r.userId;
        created = true;
        await trackSignup(ctx, req, { userId, orgId: r.orgId, email, name: token.name ?? null });
      }
    }

    if (await hasTwoFactor(ctx, userId)) {
      // o desafio vai no fragmento (#): não aparece em logs nem no Referer
      return reply.redirect(`${appUrl}/entrar?voltar=${encodeURIComponent(flow.back)}#desafio=${encodeURIComponent(issueChallenge(ctx, userId))}`, 302);
    }
    const s = await createSession(ctx, userId, { ip: clientIp(req), ua: req.headers['user-agent'] });
    setSessionCookie(reply, s.token, s.expires, secure);
    return reply.redirect(`${appUrl}${created ? '/?bem-vindo=1' : flow.back}`, 302);
  });
}
