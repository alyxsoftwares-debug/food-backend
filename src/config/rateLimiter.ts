import rateLimit    from 'express-rate-limit';
import RedisStore   from 'rate-limit-redis';
import { createClient } from 'redis';
import { logger }   from '@/config/logger';

// ---------------------------------------------------------------------------
// Redis Client
// ---------------------------------------------------------------------------

let redisClient: ReturnType<typeof createClient> | null = null;

if (process.env.REDIS_URL) {
  redisClient = createClient({
    url: process.env.REDIS_URL,
    socket: process.env.REDIS_URL.startsWith('rediss://') 
      ? { rejectUnauthorized: false } 
      : undefined
  });

  redisClient.on('error', (err: Error) => {
    logger.warn('[Redis] Erro de conexão. Rate limiting usando memória local:', err.message);
    redisClient = null;
  });

  redisClient.connect().catch((err: Error) => {
    logger.warn('[Redis] Não foi possível conectar:', err.message);
    redisClient = null;
  });
}

export { redisClient };

// ---------------------------------------------------------------------------
// Factory de Rate Limiters
// ---------------------------------------------------------------------------

function createRateLimiter(options: {
  windowMs  : number;
  max       : number;
  message   : string;
  keyPrefix : string;
}) {
  return rateLimit({
    windowMs        : options.windowMs,
    max             : options.max,
    standardHeaders : true,
    legacyHeaders   : false,
    keyGenerator    : (req) => `${options.keyPrefix}:${req.ip}`,
    store           : redisClient
      ? new RedisStore({
          sendCommand: (...args: string[]) =>
            (redisClient as ReturnType<typeof createClient>).sendCommand(args),
          prefix: `rl:${options.keyPrefix}`,
        })
      : undefined,
    handler: (_req, res) => {
      res.status(429).json({
        success: false,
        error  : { code: 'RATE_LIMIT_EXCEEDED', message: options.message },
      });
    },
  });
}

export const globalLimiter = createRateLimiter({
  windowMs : 15 * 60 * 1000,
  max      : 300,
  message  : 'Muitas requisições. Aguarde alguns minutos.',
  keyPrefix: 'global',
});

export const authLimiter = createRateLimiter({
  windowMs : 15 * 60 * 1000,
  max      : 10,
  message  : 'Muitas tentativas de login. Aguarde 15 minutos.',
  keyPrefix: 'auth',
});

export const publicMenuLimiter = createRateLimiter({
  windowMs : 60 * 1000,
  max      : 120,
  message  : 'Limite de requisições atingido.',
  keyPrefix: 'menu',
});

export const orderCreationLimiter = createRateLimiter({
  windowMs : 60 * 1000,
  max      : 10,
  message  : 'Muitos pedidos em pouco tempo. Aguarde um momento.',
  keyPrefix: 'order',
});