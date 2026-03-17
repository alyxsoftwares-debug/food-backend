/**
 * @file app.ts
 * @description Configuração central da aplicação Express.
 *
 * Responsabilidades deste módulo:
 *  - Inicializar e configurar o servidor Express
 *  - Registrar middlewares globais (segurança, CORS, parsing, logging)
 *  - Aplicar rate limiting por rota/perfil
 *  - Montar o roteador principal com versionamento de API
 *  - Registrar handlers de erro globais
 *
 * O servidor HTTP em si (listen) é criado em `src/server.ts` para manter
 * a separação de responsabilidades e facilitar testes de integração.
 *
 * @module app
 */

import express, {
  Application,
  Request,
  Response,
  NextFunction,
} from 'express';

import helmet                   from 'helmet';
import cors                     from 'cors';
import compression              from 'compression';
import morgan                   from 'morgan';
import rateLimit                from 'express-rate-limit';
import RedisStore               from 'rate-limit-redis';
import { createClient }         from 'redis';
import hpp                      from 'hpp';

import { checkDatabaseHealth }  from '@/config/supabase';
import { router }               from '@/routes';
import { AppError }             from '@/errors/AppError';
import { logger }               from '@/config/logger';

// ---------------------------------------------------------------------------
// App Instance
// ---------------------------------------------------------------------------

const app: Application = express();

// ---------------------------------------------------------------------------
// Trust Proxy
// Necessário para `req.ip` funcionar corretamente atrás do proxy do Render/Vercel.
// ---------------------------------------------------------------------------

app.set('trust proxy', 1);

// ---------------------------------------------------------------------------
// Request ID Middleware
// Injeta um ID único em cada request para rastreabilidade nos logs.
// ---------------------------------------------------------------------------

app.use((req: Request, _res: Response, next: NextFunction) => {
  req.id = (req.headers['x-request-id'] as string) ?? crypto.randomUUID();
  next();
});

// ---------------------------------------------------------------------------
// Helmet — Headers de segurança HTTP
// Configura Content-Security-Policy, HSTS, X-Frame-Options, etc.
// ---------------------------------------------------------------------------

app.use(
  helmet({
    contentSecurityPolicy: {
      directives: {
        defaultSrc : ["'self'"],
        scriptSrc  : ["'self'"],
        objectSrc  : ["'none'"],
        upgradeInsecureRequests: [],
      },
    },
    crossOriginEmbedderPolicy: false, // Desabilitado para compatibilidade com imagens externas (logos, fotos de produtos)
    hsts: {
      maxAge           : 31_536_000, // 1 ano em segundos
      includeSubDomains: true,
      preload          : true,
    },
  }),
);

// ---------------------------------------------------------------------------
// CORS
// Permite apenas origens registradas via variável de ambiente.
// ---------------------------------------------------------------------------

const ALLOWED_ORIGINS = (process.env.ALLOWED_ORIGINS ?? '')
  .split(',')
  .map((o) => o.trim())
  .filter(Boolean);

const corsOptions: cors.CorsOptions = {
  origin(origin, callback) {
    // Permite requests sem origin (ex: mobile apps, curl, Postman em dev)
    if (!origin) return callback(null, true);

    if (
      ALLOWED_ORIGINS.includes(origin) ||
      process.env.NODE_ENV === 'development'
    ) {
      return callback(null, true);
    }

    callback(
      new AppError(`CORS: Origem não permitida → ${origin}`, 403, 'CORS_BLOCKED'),
    );
  },
  methods          : ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  allowedHeaders   : ['Content-Type', 'Authorization', 'x-request-id', 'x-company-slug'],
  exposedHeaders   : ['x-request-id', 'x-ratelimit-limit', 'x-ratelimit-remaining'],
  credentials      : true,
  maxAge           : 86_400, // Cache do preflight por 24h
};

app.use(cors(corsOptions));
app.options('*', cors(corsOptions)); // Responde preflight em todas as rotas

