/**
 * @file product.controller.ts
 * @description Controller do domínio de Cardápio (Produtos, Categorias, Adicionais).
 *
 * Thin controller — apenas extrai parâmetros, delega ao ProductService
 * e formata a resposta HTTP.
 *
 * @module controllers/product
 */

import { Request, Response, NextFunction } from 'express';
import { ProductService }                  from '@/services/product.service';
import { createRequestLogger }             from '@/config/logger';

export class ProductController {
  private readonly service: ProductService;

  constructor() {
    this.service = new ProductService();

    // Bind manual para garantir contexto correto em callbacks de rota
    this.list                  = this.list.bind(this);
    this.findById              = this.findById.bind(this);
    this.create                = this.create.bind(this);
    this.update                = this.update.bind(this);
    this.toggle                = this.toggle.bind(this);
    this.delete                = this.delete.bind(this);
    this.reorderProducts       = this.reorderProducts.bind(this);
    this.uploadImage           = this.uploadImage.bind(this);
    this.deleteImage           = this.deleteImage.bind(this);
    this.listCategories        = this.listCategories.bind(this);
    this.createCategory        = this.createCategory.bind(this);
    this.updateCategory        = this.updateCategory.bind(this);
    this.deleteCategory        = this.deleteCategory.bind(this);
    this.reorderCategories     = this.reorderCategories.bind(this);
    this.listAdditionalGroups  = this.listAdditionalGroups.bind(this);
    this.createAdditionalGroup = this.createAdditionalGroup.bind(this);
    this.updateAdditionalGroup = this.updateAdditionalGroup.bind(this);
    this.deleteAdditionalGroup = this.deleteAdditionalGroup.bind(this);
    this.createAdditional      = this.createAdditional.bind(this);
    this.updateAdditional      = this.updateAdditional.bind(this);
    this.deleteAdditional      = this.deleteAdditional.bind(this);
  }

  // ===========================================================================
  // PRODUTOS
  // ===========================================================================

  async list(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const result = await this.service.list({
        companyId: req.company.id,
        filters  : req.query as Record<string, string>,
      });
      res.status(200).json({ success: true, data: result });
    } catch (err) { next(err); }
  }

  async findById(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const product = await this.service.findById({
        id       : req.params.id,
        companyId: req.company.id,
      });
      res.status(200).json({ success: true, data: product });
    } catch (err) { next(err); }
  }

  async create(req: Request, res: Response, next: NextFunction): Promise<void> {
    const log = createRequestLogger(req.id, req.company.id);
    try {
      const product = await this.service.create({
        companyId: req.company.id,
        ...req.body,
      });
      log.info('Produto criado', { productId: product.id, name: product.name });
      res.status(201).json({ success: true, data: product });
    } catch (err) { next(err); }
  }

  async update(req: Request, res: Response, next: NextFunction): Promise<void> {
    const log = createRequestLogger(req.id, req.company.id);
    try {
      const product = await this.service.update({
        id       : req.params.id,
        companyId: req.company.id,
        data     : req.body,
      });
      log.info('Produto atualizado', { productId: product.id });
      res.status(200).json({ success: true, data: product });
    } catch (err) { next(err); }
  }

  async toggle(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const product = await this.service.toggle({
        id       : req.params.id,
        companyId: req.company.id,
      });
      res.status(200).json({ success: true, data: product });
    } catch (err) { next(err); }
  }

  async reorderProducts(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      await this.service.reorder({
        companyId: req.company.id,
        items    : req.body.items,
        entity   : 'products',
      });
      res.status(200).json({ success: true, data: { message: 'Reordenação aplicada.' } });
    } catch (err) { next(err); }
  }

  async uploadImage(req: Request, res: Response, next: NextFunction): Promise<void> {
    const log = createRequestLogger(req.id, req.company.id);
    try {
      const url = await this.service.uploadImage({
        productId : req.params.id,
        companyId : req.company.id,
        file      : req.file!,
      });
      log.info('Imagem do produto atualizada', { productId: req.params.id });
      res.status(200).json({ success: true, data: { imageUrl: url } });
    } catch (err) { next(err); }
  }

  async deleteImage(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      await this.service.deleteImage({
        productId: req.params.id,
        companyId: req.company.id,
      });
      res.status(200).json({ success: true, data: { message: 'Imagem removida.' } });
    } catch (err) { next(err); }
  }

  async delete(req: Request, res: Response, next: NextFunction): Promise<void> {
    const log = createRequestLogger(req.id, req.company.id);
    try {
      await this.service.delete({ id: req.params.id, companyId: req.company.id });
      log.info('Produto deletado', { productId: req.params.id });
      res.status(204).send();
    } catch (err) { next(err); }
  }

  // ===========================================================================
  // CATEGORIAS
  // ===========================================================================

  async listCategories(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const categories = await this.service.listCategories(req.company.id);
      res.status(200).json({ success: true, data: categories });
    } catch (err) { next(err); }
  }

  async createCategory(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const category = await this.service.createCategory({
        companyId: req.company.id,
        ...req.body,
      });
      res.status(201).json({ success: true, data: category });
    } catch (err) { next(err); }
  }

  async updateCategory(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const category = await this.service.updateCategory({
        id       : req.params.id,
        companyId: req.company.id,
        data     : req.body,
      });
      res.status(200).json({ success: true, data: category });
    } catch (err) { next(err); }
  }

  async deleteCategory(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      await this.service.deleteCategory({ id: req.params.id, companyId: req.company.id });
      res.status(204).send();
    } catch (err) { next(err); }
  }

  async reorderCategories(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      await this.service.reorder({
        companyId: req.company.id,
        items    : req.body.items,
        entity   : 'categories',
      });
      res.status(200).json({ success: true, data: { message: 'Reordenação aplicada.' } });
    } catch (err) { next(err); }
  }

  // ===========================================================================
  // GRUPOS DE ADICIONAIS
  // ===========================================================================

  async listAdditionalGroups(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const groups = await this.service.listAdditionalGroups(req.company.id);
      res.status(200).json({ success: true, data: groups });
    } catch (err) { next(err); }
  }

  async createAdditionalGroup(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const group = await this.service.createAdditionalGroup({
        companyId: req.company.id,
        ...req.body,
      });
      res.status(201).json({ success: true, data: group });
    } catch (err) { next(err); }
  }

  async updateAdditionalGroup(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const group = await this.service.updateAdditionalGroup({
        id       : req.params.id,
        companyId: req.company.id,
        data     : req.body,
      });
      res.status(200).json({ success: true, data: group });
    } catch (err) { next(err); }
  }

  async deleteAdditionalGroup(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      await this.service.deleteAdditionalGroup({ id: req.params.id, companyId: req.company.id });
      res.status(204).send();
    } catch (err) { next(err); }
  }

  async createAdditional(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const item = await this.service.createAdditional({
        groupId  : req.params.id,
        companyId: req.company.id,
        ...req.body,
      });
      res.status(201).json({ success: true, data: item });
    } catch (err) { next(err); }
  }

  async updateAdditional(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const item = await this.service.updateAdditional({
        id       : req.params.itemId,
        groupId  : req.params.groupId,
        companyId: req.company.id,
        data     : req.body,
      });
      res.status(200).json({ success: true, data: item });
    } catch (err) { next(err); }
  }

  async deleteAdditional(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      await this.service.deleteAdditional({
        id       : req.params.itemId,
        companyId: req.company.id,
      });
      res.status(204).send();
    } catch (err) { next(err); }
  }
}
