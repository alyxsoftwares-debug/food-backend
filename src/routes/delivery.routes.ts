/**
 * @file routes/delivery.routes.ts
 * @description Configurações de entrega, zonas e horários.
 * CORREÇÃO: Removida variável camelToSnake nunca usada.
 */

import { Router, Request, Response, NextFunction } from 'express';
import { authenticate }       from '@/middlewares/authenticate';
import { authorize }          from '@/middlewares/authorize';
import { pgPool }             from '@/config/supabase';
import { AppError, ErrorCode } from '@/errors/AppError';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function toSnake(key: string): string {
  return key.replace(/[A-Z]/g, (l) => `_${l.toLowerCase()}`);
}

// ---------------------------------------------------------------------------
// Handlers
// ---------------------------------------------------------------------------

async function getSettings(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const { rows } = await pgPool.query(
      `SELECT * FROM food.delivery_settings WHERE company_id = $1`,
      [req.company.id],
    );
    res.json({ success: true, data: rows[0] ?? {} });
  } catch (err) { next(err); }
}

async function updateSettings(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const allowed = [
      'isDeliveryEnabled', 'isPickupEnabled', 'isTableEnabled',
      'minOrderValue', 'baseDeliveryFee', 'freeDeliveryAbove',
      'deliveryRadiusKm', 'estimatedDeliveryTime', 'estimatedPickupTime',
      'acceptedPayments', 'whatsappNumber', 'whatsappMessageTemplate',
      'serviceFeePercentage', 'allowScheduling', 'maxScheduleDays',
      'requireAddressForDelivery',
    ];

    const sets: string[] = [];
    const params: unknown[] = [];
    let idx = 1;

    for (const key of allowed) {
      const val = (req.body as Record<string, unknown>)[key];
      if (val !== undefined) {
        sets.push(`${toSnake(key)} = $${idx++}`);
        params.push(val);
      }
    }

    if (!sets.length) {
      await getSettings(req, res, next);
      return;
    }

    params.push(req.company.id);
    const { rows } = await pgPool.query(
      `UPDATE food.delivery_settings SET ${sets.join(',')}
       WHERE company_id = $${idx}
       RETURNING *`,
      params,
    );
    res.json({ success: true, data: rows[0] });
  } catch (err) { next(err); }
}

async function updateHours(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const { rows } = await pgPool.query(
      `UPDATE food.delivery_settings
       SET business_hours = $1
       WHERE company_id = $2
       RETURNING business_hours`,
      [JSON.stringify(req.body.businessHours), req.company.id],
    );
    res.json({ success: true, data: rows[0] });
  } catch (err) { next(err); }
}

async function listZones(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const { rows } = await pgPool.query(
      `SELECT * FROM food.delivery_zones
       WHERE company_id = $1
       ORDER BY sort_order ASC, name ASC`,
      [req.company.id],
    );
    res.json({ success: true, data: rows });
  } catch (err) { next(err); }
}

async function createZone(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const { name, description, fee, minTime, maxTime, radiusKm, neighborhoods } =
      req.body as Record<string, unknown>;

    const { rows } = await pgPool.query(
      `INSERT INTO food.delivery_zones
         (company_id, name, description, fee, min_time, max_time, radius_km, neighborhoods)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
       RETURNING *`,
      [
        req.company.id, name, description ?? null,
        fee ?? 0, minTime ?? null, maxTime ?? null,
        radiusKm ?? null, neighborhoods ?? [],
      ],
    );
    res.status(201).json({ success: true, data: rows[0] });
  } catch (err) { next(err); }
}

async function updateZone(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const b = req.body as Record<string, unknown>;
    const { rows } = await pgPool.query(
      `UPDATE food.delivery_zones
       SET name          = COALESCE($1, name),
           description   = COALESCE($2, description),
           fee           = COALESCE($3, fee),
           min_time      = COALESCE($4, min_time),
           max_time      = COALESCE($5, max_time),
           radius_km     = COALESCE($6, radius_km),
           neighborhoods = COALESCE($7, neighborhoods),
           is_active     = COALESCE($8, is_active)
       WHERE id = $9 AND company_id = $10
       RETURNING *`,
      [
        b.name ?? null, b.description ?? null,
        b.fee ?? null, b.minTime ?? null,
        b.maxTime ?? null, b.radiusKm ?? null,
        b.neighborhoods ?? null, b.isActive ?? null,
        req.params.id, req.company.id,
      ],
    );
    if (!rows[0]) throw new AppError('Zona não encontrada.', 404, ErrorCode.DELIVERY_ZONE_NOT_FOUND);
    res.json({ success: true, data: rows[0] });
  } catch (err) { next(err); }
}

async function deleteZone(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const { rowCount } = await pgPool.query(
      `DELETE FROM food.delivery_zones WHERE id = $1 AND company_id = $2`,
      [req.params.id, req.company.id],
    );
    if (!rowCount) throw new AppError('Zona não encontrada.', 404, ErrorCode.DELIVERY_ZONE_NOT_FOUND);
    res.status(204).send();
  } catch (err) { next(err); }
}

// ---------------------------------------------------------------------------
// Router
// ---------------------------------------------------------------------------

const router = Router();
router.use(authenticate);

router.get  ('/settings', getSettings);
router.put  ('/settings', authorize('owner', 'admin', 'manager'), updateSettings);
router.patch('/hours',    authorize('owner', 'admin', 'manager'), updateHours);

router.get   ('/zones',     listZones);
router.post  ('/zones',     authorize('owner', 'admin', 'manager'), createZone);
router.put   ('/zones/:id', authorize('owner', 'admin', 'manager'), updateZone);
router.delete('/zones/:id', authorize('owner', 'admin'),           deleteZone);

export { router as deliveryRoutes };
