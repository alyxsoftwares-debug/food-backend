/**
 * @file supabase.ts
 * @description Conexão com Supabase + pool nativo PostgreSQL.
 * CORREÇÃO: Removida opção db.schema que causava erro de tipagem no TS.
 * O search_path é definido via pgPool.on('connect').
 */

import { createClient, SupabaseClient } from '@supabase/supabase-js';
import { Pool, PoolClient }             from 'pg';

// ---------------------------------------------------------------------------
// Validação de variáveis de ambiente
// ---------------------------------------------------------------------------

const REQUIRED_ENV_VARS = [
  'SUPABASE_URL',
  'SUPABASE_SERVICE_ROLE_KEY',
  'SUPABASE_ANON_KEY',
  'DATABASE_URL',
] as const;

function validateEnv(): void {
  const missing = REQUIRED_ENV_VARS.filter((key) => !process.env[key]);
  if (missing.length > 0) {
    throw new Error(
      `[Config] Variáveis de ambiente obrigatórias não encontradas: ${missing.join(', ')}.`,
    );
  }
}

validateEnv();

const SUPABASE_URL              = process.env.SUPABASE_URL!;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const SUPABASE_ANON_KEY         = process.env.SUPABASE_ANON_KEY!;
const DATABASE_URL              = process.env.DATABASE_URL!;

// ---------------------------------------------------------------------------
// Opções base dos clients
// Sem 'db.schema' — causava incompatibilidade de tipos no TS strict
// O schema "food" é ativado via search_path no pgPool.on('connect')
// ---------------------------------------------------------------------------

const SUPABASE_OPTIONS = {
  auth: {
    autoRefreshToken  : false,
    persistSession    : false,
    detectSessionInUrl: false,
  },
  global: {
    headers: {
      'x-application-name': 'food-saas-backend',
    },
  },
};

// ---------------------------------------------------------------------------
// Client ADMIN (service_role) — ignora RLS
// ---------------------------------------------------------------------------

let _supabaseAdmin: SupabaseClient | null = null;

export function getSupabaseAdmin(): SupabaseClient {
  if (!_supabaseAdmin) {
    _supabaseAdmin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, SUPABASE_OPTIONS);
  }
  return _supabaseAdmin;
}

export const supabaseAdmin: SupabaseClient = getSupabaseAdmin();

// ---------------------------------------------------------------------------
// Client PÚBLICO (anon_key) — respeita RLS
// ---------------------------------------------------------------------------

let _supabaseClient: SupabaseClient | null = null;

export function getSupabaseClient(): SupabaseClient {
  if (!_supabaseClient) {
    _supabaseClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, SUPABASE_OPTIONS);
  }
  return _supabaseClient;
}

export const supabaseClient: SupabaseClient = getSupabaseClient();

// ---------------------------------------------------------------------------
// Pool nativo PostgreSQL
// ---------------------------------------------------------------------------

// Remove os parâmetros da URL (como ?sslmode=require) para que não sobrescrevam a regra de SSL abaixo
const cleanDbUrl = DATABASE_URL.split('?')[0];

export const pgPool = new Pool({
  connectionString       : cleanDbUrl,
  max                    : 20,
  min                    : 2,
  idleTimeoutMillis      : 30_000,
  connectionTimeoutMillis: 5_000,
  application_name       : 'food-saas-backend',
  ssl                    : { rejectUnauthorized: false },
});

pgPool.on('connect', (client: PoolClient) => {
  // Define search_path para o schema food em cada nova conexão
  client.query('SET search_path TO food, public').catch((err) => {
    console.error('[PgPool] Falha ao definir search_path:', (err as Error).message);
  });
});

pgPool.on('error', (err: Error) => {
  console.error('[PgPool] Erro inesperado em cliente ocioso:', err.message);
});

// ---------------------------------------------------------------------------
// Health Check
// ---------------------------------------------------------------------------

export async function checkDatabaseHealth(): Promise<boolean> {
  let client: PoolClient | null = null;
  try {
    client = await pgPool.connect();
    await client.query('SELECT 1');
    return true;
  } catch (error) {
    console.error('[Database] Health check falhou:', (error as Error).message);
    return false;
  } finally {
    client?.release();
  }
}

// ---------------------------------------------------------------------------
// Graceful Shutdown
// ---------------------------------------------------------------------------

export async function closeDatabaseConnection(): Promise<void> {
  try {
    await pgPool.end();
    console.info('[Database] Pool encerrado com sucesso.');
  } catch (error) {
    console.error('[Database] Erro ao encerrar pool:', (error as Error).message);
  }
}

// ---------------------------------------------------------------------------
// Transações
// ---------------------------------------------------------------------------

export async function withTransaction<T>(
  fn: (client: PoolClient) => Promise<T>,
): Promise<T> {
  const client = await pgPool.connect();
  try {
    await client.query('BEGIN');
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}
