/**
 * @file order.service.ts
 * @description Service do domínio de Pedidos — toda a lógica de negócio.
 *
 * Responsabilidades:
 *  - CRUD de pedidos com validações de negócio
 *  - Máquina de estados (transições de status com regras por role)
 *  - Validação de itens, produtos, estoque e adicionais
 *  - Cálculo de totais, taxas e fretes
 *  - Upsert de clientes pela phone
 *  - Pub/Sub em memória para SSE (Server-Sent Events)
 *  - Formatação de dados para impressão térmica
 *
 * @module services/order
 */

import { pgPool, withTransaction }  from '@/config/supabase';
import { AppError, ErrorCode }       from '@/errors/AppError';
import { logger }                    from '@/config/logger';
import type { AuthUser }             from '@/types/auth.types';

// ---------------------------------------------------------------------------
// Tipos internos
// ---------------------------------------------------------------------------

type OrderStatus =
  | 'pending' | 'confirmed' | 'preparing'
  | 'ready'   | 'dispatched'| 'delivered'
  | 'cancelled'| 'rejected';

type OrderType   = 'delivery' | 'pickup' | 'table' | 'pdv';
type OrderOrigin = 'whatsapp' | 'web' | 'pdv' | 'table' | 'app';

interface OrderItemInput {
  productId   : string;
  variationId?: string;
  quantity    : number;
  notes?      : string;
  additionals?: Array<{ additionalId: string; quantity: number }>;
}

interface CreateOrderDTO {
  companyId      : string;
  createdBy?     : string;
  origin         : OrderOrigin;
  type           : OrderType;
  tableId?       : string;
  customerId?    : string;
  customerName?  : string;
  customerPhone? : string;
  deliveryAddress?: Record<string, unknown>;
  items          : OrderItemInput[];
  notes?         : string;
  discountCode?  : string;
  scheduledTo?   : string;
  paymentMethod? : string;
}

interface UpdateStatusDTO {
  id           : string;
  companyId    : string;
  newStatus    : string;
  updatedBy    : AuthUser;
  estimatedTime?: number;
}

interface AddPaymentDTO {
  orderId  : string;
  companyId: string;
  payment  : {
    method       : string;
    amount       : number;
    changeAmount?: number;
    reference?   : string;
    notes?       : string;
  };
}

interface PrintDataDTO {
  orderId  : string;
  companyId: string;
}

interface SSEEvent {
  type: 'new_order' | 'status_changed' | 'item_added';
  data: Record<string, unknown>;
}

// ---------------------------------------------------------------------------
// Máquina de estados
// Define quais transições de status são permitidas e quais roles podem fazê-las.
// ---------------------------------------------------------------------------

const STATUS_TRANSITIONS: Record<OrderStatus, OrderStatus[]> = {
  pending   : ['confirmed', 'rejected', 'cancelled'],
  confirmed : ['preparing', 'cancelled'],
  preparing : ['ready', 'cancelled'],
  ready     : ['dispatched', 'delivered'],
  dispatched: ['delivered'],
  delivered : [],  // Estado final
  cancelled : [],  // Estado final
  rejected  : [],  // Estado final
};

/** Roles que podem confirmar/rejeitar pedidos */
const CAN_CONFIRM: Array<AuthUser['role']>  = ['owner', 'admin', 'manager', 'cashier'];

/** Roles que podem atualizar status de cozinha (preparing → ready) */
const CAN_KITCHEN: Array<AuthUser['role']>  = ['owner', 'admin', 'manager', 'kitchen', 'cashier'];

/** Roles que podem marcar como despachado/entregue */
const CAN_DISPATCH: Array<AuthUser['role']> = ['owner', 'admin', 'manager', 'cashier', 'waiter'];

