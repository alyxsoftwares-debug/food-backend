/**
 * @file menu.controller.ts
 * @description Controller do cardápio digital público.
 *
 * @module controllers/menu
 */

import { Request, Response, NextFunction } from 'express';
import { ProductService }                  from '@/services/product.service';
import { OrderService }                    from '@/services/order.service';
import { pgPool }                          from '@/config/supabase';
import { AppError, ErrorCode }             from '@/errors/AppError';
import { createRequestLogger }             from '@/config/logger';

export class MenuController {
  private readonly productService: ProductService;
  private readonly orderService  : OrderService;

  constructor() {
    this.productService = new ProductService();
    this.orderService   = new OrderService();

    this.getMenu     = this.getMenu.bind(this);
    this.getSettings = this.getSettings.bind(this);
    this.createOrder = this.createOrder.bind(this);
  }

  /**
   * GET /menu/:slug
   * Retorna o cardápio completo com cache de 60s.
   */
  async getMenu(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const menu = await this.productService.getPublicMenu(req.params.slug);

      // Cache HTTP de 30s no browser + 60s no CDN (Vercel Edge)
      res.setHeader('Cache-Control', 'public, max-age=30, s-maxage=60, stale-while-revalidate=300');
      res.status(200).json({ success: true, data: menu });
    } catch (err) { next(err); }
  }

  /**
   * GET /menu/:slug/settings
   * Retorna configurações de entrega e horários de funcionamento.
   */
  async getSettings(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const { rows: companyRows } = await pgPool.query(
        `SELECT id FROM food.companies WHERE slug = $1 AND status = 'active' LIMIT 1`,
        [req.params.slug],
      );

      if (companyRows.length === 0) {
        throw new AppError('Restaurante não encontrado.', 404, ErrorCode.COMPANY_NOT_FOUND);
      }

      const { rows } = await pgPool.query(
        `SELECT
           is_delivery_enabled, is_pickup_enabled, is_table_enabled,
           min_order_value, base_delivery_fee, free_delivery_above,
           estimated_delivery_time, estimated_pickup_time,
           accepted_payments, business_hours, allow_scheduling,
           max_schedule_days
         FROM food.delivery_settings
         WHERE company_id = $1`,
        [companyRows[0].id],
      );

      res.setHeader('Cache-Control', 'public, max-age=60, s-maxage=300');
      res.status(200).json({ success: true, data: rows[0] ?? {} });
    } catch (err) { next(err); }
  }

  /**
   * POST /menu/:slug/orders
   * Cria pedido a partir do cardápio público usando o slug.
   */
  async createOrder(req: Request, res: Response, next: NextFunction): Promise<void> {
    const log = createRequestLogger(req.id);
    try {
      const { rows: companyRows } = await pgPool.query(
        `SELECT id FROM food.companies WHERE slug = $1 AND status = 'active' LIMIT 1`,
        [req.params.slug],
      );

      if (companyRows.length === 0) {
        throw new AppError('Restaurante não encontrado.', 404, ErrorCode.COMPANY_NOT_FOUND);
      }

      const order = await this.orderService.create({
        companyId: companyRows[0].id,
        origin   : 'web',
        ...req.body,
      });

      log.info('Pedido público criado via slug', {
        slug     : req.params.slug,
        orderId  : order.id,
        sequential: order.sequential_number,
      });

      res.status(201).json({ success: true, data: order });
    } catch (err) { next(err); }
  }
}
