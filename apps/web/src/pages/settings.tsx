import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import clsx from 'clsx';
import { Bell, BellOff, BellRing, Copy, Download, KeyRound, Play, Send, ShieldCheck, Smartphone, Upload, Volume2 } from 'lucide-react';
import QRCode from 'qrcode';
import { useEffect, useRef, useState } from 'react';
import { PageHeader } from '../components/shell';
import { useToast } from '../components/toast';
import { Badge, Button, Callout, Card, ConfirmButton, Field, Input, Select, Switch, Tabs } from '../components/ui';
import { del, get, patch, post } from '../lib/api';
import { dateTime, exponent, minorToNumber, relative } from '../lib/format';
import { canInstall, currentSubscription, endpointHash, isIOS, isStandalone, onInstallChange, permission, promptInstall, pushSupported, subscribe } from '../lib/push-client';
import { customSound, loadSettings, onSoundChange, playSaleSound, PRESETS, removeCustomSound, saveSettings, setCustomSound, unlockAudio, type SoundPreset, type SoundSettings } from '../lib/sale-sound';
import { useSession, type Role } from '../lib/session';

const ROLE_LABEL: Record<Role, string> = { owner: 'Proprietário', admin: 'Administrador', analyst: 'Analista', viewer: 'Leitura' };
const CURRENCIES = ['BRL', 'EUR', 'USD', 'GBP', 'CHF', 'CAD', 'AUD', 'MXN', 'ARS', 'CLP', 'COP', 'PEN', 'JPY'];
const TZS = ['America/Sao_Paulo', 'America/Manaus', 'America/Fortaleza', 'America/Recife', 'America/Belem', 'America/Cuiaba', 'America/Rio_Branco', 'America/Noronha', 'Europe/Lisbon', 'Europe/Madrid', 'Europe/London', 'America/New_York', 'UTC'];

