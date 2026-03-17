/**
 * @file product.service.ts
 * @description Service do domínio de Cardápio — toda a lógica de negócio.
 *
 * Responsabilidades:
 *  - CRUD de produtos, categorias e grupos de adicionais
 *  - Busca full-text em português via tsvector
 *  - Upload e remoção de imagens no Supabase Storage
 *  - Reordenação eficiente via bulk UPDATE
 *  - Cache em memória do cardápio público (TTL configurável)
 *  - Associação de produtos com grupos de adicionais
 *  - Gestão de variações de produto
 *
 * @module services/product
 */

import { pgPool, supabaseAdmin, withTransaction } from '@/config/supabase';
import { AppError, ErrorCode }                    from '@/errors/AppError';
import { logger }                                 from '@/config/logger';

// ---------------------------------------------------------------------------
// Tipos internos
// ---------------------------------------------------------------------------

interface CreateProductDTO {
  companyId        : string;
  categoryId?      : string;
  name             : string;
  description?     : string;
  basePrice        : number;
  promotionalPrice?: number;
  costPrice?       : number;
  serves?          : number;
  prepTime?        : number;
  calories?        : number;
  tags?            : string[];
  isActive?        : boolean;
  isFeatured?      : boolean;
  sortOrder?       : number;
  stockControl?    : boolean;
  stockQuantity?   : number;
  stockAlertAt?    : number;
  availableFrom?   : string;
  availableUntil?  : string;
  availableDays?   : string[];
  variations?      : Array<{ name: string; price: number; sortOrder?: number }>;
  additionalGroupIds?: string[];
}

interface UpdateProductDTO {
  id       : string;
  companyId: string;
  data     : Partial<Omit<CreateProductDTO, 'companyId'>>;
}

interface ReorderItem {
  id        : string;
  sort_order: number;
}

interface UploadImageDTO {
  productId: string;
  companyId: string;
  file     : Express.Multer.File;
}

// ---------------------------------------------------------------------------
// Cache em memória para cardápio público
// Chave: companyId | TTL: 60s (evita hammering no DB em horários de pico)
// ---------------------------------------------------------------------------

interface MenuCacheEntry {
  data     : unknown;
  expiresAt: number;
}

const menuCache = new Map<string, MenuCacheEntry>();
const MENU_CACHE_TTL_MS = 60_000; // 60 segundos

function getMenuCache(companyId: string): unknown | null {
  const entry = menuCache.get(companyId);
  if (!entry || Date.now() > entry.expiresAt) {
    menuCache.delete(companyId);
    return null;
  }
  return entry.data;
}

function setMenuCache(companyId: string, data: unknown): void {
  menuCache.set(companyId, { data, expiresAt: Date.now() + MENU_CACHE_TTL_MS });
}

/** Invalida o cache de uma empresa após qualquer mutação no cardápio */
function invalidateMenuCache(companyId: string): void {
  menuCache.delete(companyId);
  logger.debug(`[MenuCache] Cache invalidado para empresa ${companyId}`);
}

// ---------------------------------------------------------------------------
// ProductService
// ---------------------------------------------------------------------------

export class ProductService {

  // ===========================================================================
  // PRODUTOS
  // ===========================================================================

  // ---------------------------------------------------------------------------
  // list
  // ---------------------------------------------------------------------------