function getRolesForTransition(to: OrderStatus): Array<AuthUser['role']> {
  if (['confirmed', 'rejected'].includes(to)) return CAN_CONFIRM;
  if (['preparing', 'ready'].includes(to))    return CAN_KITCHEN;
  if (['dispatched', 'delivered'].includes(to)) return CAN_DISPATCH;
  if (to === 'cancelled') return ['owner', 'admin', 'manager', 'cashier', 'waiter'];
  return ['owner', 'admin'];
}

// ---------------------------------------------------------------------------
// Pub/Sub em memória para SSE
// Mantém um Map de companyId → Set de callbacks de subscribers.
// ---------------------------------------------------------------------------

type SSECallback = (event: SSEEvent) => void;
const sseSubscribers = new Map<string, Set<SSECallback>>();

// ---------------------------------------------------------------------------
// OrderService
// ---------------------------------------------------------------------------

export class OrderService {

  // ---------------------------------------------------------------------------
  // list
  // ---------------------------------------------------------------------------

  async list({ companyId, filters }: { companyId: string; filters: Record<string, string> }) {
    const page  = Math.max(1, Number(filters.page  ?? 1));
    const limit = Math.min(100, Math.max(1, Number(filters.limit ?? 20)));
    const offset = (page - 1) * limit;

    // Construção dinâmica de filtros SQL
    const conditions: string[] = ['o.company_id = $1'];
    const params: unknown[]    = [companyId];
    let   paramIdx             = 2;

    if (filters.status) {
      conditions.push(`o.status = $${paramIdx++}`);
      params.push(filters.status);
    }

    if (filters.type) {
      conditions.push(`o.type = $${paramIdx++}`);
      params.push(filters.type);
    }

    if (filters.origin) {
      conditions.push(`o.origin = $${paramIdx++}`);
      params.push(filters.origin);
    }

    if (filters.dateFrom) {
      conditions.push(`o.created_at >= $${paramIdx++}`);
      params.push(filters.dateFrom);
    }

    if (filters.dateTo) {
      conditions.push(`o.created_at <= $${paramIdx++}`);
      params.push(filters.dateTo);
    }

    if (filters.search) {
      conditions.push(
        `(o.customer_name ILIKE $${paramIdx} OR o.sequential_number::text = $${paramIdx})`,
      );
      params.push(`%${filters.search}%`);
      paramIdx++;
    }

    const where = conditions.join(' AND ');

    const [ordersResult, countResult] = await Promise.all([
      pgPool.query(
        `SELECT
           o.id, o.sequential_number, o.origin, o.type, o.status,
           o.customer_name, o.customer_phone, o.total, o.payment_status,
           o.estimated_time, o.created_at, o.confirmed_at, o.delivered_at,
           t.identifier AS table_identifier,
           u.name       AS assigned_to_name
         FROM food.orders o
         LEFT JOIN food.tables t ON t.id = o.table_id
         LEFT JOIN food.users  u ON u.id = o.assigned_to
         WHERE ${where}
         ORDER BY o.created_at DESC
         LIMIT $${paramIdx} OFFSET $${paramIdx + 1}`,
        [...params, limit, offset],
      ),
      pgPool.query(
        `SELECT COUNT(*) AS total FROM food.orders o WHERE ${where}`,
        params,
      ),
    ]);

    const total     = Number(countResult.rows[0].total);
    const totalPages = Math.ceil(total / limit);

    return {
      orders    : ordersResult.rows,
      pagination: { page, limit, total, totalPages },
    };
  }

  // ---------------------------------------------------------------------------
  // findById
  // ---------------------------------------------------------------------------

  async findById({ id, companyId }: { id: string; companyId: string }) {
    const { rows } = await pgPool.query(
      `SELECT * FROM food.v_orders_full
       WHERE id = $1 AND company_id = $2
       LIMIT 1`,
      [id, companyId],
    );

    if (rows.length === 0) {
      throw new AppError('Pedido não encontrado.', 404, ErrorCode.ORDER_NOT_FOUND);
    }

    return rows[0];
  }

  // ---------------------------------------------------------------------------
  // trackPublic
  // ---------------------------------------------------------------------------

