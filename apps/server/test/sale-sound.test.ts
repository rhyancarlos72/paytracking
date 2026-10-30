import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { sniffAudio } from '../src/notifications/sound.js';
import { Client, newAccount, setup, type TestEnv } from './helpers.js';

let env: TestEnv;
beforeAll(async () => { env = await setup(); });
afterAll(async () => { await env.close(); });

/** WAV mínimo válido (silêncio), gerado na hora. */
function wav(samples = 800): Buffer {
  const data = Buffer.alloc(samples * 2);
  const h = Buffer.alloc(44);
  h.write('RIFF', 0); h.writeUInt32LE(36 + data.length, 4); h.write('WAVE', 8); h.write('fmt ', 12);
  h.writeUInt32LE(16, 16); h.writeUInt16LE(1, 20); h.writeUInt16LE(1, 22); h.writeUInt32LE(8000, 24);
  h.writeUInt32LE(16000, 28); h.writeUInt16LE(2, 32); h.writeUInt16LE(16, 34); h.write('data', 36); h.writeUInt32LE(data.length, 40);
  return Buffer.concat([h, data]);
}
const dataUrl = (b: Buffer, mime = 'audio/wav') => `data:${mime};base64,${b.toString('base64')}`;

describe('som de venda salvo na conta', () => {
  it('reconhece formatos pelo conteúdo', () => {
    expect(sniffAudio(wav())).toBe('audio/wav');
    expect(sniffAudio(Buffer.from('ID3\x03\x00\x00\x00\x00\x00\x00\x00\x00', 'latin1'))).toBe('audio/mpeg');
    expect(sniffAudio(Buffer.from('<script>alert(1)</script>'))).toBeNull();
  });

  it('salva, toca em outro aparelho (outra sessão), troca e apaga', async () => {
    const { client, email } = await newAccount(env);
    expect((await client.get('/v1/me/sale-sound')).status).toBe(204);
    const up = await client.put('/v1/me/sale-sound', { name: 'meu som.wav', dataUrl: dataUrl(wav()) });
    expect(up.status).toBe(200);
    expect(up.data.mime).toBe('audio/wav');

    // "outro celular": nova sessão da mesma conta recebe o mesmo arquivo
    const other = new Client(env);
    await other.post('/v1/auth/login', { email, password: 'SenhaForte123' });
    const got = await other.get('/v1/me/sale-sound');
    expect(got.status).toBe(200);
    expect(got.data.name).toBe('meu som.wav');
    expect(got.data.dataUrl).toBe(dataUrl(wav()));
    expect(got.headers['cache-control']).toBe('no-store');

    expect((await other.del('/v1/me/sale-sound')).status).toBe(200);
    expect((await client.get('/v1/me/sale-sound')).status).toBe(204);
  });

  it('cada usuário só vê o próprio som', async () => {
    const a = await newAccount(env);
    const b = await newAccount(env);
    await a.client.put('/v1/me/sale-sound', { name: 'a.wav', dataUrl: dataUrl(wav()) });
    expect((await b.client.get('/v1/me/sale-sound')).status).toBe(204);
    expect((await new Client(env).get('/v1/me/sale-sound')).status).toBe(401);
  });

  it('recusa arquivo que não é áudio, acima de 1 MB ou sem login', async () => {
    const { client } = await newAccount(env);
    const fake = Buffer.from('<html><script>alert(1)</script></html>'.repeat(4));
    expect((await client.put('/v1/me/sale-sound', { name: 'x.mp3', dataUrl: dataUrl(fake, 'audio/mpeg') })).status).toBe(400);
    const big = Buffer.concat([wav(), Buffer.alloc(1024 * 1024)]);
    expect((await client.put('/v1/me/sale-sound', { name: 'grande.wav', dataUrl: dataUrl(big) })).status).toBe(400);
    expect((await client.put('/v1/me/sale-sound', { name: 'x.wav', dataUrl: 'javascript:alert(1)' })).status).toBe(400);
    expect((await new Client(env).put('/v1/me/sale-sound', { name: 'x.wav', dataUrl: dataUrl(wav()) })).status).toBe(401);
  });
});