  async list({ companyId, filters }: { companyId: string; filters: Record<string, string> }) {
    const page   = Math.max(1, Number(filters.page  ?? 1));
    const limit  = Math.min(100, Math.max(1, Number(filters.limit ?? 50)));
    const offset = (page - 1) * limit;

    const conditions: string[] = ['p.company_id = $1'];
    const params: unknown[]    = [companyId];
    let   idx                  = 2;

    if (filters.categoryId) {
      conditions.push(`p.category_id = $${idx++}`);
      params.push(filters.categoryId);
    }

    if (filters.isActive !== undefined) {
      conditions.push(`p.is_active = $${idx++}`);
      params.push(filters.isActive === 'true');
    }

    if (filters.isFeatured === 'true') {
      conditions.push(`p.is_featured = TRUE`);
    }

    if (filters.search) {
      // Full-text search em português usando o índice GIN do schema
      conditions.push(
        `to_tsvector('portuguese', unaccent(p.name) || ' ' || COALESCE(unaccent(p.description), ''))
         @@ plainto_tsquery('portuguese', unaccent($${idx++}))`,
      );
      params.push(filters.search);
    }

    const where = conditions.join(' AND ');

    const [productsResult, countResult] = await Promise.all([
      pgPool.query(
        `SELECT
           p.id, p.name, p.description, p.base_price, p.promotional_price,
           p.promotional_until, p.image_url, p.is_active, p.is_featured,
           p.sort_order, p.prep_time, p.serves, p.stock_control,
           p.stock_quantity, p.tags, p.created_at,
           c.id   AS category_id,
           c.name AS category_name
         FROM food.products p
         LEFT JOIN food.categories c ON c.id = p.category_id
         WHERE ${where}
         ORDER BY c.sort_order ASC NULLS LAST, p.sort_order ASC, p.name ASC
         LIMIT $${idx} OFFSET $${idx + 1}`,
        [...params, limit, offset],
      ),
      pgPool.query(
        `SELECT COUNT(*) AS total FROM food.products p WHERE ${where}`,
        params,
      ),
    ]);

    const total      = Number(countResult.rows[0].total);
    const totalPages = Math.ceil(total / limit);

    return {
      products  : productsResult.rows,
      pagination: { page, limit, total, totalPages },
    };
  }

  // ---------------------------------------------------------------------------
  // findById
  // ---------------------------------------------------------------------------

  async findById({ id, companyId }: { id: string; companyId: string }) {
    const { rows } = await pgPool.query(
      `SELECT * FROM food.v_products_full
       WHERE id = $1 AND company_id = $2
       LIMIT 1`,
      [id, companyId],
    );

    if (rows.length === 0) {
      throw new AppError('Produto não encontrado.', 404, ErrorCode.PRODUCT_NOT_FOUND);
    }

    return rows[0];
  }

  // ---------------------------------------------------------------------------
  // create
  // ---------------------------------------------------------------------------

  async create(dto: CreateProductDTO) {
    return withTransaction(async (client) => {
      // Valida categoria (se informada)
      if (dto.categoryId) {
        const { rows } = await client.query(
          `SELECT id FROM food.categories WHERE id = $1 AND company_id = $2 LIMIT 1`,
          [dto.categoryId, dto.companyId],
        );
        if (rows.length === 0) {
          throw new AppError('Categoria não encontrada.', 404, ErrorCode.CATEGORY_NOT_FOUND);
        }
      }

      // Calcula próximo sort_order
      const { rows: sortRows } = await client.query(
        `SELECT COALESCE(MAX(sort_order), -1) + 1 AS next_order
         FROM food.products WHERE company_id = $1`,
        [dto.companyId],
      );
      const nextOrder = dto.sortOrder ?? Number(sortRows[0].next_order);

      // Insere produto
      const { rows: productRows } = await client.query(
        `INSERT INTO food.products (
           company_id, category_id, name, description,
           base_price, promotional_price, cost_price,
           serves, prep_time, calories, tags,
           is_active, is_featured, sort_order,
           stock_control, stock_quantity, stock_alert_at,
           available_from, available_until, available_days
         ) VALUES (
           $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20
         )
         RETURNING *`,
        [
          dto.companyId,
          dto.categoryId  ?? null,
          dto.name,
          dto.description ?? null,
          dto.basePrice,
          dto.promotionalPrice ?? null,
          dto.costPrice        ?? null,
          dto.serves           ?? 1,
          dto.prepTime         ?? null,
          dto.calories         ?? null,
          dto.tags             ?? [],
          dto.isActive  !== false,
          dto.isFeatured ?? false,
          nextOrder,
          dto.stockControl  ?? false,
          dto.stockQuantity ?? null,
          dto.stockAlertAt  ?? null,
          dto.availableFrom  ?? null,
          dto.availableUntil ?? null,
          dto.availableDays  ?? null,
        ],
      );

      const product = productRows[0];

      // Insere variações (se informadas)
      if (dto.variations?.length) {
        for (let i = 0; i < dto.variations.length; i++) {
          const v = dto.variations[i];
          await client.query(
            `INSERT INTO food.product_variations
               (company_id, product_id, name, price, sort_order)
             VALUES ($1,$2,$3,$4,$5)`,
            [dto.companyId, product.id, v.name, v.price, v.sortOrder ?? i],
          );
        }
      }

      // Associa grupos de adicionais (se informados)
      if (dto.additionalGroupIds?.length) {
        for (let i = 0; i < dto.additionalGroupIds.length; i++) {
          await client.query(
            `INSERT INTO food.product_additional_groups (product_id, group_id, sort_order)
             VALUES ($1,$2,$3)
             ON CONFLICT DO NOTHING`,
            [product.id, dto.additionalGroupIds[i], i],
          );
        }
      }

      invalidateMenuCache(dto.companyId);

      return this.findById({ id: product.id, companyId: dto.companyId });
    });
  }

