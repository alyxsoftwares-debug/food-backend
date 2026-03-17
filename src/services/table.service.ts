/**
 * @file table.service.ts
 * @description Service do domínio de Mesas.
 * CORREÇÃO: Adicionado cast explícito em chunks.push() para Buffer compatível com Node types.
 */

import QRCode                        from 'qrcode';
import PDFDocument                   from 'pdfkit';
import crypto                        from 'crypto';
import { pgPool, withTransaction }   from '@/config/supabase';
import { AppError, ErrorCode }       from '@/errors/AppError';
import { logger }                    from '@/config/logger';

// ---------------------------------------------------------------------------
// Tipos internos
// ---------------------------------------------------------------------------

type TableStatus = 'available' | 'occupied' | 'reserved' | 'maintenance';

interface CreateTableDTO {
  companyId : string;
  identifier: string;
  name?     : string;
  capacity? : number;
  location? : string;
  isActive? : boolean;
}

interface BulkCreateDTO {
  companyId : string;
  prefix    : string;
  startAt   : number;
  count     : number;
  capacity? : number;
  location? : string;
  padLength?: number;
}

interface OpenTabDTO {
  tableId      : string;
  companyId    : string;
  openedBy     : string;
  customerName?: string;
  covers?      : number;
}

interface CloseTabDTO {
  tableId  : string;
  companyId: string;
  closedBy : string;
}

interface TransferDTO {
  sourceTableId: string;
  targetTableId: string;
  companyId    : string;
  transferredBy: string;
}

// ---------------------------------------------------------------------------
// TableService
// ---------------------------------------------------------------------------

export class TableService {

  async getDashboard(companyId: string) {
    const { rows } = await pgPool.query(
      `SELECT
         t.id,
         t.identifier,
         t.name,
         t.capacity,
         t.status,
         t.location,
         t.is_active,
         o.id                AS order_id,
         o.sequential_number AS order_number,
         o.status            AS order_status,
         o.total             AS order_total,
         o.customer_name     AS order_customer,
         o.created_at        AS order_opened_at,
         CASE
           WHEN t.status = 'occupied' AND o.created_at IS NOT NULL
           THEN ROUND(EXTRACT(EPOCH FROM (NOW() - o.created_at)) / 60)::INT
           ELSE NULL
         END AS occupied_minutes,
         (SELECT COUNT(*) FROM food.order_items oi WHERE oi.order_id = o.id) AS item_count
       FROM food.tables t
       LEFT JOIN food.orders o ON o.id = t.current_order_id
       WHERE t.company_id = $1
       ORDER BY
         CASE t.status
           WHEN 'occupied'    THEN 1
           WHEN 'reserved'    THEN 2
           WHEN 'available'   THEN 3
           WHEN 'maintenance' THEN 4
         END, t.identifier ASC`,
      [companyId],
    );

    const grouped: Record<string, Record<string, unknown>[]> = {};
    for (const row of rows) {
      const loc = (row.location as string) ?? 'Sem localização';
      if (!grouped[loc]) grouped[loc] = [];
      (grouped[loc] as Record<string, unknown>[]).push(row as Record<string, unknown>);
    }

    return {
      tables : rows,
      grouped,
      summary: {
        total      : rows.length,
        available  : rows.filter((r) => r.status === 'available').length,
        occupied   : rows.filter((r) => r.status === 'occupied').length,
        reserved   : rows.filter((r) => r.status === 'reserved').length,
        maintenance: rows.filter((r) => r.status === 'maintenance').length,
      },
    };
  }

  async list({ companyId, status, location }: {
    companyId: string; status?: string; location?: string;
  }) {
    const conditions: string[] = ['company_id = $1'];
    const params: unknown[]    = [companyId];
    let idx = 2;

    if (status)   { conditions.push(`status = $${idx++}`); params.push(status); }
    if (location) { conditions.push(`location ILIKE $${idx++}`); params.push(`%${location}%`); }

    const { rows } = await pgPool.query(
      `SELECT * FROM food.tables WHERE ${conditions.join(' AND ')} ORDER BY identifier ASC`,
      params,
    );
    return rows;
  }