// ---------------------------------------------------------------------------
// Body Parsing
// Limites definidos para prevenir ataques de payload gigante.
// ---------------------------------------------------------------------------

app.use(express.json({ limit: '2mb' }));
app.use(express.urlencoded({ extended: true, limit: '2mb' }));

// ---------------------------------------------------------------------------
// HPP — HTTP Parameter Pollution Protection
// Previne poluição de query string (ex: ?status=active&status=inactive)
// ---------------------------------------------------------------------------

app.use(hpp());

// ---------------------------------------------------------------------------
// Compression
// Comprime respostas >= 1kb com gzip/deflate.
// ---------------------------------------------------------------------------

app.use(
  compression({
    level    : 6,           // Balanceio entre CPU e taxa de compressão
    threshold: 1024,        // Apenas comprime respostas > 1kb
    filter(req, res) {
      // Não comprime Server-Sent Events (usado para pedidos em tempo real)
      if (req.headers['accept'] === 'text/event-stream') return false;
      return compression.filter(req, res);
    },
  }),
);

// ---------------------------------------------------------------------------
// HTTP Request Logger (Morgan)
// Em produção usa formato JSON estruturado; em dev usa formato colorido.
// ---------------------------------------------------------------------------

const morganFormat =
  process.env.NODE_ENV === 'production'
    ? ':remote-addr :method :url :status :res[content-length] - :response-time ms'
    : 'dev';

app.use(
  morgan(morganFormat, {
    stream: {
      write: (message: string) => logger.http(message.trim()),
    },
    skip: (_req, res) =>
      // Não loga health checks para não poluir os logs
      res.statusCode === 200 && _req.path === '/health',
  }),
);

// ---------------------------------------------------------------------------
// Redis Client (para Rate Limiting distribuído)
// Compartilha contadores entre múltiplas instâncias do servidor no Render.
// ---------------------------------------------------------------------------

let redisClient: ReturnType<typeof createClient> | null = null;

if (process.env.REDIS_URL) {
  redisClient = createClient({ url: process.env.REDIS_URL });

  redisClient.on('error', (err: Error) => {
    // Loga mas não derruba o servidor — rate limiting cai para memória local
    logger.warn('[Redis] Erro de conexão. Rate limiting usando memória local:', err.message);
    redisClient = null;
  });

  redisClient.connect().catch((err: Error) => {
    logger.warn('[Redis] Não foi possível conectar:', err.message);
    redisClient = null;
  });
}

// ---------------------------------------------------------------------------
// Rate Limiting
// Perfis diferentes para rotas públicas, autenticadas e sensíveis.
// ---------------------------------------------------------------------------

/**
 * Factory que cria um rate limiter configurável.
 * Se Redis estiver disponível, usa store distribuída.
 */
function createRateLimiter(options: {
  windowMs    : number;
  max         : number;
  message     : string;
  keyPrefix   : string;
}) {
  return rateLimit({
    windowMs          : options.windowMs,
    max               : options.max,
    standardHeaders   : true,  // Retorna headers `RateLimit-*` (RFC 6585)
    legacyHeaders     : false,
    keyGenerator      : (req) => `${options.keyPrefix}:${req.ip}`,
    store             : redisClient
      ? new RedisStore({
          sendCommand: (...args: string[]) =>
            (redisClient as ReturnType<typeof createClient>).sendCommand(args),
          prefix: `rl:${options.keyPrefix}`,
        })
      : undefined,
    handler: (_req, res) => {
      res.status(429).json({
        success  : false,
        error    : {
          code   : 'RATE_LIMIT_EXCEEDED',
          message: options.message,
        },
      });
    },
  });
}

/** Rate limiter global — proteção base para toda a API */
export const globalLimiter = createRateLimiter({
  windowMs : 15 * 60 * 1000, // 15 minutos
  max      : 300,
  message  : 'Muitas requisições. Aguarde alguns minutos.',
  keyPrefix: 'global',
});

