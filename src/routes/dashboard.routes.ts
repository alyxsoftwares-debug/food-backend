/**
 * @file routes/dashboard.routes.ts
 * @description KPIs, dashboard, usuários, impressoras e webhooks.
 * CORREÇÃO: Removido import withTransaction não utilizado; adicionados retornos explícitos.
 */

import { Router, Request, Response, NextFunction } from 'express';
import crypto                        from 'crypto';
import bcrypt                        from 'bcryptjs';
import { authenticate }              from '@/middlewares/authenticate';
import { authorize, authorizeMinRole } from '@/middlewares/authorize';
import { pgPool, supabaseAdmin }     from '@/config/supabase';
import { AppError, ErrorCode }       from '@/errors/AppError';

// =============================================================================
// DASHBOARD
// =============================================================================

const dashRouter = Router();
dashRouter.use(authenticate);

dashRouter.get('/revenue', authorizeMinRole('manager'), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const period = (req.query.period as string) ?? '7d';
    const days   = period === '30d' ? 30 : period === '90d' ? 90 : 7;

    const { rows } = await pgPool.query(
      `SELECT
         DATE_TRUNC('day', created_at AT TIME ZONE 'America/Sao_Paulo')::DATE AS day,
         COUNT(*) FILTER (WHERE status = 'delivered')                          AS orders,
         COALESCE(SUM(total) FILTER (WHERE status = 'delivered'), 0)           AS revenue,
         COALESCE(AVG(total) FILTER (WHERE status = 'delivered'), 0)           AS avg_ticket
       FROM food.orders
       WHERE company_id = $1
         AND created_at >= CURRENT_DATE - ($2 || ' days')::INTERVAL
       GROUP BY 1 ORDER BY 1 ASC`,
      [req.company.id, days],
    );
    res.json({ success: true, data: rows });
  } catch (err) { next(err); }
});

dashRouter.get('/top-products', authorizeMinRole('manager'), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const limit = Math.min(20, Number(req.query.limit ?? 10));
    const { rows } = await pgPool.query(
      `SELECT
         oi.product_name,
         oi.product_id,
         SUM(oi.quantity)            AS total_qty,
         SUM(oi.subtotal)            AS total_revenue,
         COUNT(DISTINCT oi.order_id) AS order_count
       FROM food.order_items oi
       JOIN food.orders o ON o.id = oi.order_id
       WHERE oi.company_id = $1
         AND o.status = 'delivered'
         AND o.created_at >= CURRENT_DATE - INTERVAL '30 days'
       GROUP BY oi.product_name, oi.product_id
       ORDER BY total_qty DESC
       LIMIT $2`,
      [req.company.id, limit],
    );
    res.json({ success: true, data: rows });
  } catch (err) { next(err); }
});

dashRouter.get('/summary', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { rows } = await pgPool.query(
      `SELECT
         COUNT(*) FILTER (WHERE created_at >= CURRENT_DATE)                           AS orders_today,
         COALESCE(SUM(total) FILTER (WHERE status='delivered' AND created_at >= CURRENT_DATE), 0) AS revenue_today,
         COUNT(*) FILTER (WHERE DATE_TRUNC('month',created_at) = DATE_TRUNC('month',NOW())) AS orders_month,
         COALESCE(SUM(total) FILTER (WHERE status='delivered'
           AND DATE_TRUNC('month',created_at) = DATE_TRUNC('month',NOW())), 0)        AS revenue_month,
         COUNT(*) FILTER (WHERE status IN ('pending','confirmed','preparing','ready','dispatched')) AS open_orders,
         COUNT(*) FILTER (WHERE status = 'pending')   AS pending_orders,
         COUNT(*) FILTER (WHERE status = 'preparing') AS preparing_orders
       FROM food.orders WHERE company_id = $1`,
      [req.company.id],
    );
    res.json({ success: true, data: rows[0] });
  } catch (err) { next(err); }
});

export { dashRouter as dashboardRoutes };

// =============================================================================
// USERS
// =============================================================================

const userRouter = Router();
userRouter.use(authenticate);

userRouter.get('/', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { rows } = await pgPool.query(
      `SELECT id, name, email, phone, role, status, last_login_at, created_at
       FROM food.users WHERE company_id = $1 ORDER BY name ASC`,
      [req.company.id],
    );
    res.json({ success: true, data: rows });
  } catch (err) { next(err); }
});