  async findById({ id, companyId }: { id: string; companyId: string }) {
    const { rows } = await pgPool.query(
      `SELECT t.*,
         o.id                AS order_id,
         o.sequential_number AS order_number,
         o.status            AS order_status,
         o.total             AS order_total,
         o.created_at        AS order_opened_at
       FROM food.tables t
       LEFT JOIN food.orders o ON o.id = t.current_order_id
       WHERE t.id = $1 AND t.company_id = $2 LIMIT 1`,
      [id, companyId],
    );
    if (rows.length === 0) {
      throw new AppError('Mesa não encontrada.', 404, ErrorCode.TABLE_NOT_FOUND);
    }
    return rows[0];
  }

  async create(dto: CreateTableDTO) {
    const { rows: existing } = await pgPool.query(
      `SELECT id FROM food.tables WHERE company_id = $1 AND identifier = $2 LIMIT 1`,
      [dto.companyId, dto.identifier],
    );
    if (existing.length > 0) {
      throw AppError.conflict(`Já existe uma mesa com o identificador "${dto.identifier}".`);
    }

    const token = crypto.randomBytes(32).toString('hex');
    const { rows } = await pgPool.query(
      `INSERT INTO food.tables
         (company_id, identifier, name, capacity, location, qr_code_token, is_active)
       VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *`,
      [dto.companyId, dto.identifier, dto.name ?? null, dto.capacity ?? 4,
       dto.location ?? null, token, dto.isActive !== false],
    );
    return rows[0];
  }

  async bulkCreate(dto: BulkCreateDTO) {
    const { companyId, prefix, startAt, count, capacity, location, padLength = 2 } = dto;
    if (count < 1 || count > 100) throw AppError.validation('Quantidade deve ser entre 1 e 100.');

    return withTransaction(async (client) => {
      const created: Record<string, unknown>[] = [];
      for (let i = 0; i < count; i++) {
        const identifier = `${prefix}${String(startAt + i).padStart(padLength, '0')}`;
        const { rows: existing } = await client.query(
          `SELECT id FROM food.tables WHERE company_id = $1 AND identifier = $2 LIMIT 1`,
          [companyId, identifier],
        );
        if (existing.length > 0) {
          logger.warn(`[TableService] Identificador "${identifier}" já existe — pulando.`);
          continue;
        }
        const token = crypto.randomBytes(32).toString('hex');
        const { rows } = await client.query(
          `INSERT INTO food.tables (company_id, identifier, capacity, location, qr_code_token)
           VALUES ($1,$2,$3,$4,$5) RETURNING *`,
          [companyId, identifier, capacity ?? 4, location ?? null, token],
        );
        created.push(rows[0]);
      }
      return created;
    });
  }

  async update({ id, companyId, data }: {
    id: string; companyId: string; data: Record<string, unknown>;
  }) {
    const allowed: Record<string, string> = {
      identifier: 'identifier', name: 'name',
      capacity  : 'capacity',  location: 'location',
      isActive  : 'is_active',
    };

    const setClauses: string[] = [];
    const params: unknown[]    = [];
    let idx = 1;

    for (const [key, col] of Object.entries(allowed)) {
      if (key in data && data[key] !== undefined) {
        setClauses.push(`${col} = $${idx++}`);
        params.push(data[key]);
      }
    }

    if (setClauses.length === 0) return this.findById({ id, companyId });

    params.push(id, companyId);
    const { rows } = await pgPool.query(
      `UPDATE food.tables SET ${setClauses.join(', ')}
       WHERE id = $${idx} AND company_id = $${idx + 1} RETURNING *`,
      params,
    );
    if (rows.length === 0) throw new AppError('Mesa não encontrada.', 404, ErrorCode.TABLE_NOT_FOUND);
    return rows[0];
  }

  async delete({ id, companyId }: { id: string; companyId: string }) {
    const table = await this.findById({ id, companyId });
    if (table.status === 'occupied') {
      throw new AppError('Mesa com pedido ativo. Feche a comanda primeiro.', 400, ErrorCode.TABLE_OCCUPIED);
    }
    const { rowCount } = await pgPool.query(
      `DELETE FROM food.tables WHERE id = $1 AND company_id = $2`,
      [id, companyId],
    );
    if (!rowCount) throw new AppError('Mesa não encontrada.', 404, ErrorCode.TABLE_NOT_FOUND);
  }

