import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import clsx from 'clsx';
import { Play, Upload, Volume2 } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { PageHeader } from '../components/shell';
import { useToast } from '../components/toast';
import { Badge, Button, Card, ConfirmButton, Field, Input, Select, Switch, Tabs } from '../components/ui';
import { del, get, patch, post } from '../lib/api';
import { dateTime, exponent, minorToNumber } from '../lib/format';
import { customSound, loadSettings, onSoundChange, playSaleSound, PRESETS, removeCustomSound, saveSettings, setCustomSound, unlockAudio, type SoundPreset, type SoundSettings } from '../lib/sale-sound';
import { useSession, type Role } from '../lib/session';

const ROLE_LABEL: Record<Role, string> = { owner: 'Proprietário', admin: 'Administrador', analyst: 'Analista', viewer: 'Leitura' };
const CURRENCIES = ['BRL', 'EUR', 'USD', 'GBP', 'CHF', 'CAD', 'AUD', 'MXN', 'ARS', 'CLP', 'COP', 'PEN', 'JPY'];
const TZS = ['America/Sao_Paulo', 'America/Manaus', 'America/Fortaleza', 'America/Recife', 'America/Belem', 'America/Cuiaba', 'America/Rio_Branco', 'America/Noronha', 'Europe/Lisbon', 'Europe/Madrid', 'Europe/London', 'America/New_York', 'UTC'];

export default function SettingsPage() {
  const [tab, setTab] = useState<'account' | 'org' | 'members' | 'security' | 'notifications'>('account');
  return (
    <>
      <PageHeader title="Configurações" description="Sua conta, a organização, a equipe e a segurança." />
      <div className="mb-6"><Tabs value={tab} onChange={setTab} tabs={[
        { value: 'account', label: 'Conta' }, { value: 'org', label: 'Organização e metas' }, { value: 'members', label: 'Equipe' },
        { value: 'security', label: 'Segurança' }, { value: 'notifications', label: 'Notificações' },
      ]} /></div>
      <div className="max-w-3xl space-y-6">
        {tab === 'account' && <Account />}
        {tab === 'org' && <Org />}
        {tab === 'members' && <Members />}
        {tab === 'security' && <Security />}
        {tab === 'notifications' && <Notifications />}
      </div>
    </>
  );
}

function Account() {
  const s = useSession();
  const qc = useQueryClient();
  const toast = useToast();
  const [name, setName] = useState(s.user.name ?? '');
  const save = useMutation({ mutationFn: (b: object) => patch('/v1/auth/preferences', b), onSuccess: () => { toast.ok('Preferências salvas'); void qc.invalidateQueries({ queryKey: ['me'] }); }, onError: (e) => toast.err(e) });
  return (
    <Card title="Perfil">
      <div className="space-y-4">
        <Field label="E-mail" htmlFor="em"><Input id="em" value={s.user.email} disabled /></Field>
        <Field label="Nome" htmlFor="nm"><Input id="nm" value={name} onChange={(e) => setName(e.target.value)} /></Field>
        <div className="flex items-center justify-between gap-4 rounded-xl border border-border p-4">
          <div><p className="text-sm font-medium">Ocultar meu e-mail no painel</p><p className="text-xs text-muted">Útil para gravações de tela.</p></div>
          <Switch checked={s.user.hideEmail} label="Ocultar e-mail" onChange={(v) => save.mutate({ hideEmail: v })} />
        </div>
        <Button variant="primary" loading={save.isPending} onClick={() => save.mutate({ name })}>Salvar</Button>
      </div>
    </Card>
  );
}

