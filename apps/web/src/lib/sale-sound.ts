/**
 * Som de venda — sons ORIGINAIS sintetizados no navegador (Web Audio API), sem arquivos de
 * terceiros. O usuário pode trocar por um arquivo próprio, que fica salvo na conta dele
 * (toca em todos os aparelhos em que ele entrar) e em cache neste navegador.
 * Preferências por dispositivo (localStorage), com try/catch: em modo privado tudo segue funcionando.
 */
import { del, get, put } from './api';

export type SoundPreset = 'caixa' | 'moedas' | 'sino' | 'conquista' | 'proprio';
export interface SoundSettings { enabled: boolean; preset: SoundPreset; volume: number }

export const PRESETS: Array<{ value: Exclude<SoundPreset, 'proprio'>; label: string; description: string }> = [
  { value: 'caixa', label: 'Caixa registradora', description: 'Cha-ching clássico de venda' },
  { value: 'moedas', label: 'Chuva de moedas', description: 'Moedas caindo, rápido e alegre' },
  { value: 'sino', label: 'Sino', description: 'Acorde brilhante e suave' },
  { value: 'conquista', label: 'Conquista', description: 'Duas notas subindo, estilo “nível concluído”' },
];

const KEY = 'pt_sale_sound';
const CUSTOM_KEY = 'pt_sale_sound_custom';
const CUSTOM_NAME_KEY = 'pt_sale_sound_custom_name';
export const MAX_CUSTOM_BYTES = 1024 * 1024;
const DEFAULTS: SoundSettings = { enabled: true, preset: 'caixa', volume: 0.8 };

const store = {
  get(k: string): string | null { try { return localStorage.getItem(k); } catch { return null; } },
  set(k: string, v: string | null): boolean {
    try { if (v === null) localStorage.removeItem(k); else localStorage.setItem(k, v); return true; } catch { return false; }
  },
};

export function loadSettings(): SoundSettings {
  try { return { ...DEFAULTS, ...(JSON.parse(store.get(KEY) ?? '{}') as Partial<SoundSettings>) }; } catch { return DEFAULTS; }
}
export function saveSettings(s: SoundSettings) {
  store.set(KEY, JSON.stringify(s));
  listeners.forEach((fn) => fn());
}
export const customSound = () => ({ dataUrl: store.get(CUSTOM_KEY), name: store.get(CUSTOM_NAME_KEY) });

/** Guarda um arquivo de áudio próprio (até 1 MB) na conta e neste navegador. */
export async function setCustomSound(file: File): Promise<void> {
  if (!file.type.startsWith('audio/')) throw new Error('Escolha um arquivo de áudio (mp3, wav, ogg…).');
  if (file.size > MAX_CUSTOM_BYTES) throw new Error('O arquivo precisa ter até 1 MB.');
  const dataUrl = await new Promise<string>((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result));
    r.onerror = () => reject(new Error('Não foi possível ler o arquivo.'));
    r.readAsDataURL(file);
  });
  await decode(dataUrl); // valida que o navegador consegue tocar
  await put('/v1/me/sale-sound', { name: file.name, dataUrl }); // na conta: vale em todos os aparelhos
  store.set(CUSTOM_KEY, dataUrl); // cache local (se o navegador não deixar, baixa da conta quando precisar)
  store.set(CUSTOM_NAME_KEY, file.name);
  customBuffer = null;
  saveSettings({ ...loadSettings(), preset: 'proprio' });
}
export async function removeCustomSound() {
  await del('/v1/me/sale-sound');
  store.set(CUSTOM_KEY, null);
  store.set(CUSTOM_NAME_KEY, null);
  customBuffer = null;
  const s = loadSettings();
  saveSettings({ ...s, preset: s.preset === 'proprio' ? 'caixa' : s.preset });
}

/**
 * Ao abrir o painel: traz o som salvo na conta para este aparelho e o torna o principal
 * (a menos que a pessoa já tenha escolhido outro som neste aparelho). Quem tinha um arquivo só
 * neste navegador, de antes de existir o som na conta, tem o arquivo enviado para a conta.
 */
