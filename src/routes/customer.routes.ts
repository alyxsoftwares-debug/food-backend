/**
 * @file routes/customer.routes.ts
 * @description Rotas do domínio de Clientes.
 * CORREÇÃO: CustomerController movido para cá diretamente (sem import externo inexistente).
 */

import { Router, Request, Response, NextFunction } from 'express';
import { authenticate }    from '@/middlewares/authenticate';
import { authorize }       from '@/middlewares/authorize';
import { validate }        from '@/middlewares/validate';
import { pgPool }          from '@/config/supabase';
import { AppError, ErrorCode } from '@/errors/AppError';
import { z }               from 'zod';

// ---------------------------------------------------------------------------
// Schemas de validação
// ---------------------------------------------------------------------------

const createSchema = z.object({
  body: z.object({
    name : z.string().min(2).max(200),
    phone: z.string().min(10).max(20),
    email: z.string().email().optional(),
    notes: z.string().max(500).optional(),
  }),
});

const updateSchema = z.object({
  params: z.object({ id: z.string().uuid() }),
  body  : createSchema.shape.body.partial(),
});

const querySchema = z.object({
  query: z.object({
    page  : z.coerce.number().int().min(1).default(1),
    limit : z.coerce.number().int().min(1).max(100).default(20),
    search: z.string().max(100).optional(),
  }),
});

// ---------------------------------------------------------------------------
// Handlers inline
// ---------------------------------------------------------------------------

async function list(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const page   = Number(req.query.page  ?? 1);
    const limit  = Number(req.query.limit ?? 20);
    const search = req.query.search as string | undefined;
    const offset = (page - 1) * limit;

    const conditions: string[] = ['company_id = $1'];
    const params: unknown[]    = [req.company.id];
    let idx = 2;

    if (search) {
      conditions.push(`(name ILIKE $${idx} OR phone ILIKE $${idx} OR email ILIKE $${idx})`);
      params.push(`%${search}%`);
      idx++;
    }

    const where = conditions.join(' AND ');

    const [rows, count] = await Promise.all([
      pgPool.query(
        `SELECT id, name, phone, email, total_orders, total_spent,
                last_order_at, notes, tags, created_at
         FROM food.customers WHERE ${where}
         ORDER BY last_order_at DESC NULLS LAST, name ASC
         LIMIT $${idx} OFFSET $${idx + 1}`,
        [...params, limit, offset],
      ),
      pgPool.query(
        `SELECT COUNT(*) AS total FROM food.customers WHERE ${where}`,
        params,
      ),
    ]);

    const total = Number(count.rows[0].total);
    res.json({
      success: true,
      data: {
        customers : rows.rows,
        pagination: { page, limit, total, totalPages: Math.ceil(total / limit) },
      },
    });
  } catch (err) { next(err); }
}

async function findById(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const { rows } = await pgPool.query(
      `SELECT * FROM food.customers WHERE id = $1 AND company_id = $2`,
      [req.params.id, req.company.id],
    );
    if (!rows[0]) throw new AppError('Cliente não encontrado.', 404, ErrorCode.CUSTOMER_NOT_FOUND);
    res.json({ success: true, data: rows[0] });
  } catch (err) { next(err); }
}

async function create(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const { name, phone, email, notes } = req.body as {
      name: string; phone: string; email?: string; notes?: string;
    };
    const { rows } = await pgPool.query(
      `INSERT INTO food.customers (company_id, name, phone, email, notes)
       VALUES ($1,$2,$3,$4,$5)
       ON CONFLICT (company_id, phone) DO UPDATE SET name = EXCLUDED.name
       RETURNING *`,
      [req.company.id, name, phone, email ?? null, notes ?? null],
    );
    res.status(201).json({ success: true, data: rows[0] });
  } catch (err) { next(err); }
}

async function update(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const allowed = ['name', 'phone', 'email', 'notes', 'tags'] as const;
    const sets: string[] = [];
    const params: unknown[] = [];
    let idx = 1;

    for (const key of allowed) {
      if (key in req.body && req.body[key] !== undefined) {
        sets.push(`${key} = $${idx++}`);
        params.push(req.body[key]);
      }
    }

    if (!sets.length) {
      res.json({ success: true });
      return;
    }

    params.push(req.params.id, req.company.id);
    const { rows } = await pgPool.query(
      `UPDATE food.customers SET ${sets.join(',')}
       WHERE id = $${idx} AND company_id = $${idx + 1}
       RETURNING *`,
      params,
    );
    if (!rows[0]) throw new AppError('Cliente não encontrado.', 404, ErrorCode.CUSTOMER_NOT_FOUND);
    res.json({ success: true, data: rows[0] });
  } catch (err) { next(err); }
}

async function deleteCustomer(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const { rowCount } = await pgPool.query(
      `DELETE FROM food.customers WHERE id = $1 AND company_id = $2`,
      [req.params.id, req.company.id],
    );
    if (!rowCount) throw new AppError('Cliente não encontrado.', 404, ErrorCode.CUSTOMER_NOT_FOUND);
    res.status(204).send();
  } catch (err) { next(err); }
}

async function orders(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const { rows } = await pgPool.query(
      `SELECT id, sequential_number, type, status, total,
              payment_status, created_at, delivered_at
       FROM food.orders
       WHERE customer_id = $1 AND company_id = $2
       ORDER BY created_at DESC LIMIT 50`,
      [req.params.id, req.company.id],
    );
    res.json({ success: true, data: rows });
  } catch (err) { next(err); }
}

// ---------------------------------------------------------------------------
// Router
// ---------------------------------------------------------------------------

const router = Router();
router.use(authenticate);

router.get ('/',    validate(querySchema),  list);
router.get ('/:id',                         findById);
router.post('/',    validate(createSchema), create);
router.put ('/:id', validate(updateSchema), update);
router.delete('/:id', authorize('owner', 'admin', 'manager'), deleteCustomer);
router.get  ('/:id/orders', orders);

export { router as customerRoutes };
