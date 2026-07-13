import { NextFunction, Request, Response, Router } from 'express';
import { z } from 'zod';
import { config } from '../../config/env';
import { getMymophMongoDb } from '../../db/mongodb';
import { authMiddleware } from '../../middleware/auth.middleware';
import { auditMiddleware } from '../../middleware/audit.middleware';
import { requirePermission } from '../../middleware/permission.middleware';
import { parsePagination } from '../../shared/utils/pagination';
import { MymophUsersModel } from './mymoph-users.model';
import { MymophUsersService } from './mymoph-users.service';

const router = Router();
const service = new MymophUsersService(
  new MymophUsersModel(
    getMymophMongoDb,
    config.mymophMongo.usersCollection,
    config.mymophMongo.usersRemoveCollection
  )
);

const objectIdSchema = z.string().regex(/^[a-f\d]{24}$/i);
const deleteSchema = z.object({
  reason: z.string().trim().min(5).max(500)
});

const asyncHandler = (handler: (req: Request, res: Response, next: NextFunction) => Promise<void>) => {
  return (req: Request, res: Response, next: NextFunction): void => {
    Promise.resolve(handler(req, res, next)).catch(next);
  };
};

router.get(
  '/',
  authMiddleware,
  requirePermission('mymoph_user.read'),
  auditMiddleware('mymoph-users', 'search'),
  asyncHandler(async (req, res) => {
    const search = String(req.query.search ?? '').trim();
    if (search.length < 3 || search.length > 100) {
      res.status(400).json({ ok: false, error: 'INVALID_SEARCH' });
      return;
    }

    const pagination = parsePagination(req.query as Record<string, unknown>);
    const result = await service.list(req.auth!, { search, ...pagination });
    if (!result.ok) {
      res.status(Number(result.status)).json(result);
      return;
    }

    res.json(result);
  })
);

router.get(
  '/:id/hr-status',
  authMiddleware,
  requirePermission('mymoph_user.verify_hr'),
  auditMiddleware('mymoph-users', 'verify_hr'),
  asyncHandler(async (req, res) => {
    const parsedId = objectIdSchema.safeParse(req.params.id);
    if (!parsedId.success) {
      res.status(400).json({ ok: false, error: 'INVALID_MONGO_ID' });
      return;
    }

    const result = await service.verifyHr(req.auth!, parsedId.data);
    if (!result.ok) {
      res.status(Number(result.status)).json(result);
      return;
    }

    res.json(result);
  })
);

router.post(
  '/:id/archive-delete',
  authMiddleware,
  requirePermission('mymoph_user.delete'),
  auditMiddleware('mymoph-users', 'archive_delete'),
  asyncHandler(async (req, res) => {
    const parsedId = objectIdSchema.safeParse(req.params.id);
    const parsedBody = deleteSchema.safeParse(req.body);
    if (!parsedId.success) {
      res.status(400).json({ ok: false, error: 'INVALID_MONGO_ID' });
      return;
    }
    if (!parsedBody.success) {
      res.status(400).json({ ok: false, error: 'INVALID_DELETE_REASON' });
      return;
    }

    const result = await service.archiveDelete(req.auth!, parsedId.data, {
      reason: parsedBody.data.reason,
      requestId: req.requestId
    });
    if (!result.ok) {
      res.status(Number(result.status)).json(result);
      return;
    }

    res.json(result);
  })
);

export const mymophUsersRoutes = router;
