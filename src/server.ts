/**
 * @file server.ts
 * @description Ponto de entrada do servidor HTTP.
 */

import 'dotenv/config';

import http                         from 'http';
import { app }                      from '@/app';
import { closeDatabaseConnection }  from '@/config/supabase';
import { logger }                   from '@/config/logger';

const PORT = Number(process.env.PORT ?? 3333);
const HOST = process.env.HOST ?? '0.0.0.0';
const GRACEFUL_SHUTDOWN_TIMEOUT_MS = 15_000;

const server = http.createServer(app);
server.keepAliveTimeout = 65_000;
server.headersTimeout   = 66_000;

async function start(): Promise<void> {
  logger.info('Iniciando servidor...');
  logger.info(`[Server] Porta alvo: ${PORT} | Host: ${HOST}`);

  server.listen(PORT, HOST, () => {
    logger.info(`[Server] ✓ Rodando em http://${HOST}:${PORT}`);
    logger.info(`[Server] Ambiente: ${process.env.NODE_ENV ?? 'development'}`);
    logger.info(`[Server] Health:   http://localhost:${PORT}/health`);
    logger.info(`[Server] API:      http://localhost:${PORT}/api/v1`);
  });

  server.on('error', (err) => {
    logger.error('[Server] Erro ao iniciar listener:', err);
    process.exit(1);
  });
}

let isShuttingDown = false;

async function shutdown(signal: string): Promise<void> {
  if (isShuttingDown) return;
  isShuttingDown = true;

  logger.info(`[Server] ${signal} recebido. Encerrando...`);

  const forceExit = setTimeout(() => {
    logger.error('[Server] Timeout no shutdown. Forçando encerramento.');
    process.exit(1);
  }, GRACEFUL_SHUTDOWN_TIMEOUT_MS);

  forceExit.unref();

  try {
    await new Promise<void>((resolve, reject) => {
      server.close((err) => (err ? reject(err) : resolve()));
    });
    await closeDatabaseConnection();
    logger.info('[Server] Shutdown concluído.');
    clearTimeout(forceExit);
    process.exit(0);
  } catch (err) {
    logger.error('[Server] Erro durante shutdown:', err);
    process.exit(1);
  }
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT',  () => shutdown('SIGINT'));

start().catch((err) => {
  logger.error('[FATAL] Falha ao iniciar servidor:', err);
  process.exit(1);
});

export { server };