function Org() {
  const s = useSession();
  const qc = useQueryClient();
  const toast = useToast();
  const cur = s.org.reportingCurrency;
  const fmt = (m: string) => minorToNumber(m, cur).toFixed(exponent(cur)).replace('.', ',');
  const [v, setV] = useState({ name: s.org.name, reportingCurrency: cur, timezone: s.org.timezone, goalDaily: fmt(s.org.goalDailyMinor), goalMonthly: fmt(s.org.goalMonthlyMinor) });
  const save = useMutation({ mutationFn: () => patch('/v1/org', v), onSuccess: () => { toast.ok('Organização atualizada'); void qc.invalidateQueries(); }, onError: (e) => toast.err(e) });
  const disabled = !s.can('admin');
  return (
    <Card title="Organização" description="A moeda e o fuso definem como TODOS os relatórios são calculados.">
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="sm:col-span-2"><Field label="Nome" htmlFor="on"><Input id="on" disabled={disabled} value={v.name} onChange={(e) => setV({ ...v, name: e.target.value })} /></Field></div>
        <Field label="Moeda de relatório" htmlFor="rc" hint="Vendas em outras moedas são convertidas pela cotação do dia da venda.">
          <Select id="rc" disabled={disabled} value={v.reportingCurrency} onChange={(e) => setV({ ...v, reportingCurrency: e.target.value })}>{CURRENCIES.map((c) => <option key={c}>{c}</option>)}</Select>
        </Field>
        <Field label="Fuso horário" htmlFor="tz" hint="Define o que é 'hoje' nos relatórios.">
          <Select id="tz" disabled={disabled} value={v.timezone} onChange={(e) => setV({ ...v, timezone: e.target.value })}>{[...new Set([v.timezone, ...TZS])].map((t) => <option key={t}>{t}</option>)}</Select>
        </Field>
        <Field label={`Meta diária (${v.reportingCurrency})`} htmlFor="gd"><Input id="gd" inputMode="decimal" disabled={disabled} value={v.goalDaily} onChange={(e) => setV({ ...v, goalDaily: e.target.value })} /></Field>
        <Field label={`Meta mensal (${v.reportingCurrency})`} htmlFor="gm"><Input id="gm" inputMode="decimal" disabled={disabled} value={v.goalMonthly} onChange={(e) => setV({ ...v, goalMonthly: e.target.value })} /></Field>
      </div>
      {!disabled && <Button className="mt-5" variant="primary" loading={save.isPending} onClick={() => save.mutate()}>Salvar alterações</Button>}
    </Card>
  );
}

function Members() {
  const s = useSession();
  const qc = useQueryClient();
  const toast = useToast();
  const q = useQuery({ queryKey: ['members'], queryFn: () => get('/v1/org/members') });
  const [email, setEmail] = useState('');
  const [role, setRole] = useState<Role>('viewer');
  const refresh = () => qc.invalidateQueries({ queryKey: ['members'] });
  const invite = useMutation({ mutationFn: () => post('/v1/org/invitations', { email, role }), onSuccess: () => { toast.ok('Convite enviado', email); setEmail(''); void refresh(); }, onError: (e) => toast.err(e) });
  const owner = s.can('owner');
  return (
    <>
      {owner && (
        <Card title="Convidar pessoa" description="Leitura: só visualiza. Analista: também reprocessa eventos. Administrador: altera pixels, integrações e Meta.">
          <div className="flex flex-wrap gap-2">
            <Input aria-label="E-mail" placeholder="pessoa@empresa.com" type="email" className="min-w-[220px] flex-1" value={email} onChange={(e) => setEmail(e.target.value)} />
            <Select aria-label="Papel" className="w-[170px]" value={role} onChange={(e) => setRole(e.target.value as Role)}>
              {(['viewer', 'analyst', 'admin'] as Role[]).map((r) => <option key={r} value={r}>{ROLE_LABEL[r]}</option>)}
            </Select>
            <Button variant="primary" loading={invite.isPending} disabled={!email.includes('@')} onClick={() => invite.mutate()}>Convidar</Button>
          </div>
        </Card>
      )}
      <Card title="Membros" padded={false}>
        <ul className="divide-y divide-border">
          {(q.data?.members ?? []).map((m: any) => (
            <li key={m.id} className="flex flex-wrap items-center justify-between gap-3 px-5 py-3">
              <div className="min-w-0"><p className="truncate text-sm font-medium">{m.name ?? m.email}</p><p className="truncate text-xs text-muted">{m.email}</p></div>
              <div className="flex items-center gap-2">
                {owner && m.id !== s.user.id ? (
                  <>
                    <Select aria-label={`Papel de ${m.email}`} className="h-8 w-[150px] text-[13px]" value={m.role} onChange={async (e) => { try { await patch(`/v1/org/members/${m.id}`, { role: e.target.value }); void refresh(); } catch (err) { toast.err(err); } }}>
                      {(['viewer', 'analyst', 'admin', 'owner'] as Role[]).map((r) => <option key={r} value={r}>{ROLE_LABEL[r]}</option>)}
                    </Select>
                    <ConfirmButton size="sm" variant="ghost" danger title={`Remover ${m.email}?`} confirmLabel="Remover" onConfirm={async () => { await del(`/v1/org/members/${m.id}`); await refresh(); }}>Remover</ConfirmButton>
                  </>
                ) : <Badge>{ROLE_LABEL[m.role as Role]}</Badge>}
              </div>
            </li>
          ))}
          {(q.data?.invitations ?? []).map((i: any) => (
            <li key={i.id} className="flex items-center justify-between gap-3 px-5 py-3">
              <div><p className="text-sm">{i.email}</p><p className="text-xs text-muted">Convite pendente · {ROLE_LABEL[i.role as Role]} · expira {dateTime(i.expires_at)}</p></div>
              {owner && <Button size="sm" variant="ghost" onClick={async () => { await del(`/v1/org/invitations/${i.id}`); void refresh(); }}>Cancelar</Button>}
            </li>
          ))}
        </ul>
      </Card>
    </>
  );
}

