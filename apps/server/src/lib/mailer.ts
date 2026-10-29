import type { Config } from '../config.js';
import type { Logger } from '../context.js';

export interface Mail {
  to: string;
  subject: string;
  text: string;
}

export interface Mailer {
  send(mail: Mail): Promise<void>;
}

/**
 * Envio de e-mail transacional (recuperação de senha, verificação, convites).
 * Produção: Resend (RESEND_API_KEY). Desenvolvimento: registra no log — nunca em produção.
 */
export function createMailer(config: Config, log: Logger): Mailer {
  if (config.RESEND_API_KEY) {
    return {
      async send(mail) {
        const r = await fetch('https://api.resend.com/emails', {
          method: 'POST',
          headers: { Authorization: `Bearer ${config.RESEND_API_KEY}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({ from: config.MAIL_FROM, to: [mail.to], subject: mail.subject, text: mail.text }),
        });
        if (!r.ok) throw new Error(`Falha ao enviar e-mail (HTTP ${r.status})`);
      },
    };
  }
  return {
    async send(mail) {
      if (config.isProd) {
        log.error({ to: '[redacted]', subject: mail.subject }, 'RESEND_API_KEY ausente: e-mail NÃO enviado');
        return;
      }
      log.info({ to: mail.to, subject: mail.subject, text: mail.text }, 'e-mail (modo desenvolvimento)');
    },
  };
}

export class MemoryMailer implements Mailer {
  sent: Mail[] = [];
  async send(mail: Mail) {
    this.sent.push(mail);
  }
}
