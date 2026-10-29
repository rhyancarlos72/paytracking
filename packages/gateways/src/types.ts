import type { AmountUnit, CustomerInput, MetaEventName, PaymentStatus } from '@pt/domain';

export type Provider = 'checkout' | 'kiwify' | 'cakto' | 'kirvano' | 'hotmart' | 'lowify' | 'wiapay';
export const PROVIDERS: Provider[] = ['checkout', 'kiwify', 'cakto', 'kirvano', 'hotmart', 'lowify', 'wiapay'];

export interface InboundRequest {
  rawBody: string;
  /** cabeçalhos em minúsculas */
  headers: Record<string, string | undefined>;
  query: Record<string, string | undefined>;
  payload: Record<string, unknown>;
}

export interface VerifyResult {
  ok: boolean;
  method: string;
  reason?: string;
}

export interface NormalizedProduct {
  id: string | null;
  name: string | null;
  quantity: number;
  priceMinor: bigint | null;
}

export interface NormalizedTracking {
  fbp?: string;
  fbc?: string;
  fbclid?: string;
  externalId?: string;
  purchaseEventId?: string;
  clientIp?: string;
  userAgent?: string;
  eventSourceUrl?: string;
  sck?: string;
  xcod?: string;
  utm_source?: string;
  utm_medium?: string;
  utm_campaign?: string;
  utm_content?: string;
  utm_term?: string;
  utm_id?: string;
}

export interface NormalizedPayment {
  kind: 'payment';
  provider: Provider;
  /** id único do webhook no gateway (quando existe) */
  sourceEventId: string | null;
  transactionId: string;
  status: PaymentStatus;
  /** evento/status original do gateway, para auditoria */
  gatewayEvent: string;
  amountMinor: bigint | null;
  currency: string | null;
  occurredAt: Date | null;
  customer: CustomerInput;
  products: NormalizedProduct[];
  tracking: NormalizedTracking;
}

/** Evento de funil enviado pelo servidor (ex.: Lead do checkout próprio). */
export interface NormalizedServerEvent {
  kind: 'event';
  provider: Provider;
  eventName: MetaEventName;
  eventId: string | null;
  transactionId: string | null;
  amountMinor: bigint | null;
  currency: string | null;
  customer: CustomerInput;
  products: NormalizedProduct[];
  tracking: NormalizedTracking;
}

export interface Ignored {
  kind: 'ignored';
  provider: Provider;
  reason: string;
  gatewayEvent?: string;
  transactionId?: string;
}

export type Normalized = NormalizedPayment | NormalizedServerEvent | Ignored;

export interface AdapterOptions {
  /** moeda padrão do pixel quando o gateway não informa */
  defaultCurrency: string;
  /** unidade do valor — só configurável onde o gateway não documenta (Lowify/Wiapay) */
  amountUnit?: AmountUnit;
  now?: () => Date;
}

export interface GatewayAdapter {
  provider: Provider;
  label: string;
  /** autenticação documentada */
  authMethod: string;
  /** o segredo é obrigatório para aceitar webhooks */
  requiresSecret: boolean;
  /** unidade do valor é configurável pelo usuário */
  configurableAmountUnit: boolean;
  verify(req: InboundRequest, secret: string | null): VerifyResult;
  /** pings/testes do painel do gateway: responder 200 sem processar */
  isTestPing(req: InboundRequest): boolean;
  normalize(payload: Record<string, unknown>, opts: AdapterOptions): Normalized;
}