  async trackPublic(id: string) {
    const { rows } = await pgPool.query(
      `SELECT
         id, sequential_number, status, type, origin,
         customer_name, estimated_time, created_at,
         confirmed_at, preparing_at, ready_at,
         dispatched_at, delivered_at
       FROM food.orders
       WHERE id = $1
       LIMIT 1`,
      [id],
    );

    if (rows.length === 0) {
      throw new AppError('Pedido não encontrado.', 404, ErrorCode.ORDER_NOT_FOUND);
    }

    return rows[0];
  }

  // ---------------------------------------------------------------------------
  // getDailyStats
  // ---------------------------------------------------------------------------

  async getDailyStats(companyId: string) {
    const { rows } = await pgPool.query(
      `SELECT
         COUNT(*)                                                  AS total_orders,
         COUNT(*) FILTER (WHERE status = 'pending')               AS pending,
         COUNT(*) FILTER (WHERE status = 'confirmed')             AS confirmed,
         COUNT(*) FILTER (WHERE status = 'preparing')             AS preparing,
         COUNT(*) FILTER (WHERE status = 'ready')                 AS ready,
         COUNT(*) FILTER (WHERE status = 'delivered')             AS delivered,
         COUNT(*) FILTER (WHERE status = 'cancelled')             AS cancelled,
         COALESCE(SUM(total) FILTER (WHERE status = 'delivered'), 0) AS revenue,
         COALESCE(AVG(total) FILTER (WHERE status = 'delivered'), 0) AS avg_ticket,
         COUNT(*) FILTER (WHERE type = 'delivery')                AS delivery_count,
         COUNT(*) FILTER (WHERE type = 'pickup')                  AS pickup_count,
         COUNT(*) FILTER (WHERE type = 'table')                   AS table_count
       FROM food.orders
       WHERE company_id = $1
         AND created_at >= CURRENT_DATE
         AND created_at <  CURRENT_DATE + INTERVAL '1 day'`,
      [companyId],
    );

    return rows[0];
  }

  // ---------------------------------------------------------------------------
  // create
  // ---------------------------------------------------------------------------

