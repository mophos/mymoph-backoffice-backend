import { NextFunction, Request, Response } from 'express';
import { systemDb } from '../db/knex';
import { AuditService } from '../shared/services/audit.service';

const auditService = new AuditService(systemDb);

export const auditMiddleware = (module: string, action: string) => {
  return (req: Request, res: Response, next: NextFunction): void => {
    const start = Date.now();

    res.on('finish', async () => {
      try {
        await auditService.write({
          userId: req.auth?.userId,
          cid: req.auth?.cid,
          module,
          action,
          hospcode:
            (Array.isArray(req.effectiveHospcodes) && req.effectiveHospcodes.length
              ? req.effectiveHospcodes.join(',')
              : req.query.hospcode?.toString()) ?? undefined,
          requestId: req.requestId,
          ipAddress: req.ip,
          userAgent: req.get('user-agent') ?? undefined,
          statusCode: res.statusCode,
          details: {
            method: req.method,
            path: req.originalUrl,
            durationMs: Date.now() - start
          }
        });
      } catch (error) {
        console.error('[audit] failed to write log', error);
      }
    });

    next();
  };
};
