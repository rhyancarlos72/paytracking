import Fastify, { type FastifyInstance } from 'fastify';
import cookie from '@fastify/cookie';
import fastifyStatic from '@fastify/static';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { wakeDispatcher } from './capi/wake.js';
import { createHash, randomUUID } from 'node:crypto';
import { brotliCompressSync, constants as zlibConstants, gzipSync } from 'node:zlib';
import { ZodError } from 'zod';
import type { Ctx } from './context.js';
import { resolveSession } from './auth/service.js';
import { authRoutes } from './auth/routes.js';
import { twoFactorRoutes } from './auth/two-factor.js';
import { googleRoutes } from './auth/google.js';
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
import { saleSoundRoutes } from './notifications/sound.js';
import { legalRoutes } from './legal/pages.js';
import { platformTrackingRoutes } from './platform/tracking.js';
import { AppError } from './lib/errors.js';
import { FLOOD_LIMITS, FloodGuard } from './lib/flood.js';
import { SESSION_COOKIE } from './lib/http.js';

/** Rotas públicas chamadas por terceiros (gateways, navegador do visitante, Meta). */
const SEVERITY: Record<string, string> = { trace: 'DEBUG', debug: 'DEBUG', info: 'INFO', warn: 'WARNING', error: 'ERROR', fatal: 'CRITICAL' };

const PUBLIC_PREFIXES = ['/v1/webhooks', '/api/', '/v1/collect', '/v1/pixel-config', '/v1/meta/callback', '/v1/public/', '/healthz', '/pixel.js', '/checkout-loader'];
const isPublic = (url: string) => PUBLIC_PREFIXES.some((p) => url.startsWith(p));

