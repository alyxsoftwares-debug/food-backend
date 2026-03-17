/**
 * @file validate.ts
 * @description Middleware de validação de entrada com Zod.
 *
 * Valida `req.body`, `req.params` e `req.query` contra um schema Zod.
 * Em caso de falha, retorna 422 com os erros formatados por campo.
 * Em caso de sucesso, substitui os valores originais pelos valores
 * parseados e transformados pelo Zod (ex: trim, lowercase, coerce).
 *
 * @module middlewares/validate
 */

import { Request, Response, NextFunction } from 'express';
import { ZodSchema, ZodError, z }          from 'zod';
import { AppError, ErrorCode }             from '@/errors/AppError';

// ---------------------------------------------------------------------------
// Tipos
// ---------------------------------------------------------------------------

interface ValidationError {
  field  : string;
  message: string;
}

// ---------------------------------------------------------------------------
// Formatador de erros Zod
// Converte ZodError para um array de { field, message } legível.
// ---------------------------------------------------------------------------

function formatZodErrors(error: ZodError): ValidationError[] {
  return error.errors.map((err) => ({
    field  : err.path.join('.') || 'root',
    message: err.message,
  }));
}

// ---------------------------------------------------------------------------
// Middleware factory: validate
// ---------------------------------------------------------------------------

/**
 * Valida o request contra um schema Zod que pode conter `body`, `params` e `query`.
 *
 * @param schema - Schema Zod com propriedades `body`, `params` e/ou `query`.
 *
 * @example
 * const mySchema = z.object({
 *   body  : z.object({ name: z.string().min(1) }),
 *   params: z.object({ id: z.string().uuid() }),
 * });
 *
 * router.put('/:id', validate(mySchema), controller.update);
 */
export function validate(schema: ZodSchema) {
  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const parsed = await schema.parseAsync({
        body  : req.body,
        params: req.params,
        query : req.query,
      });

      // Substitui os valores originais pelos parseados (com transforms aplicados)
      if (parsed.body   !== undefined) req.body   = parsed.body;
      if (parsed.params !== undefined) req.params = parsed.params;
      if (parsed.query  !== undefined) req.query  = parsed.query;

      next();
    } catch (error) {
      if (error instanceof ZodError) {
        const errors = formatZodErrors(error);

        res.status(422).json({
          success: false,
          error  : {
            code   : ErrorCode.VALIDATION_ERROR,
            message: 'Dados inválidos. Verifique os campos e tente novamente.',
            errors,
          },
        });
        return;
      }

      // Erro inesperado durante validação
      next(new AppError('Erro ao validar os dados da requisição.', 500));
    }
  };
}

// ---------------------------------------------------------------------------
// Helpers de schemas reutilizáveis
// ---------------------------------------------------------------------------

/** Valida que um parâmetro de rota é um UUID v4 válido */
export const uuidParam = (name: string) =>
  z.object({
    params: z.object({
      [name]: z
        .string({ required_error: `${name} é obrigatório.` })
        .uuid(`${name} deve ser um UUID válido.`),
    }),
  });

/** Schema base para paginação via query string */
export const paginationSchema = z.object({
  query: z.object({
    page : z.coerce.number().int().min(1).default(1),
    limit: z.coerce.number().int().min(1).max(100).default(20),
  }),
});

export type PaginationQuery = z.infer<typeof paginationSchema>['query'];
