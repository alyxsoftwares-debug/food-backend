/**
 * @file logger.ts
 * @description Configuração do logger centralizado da aplicação (Winston).
 *
 * Estratégia de transports:
 *  - Development → logs coloridos e legíveis no console
 *  - Production  → logs estruturados em JSON (compatível com Render Logs,
 *                  Datadog, Sentry, Grafana Loki, etc.)
 *
 * Níveis disponíveis (do mais ao menos crítico):
 *  error > warn > info > http > verbose > debug > silly
 *
 * @module config/logger
 */

import winston, { format, transports } from 'winston';

// ---------------------------------------------------------------------------
// Constantes
// ---------------------------------------------------------------------------

const IS_PRODUCTION  = process.env.NODE_ENV === 'production';
const IS_TEST        = process.env.NODE_ENV === 'test';
const LOG_LEVEL      = process.env.LOG_LEVEL ?? (IS_PRODUCTION ? 'info' : 'debug');
const SERVICE_NAME   = process.env.SERVICE_NAME ?? 'food-saas-backend';
const SERVICE_VERSION = process.env.npm_package_version ?? '1.0.0';

// ---------------------------------------------------------------------------
// Formatos customizados
// ---------------------------------------------------------------------------

/**
 * Adiciona campos de contexto globais a todos os logs:
 * service, version, environment e pid.
 */
const addServiceContext = format((info) => {
  info.service     = SERVICE_NAME;
  info.version     = SERVICE_VERSION;
  info.environment = process.env.NODE_ENV ?? 'development';
  info.pid         = process.pid;
  return info;
});

/**
 * Formata erros nativos (Error objects) para incluir stack trace
 * no campo `stack` e a mensagem no campo `message`.
 */
const formatErrors = format((info) => {
  if (info instanceof Error) {
    return Object.assign({}, info, {
      message: info.message,
      stack  : info.stack,
    });
  }

  // Suporte a logs no formato: logger.error('msg', error)
  if (info.error instanceof Error) {
    info.errorMessage = info.error.message;
    info.errorStack   = info.error.stack;
    info.errorName    = info.error.name;
    delete info.error;
  }

  return info;
});

/**
 * Formato para desenvolvimento: legível, colorido, com timestamp local.
 *
 * Exemplo de output:
 * 2024-01-15 14:23:01 [info]  Servidor iniciado na porta 3333
 */
const devFormat = format.combine(
  format.colorize({ all: true }),
  format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
  format.errors({ stack: true }),
  format.printf(({ timestamp, level, message, requestId, ...meta }) => {
    const reqId = requestId ? ` [${requestId}]` : '';
    const extra = Object.keys(meta).length
      ? `\n  ${JSON.stringify(meta, null, 2)}`
      : '';
    return `${timestamp} [${level}]${reqId} ${message}${extra}`;
  }),
);

/**
 * Formato para produção: JSON estruturado, uma linha por log.
 * Compatível com qualquer sistema de log aggregation.
 *
 * Exemplo de output:
 * {"timestamp":"2024-01-15T17:23:01.123Z","level":"info","message":"...","service":"food-saas-backend",...}
 */
const prodFormat = format.combine(
  addServiceContext(),
  formatErrors(),
  format.timestamp(),
  format.errors({ stack: true }),
  format.json(),
);

// ---------------------------------------------------------------------------
// Transports
// ---------------------------------------------------------------------------

const consoleTransport = new transports.Console({
  format: IS_PRODUCTION ? prodFormat : devFormat,
  silent: IS_TEST, // Silencia todos os logs durante testes unitários
});

/**
 * Transport de arquivo para erros críticos.
 * Ativo apenas em produção para evitar I/O desnecessário em dev.
 */
const errorFileTransport = new transports.File({
  filename   : 'logs/error.log',
  level      : 'error',
  format     : prodFormat,
  maxsize    : 10 * 1024 * 1024, // 10MB por arquivo
  maxFiles   : 5,                 // Mantém os 5 arquivos mais recentes
  tailable   : true,
});

/**
 * Transport de arquivo para todos os logs combinados.
 * Ativo apenas em produção.
 */
const combinedFileTransport = new transports.File({
  filename   : 'logs/combined.log',
  format     : prodFormat,
  maxsize    : 20 * 1024 * 1024, // 20MB por arquivo
  maxFiles   : 5,
  tailable   : true,
});

// ---------------------------------------------------------------------------
// Instância do Logger
// ---------------------------------------------------------------------------

export const logger = winston.createLogger({
  level      : LOG_LEVEL,
  exitOnError: false, // Não encerra o processo em caso de erro no transport

  transports: IS_PRODUCTION
    ? [consoleTransport, errorFileTransport, combinedFileTransport]
    : [consoleTransport],

  /**
   * Captura exceções não tratadas e rejeições de Promise.
   * Em produção, loga antes de encerrar o processo.
   */
  exceptionHandlers: IS_PRODUCTION ? [errorFileTransport] : [],
  rejectionHandlers: IS_PRODUCTION ? [errorFileTransport] : [],
});

// ---------------------------------------------------------------------------
// Helper: Logger com contexto de request
// Cria uma instância do logger com requestId e companyId pré-injetados,
// evitando repetição nos logs de cada serviço.
// ---------------------------------------------------------------------------

/**
 * Cria um logger contextualizado para um request específico.
 *
 * @example
 * const log = createRequestLogger(req.id, req.companyId);
 * log.info('Pedido criado', { orderId, total });
 * // Output: {"level":"info","message":"Pedido criado","requestId":"...","companyId":"...","orderId":"...","total":...}
 */
export function createRequestLogger(
  requestId : string,
  companyId?: string,
): winston.Logger {
  return logger.child({
    requestId,
    ...(companyId && { companyId }),
  });
}

// ---------------------------------------------------------------------------
// Logs de inicialização
// ---------------------------------------------------------------------------

logger.info(`Logger inicializado — nível: ${LOG_LEVEL} | ambiente: ${process.env.NODE_ENV ?? 'development'}`);