userRouter.get('/:id', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { rows } = await pgPool.query(
      `SELECT id, name, email, phone, role, status, permissions, last_login_at, created_at
       FROM food.users WHERE id = $1 AND company_id = $2`,
      [req.params.id, req.company.id],
    );
    if (!rows[0]) throw new AppError('Usuário não encontrado.', 404, ErrorCode.USER_NOT_FOUND);
    res.json({ success: true, data: rows[0] });
  } catch (err) { next(err); }
});

userRouter.post('/', authorizeMinRole('admin'), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { name, email, role, phone, password } = req.body as {
      name: string; email: string; role: string; phone?: string; password: string;
    };

    if (!name || !email || !role || !password) {
      throw AppError.validation('name, email, role e password são obrigatórios.');
    }

    const { data: authData, error: authError } = await supabaseAdmin.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
    });

    if (authError || !authData.user) {
      throw new AppError(
        authError?.message ?? 'Erro ao criar usuário.',
        400,
        ErrorCode.INTERNAL_SERVER_ERROR,
      );
    }

    const { rows } = await pgPool.query(
      `INSERT INTO food.users (company_id, auth_user_id, name, email, phone, role, status)
       VALUES ($1,$2,$3,$4,$5,$6,'active')
       RETURNING id, name, email, role, status`,
      [req.company.id, authData.user.id, name, email, phone ?? null, role],
    );

    res.status(201).json({ success: true, data: rows[0] });
  } catch (err) { next(err); }
});

userRouter.put('/:id', authorizeMinRole('admin'), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { name, role, phone, status, permissions } = req.body as {
      name?: string; role?: string; phone?: string; status?: string;
      permissions?: Record<string, boolean>;
    };
    const { rows } = await pgPool.query(
      `UPDATE food.users
       SET name        = COALESCE($1, name),
           role        = COALESCE($2, role),
           phone       = COALESCE($3, phone),
           status      = COALESCE($4, status),
           permissions = COALESCE($5, permissions)
       WHERE id = $6 AND company_id = $7
       RETURNING id, name, email, role, status, permissions`,
      [
        name ?? null, role ?? null, phone ?? null, status ?? null,
        permissions ? JSON.stringify(permissions) : null,
        req.params.id, req.company.id,
      ],
    );
    if (!rows[0]) throw new AppError('Usuário não encontrado.', 404, ErrorCode.USER_NOT_FOUND);
    res.json({ success: true, data: rows[0] });
  } catch (err) { next(err); }
});

// PATCH /users/:id/pin — rota para atualizar PIN
userRouter.patch('/:id/pin', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { pin } = req.body as { pin: string };
    if (!pin || !/^\d{4,6}$/.test(pin)) {
      throw AppError.validation('PIN deve ter 4 a 6 dígitos numéricos.');
    }
    const hashed = await bcrypt.hash(pin, 10);
    await pgPool.query(
      `UPDATE food.users SET pin = $1 WHERE id = $2 AND company_id = $3`,
      [hashed, req.params.id, req.company.id],
    );
    res.json({ success: true, data: { message: 'PIN atualizado.' } });
  } catch (err) { next(err); }
});

userRouter.delete('/:id', authorizeMinRole('owner'), async (req: Request, res: Response, next: NextFunction) => {
  try {
    if (req.user.id === req.params.id) {
      throw AppError.badRequest('Você não pode remover sua própria conta.');
    }

    const { rows } = await pgPool.query(
      `SELECT auth_user_id FROM food.users WHERE id = $1 AND company_id = $2`,
      [req.params.id, req.company.id],
    );
    if (!rows[0]) throw new AppError('Usuário não encontrado.', 404, ErrorCode.USER_NOT_FOUND);

    await Promise.all([
      rows[0].auth_user_id
        ? supabaseAdmin.auth.admin.deleteUser(rows[0].auth_user_id as string)
        : Promise.resolve(),
      pgPool.query(`DELETE FROM food.users WHERE id = $1`, [req.params.id]),
    ]);

    res.status(204).send();
  } catch (err) { next(err); }
});

export { userRouter as userRoutes };

