import type { FastifyInstance } from 'fastify';
import type { Ctx } from '../context.js';

/**
 * Política de Privacidade e Termos de Uso, renderizados no servidor (HTML completo, sem depender
 * de JavaScript): é o que o Google lê ao verificar a tela de consentimento do login com Google.
 * O texto descreve o que o sistema realmente faz — ao mudar coleta, retenção ou parceiros, atualize
 * aqui e a data de UPDATED.
 */
const UPDATED = '30 de outubro de 2026';

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));

interface Legal { operator: string; contactEmail: string; appUrl: string; priceMinor: number; trialDays: number; trackingDays: number; webhookDays: number }

function legalInfo(ctx: Ctx): Legal {
  const c = ctx.config;
  const fromMailFrom = (/<([^>]+)>/.exec(c.MAIL_FROM)?.[1] ?? c.MAIL_FROM).trim();
  const contact = (c.PRIVACY_CONTACT || c.SECURITY_CONTACT.replace(/^mailto:/i, '') || fromMailFrom).trim();
  const operator = c.LEGAL_NAME ? `${c.LEGAL_NAME}${c.LEGAL_DOCUMENT ? `, inscrita no CNPJ/CPF sob o nº ${c.LEGAL_DOCUMENT}` : ''}` : 'o responsável pelo PayTracking';
  return {
    operator, contactEmail: contact, appUrl: c.APP_URL.replace(/\/$/, ''), priceMinor: c.PLAN_PRICE_MINOR, trialDays: c.PLAN_TRIAL_DAYS,
    trackingDays: c.TRACKING_RETENTION_DAYS, webhookDays: c.WEBHOOK_BODY_RETENTION_DAYS,
  };
}

const LOGO = `<svg viewBox="0 0 100 100" width="34" height="34" aria-hidden="true"><defs><linearGradient id="f" x1=".1" y1="0" x2=".8" y2="1"><stop offset="0" stop-color="#7c5cff"/><stop offset=".45" stop-color="#a588ff"/><stop offset=".75" stop-color="#ab8cff"/><stop offset="1" stop-color="#7c3aed"/></linearGradient><linearGradient id="s" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#c4a5ff"/><stop offset="1" stop-color="#6d28d9"/></linearGradient><linearGradient id="a" x1="0" y1="1" x2="1" y2="0"><stop offset="0" stop-color="#7c3aed"/><stop offset="1" stop-color="#d86bff"/></linearGradient></defs><path d="M24 27V13h36a27.5 27.5 0 0 1 0 55h-8V55h8a14.5 14.5 0 0 0 0-29H38v1Z" fill="url(#f)"/><path d="M24 27h13v57a6 6 0 0 1-6 6h-1a6 6 0 0 1-6-6Z" fill="url(#s)"/><rect x="40.5" y="43" width="8" height="14" rx="2.5" fill="#a06bff"/><rect x="51" y="36" width="8" height="16" rx="2.5" fill="#a06bff"/><rect x="61.5" y="30" width="8" height="15" rx="2.5" fill="#a06bff"/><path d="M26 88C36 66 52 63 71 44.5" fill="none" stroke="url(#a)" stroke-width="7.5" stroke-linecap="round"/><path d="M84 30l-3.5 21.5-17-14Z" fill="#d86bff"/></svg>`;

