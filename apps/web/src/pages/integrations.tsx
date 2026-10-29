import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { KeyRound, Plug, Plus } from 'lucide-react';
import { useState } from 'react';
import { PageHeader } from '../components/shell';
import { useToast } from '../components/toast';
import { Badge, Button, Callout, Card, CodeBlock, ConfirmButton, EmptyState, ErrorState, Field, Input, Modal, Select, Skeleton, Switch } from '../components/ui';
import { del, get, patch, post } from '../lib/api';
import { int, relative } from '../lib/format';
import { useSession } from '../lib/session';

interface Integration {
  id: string; provider: string; providerLabel: string; authMethod: string; requiresSecret: boolean; configurableAmountUnit: boolean;
  name: string; tokenHint: string; secretConfigured: boolean; defaultPixelId: string | null; amountUnit: 'major' | 'minor'; active: boolean;
  lastReceivedAt: string | null; stats: Record<string, number> | null;
}

const HELP: Record<string, string> = {
  checkout: 'Envie POST com Authorization: Bearer <token>. Opcional (recomendado): defina um segredo e assine o corpo com HMAC-SHA256 em X-Paytrack-Signature.',
  kiwify: 'Kiwify → Apps → Webhooks → Adicionar. Cole a URL e copie o "Token" do webhook para o campo segredo.',
  cakto: 'Cakto → Integrações → Webhooks. Cole a URL e use o mesmo "secret" aqui.',
  kirvano: 'Kirvano → Integrações → Webhooks. Cole a URL e use o mesmo token (enviado em security-token).',
  hotmart: 'Hotmart → Ferramentas → Webhook (versão 2.0). Selecione compra aprovada, completa, reembolso, chargeback e cancelamento. Cole o Hottok no segredo.',
  lowify: 'Lowify → Integrações → Webhooks. A URL já autentica. Confira a unidade do valor (reais ou centavos) com um pagamento de teste.',
  wiapay: 'Wiapay → Configurações → Webhooks. A URL já autentica. Confira a unidade do valor com um pagamento de teste.',
};

