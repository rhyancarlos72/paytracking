import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { Ctx } from '../context.js';
import { badRequest } from '../lib/errors.js';
import { auth, parse } from '../lib/http.js';
import { hit } from '../lib/rate-limit.js';

export const MAX_SOUND_BYTES = 1024 * 1024;

/** Reconhece o formato pelo conteúdo (assinatura do arquivo), não pelo nome ou tipo informado. */
export function sniffAudio(b: Buffer): string | null {
  if (b.length < 12) return null;
  if (b.subarray(0, 3).toString('latin1') === 'ID3' || (b[0] === 0xff && (b[1]! & 0xe0) === 0xe0 && (b[1]! & 0x06) !== 0)) return 'audio/mpeg';
  if (b[0] === 0xff && (b[1]! & 0xf6) === 0xf0) return 'audio/aac';
  if (b.subarray(0, 4).toString('latin1') === 'RIFF' && b.subarray(8, 12).toString('latin1') === 'WAVE') return 'audio/wav';
  if (b.subarray(0, 4).toString('latin1') === 'OggS') return 'audio/ogg';
  if (b.subarray(4, 8).toString('latin1') === 'ftyp') return 'audio/mp4';
  if (b.readUInt32BE(0) === 0x1a45dfa3) return 'audio/webm';
  return null;
}

/**
 * Som de venda próprio do usuário, guardado na conta (até 1 MB): o mesmo arquivo toca em todos
 * os aparelhos em que ele entrar. Só o próprio usuário lê, troca ou apaga o seu.
 */
export function saleSoundRoutes(app: FastifyInstance, ctx: Ctx) {
  app.get('/v1/me/sale-sound', async (req, reply) => {
    const a = auth(req);
    const r = await ctx.db.query<{ name: string; mime: string; data: Buffer; updated_at: Date }>(
      'SELECT name, mime, data, updated_at FROM user_sale_sounds WHERE user_id = $1', [a.user.id],
    );
    const row = r.rows[0];
    if (!row) return reply.code(204).send();
    return { name: row.name, updatedAt: row.updated_at, dataUrl: `data:${row.mime};base64,${row.data.toString('base64')}` };
  });

  // base64 ocupa ~4/3 do arquivo: limite do corpo acima do padrão só nesta rota
  app.put('/v1/me/sale-sound', { bodyLimit: Math.ceil(MAX_SOUND_BYTES * 1.4) + 4096 }, async (req) => {
    const a = auth(req);
    await hit(ctx.db, `sound:user:${a.user.id}`, 20, 3600);
    const body = parse(z.object({
      name: z.string().trim().min(1).max(120),
      dataUrl: z.string().regex(/^data:audio\/[\w.+-]+;base64,[A-Za-z0-9+/]+=*$/, 'Arquivo de áudio inválido.'),
    }), req.body);
    const data = Buffer.from(body.dataUrl.slice(body.dataUrl.indexOf(',') + 1), 'base64');
    if (data.length > MAX_SOUND_BYTES) throw badRequest('O arquivo precisa ter até 1 MB.');
    const mime = sniffAudio(data);
    if (!mime) throw badRequest('Formato não reconhecido. Use MP3, WAV, OGG, M4A ou WEBM.');
    const name = body.name.replace(/[^\p{L}\p{N} ._()-]/gu, '_');
    await ctx.db.query(
      `INSERT INTO user_sale_sounds(user_id, name, mime, data) VALUES ($1, $2, $3, $4)
       ON CONFLICT (user_id) DO UPDATE SET name = EXCLUDED.name, mime = EXCLUDED.mime, data = EXCLUDED.data, updated_at = now()`,
      [a.user.id, name, mime, data],
    );
    return { ok: true, name, mime, bytes: data.length };
  });

  app.delete('/v1/me/sale-sound', async (req) => {
    const a = auth(req);
    await ctx.db.query('DELETE FROM user_sale_sounds WHERE user_id = $1', [a.user.id]);
    return { ok: true };
  });
}