  // ---------------------------------------------------------------------------
  // update
  // ---------------------------------------------------------------------------

  async update({ id, companyId, data }: UpdateProductDTO) {
    // Constrói SET dinâmico apenas com campos fornecidos
    const fieldMap: Record<string, string> = {
      categoryId      : 'category_id',
      name            : 'name',
      description     : 'description',
      basePrice       : 'base_price',
      promotionalPrice: 'promotional_price',
      promotionalUntil: 'promotional_until',
      costPrice       : 'cost_price',
      serves          : 'serves',
      prepTime        : 'prep_time',
      calories        : 'calories',
      tags            : 'tags',
      isActive        : 'is_active',
      isFeatured      : 'is_featured',
      sortOrder       : 'sort_order',
      stockControl    : 'stock_control',
      stockQuantity   : 'stock_quantity',
      stockAlertAt    : 'stock_alert_at',
      availableFrom   : 'available_from',
      availableUntil  : 'available_until',
      availableDays   : 'available_days',
    };

    const setClauses: string[] = [];
    const params: unknown[]    = [];
    let   idx                  = 1;

    for (const [key, col] of Object.entries(fieldMap)) {
      if (key in data && data[key as keyof typeof data] !== undefined) {
        setClauses.push(`${col} = $${idx++}`);
        params.push(data[key as keyof typeof data]);
      }
    }

    if (setClauses.length === 0) {
      return this.findById({ id, companyId });
    }

    params.push(id, companyId);

    const { rows } = await pgPool.query(
      `UPDATE food.products
       SET ${setClauses.join(', ')}
       WHERE id = $${idx} AND company_id = $${idx + 1}
       RETURNING id`,
      params,
    );

    if (rows.length === 0) {
      throw new AppError('Produto não encontrado.', 404, ErrorCode.PRODUCT_NOT_FOUND);
    }

    // Atualiza variações (se fornecidas): estratégia delete + insert
    if (data.variations !== undefined) {
      await withTransaction(async (client) => {
        await client.query(
          `DELETE FROM food.product_variations WHERE product_id = $1`,
          [id],
        );

        for (let i = 0; i < (data.variations ?? []).length; i++) {
          const v = data.variations![i];
          await client.query(
            `INSERT INTO food.product_variations (company_id, product_id, name, price, sort_order)
             VALUES ($1,$2,$3,$4,$5)`,
            [companyId, id, v.name, v.price, v.sortOrder ?? i],
          );
        }
      });
    }

    // Atualiza grupos de adicionais (se fornecidos): delete + insert
    if (data.additionalGroupIds !== undefined) {
      await withTransaction(async (client) => {
        await client.query(
          `DELETE FROM food.product_additional_groups WHERE product_id = $1`,
          [id],
        );

        for (let i = 0; i < (data.additionalGroupIds ?? []).length; i++) {
          await client.query(
            `INSERT INTO food.product_additional_groups (product_id, group_id, sort_order)
             VALUES ($1,$2,$3)`,
            [id, data.additionalGroupIds![i], i],
          );
        }
      });
    }

    invalidateMenuCache(companyId);
    return this.findById({ id, companyId });
  }

