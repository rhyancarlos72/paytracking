import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { CheckCircle2, Code2, Plus, Target } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useForm } from 'react-hook-form';
import { z } from 'zod';
import { PageHeader } from '../components/shell';
import { useToast } from '../components/toast';
import { Badge, Button, Card, CodeBlock, ConfirmButton, EmptyState, ErrorState, Field, Input, Modal, Segmented, Select, Skeleton, Switch } from '../components/ui';
import { del, get, post, put } from '../lib/api';
import { useSession } from '../lib/session';

const CURRENCIES = ['BRL', 'EUR', 'USD', 'GBP', 'CHF', 'CAD', 'AUD', 'MXN', 'ARS', 'CLP', 'COP', 'PEN', 'PYG', 'UYU', 'JPY', 'SEK', 'NOK', 'DKK', 'PLN', 'CZK', 'RON', 'TRY', 'ZAR', 'AED', 'INR'];
const COUNTRIES = ['BR', 'PT', 'ES', 'IT', 'FR', 'DE', 'NL', 'BE', 'IE', 'AT', 'CH', 'GB', 'US', 'CA', 'MX', 'AR', 'CL', 'CO', 'PE', 'PY', 'UY', 'AU', 'JP', 'PL', 'SE', 'NO', 'DK', 'FI', 'TR', 'ZA', 'AE', 'IN'];

interface Pixel {
  id: string; name: string; metaPixelId: string; capiTokenConfigured: boolean; testEventCode: string | null; currency: string; country: string;
  publicKey: string; active: boolean; icRuleType: string; icRuleValue: string | null; sendRefundEvent: boolean; productIds: string[];
  snippets: { salesPage: string; salesPageWithClickIc: string; checkoutPage: string; globalCheckoutLoader: string };
}

const schema = z.object({
  name: z.string().trim().min(1, 'Informe um nome').max(120),
  metaPixelId: z.string().trim().regex(/^\d{6,32}$/, 'Apenas dígitos (6 a 32)'),
  capiToken: z.string().trim().max(1000).optional(),
  testEventCode: z.string().trim().max(64).optional(),
  currency: z.string(),
  country: z.string(),
  productIds: z.string().max(5000).optional(),
  icRuleType: z.enum(['none', 'contains', 'equals', 'starts_with']),
  icRuleValue: z.string().max(500).optional(),
  sendRefundEvent: z.boolean(),
});
type Form = z.infer<typeof schema>;