  async create(dto: CreateOrderDTO) {
    return withTransaction(async (client) => {
      // 1. Valida empresa e configurações de entrega
      const { rows: settingsRows } = await client.query(
        `SELECT ds.*, c.timezone
         FROM food.delivery_settings ds
         JOIN food.companies c ON c.id = ds.company_id
         WHERE ds.company_id = $1`,
        [dto.companyId],
      );

      if (settingsRows.length === 0) {
        throw new AppError('Empresa não encontrada.', 404, ErrorCode.COMPANY_NOT_FOUND);
      }

      const settings = settingsRows[0];

      // 2. Valida disponibilidade do tipo de pedido
      if (dto.type === 'delivery' && !settings.is_delivery_enabled) {
        throw new AppError('Delivery não está disponível no momento.', 400, ErrorCode.DELIVERY_NOT_AVAILABLE);
      }

      if (dto.type === 'pickup' && !settings.is_pickup_enabled) {
        throw new AppError('Retirada não está disponível no momento.', 400, ErrorCode.DELIVERY_NOT_AVAILABLE);
      }

      if (!dto.items?.length) {
        throw AppError.validation('O pedido deve conter pelo menos um item.');
      }

      // 3. Valida e calcula itens
      let subtotal = 0;
      const resolvedItems: Array<{
        productId     : string;
        variationId?  : string;
        productName   : string;
        variationName?: string;
        unitPrice     : number;
        quantity      : number;
        itemSubtotal  : number;
        notes?        : string;
        additionals   : Array<{
          additionalId  : string;
          groupName     : string;
          additionalName: string;
          unitPrice     : number;
          quantity      : number;
        }>;
      }> = [];

      for (const item of dto.items) {
        // Busca produto
        const { rows: productRows } = await client.query(
          `SELECT id, name, base_price, is_active, stock_control, stock_quantity
           FROM food.products
           WHERE id = $1 AND company_id = $2
           LIMIT 1`,
          [item.productId, dto.companyId],
        );

        if (productRows.length === 0) {
          throw new AppError(
            `Produto não encontrado: ${item.productId}`,
            404,
            ErrorCode.PRODUCT_NOT_FOUND,
          );
        }

        const product = productRows[0];

        if (!product.is_active) {
          throw new AppError(`Produto "${product.name}" não está disponível.`, 400, ErrorCode.PRODUCT_UNAVAILABLE);
        }

        // Verifica estoque
        if (product.stock_control) {
          if ((product.stock_quantity ?? 0) < item.quantity) {
            throw new AppError(
              `Produto "${product.name}" sem estoque suficiente.`,
              400,
              ErrorCode.PRODUCT_OUT_OF_STOCK,
            );
          }
        }

        // Resolve variação
        let unitPrice    = Number(product.base_price);
        let variationName: string | undefined;

        if (item.variationId) {
          const { rows: varRows } = await client.query(
            `SELECT name, price FROM food.product_variations
             WHERE id = $1 AND product_id = $2 AND is_active = TRUE LIMIT 1`,
            [item.variationId, item.productId],
          );

          if (varRows.length === 0) {
            throw AppError.validation(`Variação inválida para o produto "${product.name}".`);
          }

          unitPrice     = Number(varRows[0].price);
          variationName = varRows[0].name;
        }

        // Resolve adicionais
        const resolvedAdditionals: typeof resolvedItems[number]['additionals'] = [];

        for (const add of item.additionals ?? []) {
          const { rows: addRows } = await client.query(
            `SELECT a.id, a.name, a.price, ag.name AS group_name
             FROM food.additionals a
             JOIN food.additional_groups ag ON ag.id = a.group_id
             WHERE a.id = $1 AND a.company_id = $2 AND a.is_active = TRUE
             LIMIT 1`,
            [add.additionalId, dto.companyId],
          );

          if (addRows.length === 0) {
            throw AppError.validation(`Adicional não encontrado: ${add.additionalId}`);
          }

          resolvedAdditionals.push({
            additionalId  : addRows[0].id,
            groupName     : addRows[0].group_name,
            additionalName: addRows[0].name,
            unitPrice     : Number(addRows[0].price),
            quantity      : add.quantity,
          });

          unitPrice += Number(addRows[0].price) * add.quantity;
        }

        const itemSubtotal = unitPrice * item.quantity;
        subtotal += itemSubtotal;

        resolvedItems.push({
          productId    : product.id,
          variationId  : item.variationId,
          productName  : product.name,
          variationName,
          unitPrice,
          quantity     : item.quantity,
          itemSubtotal,
          notes        : item.notes,
          additionals  : resolvedAdditionals,
        });
      }

      // 4. Calcula frete (se delivery)
      let deliveryFee = 0;
      if (dto.type === 'delivery') {
        deliveryFee = Number(settings.base_delivery_fee ?? 0);

        if (settings.free_delivery_above && subtotal >= Number(settings.free_delivery_above)) {
          deliveryFee = 0;
        }
      }

      // 5. Valida pedido mínimo
      const minOrderValue = Number(settings.min_order_value ?? 0);
      if (subtotal < minOrderValue) {
        throw new AppError(
          `Pedido mínimo de R$ ${minOrderValue.toFixed(2)} não atingido.`,
          400,
          ErrorCode.ORDER_MINIMUM_NOT_MET,
          { minOrderValue, current: subtotal },
        );
      }

      // 6. Upsert do cliente (se phone informado)
      let customerId = dto.customerId ?? null;

      if (dto.customerPhone && !customerId) {
        const { rows: custRows } = await client.query(
          `INSERT INTO food.customers (company_id, name, phone)
           VALUES ($1, $2, $3)
           ON CONFLICT (company_id, phone) DO UPDATE
             SET name = EXCLUDED.name
           RETURNING id`,
          [dto.companyId, dto.customerName ?? 'Cliente', dto.customerPhone],
        );
        customerId = custRows[0].id;
      }

      const total = subtotal + deliveryFee;

      // 7. Insere o pedido (sequential_number gerado pelo trigger)
      const { rows: orderRows } = await client.query(
        `INSERT INTO food.orders (
           company_id, origin, type, status,
           customer_id, customer_name, customer_phone,
           table_id, assigned_to,
           subtotal, delivery_fee, total,
           delivery_address, notes, scheduled_to,
           estimated_time
         ) VALUES (
           $1,$2,$3,'pending',
           $4,$5,$6,
           $7,$8,
           $9,$10,$11,
           $12,$13,$14,
           $15
         )
         RETURNING *`,
        [
          dto.companyId,
          dto.origin,
          dto.type,
          customerId,
          dto.customerName ?? null,
          dto.customerPhone ?? null,
          dto.tableId  ?? null,
          dto.createdBy ?? null,
          subtotal,
          deliveryFee,
          total,
          dto.deliveryAddress ? JSON.stringify(dto.deliveryAddress) : null,
          dto.notes ?? null,
          dto.scheduledTo ?? null,
          dto.type === 'delivery'
            ? settings.estimated_delivery_time
            : settings.estimated_pickup_time,
        ],
      );

      const order = orderRows[0];

      // 8. Insere itens e adicionais
      for (let i = 0; i < resolvedItems.length; i++) {
        const item = resolvedItems[i];

        const { rows: itemRows } = await client.query(
          `INSERT INTO food.order_items
             (order_id, company_id, product_id, variation_id,
              product_name, variation_name, unit_price, quantity, subtotal, notes, sort_order)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
           RETURNING id`,
          [
            order.id, dto.companyId,
            item.productId, item.variationId ?? null,
            item.productName, item.variationName ?? null,
            item.unitPrice, item.quantity, item.itemSubtotal,
            item.notes ?? null, i,
          ],
        );

        const orderItemId = itemRows[0].id;

        for (const add of item.additionals) {
          await client.query(
            `INSERT INTO food.order_item_additionals
               (order_item_id, additional_id, group_name, additional_name, unit_price, quantity, subtotal)
             VALUES ($1,$2,$3,$4,$5,$6,$7)`,
            [
              orderItemId, add.additionalId,
              add.groupName, add.additionalName,
              add.unitPrice, add.quantity,
              add.unitPrice * add.quantity,
            ],
          );
        }

        // Desconta estoque (se controle ativo)
        await client.query(
          `UPDATE food.products
           SET stock_quantity = stock_quantity - $1
           WHERE id = $2 AND stock_control = TRUE`,
          [item.quantity, item.productId],
        );
      }

      // 9. Emite evento SSE para o painel do restaurante
      this.publishSSE(dto.companyId, {
        type: 'new_order',
        data: {
          id              : order.id,
          sequentialNumber: order.sequential_number,
          type            : order.type,
          origin          : order.origin,
          customerName    : order.customer_name,
          total           : order.total,
          createdAt       : order.created_at,
        },
      });

      return order;
    });
  }