/** Rate limiter para rotas de autenticação (login, refresh) */
export const authLimiter = createRateLimiter({
  windowMs : 15 * 60 * 1000, // 15 minutos
  max      : 10,
  message  : 'Muitas tentativas de login. Aguarde 15 minutos.',
  keyPrefix: 'auth',
});

/** Rate limiter permissivo para cardápio público */
export const publicMenuLimiter = createRateLimiter({
  windowMs : 60 * 1000, // 1 minuto
  max      : 120,
  message  : 'Limite de requisições atingido.',
  keyPrefix: 'menu',
});

/** Rate limiter para criação de pedidos (previne spam de pedidos) */
export const orderCreationLimiter = createRateLimiter({
  windowMs : 60 * 1000, // 1 minuto
  max      : 10,
  message  : 'Muitos pedidos em pouco tempo. Aguarde um momento.',
  keyPrefix: 'order',
});

app.use('/api/', globalLimiter);

// ---------------------------------------------------------------------------
// Health Check Endpoint
// Verificado pelo Render a cada 30s para manter o serviço ativo.
// ---------------------------------------------------------------------------

app.get('/health', async (_req: Request, res: Response) => {
  const dbHealthy = await checkDatabaseHealth();

  const status = dbHealthy ? 200 : 503;

  res.status(status).json({
    status   : dbHealthy ? 'healthy' : 'degraded',
    timestamp: new Date().toISOString(),
    uptime   : Math.floor(process.uptime()),
    version  : process.env.npm_package_version ?? '1.0.0',
    services : {
      database : dbHealthy ? 'up' : 'down',
      redis    : redisClient ? 'up' : 'unavailable',
    },
    environment: process.env.NODE_ENV ?? 'development',
  });
});

// ---------------------------------------------------------------------------
// Roteador Principal — Todas as rotas sob /api/v1
// ---------------------------------------------------------------------------

app.use('/api/v1', router);

// ---------------------------------------------------------------------------
// 404 Handler — Rotas não encontradas
// ---------------------------------------------------------------------------

app.use((_req: Request, res: Response) => {
  res.status(404).json({
    success: false,
    error  : {
      code   : 'ROUTE_NOT_FOUND',
      message: `Rota não encontrada: ${_req.method} ${_req.originalUrl}`,
    },
  });
});

// ---------------------------------------------------------------------------
// Global Error Handler
// Centraliza o tratamento de todos os erros lançados na aplicação.
// Express reconhece como error handler por ter 4 parâmetros (err, req, res, next).
// ---------------------------------------------------------------------------

// eslint-disable-next-line @typescript-eslint/no-unused-vars
app.use((err: Error, req: Request, res: Response, _next: NextFunction) => {
  // Loga com contexto de rastreabilidade
  logger.error({
    requestId : req.id,
    method    : req.method,
    path      : req.path,
    error     : err.message,
    stack     : process.env.NODE_ENV !== 'production' ? err.stack : undefined,
  });

  // Erro operacional conhecido (lançado via AppError)
  if (err instanceof AppError) {
    return res.status(err.statusCode).json({
      success: false,
      error  : {
        code   : err.errorCode,
        message: err.message,
        ...(process.env.NODE_ENV !== 'production' && { stack: err.stack }),
      },
    });
  }

  // Erros de parsing de JSON (body malformado)
  if (err instanceof SyntaxError && 'body' in err) {
    return res.status(400).json({
      success: false,
      error  : {
        code   : 'INVALID_JSON',
        message: 'O corpo da requisição contém JSON inválido.',
      },
    });
  }

  // Erro desconhecido — retorna 500 genérico em produção
  return res.status(500).json({
    success: false,
    error  : {
      code   : 'INTERNAL_SERVER_ERROR',
      message: 'Ocorreu um erro interno. Nossa equipe foi notificada.',
      ...(process.env.NODE_ENV !== 'production' && {
        detail: err.message,
        stack : err.stack,
      }),
    },
  });
});

// ---------------------------------------------------------------------------
// Exports
// ---------------------------------------------------------------------------

export { app, redisClient };
