/**
 * @file auth.types.ts
 * @description Tipos TypeScript para o contexto de autenticação e autorização.
 * Importados pelos middlewares, controllers e services.
 *
 * @module types/auth.types
 */

// ---------------------------------------------------------------------------
// Roles
// ---------------------------------------------------------------------------

export type UserRole =
  | 'owner'
  | 'admin'
  | 'manager'
  | 'cashier'
  | 'waiter'
  | 'kitchen';

// ---------------------------------------------------------------------------
// Permissões granulares
// Chaves no formato `recurso:ação`
// ---------------------------------------------------------------------------

export type Permission =
  // Pedidos
  | 'orders:view'
  | 'orders:create'
  | 'orders:edit'
  | 'orders:cancel'
  | 'orders:print'
  // Produtos & Cardápio
  | 'products:view'
  | 'products:create'
  | 'products:edit'
  | 'products:delete'
  | 'categories:view'
  | 'categories:create'
  | 'categories:edit'
  | 'categories:delete'
  // Mesas
  | 'tables:view'
  | 'tables:manage'
  // Clientes
  | 'customers:view'
  | 'customers:edit'
  // Relatórios
  | 'reports:view'
  | 'reports:export'
  // Configurações
  | 'settings:view'
  | 'settings:edit'
  // Usuários
  | 'users:view'
  | 'users:create'
  | 'users:edit'
  | 'users:delete'
  // Financeiro
  | 'financial:view'
  | 'financial:edit'
  // Impressoras
  | 'printers:manage';

// ---------------------------------------------------------------------------
// AuthUser — Contexto do usuário injetado no req pelo middleware authenticate
// ---------------------------------------------------------------------------

export interface AuthUser {
  id          : string;
  companyId   : string;
  name        : string;
  email       : string;
  role        : UserRole;
  permissions : Partial<Record<Permission, boolean>>;
}

// ---------------------------------------------------------------------------
// AuthCompany — Contexto da empresa (tenant) injetado no req
// ---------------------------------------------------------------------------

export interface AuthCompany {
  id    : string;
  name  : string;
  slug  : string;
  plan  : string;
  status: string;
}

// ---------------------------------------------------------------------------
// Permissões padrão por role (usadas ao criar novos usuários)
// ---------------------------------------------------------------------------

export const DEFAULT_PERMISSIONS_BY_ROLE: Record<
  UserRole,
  Partial<Record<Permission, boolean>>
> = {
  owner: {}, // Owner tem tudo implicitamente — permissions ignoradas

  admin: {}, // Admin tem tudo implicitamente — permissions ignoradas

  manager: {
    'orders:view'       : true,
    'orders:create'     : true,
    'orders:edit'       : true,
    'orders:cancel'     : true,
    'orders:print'      : true,
    'products:view'     : true,
    'products:create'   : true,
    'products:edit'     : true,
    'categories:view'   : true,
    'categories:create' : true,
    'categories:edit'   : true,
    'tables:view'       : true,
    'tables:manage'     : true,
    'customers:view'    : true,
    'customers:edit'    : true,
    'reports:view'      : true,
    'settings:view'     : true,
    'users:view'        : true,
    'financial:view'    : true,
    'printers:manage'   : true,
  },

  cashier: {
    'orders:view'   : true,
    'orders:create' : true,
    'orders:edit'   : true,
    'orders:print'  : true,
    'products:view' : true,
    'categories:view': true,
    'tables:view'   : true,
    'customers:view': true,
    'customers:edit': true,
  },

  waiter: {
    'orders:view'   : true,
    'orders:create' : true,
    'products:view' : true,
    'categories:view': true,
    'tables:view'   : true,
    'customers:view': true,
  },

  kitchen: {
    'orders:view' : true,
    'orders:edit' : true,   // Apenas para atualizar status (preparing → ready)
    'orders:print': true,
  },
};
