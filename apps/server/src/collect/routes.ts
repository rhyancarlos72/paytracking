import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { randomUUID } from 'node:crypto';
import { tx } from '@pt/db';
import { BROWSER_EVENTS, buildServerEvent, mapEventName, normalizeCurrency, parseAmount, UTM_KEYS } from '@pt/domain';
import type { Ctx } from '../context.js';
import { enqueueCapi } from '../capi/outbox.js';
import { sha256Hex } from '../lib/crypto.js';
import { rememberIdentity } from '../tracking/identity.js';

/**
 * Coleta de eventos do NAVEGADOR (porta de api/track.php) + resolução de pixel por produto.
 * - Purchase/Refund nunca são aceitos daqui (P-11).
 * - O MESMO event_id do Pixel é usado na CAPI (deduplicação Pixel↔CAPI).
 * - UNIQUE(pixel, evento, event_id) absorve o reenvio beacon+fetch.
 */

interface PixelRow {
  id: string; org_id: string; meta_pixel_id: string; currency: string; active: boolean;
  capi_token_enc: string | null; allowed_origins: string[];
}

/** Limitador em memória por instância (evita escrita no banco a cada evento). */
const buckets = new Map<string, { n: number; reset: number }>();
function allow(key: string, limit: number, windowMs: number): boolean {
  const now = Date.now();
  const b = buckets.get(key);
  if (!b || b.reset < now) {
    buckets.set(key, { n: 1, reset: now + windowMs });
    if (buckets.size > 50_000) for (const [k, v] of buckets) if (v.reset < now) buckets.delete(k);
    return true;
  }
  b.n++;
  return b.n <= limit;
}

const COUNTRY_HEADERS = ['cf-ipcountry', 'x-vercel-ip-country', 'x-appengine-country', 'x-country-code'];

function cors(req: FastifyRequest, reply: FastifyReply) {
  const origin = String(req.headers.origin ?? '');
  reply.header('Access-Control-Allow-Origin', origin || '*');
  reply.header('Vary', 'Origin');
  reply.header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  reply.header('Access-Control-Allow-Headers', 'Content-Type, X-Public-Key');
  reply.header('Access-Control-Max-Age', '86400');
}

const str = (v: unknown, n = 500): string | null => (typeof v === 'string' && v.trim() ? v.trim().slice(0, n) : typeof v === 'number' ? String(v) : null);

