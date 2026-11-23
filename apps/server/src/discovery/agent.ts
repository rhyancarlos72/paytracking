import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type { Ctx } from '../context.js';
import { esc, layout, legalInfo } from '../legal/pages.js';
import { supportSettings } from '../support/routes.js';

/**
 * Tudo o que agentes de IA e buscadores leem para entender o PayTracking sem executar JavaScript:
 * robots.txt (com Content-Signal), sitemap.xml, páginas Sobre e Contato, conteúdo da página inicial no HTML,
 * JSON-LD, versão em Markdown (Accept: text/markdown), cabeçalho Link e um servidor MCP público só de leitura.
 * Os textos refletem o produto real — ao mudar preço, gateways ou contato, eles acompanham a configuração.
 */

export const PUBLIC_PAGES = ['/', '/conheca', '/criar-conta', '/entrar', '/sobre', '/contato', '/privacidade', '/termos'] as const;

/** Rotas que o painel (SPA) conhece: qualquer outra devolve 404 de verdade. */
const SPA_ROUTE = /^\/(?:|entrar|criar-conta|esqueci-senha|redefinir-senha|verificar-email|convite|conheca|campanhas|vendas|vendas\/[\w-]{1,64}|eventos|atribuicao|diagnostico|pixels|integracoes|integracoes\/meta|configuracoes|financeiro|admin|ajuda)\/?$/;
export const isSpaRoute = (path: string) => SPA_ROUTE.test(path);
const INDEXABLE = new Set(['/', '/conheca', '/criar-conta', '/entrar']);

const money = (minor: number) => `R$ ${(minor / 100).toFixed(2).replace('.', ',')}`;

export interface SiteFacts {
  base: string; name: string; price: string; priceNumber: string; trialDays: number; email: string;
  whatsapp: string | null; operator: string; sameAs: string[];
}

export async function siteFacts(ctx: Ctx): Promise<SiteFacts> {
  const l = legalInfo(ctx);
  const support = await supportSettings(ctx).catch(() => ({ whatsapp: null as string | null }));
  return {
    base: l.appUrl, name: 'PayTracking', price: money(l.priceMinor), priceNumber: (l.priceMinor / 100).toFixed(2), trialDays: l.trialDays,
    email: l.contactEmail, whatsapp: support.whatsapp, operator: ctx.config.LEGAL_NAME || 'PayTracking',
    sameAs: ctx.config.SOCIAL_PROFILES.split(',').map((s) => s.trim()).filter((s) => /^https:\/\/\S+$/.test(s)),
  };
}

const GATEWAYS = 'Hotmart, Kiwify, Kirvano, Cakto e checkout próprio';
const faq = (f: SiteFacts): Array<[string, string]> => [
  ['Preciso de cartão para testar?', `Não. Você cria a conta e usa tudo por ${f.trialDays} dias, sem cadastrar cartão.`],
  ['Como funciona o pagamento?', `É um pagamento único por mês (${f.price}), feito por PIX dentro do painel. Não existe cobrança automática.`],
  ['Tem taxa por venda ou limite de vendas?', 'Não. O valor mensal é fixo e as vendas são ilimitadas. Não cobramos porcentagem sobre o faturamento.'],
  ['Quais plataformas são suportadas?', `${GATEWAYS}, com Pixel e Conversions API da Meta. A conta de anúncios da Meta pode ser conectada para mostrar investimento, ROAS e lucro.`],
  ['O pixel deixa minha página lenta?', 'Não. O script é pequeno, carrega de forma assíncrona e é entregue comprimido e em cache.'],
];

