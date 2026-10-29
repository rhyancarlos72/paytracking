import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { tx } from '@pt/db';
import type { Ctx } from '../context.js';
import { publicKey } from '../lib/crypto.js';
import { badRequest, conflict, notFound } from '../lib/errors.js';
import { parse, requireRole } from '../lib/http.js';
import { audit } from '../orgs/routes.js';

const pixelInput = z.object({
  name: z.string().trim().min(1).max(120),
  metaPixelId: z.string().trim().regex(/^\d{6,32}$/, 'Pixel ID inválido (apenas dígitos)'),
  capiToken: z.string().trim().min(20).max(1000).optional(),
  testEventCode: z.string().trim().max(64).optional().nullable(),
  currency: z.string().regex(/^[A-Z]{3}$/).default('BRL'),
  country: z.string().regex(/^[A-Z]{2}$/).default('BR'),
  productIds: z.array(z.string().trim().min(1).max(120)).max(500).default([]),
  icRuleType: z.enum(['none', 'contains', 'equals', 'starts_with']).default('none'),
  icRuleValue: z.string().trim().max(500).optional().nullable(),
  sendRefundEvent: z.boolean().default(true),
  allowedOrigins: z.array(z.string().url()).max(50).default([]),
});

export function normalizeProductIds(list: string[]): string[] {
  const out = new Set<string>();
  for (const raw of list) for (const p of raw.split(/[\s,;]+/)) if (p.trim()) out.add(p.trim());
  return [...out];
}

type PixelRow = Record<string, any>;

export function pixelDto(p: PixelRow, ctx: Ctx) {
  const api = ctx.config.PUBLIC_API_URL;
  return {
    id: p.id,
    name: p.name,
    metaPixelId: p.meta_pixel_id,
    capiTokenConfigured: !!p.capi_token_enc,
    testEventCode: p.test_event_code,
    currency: p.currency.trim(),
    country: p.country.trim(),
    publicKey: p.public_key,
    active: p.active,
    icRuleType: p.ic_rule_type,
    icRuleValue: p.ic_rule_value,
    sendRefundEvent: p.send_refund_event,
    allowedOrigins: p.allowed_origins,
    productIds: p.product_ids ?? [],
    createdAt: p.created_at,
    snippets: snippets(api, p),
  };
}

/** Snippets de instalação — mesmos atributos data-* do pixel.js legado (compatível). */
export function snippets(api: string, p: PixelRow) {
  const attrs = (extra: Record<string, string>) => {
    const all: Record<string, string> = {
      'data-key': p.public_key, 'data-pixel-id': p.meta_pixel_id, 'data-endpoint': `${api}/v1/collect`,
      'data-currency': p.currency.trim(), 'data-country': p.country.trim(), ...extra,
    };
    return Object.entries(all).map(([k, v]) => `s.setAttribute(${JSON.stringify(k)},${JSON.stringify(v)});`).join('');
  };
  const wrap = (a: string) =>
    `<script>!function(){var s=document.createElement("script");s.async=true;s.src=${JSON.stringify(`${api}/pixel.js`)};${a}document.head.appendChild(s)}();</script>`;
  const click: Record<string, string> = { 'data-ic-click': '1' };
  if (p.ic_rule_type !== 'none' && p.ic_rule_value) {
    click['data-ic-rule'] = p.ic_rule_type;
    click['data-ic-value'] = p.ic_rule_value;
  }
  return {
    salesPage: wrap(attrs({})),
    salesPageWithClickIc: wrap(attrs(click)),
    checkoutPage: wrap(attrs({ 'data-ic-onload': '1' })),
    globalCheckoutLoader: `<script src=${JSON.stringify(`${api}/checkout-loader.js`)} data-key=${JSON.stringify(p.public_key)} defer></script>`,
  };
}

async function loadPixel(ctx: Ctx, orgId: string, id: string): Promise<PixelRow> {
  const r = await ctx.db.query(
    `SELECT p.*, COALESCE((SELECT array_agg(product_id ORDER BY product_id) FROM pixel_products pp WHERE pp.pixel_id = p.id), '{}') AS product_ids
       FROM pixels p WHERE p.id = $1 AND p.org_id = $2`,
    [id, orgId],
  );
  if (!r.rows[0]) throw notFound('Pixel não encontrado.');
  return r.rows[0];
}