function layout(title: string, lead: string, body: string, l: Legal, canonical: string): string {
  return `<!doctype html>
<html lang="pt-BR">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title)} · PayTracking</title>
<meta name="description" content="${esc(lead)}">
<link rel="canonical" href="${esc(l.appUrl + canonical)}">
<link rel="icon" href="/favicon.svg" type="image/svg+xml">
<style>
  :root { color-scheme: light dark; --bg:#f7f7fb; --card:#fff; --fg:#0b0d1a; --muted:#545a70; --line:#e5e4ee; --primary:#6d4aff; }
  @media (prefers-color-scheme: dark) { :root { --bg:#08070f; --card:#111022; --fg:#ecebf5; --muted:#a3a6bd; --line:#26243d; --primary:#a78bfa; } }
  * { box-sizing: border-box; }
  body { margin:0; background:var(--bg); color:var(--fg); font:16px/1.7 Inter,'Segoe UI',Roboto,Helvetica,Arial,sans-serif; -webkit-font-smoothing:antialiased; }
  header { border-bottom:1px solid var(--line); background:var(--card); }
  .wrap { max-width:820px; margin:0 auto; padding:0 20px; }
  .top { display:flex; align-items:center; justify-content:space-between; gap:12px; height:64px; }
  .brand { display:flex; align-items:center; gap:10px; color:var(--fg); text-decoration:none; font-weight:800; font-size:19px; letter-spacing:-.02em; }
  .brand b { background:linear-gradient(180deg,#d27bff,#7c3aed); -webkit-background-clip:text; background-clip:text; color:transparent; }
  nav a { color:var(--muted); text-decoration:none; font-size:14px; margin-left:16px; }
  nav a:hover, nav a[aria-current] { color:var(--primary); }
  main.wrap { padding-top:44px; padding-bottom:64px; }
  h1 { font-size:34px; line-height:1.15; letter-spacing:-.025em; margin:0 0 8px; }
  .meta { color:var(--muted); font-size:14px; margin:0 0 28px; }
  .lead { font-size:17px; color:var(--muted); }
  .card { background:var(--card); border:1px solid var(--line); border-radius:18px; padding:28px; margin-top:24px; }
  h2 { font-size:21px; letter-spacing:-.015em; margin:36px 0 10px; }
  h2:first-child { margin-top:0; }
  h3 { font-size:16px; margin:22px 0 6px; }
  p, li { color:var(--fg); }
  ul { padding-left:22px; }
  li { margin:6px 0; }
  a { color:var(--primary); }
  .note { border-left:4px solid var(--primary); background:color-mix(in srgb, var(--primary) 8%, transparent); padding:14px 16px; border-radius:10px; }
  table { width:100%; border-collapse:collapse; font-size:14px; margin:12px 0; }
  th, td { text-align:left; padding:10px 8px; border-bottom:1px solid var(--line); vertical-align:top; }
  th { color:var(--muted); font-weight:600; }
  .toc { columns:2; column-gap:28px; font-size:14px; padding-left:18px; }
  footer { border-top:1px solid var(--line); color:var(--muted); font-size:13px; padding:24px 0 40px; }
  @media (max-width:600px) { main.wrap { padding-top:28px; } h1 { font-size:28px; } .card { padding:20px; } .toc { columns:1; } nav a { margin-left:12px; } table { font-size:13px; } }
  @media (max-width:420px) { nav a.login { display:none; } .brand { font-size:17px; } }
</style>
</head>
<body>
<header><div class="wrap top">
  <a class="brand" href="/conheca">${LOGO}<span>Pay<b>Tracking</b></span></a>
  <nav aria-label="Páginas legais"><a href="/privacidade"${canonical === '/privacidade' ? ' aria-current="page"' : ''}>Privacidade</a><a href="/termos"${canonical === '/termos' ? ' aria-current="page"' : ''}>Termos</a><a class="login" href="/entrar">Entrar</a></nav>
</div></header>
<main class="wrap">
  <h1>${esc(title)}</h1>
  <p class="meta">Última atualização: ${UPDATED}</p>
  <p class="lead">${lead}</p>
  <article class="card">${body}</article>
</main>
<footer><div class="wrap">PayTracking — rastreamento de vendas e conversões para Meta Ads · <a href="/privacidade">Política de Privacidade</a> · <a href="/termos">Termos de Uso</a> · Contato: <a href="mailto:${esc(l.contactEmail)}">${esc(l.contactEmail)}</a></div></footer>
</body>
</html>`;
}