function Security() {
  const toast = useToast();
  const qc = useQueryClient();
  const sessions = useQuery({ queryKey: ['sessions'], queryFn: () => get('/v1/auth/sessions') });
  const [pw, setPw] = useState({ currentPassword: '', newPassword: '' });
  const change = useMutation({
    mutationFn: () => post('/v1/auth/change-password', pw),
    onSuccess: (r: any) => { toast.ok('Senha alterada', `${r.revokedSessions} outra(s) sessão(ões) encerrada(s).`); setPw({ currentPassword: '', newPassword: '' }); void qc.invalidateQueries({ queryKey: ['sessions'] }); },
    onError: (e) => toast.err(e),
  });
  return (
    <>
      <Card title="Alterar senha" description="Mínimo de 10 caracteres com maiúscula, minúscula e número. As outras sessões são encerradas.">
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Senha atual" htmlFor="cp"><Input id="cp" type="password" autoComplete="current-password" value={pw.currentPassword} onChange={(e) => setPw({ ...pw, currentPassword: e.target.value })} /></Field>
          <Field label="Nova senha" htmlFor="np"><Input id="np" type="password" autoComplete="new-password" value={pw.newPassword} onChange={(e) => setPw({ ...pw, newPassword: e.target.value })} /></Field>
        </div>
        <Button className="mt-4" variant="primary" loading={change.isPending} disabled={!pw.currentPassword || pw.newPassword.length < 10} onClick={() => change.mutate()}>Atualizar senha</Button>
      </Card>
      <Card title="Sessões ativas" actions={<Button size="sm" onClick={async () => { const r = await post('/v1/auth/sessions/revoke-others'); toast.ok(`${r.revoked} sessão(ões) encerrada(s)`); void sessions.refetch(); }}>Encerrar as outras</Button>} padded={false}>
        <ul className="divide-y divide-border">
          {(sessions.data?.sessions ?? []).map((x: any) => (
            <li key={x.id} className="flex flex-wrap items-center justify-between gap-2 px-5 py-3 text-sm">
              <div className="min-w-0"><p className="truncate">{x.user_agent ?? 'Navegador desconhecido'}</p><p className="text-xs text-muted">IP {x.ip ?? '—'} · último acesso {dateTime(x.last_seen_at)}</p></div>
              {x.current && <Badge tone="primary">Esta sessão</Badge>}
            </li>
          ))}
        </ul>
      </Card>
    </>
  );
}

function urlB64ToUint8Array(b64: string) {
  const pad = '='.repeat((4 - (b64.length % 4)) % 4);
  const raw = atob((b64 + pad).replace(/-/g, '+').replace(/_/g, '/'));
  return Uint8Array.from([...raw].map((c) => c.charCodeAt(0)));
}

function Notifications() {
  const toast = useToast();
  const cfg = useQuery({ queryKey: ['push-config'], queryFn: () => get('/v1/push/config') });
  const supported = 'serviceWorker' in navigator && 'PushManager' in window;
  const enable = async () => {
    try {
      const perm = await Notification.requestPermission();
      if (perm !== 'granted') throw new Error('Permissão negada no navegador.');
      const reg = await navigator.serviceWorker.ready;
      const sub = (await reg.pushManager.getSubscription()) ?? (await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: urlB64ToUint8Array(cfg.data.vapidPublicKey) }));
      await post('/v1/push/subscriptions', sub.toJSON());
      toast.ok('Notificações ativadas neste dispositivo');
      void cfg.refetch();
    } catch (e) { toast.err(e); }
  };
  return (
    <div className="space-y-6">
    <SaleSoundCard />
    <Card title="Notificações de venda" description="Receba um aviso no celular ou no computador a cada venda aprovada.">
      {!supported ? <p className="text-sm text-muted">Este navegador não suporta notificações push.</p>
        : !cfg.data?.configured ? <p className="text-sm text-muted">Notificações ainda não configuradas no servidor (VAPID).</p>
        : (
          <div className="flex flex-wrap items-center gap-3">
            <Button variant="primary" onClick={enable}>Ativar neste dispositivo</Button>
            <Button onClick={async () => { const r = await post('/v1/push/test'); toast.info('Teste enviado', `${r.sent} dispositivo(s)`); }}>Enviar teste</Button>
            <span className="text-sm text-muted">{cfg.data.subscriptions} dispositivo(s) inscrito(s)</span>
          </div>
        )}
    </Card>
    </div>
  );
}

