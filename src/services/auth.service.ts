/**
 * @file auth.service.ts
 * @description Service de autenticação — toda a lógica de negócio de auth.
 *
 * Responsabilidades:
 *  - Login com e-mail/senha via Supabase Auth
 *  - Refresh de tokens
 *  - Logout e invalidação de sessão
 *  - Recuperação e redefinição de senha
 *  - Alteração de senha com verificação da senha atual
 *  - Validação de PIN para PDV (comparação de hash bcrypt)
 *
 * @module services/auth
 */

import bcrypt                          from 'bcryptjs';
import { supabaseAdmin, pgPool }       from '@/config/supabase';
import { AppError, ErrorCode }         from '@/errors/AppError';
import { logger }                      from '@/config/logger';
import { DEFAULT_PERMISSIONS_BY_ROLE } from '@/types/auth.types';
import type { AuthUser, AuthCompany }  from '@/types/auth.types';

// ---------------------------------------------------------------------------
// DTOs (Data Transfer Objects)
// ---------------------------------------------------------------------------

interface LoginDTO {
  email   : string;
  password: string;
}

interface LoginResult {
  accessToken : string;
  refreshToken: string;
  expiresIn   : number;
  user        : Omit<AuthUser, 'permissions'> & { permissions: Record<string, boolean> };
  company     : AuthCompany;
}

interface RefreshResult {
  accessToken : string;
  refreshToken: string;
  expiresIn   : number;
}

interface ResetPasswordDTO {
  token      : string;
  newPassword: string;
}

interface ChangePasswordDTO {
  userId         : string;
  email          : string;
  currentPassword: string;
  newPassword    : string;
}

interface ValidatePinDTO {
  userId: string;
  pin   : string;
}

interface UserProfileRow {
  id          : string;
  company_id  : string;
  name        : string;
  email       : string;
  phone       : string | null;
  avatar_url  : string | null;
  role        : string;
  status      : string;
  permissions : Record<string, boolean>;
  last_login_at: string | null;
  created_at  : string;
}

// ---------------------------------------------------------------------------
// AuthService
// ---------------------------------------------------------------------------

export class AuthService {

  // ---------------------------------------------------------------------------
  // login
  // ---------------------------------------------------------------------------

  async login({ email, password }: LoginDTO): Promise<LoginResult> {
    // 1. Autenticar via Supabase Auth
    const { data, error } = await supabaseAdmin.auth.signInWithPassword({
      email   : email.toLowerCase().trim(),
      password,
    });

    if (error || !data.session || !data.user) {
      // Mensagem genérica intencional — não revela se o e-mail existe
      throw new AppError(
        'E-mail ou senha incorretos.',
        401,
        ErrorCode.UNAUTHORIZED,
      );
    }

    // 2. Buscar usuário interno com dados da empresa
    const { rows } = await pgPool.query<
      UserProfileRow & {
        company_name  : string;
        company_slug  : string;
        company_plan  : string;
        company_status: string;
        user_status   : string;
      }
    >(
      `SELECT
         u.id,
         u.company_id,
         u.name,
         u.email,
         u.phone,
         u.avatar_url,
         u.role,
         u.status      AS user_status,
         u.permissions,
         u.last_login_at,
         u.created_at,
         c.name        AS company_name,
         c.slug        AS company_slug,
         c.plan        AS company_plan,
         c.status      AS company_status
       FROM food.users u
       JOIN food.companies c ON c.id = u.company_id
       WHERE u.auth_user_id = $1
       LIMIT 1`,
      [data.user.id],
    );

    if (rows.length === 0) {
      throw new AppError('Usuário não configurado. Contate o suporte.', 403, ErrorCode.USER_NOT_FOUND);
    }

    const row = rows[0];

    // 3. Validar status do usuário e da empresa
    if (row.user_status !== 'active') {
      throw new AppError('Conta inativa. Contate o administrador.', 403, ErrorCode.USER_INACTIVE);
    }

    if (row.company_status === 'suspended') {
      throw new AppError('Empresa suspensa. Entre em contato com o suporte.', 403, ErrorCode.COMPANY_SUSPENDED);
    }

    if (row.company_status !== 'active') {
      throw new AppError('Empresa inativa.', 403, ErrorCode.COMPANY_INACTIVE);
    }

    // 4. Atualizar last_login_at de forma assíncrona (não bloqueia a resposta)
    pgPool.query(
      'UPDATE food.users SET last_login_at = NOW() WHERE id = $1',
      [row.id],
    ).catch((err) => logger.error('Falha ao atualizar last_login_at:', err));

    // 5. Mesclar permissões do role com as permissões customizadas do usuário
    const rolePermissions  = DEFAULT_PERMISSIONS_BY_ROLE[row.role as keyof typeof DEFAULT_PERMISSIONS_BY_ROLE] ?? {};
    const mergedPermissions = { ...rolePermissions, ...(row.permissions ?? {}) };

    return {
      accessToken : data.session.access_token,
      refreshToken: data.session.refresh_token,
      expiresIn   : data.session.expires_in,
      user: {
        id         : row.id,
        companyId  : row.company_id,
        name       : row.name,
        email      : row.email,
        role       : row.role as AuthUser['role'],
        permissions: mergedPermissions,
      },
      company: {
        id    : row.company_id,
        name  : row.company_name,
        slug  : row.company_slug,
        plan  : row.company_plan,
        status: row.company_status,
      },
    };
  }