// =============================================================================
// PRINTERS
// =============================================================================

const printerRouter = Router();
printerRouter.use(authenticate);

printerRouter.get('/', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { rows } = await pgPool.query(
      `SELECT * FROM food.printers WHERE company_id = $1 ORDER BY is_default DESC, name ASC`,
      [req.company.id],
    );
    res.json({ success: true, data: rows });
  } catch (err) { next(err); }
});

printerRouter.post('/', authorizeMinRole('manager'), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { name, type, connection, ipAddress, port, isDefault } = req.body as {
      name: string; type?: string; connection?: string;
      ipAddress?: string; port?: number; isDefault?: boolean;
    };

    if (isDefault) {
      await pgPool.query(
        `UPDATE food.printers SET is_default = FALSE WHERE company_id = $1`,
        [req.company.id],
      );
    }

    const { rows } = await pgPool.query(
      `INSERT INTO food.printers (company_id, name, type, connection, ip_address, port, is_default)
       VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *`,
      [
        req.company.id, name,
        type ?? 'thermal_80mm', connection ?? 'network',
        ipAddress ?? null, port ?? 9100, isDefault ?? false,
      ],
    );
    res.status(201).json({ success: true, data: rows[0] });
  } catch (err) { next(err); }
});

printerRouter.put('/:id', authorizeMinRole('manager'), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const b = req.body as Record<string, unknown>;
    const { rows } = await pgPool.query(
      `UPDATE food.printers
       SET name       = COALESCE($1, name),
           ip_address = COALESCE($2, ip_address),
           port       = COALESCE($3, port),
           is_active  = COALESCE($4, is_active),
           auto_print = COALESCE($5, auto_print),
           copies     = COALESCE($6, copies)
       WHERE id = $7 AND company_id = $8 RETURNING *`,
      [
        b.name ?? null, b.ipAddress ?? null, b.port ?? null,
        b.isActive ?? null, b.autoPrint ?? null, b.copies ?? null,
        req.params.id, req.company.id,
      ],
    );
    if (!rows[0]) throw AppError.notFound('Impressora', req.params.id);
    res.json({ success: true, data: rows[0] });
  } catch (err) { next(err); }
});

printerRouter.delete('/:id', authorize('owner', 'admin'), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { rowCount } = await pgPool.query(
      `DELETE FROM food.printers WHERE id = $1 AND company_id = $2`,
      [req.params.id, req.company.id],
    );
    if (!rowCount) throw AppError.notFound('Impressora', req.params.id);
    res.status(204).send();
  } catch (err) { next(err); }
});

export { printerRouter as printerRoutes };

// =============================================================================
// WEBHOOKS
// =============================================================================

const webhookRouter = Router();

function validateWebhookSignature(req: Request, res: Response, next: NextFunction): void {
  const signature = req.headers['x-webhook-signature'] as string;
  const secret    = process.env.WEBHOOK_SECRET ?? '';

  if (!signature || !secret) {
    res.status(401).json({ error: 'Assinatura inválida.' });
    return;
  }

  const body     = JSON.stringify(req.body);
  const expected = `sha256=${crypto.createHmac('sha256', secret).update(body).digest('hex')}`;

  try {
    const valid = crypto.timingSafeEqual(
      Buffer.from(signature),
      Buffer.from(expected),
    );
    if (!valid) {
      res.status(401).json({ error: 'Assinatura inválida.' });
      return;
    }
    next();
  } catch {
    res.status(401).json({ error: 'Assinatura inválida.' });
  }
}

webhookRouter.post('/payment', validateWebhookSignature, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { orderId, status, amount, reference } = req.body as {
      orderId: string; status: string; amount: number; reference?: string;
    };

    if (!orderId || !status) {
      res.status(400).json({ error: 'orderId e status são obrigatórios.' });
      return;
    }

    if (status === 'approved') {
      await pgPool.query(
        `INSERT INTO food.order_payments
           (order_id, company_id, method, amount, reference)
         SELECT id, company_id, 'pix', $1, $2
         FROM food.orders WHERE id = $3`,
        [amount, reference ?? null, orderId],
      );
    }

    res.json({ received: true });
  } catch (err) { next(err); }
});

export { webhookRouter as webhookRoutes };
