/**
 * @file order.routes.ts
 * @description Rotas do domínio de Pedidos.
 *
 * Cobre todos os fluxos:
 *  - CRUD completo de pedidos (admin/staff)
 *  - Máquina de estados (pending → confirmed → preparing → ready → dispatched → delivered)
 *  - Criação pública via cardápio web e QR Code de mesa
 *  - Impressão de pedidos
 *  - Listagem em tempo real (SSE — Server-Sent Events)
 *
 * @module routes/orders
 */

import { Router }                  from 'express';
import { OrderController }         from '@/controllers/order.controller';
import { authenticate }            from '@/middlewares/authenticate';
import { authenticateQR }          from '@/middlewares/authenticate';
import { authorize }               from '@/middlewares/authorize';
import { validate }                from '@/middlewares/validate';
import { orderCreationLimiter }    from '@/app';
import {
  createOrderSchema,
  createOrderFromTableSchema,
  updateOrderStatusSchema,
  listOrdersSchema,
  addOrderItemSchema,
  orderPaymentSchema,
} from '@/validators/order.validators';

const router = Router();
const ctrl   = new OrderController();

// ---------------------------------------------------------------------------
// Rotas Públicas — Criação de pedidos por clientes (web / QR Code)
// ---------------------------------------------------------------------------

/**
 * POST /api/v1/orders/public
 * Cria um pedido via cardápio web (delivery ou retirada).
 * Não exige autenticação de funcionário.
 */
router.post(
  '/public',
  orderCreationLimiter,
  validate(createOrderSchema),
  ctrl.createPublic,
);

/**
 * POST /api/v1/orders/table
 * Cria um pedido via QR Code de mesa.
 * Autenticação via token de mesa (header x-table-token).
 */
router.post(
  '/table',
  orderCreationLimiter,
  authenticateQR,
  validate(createOrderFromTableSchema),
  ctrl.createFromTable,
);

/**
 * GET /api/v1/orders/track/:id
 * Rastreia o status de um pedido público (sem autenticação de staff).
 * Retorna apenas campos públicos (status, estimated_time, etc).
 */
router.get('/track/:id', ctrl.track);

// ---------------------------------------------------------------------------
// Rotas Protegidas — Staff (autenticação obrigatória)
// ---------------------------------------------------------------------------

router.use(authenticate);

/**
 * GET /api/v1/orders
 * Lista pedidos com filtros, paginação e ordenação.
 * Suporta filtros por: status, type, origin, date range, customer.
 */
router.get('/', validate(listOrdersSchema), ctrl.list);

/**
 * GET /api/v1/orders/stream
 * Stream SSE de novos pedidos em tempo real (para o painel do restaurante).
 * Mantém a conexão aberta e envia eventos quando há novos pedidos.
 */
router.get('/stream', ctrl.stream);

/**
 * GET /api/v1/orders/stats
 * Estatísticas rápidas do dia (total, por status, ticket médio).
 */
router.get('/stats', ctrl.stats);

/**
 * GET /api/v1/orders/:id
 * Retorna detalhes completos de um pedido (itens, adicionais, pagamentos).
 */
router.get('/:id', ctrl.findById);

/**
 * POST /api/v1/orders
 * Cria um pedido via PDV (frente de caixa).
 */
router.post(
  '/',
  validate(createOrderSchema),
  ctrl.create,
);

/**
 * PATCH /api/v1/orders/:id/status
 * Atualiza o status do pedido seguindo a máquina de estados.
 * Valida transições permitidas por role.
 */
router.patch(
  '/:id/status',
  validate(updateOrderStatusSchema),
  ctrl.updateStatus,
);

/**
 * PATCH /api/v1/orders/:id/assign
 * Atribui um funcionário responsável ao pedido.
 */
router.patch('/:id/assign', ctrl.assign);

/**
 * POST /api/v1/orders/:id/items
 * Adiciona um item a um pedido em aberto (ex: cliente adiciona mais itens na mesa).
 */
router.post(
  '/:id/items',
  validate(addOrderItemSchema),
  ctrl.addItem,
);

/**
 * DELETE /api/v1/orders/:id/items/:itemId
 * Remove um item de um pedido em aberto.
 * Apenas managers, admins e owners.
 */
router.delete(
  '/:id/items/:itemId',
  authorize('owner', 'admin', 'manager'),
  ctrl.removeItem,
);

/**
 * POST /api/v1/orders/:id/payments
 * Registra um pagamento para o pedido.
 */
router.post(
  '/:id/payments',
  validate(orderPaymentSchema),
  ctrl.addPayment,
);

/**
 * POST /api/v1/orders/:id/print
 * Envia o pedido para impressão (retorna dados formatados para impressora térmica).
 */
router.post('/:id/print', ctrl.print);

/**
 * POST /api/v1/orders/:id/cancel
 * Cancela o pedido (com motivo obrigatório).
 * Managers, admins e owners podem cancelar qualquer pedido.
 * Cashiers e waiters só podem cancelar pedidos ainda em 'pending'.
 */
router.post('/:id/cancel', ctrl.cancel);

/**
 * DELETE /api/v1/orders/:id
 * Remove permanentemente um pedido (apenas owners/admins).
 * Soft-delete não aplicável aqui — pedidos são registros financeiros.
 */
router.delete(
  '/:id',
  authorize('owner', 'admin'),
  ctrl.delete,
);

export { router as orderRoutes };