  async updateStatus({ id, companyId, status }: {
    id: string; companyId: string; status: TableStatus;
  }) {
    const table = await this.findById({ id, companyId });
    if (table.status === 'occupied' && status !== 'available') {
      throw new AppError('Mesa com pedido ativo.', 400, ErrorCode.TABLE_OCCUPIED);
    }
    const { rows } = await pgPool.query(
      `UPDATE food.tables SET status = $1 WHERE id = $2 AND company_id = $3 RETURNING *`,
      [status, id, companyId],
    );
    return rows[0];
  }

  async openTab({ tableId, companyId, openedBy, customerName, covers }: OpenTabDTO) {
    const table = await this.findById({ id: tableId, companyId });
    if (table.status === 'occupied') throw new AppError('Mesa já possui comanda.', 409, ErrorCode.TABLE_OCCUPIED);
    if (table.status === 'maintenance') throw new AppError('Mesa em manutenção.', 400, ErrorCode.TABLE_UNAVAILABLE);

    return withTransaction(async (client) => {
      const { rows: orderRows } = await client.query(
        `INSERT INTO food.orders
           (company_id, origin, type, status, table_id, assigned_to, customer_name, subtotal, total, metadata)
         VALUES ($1,'table','table','pending',$2,$3,$4,0,0,$5) RETURNING *`,
        [companyId, tableId, openedBy, customerName ?? null,
         JSON.stringify({ covers: covers ?? null })],
      );
      const { rows: tableRows } = await client.query(
        `SELECT * FROM food.tables WHERE id = $1`, [tableId],
      );
      return { table: tableRows[0], order: orderRows[0] };
    });
  }

  async closeTab({ tableId, companyId, closedBy }: CloseTabDTO) {
    const table = await this.findById({ id: tableId, companyId });
    if (table.status !== 'occupied' || !table.order_id) {
      throw new AppError('Mesa não possui comanda aberta.', 400, ErrorCode.TABLE_UNAVAILABLE);
    }

    return withTransaction(async (client) => {
      const { rows: orderRows } = await client.query(
        `SELECT * FROM food.orders WHERE id = $1 AND company_id = $2 LIMIT 1`,
        [table.order_id, companyId],
      );
      if (!orderRows[0]) throw new AppError('Pedido ativo não encontrado.', 404, ErrorCode.ORDER_NOT_FOUND);

      const { rows: updatedOrderRows } = await client.query(
        `UPDATE food.orders
         SET status = 'delivered', delivered_at = NOW(),
             internal_notes = COALESCE(internal_notes, '') || $1
         WHERE id = $2 AND company_id = $3 RETURNING *`,
        [`\nFechado por ${closedBy} em ${new Date().toISOString()}`, orderRows[0].id, companyId],
      );

      const { rows: tableRows } = await client.query(
        `SELECT * FROM food.tables WHERE id = $1`, [tableId],
      );
      return { table: tableRows[0], order: updatedOrderRows[0] };
    });
  }

  async transfer({ sourceTableId, targetTableId, companyId, transferredBy }: TransferDTO) {
    if (sourceTableId === targetTableId) throw AppError.badRequest('Origem e destino iguais.');

    const [source, target] = await Promise.all([
      this.findById({ id: sourceTableId, companyId }),
      this.findById({ id: targetTableId, companyId }),
    ]);

    if (source.status !== 'occupied' || !source.order_id) {
      throw new AppError('Mesa de origem sem comanda.', 400, ErrorCode.TABLE_UNAVAILABLE);
    }
    if (target.status === 'occupied') throw new AppError('Mesa destino já ocupada.', 409, ErrorCode.TABLE_OCCUPIED);
    if (target.status === 'maintenance') throw new AppError('Mesa destino em manutenção.', 400, ErrorCode.TABLE_UNAVAILABLE);

    return withTransaction(async (client) => {
      const { rows: orderRows } = await client.query(
        `UPDATE food.orders
         SET table_id = $1,
             internal_notes = COALESCE(internal_notes, '') || $2
         WHERE id = $3 AND company_id = $4 RETURNING *`,
        [
          targetTableId,
          `\nTransferido de ${source.identifier} para ${target.identifier} por ${transferredBy}`,
          source.order_id, companyId,
        ],
      );
      await client.query(
        `UPDATE food.tables SET status = 'available', current_order_id = NULL WHERE id = $1`,
        [sourceTableId],
      );
      await client.query(
        `UPDATE food.tables SET status = 'occupied', current_order_id = $1 WHERE id = $2`,
        [source.order_id, targetTableId],
      );
      const { rows: tableRows } = await client.query(
        `SELECT * FROM food.tables WHERE id = $1`, [targetTableId],
      );
      return { table: tableRows[0], order: orderRows[0] };
    });
  }

