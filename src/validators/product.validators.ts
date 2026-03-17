/**
 * @file product.validators.ts
 * @description Schemas de validação Zod para o domínio de Cardápio.
 * CORREÇÃO: updateProductSchema definido separadamente sem usar .partial()
 * em ZodEffects (resultado de .refine()), o que causava erro de tipagem.
 */

import { z } from 'zod';

// ---------------------------------------------------------------------------
// Sub-schemas reutilizáveis
// ---------------------------------------------------------------------------

const variationSchema = z.object({
  name     : z.string().min(1).max(100),
  price    : z.number().nonnegative('Preço da variação não pode ser negativo.'),
  sortOrder: z.number().int().min(0).optional(),
});

const dayOfWeekSchema = z.enum([
  'sunday','monday','tuesday','wednesday','thursday','friday','saturday',
]);

const timeSchema = z
  .string()
  .regex(/^([01]\d|2[0-3]):([0-5]\d)$/, 'Horário inválido. Use HH:MM.')
  .optional();

// ---------------------------------------------------------------------------
// Schema base do produto (sem .refine() para poder usar .partial())
// ---------------------------------------------------------------------------

const productBaseSchema = z.object({
  categoryId       : z.string().uuid().optional(),
  name             : z.string().min(2, 'Nome deve ter ao menos 2 caracteres.').max(200),
  description      : z.string().max(1000).optional(),
  basePrice        : z.number().nonnegative('Preço base não pode ser negativo.'),
  promotionalPrice : z.number().nonnegative().optional(),
  costPrice        : z.number().nonnegative().optional(),
  serves           : z.number().int().min(1).max(100).optional().default(1),
  prepTime         : z.number().int().min(1).max(480).optional(),
  calories         : z.number().int().min(0).optional(),
  tags             : z.array(z.string().max(50)).max(10).optional().default([]),
  isActive         : z.boolean().optional().default(true),
  isFeatured       : z.boolean().optional().default(false),
  sortOrder        : z.number().int().min(0).optional(),
  stockControl     : z.boolean().optional().default(false),
  stockQuantity    : z.number().int().min(0).optional(),
  stockAlertAt     : z.number().int().min(0).optional(),
  availableFrom    : timeSchema,
  availableUntil   : timeSchema,
  availableDays    : z.array(dayOfWeekSchema).optional(),
  variations       : z.array(variationSchema).max(20).optional(),
  additionalGroupIds: z.array(z.string().uuid()).max(10).optional(),
});

// ---------------------------------------------------------------------------
// createProductSchema — com validação de preço promocional
// ---------------------------------------------------------------------------

export const createProductSchema = z.object({
  body: productBaseSchema.refine(
    (d) => !d.promotionalPrice || d.promotionalPrice < d.basePrice,
    { message: 'Preço promocional deve ser menor que o preço base.', path: ['promotionalPrice'] },
  ),
});

// ---------------------------------------------------------------------------
// updateProductSchema — usa .partial() no schema BASE (sem .refine())
// CORREÇÃO: .partial() aplicado em productBaseSchema, não em createProductSchema
// (que é um ZodEffects após o .refine())
// ---------------------------------------------------------------------------

export const updateProductSchema = z.object({
  params: z.object({ id: z.string().uuid() }),
  body  : productBaseSchema.partial(),
});

// ---------------------------------------------------------------------------
// createCategorySchema
// ---------------------------------------------------------------------------

export const createCategorySchema = z.object({
  body: z.object({
    name          : z.string().min(2).max(100),
    description   : z.string().max(500).optional(),
    imageUrl      : z.string().url().optional(),
    color         : z.string().regex(/^#[0-9A-Fa-f]{6}$/, 'Cor inválida. Use hex (#RRGGBB).').optional(),
    sortOrder     : z.number().int().min(0).optional(),
    isActive      : z.boolean().optional().default(true),
    availableFrom : timeSchema,
    availableUntil: timeSchema,
    availableDays : z.array(dayOfWeekSchema).optional(),
  }),
});

// ---------------------------------------------------------------------------
// updateCategorySchema
// ---------------------------------------------------------------------------

export const updateCategorySchema = z.object({
  params: z.object({ id: z.string().uuid() }),
  body  : createCategorySchema.shape.body.partial(),
});

// ---------------------------------------------------------------------------
// reorderSchema
// ---------------------------------------------------------------------------

export const reorderSchema = z.object({
  body: z.object({
    items: z.array(
      z.object({
        id        : z.string().uuid(),
        sort_order: z.number().int().min(0),
      }),
    ).min(1).max(200),
  }),
});

// ---------------------------------------------------------------------------
// createAdditionalGroupSchema
// ---------------------------------------------------------------------------

export const createAdditionalGroupSchema = z.object({
  body: z.object({
    name       : z.string().min(2).max(100),
    description: z.string().max(300).optional(),
    minSelect  : z.number().int().min(0).max(50).default(0),
    maxSelect  : z.number().int().min(1).max(50).default(1),
    isRequired : z.boolean().default(false),
  }).refine(
    (d) => d.minSelect <= d.maxSelect,
    { message: 'Mínimo de seleções não pode ser maior que o máximo.', path: ['minSelect'] },
  ),
});

// ---------------------------------------------------------------------------
// createAdditionalSchema
// ---------------------------------------------------------------------------

export const createAdditionalSchema = z.object({
  params: z.object({ id: z.string().uuid() }),
  body  : z.object({
    name       : z.string().min(1).max(200),
    description: z.string().max(300).optional(),
    price      : z.number().nonnegative('Preço não pode ser negativo.'),
    sortOrder  : z.number().int().min(0).optional().default(0),
  }),
});

// ---------------------------------------------------------------------------
// productQuerySchema
// ---------------------------------------------------------------------------

export const productQuerySchema = z.object({
  query: z.object({
    page      : z.coerce.number().int().min(1).default(1),
    limit     : z.coerce.number().int().min(1).max(100).default(50),
    categoryId: z.string().uuid().optional(),
    isActive  : z.enum(['true', 'false']).optional(),
    isFeatured: z.enum(['true', 'false']).optional(),
    search    : z.string().max(100).optional(),
  }),
});

// ---------------------------------------------------------------------------
// Tipos inferidos
// ---------------------------------------------------------------------------

export type CreateProductInput         = z.infer<typeof createProductSchema>['body'];
export type UpdateProductInput         = z.infer<typeof updateProductSchema>['body'];
export type CreateCategoryInput        = z.infer<typeof createCategorySchema>['body'];
export type CreateAdditionalInput      = z.infer<typeof createAdditionalSchema>['body'];
export type CreateAdditionalGroupInput = z.infer<typeof createAdditionalGroupSchema>['body'];
export type ProductQuery               = z.infer<typeof productQuerySchema>['query'];
