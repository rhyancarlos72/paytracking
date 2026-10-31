/**
 * Atribuição por UTM e transporte de rastreamento em xcod/sck (Hotmart & cia).
 * Porta das regras de campaigns.php (pt_utm_sales_overlay) e gateway_adapters.php.
 */

export const UTM_KEYS = ['utm_source', 'utm_medium', 'utm_campaign', 'utm_content', 'utm_term', 'utm_id'] as const;
export type UtmKey = (typeof UTM_KEYS)[number];

/**
 * Interpreta o código de rastreamento devolvido pelo gateway:
 *  - formato querystring ("external_id=x&fbp=y&utm_source=fb"), separadores & | ;
 *  - formato posicional ("fb|cpc|campanha|conteudo|termo").
 */
export function parseTrackingCode(raw: unknown): Record<string, string> {
  if (typeof raw !== 'string') return {};
  const s = raw.trim();
  if (!s) return {};
  const out: Record<string, string> = {};
  if (s.includes('=')) {
    // separa em & e, para o formato legado "a=1|b=2", em | ou ; só quando vem outra chave= em seguida —
    // assim "utm_campaign=Nome|120210…" (parâmetros recomendados nome|id) não é quebrado
    for (const part of s.split(/&|[|;](?=[\w.-]+=)/)) {
      const i = part.indexOf('=');
      if (i <= 0) continue;
      const k = safeDecode(part.slice(0, i)).trim();
      const v = safeDecode(part.slice(i + 1)).trim();
      if (k && v) out[k] = v;
    }
    return out;
  }
  const parts = s.split(/[|;]/).map((p) => p.trim()).filter(Boolean);
  const keys = ['utm_source', 'utm_medium', 'utm_campaign', 'utm_content', 'utm_term'];
  parts.forEach((v, i) => {
    const k = keys[i];
    if (k) out[k] = v;
  });
  return out;
}

function safeDecode(s: string): string {
  try {
    return decodeURIComponent(s.replace(/\+/g, ' '));
  } catch {
    return s;
  }
}

export interface AttributionRow {
  id: string;
  name: string;
}

/**
 * Casa uma venda com UMA linha (campanha/conjunto):
 * qualquer UTM (campaign/content/term/medium) igual ao nome (case-insensitive)
 * ou contendo o ID numérico. Retorna o índice da primeira linha casada ou -1.
 */
export function matchUtmToRow(utmValues: Array<string | null | undefined>, rows: AttributionRow[]): number {
  // "nome|id" (modelo recomendado {{campaign.name}}|{{campaign.id}}): vale o texto inteiro e cada parte
  const fields = utmValues
    .flatMap((v) => { const t = (v ?? '').trim().toLowerCase(); return t.includes('|') ? [t, ...t.split('|').map((x) => x.trim())] : [t]; })
    .filter((v) => v !== '' && v !== 'null');
  if (!fields.length) return -1;
  for (let i = 0; i < rows.length; i++) {
    const row = rows[i]!;
    const name = row.name.trim().toLowerCase();
    const id = row.id.trim();
    for (const v of fields) {
      if ((name !== '' && v === name) || (id !== '' && v.includes(id))) return i;
    }
  }
  return -1;
}