  // ---------------------------------------------------------------------------
  // toggle
  // ---------------------------------------------------------------------------

  async toggle({ id, companyId }: { id: string; companyId: string }) {
    const { rows } = await pgPool.query(
      `UPDATE food.products
       SET is_active = NOT is_active
       WHERE id = $1 AND company_id = $2
       RETURNING id, name, is_active`,
      [id, companyId],
    );

    if (rows.length === 0) {
      throw new AppError('Produto não encontrado.', 404, ErrorCode.PRODUCT_NOT_FOUND);
    }

    invalidateMenuCache(companyId);
    return rows[0];
  }

  // ---------------------------------------------------------------------------
  // reorder — bulk UPDATE eficiente usando unnest
  // ---------------------------------------------------------------------------

  async reorder({
    companyId, items, entity,
  }: { companyId: string; items: ReorderItem[]; entity: 'products' | 'categories' }) {
    if (!items?.length) return;

    const table = entity === 'products' ? 'food.products' : 'food.categories';

    // Usa unnest para uma única query ao invés de N UPDATEs individuais
    const ids        = items.map((i) => i.id);
    const sortOrders = items.map((i) => i.sort_order);

    await pgPool.query(
      `UPDATE ${table} AS t
       SET sort_order = v.sort_order
       FROM (
         SELECT unnest($1::uuid[]) AS id, unnest($2::int[]) AS sort_order
       ) AS v
       WHERE t.id = v.id AND t.company_id = $3`,
      [ids, sortOrders, companyId],
    );

    invalidateMenuCache(companyId);
  }

  // ---------------------------------------------------------------------------
  // uploadImage — Supabase Storage
  // ---------------------------------------------------------------------------

  async uploadImage({ productId, companyId, file }: UploadImageDTO): Promise<string> {
    const product = await this.findById({ id: productId, companyId });

    // Remove imagem anterior se existir
    if (product.image_url) {
      const oldPath = product.image_url.split('/storage/v1/object/public/products/')[1];
      if (oldPath) {
        await supabaseAdmin.storage.from('products').remove([oldPath]);
      }
    }

    const ext      = file.mimetype.split('/')[1] ?? 'jpg';
    const filePath = `${companyId}/${productId}/main.${ext}`;

    const { error } = await supabaseAdmin.storage
      .from('products')
      .upload(filePath, file.buffer, {
        contentType  : file.mimetype,
        upsert       : true,
        cacheControl : '3600',
      });

    if (error) {
      throw new AppError(
        'Falha ao fazer upload da imagem.',
        500,
        ErrorCode.INTERNAL_SERVER_ERROR,
      );
    }

    const { data: { publicUrl } } = supabaseAdmin.storage
      .from('products')
      .getPublicUrl(filePath);

    // Adiciona cache-buster para forçar atualização no CDN
    const urlWithBuster = `${publicUrl}?t=${Date.now()}`;

    await pgPool.query(
      `UPDATE food.products SET image_url = $1 WHERE id = $2`,
      [urlWithBuster, productId],
    );

    invalidateMenuCache(companyId);
    return urlWithBuster;
  }

  // ---------------------------------------------------------------------------
  // deleteImage
  // ---------------------------------------------------------------------------

  async deleteImage({ productId, companyId }: { productId: string; companyId: string }) {
    const product = await this.findById({ id: productId, companyId });

    if (product.image_url) {
      const path = product.image_url.split('/storage/v1/object/public/products/')[1]?.split('?')[0];
      if (path) {
        await supabaseAdmin.storage.from('products').remove([path]);
      }
    }

    await pgPool.query(
      `UPDATE food.products SET image_url = NULL WHERE id = $1`,
      [productId],
    );

    invalidateMenuCache(companyId);
  }

  // ---------------------------------------------------------------------------
  // delete
  // ---------------------------------------------------------------------------