export async function buildApp(ctx: Ctx): Promise<FastifyInstance> {
  const app = Fastify({
    logger: ctx.config.NODE_ENV === 'test' ? false : {
      level: ctx.config.isProd ? 'info' : 'debug',
      formatters: { level: (label, level) => ({ level, severity: SEVERITY[label] ?? 'DEFAULT' }) },
      redact: ['req.headers.authorization', 'req.headers.cookie', 'req.headers["x-hotmart-hottok"]', 'req.headers["security-token"]'],
      serializers: {
        // nunca registra a querystring (tokens de webhook legados vão na URL)
        req: (r) => ({ method: r.method, url: String(r.url).split('?')[0]!.replace(/^(\/v1\/webhooks\/[^/]+\/)[^/]+$/, '$1[token]'), id: r.id }),
      },
    },
    // número = confia só nos N últimos saltos (o que o proxy acrescentou), igual ao proxy-addr
    trustProxy: typeof ctx.config.TRUST_PROXY === 'number'
      ? ((hops: number) => (_addr: string, i: number) => i < hops)(ctx.config.TRUST_PROXY)
      : ctx.config.TRUST_PROXY,
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

  const flood = new FloodGuard();
  const appOrigin = new URL(ctx.config.APP_URL).origin;
  const apiOrigin = new URL(ctx.config.PUBLIC_API_URL).origin;

  // escrita terminada (transação já confirmada): acorda o worker para enviar eventos novos na hora
  app.addHook('onResponse', async (req) => { if (req.method !== 'GET' && req.method !== 'HEAD') wakeDispatcher(); });

  app.addHook('onRequest', async (req, reply) => {
    reply.header('X-Content-Type-Options', 'nosniff');
    reply.header('Referrer-Policy', 'strict-origin-when-cross-origin');
    reply.header('X-Frame-Options', 'DENY');
    reply.header('Permissions-Policy', 'geolocation=(), microphone=(), camera=(), payment=(), usb=(), interest-cohort=()');
    reply.header('X-Permitted-Cross-Domain-Policies', 'none');
    if (ctx.config.isProd) reply.header('Strict-Transport-Security', 'max-age=63072000; includeSubDomains');
    const url = req.url;
    const rule = FLOOD_LIMITS.find((r) => url.startsWith(r.prefix));
    if (rule && !flood.allow(`${rule.group}:${req.ip}`, rule.limit)) {
      return reply.code(429).header('Retry-After', '60').send({ error: { code: 'rate_limited', message: 'Muitas requisições. Tente em 1 minuto.' } });
    }
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

  // contato para relatar falhas de segurança (RFC 9116)
  app.get('/.well-known/security.txt', async (_req, reply) => {
    const expires = new Date(Date.now() + 180 * 86_400_000).toISOString().replace(/\.\d+Z$/, 'Z');
    const contact = ctx.config.SECURITY_CONTACT || `mailto:${(/<([^>]+)>/.exec(ctx.config.MAIL_FROM)?.[1] ?? ctx.config.MAIL_FROM).trim()}`;
    reply.type('text/plain; charset=utf-8').header('Cache-Control', 'public, max-age=86400');
    return `Contact: ${contact}\nExpires: ${expires}\nPreferred-Languages: pt-BR, en\nCanonical: ${ctx.config.APP_URL.replace(/\/$/, '')}/.well-known/security.txt\n`;
  });

  authRoutes(app, ctx);
  twoFactorRoutes(app, ctx);
  googleRoutes(app, ctx);
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
  saleSoundRoutes(app, ctx);
  legalRoutes(app, ctx);
  platformTrackingRoutes(app, ctx);

  // Scripts do navegador (pixel.js e loaders), com cache curto e CORS aberto.
  // padrões relativos a apps/server/{src,dist}: funcionam sem configurar nada fora do Docker
  const here = path.dirname(fileURLToPath(import.meta.url));
  const firstDir = (...dirs: string[]) => dirs.find((d) => existsSync(d)) ?? dirs[dirs.length - 1]!;
  // dist/pixel e dist/web: cópias feitas pelo build (pasta dist autossuficiente); depois, o monorepo
  const pixelDir = ctx.config.PIXEL_DIST_DIR || firstDir(path.join(here, 'pixel'), path.resolve(here, '../../../packages/pixel/dist'));
  const scripts: Record<string, string> = {
    '/pixel.js': 'pixel.js',
    '/checkout-loader.js': 'checkout-loader.js',
    '/checkout-loader-ic-only.js': 'checkout-loader.js',
  };
  // em memória e já comprimidos (brotli/gzip): resposta instantânea, sem ler o disco a cada visita
  const compiled = new Map<string, { raw: Buffer; br: Buffer; gz: Buffer; etag: string }>();
  const loadScript = (file: string) => {
    const p = path.join(pixelDir, file);
    if (!existsSync(p)) return null;
    let c = compiled.get(p);
    if (!c) {
      const raw = readFileSync(p);
      c = {
        raw,
        br: brotliCompressSync(raw, { params: { [zlibConstants.BROTLI_PARAM_QUALITY]: 11 } }),
        gz: gzipSync(raw, { level: 9 }),
        etag: `"${createHash('sha256').update(raw).digest('base64url').slice(0, 16)}"`,
      };
      compiled.set(p, c);
    }
    return c;
  };
  for (const [route, file] of Object.entries(scripts)) {
    app.get(route, async (req, reply) => {
      const c = loadScript(file);
      if (!c) return reply.code(404).send('// build do pixel ausente');
      reply.header('Content-Type', 'application/javascript; charset=utf-8');
      // 1 h no navegador e no CDN; depois usa o que tem e revalida em segundo plano (ETag)
      reply.header('Cache-Control', 'public, max-age=3600, stale-while-revalidate=604800');
      reply.header('ETag', c.etag);
      reply.header('Vary', 'Accept-Encoding');
      reply.header('Access-Control-Allow-Origin', '*');
      reply.header('Cross-Origin-Resource-Policy', 'cross-origin');
      reply.header('Timing-Allow-Origin', '*');
      if (req.headers['if-none-match'] === c.etag) return reply.code(304).send();
      const accept = String(req.headers['accept-encoding'] ?? '');
      if (/\bbr\b/.test(accept)) return reply.header('Content-Encoding', 'br').send(c.br);
      if (/\bgzip\b/.test(accept)) return reply.header('Content-Encoding', 'gzip').send(c.gz);
      return reply.send(c.raw);
    });
  }

  // Painel (SPA) servido pelo mesmo container quando WEB_DIST_DIR estiver definido.
  const webDir = ctx.config.WEB_DIST_DIR || firstDir(path.join(here, 'web', 'index.html'), path.resolve(here, '../../web/dist/index.html')).replace(/[\\/]index\.html$/, '');
  if (existsSync(path.join(webDir, 'index.html'))) {
    await app.register(fastifyStatic, {
      root: webDir, wildcard: false, maxAge: '1h', index: false,
      setHeaders(res, filePath) {
        // service worker e manifest sempre revalidados (senão o celular fica com a versão antiga)
        if (/(?:^|[\\/])(?:sw\.js|manifest\.webmanifest)$/.test(filePath)) res.header('Cache-Control', 'no-cache');
        // arquivos com hash no nome nunca mudam
        else if (/[\\/]assets[\\/]/.test(filePath)) res.header('Cache-Control', 'public, max-age=31536000, immutable');
      },
    });
    // verificação de propriedade do Google Search Console (meta tag na página inicial)
    const gsv = ctx.config.GOOGLE_SITE_VERIFICATION.replace(/[^\w-]/g, '');
    const indexHtml = readFileSync(path.join(webDir, 'index.html'), 'utf8')
      .replace('</head>', gsv ? `  <meta name="google-site-verification" content="${gsv}" />\n  </head>` : '</head>');
    app.setNotFoundHandler((req, reply) => {
      // arquivo de build inexistente (ex.: aba aberta durante um deploy pedindo um chunk antigo):
      // 404 de verdade, nunca o index.html — senão o navegador recebe HTML no lugar de JS
      const isAsset = /^\/assets\//.test(req.url) || /\.(?:js|mjs|css|map|woff2?|png|svg|ico|webmanifest)(?:\?|$)/.test(req.url);
      if (req.method === 'GET' && !isAsset && !req.url.startsWith('/v1/') && !req.url.startsWith('/api/')) {
        reply.header('Content-Security-Policy', [
          "default-src 'self'", "script-src 'self' https://connect.facebook.net", "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
          "font-src 'self' https://fonts.gstatic.com data:", "img-src 'self' data: https:", "connect-src 'self' https://www.facebook.com https://connect.facebook.net",
          "media-src 'self' data: blob:", "worker-src 'self'", "manifest-src 'self'", "object-src 'none'",
          "frame-ancestors 'none'", "base-uri 'self'", "form-action 'self'",
          ...(ctx.config.isProd ? ['upgrade-insecure-requests'] : []),
        ].join('; '));
        reply.header('Cross-Origin-Opener-Policy', 'same-origin');
        return reply.type('text/html').header('Cache-Control', 'no-cache').send(indexHtml);
      }
      return reply.code(404).send({ error: { code: 'not_found', message: 'Rota não encontrada.' } });
    });
  }

  return app;
}