async function setProducts(c: { query: Ctx['db']['query'] }, orgId: string, pixelId: string, ids: string[]) {
  if (ids.length) {
    const clash = await c.query(
      `SELECT pp.product_id, p.name FROM pixel_products pp JOIN pixels p ON p.id = pp.pixel_id
        WHERE pp.org_id = $1 AND pp.pixel_id <> $2 AND pp.product_id = ANY($3)`,
      [orgId, pixelId, ids],
    );
    if (clash.rowCount) {
      const list = clash.rows.map((r: any) => `${r.product_id} (pixel "${r.name}")`).join(', ');
      throw conflict(`Produto já vinculado a outro pixel: ${list}. Remova de lá antes.`);
    }
  }
  await c.query('DELETE FROM pixel_products WHERE pixel_id = $1 AND NOT (product_id = ANY($2))', [pixelId, ids]);
  for (const pid of ids) {
    await c.query(
      'INSERT INTO pixel_products(org_id, pixel_id, product_id) VALUES ($1, $2, $3) ON CONFLICT (org_id, product_id) DO NOTHING',
      [orgId, pixelId, pid],
    );
  }
}

export function pixelRoutes(app: FastifyInstance, ctx: Ctx) {
  app.get('/v1/pixels', async (req) => {
    const a = requireRole(req, 'viewer');
    const r = await ctx.db.query(
      `SELECT p.*, COALESCE((SELECT array_agg(product_id ORDER BY product_id) FROM pixel_products pp WHERE pp.pixel_id = p.id), '{}') AS product_ids
         FROM pixels p WHERE p.org_id = $1 ORDER BY p.created_at DESC`,
      [a.org.id],
    );
    return { pixels: r.rows.map((p) => pixelDto(p, ctx)) };
  });

  app.post('/v1/pixels', async (req, reply) => {
    const a = requireRole(req, 'admin');
    const b = parse(pixelInput, req.body);
    if (!b.capiToken) throw badRequest('Informe o token de acesso da Conversions API.');
    if (b.icRuleType !== 'none' && !b.icRuleValue) throw badRequest('Informe a URL/trecho do checkout para a regra de InitiateCheckout.');
    const ids = normalizeProductIds(b.productIds);
    const id = await tx(ctx.db, async (c) => {
      const r = await c.query<{ id: string }>(
        `INSERT INTO pixels(org_id, name, meta_pixel_id, capi_token_enc, test_event_code, currency, country, public_key,
                            ic_rule_type, ic_rule_value, send_refund_event, allowed_origins)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) RETURNING id`,
        [a.org.id, b.name, b.metaPixelId, ctx.box.encrypt(b.capiToken!), b.testEventCode || null, b.currency, b.country,
          publicKey(), b.icRuleType, b.icRuleType === 'none' ? null : b.icRuleValue, b.sendRefundEvent, b.allowedOrigins],
      );
      const pid = r.rows[0]!.id;
      await setProducts(c, a.org.id, pid, ids);
      return pid;
    });
    await audit(ctx, a.org.id, a.user.id, 'pixel.created', id);
    return reply.code(201).send({ pixel: pixelDto(await loadPixel(ctx, a.org.id, id), ctx) });
  });

  app.put('/v1/pixels/:id', async (req) => {
    const a = requireRole(req, 'admin');
    const { id } = parse(z.object({ id: z.string().uuid() }), req.params);
    const b = parse(pixelInput, req.body);
    await loadPixel(ctx, a.org.id, id);
    if (b.icRuleType !== 'none' && !b.icRuleValue) throw badRequest('Informe a URL/trecho do checkout para a regra de InitiateCheckout.');
    await tx(ctx.db, async (c) => {
      await c.query(
        `UPDATE pixels SET name=$3, meta_pixel_id=$4, capi_token_enc=COALESCE($5, capi_token_enc), test_event_code=$6,
                currency=$7, country=$8, ic_rule_type=$9, ic_rule_value=$10, send_refund_event=$11, allowed_origins=$12, updated_at=now()
          WHERE id=$1 AND org_id=$2`,
        [id, a.org.id, b.name, b.metaPixelId, b.capiToken ? ctx.box.encrypt(b.capiToken) : null, b.testEventCode || null,
          b.currency, b.country, b.icRuleType, b.icRuleType === 'none' ? null : b.icRuleValue, b.sendRefundEvent, b.allowedOrigins],
      );
      await setProducts(c, a.org.id, id, normalizeProductIds(b.productIds));
    });
    await audit(ctx, a.org.id, a.user.id, 'pixel.updated', id, { capiTokenChanged: !!b.capiToken });
    return { pixel: pixelDto(await loadPixel(ctx, a.org.id, id), ctx) };
  });

  app.post('/v1/pixels/:id/toggle', async (req) => {
    const a = requireRole(req, 'admin');
    const { id } = parse(z.object({ id: z.string().uuid() }), req.params);
    const r = await ctx.db.query('UPDATE pixels SET active = NOT active, updated_at = now() WHERE id = $1 AND org_id = $2 RETURNING active', [id, a.org.id]);
    if (!r.rowCount) throw notFound('Pixel não encontrado.');
    await audit(ctx, a.org.id, a.user.id, 'pixel.toggled', id, { active: r.rows[0].active });
    return { active: r.rows[0].active };
  });

  app.post('/v1/pixels/bulk-active', async (req) => {
    const a = requireRole(req, 'admin');
    const { active } = parse(z.object({ active: z.boolean() }), req.body);
    const r = await ctx.db.query('UPDATE pixels SET active = $2, updated_at = now() WHERE org_id = $1 AND active <> $2', [a.org.id, active]);
    await audit(ctx, a.org.id, a.user.id, active ? 'pixel.activate_all' : 'pixel.deactivate_all');
    return { changed: r.rowCount };
  });

  app.post('/v1/pixels/:id/rotate-key', async (req) => {
    const a = requireRole(req, 'admin');
    const { id } = parse(z.object({ id: z.string().uuid() }), req.params);
    const r = await ctx.db.query('UPDATE pixels SET public_key = $3, updated_at = now() WHERE id = $1 AND org_id = $2', [id, a.org.id, publicKey()]);
    if (!r.rowCount) throw notFound('Pixel não encontrado.');
    await audit(ctx, a.org.id, a.user.id, 'pixel.key_rotated', id);
    return { pixel: pixelDto(await loadPixel(ctx, a.org.id, id), ctx) };
  });

  /** Excluir pixel preserva o histórico de vendas (payments.pixel_id = NULL) — corrige P-32. */
  app.delete('/v1/pixels/:id', async (req) => {
    const a = requireRole(req, 'admin');
    const { id } = parse(z.object({ id: z.string().uuid() }), req.params);
    const r = await ctx.db.query('DELETE FROM pixels WHERE id = $1 AND org_id = $2', [id, a.org.id]);
    if (!r.rowCount) throw notFound('Pixel não encontrado.');
    await audit(ctx, a.org.id, a.user.id, 'pixel.deleted', id);
    return { ok: true };
  });

  /** Valida Pixel ID + token na Graph API sem enviar evento. */
  app.post('/v1/pixels/:id/verify', async (req) => {
    const a = requireRole(req, 'admin');
    const { id } = parse(z.object({ id: z.string().uuid() }), req.params);
    const p = await loadPixel(ctx, a.org.id, id);
    if (!p.capi_token_enc) return { ok: false, message: 'Token da CAPI não configurado.' };
    const url = `${ctx.config.META_GRAPH_BASE_URL}/${ctx.config.META_GRAPH_VERSION}/${p.meta_pixel_id}?fields=id,name`;
    try {
      const res = await ctx.fetch(url, { headers: { Authorization: `Bearer ${ctx.box.decrypt(p.capi_token_enc)}` }, signal: AbortSignal.timeout(10_000) });
      const body = (await res.json().catch(() => ({}))) as any;
      if (res.ok && body.id) return { ok: true, message: `Conectado ao pixel "${body.name ?? body.id}".` };
      return { ok: false, message: body?.error?.message ?? `HTTP ${res.status}` };
    } catch (e) {
      return { ok: false, message: `Falha de rede: ${(e as Error).message}` };
    }
  });
}