  async delete({ id, companyId }: { id: string; companyId: string }) {
    const { rowCount } = await pgPool.query(
      `DELETE FROM food.products WHERE id = $1 AND company_id = $2`,
      [id, companyId],
    );

    if (rowCount === 0) {
      throw new AppError('Produto não encontrado.', 404, ErrorCode.PRODUCT_NOT_FOUND);
    }

    invalidateMenuCache(companyId);
  }

  // ===========================================================================
  // CATEGORIAS
  // ===========================================================================

  async listCategories(companyId: string) {
    const { rows } = await pgPool.query(
      `SELECT
         c.*,
         COUNT(p.id) FILTER (WHERE p.is_active = TRUE) AS active_product_count,
         COUNT(p.id) AS total_product_count
       FROM food.categories c
       LEFT JOIN food.products p ON p.category_id = c.id AND p.company_id = c.company_id
       WHERE c.company_id = $1
       GROUP BY c.id
       ORDER BY c.sort_order ASC, c.name ASC`,
      [companyId],
    );
    return rows;
  }

  async createCategory(dto: {
    companyId   : string;
    name        : string;
    description?: string;
    imageUrl?   : string;
    color?      : string;
    sortOrder?  : number;
    isActive?   : boolean;
  }) {
    const { rows: sortRows } = await pgPool.query(
      `SELECT COALESCE(MAX(sort_order), -1) + 1 AS next FROM food.categories WHERE company_id = $1`,
      [dto.companyId],
    );

    const { rows } = await pgPool.query(
      `INSERT INTO food.categories
         (company_id, name, description, image_url, color, sort_order, is_active)
       VALUES ($1,$2,$3,$4,$5,$6,$7)
       RETURNING *`,
      [
        dto.companyId, dto.name,
        dto.description ?? null,
        dto.imageUrl    ?? null,
        dto.color       ?? null,
        dto.sortOrder   ?? Number(sortRows[0].next),
        dto.isActive !== false,
      ],
    );

    invalidateMenuCache(dto.companyId);
    return rows[0];
  }

  async updateCategory({
    id, companyId, data,
  }: { id: string; companyId: string; data: Record<string, unknown> }) {
    const allowed = ['name','description','image_url','color','sort_order','is_active','available_from','available_until','available_days'];
    const setClauses: string[] = [];
    const params: unknown[]    = [];
    let   idx                  = 1;

    for (const [key, val] of Object.entries(data)) {
      if (allowed.includes(key) && val !== undefined) {
        setClauses.push(`${key} = $${idx++}`);
        params.push(val);
      }
    }

    if (setClauses.length === 0) {
      const { rows } = await pgPool.query(
        `SELECT * FROM food.categories WHERE id = $1 AND company_id = $2`, [id, companyId],
      );
      return rows[0];
    }

    params.push(id, companyId);
    const { rows } = await pgPool.query(
      `UPDATE food.categories SET ${setClauses.join(', ')}
       WHERE id = $${idx} AND company_id = $${idx + 1}
       RETURNING *`,
      params,
    );

    if (rows.length === 0) throw new AppError('Categoria não encontrada.', 404, ErrorCode.CATEGORY_NOT_FOUND);

    invalidateMenuCache(companyId);
    return rows[0];
  }

  async deleteCategory({ id, companyId }: { id: string; companyId: string }) {
    const { rowCount } = await pgPool.query(
      `DELETE FROM food.categories WHERE id = $1 AND company_id = $2`,
      [id, companyId],
    );
    if (rowCount === 0) throw new AppError('Categoria não encontrada.', 404, ErrorCode.CATEGORY_NOT_FOUND);
    invalidateMenuCache(companyId);
  }

  // ===========================================================================
  // GRUPOS DE ADICIONAIS
  // ===========================================================================

