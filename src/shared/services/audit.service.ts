import type { Knex } from 'knex';

export interface AuditLogInput {
  userId?: string;
  cid?: string;
  module: string;
  action: string;
  resourceType?: string;
  resourceId?: string;
  hospcode?: string;
  requestId?: string;
  ipAddress?: string;
  userAgent?: string;
  statusCode?: number;
  details?: Record<string, unknown>;
}

export class AuditService {
  constructor(private readonly db: Knex) {}

  async write(log: AuditLogInput): Promise<void> {
    await this.db('audit_logs').insert({
      user_id: log.userId ?? null,
      cid: log.cid ?? null,
      module: log.module,
      action: log.action,
      resource_type: log.resourceType ?? null,
      resource_id: log.resourceId ?? null,
      hospcode: log.hospcode ?? null,
      request_id: log.requestId ?? null,
      ip_address: log.ipAddress ?? null,
      user_agent: log.userAgent ?? null,
      status_code: log.statusCode ?? null,
      details_json: log.details ? JSON.stringify(log.details) : null,
      created_at: this.db.fn.now()
    });
  }
}