/** Texto principal da página inicial (o mesmo do site), em Markdown. */
export function homeMarkdown(f: SiteFacts): string {
  return [
    '# PayTracking — rastreamento de vendas para Meta Ads',
    '',
    `> Saiba qual anúncio realmente vende. O PayTracking recebe as vendas confirmadas dos gateways (${GATEWAYS}), atribui cada venda à campanha, ao conjunto e ao anúncio e envia o Purchase à Meta pela Conversions API — sem duplicar com o Pixel.`,
    '',
    '## O que ele faz',
    '',
    '- **Purchase só com pagamento aprovado**: PIX ou boleto gerado não vira venda.',
    '- **Pixel + Conversions API sem duplicar**: o mesmo ID de evento no navegador e no servidor.',
    '- **ROAS e lucro reais**: gasto da Meta lado a lado com as vendas confirmadas, por campanha, conjunto e anúncio.',
    '- **Reembolso e chargeback registrados**: o faturamento é abatido automaticamente.',
    '- **Aviso de venda no celular** e app para Android.',
    '',
    '## Preço',
    '',
    `- **${f.price} por mês**, preço fixo, vendas ilimitadas e **sem taxa por venda**.`,
    `- **${f.trialDays} dias grátis**, sem cartão.`,
    '',
    '## Perguntas frequentes',
    '',
    ...faq(f).flatMap(([q, a]) => [`**${q}** ${a}`, '']),
    '## Links',
    '',
    `- [Criar conta grátis](${f.base}/criar-conta)`,
    `- [Entrar](${f.base}/entrar)`,
    `- [Sobre o PayTracking](${f.base}/sobre)`,
    `- [Contato](${f.base}/contato)`,
    `- [Termos de Uso](${f.base}/termos) · [Política de Privacidade](${f.base}/privacidade)`,
    '',
    `Contato: ${f.email}${f.whatsapp ? ` · WhatsApp +${f.whatsapp}` : ''}`,
    '',
  ].join('\n');
}

/** O mesmo conteúdo em HTML, dentro do #root: lido por agentes e buscadores; o React substitui ao carregar. */
export function homeStaticHtml(f: SiteFacts): string {
  const li = (t: string) => `<li>${t}</li>`;
  return `<main data-prerender style="max-width:760px;margin:40px auto;padding:0 20px;font-family:system-ui,sans-serif;line-height:1.6">
<h1>PayTracking — rastreamento de vendas para Meta Ads</h1>
<p><strong>Saiba qual anúncio realmente vende.</strong> O PayTracking recebe as vendas confirmadas dos gateways (${esc(GATEWAYS)}), atribui cada venda à campanha, ao conjunto e ao anúncio e envia o Purchase à Meta pela Conversions API, sem duplicar com o Pixel.</p>
<h2>O que ele faz</h2>
<ul>${[
    'Purchase só com pagamento aprovado: PIX ou boleto gerado não vira venda.',
    'Pixel + Conversions API sem duplicar: o mesmo ID de evento no navegador e no servidor.',
    'ROAS e lucro reais: gasto da Meta lado a lado com as vendas confirmadas, por campanha, conjunto e anúncio.',
    'Reembolso e chargeback registrados: o faturamento é abatido automaticamente.',
    'Aviso de venda no celular e app para Android.',
  ].map((t) => li(esc(t))).join('')}</ul>
<h2>Preço</h2>
<p><strong>${esc(f.price)} por mês</strong>, preço fixo, vendas ilimitadas e sem taxa por venda. <strong>${f.trialDays} dias grátis</strong>, sem cartão. <a href="/criar-conta">Criar conta grátis</a> · <a href="/entrar">Entrar</a></p>
<h2>Perguntas frequentes</h2>
${faq(f).map(([q, a]) => `<h3>${esc(q)}</h3><p>${esc(a)}</p>`).join('\n')}
<footer><p><a href="/sobre">Sobre</a> · <a href="/contato">Contato</a> · <a href="/termos">Termos de Uso</a> · <a href="/privacidade">Política de Privacidade</a></p>
<p>Contato: <a href="mailto:${esc(f.email)}">${esc(f.email)}</a>${f.whatsapp ? ` · <a href="https://wa.me/${esc(f.whatsapp)}">WhatsApp</a> · <a href="tel:+${esc(f.whatsapp)}">+${esc(f.whatsapp)}</a>` : ''}</p></footer>
</main>`;
}

