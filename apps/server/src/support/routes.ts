import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { normPhoneE164 } from '@pt/domain';
import type { Ctx } from '../context.js';
import { badRequest } from '../lib/errors.js';
import { parse, requirePlatformAdmin } from '../lib/http.js';

/**
 * Suporte pelo WhatsApp: o dono da plataforma define o número no Admin; o painel e a página de
 * vendas mostram o botão (sem número configurado, o botão não aparece).
 */
const DEFAULT_MESSAGE = 'Olá! Preciso de ajuda com o PayTracking.';

export async function supportSettings(ctx: Ctx): Promise<{ whatsapp: string | null; message: string }> {
  const r = await ctx.db.query<{ key: string; value: string }>(`SELECT key, value FROM app_settings WHERE key IN ('support_whatsapp', 'support_message')`);
  const m = Object.fromEntries(r.rows.map((x) => [x.key, x.value]));
  const whatsapp = m.support_whatsapp || normPhoneE164(ctx.config.SUPPORT_WHATSAPP, 'BR') || null;
  return { whatsapp, message: m.support_message || DEFAULT_MESSAGE };
}

export function supportRoutes(app: FastifyInstance, ctx: Ctx) {
  app.get('/v1/public/support', async (_req, reply) => {
    reply.header('Cache-Control', 'no-cache'); // mudou no Admin → vale na próxima página aberta
    return supportSettings(ctx);
  });

  app.put('/v1/admin/support', async (req) => {
    const a = requirePlatformAdmin(req);
    const b = parse(z.object({ whatsapp: z.string().max(40), message: z.string().max(300).optional() }), req.body);
    const raw = b.whatsapp.trim();
    const number = raw ? normPhoneE164(raw, 'BR') : null;
    if (raw && (!number || number.length < 10 || number.length > 15)) throw badRequest('Número de WhatsApp inválido. Use DDD + número (ex.: 11 99999-0000) ou +DDI para outro país.');
    await ctx.db.query(
      `INSERT INTO app_settings(key, value, updated_at) VALUES ('support_whatsapp', $1, now()), ('support_message', $2, now())
       ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now()`,
      [number ?? '', (b.message ?? '').trim()],
    );
    await ctx.db.query(`INSERT INTO audit_log(org_id, user_id, action, target) VALUES ($1, $2, 'platform.support_changed', 'whatsapp')`, [a.org.id, a.user.id]);
    return supportSettings(ctx);
  });
}
