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
  /** desempate entre linhas com o MESMO nome (cópias duplicadas): maior primeiro (ex.: ativa e com gasto) */
  rank?: number;
}

const splitParts = (v: string | null | undefined): string[] => {
  const t = (v ?? '').trim().toLowerCase();
  if (!t || t === 'null') return [];
  return t.includes('|') ? [t, ...t.split('|').map((x) => x.trim()).filter(Boolean)] : [t];
};

/**
 * Casa uma venda com UMA linha (campanha/conjunto).
 *  1) Pelo ID (único na Meta), em qualquer UTM — "nome|id" do modelo recomendado, ou um texto que contenha o ID.
 *  2) Só sem ID que case: pelo nome, olhando os campos NA ORDEM recebida (o chamador põe primeiro o campo do
 *     nível: conjunto = utm_medium, campanha = utm_campaign). Várias linhas com o mesmo nome (cópias
 *     duplicadas) → a de maior `rank` (ativa e gastando), e não a primeira da lista.
 * Antes a primeira linha que casasse por nome OU por ID vencia: uma cópia pausada com o mesmo nome
 * "roubava" a venda do conjunto certo, e o nome da campanha podia casar com um conjunto homônimo.
 */
export function matchUtmToRow(utmValues: Array<string | null | undefined>, rows: AttributionRow[]): number {
  const perField = utmValues.map(splitParts).filter((f) => f.length);
  if (!perField.length) return -1;
  const all = perField.flat();
  // 1) ID
  for (let i = 0; i < rows.length; i++) {
    const id = rows[i]!.id.trim();
    if (id && all.some((v) => v === id || v.includes(id))) return i;
  }
  // 2) nome, campo a campo
  for (const field of perField) {
    let best = -1;
    for (let i = 0; i < rows.length; i++) {
      const name = rows[i]!.name.trim().toLowerCase();
      if (!name || !field.includes(name)) continue;
      if (best < 0 || (rows[i]!.rank ?? 0) > (rows[best]!.rank ?? 0)) best = i;
    }
    if (best >= 0) return best;
  }
  return -1;
}