  // ---------------------------------------------------------------------------
  // updateStatus
  // ---------------------------------------------------------------------------

  async updateStatus({ id, companyId, newStatus, updatedBy, estimatedTime }: UpdateStatusDTO) {
    const order = await this.findById({ id, companyId });

    // Valida transição
    const allowedTransitions = STATUS_TRANSITIONS[order.status as OrderStatus] ?? [];

    if (!allowedTransitions.includes(newStatus as OrderStatus)) {
      throw new AppError(
        `Transição de status inválida: "${order.status}" → "${newStatus}".`,
        400,
        ErrorCode.ORDER_INVALID_STATUS,
        { current: order.status, attempted: newStatus, allowed: allowedTransitions },
      );
    }

    // Valida permissão por role para a transição
    const allowedRoles = getRolesForTransition(newStatus as OrderStatus);

    if (!allowedRoles.includes(updatedBy.role)) {
      throw new AppError(
        `Seu cargo não permite alterar o pedido para "${newStatus}".`,
        403,
        ErrorCode.INSUFFICIENT_ROLE,
      );
    }

    // Monta campos de timestamp conforme novo status
    const timestampMap: Partial<Record<OrderStatus, string>> = {
      confirmed : 'confirmed_at',
      preparing : 'preparing_at',
      ready     : 'ready_at',
      dispatched: 'dispatched_at',
      delivered : 'delivered_at',
      cancelled : 'cancelled_at',
      rejected  : 'cancelled_at',
    };

    const timestampField = timestampMap[newStatus as OrderStatus];
    const extraFields    = timestampField ? `, ${timestampField} = NOW()` : '';
    const extraParams: unknown[] = [newStatus, id, companyId];

    let estimatedTimeUpdate = '';
    if (newStatus === 'confirmed' && estimatedTime) {
      estimatedTimeUpdate = `, estimated_time = $${extraParams.length + 1}`;
      extraParams.push(estimatedTime);
    }

    const { rows } = await pgPool.query(
      `UPDATE food.orders
       SET status = $1 ${extraFields} ${estimatedTimeUpdate}
       WHERE id = $2 AND company_id = $3
       RETURNING *`,
      extraParams,
    );

    const updated = rows[0];

    // Emite evento SSE
    this.publishSSE(companyId, {
      type: 'status_changed',
      data: {
        id    : updated.id,
        status: updated.status,
        sequentialNumber: updated.sequential_number,
      },
    });

    return updated;
  }

