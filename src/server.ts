/**
 * @file server.ts
 * @description Ponto de entrada do servidor HTTP.
 */

import 'dotenv/config';

import http                         from 'http';
import { app }                      from '@/app';
import { checkDatabaseHealth,
         closeDatabaseConnection }  from '@/config/supabase';
import { logger }                   from '@/config/logger';

const PORT = Number(process.env.PORT ?? 3333);
const HOST = process.env.HOST ?? '0.0.0.0';
const GRACEFUL_SHUTDOWN_TIMEOUT_MS = 15_000;

const server = http.createServer(app);
server.keepAliveTimeout = 65_000;
server.headersTimeout   = 66_000;

async function start(): Promise<void> {
  logger.info('Iniciando servidor...');

  logger.info('[Server] Testando conexão com o banco de dados Supabase...');
  const dbHealthy = await checkDatabaseHealth();
  if (!dbHealthy) {
    logger.error('[Server] Banco de dados inacessível. Verifique DATABASE_URL no .env');
    process.exit(1);
  }

  logger.info('[Server] Conexão com banco de dados verificada ✓');

  server.listen(PORT, HOST, () => {
    logger.info(`[Server] Rodando em http://${HOST}:${PORT}`);
    logger.info(`[Server] Ambiente: ${process.env.NODE_ENV ?? 'development'}`);
    logger.info(`[Server] Health:   http://localhost:${PORT}/health`);
    logger.info(`[Server] API:      http://localhost:${PORT}/api/v1`);
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

process.on('uncaughtException', (err: Error) => {
  logger.error('[Server] uncaughtException:', { name: err.name, message: err.message });
  shutdown('uncaughtException');
});

process.on('unhandledRejection', (reason: unknown) => {
  logger.error('[Server] unhandledRejection:', { reason });
  shutdown('unhandledRejection');
});

start();

export { server };
