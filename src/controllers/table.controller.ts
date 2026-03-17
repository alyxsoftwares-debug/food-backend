/**
 * @file table.controller.ts
 * @description Controller do domínio de Mesas.
 *
 * Thin controller — extrai parâmetros, delega ao TableService
 * e formata a resposta HTTP.
 *
 * @module controllers/table
 */

import { Request, Response, NextFunction } from 'express';
import { TableService }                    from '@/services/table.service';
import { createRequestLogger }             from '@/config/logger';

export class TableController {
  private readonly service: TableService;

  constructor() {
    this.service = new TableService();

    this.dashboard        = this.dashboard.bind(this);
    this.list             = this.list.bind(this);
    this.findById         = this.findById.bind(this);
    this.create           = this.create.bind(this);
    this.bulkCreate       = this.bulkCreate.bind(this);
    this.update           = this.update.bind(this);
    this.delete           = this.delete.bind(this);
    this.updateStatus     = this.updateStatus.bind(this);
    this.openTab          = this.openTab.bind(this);
    this.closeTab         = this.closeTab.bind(this);
    this.transfer         = this.transfer.bind(this);
    this.regenerateQrCode = this.regenerateQrCode.bind(this);
    this.getQrCode        = this.getQrCode.bind(this);
    this.bulkQrCodePdf    = this.bulkQrCodePdf.bind(this);
  }

  // ---------------------------------------------------------------------------
  // GET /tables/dashboard
  // ---------------------------------------------------------------------------