  // ---------------------------------------------------------------------------
  // assign
  // ---------------------------------------------------------------------------

  async assign({ id, companyId, userId }: { id: string; companyId: string; userId: string }) {
    const { rows } = await pgPool.query(
      `UPDATE food.orders
       SET assigned_to = $1
       WHERE id = $2 AND company_id = $3
       RETURNING *`,
      [userId, id, companyId],
    );

    if (rows.length === 0) {
      throw new AppError('Pedido não encontrado.', 404, ErrorCode.ORDER_NOT_FOUND);
    }

    return rows[0];
  }

  // ---------------------------------------------------------------------------
  // addItem
  // ---------------------------------------------------------------------------

  async addItem({
    orderId, companyId, item,
  }: { orderId: string; companyId: string; item: OrderItemInput }) {
    // Valida que o pedido ainda pode receber itens
    const { rows: orderRows } = await pgPool.query(
      `SELECT id, status FROM food.orders
       WHERE id = $1 AND company_id = $2 LIMIT 1`,
      [orderId, companyId],
    );

    if (orderRows.length === 0) {
      throw new AppError('Pedido não encontrado.', 404, ErrorCode.ORDER_NOT_FOUND);
    }

    const order = orderRows[0];
    const editableStatuses: OrderStatus[] = ['pending', 'confirmed', 'preparing'];

    if (!editableStatuses.includes(order.status)) {
      throw new AppError(
        'Não é possível adicionar itens a um pedido com este status.',
        400,
        ErrorCode.ORDER_INVALID_STATUS,
      );
    }

    // Busca produto e calcula preço
    const { rows: productRows } = await pgPool.query(
      `SELECT id, name, base_price, is_active FROM food.products
       WHERE id = $1 AND company_id = $2 LIMIT 1`,
      [item.productId, companyId],
    );

    if (productRows.length === 0 || !productRows[0].is_active) {
      throw new AppError('Produto não disponível.', 404, ErrorCode.PRODUCT_NOT_FOUND);
    }

    const product   = productRows[0];
    let unitPrice   = Number(product.base_price);

    if (item.variationId) {
      const { rows: varRows } = await pgPool.query(
        `SELECT price FROM food.product_variations WHERE id = $1 LIMIT 1`,
        [item.variationId],
      );
      if (varRows.length > 0) unitPrice = Number(varRows[0].price);
    }

    const { rows: itemRows } = await pgPool.query(
      `INSERT INTO food.order_items
         (order_id, company_id, product_id, variation_id,
          product_name, unit_price, quantity, subtotal, notes)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
       RETURNING id`,
      [
        orderId, companyId,
        product.id, item.variationId ?? null,
        product.name, unitPrice, item.quantity,
        unitPrice * item.quantity,
        item.notes ?? null,
      ],
    );

    this.publishSSE(companyId, {
      type: 'item_added',
      data: { orderId, itemId: itemRows[0].id },
    });

    return this.findById({ id: orderId, companyId });
  }

