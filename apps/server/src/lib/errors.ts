export class AppError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
    public readonly details?: unknown,
  ) {
    super(message);
  }
}

export const badRequest = (message: string, details?: unknown) => new AppError(400, 'bad_request', message, details);
export const unauthorized = (message = 'Faça login para continuar.') => new AppError(401, 'unauthorized', message);
export const paymentRequired = (message = 'Sua assinatura expirou. Regularize em Financeiro.') => new AppError(402, 'plan_expired', message);
export const forbidden = (message = 'Você não tem permissão para esta ação.') => new AppError(403, 'forbidden', message);
export const notFound = (message = 'Não encontrado.') => new AppError(404, 'not_found', message);
export const conflict = (message: string) => new AppError(409, 'conflict', message);
export const tooMany = (message = 'Muitas tentativas. Aguarde alguns minutos.') => new AppError(429, 'rate_limited', message);
