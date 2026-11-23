/**
 * WebMCP: ferramentas expostas a agentes de IA que rodam no navegador (navigator.modelContext).
 * Só informações públicas e uma ação de navegação (abrir o cadastro); nada de dados da conta.
 * Navegadores sem WebMCP simplesmente ignoram.
 */
interface ModelContextTool {
  name: string; description: string; inputSchema: Record<string, unknown>;
  execute: (input: Record<string, unknown>) => Promise<unknown> | unknown;
}
type ModelContext = { registerTool?: (tool: ModelContextTool) => unknown; unregisterTool?: (name: string) => unknown };

export function registerLandingTools(getPlan: () => { priceMinor: number; trialDays: number } | undefined): () => void {
  const mc = (navigator as unknown as { modelContext?: ModelContext }).modelContext;
  if (!mc?.registerTool) return () => {};
  const text = (t: string) => ({ content: [{ type: 'text', text: t }] });
  const tools: ModelContextTool[] = [
    {
      name: 'paytracking_pricing',
      description: 'Preço mensal do PayTracking, dias de teste grátis e condições (sem taxa por venda, vendas ilimitadas).',
      inputSchema: { type: 'object', properties: {} },
      execute: () => {
        const p = getPlan();
        const price = p ? `R$ ${(p.priceMinor / 100).toFixed(2).replace('.', ',')}` : 'preço fixo mensal';
        return text(`PayTracking: ${price} por mês, vendas ilimitadas, sem taxa por venda. ${p?.trialDays ?? 7} dias grátis sem cartão. Pagamento por PIX no painel.`);
      },
    },
    {
      name: 'paytracking_start_trial',
      description: 'Abre a página de cadastro do teste grátis do PayTracking, opcionalmente já com o e-mail preenchido.',
      inputSchema: { type: 'object', properties: { email: { type: 'string', format: 'email', description: 'E-mail para preencher no cadastro (opcional).' } } },
      execute: (input) => {
        const email = typeof input?.email === 'string' && /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(input.email) ? input.email : '';
        location.assign(`/criar-conta${email ? `?email=${encodeURIComponent(email)}` : ''}`);
        return text('Abrindo o cadastro do teste grátis.');
      },
    },
  ];
  for (const t of tools) { try { mc.registerTool(t); } catch { /* já registrada ou API diferente */ } }
  return () => { for (const t of tools) { try { mc.unregisterTool?.(t.name); } catch { /* */ } } };
}