  async listAdditionalGroups(companyId: string) {
    const { rows } = await pgPool.query(
      `SELECT
         ag.*,
         json_agg(
           json_build_object(
             'id', a.id, 'name', a.name, 'price', a.price,
             'sort_order', a.sort_order, 'is_active', a.is_active
           ) ORDER BY a.sort_order
         ) FILTER (WHERE a.id IS NOT NULL) AS items
       FROM food.additional_groups ag
       LEFT JOIN food.additionals a ON a.group_id = ag.id AND a.is_active = TRUE
       WHERE ag.company_id = $1 AND ag.is_active = TRUE
       GROUP BY ag.id
       ORDER BY ag.sort_order ASC, ag.name ASC`,
      [companyId],
    );
    return rows;
  }

  async createAdditionalGroup(dto: {
    companyId  : string;
    name       : string;
    description?: string;
    minSelect  : number;
    maxSelect  : number;
    isRequired : boolean;
  }) {
    const { rows } = await pgPool.query(
      `INSERT INTO food.additional_groups
         (company_id, name, description, min_select, max_select, is_required)
       VALUES ($1,$2,$3,$4,$5,$6)
       RETURNING *`,
      [dto.companyId, dto.name, dto.description ?? null, dto.minSelect ?? 0, dto.maxSelect ?? 1, dto.isRequired ?? false],
    );
    return rows[0];
  }

  async updateAdditionalGroup({
    id, companyId, data,
  }: { id: string; companyId: string; data: Record<string, unknown> }) {
    const { rows } = await pgPool.query(
      `UPDATE food.additional_groups
       SET name = COALESCE($1, name),
           description = COALESCE($2, description),
           min_select  = COALESCE($3, min_select),
           max_select  = COALESCE($4, max_select),
           is_required = COALESCE($5, is_required)
       WHERE id = $6 AND company_id = $7
       RETURNING *`,
      [data.name ?? null, data.description ?? null, data.minSelect ?? null,
       data.maxSelect ?? null, data.isRequired ?? null, id, companyId],
    );
    if (rows.length === 0) throw AppError.notFound('Grupo de adicionais', id);
    return rows[0];
  }

  async deleteAdditionalGroup({ id, companyId }: { id: string; companyId: string }) {
    const { rowCount } = await pgPool.query(
      `DELETE FROM food.additional_groups WHERE id = $1 AND company_id = $2`,
      [id, companyId],
    );
    if (rowCount === 0) throw AppError.notFound('Grupo de adicionais', id);
    invalidateMenuCache(companyId);
  }

  async createAdditional(dto: {
    companyId  : string;
    groupId    : string;
    name       : string;
    description?: string;
    price      : number;
    sortOrder? : number;
  }) {
    const { rows } = await pgPool.query(
      `INSERT INTO food.additionals (company_id, group_id, name, description, price, sort_order)
       VALUES ($1,$2,$3,$4,$5,$6)
       RETURNING *`,
      [dto.companyId, dto.groupId, dto.name, dto.description ?? null, dto.price, dto.sortOrder ?? 0],
    );
    invalidateMenuCache(dto.companyId);
    return rows[0];
  }

  async updateAdditional({
    id, groupId, companyId, data,
  }: { id: string; groupId: string; companyId: string; data: Record<string, unknown> }) {
    const { rows } = await pgPool.query(
      `UPDATE food.additionals
       SET name        = COALESCE($1, name),
           description = COALESCE($2, description),
           price       = COALESCE($3, price),
           sort_order  = COALESCE($4, sort_order),
           is_active   = COALESCE($5, is_active)
       WHERE id = $6 AND group_id = $7 AND company_id = $8
       RETURNING *`,
      [data.name ?? null, data.description ?? null, data.price ?? null,
       data.sortOrder ?? null, data.isActive ?? null, id, groupId, companyId],
    );
    if (rows.length === 0) throw AppError.notFound('Adicional', id);
    invalidateMenuCache(companyId);
    return rows[0];
  }

  async deleteAdditional({ id, companyId }: { id: string; companyId: string }) {
    const { rowCount } = await pgPool.query(
      `DELETE FROM food.additionals WHERE id = $1 AND company_id = $2`,
      [id, companyId],
    );
    if (rowCount === 0) throw AppError.notFound('Adicional', id);
    invalidateMenuCache(companyId);
  }