  // ---------------------------------------------------------------------------
  // removeItem
  // ---------------------------------------------------------------------------

  async removeItem({
    orderId, itemId, companyId,
  }: { orderId: string; itemId: string; companyId: string }) {
    const { rowCount } = await pgPool.query(
      `DELETE FROM food.order_items
       WHERE id = $1 AND order_id = $2 AND company_id = $3`,
      [itemId, orderId, companyId],
    );

    if (rowCount === 0) {
      throw AppError.notFound('Item do pedido', itemId);
    }

    return this.findById({ id: orderId, companyId });
  }

  // ---------------------------------------------------------------------------
  // addPayment
  // ---------------------------------------------------------------------------

  async addPayment({ orderId, companyId, payment }: AddPaymentDTO) {
    const order = await this.findById({ id: orderId, companyId });

    if (order.payment_status === 'paid') {
      throw new AppError('Este pedido já está pago.', 400, ErrorCode.PAYMENT_ALREADY_PAID);
    }

    return withTransaction(async (client) => {
      // Insere pagamento
      await client.query(
        `INSERT INTO food.order_payments
           (order_id, company_id, method, amount, change_amount, reference, notes)
         VALUES ($1,$2,$3,$4,$5,$6,$7)`,
        [
          orderId, companyId,
          payment.method, payment.amount,
          payment.changeAmount ?? 0,
          payment.reference ?? null,
          payment.notes ?? null,
        ],
      );

      // Calcula total já pago
      const { rows: paidRows } = await client.query(
        `SELECT COALESCE(SUM(amount), 0) AS total_paid
         FROM food.order_payments WHERE order_id = $1`,
        [orderId],
      );

      const totalPaid    = Number(paidRows[0].total_paid);
      const orderTotal   = Number(order.total);
      const newPaidStatus =
        totalPaid >= orderTotal ? 'paid' :
        totalPaid > 0           ? 'partial' : 'pending';

      await client.query(
        `UPDATE food.orders SET payment_status = $1 WHERE id = $2`,
        [newPaidStatus, orderId],
      );

      return this.findById({ id: orderId, companyId });
    });
  }

  // ---------------------------------------------------------------------------
  // cancel
  // ---------------------------------------------------------------------------

  async cancel({
    id, companyId, cancelledBy, reason,
  }: { id: string; companyId: string; cancelledBy: AuthUser; reason: string }) {
    const order = await this.findById({ id, companyId });

    const finalStatuses: OrderStatus[] = ['delivered', 'cancelled', 'rejected'];
    if (finalStatuses.includes(order.status as OrderStatus)) {
      throw new AppError(
        'Este pedido já foi finalizado e não pode ser cancelado.',
        400,
        ErrorCode.ORDER_ALREADY_CANCELLED,
      );
    }

    // Cashiers e waiters só podem cancelar pedidos em 'pending'
    if (
      ['cashier', 'waiter'].includes(cancelledBy.role) &&
      order.status !== 'pending'
    ) {
      throw new AppError(
        'Você só pode cancelar pedidos que ainda não foram confirmados.',
        403,
        ErrorCode.INSUFFICIENT_ROLE,
      );
    }

    const { rows } = await pgPool.query(
      `UPDATE food.orders
       SET status = 'cancelled', cancelled_at = NOW(), cancellation_reason = $1
       WHERE id = $2 AND company_id = $3
       RETURNING *`,
      [reason, id, companyId],
    );

    this.publishSSE(companyId, {
      type: 'status_changed',
      data: { id, status: 'cancelled', sequentialNumber: order.sequential_number },
    });

    return rows[0];
  }

