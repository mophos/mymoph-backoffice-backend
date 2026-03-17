import { Router } from 'express';
import { z } from 'zod';
import { mymophDb, systemDb } from '../../db/knex';
import { authMiddleware } from '../../middleware/auth.middleware';
import { auditMiddleware } from '../../middleware/audit.middleware';
import { requirePermission } from '../../middleware/permission.middleware';
import { requireAssignedScopeMiddleware } from '../../middleware/scope-required.middleware';
import { parsePagination } from '../../shared/utils/pagination';
import { OfficeSettingsModel } from './office-settings.model';
import { OfficeSettingsService } from './office-settings.service';

const router = Router();
const service = new OfficeSettingsService(new OfficeSettingsModel(systemDb, mymophDb));
const activeFlagSchema = z.union([z.literal(0), z.literal(1)]);

const createSchema = z.object({
  hospcode: z.string().trim().min(1).max(10),
  name: z.string().trim().min(1).max(255),
  province_code: z.string().trim().max(10).optional().nullable(),
  is_active: activeFlagSchema.optional()
});

const updateSchema = z.object({
  name: z.string().trim().min(1).max(255).optional(),
  province_code: z.string().trim().max(10).optional().nullable(),
  is_active: activeFlagSchema.optional()
}).refine((value) => Object.keys(value).length > 0, {
  message: 'EMPTY_UPDATE_PAYLOAD'
});

router.get(
  '/',
  authMiddleware,
  requirePermission('office_settings.read'),
  requireAssignedScopeMiddleware,
  auditMiddleware('office-settings', 'read'),
  async (req, res) => {
    const pagination = parsePagination(req.query as Record<string, unknown>);
    const isActiveRaw = req.query.isActive;
    const isActive =
      isActiveRaw === '0' || isActiveRaw === '1'
        ? Number(isActiveRaw) as 0 | 1
        : undefined;

    const data = await service.list(req.auth!, {
      search: req.query.search ? String(req.query.search) : undefined,
      isActive,
      ...pagination,
      effectiveHospcodes: req.auth!.hospcodes
    });

    res.json({ ok: true, data });
  }
);

router.post(
  '/',
  authMiddleware,
  requirePermission('office_settings.update'),
  auditMiddleware('office-settings', 'create'),
  async (req, res) => {
    const payload = createSchema.parse(req.body);
    req.effectiveHospcodes = [payload.hospcode];

    const result = await service.create(req.auth!, payload);
    if (!result.ok) {
      res.status(Number(result.status ?? 400)).json(result);
      return;
    }

    res.status(Number(result.status ?? 201)).json(result);
  }
);

router.put(
  '/:hospcode',
  authMiddleware,
  requirePermission('office_settings.update'),
  auditMiddleware('office-settings', 'update'),
  async (req, res) => {
    const payload = updateSchema.parse(req.body);
    req.effectiveHospcodes = [req.params.hospcode];

    const result = await service.update(req.auth!, req.params.hospcode, payload);
    if (!result.ok) {
      res.status(Number(result.status ?? 400)).json(result);
      return;
    }

    res.status(Number(result.status ?? 200)).json(result);
  }
);

router.delete(
  '/:hospcode',
  authMiddleware,
  requirePermission('office_settings.update'),
  auditMiddleware('office-settings', 'delete'),
  async (req, res) => {
    req.effectiveHospcodes = [req.params.hospcode];
    const result = await service.delete(req.auth!, req.params.hospcode);
    if (!result.ok) {
      res.status(Number(result.status ?? 400)).json(result);
      return;
    }

    res.status(Number(result.status ?? 200)).json(result);
  }
);

router.post(
  '/:hospcode/checkin-registration',
  authMiddleware,
  requirePermission('office_settings.update'),
  auditMiddleware('office-settings', 'register_checkin'),
  async (req, res) => {
    const hospcode = z.string().trim().min(1).max(10).parse(req.params.hospcode);
    req.effectiveHospcodes = [hospcode];

    const result = await service.registerCheckinOffice(req.auth!, hospcode);
    if (!result.ok) {
      res.status(Number(result.status ?? 400)).json(result);
      return;
    }

    res.status(Number(result.status ?? 200)).json(result);
  }
);

export const officeSettingsRoutes = router;
