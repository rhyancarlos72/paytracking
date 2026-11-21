import Fastify from 'fastify';
import { describe, expect, it } from 'vitest';
import { isCloudflareIp, trustHopsAndCloudflare } from '../src/lib/cloudflare.js';

describe('IP real do visitante atrás da Cloudflare', () => {
  it('reconhece as faixas da Cloudflare (IPv4, IPv6 e IPv4 em formato IPv6)', () => {
    expect(isCloudflareIp('172.70.1.1')).toBe(true);
    expect(isCloudflareIp('104.16.0.1')).toBe(true);
    expect(isCloudflareIp('2606:4700::6810:1')).toBe(true);
    expect(isCloudflareIp('::ffff:162.158.1.2')).toBe(true);
    expect(isCloudflareIp('177.20.30.40')).toBe(false);
    expect(isCloudflareIp('lixo')).toBe(false);
  });

  it('req.ip = comprador; nunca o IP da Cloudflare nem um IP falsificado no cabeçalho', async () => {
    const app = Fastify({ trustProxy: trustHopsAndCloudflare(1) });
    app.get('/ip', async (req) => ({ ip: req.ip }));
    const ip = async (xff: string | undefined) =>
      (await app.inject({ method: 'GET', url: '/ip', remoteAddress: '10.0.0.5', headers: xff ? { 'x-forwarded-for': xff } : {} })).json().ip;
    expect(await ip('177.20.30.40')).toBe('177.20.30.40');                                  // sem Cloudflare (como hoje)
    expect(await ip('177.20.30.40, 172.70.1.1')).toBe('177.20.30.40');                      // com Cloudflare
    expect(await ip('2804:14c::1, 2606:4700::6810:1')).toBe('2804:14c::1');                  // IPv6 com Cloudflare
    expect(await ip('6.6.6.6, 177.20.30.40, 172.70.1.1')).toBe('177.20.30.40');             // visitante tentando falsificar
    expect(await ip('6.6.6.6, 9.9.9.9')).toBe('9.9.9.9');                                    // acesso direto (sem Cloudflare) não é enganado
    expect(await ip(undefined)).toBe('10.0.0.5');
    await app.close();
  });
});
