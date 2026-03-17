/**
 * @file AppError.ts
 * @description Classe base para erros operacionais da aplicação.
 *
 * Diferencia erros esperados (operacionais) de erros inesperados (bugs),
 * permitindo que o error handler global trate cada tipo adequadamente.
 *
 * Erros operacionais → lançados intencionalmente (ex: "Pedido não encontrado")
 * Erros de programação → bugs não tratados (ex: TypeError, ReferenceError)
 *
 * @module errors/AppError
 */

// ---------------------------------------------------------------------------
// Catálogo de códigos de erro
// Centraliza todos os códigos usados na aplicação para consistência
// na documentação da API e no frontend.
// ---------------------------------------------------------------------------

export const ErrorCode = {
  // Genéricos
  INTERNAL_SERVER_ERROR : 'INTERNAL_SERVER_ERROR',
  VALIDATION_ERROR      : 'VALIDATION_ERROR',
  ROUTE_NOT_FOUND       : 'ROUTE_NOT_FOUND',
  RATE_LIMIT_EXCEEDED   : 'RATE_LIMIT_EXCEEDED',
  INVALID_JSON          : 'INVALID_JSON',
  CORS_BLOCKED          : 'CORS_BLOCKED',

  // Autenticação & Autorização
  UNAUTHORIZED          : 'UNAUTHORIZED',
  FORBIDDEN             : 'FORBIDDEN',
  TOKEN_EXPIRED         : 'TOKEN_EXPIRED',
  TOKEN_INVALID         : 'TOKEN_INVALID',
  INSUFFICIENT_ROLE     : 'INSUFFICIENT_ROLE',

  // Tenant / Empresa
  COMPANY_NOT_FOUND     : 'COMPANY_NOT_FOUND',
  COMPANY_INACTIVE      : 'COMPANY_INACTIVE',
  COMPANY_SUSPENDED     : 'COMPANY_SUSPENDED',
  PLAN_LIMIT_REACHED    : 'PLAN_LIMIT_REACHED',

  // Usuários
  USER_NOT_FOUND        : 'USER_NOT_FOUND',
  USER_ALREADY_EXISTS   : 'USER_ALREADY_EXISTS',
  USER_INACTIVE         : 'USER_INACTIVE',
  INVALID_PIN           : 'INVALID_PIN',

  // Cardápio
  CATEGORY_NOT_FOUND    : 'CATEGORY_NOT_FOUND',
  PRODUCT_NOT_FOUND     : 'PRODUCT_NOT_FOUND',
  PRODUCT_UNAVAILABLE   : 'PRODUCT_UNAVAILABLE',
  PRODUCT_OUT_OF_STOCK  : 'PRODUCT_OUT_OF_STOCK',

  // Pedidos
  ORDER_NOT_FOUND            : 'ORDER_NOT_FOUND',
  ORDER_INVALID_STATUS       : 'ORDER_INVALID_STATUS',
  ORDER_ALREADY_CANCELLED    : 'ORDER_ALREADY_CANCELLED',
  ORDER_MINIMUM_NOT_MET      : 'ORDER_MINIMUM_NOT_MET',
  ORDER_OUTSIDE_BUSINESS_HOURS: 'ORDER_OUTSIDE_BUSINESS_HOURS',

  // Mesas
  TABLE_NOT_FOUND       : 'TABLE_NOT_FOUND',
  TABLE_OCCUPIED        : 'TABLE_OCCUPIED',
  TABLE_UNAVAILABLE     : 'TABLE_UNAVAILABLE',
  TABLE_QR_INVALID      : 'TABLE_QR_INVALID',

  // Clientes
  CUSTOMER_NOT_FOUND    : 'CUSTOMER_NOT_FOUND',

  // Pagamentos
  PAYMENT_FAILED        : 'PAYMENT_FAILED',
  PAYMENT_ALREADY_PAID  : 'PAYMENT_ALREADY_PAID',

  // Entrega
  DELIVERY_ZONE_NOT_FOUND    : 'DELIVERY_ZONE_NOT_FOUND',
  DELIVERY_NOT_AVAILABLE     : 'DELIVERY_NOT_AVAILABLE',
  DELIVERY_ADDRESS_REQUIRED  : 'DELIVERY_ADDRESS_REQUIRED',

  // Banco de dados
  DB_CONFLICT           : 'DB_CONFLICT',
  DB_CONNECTION_ERROR   : 'DB_CONNECTION_ERROR',
} as const;

