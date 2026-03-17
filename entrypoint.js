/**
 * entrypoint.js — Wrapper em JS puro para capturar erros de módulo.
 * Este arquivo DEVE ser .js (não .ts) para garantir que os handlers
 * sejam registrados ANTES do require() do código compilado.
 */

// 1. Registra handlers ANTES de qualquer require()
process.on('uncaughtException', (err) => {
  console.error('[FATAL] uncaughtException:', err.message);
  console.error(err.stack);
  process.exit(1);
});

process.on('unhandledRejection', (reason) => {
  console.error('[FATAL] unhandledRejection:', reason);
  process.exit(1);
});

// 2. Diagnóstico — aparece nos logs do Render
console.log('[Entrypoint] ====== INICIANDO ======');
console.log('[Entrypoint] NODE_ENV      :', process.env.NODE_ENV);
console.log('[Entrypoint] PORT          :', process.env.PORT);
console.log('[Entrypoint] SUPABASE_URL  :', !!process.env.SUPABASE_URL);
console.log('[Entrypoint] DATABASE_URL  :', !!process.env.DATABASE_URL);
console.log('[Entrypoint] SUPABASE_ANON :', !!process.env.SUPABASE_ANON_KEY);
console.log('[Entrypoint] SUPABASE_SVC  :', !!process.env.SUPABASE_SERVICE_ROLE_KEY);
console.log('[Entrypoint] REDIS_URL     :', !!process.env.REDIS_URL);
console.log('[Entrypoint] ALLOWED_ORIGINS:', !!process.env.ALLOWED_ORIGINS);
console.log('[Entrypoint] ========================');

// 3. Registra os module aliases (@/ → dist/)
require('module-alias/register');

// 4. Carrega o servidor compilado — qualquer erro aqui será capturado acima
console.log('[Entrypoint] Carregando dist/server.js...');
require('./dist/server.js');