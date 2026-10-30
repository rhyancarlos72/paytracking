import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import clsx from 'clsx';
import { CheckCircle2, Code2, Download, EyeOff, FileCode2, KeyRound, Plug, Plus, Send, ShieldCheck, Webhook } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { PageHeader } from '../components/shell';
import { useToast } from '../components/toast';
import { Badge, Button, Callout, Card, CodeBlock, ConfirmButton, EmptyState, ErrorState, Field, Input, Modal, Select, Skeleton, Switch } from '../components/ui';
import { del, get, patch, post } from '../lib/api';
import { buildPaytrackingPhp, checkoutEndpoint, downloadText } from '../lib/dispatch-php';
import { int, relative } from '../lib/format';
import { useSession } from '../lib/session';
import { mask, Name, useNamesHidden } from '../lib/privacy';
import { MetaUtmCard } from '../components/meta-utm';

interface Integration {
  id: string; provider: string; providerLabel: string; authMethod: string; requiresSecret: boolean; configurableAmountUnit: boolean;
  name: string; tokenHint: string; secretConfigured: boolean; defaultPixelId: string | null; amountUnit: 'major' | 'minor'; active: boolean;
  lastReceivedAt: string | null; stats: Record<string, number> | null; sendToMeta: boolean;
}
interface Revealed { url: string; token: string; provider: string; secret?: string; sendToMeta?: boolean }

const HELP: Record<string, string> = {
  checkout: 'Use o paytracking.php gerado aqui: arquivo independente (convive com o paytrack_dispatch.php antigo), que envia o PIX gerado e o pagamento aprovado com token e assinatura HMAC-SHA256.',
  kiwify: 'Kiwify → Apps → Webhooks → Adicionar. Cole a URL e copie o "Token" do webhook para o campo segredo.',
  cakto: 'Cakto → Integrações → Webhooks. Cole a URL e use o mesmo "secret" aqui.',
  kirvano: 'Kirvano → Integrações → Webhooks. Cole a URL e use o mesmo token (enviado em security-token).',
  hotmart: 'Hotmart → Ferramentas → Webhook (versão 2.0). Selecione compra aprovada, completa, reembolso, chargeback e cancelamento. Cole o Hottok no segredo.',
  lowify: 'Lowify → Integrações → Webhooks. A URL já autentica. Confira a unidade do valor (reais ou centavos) com um pagamento de teste.',
  wiapay: 'Wiapay → Configurações → Webhooks. A URL já autentica. Confira a unidade do valor com um pagamento de teste.',
};

// marcas: letras brancas sobre tons escuros (contraste ≥ 4,5:1)
const MARK: Record<string, { letter: string; cls: string }> = {
  checkout: { letter: '', cls: 'bg-gradient-to-br from-[#7653ff] to-[#4f39e6]' },
  kiwify: { letter: 'K', cls: 'bg-gradient-to-br from-emerald-600 to-emerald-800' },
  hotmart: { letter: 'H', cls: 'bg-gradient-to-br from-orange-600 to-red-700' },
  cakto: { letter: 'C', cls: 'bg-gradient-to-br from-sky-600 to-blue-800' },
  kirvano: { letter: 'Kv', cls: 'bg-gradient-to-br from-violet-600 to-purple-800' },
  lowify: { letter: 'L', cls: 'bg-gradient-to-br from-teal-600 to-cyan-800' },
  wiapay: { letter: 'W', cls: 'bg-gradient-to-br from-pink-600 to-rose-800' },
};
function ProviderMark({ provider, className }: { provider: string; className?: string }) {
  const m = MARK[provider] ?? { letter: provider[0]?.toUpperCase() ?? '?', cls: 'bg-surface-3' };
  return (
    <span aria-hidden className={clsx('flex shrink-0 items-center justify-center rounded-xl text-sm font-bold text-white shadow-sm ring-1 ring-inset ring-white/10', m.cls, className ?? 'h-11 w-11')}>
      {provider === 'checkout' ? <Code2 className="h-5 w-5" /> : m.letter}
    </span>
  );
}