export default function PixelsPage() {
  const s = useSession();
  const toast = useToast();
  const qc = useQueryClient();
  const q = useQuery<{ pixels: Pixel[] }>({ queryKey: ['pixels'], queryFn: () => get('/v1/pixels') });
  const [editing, setEditing] = useState<Pixel | 'new' | null>(null);
  const [install, setInstall] = useState<Pixel | null>(null);
  const [sp, setSp] = useSearchParams();
  useEffect(() => {
    if (sp.get('novo') && s.can('admin')) { setEditing('new'); const n = new URLSearchParams(sp); n.delete('novo'); setSp(n, { replace: true }); }
  }, [sp, s, setSp]);
  const refresh = () => qc.invalidateQueries({ queryKey: ['pixels'] });
  const toggle = useMutation({ mutationFn: (id: string) => post(`/v1/pixels/${id}/toggle`), onSuccess: refresh, onError: (e) => toast.err(e) });
  const verify = useMutation({
    mutationFn: (id: string) => post<{ ok: boolean; message: string }>(`/v1/pixels/${id}/verify`),
    onSuccess: (r) => (r.ok ? toast.ok('Conexão com a Meta confirmada', r.message) : toast.err(new Error(r.message), 'A Meta recusou o token/pixel')),
    onError: (e) => toast.err(e),
  });
  const admin = s.can('admin');
  return (
    <>
      <PageHeader title="Pixels" description="Cada pixel liga um Pixel da Meta ao token da Conversions API, à moeda e aos produtos que ele rastreia."
        actions={admin && <Button variant="primary" icon={<Plus className="h-4 w-4" />} onClick={() => setEditing('new')}>Novo pixel</Button>} />
      {q.isError ? <Card><ErrorState error={q.error} onRetry={() => q.refetch()} /></Card>
        : !q.data ? <div className="grid gap-4 md:grid-cols-2"><Skeleton className="h-48" /><Skeleton className="h-48" /></div>
        : q.data.pixels.length === 0 ? <Card><EmptyState icon={<Target className="h-5 w-5" />} title="Crie seu primeiro pixel" description="Você vai precisar do Pixel ID e de um token de acesso da Conversions API (Gerenciador de Eventos → Configurações)."
            action={admin && <Button variant="primary" onClick={() => setEditing('new')}>Criar pixel</Button>} /></Card>
        : (
          <div className="grid gap-4 xl:grid-cols-2">
            {q.data.pixels.map((p) => (
              <div key={p.id} className="card card-interactive p-5">
                <div className="flex items-start justify-between gap-3">
                  <div className="flex min-w-0 items-center gap-3">
                    <span className={p.active ? 'icon-tile-primary h-11 w-11' : 'icon-tile h-11 w-11'} aria-hidden><Target className="h-5 w-5" /></span>
                    <div className="min-w-0">
                    <p className="truncate font-semibold">{p.name}</p>
                    <p className="mt-0.5 font-mono text-xs text-muted">Pixel {p.metaPixelId}</p>
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <Badge tone={p.active ? 'ok' : 'neutral'} dot>{p.active ? 'Ativo' : 'Inativo'}</Badge>
                    {admin && <Switch checked={p.active} label={`${p.active ? 'Desativar' : 'Ativar'} ${p.name}`} onChange={() => toggle.mutate(p.id)} />}
                  </div>
                </div>
                <dl className="mt-4 grid grid-cols-2 gap-x-4 gap-y-2 text-[13px]">
                  <dt className="text-muted">Token CAPI</dt><dd>{p.capiTokenConfigured ? <span className="text-ok">configurado</span> : <span className="text-err">ausente</span>}</dd>
                  <dt className="text-muted">Moeda · país</dt><dd>{p.currency} · {p.country}</dd>
                  <dt className="text-muted">Produtos</dt><dd className="truncate" title={p.productIds.join(', ')}>{p.productIds.length ? p.productIds.join(', ') : '—'}</dd>
                  <dt className="text-muted">InitiateCheckout</dt><dd>{p.icRuleType === 'none' ? 'no checkout' : `clique (${p.icRuleValue})`}</dd>
                  <dt className="text-muted">Test Event Code</dt><dd>{p.testEventCode || '—'}</dd>
                </dl>
                <div className="mt-5 flex flex-wrap gap-2">
                  <Button size="sm" variant="primary" icon={<Code2 className="h-4 w-4" />} onClick={() => setInstall(p)}>Instalação</Button>
                  {admin && <Button size="sm" onClick={() => setEditing(p)}>Editar</Button>}
                  {admin && <Button size="sm" icon={<CheckCircle2 className="h-4 w-4" />} loading={verify.isPending && verify.variables === p.id} onClick={() => verify.mutate(p.id)}>Testar token</Button>}
                  {admin && <ConfirmButton size="sm" variant="ghost" danger title={`Excluir o pixel "${p.name}"?`} confirmLabel="Excluir"
                    description="Eventos na fila deste pixel serão descartados. O histórico de vendas é preservado."
                    onConfirm={async () => { await del(`/v1/pixels/${p.id}`); toast.ok('Pixel excluído'); await refresh(); }}>Excluir</ConfirmButton>}
                </div>
              </div>
            ))}
          </div>
        )}
      {editing && <PixelForm pixel={editing === 'new' ? null : editing} onClose={() => setEditing(null)} onSaved={async (p) => { await refresh(); setEditing(null); if (!editing || editing === 'new') setInstall(p); }} />}
      <InstallModal pixel={install} onClose={() => setInstall(null)} />
    </>
  );
}

