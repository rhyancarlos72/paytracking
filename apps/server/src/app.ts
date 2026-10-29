import Fastify, { type FastifyInstance } from 'fastify';
import cookie from '@fastify/cookie';
import fastifyStatic from '@fastify/static';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { ZodError } from 'zod';
import type { Ctx } from './context.js';
import { resolveSession } from './auth/service.js';
import { authRoutes } from './auth/routes.js';
import { orgRoutes } from './orgs/routes.js';
import { pixelRoutes } from './pixels/routes.js';
import { integrationRoutes } from './integrations/routes.js';
import { webhookRoutes } from './webhooks/routes.js';
import { collectRoutes } from './collect/routes.js';
import { reportRoutes } from './reports/routes.js';
import { metaRoutes } from './meta/routes.js';
import { billingRoutes } from './billing/routes.js';
import { adminRoutes } from './admin/routes.js';
import { pushRoutes } from './notifications/routes.js';
import { AppError } from './lib/errors.js';
import { SESSION_COOKIE } from './lib/http.js';

/** Rotas públicas chamadas por terceiros (gateways, navegador do visitante, Meta). */
const PUBLIC_PREFIXES = ['/v1/webhooks', '/api/', '/v1/collect', '/v1/pixel-config', '/v1/meta/callback', '/healthz', '/pixel.js', '/checkout-loader'];
const isPublic = (url: string) => PUBLIC_PREFIXES.some((p) => url.startsWith(p));

