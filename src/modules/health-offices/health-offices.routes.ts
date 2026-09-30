import { Router } from 'express';
import { z } from 'zod';
import { systemDb } from '../../db/knex';
import { authMiddleware } from '../../middleware/auth.middleware';
import { parsePagination } from '../../shared/utils/pagination';
import { HealthOfficesModel } from './health-offices.model';

const router = Router();
const model = new HealthOfficesModel(systemDb);

const codesSchema = z.object({
  hcode9: z.array(z.string().min(1)).max(200).optional(),
  code5: z.array(z.string().min(1)).max(200).optional()
});

const asyncHandler = (
  handler: (req: Parameters<Parameters<Router['get']>[1]>[0], res: any) => Promise<void>
) => {
  return (req: any, res: any, next: any): void => {
    Promise.resolve(handler(req, res)).catch(next);
  };
};

/**
 * ทะเบียนสถานพยาบาลจาก hcode_health_office ที่ cron ของอีกระบบ upsert ให้ทุกวัน
 *
 * ต้องล็อกอินแต่ไม่บังคับ permission เฉพาะ เพราะเป็นข้อมูลอ้างอิงสาธารณะ
 * และทุกหน้าที่ต้องเลือกหน่วยงานต้องใช้ ถ้าผูกกับ permission ใด permission หนึ่ง
 * หน้าที่ไม่มี permission นั้นจะเลือกหน่วยงานไม่ได้ (ปัญหาที่เคยเจอกับ office_settings.read)
 */
router.get(
  '/',
  authMiddleware,
  asyncHandler(async (req, res) => {
    const pagination = parsePagination(req.query as Record<string, unknown>);
    const search = typeof req.query.search === 'string' ? req.query.search.trim() : undefined;
    const provinceCode = typeof req.query.provinceCode === 'string' ? req.query.provinceCode.trim() : undefined;
    const activeOnly = req.query.activeOnly !== '0';

    const data = await model.search({
      search: search || undefined,
      provinceCode: provinceCode || undefined,
      activeOnly,
      pageSize: pagination.pageSize,
      offset: pagination.offset
    });

    res.json({ ok: true, data: { ...data, page: pagination.page, pageSize: pagination.pageSize } });
  })
);

/** แปลงรหัสที่บันทึกไว้แล้วให้เป็นชื่อ ใช้ตอนโหลดฟอร์มแก้ไข */
router.post(
  '/resolve',
  authMiddleware,
  asyncHandler(async (req, res) => {
    const payload = codesSchema.parse(req.body);
    const rows = await model.findByCodes(payload);
    res.json({ ok: true, data: { rows } });
  })
);

export const healthOfficesRoutes = router;