export function collectRoutes(app: FastifyInstance, ctx: Ctx) {
  async function pixelByKey(key: string, legacyToken: string): Promise<PixelRow | null> {
    const cols = 'p.id, p.org_id, p.meta_pixel_id, p.currency, p.active, p.capi_token_enc, p.allowed_origins';
    if (key && !key.startsWith('itk_')) {
      const r = await ctx.db.query(`SELECT ${cols} FROM pixels p WHERE p.public_key = $1`, [key]);
      return r.rows[0] ?? null;
    }
    // compatibilidade: snippets antigos com data-token="itk_…" (token de integração do projeto)
    const token = key || legacyToken;
    if (!token) return null;
    const r = await ctx.db.query(
      `SELECT ${cols} FROM integrations i JOIN pixels p ON p.id = i.default_pixel_id
        WHERE i.token_hash = $1 AND i.provider = 'checkout' AND i.active LIMIT 1`,
      [sha256Hex(token)],
    );
    return r.rows[0] ?? null;
  }

  async function collect(req: FastifyRequest, reply: FastifyReply) {
    cors(req, reply);
    const q = (req.query ?? {}) as Record<string, string | undefined>;
    const key = String(q.k ?? req.headers['x-public-key'] ?? '').trim();
    const pixel = await pixelByKey(key, String(q.t ?? '').trim());
    if (!pixel) return reply.code(401).send({ success: false, error: 'Invalid key' });
    if (!pixel.active) return reply.code(200).send({ success: true, queued: false, ignored: true, reason: 'pixel_inactive' });
    const origin = String(req.headers.origin ?? '');
    if (pixel.allowed_origins.length && origin && !pixel.allowed_origins.includes(origin)) {
      return reply.code(403).send({ success: false, error: 'Origin not allowed' });
    }
    if (!allow(`c:${req.ip}`, 120, 60_000) || !allow(`p:${pixel.id}`, 6000, 60_000)) {
      return reply.code(429).send({ success: false, error: 'rate_limited' });
    }

    let body: Record<string, unknown> = {};
    if (req.body && typeof req.body === 'object') body = req.body as Record<string, unknown>;
    else if (req.rawBody) {
      try { body = JSON.parse(req.rawBody); } catch { body = {}; }
    }
    const eventName = mapEventName(String(body.event ?? body.event_name ?? 'page_view'));
    if (!eventName) return reply.send({ success: true, queued: false, ignored: true });
    if (!BROWSER_EVENTS.includes(eventName)) {
      return reply.code(422).send({ success: false, error: `${eventName} must be sent via server webhook` });
    }
    let eventId = str(body.event_id, 200);
    if (!eventId || eventId.length > 128) eventId = randomUUID();

    const isPageView = eventName === 'PageView';
    const currency = isPageView ? null : (normalizeCurrency(body.currency) ?? pixel.currency.trim());
    const valueMinor = !isPageView && currency && body.value !== undefined ? parseAmount(body.value, currency, 'major') : null;
    const ua = String(req.headers['user-agent'] ?? '').slice(0, 512);
    const countryHeader = COUNTRY_HEADERS.map((h) => req.headers[h]).find((v) => typeof v === 'string' && /^[A-Za-z]{2}$/.test(v)) as string | undefined;
    const utms = Object.fromEntries(UTM_KEYS.map((k) => [k, str(body[k], 255)]));
    const products = Array.isArray(body.products)
      ? body.products.slice(0, 50).map((p: any) => ({
          id: str(p?.id, 120), name: str(p?.name, 200), quantity: Number(p?.quantity ?? 1) || 1,
          priceMinor: currency ? parseAmount(p?.price, currency, 'major') : null,
        }))
      : [];
    const pageUrl = str(body.event_source_url, 1000) ?? str(req.headers.referer, 1000);

    const event = buildServerEvent({
      eventName, eventId, eventTime: Math.floor(ctx.now().getTime() / 1000), eventSourceUrl: pageUrl,
      customer: {
        email: str(body.email, 190), phone: str(body.phone, 40), firstName: str(body.first_name, 80), lastName: str(body.last_name, 120),
        document: str(body.document, 30) ?? str(body.cpf, 30), externalId: str(body.external_id, 100),
        city: str(body.city, 80), state: str(body.state, 80), zip: str(body.zip, 20), country: str(body.country, 2) ?? countryHeader ?? null,
      },
      tracking: { fbp: str(body.fbp, 255), fbc: str(body.fbc, 255), clientIp: req.ip, userAgent: ua },
      valueMinor, currency, products, utms,
    });

    const result = await tx(ctx.db, async (c) => {
      const te = await c.query(
        `INSERT INTO tracking_events(org_id, pixel_id, event_name, event_id, source, value_minor, currency, page_url,
                                     utm_source, utm_medium, utm_campaign, utm_content, utm_term, utm_id, match_keys)
         VALUES ($1,$2,$3,$4,'browser',$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)
         ON CONFLICT (pixel_id, event_name, event_id) DO NOTHING RETURNING id`,
        [pixel.org_id, pixel.id, eventName, eventId, valueMinor, currency, pageUrl,
          ...UTM_KEYS.map((k) => utms[k]), Object.keys(event.user_data)],
      );
      if (!te.rowCount) return { duplicate: true, queued: false };
      const xid = str(body.external_id, 100);
      if (xid) {
        await rememberIdentity(c, pixel.org_id, {
          xid, fbp: str(body.fbp, 255), fbc: str(body.fbc, 255), ip: req.ip, userAgent: ua, country: countryHeader ?? null,
          email: str(body.email, 190), phone: str(body.phone, 40), sourceUrl: pageUrl, utms,
          checkoutSeen: eventName === 'InitiateCheckout' || eventName === 'AddPaymentInfo',
        });
      }
      const queued = pixel.capi_token_enc
        ? (await enqueueCapi(c, { orgId: pixel.org_id, pixelId: pixel.id, event, trackingEventId: te.rows[0].id })) !== null
        : false;
      return { duplicate: false, queued };
    });
    return reply.send({ success: true, ...result, event_id: eventId });
  }

  for (const path of ['/v1/collect', '/api/track.php']) {
    app.options(path, async (req, reply) => { cors(req, reply); return reply.code(204).send(); });
    app.post(path, collect);
    app.get(path, async (req, reply) => {
      cors(req, reply);
      return (req.query as Record<string, string>).pt_ping ? { pong: true } : reply.code(405).send({ success: false, error: 'Method not allowed' });
    });
  }

  /**
   * Resolve qual pixel o checkout global deve carregar para um produto.
   * Novo: escopo pela chave pública (organização) — corrige P-02b.
   * Legado (sem chave): só responde se o produto for INEQUÍVOCO entre todas as organizações.
   */
  async function pixelConfig(req: FastifyRequest, reply: FastifyReply) {
    cors(req, reply);
    // dado público (qual pixel atende o produto): cache curto deixa o checkout mais rápido
    reply.header('Cache-Control', 'public, max-age=300');
    reply.header('Timing-Allow-Origin', '*');
    const q = (req.query ?? {}) as Record<string, string | undefined>;
    const productId = String(q.produto_id ?? q.product_id ?? q.offer_id ?? q.product_sku ?? q.produtoId ?? q.productId ?? '').replace(/\s+/g, '');
    if (!productId) return reply.code(400).send({ success: false, error: 'Missing produto_id' });
    const key = String(q.key ?? q.k ?? '').trim();
    const sql = `SELECT p.meta_pixel_id, p.public_key, p.currency FROM pixel_products pp JOIN pixels p ON p.id = pp.pixel_id
                  WHERE pp.product_id = $1 AND p.active`;
    const r = key
      ? await ctx.db.query(`${sql} AND pp.org_id = (SELECT org_id FROM pixels WHERE public_key = $2)`, [productId, key])
      : await ctx.db.query(`${sql} LIMIT 2`, [productId]);
    if (r.rowCount !== 1) {
      if ((r.rowCount ?? 0) > 1) ctx.log.warn({ productId }, 'pixel-config legado ambíguo entre organizações');
      return reply.code(404).send({ success: false, error: 'No pixel for this product' });
    }
    const p = r.rows[0];
    return {
      success: true, pixel_id: p.meta_pixel_id, public_key: p.public_key, currency: String(p.currency).trim(),
      endpoint: `${ctx.config.PUBLIC_API_URL}/v1/collect`,
    };
  }
  for (const path of ['/v1/pixel-config', '/api/pixel-config.php']) {
    app.options(path, async (req, reply) => { cors(req, reply); return reply.code(204).send(); });
    app.get(path, pixelConfig);
  }
}