export default function SettingsPage() {
  type Tab = 'account' | 'org' | 'members' | 'security' | 'notifications';
  // ?aba=notificacoes / seguranca abre direto na aba (atalhos da busca e dos avisos)
  const initial = ({ notificacoes: 'notifications', seguranca: 'security', equipe: 'members', organizacao: 'org' } as Record<string, Tab>)[new URLSearchParams(location.search).get('aba') ?? ''] ?? 'account';
  const [tab, setTab] = useState<Tab>(initial);
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
                    <Select aria-label={`Papel de ${m.email}`} className="h-8 w-[150px] text-base sm:text-[13px]" value={m.role} onChange={async (e) => { try { await patch(`/v1/org/members/${m.id}`, { role: e.target.value }); void refresh(); } catch (err) { toast.err(err); } }}>
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
      <TwoFactorCard />
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

const CODE_RE = /^\d{6}$/;
const onlyDigits = (v: string) => v.replace(/\D/g, '').slice(0, 6);

/** Códigos de recuperação: exibidos uma única vez, com copiar e baixar. */
function RecoveryCodes({ codes, onClose }: { codes: string[]; onClose: () => void }) {
  const toast = useToast();
  const text = `PayTracking — códigos de recuperação\nCada código funciona uma única vez.\n\n${codes.join('\n')}\n`;
  return (
    <div className="space-y-4">
      <Callout tone="warn" title="Guarde estes códigos agora — eles não aparecem de novo">
        Se perder o celular, cada código permite entrar uma vez. Guarde em um gerenciador de senhas ou impresso.
      </Callout>
      <ul className="grid grid-cols-2 gap-2 rounded-xl border border-border bg-surface-2 p-4 font-mono text-[15px] sm:grid-cols-5">
        {codes.map((c) => <li key={c} className="text-center">{c}</li>)}
      </ul>
      <div className="flex flex-wrap gap-2">
        <Button size="sm" onClick={async () => { await navigator.clipboard.writeText(text); toast.ok('Códigos copiados'); }}><Copy className="h-4 w-4" aria-hidden />Copiar</Button>
        <Button size="sm" onClick={() => {
          const a = document.createElement('a');
          a.href = URL.createObjectURL(new Blob([text], { type: 'text/plain' }));
          a.download = 'paytracking-codigos-recuperacao.txt';
          a.click();
          setTimeout(() => URL.revokeObjectURL(a.href), 1000);
        }}><Download className="h-4 w-4" aria-hidden />Baixar .txt</Button>
        <Button size="sm" variant="primary" onClick={onClose}>Já guardei</Button>
      </div>
    </div>
  );
}

function TwoFactorCard() {
  const toast = useToast();
  const qc = useQueryClient();
  const status = useQuery({ queryKey: ['2fa'], queryFn: () => get<{ enabled: boolean; enabledAt: string | null; recoveryCodesLeft: number }>('/v1/auth/2fa') });
  const [step, setStep] = useState<'idle' | 'scan' | 'codes' | 'disable' | 'regen'>('idle');
  const [setup, setSetup] = useState<{ secret: string; otpauthUrl: string; qr: string } | null>(null);
  const [code, setCode] = useState('');
  const [password, setPassword] = useState('');
  const [codes, setCodes] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const reset = () => { setStep('idle'); setCode(''); setPassword(''); setSetup(null); };
  const refresh = () => { void status.refetch(); void qc.invalidateQueries({ queryKey: ['me'] }); void qc.invalidateQueries({ queryKey: ['sessions'] }); };
  const run = async (fn: () => Promise<void>) => { setBusy(true); try { await fn(); } catch (e) { toast.err(e); setCode(''); } finally { setBusy(false); } };

  const start = () => run(async () => {
    const r = await post<{ secret: string; otpauthUrl: string }>('/v1/auth/2fa/setup');
    // QR gerado aqui no navegador: o segredo não passa por nenhum serviço externo
    const qr = await QRCode.toDataURL(r.otpauthUrl, { margin: 1, width: 220, errorCorrectionLevel: 'M' });
    setSetup({ ...r, qr });
    setStep('scan');
  });
  const enable = () => run(async () => {
    const r = await post<{ recoveryCodes: string[]; revokedSessions: number }>('/v1/auth/2fa/enable', { code });
    setCodes(r.recoveryCodes); setStep('codes'); setCode(''); setSetup(null);
    toast.ok('Verificação em duas etapas ativada', r.revokedSessions ? `${r.revokedSessions} outra(s) sessão(ões) encerrada(s).` : undefined);
    refresh();
  });
  const disable = () => run(async () => {
    await post('/v1/auth/2fa/disable', { password, code });
    toast.ok('Verificação em duas etapas desativada');
    reset(); refresh();
  });
  const regen = () => run(async () => {
    const r = await post<{ recoveryCodes: string[] }>('/v1/auth/2fa/recovery-codes', { code });
    setCodes(r.recoveryCodes); setStep('codes'); setCode('');
    refresh();
  });

  const enabled = status.data?.enabled;
  return (
    <Card icon={<ShieldCheck className="h-5 w-5" aria-hidden />} title="Verificação em duas etapas"
      description="Além da senha, pede um código do app autenticador do seu celular (Google Authenticator, Microsoft Authenticator, Authy ou 1Password)."
      actions={status.data && <Badge tone={enabled ? 'ok' : 'neutral'} dot>{enabled ? 'Ativa' : 'Desativada'}</Badge>}>
      {step === 'codes' ? <RecoveryCodes codes={codes} onClose={() => { setCodes([]); setStep('idle'); }} /> : step === 'scan' && setup ? (
        <div className="grid gap-6 sm:grid-cols-[auto_1fr]">
          <img src={setup.qr} alt="QR code para o app autenticador" width={220} height={220} className="rounded-xl border border-border bg-white p-2" />
          <div className="space-y-4 text-sm">
            <ol className="list-decimal space-y-1.5 pl-5 text-muted">
              <li>No app autenticador, toque em <b className="text-fg">+</b> e escaneie o QR code.</li>
              <li>Digite abaixo o código de 6 dígitos que aparecer.</li>
            </ol>
            <details className="rounded-lg border border-border px-3 py-2">
              <summary className="cursor-pointer font-medium">Não consegue escanear? Digite a chave</summary>
              <code className="mt-2 block select-all break-all font-mono text-[13px]">{setup.secret.replace(/(.{4})/g, '$1 ').trim()}</code>
            </details>
            <Field label="Código do app" htmlFor="tfa-code">
              <Input id="tfa-code" inputMode="numeric" autoComplete="one-time-code" maxLength={6} placeholder="000000" className="max-w-[180px] font-mono text-lg tracking-[0.3em]"
                value={code} onChange={(e) => setCode(onlyDigits(e.target.value))} onKeyDown={(e) => { if (e.key === 'Enter' && CODE_RE.test(code)) void enable(); }} />
            </Field>
            <div className="flex gap-2">
              <Button variant="primary" loading={busy} disabled={!CODE_RE.test(code)} onClick={enable}>Ativar</Button>
              <Button variant="ghost" onClick={reset}>Cancelar</Button>
            </div>
          </div>
        </div>
      ) : step === 'disable' || step === 'regen' ? (
        <div className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-2">
            {step === 'disable' && <Field label="Sua senha" htmlFor="tfa-pw"><Input id="tfa-pw" type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} /></Field>}
            <Field label={step === 'disable' ? 'Código do app (ou de recuperação)' : 'Código do app'} htmlFor="tfa-c">
              <Input id="tfa-c" inputMode={step === 'regen' ? 'numeric' : undefined} autoComplete="one-time-code" maxLength={step === 'regen' ? 6 : 12} className="font-mono"
                value={code} onChange={(e) => setCode(step === 'regen' ? onlyDigits(e.target.value) : e.target.value.trim())} />
            </Field>
          </div>
          <div className="flex gap-2">
            {step === 'disable'
              ? <Button variant="danger" loading={busy} disabled={!password || code.length < 6} onClick={disable}>Desativar</Button>
              : <Button variant="primary" loading={busy} disabled={!CODE_RE.test(code)} onClick={regen}>Gerar novos códigos</Button>}
            <Button variant="ghost" onClick={reset}>Cancelar</Button>
          </div>
        </div>
      ) : enabled ? (
        <div className="flex flex-wrap items-center justify-between gap-3 text-sm">
          <p className="text-muted">Ativa desde {status.data?.enabledAt ? dateTime(status.data.enabledAt) : '—'} · {status.data?.recoveryCodesLeft ?? 0} código(s) de recuperação restante(s).</p>
          <div className="flex gap-2">
            <Button size="sm" onClick={() => setStep('regen')}><KeyRound className="h-4 w-4" aria-hidden />Novos códigos de recuperação</Button>
            <Button size="sm" variant="ghost" onClick={() => setStep('disable')}>Desativar</Button>
          </div>
        </div>
      ) : (
        <div className="flex flex-wrap items-center justify-between gap-3 text-sm">
          <p className="text-muted">Recomendado: mesmo que alguém descubra sua senha, não entra sem o seu celular.</p>
          <Button variant="primary" loading={busy} onClick={start}><ShieldCheck className="h-4 w-4" aria-hidden />Ativar</Button>
        </div>
      )}
    </Card>
  );
}

