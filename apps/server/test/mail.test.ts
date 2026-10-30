import { createServer, type Server } from 'node:net';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { loadConfig } from '../src/config.js';
import { createMailer, renderHtml } from '../src/lib/mailer.js';

/** Servidor SMTP mínimo (como o da hospedagem) que guarda o login e a mensagem recebida. */
let server: Server;
let port = 0;
const received: { auth: string; from: string; to: string; data: string }[] = [];

beforeAll(async () => {
  server = createServer((sock) => {
    const cur = { auth: '', from: '', to: '', data: '' };
    let inData = false;
    let buf = '';
    sock.write('220 smtp.teste ESMTP\r\n');
    sock.on('data', (chunk) => {
      buf += chunk.toString('utf8');
      let i: number;
      while ((i = buf.indexOf('\r\n')) >= 0) {
        const line = buf.slice(0, i);
        buf = buf.slice(i + 2);
        if (inData) {
          if (line === '.') { inData = false; received.push({ ...cur }); sock.write('250 OK enfileirado\r\n'); } else cur.data += line + '\n';
          continue;
        }
        const cmd = line.toUpperCase();
        if (cmd.startsWith('EHLO') || cmd.startsWith('HELO')) sock.write('250-smtp.teste\r\n250-AUTH PLAIN LOGIN\r\n250 8BITMIME\r\n');
        else if (cmd.startsWith('AUTH PLAIN')) { cur.auth = Buffer.from(line.split(' ')[2] ?? '', 'base64').toString('utf8'); sock.write('235 autenticado\r\n'); }
        else if (cmd.startsWith('MAIL FROM')) { cur.from = line; sock.write('250 OK\r\n'); }
        else if (cmd.startsWith('RCPT TO')) { cur.to = line; sock.write('250 OK\r\n'); }
        else if (cmd === 'DATA') { inData = true; sock.write('354 envie\r\n'); }
        else if (cmd === 'QUIT') { sock.write('221 tchau\r\n'); sock.end(); }
        else sock.write('250 OK\r\n');
      }
    });
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  port = (server.address() as { port: number }).port;
});
afterAll(() => { server.close(); });

describe('e-mail por SMTP (e-mail da hospedagem)', () => {
  it('envia com login, texto e HTML com botão', async () => {
    const config = loadConfig({
      DATABASE_URL: 'x', ENCRYPTION_KEY: Buffer.alloc(32).toString('base64'),
      SMTP_HOST: '127.0.0.1', SMTP_PORT: String(port), SMTP_SECURE: 'false', SMTP_USER: 'no-reply@loja.com.br', SMTP_PASS: 'senha-da-caixa',
      MAIL_FROM: 'PayTracking <no-reply@loja.com.br>',
    });
    const mailer = createMailer(config, { info() {}, warn() {}, error() {} });
    expect(mailer.kind).toBe('smtp');
    await mailer.send({ to: 'cliente@exemplo.com', subject: 'Redefinir senha', text: 'Para criar uma nova senha acesse: https://app.loja.com.br/redefinir-senha?token=abc\n\nO link expira em 1 hora.' });
    const m = received.at(-1)!;
    expect(m.auth).toBe('\u0000no-reply@loja.com.br\u0000senha-da-caixa');
    expect(m.to).toContain('cliente@exemplo.com');
    expect(m.data).toContain('Subject: Redefinir senha');
    expect(m.data).toContain('text/html');
    expect(m.data).toContain('text/plain');
  });

  it('HTML: link vira botão e o texto é escapado', () => {
    const html = renderHtml({ to: 'x', subject: 's', text: 'Olá <script>alert(1)</script>\nAceite em: https://app.x.com/convite?token=1&a=2' });
    expect(html).not.toContain('<script>');
    expect(html).toContain('&lt;script&gt;');
    expect(html).toContain('href="https://app.x.com/convite?token=1&amp;a=2"');
    expect(html).toContain('Abrir no PayTracking');
  });

  it('sem SMTP nem Resend em produção: avisa no log que não enviou', async () => {
    const errors: string[] = [];
    const config = loadConfig({ DATABASE_URL: 'x', ENCRYPTION_KEY: Buffer.alloc(32).toString('base64'), NODE_ENV: 'production', TRUST_PROXY: '1', APP_URL: 'https://a.b', PUBLIC_API_URL: 'https://a.b' });
    const mailer = createMailer(config, { info() {}, warn() {}, error(_o, m) { errors.push(String(m)); } });
    await mailer.send({ to: 'a@b.c', subject: 's', text: 't' });
    expect(errors[0]).toContain('SMTP_HOST');
  });
});
