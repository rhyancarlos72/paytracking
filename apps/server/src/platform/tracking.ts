import type { FastifyInstance, FastifyRequest } from 'fastify';
import { buildServerEvent, UTM_KEYS } from '@pt/domain';
import type { Ctx } from '../context.js';
import { enqueueCapi } from '../capi/outbox.js';
import { wakeDispatcher } from '../capi/wake.js';
import { clientIp } from '../lib/http.js';

/**
 * Pixel da própria plataforma (marketing do PayTracking), independente dos pixels dos clientes.
 * É um pixel cadastrado na conta do dono (achado pela chave pública PLATFORM_PIXEL_KEY):
 *  - navegador: PageView nas páginas públicas (página de vendas e cadastro);
 *  - servidor: Lead quando alguém cria a conta e Purchase quando a assinatura é paga,
 *    pela Conversions API desse pixel (com fila, reenvio e deduplicação por event_id).
 * Se o pixel não existir no banco (desenvolvimento, testes), nada é enviado.
 */

type Q = { query: <R = any>(sql: string, params?: unknown[]) => Promise<{ rows: R[]; rowCount: number | null }> };
interface PlatformPixel { id: string; org_id: string }

async function platformPixel(ctx: Ctx, db: Q): Promise<PlatformPixel | null> {
  const key = ctx.config.PLATFORM_PIXEL_KEY.trim();
  if (!key || key === 'off') return null;
  const r = await db.query<PlatformPixel>('SELECT id, org_id FROM pixels WHERE public_key = $1 AND active', [key]);
  return r.rows[0] ?? null;
}

export const platformPixelInBrowser = (ctx: Ctx) => {
  const c = ctx.config;
  if (!c.PLATFORM_PIXEL_KEY || c.PLATFORM_PIXEL_KEY === 'off' || !c.PLATFORM_PIXEL_ID) return false;
  return c.PLATFORM_PIXEL_BROWSER === 'on' || (c.PLATFORM_PIXEL_BROWSER === 'auto' && c.isProd);
};

const FB_PARAM = /^fb\.\d\.\d{10,16}\.[\w.-]{6,500}$/;
const cookie = (req: FastifyRequest, name: string) => {
  const v = req.cookies?.[name];
  return v && FB_PARAM.test(v) ? v : null;
};

/**
 * No cadastro: guarda de onde a pessoa veio (cookies _fbp/_fbc gravados pelo pixel no próprio
 * domínio, IP, navegador e UTMs) e envia Lead. Nunca atrapalha o cadastro.
 */
export async function trackSignup(ctx: Ctx, req: FastifyRequest, u: { userId: string; orgId: string; email: string; name?: string | null; utms?: Record<string, unknown> }) {
  try {
    const utm = Object.fromEntries(UTM_KEYS.map((k) => [k, typeof u.utms?.[k] === 'string' ? String(u.utms[k]).slice(0, 200) : null]));
    const fbp = cookie(req, '_fbp');
    const fbc = cookie(req, '_fbc');
    const ip = clientIp(req) || null;
    const ua = String(req.headers['user-agent'] ?? '').slice(0, 400) || null;
    await ctx.db.query(
      `INSERT INTO signup_attribution(user_id, org_id, fbp, fbc, client_ip, user_agent, utm_source, utm_medium, utm_campaign, utm_content, utm_term, utm_id)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12) ON CONFLICT (user_id) DO NOTHING`,
      [u.userId, u.orgId, fbp, fbc, ip, ua, utm.utm_source, utm.utm_medium, utm.utm_campaign, utm.utm_content, utm.utm_term, utm.utm_id],
    );
    const px = await platformPixel(ctx, ctx.db);
    if (!px) return;
    const [first, ...rest] = (u.name ?? '').trim().split(/\s+/);
    const event = buildServerEvent({
      eventName: 'Lead', eventId: `pt_signup_${u.userId}`, eventTime: ctx.now().getTime() / 1000,
      eventSourceUrl: `${ctx.config.APP_URL.replace(/\/$/, '')}/criar-conta`,
      customer: { email: u.email, firstName: first || null, lastName: rest.join(' ') || null, externalId: u.userId, country: 'BR' },
      tracking: { fbp, fbc, clientIp: ip, userAgent: ua },
      contentName: 'PayTracking — cadastro (teste grátis)',
      utms: utm,
    });
    await enqueueCapi(ctx.db, { orgId: px.org_id, pixelId: px.id, event });
    wakeDispatcher();
  } catch (e) {
    ctx.log.warn({ err: String(e) }, 'pixel da plataforma: falha ao registrar cadastro');
  }
}

/** Assinatura paga: Purchase com o valor pago e os identificadores guardados no cadastro do dono. */
export async function trackSubscriptionPurchase(ctx: Ctx, c: Q, p: { orgId: string; amountMinor: bigint | string; correlationId: string }) {
  const px = await platformPixel(ctx, c);
  if (!px) return;
  const owner = await c.query<{ id: string; email: string; name: string | null; fbp: string | null; fbc: string | null; client_ip: string | null; user_agent: string | null } & Record<string, string | null>>(
    `SELECT u.id, u.email, u.name, a.fbp, a.fbc, host(a.client_ip) AS client_ip, a.user_agent,
            a.utm_source, a.utm_medium, a.utm_campaign, a.utm_content, a.utm_term, a.utm_id
       FROM memberships m JOIN users u ON u.id = m.user_id
       LEFT JOIN signup_attribution a ON a.user_id = u.id
      WHERE m.org_id = $1 AND m.role = 'owner' ORDER BY m.created_at LIMIT 1`,
    [p.orgId],
  );
  const o = owner.rows[0];
  if (!o) return;
  const [first, ...rest] = (o.name ?? '').trim().split(/\s+/);
  const amount = BigInt(p.amountMinor);
  const event = buildServerEvent({
    eventName: 'Purchase', eventId: `pt_billing_${p.correlationId}`, eventTime: ctx.now().getTime() / 1000,
    eventSourceUrl: `${ctx.config.APP_URL.replace(/\/$/, '')}/financeiro`,
    customer: { email: o.email, firstName: first || null, lastName: rest.join(' ') || null, externalId: o.id, country: 'BR' },
    tracking: { fbp: o.fbp, fbc: o.fbc, clientIp: o.client_ip, userAgent: o.user_agent },
    valueMinor: amount, currency: 'BRL', orderId: p.correlationId,
    products: [{ id: 'paytracking-mensal', name: 'PayTracking — assinatura mensal', quantity: 1, priceMinor: amount }],
    utms: Object.fromEntries(UTM_KEYS.map((k) => [k, o[k] ?? null])),
  });
  await enqueueCapi(c, { orgId: px.org_id, pixelId: px.id, event, correlationId: null });
}

export function platformTrackingRoutes(app: FastifyInstance, ctx: Ctx) {
  // configuração pública do pixel da plataforma (o snippet usa só dados públicos)
  // signedIn: quem já está logado não recebe o pixel (ele nunca entra no painel) — sem 401 no console
  app.get('/v1/public/tracking', async (req, reply) => {
    reply.header('Cache-Control', 'private, no-store');
    if (!platformPixelInBrowser(ctx) || req.auth) return { pixel: null, signedIn: !!req.auth };
    const api = ctx.config.PUBLIC_API_URL.replace(/\/$/, '');
    return { signedIn: false, pixel: { key: ctx.config.PLATFORM_PIXEL_KEY, pixelId: ctx.config.PLATFORM_PIXEL_ID, script: `${api}/pixel.js`, endpoint: `${api}/v1/collect`, currency: 'BRL', country: 'BR' } };
  });
}