function Notifications() {
  return (
    <div className="space-y-6">
      <PushCard />
      <SaleSoundCard />
    </div>
  );
}

interface PushDevice { id: string; name: string; createdAt: string; lastSuccessAt: string | null; endpointHash: string }

function PushCard() {
  const toast = useToast();
  const cfg = useQuery<{ vapidPublicKey: string; configured: boolean }>({ queryKey: ['push-config'], queryFn: () => get('/v1/push/config') });
  const devices = useQuery<{ devices: PushDevice[] }>({ queryKey: ['push-devices'], queryFn: () => get('/v1/push/devices') });
  const [mine, setMine] = useState<string | null>(null); // hash da inscrição deste navegador
  const [perm, setPerm] = useState(permission());
  const [busy, setBusy] = useState<'on' | 'off' | 'test' | null>(null);
  const [, force] = useState(0);
  useEffect(() => { void currentSubscription().then((s) => setMine(s ? endpointHash(s.endpoint) : null)); }, []);
  useEffect(() => onInstallChange(() => force((n) => n + 1)), []);
  const refresh = () => { void devices.refetch(); };
  const active = !!mine && (devices.data?.devices ?? []).some((d) => d.endpointHash === mine);
  const ios = isIOS();
  const needsInstall = ios && !isStandalone();

  const enable = async () => {
    if (!cfg.data) return;
    setBusy('on');
    try {
      await unlockAudio(); // aproveita o toque para liberar o som do painel
      const sub = await subscribe(cfg.data.vapidPublicKey);
      await post('/v1/push/subscriptions', sub.toJSON());
      setMine(endpointHash(sub.endpoint));
      setPerm(permission());
      refresh();
      toast.ok('Notificações ativadas neste dispositivo', 'Toque em “Enviar teste” para conferir.');
    } catch (e) { setPerm(permission()); toast.err(e, 'Não foi possível ativar'); } finally { setBusy(null); }
  };
  const disable = async () => {
    setBusy('off');
    try {
      const sub = await currentSubscription();
      if (sub) { await post('/v1/push/unsubscribe', { endpoint: sub.endpoint }); await sub.unsubscribe(); }
      setMine(null);
      refresh();
      toast.info('Notificações desativadas neste dispositivo');
    } catch (e) { toast.err(e); } finally { setBusy(null); }
  };
  const test = async () => {
    setBusy('test');
    try {
      const r = await post<{ sent: number; failed: number; removed: number }>('/v1/push/test');
      if (r.sent > 0) toast.ok(`Teste enviado para ${r.sent} dispositivo(s)`, 'A notificação chega em alguns segundos.');
      else toast.err(new Error(r.removed ? 'A inscrição deste dispositivo expirou. Ative de novo.' : 'Nenhum dispositivo recebeu. Ative as notificações primeiro.'), 'Teste não entregue');
      refresh();
    } catch (e) { toast.err(e); } finally { setBusy(null); }
  };

  return (
    <Card title="Notificações no celular" icon={<Smartphone />}
      description="Um aviso com som e vibração a cada venda aprovada, mesmo com o app fechado.">
      <div className="space-y-5">
        {!pushSupported() && !needsInstall ? (
          <Callout tone="warn" title="Este navegador não suporta notificações">Use o Chrome no Android, ou o Safari no iPhone (iOS 16.4 ou mais novo) com o app instalado.</Callout>
        ) : needsInstall ? (
          <Callout tone="info" title="No iPhone, instale o app primeiro">
            <ol className="mt-1 list-decimal space-y-1 pl-5">
              <li>No Safari, toque em <strong>Compartilhar</strong> (quadrado com seta).</li>
              <li>Escolha <strong>Adicionar à Tela de Início</strong> e confirme.</li>
              <li>Abra o PayTracking pelo novo ícone, venha até aqui e toque em <strong>Ativar neste dispositivo</strong>.</li>
            </ol>
            <p className="mt-2">O iPhone só permite notificações de sites instalados na Tela de Início (iOS 16.4 ou mais novo).</p>
          </Callout>
        ) : (
          <div className={clsx('flex flex-wrap items-center justify-between gap-4 rounded-2xl border p-4', active ? 'border-ok/30 bg-ok/[0.06]' : 'border-border bg-surface-2/40')}>
            <div className="flex items-center gap-3">
              <span className={clsx('flex h-10 w-10 items-center justify-center rounded-xl', active ? 'bg-ok/15 text-ok' : 'bg-surface-3 text-muted')} aria-hidden>
                {active ? <BellRing className="h-5 w-5" /> : <BellOff className="h-5 w-5" />}
              </span>
              <div>
                <p className="text-sm font-semibold">{active ? 'Ativadas neste dispositivo' : perm === 'denied' ? 'Bloqueadas neste navegador' : 'Desativadas neste dispositivo'}</p>
                <p className="text-xs text-muted">{active ? 'Você recebe um aviso a cada venda aprovada.'
                  : perm === 'denied' ? 'Libere em: ícone de cadeado ao lado do endereço → Notificações → Permitir.' : 'Ative para receber as vendas aqui.'}</p>
              </div>
            </div>
            <div className="flex flex-wrap gap-2">
              {active
                ? <Button variant="ghost" loading={busy === 'off'} onClick={disable}>Desativar</Button>
                : <Button variant="primary" loading={busy === 'on'} disabled={!cfg.data || perm === 'denied'} onClick={enable} icon={<Bell className="h-4 w-4" />}>Ativar neste dispositivo</Button>}
              <Button loading={busy === 'test'} disabled={!(devices.data?.devices.length)} onClick={test} icon={<Send className="h-4 w-4" />}>Enviar teste</Button>
            </div>
          </div>
        )}

        {canInstall() && (
          <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-primary/25 bg-primary/[0.06] p-4">
            <p className="text-sm"><span className="font-semibold">Instale o app</span> <span className="text-muted">— abre em tela cheia, como um aplicativo, e as notificações ficam mais confiáveis.</span></p>
            <Button variant="primary" icon={<Download className="h-4 w-4" />} onClick={async () => { if (await promptInstall()) toast.ok('App instalado'); }}>Instalar app</Button>
          </div>
        )}

        {(devices.data?.devices.length ?? 0) > 0 && (
          <div>
            <p className="label">Seus dispositivos com notificações</p>
            <ul className="divide-y divide-border rounded-2xl border border-border">
              {devices.data!.devices.map((d) => (
                <li key={d.id} className="flex items-center justify-between gap-3 px-4 py-3">
                  <div className="flex min-w-0 items-center gap-3">
                    <Smartphone className="h-4 w-4 shrink-0 text-muted" aria-hidden />
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium">{d.name}{d.endpointHash === mine && <Badge tone="primary">este dispositivo</Badge>}</p>
                      <p className="text-xs text-muted">Ativado {relative(d.createdAt)} · {d.lastSuccessAt ? `último aviso ${relative(d.lastSuccessAt)}` : 'nenhum aviso entregue ainda'}</p>
                    </div>
                  </div>
                  <Button size="sm" variant="ghost" aria-label={`Remover ${d.name}`} onClick={async () => {
                    await del(`/v1/push/devices/${d.id}`);
                    if (d.endpointHash === mine) { const s = await currentSubscription(); await s?.unsubscribe(); setMine(null); }
                    refresh();
                  }}>Remover</Button>
                </li>
              ))}
            </ul>
          </div>
        )}

        <p className="text-xs leading-relaxed text-muted">
          <strong className="text-fg">Som:</strong> com o app fechado, o celular toca o som de notificação dele (Android e iPhone não permitem som personalizado em notificações de sites).
          Com o painel aberto, toca o som escolhido abaixo. No Android, em Configurações → Apps → Chrome (ou PayTracking) → Notificações, você pode escolher o som e deixar o aviso como “prioritário”.
        </p>
      </div>
    </Card>
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
      description="Toca no painel a cada venda aprovada, em qualquer página. Seu arquivo próprio fica salvo na sua conta e toca em todos os seus aparelhos."
      actions={<Switch checked={settings.enabled} label="Tocar som a cada venda" onChange={(v) => { update({ enabled: v }); if (v) void unlockAudio(); }} />}>
      <div className={clsx('space-y-5', !settings.enabled && 'pointer-events-none opacity-50')} aria-disabled={!settings.enabled}>
        <div role="radiogroup" aria-label="Som" className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {options.map((o) => (
            <div key={o.value} className={clsx('flex min-w-0 items-center gap-3 rounded-2xl border p-3.5 transition',
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
                try { await setCustomSound(f); toast.ok('Som salvo na sua conta', `${f.name} agora toca em todos os seus aparelhos.`); await preview('proprio'); } catch (err) { toast.err(err); } finally { setBusy(false); }
              }} />
              <Button icon={<Upload className="h-4 w-4" />} loading={busy} onClick={() => fileRef.current?.click()}>{custom.dataUrl ? 'Trocar arquivo' : 'Enviar arquivo'}</Button>
              {custom.dataUrl && <Button variant="ghost" onClick={async () => { try { await removeCustomSound(); toast.info('Som próprio removido da sua conta'); } catch (err) { toast.err(err); } }}>Remover</Button>}
            </div>
            <p className="hint">mp3, wav, ogg ou m4a de até 1 MB. Fica salvo na sua conta (só você ouve) e vira o som principal em todos os seus aparelhos. Use um som que você tenha o direito de usar.</p>
          </div>
        </div>
        <p className="text-xs text-muted">Os navegadores só tocam sons depois de um clique na página. Se o painel ficou aberto sem uso, clique em qualquer lugar (ou em “Ativar som de vendas” no topo) para liberar.</p>
      </div>
    </Card>
  );
}
