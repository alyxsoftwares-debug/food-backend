/**
 * @file order.validators.ts
 * @description Schemas de validação Zod para todas as rotas de pedidos.
 *
 * @module validators/order
 */

import { z } from 'zod';

// ---------------------------------------------------------------------------
// Sub-schemas reutilizáveis
// ---------------------------------------------------------------------------

const additionalItemSchema = z.object({
  additionalId: z.string().uuid('ID do adicional inválido.'),
  quantity    : z.number().int().min(1).max(20).default(1),
});

const orderItemSchema = z.object({
  productId  : z.string().uuid('ID do produto inválido.'),
  variationId: z.string().uuid().optional(),
  quantity   : z.number().int().min(1, 'Quantidade mínima é 1.').max(99),
  notes      : z.string().max(200).optional(),
  additionals: z.array(additionalItemSchema).max(20).optional().default([]),
});

const deliveryAddressSchema = z.object({
  street      : z.string().min(1).max(255),
  number      : z.string().max(20),
  complement  : z.string().max(100).optional(),
  neighborhood: z.string().min(1).max(100),
  city        : z.string().min(1).max(100),
  state       : z.string().length(2),
  zip         : z.string().regex(/^\d{5}-?\d{3}$/, 'CEP inválido.'),
  lat         : z.number().optional(),
  lng         : z.number().optional(),
});

// ---------------------------------------------------------------------------
// createOrderSchema — POST /orders (PDV e público)
// ---------------------------------------------------------------------------

export const createOrderSchema = z.object({
  body: z.object({
    companyId      : z.string().uuid('company_id inválido.'),
    type           : z.enum(['delivery', 'pickup', 'table', 'pdv']),
    items          : z.array(orderItemSchema).min(1, 'O pedido deve ter ao menos 1 item.').max(50),
    customerName   : z.string().min(2).max(200).optional(),
    customerPhone  : z
      .string()
      .regex(/^\(?\d{2}\)?\s?\d{4,5}-?\d{4}$/, 'Telefone inválido.')
      .optional(),
    deliveryAddress: deliveryAddressSchema.optional(),
    notes          : z.string().max(500).optional(),
    discountCode   : z.string().max(50).optional(),
    scheduledTo    : z.string().datetime().optional(),
    paymentMethod  : z.enum(['cash', 'credit_card', 'debit_card', 'pix', 'online', 'other']).optional(),
  }).refine(
    (data) => data.type !== 'delivery' || !!data.deliveryAddress,
    { message: 'Endereço de entrega obrigatório para pedidos delivery.', path: ['deliveryAddress'] },
  ).refine(
    (data) => data.type !== 'delivery' || !!data.customerPhone,
    { message: 'Telefone obrigatório para pedidos delivery.', path: ['customerPhone'] },
  ),
});

// ---------------------------------------------------------------------------
// createOrderFromTableSchema — POST /orders/table
// ---------------------------------------------------------------------------

export const createOrderFromTableSchema = z.object({
  body: z.object({
    items        : z.array(orderItemSchema).min(1).max(50),
    customerName : z.string().min(2).max(200).optional(),
    notes        : z.string().max(500).optional(),
  }),
});

// ---------------------------------------------------------------------------
// updateOrderStatusSchema — PATCH /orders/:id/status
// ---------------------------------------------------------------------------

export const updateOrderStatusSchema = z.object({
  params: z.object({
    id: z.string().uuid('ID do pedido inválido.'),
  }),
  body: z.object({
    status       : z.enum(['confirmed', 'preparing', 'ready', 'dispatched', 'delivered', 'cancelled', 'rejected']),
    estimatedTime: z.number().int().min(1).max(999).optional(),
    reason       : z.string().max(500).optional(),
  }),
});

// ---------------------------------------------------------------------------
// listOrdersSchema — GET /orders
// ---------------------------------------------------------------------------

export const listOrdersSchema = z.object({
  query: z.object({
    page    : z.coerce.number().int().min(1).default(1),
    limit   : z.coerce.number().int().min(1).max(100).default(20),
    status  : z.enum(['pending','confirmed','preparing','ready','dispatched','delivered','cancelled','rejected']).optional(),
    type    : z.enum(['delivery','pickup','table','pdv']).optional(),
    origin  : z.enum(['whatsapp','web','pdv','table','app']).optional(),
    dateFrom: z.string().datetime().optional(),
    dateTo  : z.string().datetime().optional(),
    search  : z.string().max(100).optional(),
  }),
});

// ---------------------------------------------------------------------------
// addOrderItemSchema — POST /orders/:id/items
// ---------------------------------------------------------------------------

export const addOrderItemSchema = z.object({
  params: z.object({
    id: z.string().uuid(),
  }),
  body: orderItemSchema,
});

// ---------------------------------------------------------------------------
// orderPaymentSchema — POST /orders/:id/payments
// ---------------------------------------------------------------------------

export const orderPaymentSchema = z.object({
  params: z.object({
    id: z.string().uuid(),
  }),
  body: z.object({
    method      : z.enum(['cash','credit_card','debit_card','pix','voucher','online','other']),
    amount      : z.number().positive('Valor deve ser positivo.'),
    changeAmount: z.number().min(0).optional().default(0),
    reference   : z.string().max(200).optional(),
    notes       : z.string().max(300).optional(),
  }),
});

// ---------------------------------------------------------------------------
// Tipos inferidos
// ---------------------------------------------------------------------------

export type CreateOrderInput       = z.infer<typeof createOrderSchema>['body'];
export type UpdateOrderStatusInput = z.infer<typeof updateOrderStatusSchema>['body'];
export type ListOrdersQuery        = z.infer<typeof listOrdersSchema>['query'];
export type OrderPaymentInput      = z.infer<typeof orderPaymentSchema>['body'];