export default function IntegrationsPage() {
  useNamesHidden(); // redesenha ao ligar/desligar o olho (selects e títulos)
  const s = useSession();
  const qc = useQueryClient();
  const toast = useToast();
  const [sp, setSp] = useSearchParams();
  const q = useQuery<{ integrations: Integration[] }>({ queryKey: ['integrations'], queryFn: () => get('/v1/integrations') });
  const pixels = useQuery({ queryKey: ['pixels'], queryFn: () => get('/v1/pixels') });
  const [creating, setCreating] = useState<string | null>(null);
  const [revealed, setRevealed] = useState<Revealed | null>(null);
  const [secretFor, setSecretFor] = useState<Integration | null>(null);
  const refresh = () => qc.invalidateQueries({ queryKey: ['integrations'] });
  const update = useMutation({ mutationFn: ({ id, body }: { id: string; body: object }) => patch(`/v1/integrations/${id}`, body), onSuccess: () => { toast.ok('Integração atualizada'); void refresh(); }, onError: (e) => toast.err(e) });
  const admin = s.can('admin');
  const pixelName = (id: string | null) => (pixels.data?.pixels ?? []).find((p: any) => p.id === id)?.name;
  const hasCheckout = (q.data?.integrations ?? []).some((i) => i.provider === 'checkout');

  // ?nova=1 (paleta de comandos) ou ?nova=checkout abre o assistente
  useEffect(() => {
    const v = sp.get('nova');
    if (v && admin) { setCreating(v === '1' ? 'hotmart' : v); const n = new URLSearchParams(sp); n.delete('nova'); setSp(n, { replace: true }); }
  }, [sp, admin, setSp]);

  return (
    <>
      <PageHeader title="Integrações" eyebrow="Configuração" description="Gateways de pagamento e checkout próprio. Cada integração tem uma URL de webhook exclusiva e só confirma venda com pagamento aprovado."
        actions={admin && <Button variant="primary" icon={<Plus className="h-4 w-4" />} onClick={() => setCreating('hotmart')}>Nova integração</Button>} />

      {revealed && <RevealedPanel r={revealed} onDone={() => setRevealed(null)} />}

      {!hasCheckout && q.data && !revealed && admin && <CheckoutHero onStart={() => setCreating('checkout')} />}

      <MetaUtmCard className="mb-6" />

      {q.isError ? <Card><ErrorState error={q.error} onRetry={() => q.refetch()} /></Card>
        : !q.data ? <div className="grid gap-4 xl:grid-cols-2"><Skeleton className="h-64" /><Skeleton className="h-64" /></div>
        : q.data.integrations.length === 0 ? <Card><EmptyState icon={<Plug />} title="Nenhuma integração" description="Conecte Kiwify, Cakto, Kirvano, Hotmart, Lowify, Wiapay ou o seu checkout próprio para registrar as vendas reais." action={admin && <Button variant="primary" onClick={() => setCreating('hotmart')}>Adicionar integração</Button>} /></Card>
        : (
          <div className="grid gap-5 xl:grid-cols-2">
            {q.data.integrations.map((i) => {
              const missingSecret = i.requiresSecret && !i.secretConfigured;
              const rejected = i.stats?.rejected ?? 0;
              return (
                <article key={i.id} className="card card-interactive p-5">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="flex min-w-0 flex-1 items-center gap-3">
                      <ProviderMark provider={i.provider} />
                      <div className="min-w-0"><h2 className="truncate font-semibold">{i.name}</h2><p className="truncate text-xs text-muted">{i.providerLabel} · {i.authMethod}</p></div>
                    </div>
                    <div className="flex items-center gap-2">
                      {i.active && !i.sendToMeta && <Badge tone="info"><EyeOff className="h-3 w-3" aria-hidden />Modo sombra</Badge>}
                      <Badge tone={i.active ? (missingSecret ? 'warn' : 'ok') : 'neutral'} dot>{!i.active ? 'Pausada' : missingSecret ? 'Falta segredo' : 'Ativa'}</Badge>
                      {admin && <Switch checked={i.active} label={`Ativar ${i.name}`} onChange={(v) => update.mutate({ id: i.id, body: { active: v } })} />}
                    </div>
                  </div>

                  <div className="mt-5 grid grid-cols-3 items-stretch gap-2">
                    <Metric label="Processados (7 dias)" value={int(i.stats?.processed ?? 0)} />
                    <Metric label="Rejeitados" value={int(rejected)} tone={rejected > 0 ? 'err' : undefined} />
                    <Metric label="Último webhook" value={relative(i.lastReceivedAt)} small />
                  </div>

                  <dl className="mt-4 grid grid-cols-2 gap-x-4 gap-y-2 text-[13px]">
                    <dt className="text-muted">Token</dt><dd className="font-mono">{i.tokenHint}</dd>
                    <dt className="text-muted">Segredo</dt><dd>{i.secretConfigured ? <span className="inline-flex items-center gap-1 text-ok"><ShieldCheck className="h-3.5 w-3.5" aria-hidden />configurado</span> : i.requiresSecret ? <span className="text-err">obrigatório</span> : 'opcional'}</dd>
                    <dt className="text-muted">Pixel padrão</dt><dd className="truncate"><Name kind="pixel" value={pixelName(i.defaultPixelId)} fallback="por produto" /></dd>
                    {i.configurableAmountUnit && <><dt className="text-muted">Unidade do valor</dt><dd>{i.amountUnit === 'minor' ? 'centavos' : 'reais'}</dd></>}
                  </dl>
                  <div className={clsx('mt-4 flex items-center justify-between gap-3 rounded-xl border px-3.5 py-3', i.sendToMeta ? 'border-border bg-surface-2/40' : 'border-info/30 bg-info/[0.06]')}>
                    <div className="min-w-0">
                      <p className="flex items-center gap-1.5 text-[13px] font-semibold">{i.sendToMeta ? <Send className="h-3.5 w-3.5 text-primary" aria-hidden /> : <EyeOff className="h-3.5 w-3.5 text-info" aria-hidden />}{i.sendToMeta ? 'Enviando à Meta' : 'Modo sombra: registra sem enviar à Meta'}</p>
                      <p className="mt-0.5 text-xs text-muted">{i.sendToMeta ? 'Vendas aprovadas viram Purchase na Conversions API.' : 'Use enquanto o sistema antigo ainda envia as conversões. Ao ligar, só as vendas novas são enviadas.'}</p>
                    </div>
                    {admin && <Switch checked={i.sendToMeta} label={`Enviar vendas de ${i.name} à Meta`} onChange={(v) => update.mutate({ id: i.id, body: { sendToMeta: v } })} />}
                  </div>
                  <p className="mt-3 text-xs leading-relaxed text-muted">{HELP[i.provider]}</p>

                  {admin && (
                    <div className="mt-4 flex flex-wrap gap-2 border-t border-border pt-4">
                      {i.provider === 'checkout' && (
                        <Button size="sm" icon={<Download className="h-4 w-4" />} title="O token só aparece na criação: o arquivo vem sem ele (defina PAYTRACKING_TOKEN). Para um arquivo completo, use “Novo token”."
                          onClick={() => downloadText('paytracking.php', buildPaytrackingPhp({ webhookUrl: checkoutEndpoint(location.origin), token: null }))}>
                          <span className="sm:hidden">Baixar PHP</span><span className="hidden sm:inline">Baixar paytracking.php (sem token)</span>
                        </Button>
                      )}
                      <Button size="sm" icon={<KeyRound className="h-4 w-4" />} onClick={() => setSecretFor(i)}>{i.secretConfigured ? 'Trocar segredo' : 'Definir segredo'}</Button>
                      <Select aria-label="Pixel padrão" className="h-8 w-[180px] rounded-lg text-base sm:text-[13px]" value={i.defaultPixelId ?? ''} onChange={(e) => update.mutate({ id: i.id, body: { defaultPixelId: e.target.value || null } })}>
                        <option value="">Pixel: por produto</option>
                        {(pixels.data?.pixels ?? []).map((p: any) => <option key={p.id} value={p.id}>{mask('pixel', p.name)}</option>)}
                      </Select>
                      {i.configurableAmountUnit && (
                        <Select aria-label="Unidade do valor" className="h-8 w-[150px] rounded-lg text-base sm:text-[13px]" value={i.amountUnit} onChange={(e) => update.mutate({ id: i.id, body: { amountUnit: e.target.value } })}>
                          <option value="major">Valor em reais</option><option value="minor">Valor em centavos</option>
                        </Select>
                      )}
                      <ConfirmButton size="sm" title="Gerar nova URL e token?" description="A URL e o token atuais deixam de funcionar imediatamente. Atualize no gateway (ou baixe o PHP de novo)." confirmLabel="Gerar"
                        onConfirm={async () => { const r = await post(`/v1/integrations/${i.id}/rotate-token`); setRevealed({ url: r.webhookUrl, token: r.token, provider: i.provider }); }}>Novo token</ConfirmButton>
                      <ConfirmButton size="sm" variant="ghost" danger title={`Excluir ${i.name}?`} description="Webhooks enviados para esta URL passam a ser recusados." confirmLabel="Excluir"
                        onConfirm={async () => { await del(`/v1/integrations/${i.id}`); await refresh(); }}>Excluir</ConfirmButton>
                    </div>
                  )}
                </article>
              );
            })}
          </div>
        )}
      {creating && <CreateModal initial={creating} pixels={pixels.data?.pixels ?? []} onClose={() => setCreating(null)} onCreated={(r) => { setCreating(null); setRevealed(r); void refresh(); }} />}
      {secretFor && <SecretModal integ={secretFor} onClose={() => setSecretFor(null)} onSave={async (secret) => { await update.mutateAsync({ id: secretFor.id, body: { secret } }); setSecretFor(null); }} />}
    </>
  );
}

