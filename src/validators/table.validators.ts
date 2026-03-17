/**
 * @file table.validators.ts
 * @description Schemas de validação Zod para o domínio de Mesas.
 *
 * @module validators/table
 */

import { z } from 'zod';

// ---------------------------------------------------------------------------
// createTableSchema
// ---------------------------------------------------------------------------

export const createTableSchema = z.object({
  body: z.object({
    identifier: z
      .string({ required_error: 'Identificador é obrigatório.' })
      .min(1)
      .max(20, 'Identificador deve ter no máximo 20 caracteres.'),
    name    : z.string().max(100).optional(),
    capacity: z.number().int().min(1).max(50).optional().default(4),
    location: z.string().max(100).optional(),
    isActive: z.boolean().optional().default(true),
  }),
});

// ---------------------------------------------------------------------------
// updateTableSchema
// ---------------------------------------------------------------------------

export const updateTableSchema = z.object({
  params: z.object({
    id: z.string().uuid('ID da mesa inválido.'),
  }),
  body: z.object({
    identifier: z.string().min(1).max(20).optional(),
    name      : z.string().max(100).optional(),
    capacity  : z.number().int().min(1).max(50).optional(),
    location  : z.string().max(100).optional(),
    isActive  : z.boolean().optional(),
  }),
});

// ---------------------------------------------------------------------------
// updateTableStatusSchema
// ---------------------------------------------------------------------------

export const updateTableStatusSchema = z.object({
  params: z.object({
    id: z.string().uuid(),
  }),
  body: z.object({
    status: z.enum(['available', 'reserved', 'maintenance'], {
      errorMap: () => ({
        message: 'Status inválido. Use: available, reserved ou maintenance.',
      }),
    }),
  }),
});

// ---------------------------------------------------------------------------
// bulkCreateTableSchema
// ---------------------------------------------------------------------------

export const bulkCreateTableSchema = z.object({
  body: z.object({
    prefix   : z.string().min(0).max(20).default('Mesa '),
    startAt  : z.number().int().min(1).default(1),
    count    : z
      .number({ required_error: 'Quantidade de mesas é obrigatória.' })
      .int()
      .min(1, 'Crie ao menos 1 mesa.')
      .max(100, 'Máximo de 100 mesas por vez.'),
    capacity : z.number().int().min(1).max(50).optional().default(4),
    location : z.string().max(100).optional(),
    padLength: z.number().int().min(1).max(4).optional().default(2),
  }),
});

// ---------------------------------------------------------------------------
// Tipos inferidos
// ---------------------------------------------------------------------------

export type CreateTableInput      = z.infer<typeof createTableSchema>['body'];
export type UpdateTableInput      = z.infer<typeof updateTableSchema>['body'];
export type UpdateTableStatusInput = z.infer<typeof updateTableStatusSchema>['body'];
export type BulkCreateTableInput  = z.infer<typeof bulkCreateTableSchema>['body'];
