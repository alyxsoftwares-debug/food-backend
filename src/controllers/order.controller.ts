/**
 * @file order.controller.ts
 * @description Controller do domínio de Pedidos.
 *
 * Thin controller — valida entrada (via middleware), delega ao OrderService
 * e formata a resposta HTTP. Nenhuma lógica de negócio aqui.
 *
 * @module controllers/order
 */

import { Request, Response, NextFunction } from 'express';
import { OrderService }                    from '@/services/order.service';
import { createRequestLogger }             from '@/config/logger';

export class OrderController {
  private readonly service: OrderService;

  constructor() {
    this.service = new OrderService();

    this.list           = this.list.bind(this);
    this.findById       = this.findById.bind(this);
    this.create         = this.create.bind(this);
    this.createPublic   = this.createPublic.bind(this);
    this.createFromTable= this.createFromTable.bind(this);
    this.updateStatus   = this.updateStatus.bind(this);
    this.assign         = this.assign.bind(this);
    this.addItem        = this.addItem.bind(this);
    this.removeItem     = this.removeItem.bind(this);
    this.addPayment     = this.addPayment.bind(this);
    this.print          = this.print.bind(this);
    this.cancel         = this.cancel.bind(this);
    this.delete         = this.delete.bind(this);
    this.track          = this.track.bind(this);
    this.stream         = this.stream.bind(this);
    this.stats          = this.stats.bind(this);
  }

  // ---------------------------------------------------------------------------
  // GET /orders
  // ---------------------------------------------------------------------------