function Metric({ label, value, tone, small }: { label: string; value: string; tone?: 'err'; small?: boolean }) {
  return (
    <div className="rounded-xl border border-border bg-surface-2/50 px-3 py-2.5">
      <p className="text-[11px] leading-tight text-muted sm:truncate">{label}</p>
      <p className={clsx('num mt-1 font-semibold leading-tight sm:truncate', small ? 'text-[13px]' : 'text-lg', tone === 'err' && 'text-err')}>{value}</p>
    </div>
  );
}

function CheckoutHero({ onStart }: { onStart: () => void }) {
  return (
    <section className="card relative mb-6 overflow-hidden p-6 lg:p-8">
      <div className="pointer-events-none absolute -right-20 -top-20 h-72 w-72 rounded-full bg-primary/20 blur-3xl" aria-hidden />
      <div className="pointer-events-none absolute -bottom-24 left-1/3 h-56 w-56 rounded-full bg-accent/10 blur-3xl" aria-hidden />
      <div className="relative grid gap-8 lg:grid-cols-[1.1fr_1fr] lg:items-center">
        <div>
          <Badge tone="primary">Checkout próprio</Badge>
          <h2 className="mt-3 text-2xl font-semibold">Conecte o seu checkout em 3 passos</h2>
          <p className="mt-2 text-sm text-muted">Geramos o <code className="rounded bg-surface-2 px-1 py-0.5 font-mono text-[12px]">paytracking.php</code> já configurado — um arquivo independente, que convive com o paytrack_dispatch.php antigo sem misturar nada. Ele envia o PIX gerado e o pagamento aprovado, com order bumps, UTMs e o mesmo event_id do Pixel, e cada envio é assinado.</p>
          <Button variant="primary" size="lg" className="mt-6" icon={<Plus className="h-4 w-4" />} onClick={onStart}>Criar integração do checkout</Button>
        </div>
        <ol className="space-y-3">
          {[
            { icon: <Plug />, t: 'Crie a integração', d: 'Defina um segredo para bloquear envios forjados.' },
            { icon: <Download />, t: 'Baixe o paytracking.php', d: 'URL, token e segredo já vêm preenchidos.' },
            { icon: <FileCode2 />, t: 'Chame no webhook do gateway', d: 'Uma linha quando o PIX for gerado e outra quando for pago.' },
          ].map((x, i) => (
            <li key={x.t} className="flex items-start gap-3 rounded-2xl border border-border bg-surface/70 p-4">
              <span className="icon-tile-primary h-9 w-9 text-sm font-semibold" aria-hidden>{i + 1}</span>
              <div><p className="text-sm font-semibold">{x.t}</p><p className="text-xs text-muted">{x.d}</p></div>
            </li>
          ))}
        </ol>
      </div>
    </section>
  );
}

