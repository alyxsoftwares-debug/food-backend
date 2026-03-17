/**
 * @file auth.routes.ts
 * @description Rotas de autenticação — login, refresh, logout e senha.
 *
 * Todas as rotas deste módulo são públicas (sem middleware authenticate),
 * pois o objetivo delas É gerar o token de acesso.
 *
 * O rate limiter `authLimiter` (10 req / 15min por IP) já é aplicado
 * no roteador raiz antes de chegar aqui.
 *
 * @module routes/auth
 */

import { Router }          from 'express';
import { AuthController }  from '@/controllers/auth.controller';
import { validate }        from '@/middlewares/validate';
import { authenticate }    from '@/middlewares/authenticate';
import {
  loginSchema,
  refreshTokenSchema,
  forgotPasswordSchema,
  resetPasswordSchema,
  changePasswordSchema,
  validatePinSchema,
} from '@/validators/auth.validators';

const router = Router();
const ctrl   = new AuthController();

// ---------------------------------------------------------------------------
// Rotas Públicas
// ---------------------------------------------------------------------------

/**
 * POST /api/v1/auth/login
 * Autentica um usuário com e-mail e senha.
 * Retorna access_token, refresh_token e dados do usuário.
 */
router.post('/login', validate(loginSchema), ctrl.login);

/**
 * POST /api/v1/auth/refresh
 * Renova o access_token usando um refresh_token válido.
 */
router.post('/refresh', validate(refreshTokenSchema), ctrl.refresh);

/**
 * POST /api/v1/auth/forgot-password
 * Envia e-mail de redefinição de senha para o endereço informado.
 */
router.post('/forgot-password', validate(forgotPasswordSchema), ctrl.forgotPassword);

/**
 * POST /api/v1/auth/reset-password
 * Redefine a senha usando o token recebido por e-mail.
 */
router.post('/reset-password', validate(resetPasswordSchema), ctrl.resetPassword);

// ---------------------------------------------------------------------------
// Rotas Protegidas (exigem autenticação)
// ---------------------------------------------------------------------------

/**
 * POST /api/v1/auth/logout
 * Invalida a sessão atual no Supabase Auth.
 */
router.post('/logout', authenticate, ctrl.logout);

/**
 * GET /api/v1/auth/me
 * Retorna os dados do usuário autenticado e da empresa associada.
 */
router.get('/me', authenticate, ctrl.me);

/**
 * POST /api/v1/auth/change-password
 * Altera a senha do usuário autenticado (exige senha atual).
 */
router.post('/change-password', authenticate, validate(changePasswordSchema), ctrl.changePassword);

/**
 * POST /api/v1/auth/validate-pin
 * Valida o PIN numérico do usuário para acesso rápido ao PDV.
 */
router.post('/validate-pin', authenticate, validate(validatePinSchema), ctrl.validatePin);

export { router as authRoutes };
