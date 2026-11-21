import { BlockList, isIP } from 'node:net';

/**
 * Faixas de IP da Cloudflare (API oficial GET /ips, conferida em 21/11/2026).
 * Com o domínio atrás da Cloudflare, o servidor recebe o pedido vindo de um IP dela e o IP REAL do visitante
 * no X-Forwarded-For. Confiar nesses saltos faz o req.ip voltar a ser o do comprador — essencial para a
 * Conversions API (client_ip_address), para os limites por IP e para o registro de sessões.
 */
const IPV4 = ['173.245.48.0/20', '103.21.244.0/22', '103.22.200.0/22', '103.31.4.0/22', '141.101.64.0/18', '108.162.192.0/18', '190.93.240.0/20', '188.114.96.0/20', '197.234.240.0/22', '198.41.128.0/17', '162.158.0.0/15', '104.16.0.0/13', '104.24.0.0/14', '172.64.0.0/13', '131.0.72.0/22'];
const IPV6 = ['2400:cb00::/32', '2606:4700::/32', '2803:f800::/32', '2405:b500::/32', '2405:8100::/32', '2a06:98c0::/29', '2c0f:f248::/32'];

const list = new BlockList();
for (const c of IPV4) { const [net, bits] = c.split('/'); list.addSubnet(net!, Number(bits), 'ipv4'); }
for (const c of IPV6) { const [net, bits] = c.split('/'); list.addSubnet(net!, Number(bits), 'ipv6'); }

export function isCloudflareIp(addr: string): boolean {
  let a = String(addr ?? '').trim();
  if (a.startsWith('::ffff:') && isIP(a.slice(7)) === 4) a = a.slice(7); // IPv4 escrito como IPv6
  const v = isIP(a);
  if (!v) return false;
  return list.check(a, v === 4 ? 'ipv4' : 'ipv6');
}

/**
 * Função de confiança de proxies (proxy-addr): os `hops` saltos da hospedagem + qualquer salto da Cloudflare.
 * O primeiro endereço (da direita para a esquerda) que não é proxy confiável vira o req.ip.
 */
export function trustHopsAndCloudflare(hops: number) {
  return (addr: string, i: number) => i < hops || isCloudflareIp(addr);
}