  // ===========================================================================
  // CARDÁPIO PÚBLICO — com cache
  // ===========================================================================

  /**
   * Retorna o cardápio completo e público de uma empresa pelo slug.
   * Usa cache em memória de 60s para absorver picos de acesso.
   */
  async getPublicMenu(companySlug: string): Promise<unknown> {
    // Resolve companyId pelo slug
    const { rows: companyRows } = await pgPool.query(
      `SELECT id, name, logo_url, cover_url, description,
              address_city, address_state, primary_color, secondary_color
       FROM food.companies
       WHERE slug = $1 AND status = 'active'
       LIMIT 1`,
      [companySlug],
    );

    if (companyRows.length === 0) {
      throw new AppError('Restaurante não encontrado.', 404, ErrorCode.COMPANY_NOT_FOUND);
    }

    const company   = companyRows[0];
    const companyId = company.id;

    // Tenta cache
    const cached = getMenuCache(companyId);
    if (cached) {
      logger.debug(`[MenuCache] Cache hit para empresa ${companyId}`);
      return cached;
    }

    // Busca cardápio completo com categorias e produtos ativos
    const { rows } = await pgPool.query(
      `SELECT
         c.id          AS category_id,
         c.name        AS category_name,
         c.description AS category_description,
         c.image_url   AS category_image,
         c.color       AS category_color,
         c.sort_order  AS category_sort_order,
         json_agg(
           json_build_object(
             'id',               p.id,
             'name',             p.name,
             'description',      p.description,
             'image_url',        p.image_url,
             'base_price',       p.base_price,
             'promotional_price',p.promotional_price,
             'promotional_until',p.promotional_until,
             'serves',           p.serves,
             'prep_time',        p.prep_time,
             'calories',         p.calories,
             'tags',             p.tags,
             'is_featured',      p.is_featured,
             'sort_order',       p.sort_order,
             'variations',       (
               SELECT json_agg(json_build_object(
                 'id', pv.id, 'name', pv.name, 'price', pv.price
               ) ORDER BY pv.sort_order)
               FROM food.product_variations pv
               WHERE pv.product_id = p.id AND pv.is_active = TRUE
             ),
             'additional_groups', (
               SELECT json_agg(json_build_object(
                 'id',          ag.id,
                 'name',        ag.name,
                 'min_select',  ag.min_select,
                 'max_select',  ag.max_select,
                 'is_required', ag.is_required,
                 'items', (
                   SELECT json_agg(json_build_object(
                     'id', a.id, 'name', a.name, 'price', a.price
                   ) ORDER BY a.sort_order)
                   FROM food.additionals a
                   WHERE a.group_id = ag.id AND a.is_active = TRUE
                 )
               ) ORDER BY pag.sort_order)
               FROM food.product_additional_groups pag
               JOIN food.additional_groups ag ON ag.id = pag.group_id AND ag.is_active = TRUE
               WHERE pag.product_id = p.id
             )
           ) ORDER BY p.sort_order ASC, p.name ASC
         ) FILTER (WHERE p.id IS NOT NULL) AS products
       FROM food.categories c
       LEFT JOIN food.products p
         ON  p.category_id = c.id
         AND p.company_id  = c.company_id
         AND p.is_active   = TRUE
       WHERE c.company_id = $1
         AND c.is_active  = TRUE
       GROUP BY c.id
       ORDER BY c.sort_order ASC, c.name ASC`,
      [companyId],
    );

    // Busca configurações de entrega para exibir no cardápio
    const { rows: settingsRows } = await pgPool.query(
      `SELECT
         is_delivery_enabled, is_pickup_enabled, is_table_enabled,
         min_order_value, base_delivery_fee, free_delivery_above,
         estimated_delivery_time, estimated_pickup_time,
         accepted_payments, business_hours, allow_scheduling
       FROM food.delivery_settings
       WHERE company_id = $1`,
      [companyId],
    );

    const menu = {
      company : company,
      settings: settingsRows[0] ?? {},
      menu    : rows,
    };

    setMenuCache(companyId, menu);
    return menu;
  }
}
