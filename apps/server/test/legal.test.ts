import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { setup, type TestEnv } from './helpers.js';

let env: TestEnv;
beforeAll(async () => {
  env = await setup({ LEGAL_NAME: 'Empresa Exemplo <b>LTDA</b>', LEGAL_DOCUMENT: '00.000.000/0001-00', PRIVACY_CONTACT: 'privacidade@exemplo.com.br' });
});
afterAll(async () => { await env.close(); });

describe('páginas legais (lidas pelo Google sem JavaScript)', () => {
  it('política de privacidade completa, com a seção de dados do Google e Uso Limitado', async () => {
    const r = await env.app.inject({ method: 'GET', url: '/privacidade' });
    expect(r.statusCode).toBe(200);
    expect(r.headers['content-type']).toContain('text/html');
    const html = r.body;
    expect(html).toContain('<h1>Política de Privacidade</h1>');
    expect(html).toContain('Dados do Google');
    expect(html).toContain('openid</code>, <code>email</code> e <code>profile');
    expect(html).toContain('requisitos de Uso Limitado');
    expect(html).toContain('https://developers.google.com/terms/api-services-user-data-policy');
    expect(html).toContain('mailto:privacidade@exemplo.com.br');
    expect(html).toContain('Empresa Exemplo &lt;b&gt;LTDA&lt;/b&gt;, inscrita no CNPJ/CPF sob o nº 00.000.000/0001-00');
    expect(html).not.toContain('<b>LTDA</b>'); // variável escapada
    expect(html).not.toContain('<script');
    expect(html.replace(/<[^>]+>/g, ' ').split(/\s+/).length).toBeGreaterThan(1500); // conteúdo suficiente
    expect(r.headers['content-security-policy']).toContain("default-src 'none'");
    expect((await env.app.inject({ method: 'GET', url: '/politica-de-privacidade' })).statusCode).toBe(200);
  });

  it('termos de uso com teste grátis, preço e sem taxa por venda', async () => {
    const r = await env.app.inject({ method: 'GET', url: '/termos' });
    expect(r.statusCode).toBe(200);
    expect(r.body).toContain('7 dias de teste grátis');
    expect(r.body.replace(/\u00a0/g, ' ')).toContain('R$ 47,00 por mês');
    expect(r.body).toContain('Não cobramos taxa ou porcentagem sobre as vendas');
    expect(r.body).toContain('href="/privacidade"');
  });
});
