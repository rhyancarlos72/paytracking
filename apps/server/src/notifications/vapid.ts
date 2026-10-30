import webpush from 'web-push';
import type { Ctx } from '../context.js';

export interface VapidKeys { publicKey: string; privateKey: string; subject: string; source: 'env' | 'database' }

let cached: { db: unknown; keys: VapidKeys } | null = null;

/**
 * Chaves VAPID do Web Push. Se não vierem do ambiente (VAPID_PUBLIC_KEY/VAPID_PRIVATE_KEY),
 * são geradas UMA vez e guardadas no banco (privada cifrada) — o push funciona sem configurar nada.
 * Trocar as chaves invalida as inscrições existentes, então elas nunca são regeradas.
 */
export async function getVapidKeys(ctx: Ctx): Promise<VapidKeys> {
  const subject = ctx.config.VAPID_SUBJECT;
  if (ctx.config.VAPID_PUBLIC_KEY && ctx.config.VAPID_PRIVATE_KEY) {
    return { publicKey: ctx.config.VAPID_PUBLIC_KEY, privateKey: ctx.config.VAPID_PRIVATE_KEY, subject, source: 'env' };
  }
  if (cached && cached.db === ctx.db) return cached.keys;
  const read = async () => {
    const r = await ctx.db.query<{ key: string; value: string }>(`SELECT key, value FROM app_settings WHERE key IN ('vapid_public', 'vapid_private_enc')`);
    const m = new Map(r.rows.map((x) => [x.key, x.value]));
    const pub = m.get('vapid_public');
    const priv = m.get('vapid_private_enc');
    return pub && priv ? { publicKey: pub, privateKey: ctx.box.decrypt(priv) } : null;
  };
  let found = await read();
  if (!found) {
    const k = webpush.generateVAPIDKeys();
    // várias instâncias subindo juntas: a primeira grava, as outras leem a mesma chave
    await ctx.db.query(
      `INSERT INTO app_settings(key, value) VALUES ('vapid_public', $1), ('vapid_private_enc', $2) ON CONFLICT (key) DO NOTHING`,
      [k.publicKey, ctx.box.encrypt(k.privateKey)],
    );
    found = await read();
    if (!found) throw new Error('Não foi possível guardar as chaves do Web Push');
    ctx.log.info({}, 'chaves VAPID do Web Push geradas e guardadas no banco');
  }
  const keys: VapidKeys = { ...found, subject, source: 'database' };
  cached = { db: ctx.db, keys };
  return keys;
}
