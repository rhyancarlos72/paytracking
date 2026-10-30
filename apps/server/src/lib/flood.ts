/**
 * Freio contra enxurrada de requisições nas rotas públicas (coleta do pixel, webhooks), em memória:
 * barato o bastante para rodar em toda requisição, sem ir ao banco. Janela fixa por IP + grupo.
 * Os limites ficam muito acima do uso real (um gateway ou um visitante normal nunca chega perto).
 */
export class FloodGuard {
  private hits = new Map<string, { n: number; reset: number }>();
  private lastSweep = 0;
  constructor(private readonly windowMs = 60_000, private readonly maxKeys = 50_000) {}

  /** true = pode seguir; false = passou do limite nesta janela */
  allow(key: string, limit: number, now = Date.now()): boolean {
    if (now - this.lastSweep > this.windowMs) this.sweep(now);
    let e = this.hits.get(key);
    if (!e || e.reset <= now) {
      if (!e && this.hits.size >= this.maxKeys) this.sweep(now, true);
      e = { n: 0, reset: now + this.windowMs };
      this.hits.set(key, e);
    }
    e.n++;
    return e.n <= limit;
  }

  private sweep(now: number, force = false) {
    this.lastSweep = now;
    for (const [k, v] of this.hits) if (v.reset <= now) this.hits.delete(k);
    // ainda cheio (ataque com muitos IPs): descarta as entradas mais antigas
    if (force && this.hits.size >= this.maxKeys) {
      let drop = Math.ceil(this.maxKeys / 10);
      for (const k of this.hits.keys()) { this.hits.delete(k); if (--drop <= 0) break; }
    }
  }
}

/** Limite por minuto e por IP de cada grupo de rota pública. */
export const FLOOD_LIMITS: Array<{ prefix: string; group: string; limit: number }> = [
  { prefix: '/v1/collect', group: 'collect', limit: 300 },
  { prefix: '/v1/pixel-config', group: 'pixel-config', limit: 300 },
  { prefix: '/v1/webhooks', group: 'webhooks', limit: 1200 },
  { prefix: '/api/', group: 'webhooks', limit: 1200 },
  { prefix: '/v1/meta/callback', group: 'oauth', limit: 30 },
];
