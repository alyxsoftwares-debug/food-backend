/**
 * @file authenticate.ts
 * @description Middlewares de autenticação JWT via Supabase Auth.
 * CORREÇÃO: Alinhados nomes das colunas do SELECT com os tipos usados no código.
 */

import { Request, Response, NextFunction } from 'express';
import { supabaseAdmin, pgPool }           from '@/config/supabase';
import { AppError, ErrorCode }             from '@/errors/AppError';
import { createRequestLogger }             from '@/config/logger';
import type { AuthUser, AuthCompany }      from '@/types/auth.types';

// ---------------------------------------------------------------------------
// Augmentação de tipos do Express
// ---------------------------------------------------------------------------

declare global {
  namespace Express {
    interface Request {
      id        : string;
      user      : AuthUser;
      company   : AuthCompany;
      tableToken?: string;
    }
  }
}

// ---------------------------------------------------------------------------
// Cache em memória (TTL: 30s)
// ---------------------------------------------------------------------------

interface CacheEntry<T> {
  data      : T;
  expiresAt : number;
}

const userCache    = new Map<string, CacheEntry<AuthUser>>();
const companyCache = new Map<string, CacheEntry<AuthCompany>>();
const CACHE_TTL_MS = 30_000;

function getCached<T>(cache: Map<string, CacheEntry<T>>, key: string): T | null {
  const entry = cache.get(key);
  if (!entry) return null;
  if (Date.now() > entry.expiresAt) { cache.delete(key); return null; }
  return entry.data;
}

function setCache<T>(cache: Map<string, CacheEntry<T>>, key: string, data: T): void {
  cache.set(key, { data, expiresAt: Date.now() + CACHE_TTL_MS });
}

setInterval(() => {
  const now = Date.now();
  for (const [k, e] of userCache)    { if (now > e.expiresAt) userCache.delete(k); }
  for (const [k, e] of companyCache) { if (now > e.expiresAt) companyCache.delete(k); }
}, 60_000);

// ---------------------------------------------------------------------------
// Helper: extrai Bearer token
// ---------------------------------------------------------------------------

function extractBearerToken(req: Request): string | null {
  const header = req.headers.authorization;
  if (!header?.startsWith('Bearer ')) return null;
  const token = header.slice(7).trim();
  return token.length > 0 ? token : null;
}

// ---------------------------------------------------------------------------
// Tipo da linha retornada pelo SELECT
// ---------------------------------------------------------------------------

interface UserRow {
  id              : string;
  company_id      : string;
  name            : string;
  email           : string;
  role            : string;
  user_status     : string;   // aliased em: u.status AS user_status
  permissions     : Record<string, boolean>;
  company_status  : string;
  company_plan    : string;
  company_name    : string;
  company_slug    : string;
}

// ---------------------------------------------------------------------------
// Helper: busca usuário interno e empresa no banco
// ---------------------------------------------------------------------------

async function fetchUserAndCompany(
  authUserId: string,
  log: ReturnType<typeof createRequestLogger>,
): Promise<{ user: AuthUser; company: AuthCompany }> {
  const cachedUser    = getCached(userCache, authUserId);
  const cachedCompany = cachedUser ? getCached(companyCache, cachedUser.companyId) : null;
  if (cachedUser && cachedCompany) return { user: cachedUser, company: cachedCompany };

  const { rows } = await pgPool.query<UserRow>(
    `SELECT
       u.id,
       u.company_id,
       u.name,
       u.email,
       u.role,
       u.status        AS user_status,
       u.permissions,
       c.status        AS company_status,
       c.plan          AS company_plan,
       c.name          AS company_name,
       c.slug          AS company_slug
     FROM food.users u
     JOIN food.companies c ON c.id = u.company_id
     WHERE u.auth_user_id = $1
     LIMIT 1`,
    [authUserId],
  );

  if (rows.length === 0) {
    log.warn('auth_user_id não encontrado em food.users', { authUserId });
    throw new AppError('Usuário não encontrado.', 404, ErrorCode.USER_NOT_FOUND);
  }

  const row = rows[0];

  if (row.user_status !== 'active') {
    throw new AppError('Conta inativa ou suspensa.', 403, ErrorCode.USER_INACTIVE);
  }
  if (row.company_status === 'suspended') {
    throw new AppError('Empresa suspensa.', 403, ErrorCode.COMPANY_SUSPENDED);
  }
  if (row.company_status !== 'active') {
    throw new AppError('Empresa inativa.', 403, ErrorCode.COMPANY_INACTIVE);
  }

  const user: AuthUser = {
    id         : row.id,
    companyId  : row.company_id,
    name       : row.name,
    email      : row.email,
    role       : row.role as AuthUser['role'],
    permissions: row.permissions ?? {},
  };

  const company: AuthCompany = {
    id    : row.company_id,
    name  : row.company_name,
    slug  : row.company_slug,
    plan  : row.company_plan,
    status: row.company_status,
  };

  setCache(userCache,    authUserId,     user);
  setCache(companyCache, user.companyId, company);

  return { user, company };
}

