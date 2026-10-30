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
 * Versão HTML do e-mail (mesmo conteúdo do texto). Links viram botão; nada de imagens externas
 * (não rastreia quem abre e não cai em spam por imagem remota).
 */
export function renderHtml(mail: Mail): string {
  const lines = mail.text.split('\n').map((l) => {
    const m = /^(.*?)(https?:\/\/\S+)\s*$/.exec(l);
    if (m) {
      const label = m[1]!.replace(/[:\s]+$/, '').trim();
      return `${label ? `<p style="margin:0 0 12px">${esc(label)}:</p>` : ''}<p style="margin:0 0 20px"><a href="${esc(m[2]!)}" style="display:inline-block;background:#6d4aff;color:#ffffff;text-decoration:none;font-weight:600;padding:12px 22px;border-radius:10px">Abrir no PayTracking</a></p><p style="margin:0 0 16px;font-size:12px;color:#5d6378;word-break:break-all">Ou copie: ${esc(m[2]!)}</p>`;
    }
    return l.trim() ? `<p style="margin:0 0 12px">${esc(l)}</p>` : '';
  }).join('');
  return `<!doctype html><html lang="pt-BR"><body style="margin:0;background:#f7f7fb;font-family:Inter,Segoe UI,Arial,sans-serif;color:#0b0d1a">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td align="center" style="padding:32px 16px">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:520px;background:#ffffff;border:1px solid #e4e4ee;border-radius:16px">
<tr><td style="padding:28px 28px 8px"><span style="display:inline-block;background:#6d4aff;color:#fff;font-weight:700;border-radius:8px;padding:4px 10px">PayTracking</span></td></tr>
<tr><td style="padding:16px 28px 28px;font-size:15px;line-height:1.55">${lines}</td></tr>
</table><p style="font-size:12px;color:#5d6378;margin:16px 0 0">Você recebeu este e-mail porque tem uma conta no PayTracking.</p>
</td></tr></table></body></html>`;
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