export async function syncAccountSound(): Promise<void> {
  const remote = await get<{ name: string; dataUrl: string } | null>('/v1/me/sale-sound').catch(() => undefined);
  if (remote === undefined) return; // sem rede: tenta na próxima vez
  const local = store.get(CUSTOM_KEY);
  if (!remote) {
    if (local) await put('/v1/me/sale-sound', { name: store.get(CUSTOM_NAME_KEY) ?? 'som-de-venda', dataUrl: local }).catch(() => undefined);
    return;
  }
  const chosenHere = store.get(KEY) !== null;
  if (local !== remote.dataUrl) {
    store.set(CUSTOM_KEY, remote.dataUrl);
    store.set(CUSTOM_NAME_KEY, remote.name);
    customBuffer = null;
  }
  if (!chosenHere) saveSettings({ ...loadSettings(), preset: 'proprio' });
  else listeners.forEach((fn) => fn());
}

// ------------------------------------------------------------------ áudio
let ctx: AudioContext | null = null;
let customBuffer: AudioBuffer | null = null;
const listeners = new Set<() => void>();
export const onSoundChange = (fn: () => void) => { listeners.add(fn); return () => { listeners.delete(fn); }; };

function audio(): AudioContext | null {
  if (ctx) return ctx;
  const AC = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!AC) return null;
  ctx = new AC();
  ctx.onstatechange = () => listeners.forEach((fn) => fn());
  return ctx;
}

/** Navegadores só liberam som depois de um clique/tecla do usuário. */
export const audioUnlocked = () => !!ctx && ctx.state === 'running';
export async function unlockAudio() {
  const c = audio();
  if (c && c.state !== 'running') { try { await c.resume(); } catch { /* */ } }
  listeners.forEach((fn) => fn());
}
let armed = false;
/** Libera o áudio no primeiro clique/tecla em qualquer lugar da página. */
export function armAutoUnlock() {
  if (armed || typeof window === 'undefined') return;
  armed = true;
  const go = () => { void unlockAudio(); window.removeEventListener('pointerdown', go); window.removeEventListener('keydown', go); };
  window.addEventListener('pointerdown', go);
  window.addEventListener('keydown', go);
}

async function decode(dataUrl: string): Promise<AudioBuffer> {
  const c = audio();
  if (!c) throw new Error('Este navegador não toca áudio.');
  // sem fetch(data:): a política de segurança (CSP connect-src 'self') bloqueia, e com razão
  const b64 = dataUrl.slice(dataUrl.indexOf(',') + 1);
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return c.decodeAudioData(bytes.buffer);
}

/** Toca o som escolhido (ou o informado) — usado no aviso de venda e no botão "Ouvir". */
export async function playSaleSound(override?: Partial<SoundSettings>): Promise<boolean> {
  const s = { ...loadSettings(), ...override };
  if (!s.enabled && !override) return false;
  const c = audio();
  if (!c) return false;
  if (c.state !== 'running') { try { await c.resume(); } catch { return false; } }
  if (c.state !== 'running') return false;
  const out = c.createGain();
  out.gain.value = Math.max(0, Math.min(1, s.volume));
  out.connect(c.destination);
  const t = c.currentTime + 0.02;
  if (s.preset === 'proprio') {
    let url = store.get(CUSTOM_KEY);
    if (!url && !customBuffer) {
      // navegador sem espaço/modo privado: busca o arquivo na conta
      const remote = await get<{ dataUrl: string } | null>('/v1/me/sale-sound').catch(() => null);
      url = remote?.dataUrl ?? null;
    }
    if (!url && !customBuffer) return playSaleSound({ ...override, preset: 'caixa' });
    customBuffer ??= await decode(url!);
    const src = c.createBufferSource();
    src.buffer = customBuffer;
    src.connect(out);
    src.start(t);
    return true;
  }
  SYNTH[s.preset](c, out, t);
  return true;
}

