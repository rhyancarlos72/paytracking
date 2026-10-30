import nodemailer from 'nodemailer';
import type { Config } from '../config.js';
import type { Logger } from '../context.js';

export interface Mail {
  to: string;
  subject: string;
  text: string;
}

export interface Mailer {
  /** qual canal está ativo (exibido no painel de admin) */
  readonly kind: 'smtp' | 'resend' | 'log';
  send(mail: Mail): Promise<void>;
}

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));

/**
 * Versão HTML do e-mail (mesmo conteúdo do texto), feita para Gmail/Outlook/Apple Mail:
 * tabelas + estilos inline, sem imagens externas (não rastreia quem abre e não cai em spam por
 * imagem remota). O título vem do assunto; links viram botão; "Chave: valor" vira tabela de dados.
 */
export function renderHtml(mail: Mail): string {
  const title = mail.subject.replace(/\s+—\s+PayTracking$/, '');
  const alert = /^Alerta de segurança/i.test(title);
  const accent = alert ? '#e5484d' : '#6d4aff';
  const lines = mail.text.split('\n');
  const preheader = esc((lines.find((l) => l.trim() && !/https?:\/\//.test(l)) ?? '').slice(0, 140));
  const facts: string[] = [];
  const flushFacts = () => {
    if (!facts.length) return '';
    const rows = facts.splice(0).join('');
    return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:4px 0 20px;background:#f6f5fb;border-radius:12px">${rows}</table>`;
  };
  let body = '';
  for (const l of lines) {
    const link = /^(.*?)(https?:\/\/\S+)\s*$/.exec(l);
    const fact = /^([A-Za-zÀ-ú ]{2,20}):\s+(.+)$/.exec(l.trim());
    if (fact && !link) {
      facts.push(`<tr><td style="padding:10px 16px;font-size:13px;color:#5d6378;white-space:nowrap;vertical-align:top">${esc(fact[1]!)}</td><td style="padding:10px 16px;font-size:14px;color:#0b0d1a;font-weight:600">${esc(fact[2]!)}</td></tr>`);
      continue;
    }
    body += flushFacts();
    if (link) {
      const label = link[1]!.replace(/[:\s]+$/, '').trim();
      const url = esc(link[2]!);
      body += `${label ? `<p style="margin:0 0 16px">${esc(label)}:</p>` : ''}`
        + `<table role="presentation" cellpadding="0" cellspacing="0" style="margin:8px 0 24px"><tr><td style="border-radius:12px;background:${accent}">`
        + `<a href="${url}" style="display:inline-block;padding:14px 28px;font-size:15px;font-weight:700;color:#ffffff;text-decoration:none;border-radius:12px">Abrir no PayTracking &rarr;</a>`
        + `</td></tr></table>`
        + `<p style="margin:0 0 20px;font-size:12px;line-height:1.5;color:#8a8fa3;word-break:break-all">Se o botão não funcionar, copie e cole no navegador:<br><a href="${url}" style="color:${accent}">${url}</a></p>`;
    } else if (l.trim()) {
      body += `<p style="margin:0 0 14px">${esc(l)}</p>`;
    }
  }
  body += flushFacts();
  return `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="color-scheme" content="light"><title>${esc(title)}</title></head>
<body style="margin:0;padding:0;background:#f1f0f7;font-family:Inter,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;color:#0b0d1a;-webkit-font-smoothing:antialiased">
<div style="display:none;max-height:0;overflow:hidden;opacity:0">${preheader}</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f1f0f7"><tr><td align="center" style="padding:36px 16px">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px">
<tr><td style="padding:0 4px 18px"><table role="presentation" cellpadding="0" cellspacing="0"><tr>
<td style="width:34px;height:34px;border-radius:10px;background:#6d4aff;color:#ffffff;font-weight:800;font-size:17px;text-align:center;vertical-align:middle">P</td>
<td style="padding-left:10px;font-size:17px;font-weight:700;color:#0b0d1a">PayTracking</td></tr></table></td></tr>
<tr><td style="background:#ffffff;border-radius:20px;overflow:hidden;box-shadow:0 1px 3px rgba(16,12,40,.06)">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td style="height:6px;background:${alert ? '#e5484d' : 'linear-gradient(90deg,#8b70ff,#5b3df5 50%,#22d3ee)'};background-color:${accent}"></td></tr>
<tr><td style="padding:36px 36px 12px">
<h1 style="margin:0 0 20px;font-size:24px;line-height:1.25;font-weight:700;letter-spacing:-.01em;color:#0b0d1a">${alert ? '&#128737;&#65039; ' : ''}${esc(title)}</h1>
<div style="font-size:15px;line-height:1.6;color:#2b2f40">${body}</div>
</td></tr>
<tr><td style="padding:0 36px 32px"><p style="margin:0;padding-top:20px;border-top:1px solid #eceaf3;font-size:12px;line-height:1.55;color:#8a8fa3">Este é um e-mail automático de segurança da sua conta. A equipe PayTracking nunca pede sua senha ou códigos por e-mail, WhatsApp ou telefone.</p></td></tr>
</table></td></tr>
<tr><td align="center" style="padding:20px 8px 0;font-size:12px;line-height:1.5;color:#8a8fa3">Você recebeu este e-mail porque tem uma conta no PayTracking.<br>&copy; PayTracking &middot; rastreamento de vendas e conversões</td></tr>
</table></td></tr></table></body></html>`;
}

/**
 * Envio de e-mail transacional (recuperação de senha, verificação, convites), nesta ordem:
 *  1. SMTP (ex.: o e-mail da sua hospedagem — SMTP_HOST/SMTP_USER/SMTP_PASS);
 *  2. Resend (RESEND_API_KEY);
 *  3. desenvolvimento: só registra no log (em produção avisa que NÃO enviou).
 */
export function createMailer(config: Config, log: Logger): Mailer {
  if (config.SMTP_HOST) {
    const port = config.SMTP_PORT;
    const transport = nodemailer.createTransport({
      host: config.SMTP_HOST,
      port,
      secure: config.SMTP_SECURE ?? port === 465, // 465 = SSL direto; 587 = STARTTLS
      requireTLS: port === 587,
      auth: config.SMTP_USER ? { user: config.SMTP_USER, pass: config.SMTP_PASS } : undefined,
      connectionTimeout: 10_000,
      greetingTimeout: 10_000,
      socketTimeout: 20_000,
      tls: { minVersion: 'TLSv1.2' },
    });
    return {
      kind: 'smtp',
      async send(mail) {
        await transport.sendMail({ from: config.MAIL_FROM, to: mail.to, subject: mail.subject, text: mail.text, html: renderHtml(mail) });
      },
    };
  }
  if (config.RESEND_API_KEY) {
    return {
      kind: 'resend',
      async send(mail) {
        const r = await fetch('https://api.resend.com/emails', {
          method: 'POST',
          headers: { Authorization: `Bearer ${config.RESEND_API_KEY}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({ from: config.MAIL_FROM, to: [mail.to], subject: mail.subject, text: mail.text, html: renderHtml(mail) }),
        });
        if (!r.ok) throw new Error(`Falha ao enviar e-mail (HTTP ${r.status})`);
      },
    };
  }
  return {
    kind: 'log',
    async send(mail) {
      if (config.isProd) {
        log.error({ to: '[redacted]', subject: mail.subject }, 'e-mail NÃO enviado: configure SMTP_HOST (e-mail da hospedagem) ou RESEND_API_KEY');
        return;
      }
      log.info({ to: mail.to, subject: mail.subject, text: mail.text }, 'e-mail (modo desenvolvimento)');
    },
  };
}

export class MemoryMailer implements Mailer {
  readonly kind = 'log' as const;
  sent: Mail[] = [];
  async send(mail: Mail) {
    this.sent.push(mail);
  }
}