export async function buildApp(ctx: Ctx): Promise<FastifyInstance> {
  const app = Fastify({
    logger: ctx.config.NODE_ENV === 'test' ? false : {
      level: ctx.config.isProd ? 'info' : 'debug',
      redact: ['req.headers.authorization', 'req.headers.cookie', 'req.headers["x-hotmart-hottok"]', 'req.headers["security-token"]'],
      serializers: {
        // nunca registra a querystring (tokens de webhook legados vão na URL)
        req: (r) => ({ method: r.method, url: String(r.url).split('?')[0]!.replace(/\/(itk_[a-f0-9]+)$/, '/[token]'), id: r.id }),
      },
    },
    trustProxy: ctx.config.TRUST_PROXY,
    bodyLimit: 1_048_576,
    genReqId: () => randomUUID(),
  });

  await app.register(cookie);
  // BIGINT (dinheiro em unidade mínima, ids bigserial) é serializado como string exata.
  app.setReplySerializer((payload) => JSON.stringify(payload, (_k, v) => (typeof v === 'bigint' ? v.toString() : v)));

  // Corpo cru preservado: assinaturas HMAC são calculadas sobre os bytes exatos.
  app.addContentTypeParser(['application/json', 'text/plain'], { parseAs: 'string' }, (req, body, done) => {
    const s = String(body);
    req.rawBody = s;
    if (!s.trim()) return done(null, {});
    try {
      done(null, JSON.parse(s));
    } catch {
      // texto não-JSON (ex.: corpo de teste do gateway) — a rota decide
      done(null, null);
    }
  });
  app.addContentTypeParser('application/x-www-form-urlencoded', { parseAs: 'string' }, (req, body, done) => {
    const s = String(body);
    req.rawBody = s;
    done(null, Object.fromEntries(new URLSearchParams(s)));
  });
  app.addContentTypeParser('*', { parseAs: 'string' }, (req, body, done) => {
    req.rawBody = String(body);
    done(null, null);
  });

  const appOrigin = new URL(ctx.config.APP_URL).origin;
  const apiOrigin = new URL(ctx.config.PUBLIC_API_URL).origin;

  app.addHook('onRequest', async (req, reply) => {
    reply.header('X-Content-Type-Options', 'nosniff');
    reply.header('Referrer-Policy', 'strict-origin-when-cross-origin');
    reply.header('X-Frame-Options', 'DENY');
    reply.header('Permissions-Policy', 'geolocation=(), microphone=(), camera=()');
    if (ctx.config.isProd) reply.header('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
    const url = req.url;
    if (url.startsWith('/v1/') && !isPublic(url)) {
      reply.header('Cache-Control', 'no-store');
      // Proteção CSRF: cookie SameSite=Lax + Origin obrigatório e igual ao do painel em métodos de escrita.
      if (!['GET', 'HEAD', 'OPTIONS'].includes(req.method)) {
        const origin = String(req.headers.origin ?? '');
        if (origin !== appOrigin && origin !== apiOrigin) {
          return reply.code(403).send({ error: { code: 'bad_origin', message: 'Origem da requisição não permitida.' } });
        }
      }
    }
    const token = req.cookies[SESSION_COOKIE];
    if (token && (url.startsWith('/v1/') || url === '/v1')) {
      req.auth = (await resolveSession(ctx, token)) ?? undefined;
    }
  });

  app.setErrorHandler((err, req, reply) => {
    if (err instanceof AppError) {
      return reply.code(err.status).send({ error: { code: err.code, message: err.message, details: err.details } });
    }
    if (err instanceof ZodError) return reply.code(400).send({ error: { code: 'bad_request', message: 'Dados inválidos.' } });
    const status = (err as { statusCode?: number }).statusCode;
    if (status && status < 500) return reply.code(status).send({ error: { code: 'bad_request', message: (err as Error).message } });
    req.log.error({ err }, 'erro não tratado');
    return reply.code(500).send({ error: { code: 'internal', message: 'Erro interno. Tente novamente.', requestId: req.id } });
  });

  app.get('/healthz', async (_req, reply) => {
    try {
      await ctx.db.query('SELECT 1');
      return { ok: true };
    } catch {
      return reply.code(503).send({ ok: false, db: 'unavailable' });
    }
  });

  authRoutes(app, ctx);
  orgRoutes(app, ctx);
  pixelRoutes(app, ctx);
  integrationRoutes(app, ctx);
  webhookRoutes(app, ctx);
  collectRoutes(app, ctx);
  reportRoutes(app, ctx);
  metaRoutes(app, ctx);
  billingRoutes(app, ctx);
  adminRoutes(app, ctx);
  pushRoutes(app, ctx);

  // Scripts do navegador (pixel.js e loaders), com cache curto e CORS aberto.
  const pixelDir = ctx.config.PIXEL_DIST_DIR || path.resolve(process.cwd(), '../../packages/pixel/dist');
  const scripts: Record<string, string> = {
    '/pixel.js': 'pixel.js',
    '/checkout-loader.js': 'checkout-loader.js',
    '/checkout-loader-ic-only.js': 'checkout-loader.js',
  };
  for (const [route, file] of Object.entries(scripts)) {
    app.get(route, async (_req, reply) => {
      const p = path.join(pixelDir, file);
      if (!existsSync(p)) return reply.code(404).send('// build do pixel ausente');
      reply.header('Content-Type', 'application/javascript; charset=utf-8');
      reply.header('Cache-Control', 'public, max-age=300');
      reply.header('Access-Control-Allow-Origin', '*');
      return readFileSync(p, 'utf8');
    });
  }

  // Painel (SPA) servido pelo mesmo container quando WEB_DIST_DIR estiver definido.
  const webDir = ctx.config.WEB_DIST_DIR;
  if (webDir && existsSync(webDir)) {
    await app.register(fastifyStatic, { root: webDir, wildcard: false, maxAge: '1h', index: false });
    const indexHtml = readFileSync(path.join(webDir, 'index.html'), 'utf8');
    app.setNotFoundHandler((req, reply) => {
      if (req.method === 'GET' && !req.url.startsWith('/v1/') && !req.url.startsWith('/api/')) {
        reply.header('Content-Security-Policy', [
          "default-src 'self'", "script-src 'self'", "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
          "font-src 'self' https://fonts.gstatic.com data:", "img-src 'self' data: https:", "connect-src 'self'",
          "frame-ancestors 'none'", "base-uri 'self'", "form-action 'self'",
        ].join('; '));
        return reply.type('text/html').header('Cache-Control', 'no-cache').send(indexHtml);
      }
      return reply.code(404).send({ error: { code: 'not_found', message: 'Rota não encontrada.' } });
    });
  }

  return app;
}