// ------------------------------------------------------------------ síntese (sons originais)
type Synth = (c: AudioContext, out: AudioNode, t: number) => void;

/** Tom com envelope de ataque rápido e decaimento exponencial. */
function tone(c: AudioContext, out: AudioNode, t: number, freq: number, dur: number, gain: number, type: OscillatorType = 'sine') {
  const o = c.createOscillator();
  const g = c.createGain();
  o.type = type;
  o.frequency.setValueAtTime(freq, t);
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(gain, t + 0.006);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  o.connect(g).connect(out);
  o.start(t);
  o.stop(t + dur + 0.05);
}

/** Sino metálico: fundamental + parciais inarmônicos (timbre de campainha). */
function bell(c: AudioContext, out: AudioNode, t: number, freq: number, dur: number, gain: number) {
  for (const [ratio, g] of [[1, 1], [2.76, 0.45], [5.4, 0.22], [8.93, 0.1]] as const) tone(c, out, t, freq * ratio, dur / (ratio > 1 ? 1.6 : 1), gain * g);
}

/** Ruído curto filtrado (gaveta/mecanismo). */
function noise(c: AudioContext, out: AudioNode, t: number, dur: number, gain: number, freq: number) {
  const len = Math.max(1, Math.floor(c.sampleRate * dur));
  const buf = c.createBuffer(1, len, c.sampleRate);
  const d = buf.getChannelData(0);
  for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / len);
  const src = c.createBufferSource();
  src.buffer = buf;
  const f = c.createBiquadFilter();
  f.type = 'bandpass';
  f.frequency.value = freq;
  f.Q.value = 1.2;
  const g = c.createGain();
  g.gain.value = gain;
  src.connect(f).connect(g).connect(out);
  src.start(t);
}

const SYNTH: Record<Exclude<SoundPreset, 'proprio'>, Synth> = {
  // "cha" (mecanismo) + "ching" (dois toques de campainha)
  caixa(c, out, t) {
    // gaveta abrindo: batida grave curta que desce de tom
    const o = c.createOscillator();
    const g = c.createGain();
    o.type = 'sine';
    o.frequency.setValueAtTime(170, t);
    o.frequency.exponentialRampToValueAtTime(70, t + 0.12);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.55, t + 0.008);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.16);
    o.connect(g).connect(out);
    o.start(t);
    o.stop(t + 0.2);
    // "cha": mecanismo metálico
    noise(c, out, t + 0.01, 0.06, 0.5, 2600);
    noise(c, out, t + 0.06, 0.05, 0.35, 4200);
    // "ching": dois toques de campainha + brilho de moedas no final
    bell(c, out, t + 0.1, 1975.5, 1.1, 0.32);
    bell(c, out, t + 0.21, 2637, 1.4, 0.27);
    [3951, 4699, 5274].forEach((f, i) => tone(c, out, t + 0.32 + i * 0.045, f, 0.3, 0.045, 'triangle'));
  },
  moedas(c, out, t) {
    const notes = [3520, 3951, 3322, 4186, 3729, 4435];
    notes.forEach((f, i) => {
      const at = t + i * 0.07 + Math.random() * 0.015;
      tone(c, out, at, f, 0.22, 0.22, 'triangle');
      tone(c, out, at, f * 2.01, 0.12, 0.06);
    });
  },
  sino(c, out, t) {
    [1046.5, 1318.5, 1568, 2093].forEach((f, i) => bell(c, out, t + i * 0.09, f, 1.4, 0.16));
  },
  conquista(c, out, t) {
    tone(c, out, t, 784, 0.18, 0.28, 'triangle');
    tone(c, out, t + 0.13, 1174.7, 0.55, 0.3, 'triangle');
    tone(c, out, t + 0.13, 2349.3, 0.4, 0.06);
    [2637, 3136, 3951].forEach((f, i) => tone(c, out, t + 0.22 + i * 0.05, f, 0.25, 0.05));
  },
};