function RevealedPanel({ r, onDone }: { r: Revealed; onDone: () => void }) {
  const isCheckout = r.provider === 'checkout';
  const endpoint = checkoutEndpoint(r.url);
  const [downloaded, setDownloaded] = useState(false);
  return (
    <section className="card relative mb-6 overflow-hidden border-ok/30 p-6 animate-slide-up">
      <div className="pointer-events-none absolute -right-16 -top-16 h-56 w-56 rounded-full bg-ok/10 blur-3xl" aria-hidden />
      <div className="relative flex flex-wrap items-start justify-between gap-3">
        <div className="flex items-start gap-3">
          <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-ok/15 text-ok" aria-hidden><CheckCircle2 className="h-5 w-5" /></span>
          <div>
            <h2 className="text-lg font-semibold">{isCheckout ? 'Checkout próprio conectado' : 'Integração criada'}</h2>
            <p className="text-sm text-muted">Copie agora: o token não será exibido novamente.</p>
          </div>
        </div>
        <Button size="sm" onClick={onDone}>Concluído</Button>
      </div>

      {isCheckout ? (
        <div className="relative mt-6 grid gap-6 lg:grid-cols-2">
          <div className="space-y-4">
            <div className="rounded-2xl border border-primary/25 bg-primary/[0.06] p-5">
              <p className="flex items-center gap-2 text-sm font-semibold"><FileCode2 className="h-4 w-4 text-primary" aria-hidden />1. Baixe o paytracking.php já configurado</p>
              <p className="mt-1 text-xs text-muted">Gerado no seu navegador com a URL, o token{r.secret ? ' e o segredo' : ''} desta integração. É um arquivo novo e independente: pode ficar ao lado do paytrack_dispatch.php antigo sem misturar nada. Guarde como um segredo.</p>
              <Button variant="primary" className="mt-4 w-full" icon={downloaded ? <CheckCircle2 className="h-4 w-4" /> : <Download className="h-4 w-4" />}
                onClick={() => { downloadText('paytracking.php', buildPaytrackingPhp({ webhookUrl: endpoint, token: r.token, secret: r.secret })); setDownloaded(true); }}>
                {downloaded ? 'Baixado — baixar de novo' : 'Baixar paytracking.php'}
              </Button>
              {!r.secret && <p className="mt-3 text-xs text-warn">Sem segredo: qualquer pessoa com o token consegue enviar vendas. Defina um segredo no cartão da integração e baixe o arquivo de novo.</p>}
            </div>
            {r.sendToMeta === false && (
              <Callout tone="info" title="Modo sombra ligado">As vendas serão registradas aqui, mas nada vai para a Meta enquanto o sistema antigo estiver ativo. Quando trocar, ligue “Enviar à Meta” no cartão da integração.</Callout>
            )}
            <CodeBlock label="URL (Authorization: Bearer)" code={endpoint} />
            <CodeBlock label="Token" code={r.token} />
          </div>
          <div className="space-y-4">
            <p className="text-sm font-semibold">2. Suba na pasta dos webhooks e inclua no topo</p>
            <CodeBlock label="webhook do gateway (EFI, Woovi…)" code={"require_once __DIR__ . '/paytracking.php';"} />
            <p className="text-sm font-semibold">3. Chame nos momentos certos</p>
            <CodeBlock label="PIX gerado · pago · estorno · expirado" code={[
              '// PIX/boleto gerado → venda pendente (não vira Purchase)',
              "\\PayTracking\\Checkout::pixGerado($transacao, 'efi');",
              '',
              '// PIX pago → venda aprovada → Purchase na Meta (com order bumps via $pdo)',
              "\\PayTracking\\Checkout::pagamentoAprovado($transacao, $pdo, 'efi');",
              '',
              '// estorno do pagamento',
              "\\PayTracking\\Checkout::reembolso($transacao, 'efi');",
              '',
              '// PIX expirado / pedido cancelado antes de pagar',
              "\\PayTracking\\Checkout::cancelado($transacao, 'efi');",
            ].join('\n')} />
            <p className="text-xs text-muted">Nunca interrompe o seu checkout: retorna <code className="font-mono">true</code>/<code className="font-mono">false</code> e registra o motivo em <code className="font-mono">logs/paytracking.log</code>. Pode manter as chamadas do arquivo antigo enquanto migra — o Purchase usa o mesmo event_id, então a Meta conta uma venda só.</p>
          </div>
        </div>
      ) : (
        <div className="relative mt-5 space-y-3">
          <CodeBlock label="URL do webhook (cole no painel do gateway)" code={r.url} />
        </div>
      )}
    </section>
  );
}