export default function IntegrationsPage() {
  const s = useSession();
  const qc = useQueryClient();
  const toast = useToast();
  const q = useQuery<{ integrations: Integration[] }>({ queryKey: ['integrations'], queryFn: () => get('/v1/integrations') });
  const pixels = useQuery({ queryKey: ['pixels'], queryFn: () => get('/v1/pixels') });
  const [creating, setCreating] = useState(false);
  const [revealed, setRevealed] = useState<{ url: string; token: string; provider: string } | null>(null);
  const [secretFor, setSecretFor] = useState<Integration | null>(null);
  const refresh = () => qc.invalidateQueries({ queryKey: ['integrations'] });
  const update = useMutation({ mutationFn: ({ id, body }: { id: string; body: object }) => patch(`/v1/integrations/${id}`, body), onSuccess: () => { toast.ok('Integração atualizada'); void refresh(); }, onError: (e) => toast.err(e) });
  const admin = s.can('admin');
  const pixelName = (id: string | null) => (pixels.data?.pixels ?? []).find((p: any) => p.id === id)?.name;

  return (
    <>
      <PageHeader title="Integrações" description="Gateways de pagamento e checkout próprio. Cada integração tem uma URL de webhook exclusiva."
        actions={admin && <Button variant="primary" icon={<Plus className="h-4 w-4" />} onClick={() => setCreating(true)}>Nova integração</Button>} />
      {revealed && (
        <div className="mb-6">
          <Callout tone="ok" title="Copie agora — o token não será exibido novamente" action={<Button size="sm" onClick={() => setRevealed(null)}>Concluído</Button>}>
            <div className="mt-3 space-y-3">
              <CodeBlock label="URL do webhook (cole no painel do gateway)" code={revealed.url} />
              {revealed.provider === 'checkout' && <CodeBlock label="Token (Authorization: Bearer …)" code={revealed.token} />}
            </div>
          </Callout>
        </div>
      )}
      {q.isError ? <Card><ErrorState error={q.error} onRetry={() => q.refetch()} /></Card>
        : !q.data ? <Skeleton className="h-48" />
        : q.data.integrations.length === 0 ? <Card><EmptyState icon={<Plug className="h-5 w-5" />} title="Nenhuma integração" description="Conecte Kiwify, Cakto, Kirvano, Hotmart, Lowify, Wiapay ou o seu checkout próprio para registrar as vendas reais." action={admin && <Button variant="primary" onClick={() => setCreating(true)}>Adicionar integração</Button>} /></Card>
        : (
          <div className="grid gap-4 xl:grid-cols-2">
            {q.data.integrations.map((i) => {
              const missingSecret = i.requiresSecret && !i.secretConfigured;
              return (
                <div key={i.id} className="card p-5">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0"><p className="font-semibold">{i.name}</p><p className="text-xs text-muted">{i.providerLabel} · {i.authMethod}</p></div>
                    <div className="flex items-center gap-2">
                      <Badge tone={i.active ? (missingSecret ? 'warn' : 'ok') : 'neutral'} dot>{!i.active ? 'Pausada' : missingSecret ? 'Falta segredo' : 'Ativa'}</Badge>
                      {admin && <Switch checked={i.active} label={`Ativar ${i.name}`} onChange={(v) => update.mutate({ id: i.id, body: { active: v } })} />}
                    </div>
                  </div>
                  <dl className="mt-4 grid grid-cols-2 gap-x-4 gap-y-2 text-[13px]">
                    <dt className="text-muted">Último webhook</dt><dd>{relative(i.lastReceivedAt)}</dd>
                    <dt className="text-muted">Token</dt><dd className="font-mono">{i.tokenHint}</dd>
                    <dt className="text-muted">Segredo</dt><dd>{i.secretConfigured ? 'configurado' : i.requiresSecret ? <span className="text-err">obrigatório</span> : 'opcional'}</dd>
                    <dt className="text-muted">Pixel padrão</dt><dd className="truncate">{pixelName(i.defaultPixelId) ?? 'por produto'}</dd>
                    {i.configurableAmountUnit && <><dt className="text-muted">Unidade do valor</dt><dd>{i.amountUnit === 'minor' ? 'centavos' : 'reais'}</dd></>}
                    <dt className="text-muted">Últimos 7 dias</dt>
                    <dd>{int(i.stats?.processed ?? 0)} processados{(i.stats?.rejected ?? 0) > 0 && <span className="text-err"> · {i.stats!.rejected} rejeitados</span>}</dd>
                  </dl>
                  <p className="mt-3 text-xs text-muted">{HELP[i.provider]}</p>
                  {admin && (
                    <div className="mt-4 flex flex-wrap gap-2">
                      <Button size="sm" icon={<KeyRound className="h-4 w-4" />} onClick={() => setSecretFor(i)}>{i.secretConfigured ? 'Trocar segredo' : 'Definir segredo'}</Button>
                      <Select aria-label="Pixel padrão" className="h-8 w-[180px] text-[13px]" value={i.defaultPixelId ?? ''} onChange={(e) => update.mutate({ id: i.id, body: { defaultPixelId: e.target.value || null } })}>
                        <option value="">Pixel: por produto</option>
                        {(pixels.data?.pixels ?? []).map((p: any) => <option key={p.id} value={p.id}>{p.name}</option>)}
                      </Select>
                      {i.configurableAmountUnit && (
                        <Select aria-label="Unidade do valor" className="h-8 w-[150px] text-[13px]" value={i.amountUnit} onChange={(e) => update.mutate({ id: i.id, body: { amountUnit: e.target.value } })}>
                          <option value="major">Valor em reais</option><option value="minor">Valor em centavos</option>
                        </Select>
                      )}
                      <ConfirmButton size="sm" title="Gerar nova URL?" description="A URL atual deixa de funcionar imediatamente. Atualize no painel do gateway." confirmLabel="Gerar"
                        onConfirm={async () => { const r = await post(`/v1/integrations/${i.id}/rotate-token`); setRevealed({ url: r.webhookUrl, token: r.token, provider: i.provider }); }}>Nova URL</ConfirmButton>
                      <ConfirmButton size="sm" variant="ghost" danger title={`Excluir ${i.name}?`} description="Webhooks enviados para esta URL passam a ser recusados." confirmLabel="Excluir"
                        onConfirm={async () => { await del(`/v1/integrations/${i.id}`); await refresh(); }}>Excluir</ConfirmButton>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      {creating && <CreateModal pixels={pixels.data?.pixels ?? []} onClose={() => setCreating(false)} onCreated={(r) => { setCreating(false); setRevealed(r); void refresh(); }} />}
      {secretFor && <SecretModal integ={secretFor} onClose={() => setSecretFor(null)} onSave={async (secret) => { await update.mutateAsync({ id: secretFor.id, body: { secret } }); setSecretFor(null); }} />}
    </>
  );
}

function CreateModal({ pixels, onClose, onCreated }: { pixels: any[]; onClose: () => void; onCreated: (r: { url: string; token: string; provider: string }) => void }) {
  const toast = useToast();
  const providers = useQuery({ queryKey: ['providers'], queryFn: () => get('/v1/integrations/providers') });
  const [provider, setProvider] = useState('hotmart');
  const [secret, setSecret] = useState('');
  const [pixel, setPixel] = useState('');
  const [unit, setUnit] = useState<'major' | 'minor'>('major');
  const [busy, setBusy] = useState(false);
  const meta = (providers.data?.providers ?? []).find((p: any) => p.provider === provider);
  return (
    <Modal open onClose={onClose} title="Nova integração" footer={<>
      <Button variant="ghost" onClick={onClose}>Cancelar</Button>
      <Button variant="primary" loading={busy} onClick={async () => {
        setBusy(true);
        try {
          const r = await post('/v1/integrations', { provider, secret: secret || undefined, defaultPixelId: pixel || undefined, amountUnit: unit });
          onCreated({ url: r.webhookUrl, token: r.token, provider });
        } catch (e) { toast.err(e); } finally { setBusy(false); }
      }}>Criar</Button>
    </>}>
      <div className="space-y-4">
        <Field label="Gateway" htmlFor="prov">
          <Select id="prov" value={provider} onChange={(e) => setProvider(e.target.value)}>
            {(providers.data?.providers ?? []).map((p: any) => <option key={p.provider} value={p.provider}>{p.label}</option>)}
          </Select>
        </Field>
        <p className="text-xs text-muted">{HELP[provider]}</p>
        <Field label={meta?.requiresSecret ? 'Segredo do webhook (obrigatório)' : 'Segredo (opcional)'} htmlFor="sec" hint={meta?.authMethod}>
          <Input id="sec" type="password" autoComplete="off" value={secret} onChange={(e) => setSecret(e.target.value)} />
        </Field>
        <Field label="Pixel padrão" htmlFor="px" hint="Usado quando o produto da venda não estiver cadastrado em nenhum pixel.">
          <Select id="px" value={pixel} onChange={(e) => setPixel(e.target.value)}>
            <option value="">Somente por produto</option>
            {pixels.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
          </Select>
        </Field>
        {meta?.configurableAmountUnit && (
          <Field label="Unidade do valor enviado pelo gateway" htmlFor="unit" hint="O sistema não adivinha: confirme com um pagamento de teste.">
            <Select id="unit" value={unit} onChange={(e) => setUnit(e.target.value as 'major' | 'minor')}><option value="major">Reais (197.00)</option><option value="minor">Centavos (19700)</option></Select>
          </Field>
        )}
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
      <Field label="Novo segredo" htmlFor="ns" hint="Armazenado criptografado. Nunca é exibido novamente."><Input id="ns" type="password" autoComplete="off" value={v} onChange={(e) => setV(e.target.value)} /></Field>
    </Modal>
  );
}