  // ---------------------------------------------------------------------------
  // delete
  // ---------------------------------------------------------------------------

  async delete({ id, companyId }: { id: string; companyId: string }) {
    const { rowCount } = await pgPool.query(
      `DELETE FROM food.orders WHERE id = $1 AND company_id = $2`,
      [id, companyId],
    );

    if (rowCount === 0) {
      throw new AppError('Pedido não encontrado.', 404, ErrorCode.ORDER_NOT_FOUND);
    }
  }

  // ---------------------------------------------------------------------------
  // getPrintData — Formata dados para impressora térmica
  // ---------------------------------------------------------------------------

  async getPrintData({ orderId, companyId }: PrintDataDTO) {
    const order = await this.findById({ id: orderId, companyId });

    // Busca dados da empresa para o cabeçalho do cupom
    const { rows: companyRows } = await pgPool.query(
      `SELECT name, phone, whatsapp, address_street, address_number,
              address_neighborhood, address_city, address_state, logo_url
       FROM food.companies WHERE id = $1 LIMIT 1`,
      [companyId],
    );

    const company = companyRows[0] ?? {};

    // Atualiza contagem de impressões
    await pgPool.query(
      `UPDATE food.orders
       SET printed_at = NOW(), printed_count = printed_count + 1
       WHERE id = $1`,
      [orderId],
    );

    // Formata dados para impressão (compatível com ESC/POS)
    return {
      company: {
        name   : company.name,
        phone  : company.phone,
        address: [
          company.address_street,
          company.address_number,
          company.address_neighborhood,
          company.address_city,
          company.address_state,
        ].filter(Boolean).join(', '),
      },
      order: {
        id              : order.id,
        sequentialNumber: order.sequential_number,
        type            : order.type,
        origin          : order.origin,
        status          : order.status,
        createdAt       : order.created_at,
        customerName    : order.customer_name,
        customerPhone   : order.customer_phone,
        tableIdentifier : order.table_identifier,
        notes           : order.notes,
        deliveryAddress : order.delivery_address,
        estimatedTime   : order.estimated_time,
      },
      items: (order.items as unknown[]) ?? [],
      totals: {
        subtotal    : Number(order.subtotal),
        deliveryFee : Number(order.delivery_fee),
        discount    : Number(order.discount_amount),
        serviceFee  : Number(order.service_fee),
        total       : Number(order.total),
      },
      payments: (order.payments as unknown[]) ?? [],
      printedAt: new Date().toISOString(),
    };
  }

  // ---------------------------------------------------------------------------
  // SSE Pub/Sub
  // ---------------------------------------------------------------------------

  /**
   * Registra um subscriber para receber eventos de uma empresa específica.
   * Retorna uma função de unsubscribe.
   */
  subscribeToOrders(companyId: string, callback: SSECallback): () => void {
    if (!sseSubscribers.has(companyId)) {
      sseSubscribers.set(companyId, new Set());
    }

    sseSubscribers.get(companyId)!.add(callback);

    logger.debug(`[SSE] Novo subscriber para empresa ${companyId}. Total: ${sseSubscribers.get(companyId)!.size}`);

    return () => {
      sseSubscribers.get(companyId)?.delete(callback);
      if (sseSubscribers.get(companyId)?.size === 0) {
        sseSubscribers.delete(companyId);
      }
    };
  }

  private publishSSE(companyId: string, event: SSEEvent): void {
    const subscribers = sseSubscribers.get(companyId);
    if (!subscribers?.size) return;

    for (const cb of subscribers) {
      try {
        cb(event);
      } catch (err) {
        logger.error('[SSE] Erro ao emitir evento para subscriber:', err);
      }
    }
  }
}