/** JSON-LD: Organization, WebSite, WebPage, SoftwareApplication (com oferta) e FAQPage. */
export function homeJsonLd(f: SiteFacts, path: string): string {
  const org: Record<string, unknown> = {
    '@type': 'Organization', '@id': `${f.base}/#organization`, name: f.name, legalName: f.operator, url: `${f.base}/`,
    logo: `${f.base}/icons/icon-512.png`, email: f.email,
    ...(f.whatsapp ? { telephone: `+${f.whatsapp}` } : {}),
    contactPoint: [{ '@type': 'ContactPoint', contactType: 'customer support', email: f.email, ...(f.whatsapp ? { telephone: `+${f.whatsapp}`, url: `https://wa.me/${f.whatsapp}` } : {}), availableLanguage: ['pt-BR'] }],
    sameAs: f.sameAs.length ? f.sameAs : [`${f.base}/sobre`],
  };
  const graph = [
    org,
    { '@type': 'WebSite', '@id': `${f.base}/#website`, url: `${f.base}/`, name: f.name, inLanguage: 'pt-BR', publisher: { '@id': `${f.base}/#organization` } },
    { '@type': 'WebPage', '@id': `${f.base}${path}#webpage`, url: `${f.base}${path}`, name: 'PayTracking · Rastreamento de vendas para Meta Ads', isPartOf: { '@id': `${f.base}/#website` }, about: { '@id': `${f.base}/#software` }, inLanguage: 'pt-BR' },
    {
      '@type': 'SoftwareApplication', '@id': `${f.base}/#software`, name: f.name, applicationCategory: 'BusinessApplication', operatingSystem: 'Web, Android',
      description: `Rastreamento de vendas para Meta Ads: Purchase só com pagamento aprovado, Pixel + Conversions API sem duplicar e ROAS real. Integra ${GATEWAYS}.`,
      url: `${f.base}/`, publisher: { '@id': `${f.base}/#organization` },
      offers: { '@type': 'Offer', price: f.priceNumber, priceCurrency: 'BRL', url: `${f.base}/criar-conta`, description: `Assinatura mensal com ${f.trialDays} dias grátis, vendas ilimitadas e sem taxa por venda.` },
    },
    { '@type': 'FAQPage', '@id': `${f.base}/#faq`, mainEntity: faq(f).map(([q, a]) => ({ '@type': 'Question', name: q, acceptedAnswer: { '@type': 'Answer', text: a } })) },
  ];
  // "<" escapado: o JSON vai dentro de <script> no HTML
  return JSON.stringify({ '@context': 'https://schema.org', '@graph': graph }).replace(/</g, '\\u003c');
}

const LINK_HEADER = [
  '</llms.txt>; rel="describedby"; type="text/markdown"',
  '</>; rel="alternate"; type="text/markdown"',
  '</sitemap.xml>; rel="sitemap"; type="application/xml"',
  '</.well-known/mcp/server-card.json>; rel="mcp-server-card"; type="application/json"',
].join(', ');

/** Ajusta o index.html por rota: robots, canonical, JSON-LD e conteúdo da página inicial; 404 real para rota inexistente. */
export async function renderSpa(ctx: Ctx, req: FastifyRequest, reply: FastifyReply, indexHtml: string): Promise<FastifyReply> {
  const path = req.url.split('?')[0]!.replace(/\/+$/, '') || '/';
  const known = isSpaRoute(path);
  const f = await siteFacts(ctx);
  const accept = String(req.headers.accept ?? '');
  reply.header('Vary', 'Accept');
  if ((path === '/' || path === '/conheca') && /text\/markdown/i.test(accept) && !/text\/html/i.test(accept)) {
    return reply.type('text/markdown; charset=utf-8').header('Cache-Control', 'public, max-age=3600').header('Link', LINK_HEADER).send(homeMarkdown(f));
  }
  let html = indexHtml;
  if (INDEXABLE.has(path)) {
    html = html.replace(/<meta name="robots" content="[^"]*"\s*\/?>/, '<meta name="robots" content="index, follow" />')
      .replace('</head>', `  <link rel="canonical" href="${esc(f.base + (path === '/' ? '/' : path))}" />\n    <link rel="alternate" type="text/markdown" href="/llms.txt" />\n    <script type="application/ld+json">${homeJsonLd(f, path === '/' ? '/' : path)}</script>\n  </head>`);
    if (path === '/' || path === '/conheca') {
      html = html.replace('<div id="root"></div>', `<div id="root">${homeStaticHtml(f)}</div>`);
      reply.header('Link', LINK_HEADER);
    }
  }
  return reply.code(known ? 200 : 404).type('text/html').header('Cache-Control', 'no-cache').send(html);
}

// ------------------------------------------------------------------ servidor MCP público (só leitura)

const MCP_PROTOCOL = '2025-06-18';
const MCP_TOOLS = [
  { name: 'get_product_info', title: 'O que é o PayTracking', description: 'Explica o que o PayTracking faz, quais gateways integra e como funciona o rastreamento de vendas para Meta Ads.', inputSchema: { type: 'object', properties: {}, additionalProperties: false } },
  { name: 'get_pricing', title: 'Preço e teste grátis', description: 'Preço mensal, dias de teste grátis e condições (sem taxa por venda, vendas ilimitadas).', inputSchema: { type: 'object', properties: {}, additionalProperties: false } },
  { name: 'get_contact', title: 'Contato e suporte', description: 'E-mail e WhatsApp de suporte, e links para as páginas Sobre, Contato, Termos e Privacidade.', inputSchema: { type: 'object', properties: {}, additionalProperties: false } },
];