  // ---------------------------------------------------------------------------
  // refresh
  // ---------------------------------------------------------------------------

  async refresh(refreshToken: string): Promise<RefreshResult> {
    const { data, error } = await supabaseAdmin.auth.refreshSession({
      refresh_token: refreshToken,
    });

    if (error || !data.session) {
      throw new AppError(
        'Sessão expirada. Faça login novamente.',
        401,
        ErrorCode.TOKEN_EXPIRED,
      );
    }

    return {
      accessToken : data.session.access_token,
      refreshToken: data.session.refresh_token,
      expiresIn   : data.session.expires_in,
    };
  }

  // ---------------------------------------------------------------------------
  // logout
  // ---------------------------------------------------------------------------

  async logout(accessToken: string): Promise<void> {
    // Cria um client temporário com o token do usuário para invalidar apenas a sessão dele
    const { error } = await supabaseAdmin.auth.admin.signOut(accessToken);

    if (error) {
      // Loga mas não lança — se o token já expirou, o logout é considerado bem-sucedido
      logger.warn('[AuthService] Erro ao invalidar sessão (pode já ter expirado):', error.message);
    }
  }

  // ---------------------------------------------------------------------------
  // getProfile
  // ---------------------------------------------------------------------------

  async getProfile(userId: string): Promise<UserProfileRow> {
    const { rows } = await pgPool.query<UserProfileRow>(
      `SELECT
         id, company_id, name, email, phone,
         avatar_url, role, status, permissions,
         last_login_at, created_at
       FROM food.users
       WHERE id = $1
       LIMIT 1`,
      [userId],
    );

    if (rows.length === 0) {
      throw new AppError('Usuário não encontrado.', 404, ErrorCode.USER_NOT_FOUND);
    }

    // Nunca retorna o PIN (hash) no perfil
    const profile = rows[0];
    return profile;
  }

  // ---------------------------------------------------------------------------
  // forgotPassword
  // ---------------------------------------------------------------------------

  async forgotPassword(email: string): Promise<void> {
    // Não verifica se o e-mail existe antes de chamar o Supabase
    // para evitar enumeração de usuários (timing attack)
    const { error } = await supabaseAdmin.auth.resetPasswordForEmail(
      email.toLowerCase().trim(),
      {
        redirectTo: `${process.env.FRONTEND_URL}/auth/reset-password`,
      },
    );

    if (error) {
      // Loga internamente mas não expõe ao cliente
      logger.warn('[AuthService] Erro ao enviar e-mail de reset (silenciado):', error.message);
    }
    // Sempre retorna void — o controller sempre responde com 200
  }

  // ---------------------------------------------------------------------------
  // resetPassword
  // ---------------------------------------------------------------------------

