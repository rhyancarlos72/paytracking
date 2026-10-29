import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { PROVIDERS, type Provider } from '@pt/gateways';
import type { Ctx } from '../context.js';
import { ingestWebhook } from './ingest.js';

declare module 'fastify' {
  interface FastifyRequest {
    rawBody?: string;
  }
}

const isProvider = (p: string): p is Provider => (PROVIDERS as string[]).includes(p);

function headersOf(req: FastifyRequest): Record<string, string | undefined> {
  const h: Record<string, string | undefined> = {};
  for (const [k, v] of Object.entries(req.headers)) h[k.toLowerCase()] = Array.isArray(v) ? v[0] : v;
  return h;
}

function bearer(req: FastifyRequest): string {
  const a = String(req.headers.authorization ?? '');
  const m = /^Bearer\s+(.+)$/i.exec(a);
  return (m?.[1] ?? String(req.headers['x-integration-token'] ?? '')).trim();
}

export function webhookRoutes(app: FastifyInstance, ctx: Ctx) {
  async function handle(req: FastifyRequest, reply: FastifyReply, provider: string, token: string) {
    if (!isProvider(provider)) return reply.code(400).send({ success: false, error: 'Unsupported gateway', supported: PROVIDERS });
    if (!token) return reply.code(401).send({ success: false, error: 'Missing integration token' });
    const form = req.body && typeof req.body === 'object' && !req.rawBody?.trim().startsWith('{') ? (req.body as Record<string, unknown>) : null;
    const out = await ingestWebhook(ctx, {
      provider, token, rawBody: req.rawBody ?? '', headers: headersOf(req),
      query: Object.fromEntries(Object.entries((req.query ?? {}) as Record<string, unknown>).map(([k, v]) => [k, String(v)])),
      formBody: form,
    });
    return reply.code(out.httpStatus).header('x-correlation-id', String(out.body.correlationId ?? '')).send(out.body);
  }

  const ping = async (req: FastifyRequest<{ Params: { provider?: string }; Querystring: { gateway?: string } }>) =>
    ({ success: true, ping: true, gateway: req.params.provider ?? req.query.gateway ?? null });

  // Rotas novas
  app.post<{ Params: { provider: string; token: string } }>('/v1/webhooks/:provider/:token', (req, reply) =>
    handle(req, reply, req.params.provider, req.params.token));
  app.get('/v1/webhooks/:provider/:token', ping);
  app.post('/v1/webhooks/checkout', (req, reply) => handle(req, reply, 'checkout', bearer(req)));

  // Compatibilidade com as URLs do sistema legado (troca de DNS sem reconfigurar gateways)
  app.post('/api/webhook.php', (req, reply) => handle(req, reply, 'checkout', bearer(req)));
  app.post<{ Querystring: { gateway?: string; token?: string } }>('/api/webhook_gateway.php', (req, reply) =>
    handle(req, reply, String(req.query.gateway ?? '').toLowerCase(), String(req.query.token ?? '') || bearer(req)));
  app.get('/api/webhook_gateway.php', ping);
}
