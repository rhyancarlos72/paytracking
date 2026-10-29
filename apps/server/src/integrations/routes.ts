import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { ADAPTERS, PROVIDERS, type Provider } from '@pt/gateways';
import type { Ctx } from '../context.js';
import { hint, integrationToken, sha256Hex } from '../lib/crypto.js';
import { badRequest, notFound } from '../lib/errors.js';
import { parse, requireRole } from '../lib/http.js';
import { audit } from '../orgs/routes.js';

export function webhookUrl(ctx: Ctx, provider: Provider, token: string): string {
  return `${ctx.config.PUBLIC_API_URL}/v1/webhooks/${provider}/${token}`;
}

function dto(r: Record<string, any>) {
  const ad = ADAPTERS[r.provider as Provider];
  return {
    id: r.id, provider: r.provider, providerLabel: ad.label, authMethod: ad.authMethod,
    requiresSecret: ad.requiresSecret, configurableAmountUnit: ad.configurableAmountUnit,
    name: r.name, tokenHint: r.token_hint, secretConfigured: !!r.secret_enc, defaultPixelId: r.default_pixel_id,
    amountUnit: r.amount_unit, active: r.active, lastReceivedAt: r.last_received_at, createdAt: r.created_at,
    stats: r.stats ?? null,
  };
}

const updateSchema = z.object({
  name: z.string().trim().min(1).max(120).optional(),
  secret: z.string().trim().min(4).max(255).optional().nullable(),
  defaultPixelId: z.string().uuid().optional().nullable(),
  amountUnit: z.enum(['major', 'minor']).optional(),
  active: z.boolean().optional(),
});

