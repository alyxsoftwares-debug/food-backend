/**
 * @file table.routes.ts
 * @description Rotas do domínio de Mesas.
 *
 * Cobre:
 *  - CRUD completo de mesas
 *  - Geração e regeneração de QR Codes
 *  - Controle de status (available / occupied / reserved / maintenance)
 *  - Abertura e fechamento de comandas
 *  - Visualização do painel de mesas em tempo real
 *
 * @module routes/tables
 */

import { Router }          from 'express';
import { TableController } from '@/controllers/table.controller';
import { authenticate }    from '@/middlewares/authenticate';
import { authorize }       from '@/middlewares/authorize';
import { validate }        from '@/middlewares/validate';
import {
  createTableSchema,
  updateTableSchema,
  updateTableStatusSchema,
  bulkCreateTableSchema,
} from '@/validators/table.validators';

const router = Router();
const ctrl   = new TableController();

// Todas as rotas de mesa exigem autenticação
router.use(authenticate);

// ---------------------------------------------------------------------------
// Painel
// ---------------------------------------------------------------------------

/**
 * GET /api/v1/tables/dashboard
 * Retorna todas as mesas com status atual, pedido ativo e tempo de ocupação.
 * Usado pelo painel visual de mesas (planta baixa do restaurante).
 */
router.get('/dashboard', ctrl.dashboard);

// ---------------------------------------------------------------------------
// CRUD
// ---------------------------------------------------------------------------

/**
 * GET /api/v1/tables
 * Lista todas as mesas da empresa com filtros opcionais de status e local.
 */
router.get('/', ctrl.list);

/**
 * GET /api/v1/tables/:id
 * Retorna detalhes de uma mesa, incluindo pedido ativo completo.
 */
router.get('/:id', ctrl.findById);

/**
 * POST /api/v1/tables
 * Cria uma nova mesa.
 */
router.post(
  '/',
  authorize('owner', 'admin', 'manager'),
  validate(createTableSchema),
  ctrl.create,
);

/**
 * POST /api/v1/tables/bulk
 * Cria múltiplas mesas em lote (ex: Mesa 01 a Mesa 20).
 * Útil para configuração inicial do estabelecimento.
 */
router.post(
  '/bulk',
  authorize('owner', 'admin'),
  validate(bulkCreateTableSchema),
  ctrl.bulkCreate,
);

/**
 * PUT /api/v1/tables/:id
 * Atualiza os dados de uma mesa (nome, capacidade, local).
 */
router.put(
  '/:id',
  authorize('owner', 'admin', 'manager'),
  validate(updateTableSchema),
  ctrl.update,
);

/**
 * DELETE /api/v1/tables/:id
 * Remove uma mesa (apenas se estiver disponível e sem pedidos ativos).
 */
router.delete(
  '/:id',
  authorize('owner', 'admin'),
  ctrl.delete,
);

// ---------------------------------------------------------------------------
// Controle de Status
// ---------------------------------------------------------------------------

/**
 * PATCH /api/v1/tables/:id/status
 * Atualiza manualmente o status de uma mesa.
 * (available | occupied | reserved | maintenance)
 */
router.patch(
  '/:id/status',
  authorize('owner', 'admin', 'manager', 'waiter', 'cashier'),
  validate(updateTableStatusSchema),
  ctrl.updateStatus,
);

/**
 * POST /api/v1/tables/:id/open
 * Abre uma comanda na mesa (cria pedido do tipo 'table' vinculado).
 * Muda o status de 'available' para 'occupied'.
 */
router.post(
  '/:id/open',
  authorize('owner', 'admin', 'manager', 'waiter', 'cashier'),
  ctrl.openTab,
);

/**
 * POST /api/v1/tables/:id/close
 * Fecha a comanda da mesa (finaliza o pedido ativo).
 * Muda o status para 'available'.
 */
router.post(
  '/:id/close',
  authorize('owner', 'admin', 'manager', 'waiter', 'cashier'),
  ctrl.closeTab,
);

/**
 * POST /api/v1/tables/:id/transfer
 * Transfere o pedido ativo de uma mesa para outra.
 */
router.post(
  '/:id/transfer',
  authorize('owner', 'admin', 'manager'),
  ctrl.transfer,
);

// ---------------------------------------------------------------------------
// QR Code
// ---------------------------------------------------------------------------

/**
 * POST /api/v1/tables/:id/qrcode/regenerate
 * Regenera o token do QR Code da mesa (invalida o QR anterior).
 * Útil quando o QR impresso foi comprometido.
 */
router.post(
  '/:id/qrcode/regenerate',
  authorize('owner', 'admin', 'manager'),
  ctrl.regenerateQrCode,
);

/**
 * GET /api/v1/tables/:id/qrcode
 * Retorna a imagem PNG do QR Code da mesa para impressão/exibição.
 * Content-Type: image/png
 */
router.get('/:id/qrcode', ctrl.getQrCode);

/**
 * GET /api/v1/tables/qrcode/bulk-pdf
 * Gera um PDF com todos os QR Codes das mesas para impressão em lote.
 */
router.get(
  '/qrcode/bulk-pdf',
  authorize('owner', 'admin', 'manager'),
  ctrl.bulkQrCodePdf,
);

export { router as tableRoutes };
