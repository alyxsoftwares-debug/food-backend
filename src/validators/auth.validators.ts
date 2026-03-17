/**
 * @file auth.validators.ts
 * @description Schemas de validação Zod para todas as rotas de autenticação.
 *
 * Cada schema valida o `req.body` antes de chegar ao controller.
 * O middleware `validate` (em middlewares/validate.ts) aplica os schemas
 * e retorna 422 com os erros formatados caso a validação falhe.
 *
 * @module validators/auth
 */

import { z } from 'zod';

// ---------------------------------------------------------------------------
// Regras reutilizáveis
// ---------------------------------------------------------------------------

const emailField = z
  .string({ required_error: 'E-mail é obrigatório.' })
  .email('E-mail inválido.')
  .max(255, 'E-mail muito longo.')
  .transform((v) => v.toLowerCase().trim());

const passwordField = z
  .string({ required_error: 'Senha é obrigatória.' })
  .min(8, 'A senha deve ter no mínimo 8 caracteres.')
  .max(128, 'A senha não pode ter mais de 128 caracteres.');

// ---------------------------------------------------------------------------
// loginSchema
// POST /auth/login
// ---------------------------------------------------------------------------

export const loginSchema = z.object({
  body: z.object({
    email   : emailField,
    password: z
      .string({ required_error: 'Senha é obrigatória.' })
      .min(1, 'Senha é obrigatória.'),
  }),
});

// ---------------------------------------------------------------------------
// refreshTokenSchema
// POST /auth/refresh
// ---------------------------------------------------------------------------

export const refreshTokenSchema = z.object({
  body: z.object({
    refreshToken: z
      .string({ required_error: 'refreshToken é obrigatório.' })
      .min(1, 'refreshToken não pode ser vazio.'),
  }),
});

// ---------------------------------------------------------------------------
// forgotPasswordSchema
// POST /auth/forgot-password
// ---------------------------------------------------------------------------

export const forgotPasswordSchema = z.object({
  body: z.object({
    email: emailField,
  }),
});

// ---------------------------------------------------------------------------
// resetPasswordSchema
// POST /auth/reset-password
// ---------------------------------------------------------------------------

export const resetPasswordSchema = z.object({
  body: z
    .object({
      token          : z.string({ required_error: 'Token é obrigatório.' }).min(1),
      newPassword    : passwordField,
      confirmPassword: z.string({ required_error: 'Confirmação de senha é obrigatória.' }),
    })
    .refine((data) => data.newPassword === data.confirmPassword, {
      message: 'As senhas não coincidem.',
      path   : ['confirmPassword'],
    }),
});

// ---------------------------------------------------------------------------
// changePasswordSchema
// POST /auth/change-password
// ---------------------------------------------------------------------------

export const changePasswordSchema = z.object({
  body: z
    .object({
      currentPassword: z
        .string({ required_error: 'Senha atual é obrigatória.' })
        .min(1, 'Senha atual é obrigatória.'),
      newPassword    : passwordField,
      confirmPassword: z.string({ required_error: 'Confirmação de senha é obrigatória.' }),
    })
    .refine((data) => data.newPassword === data.confirmPassword, {
      message: 'As senhas não coincidem.',
      path   : ['confirmPassword'],
    })
    .refine((data) => data.currentPassword !== data.newPassword, {
      message: 'A nova senha não pode ser igual à senha atual.',
      path   : ['newPassword'],
    }),
});

// ---------------------------------------------------------------------------
// validatePinSchema
// POST /auth/validate-pin
// ---------------------------------------------------------------------------

export const validatePinSchema = z.object({
  body: z.object({
    pin: z
      .string({ required_error: 'PIN é obrigatório.' })
      .min(4, 'O PIN deve ter entre 4 e 6 dígitos.')
      .max(6, 'O PIN deve ter entre 4 e 6 dígitos.')
      .regex(/^\d+$/, 'O PIN deve conter apenas números.'),
  }),
});

// ---------------------------------------------------------------------------
// Tipos inferidos dos schemas (uso nos controllers/services)
// ---------------------------------------------------------------------------

export type LoginInput          = z.infer<typeof loginSchema>['body'];
export type RefreshTokenInput   = z.infer<typeof refreshTokenSchema>['body'];
export type ForgotPasswordInput = z.infer<typeof forgotPasswordSchema>['body'];
export type ResetPasswordInput  = z.infer<typeof resetPasswordSchema>['body'];
export type ChangePasswordInput = z.infer<typeof changePasswordSchema>['body'];
export type ValidatePinInput    = z.infer<typeof validatePinSchema>['body'];
