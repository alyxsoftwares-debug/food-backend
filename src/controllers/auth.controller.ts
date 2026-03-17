/**
 * @file auth.controller.ts
 * @description Controller de autenticação.
 *
 * Segue o padrão thin controller — valida input, delega ao AuthService
 * e formata a resposta HTTP. Sem lógica de negócio aqui.
 *
 * @module controllers/auth
 */

import { Request, Response, NextFunction } from 'express';
import { AuthService }                     from '@/services/auth.service';
import { createRequestLogger }             from '@/config/logger';

export class AuthController {
  private readonly service: AuthService;

  constructor() {
    this.service = new AuthService();

    // Bind manual para garantir contexto correto ao usar como callback de rota
    this.login          = this.login.bind(this);
    this.refresh        = this.refresh.bind(this);
    this.logout         = this.logout.bind(this);
    this.me             = this.me.bind(this);
    this.forgotPassword = this.forgotPassword.bind(this);
    this.resetPassword  = this.resetPassword.bind(this);
    this.changePassword = this.changePassword.bind(this);
    this.validatePin    = this.validatePin.bind(this);
  }

  // ---------------------------------------------------------------------------
  // POST /auth/login
  // ---------------------------------------------------------------------------

  /**
   * Autentica o usuário com e-mail e senha.
   *
   * @body email    - E-mail do usuário
   * @body password - Senha do usuário
   *
   * @returns 200 { accessToken, refreshToken, expiresIn, user, company }
   */
  async login(req: Request, res: Response, next: NextFunction): Promise<void> {
    const log = createRequestLogger(req.id);

    try {
      const { email, password } = req.body as {
        email   : string;
        password: string;
      };

      log.info('Tentativa de login', { email });

      const result = await this.service.login({ email, password });

      log.info('Login realizado com sucesso', {
        userId    : result.user.id,
        companyId : result.user.companyId,
        role      : result.user.role,
      });

      res.status(200).json({
        success: true,
        data   : result,
      });
    } catch (error) {
      next(error);
    }
  }

  // ---------------------------------------------------------------------------
  // POST /auth/refresh
  // ---------------------------------------------------------------------------

  /**
   * Renova o access_token usando um refresh_token válido.
   *
   * @body refreshToken - Token de renovação emitido no login
   *
   * @returns 200 { accessToken, refreshToken, expiresIn }
   */
  async refresh(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const { refreshToken } = req.body as { refreshToken: string };

      const result = await this.service.refresh(refreshToken);

      res.status(200).json({
        success: true,
        data   : result,
      });
    } catch (error) {
      next(error);
    }
  }

  // ---------------------------------------------------------------------------
  // POST /auth/logout
  // ---------------------------------------------------------------------------

  /**
   * Invalida a sessão do usuário autenticado no Supabase Auth.
   *
   * @returns 200 { message }
   */
  async logout(req: Request, res: Response, next: NextFunction): Promise<void> {
    const log = createRequestLogger(req.id, req.company?.id);

    try {
      const authHeader = req.headers.authorization ?? '';
      const token      = authHeader.replace('Bearer ', '').trim();

      await this.service.logout(token);

      log.info('Logout realizado', { userId: req.user?.id });

      res.status(200).json({
        success: true,
        data   : { message: 'Sessão encerrada com sucesso.' },
      });
    } catch (error) {
      next(error);
    }
  }

  // ---------------------------------------------------------------------------
  // GET /auth/me
  // ---------------------------------------------------------------------------

  /**
   * Retorna os dados completos do usuário autenticado.
   *
   * @returns 200 { user, company }
   */
  async me(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const profile = await this.service.getProfile(req.user.id);

      res.status(200).json({
        success: true,
        data   : {
          user   : profile,
          company: req.company,
        },
      });
    } catch (error) {
      next(error);
    }
  }

  // ---------------------------------------------------------------------------
  // POST /auth/forgot-password
  // ---------------------------------------------------------------------------

  /**
   * Envia e-mail de redefinição de senha.
   * Sempre retorna 200 para não vazar se o e-mail existe ou não.
   *
   * @body email - E-mail do usuário
   *
   * @returns 200 { message }
   */
  async forgotPassword(req: Request, res: Response, next: NextFunction): Promise<void> {
    const log = createRequestLogger(req.id);

    try {
      const { email } = req.body as { email: string };

      await this.service.forgotPassword(email);

      log.info('Solicitação de redefinição de senha', { email });

      // Resposta genérica intencional — não revela se o e-mail existe
      res.status(200).json({
        success: true,
        data   : {
          message: 'Se este e-mail estiver cadastrado, você receberá as instruções em breve.',
        },
      });
    } catch (error) {
      next(error);
    }
  }

  // ---------------------------------------------------------------------------
  // POST /auth/reset-password
  // ---------------------------------------------------------------------------

  /**
   * Redefine a senha usando o token recebido por e-mail.
   *
   * @body token       - Token de redefinição
   * @body newPassword - Nova senha
   *
   * @returns 200 { message }
   */
  async resetPassword(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const { token, newPassword } = req.body as {
        token      : string;
        newPassword: string;
      };

      await this.service.resetPassword({ token, newPassword });

      res.status(200).json({
        success: true,
        data   : { message: 'Senha redefinida com sucesso.' },
      });
    } catch (error) {
      next(error);
    }
  }

  // ---------------------------------------------------------------------------
  // POST /auth/change-password
  // ---------------------------------------------------------------------------

  /**
   * Altera a senha do usuário autenticado.
   *
   * @body currentPassword - Senha atual
   * @body newPassword     - Nova senha
   *
   * @returns 200 { message }
   */
  async changePassword(req: Request, res: Response, next: NextFunction): Promise<void> {
    const log = createRequestLogger(req.id, req.company.id);

    try {
      const { currentPassword, newPassword } = req.body as {
        currentPassword: string;
        newPassword    : string;
      };

      await this.service.changePassword({
        userId         : req.user.id,
        email          : req.user.email,
        currentPassword,
        newPassword,
      });

      log.info('Senha alterada com sucesso', { userId: req.user.id });

      res.status(200).json({
        success: true,
        data   : { message: 'Senha alterada com sucesso.' },
      });
    } catch (error) {
      next(error);
    }
  }

  // ---------------------------------------------------------------------------
  // POST /auth/validate-pin
  // ---------------------------------------------------------------------------

  /**
   * Valida o PIN do usuário para acesso rápido ao PDV.
   *
   * @body pin - PIN de 4 a 6 dígitos
   *
   * @returns 200 { valid: boolean }
   */
  async validatePin(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const { pin } = req.body as { pin: string };

      const isValid = await this.service.validatePin({
        userId: req.user.id,
        pin,
      });

      res.status(200).json({
        success: true,
        data   : { valid: isValid },
      });
    } catch (error) {
      next(error);
    }
  }
}
