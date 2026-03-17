/**
 * @file authorize.ts
 * @description Middlewares de autorização baseados em roles e permissões.
 *
 * Deve ser usado APÓS o middleware `authenticate`, que popula `req.user`.
 *
 * Dois modelos de controle de acesso:
 *
 *  1. RBAC (Role-Based Access Control)
 *     Controla acesso por cargo do usuário (owner, admin, manager, etc.)
 *     Ex: authorize('owner', 'admin') → apenas owners e admins passam.
 *
 *  2. Permissões granulares (PBAC — Permission-Based Access Control)
 *     Permissões específicas armazenadas em `users.permissions` (JSONB).
 *     Ex: can('orders:cancel') → usuário precisa ter essa permissão explícita
 *     OU ter um role com acesso total (owner, admin).
 *
 * Hierarquia de roles (do mais ao menos privilegiado):
 *  owner > admin > manager > cashier > waiter > kitchen
 *
 * @module middlewares/authorize
 */

import { Request, Response, NextFunction } from 'express';
import { AppError, ErrorCode }             from '@/errors/AppError';
import type { UserRole }                   from '@/types/auth.types';

// ---------------------------------------------------------------------------
// Hierarquia de roles
// Usado para verificações do tipo "role mínimo necessário".
// ---------------------------------------------------------------------------

const ROLE_HIERARCHY: Record<UserRole, number> = {
  owner  : 100,
  admin  : 80,
  manager: 60,
  cashier: 40,
  waiter : 30,
  kitchen: 20,
};

// Roles com acesso administrativo total — ignoram verificações granulares
const ADMIN_ROLES: UserRole[] = ['owner', 'admin'];

// ---------------------------------------------------------------------------
// Middleware Factory: authorize (RBAC)
// ---------------------------------------------------------------------------

/**
 * Restringe o acesso a usuários que possuam pelo menos um dos roles listados.
 *
 * @param roles - Um ou mais roles permitidos para acessar a rota.
 *
 * @example
 * // Apenas owners e admins podem deletar categorias
 * router.delete('/categories/:id', authenticate, authorize('owner', 'admin'), handler);
 *
 * @example
 * // Managers, admins e owners podem ver relatórios
 * router.get('/reports', authenticate, authorize('manager', 'admin', 'owner'), handler);
 */
export function authorize(...roles: UserRole[]) {
  return (req: Request, _res: Response, next: NextFunction): void => {
    if (!req.user) {
      return next(
        new AppError('Autenticação necessária.', 401, ErrorCode.UNAUTHORIZED),
      );
    }

    const hasRole = roles.includes(req.user.role);

    if (!hasRole) {
      return next(
        new AppError(
          `Acesso negado. Cargo necessário: ${roles.join(' ou ')}.`,
          403,
          ErrorCode.INSUFFICIENT_ROLE,
          { required: roles, current: req.user.role },
        ),
      );
    }

    next();
  };
}

// ---------------------------------------------------------------------------
// Middleware Factory: authorizeMinRole
// Autoriza o role informado E todos os roles acima na hierarquia.
// ---------------------------------------------------------------------------

/**
 * Autoriza o role mínimo informado e todos os roles acima na hierarquia.
 *
 * @param minRole - Role mínimo necessário para acessar a rota.
 *
 * @example
 * // Managers, admins e owners podem atualizar pedidos
 * router.patch('/orders/:id', authenticate, authorizeMinRole('manager'), handler);
 */
export function authorizeMinRole(minRole: UserRole) {
  return (req: Request, _res: Response, next: NextFunction): void => {
    if (!req.user) {
      return next(
        new AppError('Autenticação necessária.', 401, ErrorCode.UNAUTHORIZED),
      );
    }

    const userLevel    = ROLE_HIERARCHY[req.user.role]    ?? 0;
    const requiredLevel = ROLE_HIERARCHY[minRole] ?? 0;

    if (userLevel < requiredLevel) {
      return next(
        new AppError(
          `Acesso negado. Cargo mínimo necessário: ${minRole}.`,
          403,
          ErrorCode.INSUFFICIENT_ROLE,
          {
            requiredRole : minRole,
            currentRole  : req.user.role,
            requiredLevel,
            currentLevel : userLevel,
          },
        ),
      );
    }

    next();
  };
}

// ---------------------------------------------------------------------------
// Middleware Factory: can (PBAC — Permission-Based)
// ---------------------------------------------------------------------------

/**
 * Verifica se o usuário possui uma permissão granular específica.
 *
 * Owners e Admins têm todas as permissões implicitamente.
 * Outros roles precisam da permissão explícita em `users.permissions`.
 *
 * Formato das permissões no JSONB:
 * {
 *   "orders:view"    : true,
 *   "orders:cancel"  : true,
 *   "products:edit"  : false,
 *   "reports:view"   : true
 * }
 *
 * Convenção de nomenclatura: `<recurso>:<ação>`
 * Recursos: orders, products, categories, tables, customers, reports, settings, users
 * Ações: view, create, edit, delete, cancel, print, export
 *
 * @param permission - Permissão no formato `recurso:ação`.
 *
 * @example
 * router.delete('/orders/:id', authenticate, can('orders:cancel'), handler);
 * router.get('/reports', authenticate, can('reports:view'), handler);
 */