export type ErrorCodeType = (typeof ErrorCode)[keyof typeof ErrorCode];

// ---------------------------------------------------------------------------
// Classe AppError
// ---------------------------------------------------------------------------

/**
 * Representa um erro operacional conhecido e esperado.
 *
 * @example
 * throw new AppError('Pedido não encontrado.', 404, ErrorCode.ORDER_NOT_FOUND);
 *
 * @example
 * // Erro com dados extras para o cliente
 * throw new AppError(
 *   'Quantidade inválida para o adicional.',
 *   422,
 *   ErrorCode.VALIDATION_ERROR,
 *   { field: 'quantity', min: 1, max: 10 }
 * );
 */
export class AppError extends Error {
  /** HTTP status code da resposta (4xx ou 5xx) */
  public readonly statusCode: number;

  /** Código de erro legível por máquina para o frontend */
  public readonly errorCode: ErrorCodeType;

  /**
   * Indica que este é um erro operacional esperado.
   * O error handler global usa esta flag para decidir se loga como
   * `error` (bugs) ou `warn` (operacional).
   */
  public readonly isOperational: boolean;

  /** Dados adicionais estruturados opcionais para o cliente */
  public readonly meta?: Record<string, unknown>;

  constructor(
    message  : string,
    statusCode: number = 500,
    errorCode : ErrorCodeType = ErrorCode.INTERNAL_SERVER_ERROR,
    meta?     : Record<string, unknown>,
  ) {
    super(message);

    this.name          = 'AppError';
    this.statusCode    = statusCode;
    this.errorCode     = errorCode;
    this.isOperational = true;
    this.meta          = meta;

    // Garante que instanceof funcione corretamente com herança em TypeScript
    Object.setPrototypeOf(this, new.target.prototype);

    // Captura stack trace sem incluir o construtor na pilha
    if (Error.captureStackTrace) {
      Error.captureStackTrace(this, this.constructor);
    }
  }

  // ---------------------------------------------------------------------------
  // Factory Methods — Erros mais comuns pré-configurados
  // ---------------------------------------------------------------------------

  static notFound(entity: string, id?: string): AppError {
    const detail = id ? ` (id: ${id})` : '';
    return new AppError(
      `${entity} não encontrado${detail}.`,
      404,
      ErrorCode.ROUTE_NOT_FOUND,
    );
  }

  static unauthorized(message = 'Autenticação necessária.'): AppError {
    return new AppError(message, 401, ErrorCode.UNAUTHORIZED);
  }

  static forbidden(message = 'Acesso negado.'): AppError {
    return new AppError(message, 403, ErrorCode.FORBIDDEN);
  }

  static validation(
    message: string,
    meta?: Record<string, unknown>,
  ): AppError {
    return new AppError(message, 422, ErrorCode.VALIDATION_ERROR, meta);
  }

  static conflict(message: string): AppError {
    return new AppError(message, 409, ErrorCode.DB_CONFLICT);
  }

  static badRequest(message: string): AppError {
    return new AppError(message, 400, ErrorCode.VALIDATION_ERROR);
  }

  /**
   * Converte o erro para o formato de resposta JSON da API.
   * Usado internamente pelo error handler global.
   */
  toJSON(includeStack = false): Record<string, unknown> {
    return {
      success: false,
      error: {
        code   : this.errorCode,
        message: this.message,
        ...(this.meta  && { meta: this.meta }),
        ...(includeStack && { stack: this.stack }),
      },
    };
  }
}