function CreateModal({ initial, pixels, onClose, onCreated }: { initial: string; pixels: any[]; onClose: () => void; onCreated: (r: Revealed) => void }) {
  const toast = useToast();
  const providers = useQuery({ queryKey: ['providers'], queryFn: () => get('/v1/integrations/providers') });
  const [provider, setProvider] = useState(initial);
  const [secret, setSecret] = useState('');
  const [pixel, setPixel] = useState('');
  const [unit, setUnit] = useState<'major' | 'minor'>('major');
  const [sendToMeta, setSendToMeta] = useState(true);
  const [busy, setBusy] = useState(false);
  const list: Array<{ provider: string; label: string; authMethod: string; requiresSecret: boolean; configurableAmountUnit: boolean }> = providers.data?.providers ?? [];
  const meta = list.find((p) => p.provider === provider);
  const isCheckout = provider === 'checkout';
  return (
    <Modal open size="lg" onClose={onClose} title="Nova integração" description="Escolha de onde vêm as vendas." footer={<>
      <Button variant="ghost" onClick={onClose}>Cancelar</Button>
      <Button variant="primary" loading={busy} disabled={!!meta?.requiresSecret && secret.length < 4} onClick={async () => {
        setBusy(true);
        try {
          const r = await post('/v1/integrations', { provider, secret: secret || undefined, defaultPixelId: pixel || undefined, amountUnit: unit, sendToMeta });
          onCreated({ url: r.webhookUrl, token: r.token, provider, secret: secret || undefined, sendToMeta });
        } catch (e) { toast.err(e); } finally { setBusy(false); }
      }}>Criar integração</Button>
    </>}>
      <div className="space-y-5">
        <fieldset>
          <legend className="label">Origem das vendas</legend>
          <div role="radiogroup" aria-label="Origem das vendas" className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            {(list.length ? list : [{ provider: 'checkout', label: 'Checkout próprio' }] as any[]).map((p) => (
              <button key={p.provider} type="button" role="radio" aria-checked={provider === p.provider} onClick={() => setProvider(p.provider)}
                className={clsx('flex flex-col items-center gap-2 rounded-2xl border p-3 text-center text-[13px] font-medium transition',
                  provider === p.provider ? 'border-primary bg-primary/[0.07] ring-2 ring-primary/25' : 'border-border hover:border-border-strong hover:bg-surface-2/60')}>
                <ProviderMark provider={p.provider} className="h-9 w-9" />{p.label}
              </button>
            ))}
          </div>
        </fieldset>
        <p className="rounded-xl bg-surface-2/60 p-3 text-xs leading-relaxed text-muted"><Webhook className="mr-1 inline h-3.5 w-3.5" aria-hidden />{HELP[provider]}</p>
        <Field label={meta?.requiresSecret ? 'Segredo do webhook (obrigatório)' : isCheckout ? 'Segredo de assinatura (recomendado)' : 'Segredo (opcional)'} htmlFor="sec"
          hint={isCheckout ? 'Vai junto no paytracking.php. Com ele, o PayTracking só aceita envios assinados com HMAC-SHA256.' : meta?.authMethod}>
          <div className="flex gap-2">
            <Input id="sec" type="password" autoComplete="off" value={secret} onChange={(e) => setSecret(e.target.value)} />
            {isCheckout && <Button onClick={() => setSecret(`whsec_${Array.from(crypto.getRandomValues(new Uint8Array(24)), (b) => b.toString(16).padStart(2, '0')).join('')}`)}>Gerar</Button>}
          </div>
        </Field>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Pixel padrão" htmlFor="px" hint="Usado quando o produto da venda não estiver em nenhum pixel.">
            <Select id="px" value={pixel} onChange={(e) => setPixel(e.target.value)}>
              <option value="">Somente por produto</option>
              {pixels.map((p) => <option key={p.id} value={p.id}>{mask('pixel', p.name)}</option>)}
            </Select>
          </Field>
          {meta?.configurableAmountUnit && (
            <Field label="Unidade do valor enviado" htmlFor="unit" hint="O sistema não adivinha: confirme com um pagamento de teste.">
              <Select id="unit" value={unit} onChange={(e) => setUnit(e.target.value as 'major' | 'minor')}><option value="major">Reais (197.00)</option><option value="minor">Centavos (19700)</option></Select>
            </Field>
          )}
        </div>
        <div className={clsx('flex items-start justify-between gap-4 rounded-2xl border p-4', sendToMeta ? 'border-border' : 'border-info/30 bg-info/[0.06]')}>
          <div>
            <p className="text-sm font-semibold">Enviar vendas à Meta (Conversions API)</p>
            <p className="mt-1 text-xs text-muted">{sendToMeta
              ? 'Desligue se outro sistema (ex.: o PayTracking antigo) ainda envia estas conversões: as vendas ficam registradas aqui em modo sombra, sem duplicar nada na Meta.'
              : 'Modo sombra: tudo é registrado e aparece no painel, mas nada vai para a Meta. Ligue quando o sistema antigo for desativado.'}</p>
          </div>
          <Switch checked={sendToMeta} label="Enviar vendas à Meta" onChange={setSendToMeta} />
        </div>
        {isCheckout && <Callout tone="info" title="Order bumps, UTMs e event_id já incluídos">O paytracking.php lê os bumps da tabela transacoes_adicionais e reaproveita o purchase_event_id salvo pelo seu checkout, para a Meta deduplicar com o Pixel.</Callout>}
      </div>
    </Modal>
  );
}

function SecretModal({ integ, onClose, onSave }: { integ: Integration; onClose: () => void; onSave: (s: string | null) => Promise<void> }) {
  const [v, setV] = useState('');
  const [busy, setBusy] = useState(false);
  return (
    <Modal open onClose={onClose} title={`Segredo — ${integ.name}`} description={integ.authMethod} footer={<>
      {!integ.requiresSecret && integ.secretConfigured && <Button variant="ghost" onClick={async () => { setBusy(true); await onSave(null).finally(() => setBusy(false)); }}>Remover segredo</Button>}
      <Button variant="primary" loading={busy} disabled={v.length < 4} onClick={async () => { setBusy(true); await onSave(v).finally(() => setBusy(false)); }}>Salvar</Button>
    </>}>
      <Field label="Novo segredo" htmlFor="ns" hint={integ.provider === 'checkout' ? 'Depois de salvar, baixe o paytracking.php de novo (ou defina PAYTRACKING_SECRET com o mesmo valor). Armazenado criptografado.' : 'Armazenado criptografado. Nunca é exibido novamente.'}>
        <Input id="ns" type="password" autoComplete="off" value={v} onChange={(e) => setV(e.target.value)} />
      </Field>
    </Modal>
  );
}