export function can(permission: string) {
  return (req: Request, _res: Response, next: NextFunction): void => {
    if (!req.user) {
      return next(
        new AppError('Autenticação necessária.', 401, ErrorCode.UNAUTHORIZED),
      );
    }

    // Owners e admins têm acesso irrestrito
    if (ADMIN_ROLES.includes(req.user.role)) {
      return next();
    }

    // Verifica a permissão granular no JSONB
    const hasPermission = req.user.permissions?.[permission] === true;

    if (!hasPermission) {
      return next(
        new AppError(
          `Acesso negado. Permissão necessária: ${permission}.`,
          403,
          ErrorCode.FORBIDDEN,
          { permission },
        ),
      );
    }

    next();
  };
}

// ---------------------------------------------------------------------------
// Middleware Factory: canAny
// Passa se o usuário tiver QUALQUER uma das permissões listadas.
// ---------------------------------------------------------------------------

/**
 * Autoriza se o usuário tiver pelo menos uma das permissões informadas.
 *
 * @example
 * // Usuário precisa poder criar OU editar para acessar
 * router.post('/products', authenticate, canAny('products:create', 'products:edit'), handler);
 */
export function canAny(...permissions: string[]) {
  return (req: Request, _res: Response, next: NextFunction): void => {
    if (!req.user) {
      return next(
        new AppError('Autenticação necessária.', 401, ErrorCode.UNAUTHORIZED),
      );
    }

    if (ADMIN_ROLES.includes(req.user.role)) return next();

    const hasAny = permissions.some(
      (p) => req.user.permissions?.[p] === true,
    );

    if (!hasAny) {
      return next(
        new AppError(
          `Acesso negado. Necessária uma das permissões: ${permissions.join(', ')}.`,
          403,
          ErrorCode.FORBIDDEN,
          { permissions },
        ),
      );
    }

    next();
  };
}

// ---------------------------------------------------------------------------
// Middleware Factory: canAll
// Passa somente se o usuário tiver TODAS as permissões listadas.
// ---------------------------------------------------------------------------

/**
 * Autoriza somente se o usuário tiver todas as permissões informadas.
 *
 * @example
 * router.post('/reports/export', authenticate, canAll('reports:view', 'reports:export'), handler);
 */
export function canAll(...permissions: string[]) {
  return (req: Request, _res: Response, next: NextFunction): void => {
    if (!req.user) {
      return next(
        new AppError('Autenticação necessária.', 401, ErrorCode.UNAUTHORIZED),
      );
    }

    if (ADMIN_ROLES.includes(req.user.role)) return next();

    const missing = permissions.filter(
      (p) => req.user.permissions?.[p] !== true,
    );

    if (missing.length > 0) {
      return next(
        new AppError(
          `Acesso negado. Permissões faltando: ${missing.join(', ')}.`,
          403,
          ErrorCode.FORBIDDEN,
          { missing },
        ),
      );
    }

    next();
  };
}

// ---------------------------------------------------------------------------
// Middleware: isSelf
// Garante que o usuário só acesse/modifique seu próprio recurso,
// a menos que seja owner/admin.
// ---------------------------------------------------------------------------

/**
 * Permite acesso apenas ao próprio recurso do usuário, ou a owners/admins.
 * O `req.params` deve conter o parâmetro com o ID do usuário alvo.
 *
 * @param paramName - Nome do parâmetro de rota com o ID do usuário (default: 'userId').
 *
 * @example
 * // Usuário pode ver/editar apenas seu próprio perfil (admins podem ver qualquer um)
 * router.get('/users/:userId', authenticate, isSelf(), handler);
 */
export function isSelf(paramName = 'userId') {
  return (req: Request, _res: Response, next: NextFunction): void => {
    if (!req.user) {
      return next(
        new AppError('Autenticação necessária.', 401, ErrorCode.UNAUTHORIZED),
      );
    }

    if (ADMIN_ROLES.includes(req.user.role)) return next();

    const targetId = req.params[paramName];

    if (!targetId || req.user.id !== targetId) {
      return next(
        new AppError(
          'Você só pode acessar seus próprios dados.',
          403,
          ErrorCode.FORBIDDEN,
        ),
      );
    }

    next();
  };
}

// ---------------------------------------------------------------------------
// Utilitário: hasRole (uso programático fora de middlewares)
// ---------------------------------------------------------------------------

/**
 * Verifica programaticamente se um usuário possui determinado role.
 * Útil dentro de services e controllers para lógica condicional.
 *
 * @example
 * if (hasRole(req.user, 'manager', 'owner')) {
 *   // lógica exclusiva para managers e owners
 * }
 */
export function hasRole(
  user : { role: UserRole },
  ...roles: UserRole[]
): boolean {
  return roles.includes(user.role);
}

/**
 * Verifica programaticamente se um usuário possui um role mínimo.
 *
 * @example
 * if (hasMinRole(req.user, 'manager')) {
 *   // manager, admin e owner passam
 * }
 */
export function hasMinRole(
  user    : { role: UserRole },
  minRole : UserRole,
): boolean {
  return (ROLE_HIERARCHY[user.role] ?? 0) >= (ROLE_HIERARCHY[minRole] ?? 0);
}