function PixelForm({ pixel, onClose, onSaved }: { pixel: Pixel | null; onClose: () => void; onSaved: (p: Pixel) => void }) {
  const toast = useToast();
  const f = useForm<Form>({
    resolver: zodResolver(schema),
    defaultValues: pixel ? {
      name: pixel.name, metaPixelId: pixel.metaPixelId, capiToken: '', testEventCode: pixel.testEventCode ?? '', currency: pixel.currency, country: pixel.country,
      productIds: pixel.productIds.join(', '), icRuleType: pixel.icRuleType as Form['icRuleType'], icRuleValue: pixel.icRuleValue ?? '', sendRefundEvent: pixel.sendRefundEvent,
    } : { currency: 'BRL', country: 'BR', icRuleType: 'none', sendRefundEvent: true },
  });
  const err = f.formState.errors;
  const ic = f.watch('icRuleType');
  const submit = f.handleSubmit(async (v) => {
    if (!pixel && !v.capiToken) { f.setError('capiToken', { message: 'Informe o token da Conversions API' }); return; }
    const body = {
      ...v, capiToken: v.capiToken || undefined, testEventCode: v.testEventCode || null,
      productIds: (v.productIds ?? '').split(/[\s,;]+/).filter(Boolean), icRuleValue: v.icRuleType === 'none' ? null : v.icRuleValue,
    };
    try {
      const r = pixel ? await put<{ pixel: Pixel }>(`/v1/pixels/${pixel.id}`, body) : await post<{ pixel: Pixel }>('/v1/pixels', body);
      toast.ok(pixel ? 'Pixel atualizado' : 'Pixel criado');
      onSaved(r.pixel);
    } catch (e) { toast.err(e); }
  });
  return (
    <Modal open onClose={onClose} size="lg" title={pixel ? `Editar ${pixel.name}` : 'Novo pixel'}
      footer={<><Button variant="ghost" onClick={onClose}>Cancelar</Button><Button variant="primary" loading={f.formState.isSubmitting} onClick={submit}>Salvar</Button></>}>
      <form className="grid gap-4 sm:grid-cols-2" onSubmit={submit}>
        <Field label="Nome" htmlFor="n" error={err.name?.message}><Input id="n" {...f.register('name')} placeholder="Ex.: Curso Premium" /></Field>
        <Field label="Pixel ID (Meta)" htmlFor="pid" error={err.metaPixelId?.message}><Input id="pid" inputMode="numeric" {...f.register('metaPixelId')} /></Field>
        <div className="sm:col-span-2">
          <Field label="Token de acesso da Conversions API" htmlFor="tok" error={err.capiToken?.message}
            hint={pixel ? 'Deixe em branco para manter o token atual. Ele nunca é exibido após salvo.' : 'Gerenciador de Eventos → seu pixel → Configurações → Gerar token de acesso.'}>
            <Input id="tok" type="password" autoComplete="off" {...f.register('capiToken')} placeholder={pixel ? '•••••••• (configurado)' : 'EAAG…'} />
          </Field>
        </div>
        <Field label="Moeda dos eventos" htmlFor="cur" hint="Usada quando o gateway não informa a moeda."><Select id="cur" {...f.register('currency')}>{CURRENCIES.map((c) => <option key={c}>{c}</option>)}</Select></Field>
        <Field label="País de venda" htmlFor="cty"><Select id="cty" {...f.register('country')}>{COUNTRIES.map((c) => <option key={c}>{c}</option>)}</Select></Field>
        <div className="sm:col-span-2">
          <Field label="IDs de produto deste pixel" htmlFor="prod" hint="Separados por vírgula. Vendas desses produtos são enviadas a este pixel. Um produto pertence a um único pixel.">
            <Input id="prod" {...f.register('productIds')} placeholder="9452226, 1234567" />
          </Field>
        </div>
        <Field label="InitiateCheckout" htmlFor="icr">
          <Select id="icr" {...f.register('icRuleType')}>
            <option value="none">Disparado no checkout (recomendado)</option>
            <option value="contains">No clique: destino contém…</option>
            <option value="equals">No clique: destino igual a…</option>
            <option value="starts_with">No clique: destino começa com…</option>
          </Select>
        </Field>
        {ic !== 'none' ? <Field label="URL / trecho do checkout" htmlFor="icv"><Input id="icv" {...f.register('icRuleValue')} placeholder="pay.hotmart.com" /></Field> : <div />}
        <Field label="Test Event Code (opcional)" htmlFor="tec" hint="Só para validar no Gerenciador de Eventos; remova depois."><Input id="tec" {...f.register('testEventCode')} placeholder="TEST12345" /></Field>
        <div className="flex items-end gap-3 pb-1">
          <Switch checked={f.watch('sendRefundEvent')} onChange={(v) => f.setValue('sendRefundEvent', v)} label="Enviar evento Refund" />
          <span className="text-sm">Enviar evento "Refund" em reembolsos</span>
        </div>
      </form>
    </Modal>
  );
}

function InstallModal({ pixel, onClose }: { pixel: Pixel | null; onClose: () => void }) {
  const [mode, setMode] = useState<'checkout' | 'click'>('checkout');
  if (!pixel) return null;
  return (
    <Modal open onClose={onClose} size="lg" title={`Instalar ${pixel.name}`} description="Cole os scripts no <head> das páginas. Purchase vem sempre pelo webhook do gateway.">
      <div className="space-y-5">
        <div>
          <p className="mb-2 text-sm font-medium">Onde disparar o InitiateCheckout?</p>
          <Segmented label="Modo de InitiateCheckout" value={mode} onChange={setMode} options={[{ value: 'checkout', label: 'No checkout (recomendado)' }, { value: 'click', label: 'No clique do botão' }]} />
          <p className="mt-2 text-xs text-muted">Use apenas um dos modos. Os dois juntos geram InitiateCheckout duplicado com event_id diferentes.</p>
        </div>
        <CodeBlock label="1 · Página de vendas" code={mode === 'checkout' ? pixel.snippets.salesPage : pixel.snippets.salesPageWithClickIc} />
        {mode === 'checkout' && (
          <>
            <CodeBlock label="2a · Checkout próprio (uma página por produto)" code={pixel.snippets.checkoutPage} />
            <CodeBlock label="2b · Checkout global multi-produto (lê ?produto_id= da URL)" code={pixel.snippets.globalCheckoutLoader} />
          </>
        )}
        <p className="text-xs text-muted">Teste com <code className="rounded bg-surface-2 px-1">?pt_test=1</code> na URL: um painel mostra cada evento e a resposta do servidor. Chave pública: <code className="font-mono">{pixel.publicKey}</code> (não é segredo).</p>
      </div>
    </Modal>
  );
}