  async list(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const result = await this.service.list({
        companyId: req.company.id,
        filters  : req.query as Record<string, string>,
      });

      res.status(200).json({ success: true, data: result });
    } catch (error) { next(error); }
  }

  // ---------------------------------------------------------------------------
  // GET /orders/stats
  // ---------------------------------------------------------------------------

  async stats(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const data = await this.service.getDailyStats(req.company.id);
      res.status(200).json({ success: true, data });
    } catch (error) { next(error); }
  }

  // ---------------------------------------------------------------------------
  // GET /orders/:id
  // ---------------------------------------------------------------------------

  async findById(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const order = await this.service.findById({
        id       : req.params.id,
        companyId: req.company.id,
      });

      res.status(200).json({ success: true, data: order });
    } catch (error) { next(error); }
  }

  // ---------------------------------------------------------------------------
  // GET /orders/track/:id (público)
  // ---------------------------------------------------------------------------

  async track(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const data = await this.service.trackPublic(req.params.id);
      res.status(200).json({ success: true, data });
    } catch (error) { next(error); }
  }

  // ---------------------------------------------------------------------------
  // POST /orders (PDV)
  // ---------------------------------------------------------------------------

  async create(req: Request, res: Response, next: NextFunction): Promise<void> {
    const log = createRequestLogger(req.id, req.company.id);
    try {
      const order = await this.service.create({
        companyId : req.company.id,
        createdBy : req.user.id,
        origin    : 'pdv',
        ...req.body,
      });

      log.info('Pedido PDV criado', { orderId: order.id, sequential: order.sequential_number });
      res.status(201).json({ success: true, data: order });
    } catch (error) { next(error); }
  }

  // ---------------------------------------------------------------------------
  // POST /orders/public (cardápio web — delivery / retirada)
  // ---------------------------------------------------------------------------

  async createPublic(req: Request, res: Response, next: NextFunction): Promise<void> {
    const log = createRequestLogger(req.id);
    try {
      const order = await this.service.create({
        ...req.body,
        origin: req.body.type === 'pickup' ? 'web' : 'web',
      });

      log.info('Pedido público criado', {
        orderId   : order.id,
        sequential: order.sequential_number,
        companyId : order.company_id,
      });

      res.status(201).json({ success: true, data: order });
    } catch (error) { next(error); }
  }

  // ---------------------------------------------------------------------------
  // POST /orders/table (QR Code de mesa)
  // ---------------------------------------------------------------------------

  async createFromTable(req: Request, res: Response, next: NextFunction): Promise<void> {
    const log = createRequestLogger(req.id, req.company.id);
    try {
      const tableData = (req as Request & { table: { id: string; identifier: string } }).table;

      const order = await this.service.create({
        companyId: req.company.id,
        tableId  : tableData.id,
        origin   : 'table',
        type     : 'table',
        ...req.body,
      });

      log.info('Pedido de mesa criado', {
        orderId   : order.id,
        tableId   : tableData.id,
        sequential: order.sequential_number,
      });

      res.status(201).json({ success: true, data: order });
    } catch (error) { next(error); }
  }

  // ---------------------------------------------------------------------------
  // PATCH /orders/:id/status
  // ---------------------------------------------------------------------------

  async updateStatus(req: Request, res: Response, next: NextFunction): Promise<void> {
    const log = createRequestLogger(req.id, req.company.id);
    try {
      const { status, estimatedTime } = req.body as {
        status       : string;
        estimatedTime?: number;
      };

      const order = await this.service.updateStatus({
        id           : req.params.id,
        companyId    : req.company.id,
        newStatus    : status,
        updatedBy    : req.user,
        estimatedTime,
      });

      log.info('Status do pedido atualizado', {
        orderId  : order.id,
        newStatus: order.status,
        updatedBy: req.user.id,
      });

      res.status(200).json({ success: true, data: order });
    } catch (error) { next(error); }
  }

  // ---------------------------------------------------------------------------
  // PATCH /orders/:id/assign
  // ---------------------------------------------------------------------------

  async assign(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const { userId } = req.body as { userId: string };

      const order = await this.service.assign({
        id       : req.params.id,
        companyId: req.company.id,
        userId,
      });

      res.status(200).json({ success: true, data: order });
    } catch (error) { next(error); }
  }

  // ---------------------------------------------------------------------------
  // POST /orders/:id/items
  // ---------------------------------------------------------------------------

  async addItem(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const order = await this.service.addItem({
        orderId  : req.params.id,
        companyId: req.company.id,
        item     : req.body,
      });

      res.status(200).json({ success: true, data: order });
    } catch (error) { next(error); }
  }

  // ---------------------------------------------------------------------------
  // DELETE /orders/:id/items/:itemId
  // ---------------------------------------------------------------------------

  async removeItem(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const order = await this.service.removeItem({
        orderId  : req.params.id,
        itemId   : req.params.itemId,
        companyId: req.company.id,
      });

      res.status(200).json({ success: true, data: order });
    } catch (error) { next(error); }
  }

  // ---------------------------------------------------------------------------
  // POST /orders/:id/payments
  // ---------------------------------------------------------------------------

  async addPayment(req: Request, res: Response, next: NextFunction): Promise<void> {
    const log = createRequestLogger(req.id, req.company.id);
    try {
      const result = await this.service.addPayment({
        orderId  : req.params.id,
        companyId: req.company.id,
        payment  : req.body,
      });

      log.info('Pagamento registrado', {
        orderId: req.params.id,
        method : req.body.method,
        amount : req.body.amount,
      });

      res.status(200).json({ success: true, data: result });
    } catch (error) { next(error); }
  }

  // ---------------------------------------------------------------------------
  // POST /orders/:id/print
  // ---------------------------------------------------------------------------

  async print(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const printData = await this.service.getPrintData({
        orderId  : req.params.id,
        companyId: req.company.id,
      });

      res.status(200).json({ success: true, data: printData });
    } catch (error) { next(error); }
  }

  // ---------------------------------------------------------------------------
  // POST /orders/:id/cancel
  // ---------------------------------------------------------------------------

  async cancel(req: Request, res: Response, next: NextFunction): Promise<void> {
    const log = createRequestLogger(req.id, req.company.id);
    try {
      const { reason } = req.body as { reason: string };

      const order = await this.service.cancel({
        id        : req.params.id,
        companyId : req.company.id,
        cancelledBy: req.user,
        reason,
      });

      log.info('Pedido cancelado', {
        orderId    : order.id,
        cancelledBy: req.user.id,
        reason,
      });

      res.status(200).json({ success: true, data: order });
    } catch (error) { next(error); }
  }

  // ---------------------------------------------------------------------------
  // DELETE /orders/:id
  // ---------------------------------------------------------------------------

  async delete(req: Request, res: Response, next: NextFunction): Promise<void> {
    const log = createRequestLogger(req.id, req.company.id);
    try {
      await this.service.delete({
        id       : req.params.id,
        companyId: req.company.id,
      });

      log.info('Pedido deletado', { orderId: req.params.id, deletedBy: req.user.id });
      res.status(204).send();
    } catch (error) { next(error); }
  }

  // ---------------------------------------------------------------------------
  // GET /orders/stream (SSE — Server-Sent Events)
  // ---------------------------------------------------------------------------

  /**
   * Mantém uma conexão SSE aberta e envia eventos de novos pedidos
   * e atualizações de status em tempo real para o painel do restaurante.
   *
   * O cliente se conecta UMA vez e recebe eventos continuamente.
   * Muito mais eficiente que polling a cada N segundos.
   */
  async stream(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const companyId = req.company.id;

      // Configura headers SSE
      res.setHeader('Content-Type',  'text/event-stream');
      res.setHeader('Cache-Control', 'no-cache');
      res.setHeader('Connection',    'keep-alive');
      res.setHeader('X-Accel-Buffering', 'no'); // Desabilita buffering no Nginx/Render

      res.flushHeaders();

      // Envia heartbeat a cada 25s para manter a conexão ativa
      const heartbeat = setInterval(() => {
        res.write(': heartbeat\n\n');
      }, 25_000);

      // Registra o cliente no serviço de streaming
      const unsubscribe = this.service.subscribeToOrders(companyId, (event) => {
        res.write(`event: ${event.type}\n`);
        res.write(`data: ${JSON.stringify(event.data)}\n\n`);
      });

      // Limpeza quando o cliente desconectar
      req.on('close', () => {
        clearInterval(heartbeat);
        unsubscribe();
      });
    } catch (error) { next(error); }
  }
}