function privacy(l: Legal): string {
  const mail = `<a href="mailto:${esc(l.contactEmail)}">${esc(l.contactEmail)}</a>`;
  return `
<ol class="toc">
  <li><a href="#quem">Quem somos</a></li><li><a href="#papeis">A quem esta política se aplica</a></li>
  <li><a href="#dados">Dados que coletamos</a></li><li><a href="#google">Dados do Google (login com Google)</a></li>
  <li><a href="#uso">Para que usamos e bases legais</a></li><li><a href="#compartilhamento">Com quem compartilhamos</a></li>
  <li><a href="#internacional">Transferência internacional</a></li><li><a href="#retencao">Por quanto tempo guardamos</a></li>
  <li><a href="#cookies">Cookies e armazenamento local</a></li><li><a href="#seguranca">Segurança</a></li>
  <li><a href="#direitos">Seus direitos</a></li><li><a href="#criancas">Menores de idade</a></li>
  <li><a href="#mudancas">Mudanças nesta política</a></li><li><a href="#contato">Contato</a></li>
</ol>

<h2 id="quem">1. Quem somos</h2>
<p>O PayTracking (${esc(l.appUrl)}) é um serviço on-line que liga as vendas aprovadas nos meios de pagamento dos nossos clientes às campanhas de anúncios que as originaram e envia essas conversões à Meta (Facebook e Instagram) pela API de Conversões. O serviço é operado por ${esc(l.operator)}, que é o controlador dos dados tratados conforme esta política, nos termos da Lei Geral de Proteção de Dados (Lei nº 13.709/2018 — LGPD).</p>
<p>Contato para assuntos de privacidade e com o encarregado pelo tratamento de dados (DPO): ${mail}.</p>

<h2 id="papeis">2. A quem esta política se aplica</h2>
<ul>
  <li><b>Clientes e usuários do painel</b> (quem cria conta no PayTracking): para os dados da conta, o PayTracking é o <b>controlador</b>.</li>
  <li><b>Compradores e visitantes das páginas dos nossos clientes</b>: quando um cliente instala o pixel do PayTracking no site dele ou conecta o meio de pagamento, tratamos esses dados <b>em nome do cliente e conforme as instruções dele</b>. Nesse caso o cliente é o controlador e o PayTracking é o <b>operador</b>. O cliente é responsável por informar seus visitantes, ter base legal para o tratamento e manter a própria política de privacidade.</li>
</ul>

<h2 id="dados">3. Dados que coletamos</h2>
<h3>3.1 Conta e uso do painel</h3>
<ul>
  <li>Nome, e-mail, nome da empresa, moeda e fuso horário, metas de faturamento.</li>
  <li>Senha: guardamos apenas um resumo criptográfico (bcrypt); nunca a senha em si.</li>
  <li>Verificação em duas etapas: segredo do aplicativo autenticador (cifrado) e códigos de recuperação (apenas o resumo criptográfico).</li>
  <li>Equipe: convites, e-mails convidados e o papel de cada membro.</li>
  <li>Sessões e segurança: endereço IP, navegador/dispositivo, data e hora de acesso, e um registro das ações importantes (auditoria).</li>
  <li>Notificações: a inscrição de notificações do navegador (endereço técnico do serviço de push e chaves públicas do aparelho) e o nome do aparelho; se você enviar, o arquivo de áudio escolhido como som de venda.</li>
</ul>
<h3>3.2 Integrações configuradas por você</h3>
<ul>
  <li>Identificadores dos seus pixels, produtos e integrações; tokens e segredos de webhook (cifrados).</li>
  <li>Meta Ads: ao conectar sua conta de anúncios, recebemos um token de acesso (guardado cifrado) com as permissões <code>ads_read</code> e <code>ads_management</code>, o identificador e a moeda da conta de anúncios e métricas de desempenho (investimento, impressões, cliques, ações e valores). Usamos esses dados só para mostrar seus resultados e o ROAS no seu painel.</li>
  <li>Assinatura: valor, status e datas das cobranças PIX geradas pela Woovi. Não recebemos dados bancários nem de cartão.</li>
</ul>
<h3>3.3 Compradores e visitantes (tratados em nome dos clientes)</h3>
<ul>
  <li>Eventos de navegação nas páginas do cliente: tipo de evento, endereço da página, página de origem, parâmetros de campanha (UTMs), identificadores de clique de anúncios (fbclid, cookie <code>_fbc</code>), cookie <code>_fbp</code> e um identificador anônimo gerado no navegador.</li>
  <li>Endereço IP, navegador e país do visitante.</li>
  <li>Quando o cliente permite, dados digitados no formulário da página (e-mail, telefone, nome e CPF) são usados para a correspondência avançada da Meta: <b>enviamos à Meta apenas o resumo criptográfico (SHA-256)</b> e guardamos só o resumo do e-mail e do telefone.</li>
  <li>Dados das transações enviados pelo meio de pagamento (Hotmart, Kiwify, Kirvano, Cakto ou o checkout próprio do cliente): identificador, status, valor, moeda, produtos e campanha. O e-mail do comprador é guardado apenas como resumo criptográfico. O conteúdo original de cada notificação recebida é guardado cifrado por até ${l.webhookDays} dias, somente para permitir o reprocessamento em caso de falha.</li>
</ul>

<h2 id="google">4. Dados do Google (login com Google)</h2>
<p>Se você escolher “Entrar com Google”, solicitamos ao Google apenas os escopos <code>openid</code>, <code>email</code> e <code>profile</code> e recebemos: o identificador da sua conta Google, seu endereço de e-mail, a confirmação de que o e-mail é verificado e o seu nome. <b>Não temos acesso</b> ao seu Gmail, Google Drive, contatos, agenda ou a qualquer outro dado da sua conta Google.</p>
<ul>
  <li><b>Uso:</b> esses dados servem exclusivamente para criar sua conta no PayTracking, identificar você no login e vincular o login com Google a uma conta existente com o mesmo e-mail verificado.</li>
  <li><b>Compartilhamento:</b> não vendemos, não alugamos e não compartilhamos dados recebidos do Google com terceiros, exceto quando necessário para operar o próprio serviço (hospedagem e banco de dados), por obrigação legal ou com o seu consentimento.</li>
  <li><b>Publicidade e IA:</b> não usamos dados do Google para publicidade, para criar perfis de marketing nem para treinar modelos de inteligência artificial.</li>
  <li><b>Acesso humano:</b> ninguém lê esses dados, salvo para segurança da conta, investigação de abuso, cumprimento da lei ou com o seu pedido expresso.</li>
  <li><b>Exclusão:</b> você pode desvincular removendo o acesso em <a href="https://myaccount.google.com/permissions" rel="noopener">myaccount.google.com/permissions</a> e pedir a exclusão da conta pelo e-mail ${mail}.</li>
</ul>
<p class="note">O uso e a transferência, para qualquer outro aplicativo, das informações recebidas das APIs do Google seguirão a <a href="https://developers.google.com/terms/api-services-user-data-policy" rel="noopener">Política de Dados do Usuário dos Serviços de API do Google</a>, incluindo os requisitos de Uso Limitado.</p>

<h2 id="uso">5. Para que usamos os dados e bases legais (LGPD)</h2>
<table>
  <thead><tr><th>Finalidade</th><th>Base legal</th></tr></thead>
  <tbody>
    <tr><td>Criar e manter sua conta, autenticar o acesso (inclusive pelo Google) e prestar o serviço contratado</td><td>Execução de contrato (art. 7º, V)</td></tr>
    <tr><td>Registrar vendas, atribuí-las às campanhas e enviar as conversões à Meta conforme configurado pelo cliente</td><td>Execução de contrato com o cliente; como operador, segundo as instruções do cliente (controlador)</td></tr>
    <tr><td>Segurança: verificação em duas etapas, alertas de acesso, limite de tentativas, prevenção a fraude e abuso</td><td>Legítimo interesse (art. 7º, IX)</td></tr>
    <tr><td>Cobrança da assinatura</td><td>Execução de contrato</td></tr>
    <tr><td>E-mails transacionais (confirmação de e-mail, redefinição de senha, convites e alertas de segurança)</td><td>Execução de contrato e legítimo interesse</td></tr>
    <tr><td>Guarda de registros de acesso pelo prazo legal</td><td>Cumprimento de obrigação legal (Marco Civil da Internet, art. 15)</td></tr>
  </tbody>
</table>
<p>Não enviamos e-mails de marketing sem o seu consentimento e não vendemos dados pessoais.</p>

<h2 id="compartilhamento">6. Com quem compartilhamos</h2>
<p>Compartilhamos dados apenas com prestadores necessários para operar o serviço, que atuam sob nossas instruções:</p>
<ul>
  <li><b>Hospedagem da aplicação</b> e <b>Neon</b> (banco de dados PostgreSQL gerenciado), onde os dados ficam armazenados.</li>
  <li><b>Meta Platforms</b>: recebe as conversões pela API de Conversões (com dados pessoais já em resumo criptográfico) e fornece as métricas de anúncios, por instrução do cliente.</li>
  <li><b>Google</b>: autenticação, quando você usa o login com Google; e o serviço de notificações do Chrome/Android.</li>
  <li><b>Apple e Mozilla</b>: serviços de notificação dos navegadores, quando você ativa notificações nesses aparelhos.</li>
  <li><b>Woovi</b>: geração e confirmação das cobranças PIX da assinatura.</li>
  <li><b>Provedor de e-mail</b> (servidor SMTP da hospedagem ou Resend): envio dos e-mails transacionais.</li>
  <li><b>Autoridades públicas</b>, quando houver obrigação legal ou ordem judicial.</li>
</ul>

<h2 id="internacional">7. Transferência internacional</h2>
<p>Alguns desses prestadores (como Meta, Google e o provedor de banco de dados) podem armazenar ou processar dados fora do Brasil. Nesses casos, a transferência ocorre para execução do contrato e com prestadores que adotam garantias de proteção compatíveis com a LGPD (art. 33).</p>

<h2 id="retencao">8. Por quanto tempo guardamos</h2>
<ul>
  <li>Eventos de navegação: até ${l.trackingDays} dias.</li>
  <li>Identidades de visitantes (cookies, IP, navegador, resumos de e-mail/telefone): apagadas após 120 dias sem atividade.</li>
  <li>Conteúdo original das notificações dos meios de pagamento: até ${l.webhookDays} dias (depois, só os dados da venda permanecem).</li>
  <li>Sessões de acesso: apagadas até 7 dias depois de expirar ou de serem encerradas.</li>
  <li>Dados da conta, vendas e configurações: enquanto a conta existir. Ao receber o pedido de exclusão, apagamos os dados da organização em até 30 dias, exceto o que a lei nos obrigue a guardar (como registros de acesso por 6 meses).</li>
</ul>

<h2 id="cookies">9. Cookies e armazenamento local</h2>
<h3>No painel do PayTracking</h3>
<ul>
  <li><code>pt_session</code> — essencial: mantém você conectado (protegido contra leitura por scripts).</li>
  <li><code>pt_google</code> — essencial e temporário (10 minutos): protege o login com Google contra falsificação.</li>
  <li>Armazenamento local do navegador: preferências como tema, som de venda e notificações.</li>
</ul>
<p>O painel não usa cookies de publicidade nem de rastreamento de terceiros.</p>
<h3>No pixel instalado nas páginas dos clientes</h3>
<ul>
  <li><code>_fbp</code> e <code>_fbc</code> — cookies da Meta usados para atribuir as conversões aos anúncios.</li>
  <li><code>pt_ua</code>, e no armazenamento do navegador <code>pt_xid</code> (identificador anônimo) e <code>pt_utms</code> (parâmetros da campanha).</li>
  <li><code>pt_pii</code> no armazenamento da sessão — dados do formulário, apagados quando a aba é fechada.</li>
</ul>
<p>Cabe ao cliente informar esses cookies aos visitantes do site dele e obter o consentimento quando exigido.</p>

<h2 id="seguranca">10. Segurança</h2>
<ul>
  <li>Conexões protegidas por HTTPS (TLS).</li>
  <li>Tokens, segredos e chaves guardados cifrados com AES-256-GCM; senhas com bcrypt.</li>
  <li>Verificação em duas etapas opcional, alertas por e-mail em mudanças sensíveis, limite de tentativas de acesso e permissões por papel na equipe.</li>
  <li>Dados pessoais de compradores enviados à Meta apenas em resumo criptográfico (SHA-256).</li>
</ul>
<p>Nenhum sistema é totalmente imune a incidentes. Se ocorrer um incidente que possa trazer risco relevante, comunicaremos os afetados e a ANPD conforme a LGPD.</p>

<h2 id="direitos">11. Seus direitos</h2>
<p>Pela LGPD (art. 18) você pode pedir: confirmação de que tratamos seus dados; acesso; correção; anonimização, bloqueio ou eliminação de dados desnecessários; portabilidade; eliminação dos dados tratados com consentimento; informação sobre compartilhamentos; e revogação do consentimento. Também pode se opor a tratamentos feitos com base em legítimo interesse.</p>
<p>Para exercer esses direitos, escreva para ${mail}. Respondemos em até 15 dias. Se você é comprador ou visitante do site de um de nossos clientes, faça o pedido também ao vendedor (o controlador); nós o apoiaremos no atendimento. Você também pode reclamar à Autoridade Nacional de Proteção de Dados (ANPD).</p>

<h2 id="criancas">12. Menores de idade</h2>
<p>O PayTracking é uma ferramenta profissional destinada a maiores de 18 anos e não é direcionado a crianças ou adolescentes.</p>

<h2 id="mudancas">13. Mudanças nesta política</h2>
<p>Podemos atualizar esta política para refletir mudanças no serviço ou na lei. A data de atualização fica no topo da página. Mudanças relevantes serão avisadas por e-mail ou no painel.</p>

<h2 id="contato">14. Contato</h2>
<p>Encarregado pelo tratamento de dados (DPO) e assuntos de privacidade: ${mail}.</p>`;
}