// ---------------------------------------------------------------------------
// Middleware: authenticate
// ---------------------------------------------------------------------------

export async function authenticate(
  req  : Request,
  _res : Response,
  next : NextFunction,
): Promise<void> {
  const log = createRequestLogger(req.id);
  try {
    const token = extractBearerToken(req);
    if (!token) {
      throw new AppError('Token de autenticação não fornecido.', 401, ErrorCode.UNAUTHORIZED);
    }

    const { data: { user: supabaseUser }, error } =
      await supabaseAdmin.auth.getUser(token);

    if (error || !supabaseUser) {
      const isExpired = error?.message?.toLowerCase().includes('expired');
      throw new AppError(
        isExpired ? 'Sessão expirada. Faça login novamente.' : 'Token inválido.',
        401,
        isExpired ? ErrorCode.TOKEN_EXPIRED : ErrorCode.TOKEN_INVALID,
      );
    }

    const { user, company } = await fetchUserAndCompany(supabaseUser.id, log);
    req.user    = user;
    req.company = company;

    log.debug('Autenticado', { userId: user.id, companyId: user.companyId, role: user.role });
    next();
  } catch (error) {
    next(error);
  }
}

// ---------------------------------------------------------------------------
// Middleware: authenticateOptional
// ---------------------------------------------------------------------------

export async function authenticateOptional(
  req  : Request,
  _res : Response,
  next : NextFunction,
): Promise<void> {
  const log = createRequestLogger(req.id);
  try {
    const token = extractBearerToken(req);
    if (!token) return next();

    const { data: { user: supabaseUser }, error } =
      await supabaseAdmin.auth.getUser(token);
    if (error || !supabaseUser) return next();

    const { user, company } = await fetchUserAndCompany(supabaseUser.id, log);
    req.user    = user;
    req.company = company;
  } catch {
    // Silencioso — não bloqueia a rota
  }
  next();
}

// ---------------------------------------------------------------------------
// Middleware: authenticateQR (token de mesa)
// ---------------------------------------------------------------------------

interface TableRow {
  table_id       : string;
  table_identifier: string;
  table_status   : string;
  company_id     : string;
  company_name   : string;
  company_slug   : string;
  company_plan   : string;
  company_status : string;
}

export async function authenticateQR(
  req  : Request,
  _res : Response,
  next : NextFunction,
): Promise<void> {
  const log = createRequestLogger(req.id);
  try {
    const token =
      (req.headers['x-table-token'] as string) ??
      (req.query.token as string);

    if (!token) {
      throw new AppError('Token de mesa não fornecido.', 401, ErrorCode.UNAUTHORIZED);
    }

    const { rows } = await pgPool.query<TableRow>(
      `SELECT
         t.id           AS table_id,
         t.identifier   AS table_identifier,
         t.status       AS table_status,
         c.id           AS company_id,
         c.name         AS company_name,
         c.slug         AS company_slug,
         c.plan         AS company_plan,
         c.status       AS company_status
       FROM food.tables t
       JOIN food.companies c ON c.id = t.company_id
       WHERE t.qr_code_token = $1 AND t.is_active = TRUE
       LIMIT 1`,
      [token],
    );

    if (rows.length === 0) {
      throw new AppError('QR Code inválido ou mesa não encontrada.', 401, ErrorCode.TABLE_QR_INVALID);
    }

    const row = rows[0];

    if (row.company_status !== 'active') {
      throw new AppError('Estabelecimento não disponível.', 403, ErrorCode.COMPANY_INACTIVE);
    }
    if (row.table_status === 'maintenance') {
      throw new AppError('Mesa em manutenção.', 403, ErrorCode.TABLE_UNAVAILABLE);
    }

    req.tableToken = token;
    req.company    = {
      id    : row.company_id,
      name  : row.company_name,
      slug  : row.company_slug,
      plan  : row.company_plan,
      status: row.company_status,
    };

    (req as Request & { table: unknown }).table = {
      id        : row.table_id,
      identifier: row.table_identifier,
      status    : row.table_status,
    };

    log.debug('QR Code validado', { tableId: row.table_id });
    next();
  } catch (error) {
    next(error);
  }
}