function SaleSoundCard() {
  const toast = useToast();
  const [settings, setSettings] = useState<SoundSettings>(loadSettings);
  const [custom, setCustom] = useState(customSound);
  const [busy, setBusy] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  useEffect(() => onSoundChange(() => { setSettings(loadSettings()); setCustom(customSound()); }), []);
  const update = (patch: Partial<SoundSettings>) => { const next = { ...settings, ...patch }; setSettings(next); saveSettings(next); };
  const preview = async (preset: SoundPreset) => {
    await unlockAudio();
    if (!(await playSaleSound({ preset, volume: settings.volume, enabled: true }))) toast.err(new Error('O navegador não liberou o áudio. Clique na página e tente de novo.'));
  };
  const options: Array<{ value: SoundPreset; label: string; description: string }> = [
    ...PRESETS,
    ...(custom.dataUrl ? [{ value: 'proprio' as const, label: 'Seu próprio som', description: custom.name ?? 'arquivo enviado' }] : []),
  ];
  return (
    <Card title="Som de venda aprovada" icon={<Volume2 />}
      description="Toca no painel a cada venda aprovada (em qualquer página). A preferência vale só para este navegador."
      actions={<Switch checked={settings.enabled} label="Tocar som a cada venda" onChange={(v) => { update({ enabled: v }); if (v) void unlockAudio(); }} />}>
      <div className={clsx('space-y-5', !settings.enabled && 'pointer-events-none opacity-50')} aria-disabled={!settings.enabled}>
        <div role="radiogroup" aria-label="Som" className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {options.map((o) => (
            <div key={o.value} className={clsx('flex items-center gap-3 rounded-2xl border p-3.5 transition',
              settings.preset === o.value ? 'border-primary bg-primary/[0.07] ring-2 ring-primary/20' : 'border-border hover:border-border-strong')}>
              <button type="button" role="radio" aria-checked={settings.preset === o.value} onClick={() => { update({ preset: o.value }); void preview(o.value); }}
                className="min-w-0 flex-1 text-left">
                <span className="block text-sm font-semibold">{o.label}</span>
                <span className="block truncate text-xs text-muted">{o.description}</span>
              </button>
              <Button size="sm" variant="ghost" icon={<Play className="h-3.5 w-3.5" />} aria-label={`Ouvir ${o.label}`} onClick={() => void preview(o.value)}>Ouvir</Button>
            </div>
          ))}
        </div>

        <div className="grid gap-5 lg:grid-cols-2">
          <div>
            <label htmlFor="vol" className="label">Volume <span className="num font-normal text-muted">{Math.round(settings.volume * 100)}%</span></label>
            <input id="vol" type="range" min={0} max={1} step={0.05} value={settings.volume}
              onChange={(e) => update({ volume: Number(e.target.value) })} onMouseUp={() => void preview(settings.preset)} onKeyUp={(e) => e.key.startsWith('Arrow') && void preview(settings.preset)}
              className="w-full accent-[rgb(var(--primary))]" />
          </div>
          <div>
            <p className="label">Seu próprio som</p>
            <div className="flex flex-wrap items-center gap-2">
              <input ref={fileRef} type="file" accept="audio/*" className="sr-only" id="custom-sound" onChange={async (e) => {
                const f = e.target.files?.[0];
                e.target.value = '';
                if (!f) return;
                setBusy(true);
                try { await setCustomSound(f); toast.ok('Som salvo neste navegador', f.name); await preview('proprio'); } catch (err) { toast.err(err); } finally { setBusy(false); }
              }} />
              <Button icon={<Upload className="h-4 w-4" />} loading={busy} onClick={() => fileRef.current?.click()}>{custom.dataUrl ? 'Trocar arquivo' : 'Enviar arquivo'}</Button>
              {custom.dataUrl && <Button variant="ghost" onClick={() => { removeCustomSound(); toast.info('Som próprio removido'); }}>Remover</Button>}
            </div>
            <p className="hint">mp3, wav ou ogg de até 1 MB. Fica salvo só neste navegador, não vai para o servidor. Use um som que você tenha o direito de usar.</p>
          </div>
        </div>
        <p className="text-xs text-muted">Os navegadores só tocam sons depois de um clique na página. Se o painel ficou aberto sem uso, clique em qualquer lugar (ou em “Ativar som de vendas” no topo) para liberar.</p>
      </div>
    </Card>
  );
}