  async resetPassword({ token, newPassword }: ResetPasswordDTO): Promise<void> {
    this.validatePasswordStrength(newPassword);

    // Troca o token por uma sessão válida
    const { data, error: verifyError } = await supabaseAdmin.auth.exchangeCodeForSession(token);

    if (verifyError || !data.user) {
      throw new AppError(
        'Link de redefinição inválido ou expirado.',
        400,
        ErrorCode.TOKEN_INVALID,
      );
    }

    // Atualiza a senha no Supabase Auth
    const { error: updateError } = await supabaseAdmin.auth.admin.updateUserById(
      data.user.id,
      { password: newPassword },
    );

    if (updateError) {
      throw new AppError(
        'Não foi possível redefinir a senha. Tente novamente.',
        500,
        ErrorCode.INTERNAL_SERVER_ERROR,
      );
    }
  }

  // ---------------------------------------------------------------------------
  // changePassword
  // ---------------------------------------------------------------------------

  async changePassword({
    userId,
    email,
    currentPassword,
    newPassword,
  }: ChangePasswordDTO): Promise<void> {
    this.validatePasswordStrength(newPassword);

    if (currentPassword === newPassword) {
      throw new AppError(
        'A nova senha não pode ser igual à senha atual.',
        422,
        ErrorCode.VALIDATION_ERROR,
      );
    }

    // Verifica a senha atual fazendo login com ela
    const { error: verifyError } = await supabaseAdmin.auth.signInWithPassword({
      email,
      password: currentPassword,
    });

    if (verifyError) {
      throw new AppError('Senha atual incorreta.', 401, ErrorCode.UNAUTHORIZED);
    }

    // Busca o auth_user_id do usuário
    const { rows } = await pgPool.query<{ auth_user_id: string }>(
      'SELECT auth_user_id FROM food.users WHERE id = $1 LIMIT 1',
      [userId],
    );

    if (rows.length === 0 || !rows[0].auth_user_id) {
      throw new AppError('Usuário não encontrado.', 404, ErrorCode.USER_NOT_FOUND);
    }

    // Atualiza a senha no Supabase Auth
    const { error: updateError } = await supabaseAdmin.auth.admin.updateUserById(
      rows[0].auth_user_id,
      { password: newPassword },
    );

    if (updateError) {
      throw new AppError(
        'Não foi possível alterar a senha. Tente novamente.',
        500,
        ErrorCode.INTERNAL_SERVER_ERROR,
      );
    }
  }

  // ---------------------------------------------------------------------------
  // validatePin
  // ---------------------------------------------------------------------------

  async validatePin({ userId, pin }: ValidatePinDTO): Promise<boolean> {
    const { rows } = await pgPool.query<{ pin: string | null }>(
      'SELECT pin FROM food.users WHERE id = $1 LIMIT 1',
      [userId],
    );

    if (rows.length === 0 || !rows[0].pin) {
      throw new AppError(
        'PIN não configurado para este usuário.',
        400,
        ErrorCode.INVALID_PIN,
      );
    }

    // Comparação com hash bcrypt — constante de tempo para evitar timing attacks
    const isValid = await bcrypt.compare(pin, rows[0].pin);
    return isValid;
  }

  // ---------------------------------------------------------------------------
  // Helpers privados
  // ---------------------------------------------------------------------------

  /**
   * Valida a força da senha segundo as regras de negócio.
   * Mínimo 8 caracteres, pelo menos 1 letra maiúscula, 1 minúscula e 1 número.
   */
  private validatePasswordStrength(password: string): void {
    if (password.length < 8) {
      throw AppError.validation('A senha deve ter no mínimo 8 caracteres.');
    }

    if (!/[A-Z]/.test(password)) {
      throw AppError.validation('A senha deve conter pelo menos uma letra maiúscula.');
    }

    if (!/[a-z]/.test(password)) {
      throw AppError.validation('A senha deve conter pelo menos uma letra minúscula.');
    }

    if (!/[0-9]/.test(password)) {
      throw AppError.validation('A senha deve conter pelo menos um número.');
    }
  }
}