  async dashboard(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const data = await this.service.getDashboard(req.company.id);
      res.status(200).json({ success: true, data });
    } catch (err) { next(err); }
  }

  // ---------------------------------------------------------------------------
  // GET /tables
  // ---------------------------------------------------------------------------

  async list(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const data = await this.service.list({
        companyId: req.company.id,
        status   : req.query.status as string | undefined,
        location : req.query.location as string | undefined,
      });
      res.status(200).json({ success: true, data });
    } catch (err) { next(err); }
  }

  // ---------------------------------------------------------------------------
  // GET /tables/:id
  // ---------------------------------------------------------------------------

  async findById(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const table = await this.service.findById({
        id       : req.params.id,
        companyId: req.company.id,
      });
      res.status(200).json({ success: true, data: table });
    } catch (err) { next(err); }
  }

  // ---------------------------------------------------------------------------
  // POST /tables
  // ---------------------------------------------------------------------------

  async create(req: Request, res: Response, next: NextFunction): Promise<void> {
    const log = createRequestLogger(req.id, req.company.id);
    try {
      const table = await this.service.create({
        companyId: req.company.id,
        ...req.body,
      });
      log.info('Mesa criada', { tableId: table.id, identifier: table.identifier });
      res.status(201).json({ success: true, data: table });
    } catch (err) { next(err); }
  }

  // ---------------------------------------------------------------------------
  // POST /tables/bulk
  // ---------------------------------------------------------------------------

  async bulkCreate(req: Request, res: Response, next: NextFunction): Promise<void> {
    const log = createRequestLogger(req.id, req.company.id);
    try {
      const tables = await this.service.bulkCreate({
        companyId: req.company.id,
        ...req.body,
      });
      log.info(`${tables.length} mesas criadas em lote`);
      res.status(201).json({ success: true, data: tables });
    } catch (err) { next(err); }
  }

  // ---------------------------------------------------------------------------
  // PUT /tables/:id
  // ---------------------------------------------------------------------------

  async update(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const table = await this.service.update({
        id       : req.params.id,
        companyId: req.company.id,
        data     : req.body,
      });
      res.status(200).json({ success: true, data: table });
    } catch (err) { next(err); }
  }

  // ---------------------------------------------------------------------------
  // DELETE /tables/:id
  // ---------------------------------------------------------------------------

  async delete(req: Request, res: Response, next: NextFunction): Promise<void> {
    const log = createRequestLogger(req.id, req.company.id);
    try {
      await this.service.delete({
        id       : req.params.id,
        companyId: req.company.id,
      });
      log.info('Mesa removida', { tableId: req.params.id });
      res.status(204).send();
    } catch (err) { next(err); }
  }

  // ---------------------------------------------------------------------------
  // PATCH /tables/:id/status
  // ---------------------------------------------------------------------------

  async updateStatus(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const table = await this.service.updateStatus({
        id       : req.params.id,
        companyId: req.company.id,
        status   : req.body.status,
      });
      res.status(200).json({ success: true, data: table });
    } catch (err) { next(err); }
  }

  // ---------------------------------------------------------------------------
  // POST /tables/:id/open
  // ---------------------------------------------------------------------------

  async openTab(req: Request, res: Response, next: NextFunction): Promise<void> {
    const log = createRequestLogger(req.id, req.company.id);
    try {
      const result = await this.service.openTab({
        tableId    : req.params.id,
        companyId  : req.company.id,
        openedBy   : req.user.id,
        customerName: req.body.customerName,
        covers     : req.body.covers,
      });
      log.info('Comanda aberta', { tableId: req.params.id, orderId: result.order.id });
      res.status(201).json({ success: true, data: result });
    } catch (err) { next(err); }
  }

  // ---------------------------------------------------------------------------
  // POST /tables/:id/close
  // ---------------------------------------------------------------------------

  async closeTab(req: Request, res: Response, next: NextFunction): Promise<void> {
    const log = createRequestLogger(req.id, req.company.id);
    try {
      const result = await this.service.closeTab({
        tableId  : req.params.id,
        companyId: req.company.id,
        closedBy : req.user.id,
      });
      log.info('Comanda fechada', {
        tableId : req.params.id,
        orderId : result.order.id,
        total   : result.order.total,
      });
      res.status(200).json({ success: true, data: result });
    } catch (err) { next(err); }
  }

  // ---------------------------------------------------------------------------
  // POST /tables/:id/transfer
  // ---------------------------------------------------------------------------

  async transfer(req: Request, res: Response, next: NextFunction): Promise<void> {
    const log = createRequestLogger(req.id, req.company.id);
    try {
      const { targetTableId } = req.body as { targetTableId: string };

      const result = await this.service.transfer({
        sourceTableId: req.params.id,
        targetTableId,
        companyId    : req.company.id,
        transferredBy: req.user.id,
      });

      log.info('Pedido transferido entre mesas', {
        from  : req.params.id,
        to    : targetTableId,
        orderId: result.order.id,
      });

      res.status(200).json({ success: true, data: result });
    } catch (err) { next(err); }
  }

  // ---------------------------------------------------------------------------
  // POST /tables/:id/qrcode/regenerate
  // ---------------------------------------------------------------------------

  async regenerateQrCode(req: Request, res: Response, next: NextFunction): Promise<void> {
    const log = createRequestLogger(req.id, req.company.id);
    try {
      const table = await this.service.regenerateQrCode({
        id       : req.params.id,
        companyId: req.company.id,
      });
      log.info('QR Code regenerado', { tableId: req.params.id });
      res.status(200).json({ success: true, data: table });
    } catch (err) { next(err); }
  }

  // ---------------------------------------------------------------------------
  // GET /tables/:id/qrcode
  // Retorna PNG do QR Code diretamente (Content-Type: image/png)
  // ---------------------------------------------------------------------------

  async getQrCode(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const png = await this.service.generateQrCodePng({
        id       : req.params.id,
        companyId: req.company.id,
      });

      res.setHeader('Content-Type', 'image/png');
      res.setHeader('Cache-Control', 'public, max-age=86400'); // Cache 24h
      res.status(200).send(png);
    } catch (err) { next(err); }
  }

  // ---------------------------------------------------------------------------
  // GET /tables/qrcode/bulk-pdf
  // ---------------------------------------------------------------------------

  async bulkQrCodePdf(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const pdf = await this.service.generateBulkQrCodePdf(req.company.id);

      res.setHeader('Content-Type', 'application/pdf');
      res.setHeader('Content-Disposition', 'attachment; filename="qrcodes-mesas.pdf"');
      res.status(200).send(pdf);
    } catch (err) { next(err); }
  }
}
