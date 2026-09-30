import { Router } from 'express';
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

const asyncHandler = (handler: (req: any, res: any) => Promise<void>) =>
  (req: any, res: any, next: any): void => {
    Promise.resolve(handler(req, res)).catch(next);
  };

/**
 * ทะเบียนหน่วยงานมาจาก hcode_health_office ที่ cron ของอีกระบบดูแล
 * จึงไม่มี endpoint เพิ่ม/แก้/ลบหน่วยงานอีกต่อไป
 * เหลือเรียกดูทะเบียน และเปิด/ปิดการลงเวลา
 */
router.get(
  '/',
  authMiddleware,
  requirePermission('office_settings.read'),
  requireAssignedScopeMiddleware,
  auditMiddleware('office-settings', 'read'),
  asyncHandler(async (req, res) => {
    const pagination = parsePagination(req.query as Record<string, unknown>);
    const search = typeof req.query.search === 'string' ? req.query.search.trim() : undefined;
    const provinceCode = typeof req.query.provinceCode === 'string' ? req.query.provinceCode.trim() : undefined;
    const rawStatus = typeof req.query.checkinStatus === 'string' ? req.query.checkinStatus.toUpperCase() : '';
    const checkinStatus = rawStatus === 'Y' || rawStatus === 'N' ? (rawStatus as 'Y' | 'N') : undefined;

    const result = await service.list(req.auth!, {
      search: search || undefined,
      provinceCode: provinceCode || undefined,
      checkinStatus,
      ...pagination
    });

    res.json({ ok: true, data: result.data });
  })
);

router.post(
  '/:code/checkin-registration',
  authMiddleware,
  requirePermission('office_settings.update'),
  requireAssignedScopeMiddleware,
  auditMiddleware('office-settings', 'register_checkin'),
  asyncHandler(async (req, res) => {
    const result = await service.setCheckin(req.auth!, String(req.params.code), 'Y');
    res.status(Number(result.status)).json(result);
  })
);

/** ถอนการลงทะเบียน ซึ่งเดิมทำไม่ได้เลยเพราะไม่มี endpoint */
router.delete(
  '/:code/checkin-registration',
  authMiddleware,
  requirePermission('office_settings.update'),
  requireAssignedScopeMiddleware,
  auditMiddleware('office-settings', 'unregister_checkin'),
  asyncHandler(async (req, res) => {
    const result = await service.setCheckin(req.auth!, String(req.params.code), 'N');
    res.status(Number(result.status)).json(result);
  })
);

export const officeSettingsRoutes = router;