async function mcpTool(ctx: Ctx, name: string): Promise<string | null> {
  const f = await siteFacts(ctx);
  if (name === 'get_product_info') return homeMarkdown(f);
  if (name === 'get_pricing') return `PayTracking: ${f.price} por mês, preço fixo, vendas ilimitadas e sem taxa por venda. ${f.trialDays} dias grátis sem cartão. Pagamento por PIX no painel, sem cobrança automática. Criar conta: ${f.base}/criar-conta`;
  if (name === 'get_contact') return `E-mail: ${f.email}${f.whatsapp ? `\nWhatsApp: https://wa.me/${f.whatsapp} (+${f.whatsapp})` : ''}\nSobre: ${f.base}/sobre\nContato: ${f.base}/contato\nTermos: ${f.base}/termos\nPrivacidade: ${f.base}/privacidade`;
  return null;
}

export function agentRoutes(app: FastifyInstance, ctx: Ctx) {
  const base = () => ctx.config.APP_URL.replace(/\/+$/, '');

  app.get('/robots.txt', async (_req, reply) => {
    reply.type('text/plain; charset=utf-8').header('Cache-Control', 'public, max-age=86400');
    return [
      '# PayTracking — política de rastreamento',
      'User-agent: *',
      // Content Signals (contentsignals.org): pode aparecer em buscas e respostas; não pode treinar modelos
      'Content-Signal: search=yes, ai-input=yes, ai-train=no',
      'Allow: /',
      'Disallow: /v1/',
      'Disallow: /api/',
      'Disallow: /mcp',
      ...['campanhas', 'vendas', 'eventos', 'atribuicao', 'diagnostico', 'pixels', 'integracoes', 'configuracoes', 'financeiro', 'admin', 'ajuda', 'convite', 'redefinir-senha', 'verificar-email'].map((p) => `Disallow: /${p}`),
      '',
      `Sitemap: ${base()}/sitemap.xml`,
      '',
    ].join('\n');
  });

  app.get('/sitemap.xml', async (_req, reply) => {
    reply.type('application/xml; charset=utf-8').header('Cache-Control', 'public, max-age=86400');
    const urls = ['/', '/criar-conta', '/entrar', '/sobre', '/contato', '/termos', '/privacidade', '/llms.txt'];
    return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls.map((u) => `  <url><loc>${base()}${u}</loc><changefreq>${u === '/' ? 'weekly' : 'monthly'}</changefreq><priority>${u === '/' ? '1.0' : '0.6'}</priority></url>`).join('\n')}\n</urlset>\n`;
  });

  const sendPage = (reply: FastifyReply, html: string) => reply
    .type('text/html; charset=utf-8')
    .header('Cache-Control', 'public, max-age=3600')
    .header('Content-Security-Policy', "default-src 'none'; style-src 'unsafe-inline'; img-src 'self' data:; base-uri 'none'; form-action 'none'; frame-ancestors 'none'")
    .send(html);

  app.get('/sobre', async (_req, reply) => {
    const f = await siteFacts(ctx);
    const body = `<h2>O que é o PayTracking</h2>
<p>O PayTracking é um sistema brasileiro de rastreamento de vendas para quem anuncia na Meta (Facebook e Instagram). Ele recebe as vendas confirmadas dos gateways (${esc(GATEWAYS)}), descobre qual campanha, conjunto e anúncio trouxe cada venda e envia a conversão à Meta pela Conversions API, sem duplicar com o Pixel.</p>
<h2>Para quem é</h2>
<p>Produtores digitais, infoprodutores, agências e lojas que vendem com tráfego pago e querem saber o ROAS e o lucro reais de cada anúncio.</p>
<h2>Como cobramos</h2>
<p>${esc(f.price)} por mês, preço fixo, vendas ilimitadas e sem taxa por venda, com ${f.trialDays} dias grátis sem cartão.</p>
<h2>Quem opera</h2>
<p>${esc(f.operator)}. Contato: <a href="mailto:${esc(f.email)}">${esc(f.email)}</a>${f.whatsapp ? ` · WhatsApp <a href="https://wa.me/${esc(f.whatsapp)}">+${esc(f.whatsapp)}</a>` : ''}.</p>
<p><a href="/">Página inicial</a> · <a href="/contato">Contato</a> · <a href="/termos">Termos de Uso</a> · <a href="/privacidade">Política de Privacidade</a></p>`;
    return sendPage(reply, layout('Sobre o PayTracking', 'Quem somos, o que o PayTracking faz e para quem ele é feito.', body, legalInfo(ctx), '/sobre'));
  });

  app.get('/contato', async (_req, reply) => {
    const f = await siteFacts(ctx);
    const body = `<h2>Fale com a gente</h2>
<ul>
<li>E-mail: <a href="mailto:${esc(f.email)}">${esc(f.email)}</a></li>
${f.whatsapp ? `<li>WhatsApp: <a href="https://wa.me/${esc(f.whatsapp)}">+${esc(f.whatsapp)}</a> (<a href="tel:+${esc(f.whatsapp)}">ligar</a>)</li>` : ''}
<li>Clientes: pelo botão de suporte dentro do painel.</li>
</ul>
<p>Dados pessoais e LGPD: veja a <a href="/privacidade">Política de Privacidade</a>. Condições de uso: <a href="/termos">Termos de Uso</a>.</p>
<p><a href="/">Página inicial</a> · <a href="/sobre">Sobre</a></p>`;
    return sendPage(reply, layout('Contato', 'Como falar com o PayTracking: e-mail e WhatsApp de suporte.', body, legalInfo(ctx), '/contato'));
  });

  // MCP Server Card (SEP-1649)
  app.get('/.well-known/mcp/server-card.json', async (_req, reply) => {
    reply.type('application/json; charset=utf-8').header('Cache-Control', 'public, max-age=3600').header('Access-Control-Allow-Origin', '*');
    return {
      $schema: 'https://modelcontextprotocol.io/schemas/server-card/v1.json',
      name: 'br.com.paytracking/public',
      title: 'PayTracking',
      description: 'Informações públicas do PayTracking (produto, preço e contato) para agentes. Só leitura, sem dados de clientes.',
      version: '1.0.0',
      protocolVersion: MCP_PROTOCOL,
      websiteUrl: `${base()}/`,
      endpoints: [{ transport: 'streamable-http', url: `${base()}/mcp` }],
      transport: { type: 'streamable-http', url: `${base()}/mcp` },
      capabilities: { tools: { listChanged: false } },
      authentication: { required: false },
      tools: MCP_TOOLS.map(({ name, title, description }) => ({ name, title, description })),
    };
  });

  // Servidor MCP mínimo (Streamable HTTP, sem estado, só leitura de informações públicas)
  app.post('/mcp', async (req, reply) => {
    reply.header('Access-Control-Allow-Origin', '*').header('Cache-Control', 'no-store');
    const msg = (req.body && typeof req.body === 'object' ? req.body : null) as { jsonrpc?: string; id?: string | number | null; method?: string; params?: { name?: string } } | null;
    if (!msg || msg.jsonrpc !== '2.0' || typeof msg.method !== 'string') {
      return reply.code(400).send({ jsonrpc: '2.0', id: null, error: { code: -32600, message: 'Invalid Request' } });
    }
    if (msg.id === undefined) return reply.code(202).send(); // notificação (ex.: notifications/initialized)
    const ok = (result: unknown) => ({ jsonrpc: '2.0', id: msg.id, result });
    switch (msg.method) {
      case 'initialize':
        return ok({ protocolVersion: MCP_PROTOCOL, capabilities: { tools: { listChanged: false } }, serverInfo: { name: 'paytracking-public', title: 'PayTracking', version: '1.0.0' }, instructions: 'Informações públicas do PayTracking. Use get_product_info, get_pricing e get_contact.' });
      case 'ping':
        return ok({});
      case 'tools/list':
        return ok({ tools: MCP_TOOLS });
      case 'tools/call': {
        const text = await mcpTool(ctx, String(msg.params?.name ?? ''));
        if (text === null) return { jsonrpc: '2.0', id: msg.id, error: { code: -32602, message: 'Unknown tool' } };
        return ok({ content: [{ type: 'text', text }], isError: false });
      }
      default:
        return { jsonrpc: '2.0', id: msg.id, error: { code: -32601, message: 'Method not found' } };
    }
  });
  app.get('/mcp', async (_req, reply) => reply.code(405).header('Allow', 'POST').send({ error: 'Use POST (MCP Streamable HTTP).' }));
  app.options('/mcp', async (_req, reply) => reply.code(204).header('Access-Control-Allow-Origin', '*').header('Access-Control-Allow-Methods', 'POST, GET, OPTIONS').header('Access-Control-Allow-Headers', 'Content-Type, Accept, Mcp-Session-Id, Mcp-Protocol-Version').send());
}
