/**
 * @file menu.routes.ts
 * @description Rotas públicas do cardápio digital.
 *
 * Acessadas por clientes finais via browser/app — sem autenticação.
 * Rate limiter `publicMenuLimiter` (120 req/min) já aplicado no roteador raiz.
 *
 * @module routes/menu
 */

import { Router }          from 'express';
import { MenuController }  from '@/controllers/menu.controller';

const router = Router();
const ctrl   = new MenuController();

/**
 * GET /api/v1/menu/:slug
 * Retorna o cardápio completo de um restaurante pelo slug público.
 * Resposta cacheada em memória por 60s no service.
 *
 * @param slug - Identificador único do restaurante (ex: "meu-restaurante")
 */
router.get('/:slug', ctrl.getMenu);

/**
 * GET /api/v1/menu/:slug/settings
 * Retorna apenas as configurações de entrega e horários de funcionamento.
 * Usado pelo frontend antes de exibir o formulário de pedido.
 */
router.get('/:slug/settings', ctrl.getSettings);

/**
 * POST /api/v1/menu/:slug/orders
 * Cria um pedido via cardápio público (delivery ou retirada).
 * Rota alternativa ao POST /orders/public — usa o slug ao invés do company_id.
 */
router.post('/:slug/orders', ctrl.createOrder);

export { router as menuRoutes };
