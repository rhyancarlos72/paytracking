import { DISPATCH_PHP_TEMPLATE } from './dispatch-template';

/** Texto seguro dentro de uma string PHP entre aspas simples. */
const phpString = (v: string) => v.replace(/\\/g, '\\\\').replace(/'/g, "\\'");

/** paytrack_dispatch.php com URL, token e segredo desta integração (gerado no navegador). */
export function buildDispatchPhp(o: { webhookUrl: string; token?: string | null; secret?: string | null }): string {
  return DISPATCH_PHP_TEMPLATE
    .split('__PAYTRACK_URL__').join(phpString(o.webhookUrl))
    .split('__PAYTRACK_TOKEN__').join(phpString(o.token || 'itk_cole_seu_token_aqui'))
    .split('__PAYTRACK_SECRET__').join(phpString(o.secret || ''));
}

/** Baixa um arquivo de texto gerado no navegador (nada é enviado ao servidor). */
export function downloadText(filename: string, content: string, type = 'application/x-php') {
  const url = URL.createObjectURL(new Blob([content], { type: `${type};charset=utf-8` }));
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/** URL legada aceita pelo checkout próprio: /api/webhook.php na mesma origem da API. */
export const checkoutEndpoint = (anyWebhookUrl: string) => `${new URL(anyWebhookUrl).origin}/api/webhook.php`;
