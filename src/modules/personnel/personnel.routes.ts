import { Router } from 'express';
import multer from 'multer';
import { z } from 'zod';
import { systemDb } from '../../db/knex';
import { authMiddleware } from '../../middleware/auth.middleware';
import { asyncHandler } from '../../shared/utils/async-handler';
import { auditMiddleware } from '../../middleware/audit.middleware';
import { requirePermission } from '../../middleware/permission.middleware';
import { requireAssignedScopeMiddleware } from '../../middleware/scope-required.middleware';
import { parsePagination } from '../../shared/utils/pagination';
import { parseBody } from '../../shared/utils/parse-body';
import { PersonnelModel } from './personnel.model';
import { PersonnelService } from './personnel.service';

const router = Router();
const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 5 * 1024 * 1024
  }
});
const service = new PersonnelService(new PersonnelModel(systemDb));

const createSchema = z.object({
  cid: z.string().trim().min(13).max(13),
  firstName: z.string().trim().min(1).max(100),
  lastName: z.string().trim().min(1).max(100),
  hospcode: z.string().trim().min(1).max(10)
});

const updateSchema = z
  .object({
    cid: z.string().trim().min(13).max(13).optional(),
    firstName: z.string().trim().min(1).max(100).optional(),
    lastName: z.string().trim().min(1).max(100).optional(),
    hospcode: z.string().trim().min(1).max(10).optional()
  })
  .refine((value) => Object.keys(value).length > 0, {
    message: 'EMPTY_UPDATE_PAYLOAD'
  });

router.get(
  '/',
  authMiddleware,
  requirePermission('personnel.read'),
  requireAssignedScopeMiddleware,
  auditMiddleware('personnel', 'read'),
  asyncHandler(async (req, res) => {
    const pagination = parsePagination(req.query as Record<string, unknown>);

    const data = await service.list(req.auth!, {
      search: req.query.search ? String(req.query.search) : undefined,
      ...pagination
    });

    res.json({ ok: true, data });
  })
);

router.post(
  '/',
  authMiddleware,
  requirePermission('personnel.manage'),
  requireAssignedScopeMiddleware,
  auditMiddleware('personnel', 'create'),
  asyncHandler(async (req, res) => {
    const payload = parseBody(createSchema, req.body, res, 'INVALID_PERSONNEL_PAYLOAD');
    if (!payload) return;
    req.effectiveHospcodes = [payload.hospcode];

    const result = await service.create(req.auth!, payload);
    if (!result.ok) {
      res.status(Number(result.status ?? 400)).json(result);
      return;
    }

    res.status(Number(result.status ?? 201)).json(result);
  })
);

router.put(
  '/:id',
  authMiddleware,
  requirePermission('personnel.manage'),
  requireAssignedScopeMiddleware,
  auditMiddleware('personnel', 'update'),
  asyncHandler(async (req, res) => {
    const payload = parseBody(updateSchema, req.body, res, 'INVALID_PERSONNEL_PAYLOAD');
    if (!payload) return;
    if (payload.hospcode) {
      req.effectiveHospcodes = [payload.hospcode];
    }

    const result = await service.update(req.auth!, req.params.id, payload);
    if (!result.ok) {
      res.status(Number(result.status ?? 400)).json(result);
      return;
    }

    res.status(Number(result.status ?? 200)).json(result);
  })
);

router.delete(
  '/:id',
  authMiddleware,
  requirePermission('personnel.manage'),
  requireAssignedScopeMiddleware,
  auditMiddleware('personnel', 'delete'),
  asyncHandler(async (req, res) => {
    const result = await service.remove(req.auth!, req.params.id);
    if (!result.ok) {
      res.status(Number(result.status ?? 400)).json(result);
      return;
    }

    res.status(Number(result.status ?? 200)).json(result);
  })
);

router.get(
  '/template',
  authMiddleware,
  requirePermission('personnel.read'),
  auditMiddleware('personnel', 'download_template'),
  asyncHandler(async (_req, res) => {
    const file = await service.exportTemplate();
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="${file.filename}"`);
    res.setHeader('Cache-Control', 'no-store');
    res.send(file.fileBuffer);
  })
);

router.post(
  '/upload',
  authMiddleware,
  requirePermission('personnel.manage'),
  requireAssignedScopeMiddleware,
  upload.single('file'),
  auditMiddleware('personnel', 'upload_excel'),
  asyncHandler(async (req, res) => {
    if (!req.file?.buffer) {
      res.status(400).json({ ok: false, error: 'FILE_REQUIRED' });
      return;
    }

    const result = await service.uploadExcel(req.auth!, req.file.buffer);
    if (!result.ok) {
      res.status(Number(result.status ?? 400)).json(result);
      return;
    }

    res.status(Number(result.status ?? 200)).json(result);
  })
);

export const personnelRoutes = router;
