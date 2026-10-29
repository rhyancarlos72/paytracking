import type { FastifyReply, FastifyRequest } from 'fastify';
import type { ZodType, ZodTypeDef } from 'zod';
import { planState, ROLE_RANK, type AuthContext, type Role } from '../auth/service.js';
import { badRequest, forbidden, paymentRequired, unauthorized } from './errors.js';

declare module 'fastify' {
  interface FastifyRequest {
    auth?: AuthContext;
  }
}

export const SESSION_COOKIE = 'pt_session';

export function parse<T>(schema: ZodType<T, ZodTypeDef, unknown>, data: unknown): T {
  const r = schema.safeParse(data);
  if (!r.success) {
    const issues = r.error.issues.map((i) => ({ path: i.path.join('.'), message: i.message }));
    throw badRequest(issues[0] ? `${issues[0].path ? issues[0].path + ': ' : ''}${issues[0].message}` : 'Dados inválidos.', issues);
  }
  return r.data;
}

export function auth(req: FastifyRequest): AuthContext {
  if (!req.auth) throw unauthorized();
  return req.auth;
}

/** Garante papel mínimo e assinatura ativa (exceto rotas de billing). */
export function requireRole(req: FastifyRequest, min: Role, opts: { allowExpiredPlan?: boolean } = {}): AuthContext {
  const a = auth(req);
  if (!opts.allowExpiredPlan && !a.user.isPlatformAdmin && planState(a.org, new Date()).blocked) throw paymentRequired();
  if (ROLE_RANK[a.role] < ROLE_RANK[min]) throw forbidden();
  return a;
}

export function requirePlatformAdmin(req: FastifyRequest): AuthContext {
  const a = auth(req);
  if (!a.user.isPlatformAdmin) throw forbidden();
  return a;
}

export function setSessionCookie(reply: FastifyReply, token: string, expires: Date, secure: boolean) {
  reply.setCookie(SESSION_COOKIE, token, { path: '/', httpOnly: true, secure, sameSite: 'lax', expires });
}

export function clearSessionCookie(reply: FastifyReply, secure: boolean) {
  reply.clearCookie(SESSION_COOKIE, { path: '/', httpOnly: true, secure, sameSite: 'lax' });
}

/** IP do cliente — confiável apenas com TRUST_PROXY (Fastify valida a cadeia). Corrige P-19. */
export const clientIp = (req: FastifyRequest): string => req.ip;

/** JSON seguro para BigInt (valores em unidade mínima viram string). */
export function jsonSafe<T>(v: T): unknown {
  return JSON.parse(JSON.stringify(v, (_k, x) => (typeof x === 'bigint' ? x.toString() : x)));
}