export function integrationRoutes(app: FastifyInstance, ctx: Ctx) {
  async function assertPixel(orgId: string, pixelId: string | null | undefined) {
    if (!pixelId) return;
    const r = await ctx.db.query('SELECT 1 FROM pixels WHERE id = $1 AND org_id = $2', [pixelId, orgId]);
    if (!r.rowCount) throw badRequest('Pixel padrão não pertence a esta organização.');
  }

  app.get('/v1/integrations/providers', async (req) => {
    requireRole(req, 'viewer');
    return {
      providers: PROVIDERS.map((p) => ({
        provider: p, label: ADAPTERS[p].label, authMethod: ADAPTERS[p].authMethod,
        requiresSecret: ADAPTERS[p].requiresSecret, configurableAmountUnit: ADAPTERS[p].configurableAmountUnit,
      })),
    };
  });

  app.get('/v1/integrations', async (req) => {
    const a = requireRole(req, 'viewer');
    const r = await ctx.db.query(
      `SELECT i.*, (SELECT json_build_object(
                'processed', count(*) FILTER (WHERE outcome = 'processed'),
                'duplicate', count(*) FILTER (WHERE outcome = 'duplicate'),
                'ignored',   count(*) FILTER (WHERE outcome = 'ignored'),
                'rejected',  count(*) FILTER (WHERE outcome = 'rejected'),
                'failed',    count(*) FILTER (WHERE outcome = 'failed'))
              FROM webhook_receipts w WHERE w.integration_id = i.id AND w.received_at > now() - interval '7 days') AS stats
         FROM integrations i WHERE i.org_id = $1 ORDER BY i.created_at`,
      [a.org.id],
    );
    return { integrations: r.rows.map(dto) };
  });

  app.post('/v1/integrations', async (req, reply) => {
    const a = requireRole(req, 'admin');
    const b = parse(updateSchema.extend({ provider: z.enum(PROVIDERS as [Provider, ...Provider[]]) }), req.body);
    const ad = ADAPTERS[b.provider];
    if (ad.requiresSecret && !b.secret) throw badRequest(`${ad.label} exige o segredo/token do webhook (${ad.authMethod}).`);
    await assertPixel(a.org.id, b.defaultPixelId);
    const token = integrationToken();
    const r = await ctx.db.query(
      `INSERT INTO integrations(org_id, provider, name, token_hash, token_hint, secret_enc, default_pixel_id, amount_unit, active)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,COALESCE($9, true)) RETURNING *`,
      [a.org.id, b.provider, b.name ?? ad.label, sha256Hex(token), hint(token), ctx.box.encryptNullable(b.secret),
        b.defaultPixelId ?? null, b.amountUnit ?? 'major', b.active ?? null],
    );
    await audit(ctx, a.org.id, a.user.id, 'integration.created', r.rows[0].id, { provider: b.provider });
    return reply.code(201).send({ integration: dto(r.rows[0]), token, webhookUrl: webhookUrl(ctx, b.provider, token) });
  });

  app.patch('/v1/integrations/:id', async (req) => {
    const a = requireRole(req, 'admin');
    const { id } = parse(z.object({ id: z.string().uuid() }), req.params);
    const b = parse(updateSchema, req.body);
    await assertPixel(a.org.id, b.defaultPixelId);
    const cur = await ctx.db.query('SELECT provider FROM integrations WHERE id = $1 AND org_id = $2', [id, a.org.id]);
    if (!cur.rowCount) throw notFound('Integração não encontrada.');
    if (b.secret === null && ADAPTERS[cur.rows[0].provider as Provider].requiresSecret) throw badRequest('Este gateway exige segredo.');
    const r = await ctx.db.query(
      `UPDATE integrations SET name = COALESCE($3, name),
              secret_enc = CASE WHEN $4::boolean THEN $5 ELSE secret_enc END,
              default_pixel_id = CASE WHEN $6::boolean THEN $7::uuid ELSE default_pixel_id END,
              amount_unit = COALESCE($8, amount_unit), active = COALESCE($9, active), updated_at = now()
        WHERE id = $1 AND org_id = $2 RETURNING *`,
      [id, a.org.id, b.name ?? null, b.secret !== undefined, ctx.box.encryptNullable(b.secret),
        b.defaultPixelId !== undefined, b.defaultPixelId ?? null, b.amountUnit ?? null, b.active ?? null],
    );
    await audit(ctx, a.org.id, a.user.id, 'integration.updated', id, { secretChanged: b.secret !== undefined });
    return { integration: dto(r.rows[0]) };
  });

  app.post('/v1/integrations/:id/rotate-token', async (req) => {
    const a = requireRole(req, 'admin');
    const { id } = parse(z.object({ id: z.string().uuid() }), req.params);
    const token = integrationToken();
    const r = await ctx.db.query(
      'UPDATE integrations SET token_hash = $3, token_hint = $4, updated_at = now() WHERE id = $1 AND org_id = $2 RETURNING *',
      [id, a.org.id, sha256Hex(token), hint(token)],
    );
    if (!r.rowCount) throw notFound('Integração não encontrada.');
    await audit(ctx, a.org.id, a.user.id, 'integration.token_rotated', id);
    return { integration: dto(r.rows[0]), token, webhookUrl: webhookUrl(ctx, r.rows[0].provider, token) };
  });

  app.delete('/v1/integrations/:id', async (req) => {
    const a = requireRole(req, 'admin');
    const { id } = parse(z.object({ id: z.string().uuid() }), req.params);
    const r = await ctx.db.query('DELETE FROM integrations WHERE id = $1 AND org_id = $2', [id, a.org.id]);
    if (!r.rowCount) throw notFound('Integração não encontrada.');
    await audit(ctx, a.org.id, a.user.id, 'integration.deleted', id);
    return { ok: true };
  });

  /** Diagnóstico: webhooks recebidos (sem corpo, sem PII). */
  app.get('/v1/webhook-receipts', async (req) => {
    const a = requireRole(req, 'viewer');
    const q = parse(z.object({
      integrationId: z.string().uuid().optional(),
      outcome: z.enum(['processed', 'duplicate', 'ignored', 'rejected', 'failed']).optional(),
      cursor: z.coerce.number().int().optional(),
    }), req.query);
    const r = await ctx.db.query(
      `SELECT w.id, w.provider, w.correlation_id, w.received_at, w.signature_ok, w.signature_method, w.outcome, w.reason,
              w.gateway_event, w.transaction_id, w.payment_id, w.processing_ms, w.body_enc IS NOT NULL AS can_replay, i.name AS integration_name
         FROM webhook_receipts w LEFT JOIN integrations i ON i.id = w.integration_id
        WHERE w.org_id = $1 AND ($2::uuid IS NULL OR w.integration_id = $2) AND ($3::text IS NULL OR w.outcome = $3)
          AND ($4::bigint IS NULL OR w.id < $4)
        ORDER BY w.id DESC LIMIT 50`,
      [a.org.id, q.integrationId ?? null, q.outcome ?? null, q.cursor ?? null],
    );
    return { receipts: r.rows, nextCursor: r.rows.length === 50 ? r.rows[49].id : null };
  });
}