function terms(l: Legal): string {
  const mail = `<a href="mailto:${esc(l.contactEmail)}">${esc(l.contactEmail)}</a>`;
  const price = (l.priceMinor / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
  return `
<h2>1. O serviço</h2>
<p>O PayTracking é uma ferramenta on-line, operada por ${esc(l.operator)}, que recebe as vendas dos meios de pagamento do cliente, as associa às campanhas de anúncios e envia as conversões à Meta, além de exibir relatórios no painel. Ao criar uma conta, você concorda com estes Termos e com a <a href="/privacidade">Política de Privacidade</a>.</p>

<h2>2. Conta</h2>
<ul>
  <li>Você deve ter 18 anos ou mais e fornecer informações verdadeiras.</li>
  <li>Você é responsável pelo sigilo da sua senha e pelas ações feitas na sua conta e pelos membros que convidar. Recomendamos ativar a verificação em duas etapas.</li>
</ul>

<h2>3. Teste grátis, preço e pagamento</h2>
<ul>
  <li>Novas contas têm ${l.trialDays} dias de teste grátis, sem cadastro de cartão.</li>
  <li>Depois do teste, o acesso ao painel custa ${price} por mês, pago por PIX dentro do painel. Não há cobrança automática nem fidelidade: se o pagamento não for feito, o acesso ao painel é pausado (o recebimento de vendas e o envio de conversões continuam funcionando enquanto isso).</li>
  <li>Não cobramos taxa ou porcentagem sobre as vendas, e não há limite de vendas.</li>
  <li>Alterações de preço serão avisadas com antecedência e valem a partir do período seguinte.</li>
</ul>

<h2>4. Responsabilidades do cliente</h2>
<ul>
  <li>Usar o serviço de acordo com a lei, incluindo a LGPD e as políticas da Meta e dos meios de pagamento.</li>
  <li>Informar aos visitantes e compradores do seu site, na sua política de privacidade, o uso do pixel, dos cookies e o envio de conversões à Meta, e obter consentimento quando exigido. Para esses dados você é o controlador e o PayTracking atua como operador.</li>
  <li>Manter seguros os tokens e segredos das integrações.</li>
</ul>

<h2>5. Uso proibido</h2>
<p>É proibido usar o PayTracking para atividades ilegais, para enviar dados sem base legal, tentar acessar dados de outras contas, sobrecarregar ou atacar o serviço, ou fazer engenharia reversa para burlar limites e proteções.</p>

<h2>6. Serviços de terceiros</h2>
<p>O funcionamento depende de serviços de terceiros (Meta, meios de pagamento, Google, hospedagem). Não controlamos esses serviços nem suas mudanças. O PayTracking melhora a qualidade dos dados enviados, mas <b>não garante resultados de anúncios</b>, vendas ou desempenho de campanhas.</p>

<h2>7. Disponibilidade</h2>
<p>Trabalhamos para manter o serviço disponível e seguro, mas podem ocorrer interrupções para manutenção ou por falhas fora do nosso controle. Eventos recebidos são enfileirados e reenviados automaticamente sempre que possível.</p>

<h2>8. Limitação de responsabilidade</h2>
<p>Na máxima extensão permitida pela lei, o PayTracking não responde por lucros cessantes ou danos indiretos. A responsabilidade total fica limitada ao valor pago pelo cliente nos 12 meses anteriores ao fato. Nada nestes Termos limita direitos garantidos pelo Código de Defesa do Consumidor quando aplicável.</p>

<h2>9. Cancelamento e exclusão</h2>
<p>Você pode parar de usar o serviço a qualquer momento, sem multa. Para excluir a conta e os dados, escreva para ${mail}. Podemos suspender contas que violem estes Termos, avisando sempre que possível.</p>

<h2>10. Lei aplicável</h2>
<p>Estes Termos seguem as leis brasileiras. Fica eleito o foro do domicílio do cliente para resolver eventuais conflitos.</p>

<h2>11. Contato</h2>
<p>Dúvidas sobre estes Termos: ${mail}.</p>`;
}

export function legalRoutes(app: FastifyInstance, ctx: Ctx) {
  const send = (html: string) => (_req: unknown, reply: import('fastify').FastifyReply) => reply
    .type('text/html; charset=utf-8')
    .header('Cache-Control', 'public, max-age=3600')
    .header('Content-Security-Policy', "default-src 'none'; style-src 'unsafe-inline'; img-src 'self' data:; base-uri 'none'; form-action 'none'; frame-ancestors 'none'")
    .send(html);
  const l = legalInfo(ctx);
  const privacyHtml = layout('Política de Privacidade',
    'Como o PayTracking coleta, usa, compartilha e protege dados pessoais — incluindo os dados recebidos pelo login com Google — e como você exerce seus direitos pela LGPD.',
    privacy(l), l, '/privacidade');
  const termsHtml = layout('Termos de Uso', 'As regras de uso do PayTracking: teste grátis, preço mensal fixo sem taxa por venda, responsabilidades e cancelamento.', terms(l), l, '/termos');
  for (const p of ['/privacidade', '/politica-de-privacidade', '/privacy']) app.get(p, send(privacyHtml));
  for (const p of ['/termos', '/termos-de-uso', '/terms']) app.get(p, send(termsHtml));
}
