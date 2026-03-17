/**
 * @file routes/index.ts
 * @description Roteador principal da API v1.
 * CORREÇÃO: Removidas importações de company.routes e category.routes inexistentes.
 * As rotas de categoria estão em product.routes, empresa em um stub simples.
 */

import { Router, Request, Response } from 'express';

import { authRoutes }      from '@/routes/auth.routes';
import { menuRoutes }      from '@/routes/menu.routes';
import { orderRoutes }     from '@/routes/order.routes';
import { productRoutes }   from '@/routes/product.routes';
import { tableRoutes }     from '@/routes/table.routes';
import { customerRoutes }  from '@/routes/customer.routes';
import { deliveryRoutes }  from '@/routes/delivery.routes';
import { userRoutes }      from '@/routes/user.routes';
import { dashboardRoutes } from '@/routes/dashboard.routes';
import { printerRoutes }   from '@/routes/printer.routes';
import { webhookRoutes }   from '@/routes/webhook.routes';

import { authLimiter, publicMenuLimiter } from '@/config/rateLimiter';

export const router = Router();

// Status da API
router.get('/', (_req: Request, res: Response) => {
  res.json({
    success: true,
    api    : 'Food SaaS API',
    version: 'v1',
    status : 'operational',
  });
});

// ---------------------------------------------------------------------------
// Rotas públicas
// ---------------------------------------------------------------------------

router.use('/auth',    authLimiter,       authRoutes);
router.use('/menu',    publicMenuLimiter,  menuRoutes);

// ---------------------------------------------------------------------------
// Rotas protegidas
// ---------------------------------------------------------------------------

router.use('/products',  productRoutes);
router.use('/tables',    tableRoutes);
router.use('/orders',    orderRoutes);
router.use('/customers', customerRoutes);
router.use('/delivery',  deliveryRoutes);
router.use('/users',     userRoutes);
router.use('/dashboard', dashboardRoutes);
router.use('/printers',  printerRoutes);

// Webhooks — validação de assinatura HMAC própria
router.use('/webhooks',  webhookRoutes);
