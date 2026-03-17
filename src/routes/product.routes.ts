/**
 * @file product.routes.ts
 * @description Rotas do domínio de Cardápio (Produtos, Categorias, Adicionais).
 *
 * Organização:
 *  - Produtos: CRUD + variações + grupos de adicionais + upload de imagem
 *  - Categorias: CRUD + reordenação
 *  - Grupos de adicionais: CRUD + itens
 *
 * @module routes/products
 */

import { Router }             from 'express';
import { ProductController }  from '@/controllers/product.controller';
import { authenticate }       from '@/middlewares/authenticate';
import { authorize }          from '@/middlewares/authorize';
import { validate }           from '@/middlewares/validate';
import {
  createProductSchema,
  updateProductSchema,
  createCategorySchema,
  updateCategorySchema,
  reorderSchema,
  createAdditionalGroupSchema,
  createAdditionalSchema,
  productQuerySchema,
} from '@/validators/product.validators';

const router = Router();
const ctrl   = new ProductController();

// ===========================================================================
// CATEGORIAS
// ===========================================================================

router.use(authenticate);

/**
 * GET /api/v1/products/categories
 * Lista todas as categorias da empresa com contagem de produtos.
 */
router.get('/categories', ctrl.listCategories);

/**
 * POST /api/v1/products/categories
 * Cria uma nova categoria.
 */
router.post(
  '/categories',
  authorize('owner', 'admin', 'manager'),
  validate(createCategorySchema),
  ctrl.createCategory,
);

/**
 * PUT /api/v1/products/categories/:id
 * Atualiza uma categoria existente.
 */
router.put(
  '/categories/:id',
  authorize('owner', 'admin', 'manager'),
  validate(updateCategorySchema),
  ctrl.updateCategory,
);

/**
 * DELETE /api/v1/products/categories/:id
 * Remove uma categoria (produtos associados ficam sem categoria).
 */
router.delete(
  '/categories/:id',
  authorize('owner', 'admin'),
  ctrl.deleteCategory,
);

/**
 * PATCH /api/v1/products/categories/reorder
 * Reordena categorias via array de { id, sort_order }.
 */
router.patch(
  '/categories/reorder',
  authorize('owner', 'admin', 'manager'),
  validate(reorderSchema),
  ctrl.reorderCategories,
);

// ===========================================================================
// GRUPOS DE ADICIONAIS
// ===========================================================================

/**
 * GET /api/v1/products/additional-groups
 * Lista todos os grupos de adicionais da empresa.
 */
router.get('/additional-groups', ctrl.listAdditionalGroups);

/**
 * POST /api/v1/products/additional-groups
 * Cria um novo grupo de adicionais.
 */
router.post(
  '/additional-groups',
  authorize('owner', 'admin', 'manager'),
  validate(createAdditionalGroupSchema),
  ctrl.createAdditionalGroup,
);

/**
 * PUT /api/v1/products/additional-groups/:id
 * Atualiza um grupo de adicionais.
 */
router.put(
  '/additional-groups/:id',
  authorize('owner', 'admin', 'manager'),
  ctrl.updateAdditionalGroup,
);

/**
 * DELETE /api/v1/products/additional-groups/:id
 * Remove um grupo e todos os seus itens.
 */
router.delete(
  '/additional-groups/:id',
  authorize('owner', 'admin'),
  ctrl.deleteAdditionalGroup,
);

/**
 * POST /api/v1/products/additional-groups/:id/items
 * Adiciona um item a um grupo de adicionais.
 */
router.post(
  '/additional-groups/:id/items',
  authorize('owner', 'admin', 'manager'),
  validate(createAdditionalSchema),
  ctrl.createAdditional,
);

/**
 * PUT /api/v1/products/additional-groups/:groupId/items/:itemId
 * Atualiza um item de adicional.
 */
router.put(
  '/additional-groups/:groupId/items/:itemId',
  authorize('owner', 'admin', 'manager'),
  ctrl.updateAdditional,
);

/**
 * DELETE /api/v1/products/additional-groups/:groupId/items/:itemId
 * Remove um item de adicional.
 */
router.delete(
  '/additional-groups/:groupId/items/:itemId',
  authorize('owner', 'admin', 'manager'),
  ctrl.deleteAdditional,
);

// ===========================================================================
// PRODUTOS
// ===========================================================================

/**
 * GET /api/v1/products
 * Lista produtos com filtros, paginação e busca full-text.
 */
router.get('/', validate(productQuerySchema), ctrl.list);

/**
 * GET /api/v1/products/:id
 * Retorna detalhes completos de um produto (com variações e adicionais).
 */
router.get('/:id', ctrl.findById);

/**
 * POST /api/v1/products
 * Cria um novo produto com variações e grupos de adicionais opcionais.
 */
router.post(
  '/',
  authorize('owner', 'admin', 'manager'),
  validate(createProductSchema),
  ctrl.create,
);

/**
 * PUT /api/v1/products/:id
 * Atualiza um produto existente.
 */
router.put(
  '/:id',
  authorize('owner', 'admin', 'manager'),
  validate(updateProductSchema),
  ctrl.update,
);

/**
 * PATCH /api/v1/products/:id/toggle
 * Ativa ou desativa um produto rapidamente (sem editar outros campos).
 */
router.patch('/:id/toggle', authorize('owner', 'admin', 'manager'), ctrl.toggle);

/**
 * PATCH /api/v1/products/reorder
 * Reordena produtos via array de { id, sort_order }.
 */
router.patch(
  '/reorder',
  authorize('owner', 'admin', 'manager'),
  validate(reorderSchema),
  ctrl.reorderProducts,
);

/**
 * POST /api/v1/products/:id/image
 * Faz upload de imagem principal do produto para o Supabase Storage.
 * Content-Type: multipart/form-data
 */
router.post('/:id/image', authorize('owner', 'admin', 'manager'), ctrl.uploadImage);

/**
 * DELETE /api/v1/products/:id/image
 * Remove a imagem principal do produto.
 */
router.delete('/:id/image', authorize('owner', 'admin', 'manager'), ctrl.deleteImage);

/**
 * DELETE /api/v1/products/:id
 * Remove um produto e suas variações/associações.
 */
router.delete(
  '/:id',
  authorize('owner', 'admin'),
  ctrl.delete,
);

export { router as productRoutes };