  async regenerateQrCode({ id, companyId }: { id: string; companyId: string }) {
    const newToken = crypto.randomBytes(32).toString('hex');
    const { rows } = await pgPool.query(
      `UPDATE food.tables SET qr_code_token = $1, qr_code_url = NULL
       WHERE id = $2 AND company_id = $3 RETURNING *`,
      [newToken, id, companyId],
    );
    if (rows.length === 0) throw new AppError('Mesa não encontrada.', 404, ErrorCode.TABLE_NOT_FOUND);
    return rows[0];
  }

  async generateQrCodePng({ id, companyId }: { id: string; companyId: string }): Promise<Buffer> {
    const table   = await this.findById({ id, companyId });
    const menuUrl = `${process.env.FRONTEND_URL ?? 'http://localhost:3000'}/mesa/${table.qr_code_token}`;

    const pngBuffer = await QRCode.toBuffer(menuUrl, {
      type               : 'png',
      width              : 512,
      margin             : 2,
      errorCorrectionLevel: 'H',
      color: { dark: '#1A202C', light: '#FFFFFF' },
    });

    return pngBuffer;
  }

  async generateBulkQrCodePdf(companyId: string): Promise<Buffer> {
    const { rows: tables } = await pgPool.query(
      `SELECT id, identifier, name, location, qr_code_token
       FROM food.tables WHERE company_id = $1 AND is_active = TRUE ORDER BY identifier ASC`,
      [companyId],
    );

    if (tables.length === 0) throw AppError.badRequest('Nenhuma mesa ativa encontrada.');

    const { rows: companyRows } = await pgPool.query(
      `SELECT name FROM food.companies WHERE id = $1 LIMIT 1`, [companyId],
    );
    const companyName = (companyRows[0]?.name as string) ?? 'Restaurante';

    const doc    = new PDFDocument({ size: 'A4', margin: 30 });
    // CORREÇÃO: cast explícito para Buffer
    const chunks: Buffer[] = [];

    doc.on('data', (chunk: unknown) => chunks.push(chunk as Buffer));

    const ITEMS_PER_ROW = 3;
    const ITEM_WIDTH    = 170;
    const ITEM_HEIGHT   = 200;
    const START_X       = 30;
    const START_Y       = 80;
    const GAP_X         = 10;
    const GAP_Y         = 20;

    doc
      .fontSize(18).font('Helvetica-Bold')
      .text(`QR Codes das Mesas — ${companyName}`, { align: 'center' })
      .moveDown(0.5)
      .fontSize(10).font('Helvetica')
      .text(`Gerado em ${new Date().toLocaleDateString('pt-BR')}`, { align: 'center' })
      .moveDown(1);

    for (let i = 0; i < tables.length; i++) {
      const table  = tables[i];
      const col    = i % ITEMS_PER_ROW;
      const row    = Math.floor(i / ITEMS_PER_ROW);
      const x      = START_X + col * (ITEM_WIDTH + GAP_X);
      const y      = START_Y + row * (ITEM_HEIGHT + GAP_Y);

      if (i > 0 && i % (ITEMS_PER_ROW * 4) === 0) doc.addPage();

      const menuUrl  = `${process.env.FRONTEND_URL ?? 'http://localhost:3000'}/mesa/${table.qr_code_token}`;
      const qrBuffer = await QRCode.toBuffer(menuUrl, {
        type: 'png', width: 150, margin: 1, errorCorrectionLevel: 'H',
      });

      doc.rect(x, y, ITEM_WIDTH, ITEM_HEIGHT).stroke('#E2E8F0');
      doc.image(qrBuffer, x + 10, y + 10, { width: 150, height: 150 });
      doc.fontSize(12).font('Helvetica-Bold')
        .text((table.name ?? table.identifier) as string, x, y + 165, { width: ITEM_WIDTH, align: 'center' });

      if (table.location) {
        doc.fontSize(8).font('Helvetica').fillColor('#718096')
          .text(table.location as string, x, y + 182, { width: ITEM_WIDTH, align: 'center' })
          .fillColor('#000000');
      }
    }

    doc.end();

    return new Promise((resolve, reject) => {
      doc.on('end', () => resolve(Buffer.concat(chunks)));
      doc.on('error', reject);
    });
  }
}
