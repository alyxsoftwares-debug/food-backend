/**
 * @file authorize.ts
 * @description Middlewares de autorização baseados em RBAC (Role-Based Access Control)
 * e permissões granulares. Exige que o middleware `authenticate` tenha rodado antes.
 */

import { Request, Response, NextFunction } from 'express';
import { AppError, ErrorCode } from '@/errors/AppError';
import type { UserRole, Permission } from '@/types/auth.types';

// ---------------------------------------------------------------------------
// Hierarquia e Mapas
// ---------------------------------------------------------------------------

const ROLE_HIERARCHY: Record<UserRole, number> = {
  owner   : 40,
  admin   : 30,
  manager : 20,
  cashier : 10,
  waiter  : 5,
  kitchen : 2,
};

// ---------------------------------------------------------------------------
// Middlewares Principais
// ---------------------------------------------------------------------------

/**
 * Valida se o usuário tem a role exata necessária.
 * @example router.delete('/users/:id', authorizeRole('admin'), ctrl.delete);
 */
export function authorizeRole(...allowedRoles: UserRole[]) {
  return (req: Request, _res: Response, next: NextFunction): void => {
    if (!req.user) {
      return next(new AppError('Não autenticado.', 401, ErrorCode.UNAUTHORIZED));
    }

    if (!allowedRoles.includes(req.user.role)) {
      return next(
        new AppError(
          'Você não tem o perfil necessário para acessar este recurso.',
          403,
          ErrorCode.FORBIDDEN
        )
      );
    }

    next();
  };
}

/**
 * Valida se o usuário tem a role mínima (hierarquia).
 * Ex: Se pedir 'manager' (20), 'admin' (30) e 'owner' (40) também passam.
 * @example router.get('/dashboard', authorizeMinRole('manager'), ctrl.dashboard);
 */
export function authorizeMinRole(minRole: UserRole) {
  return (req: Request, _res: Response, next: NextFunction): void => {
    if (!req.user) {
      return next(new AppError('Não autenticado.', 401, ErrorCode.UNAUTHORIZED));
    }

    const userLevel = ROLE_HIERARCHY[req.user.role] ?? 0;
    const reqLevel  = ROLE_HIERARCHY[minRole] ?? 999;

    if (userLevel < reqLevel) {
      return next(
        new AppError(
          `Acesso negado. Nível mínimo exigido: ${minRole}.`,
          403,
          ErrorCode.FORBIDDEN
        )
      );
    }

    next();
  };
}

/**
 * Valida se o usuário tem as permissões granulares necessárias.
 * Funciona com lógica E (AND) ou OU (OR).
 * Se o usuário for 'owner' ou 'admin', passa automaticamente.
 * * @example
 * // Exige ambas as permissões (padrão)
 * authorizePermission(['view_reports', 'export_data'])
 * * // Exige pelo menos uma das permissões
 * authorizePermission(['refund_order', 'cancel_order'], 'OR')
 */
export function authorizePermission(
  permissions: Permission | Permission[],
  condition: 'AND' | 'OR' = 'AND'
) {
  return (req: Request, _res: Response, next: NextFunction): void => {
    if (!req.user) {
      return next(new AppError('Não autenticado.', 401, ErrorCode.UNAUTHORIZED));
    }

    // Owner e Admin têm bypass de permissões granulares
    if (req.user.role === 'owner' || req.user.role === 'admin') {
      return next();
    }

    const requiredPerms = Array.isArray(permissions) ? permissions : [permissions];
    const userPerms     = req.user.permissions || {};

    let hasAccess = false;

    if (condition === 'AND') {
      hasAccess = requiredPerms.every((perm) => userPerms[perm as keyof typeof userPerms] === true);
    } else {
      hasAccess = requiredPerms.some((perm) => userPerms[perm as keyof typeof userPerms] === true);
    }

    if (!hasAccess) {
      return next(
        new AppError(
          'Você não possui permissão específica para realizar esta ação.',
          403,
          ErrorCode.FORBIDDEN
        )
      );
    }

    next();
  };
}

/**
 * Função utilitária (alias) para simplificar a sintaxe de verificação
 * Ex: authorize('owner', 'admin') é o mesmo que authorizeRole('owner', 'admin')
 */
export const authorize = authorizeRole;

// ============================================================================
// Funções Utilitárias para verificação dentro dos controllers (se necessário)
// ============================================================================

export function checkHasRole(userRole: UserRole, allowedRoles: UserRole[]): boolean {
  return allowedRoles.includes(userRole);
}

export function checkHasMinRole(userRole: UserRole, minRole: UserRole): boolean {
  const userLevel = ROLE_HIERARCHY[userRole] ?? 0;
  const reqLevel  = ROLE_HIERARCHY[minRole] ?? 999;
  return userLevel >= reqLevel;
}