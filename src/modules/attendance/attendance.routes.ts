import { Request, Response, Router } from 'express';
import dayjs from 'dayjs';
import { mymophDb, systemDb } from '../../db/knex';
import { authMiddleware } from '../../middleware/auth.middleware';
import { asyncHandler } from '../../shared/utils/async-handler';
import { auditMiddleware } from '../../middleware/audit.middleware';
import { HcodeBridgeService } from '../../shared/services/hcode-bridge.service';

/**
 * ฐาน MyMOPH ยังเก็บรหัสหน่วยงานเป็น code5 ส่วน Back Office กำลังย้ายไป hcode9
 * ทุกคำขอที่ไปกรองข้อมูลลงเวลาจึงต้องผ่านตัวแปลงนี้
 * ดู work-list/work-clear-bug-repair/11-HCODE-MIGRATION.md
 */
const hcodeBridge = new HcodeBridgeService(systemDb);

/**
 * อ่านช่วงวันที่จาก query แล้วตรวจรูปแบบก่อนส่งต่อ
 *
 * เดิมใช้ `String(req.query.from ?? ค่าเริ่มต้น)` ซึ่ง `??` จับได้แค่ undefined/null
 * ค่าว่างหรือข้อความมั่วจึงหลุดไปถึง MySQL แล้วกลายเป็น 500
 * (เข้าถึงได้ง่ายเพราะหน้าเว็บส่งค่าว่างมาได้เมื่อผู้ใช้ล้างช่องวันที่)
 *
 * ค่าว่างหรือไม่ส่งมา = ใช้ค่าเริ่มต้น · ส่งมาแต่รูปแบบผิด = ตอบ 400 ไม่เดาแทน
 */
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

const readDate = (raw: unknown, fallback: string): string | null => {
  const value = String(raw ?? '').trim();
  if (!value) return fallback;
  // regex คุมรูปแบบ ส่วน isValid คุมวันที่ที่ไม่มีจริงอย่าง 2026-02-31
  // ไม่ส่ง format กับ strict ให้ dayjs เพราะ plugin customParseFormat ไม่ได้โหลด
  // ถ้าส่งไปจะถูกเมินเงียบ ๆ ทำให้โค้ดอ่านแล้วเข้าใจผิดว่ามีการตรวจแบบ strict
  if (!DATE_PATTERN.test(value) || !dayjs(value).isValid()) return null;
  return value;
};

const resolveRange = (
  req: Request,
  res: Response,
  defaults: { from: string; to: (from: string) => string }
): { from: string; to: string } | null => {
  const from = readDate(req.query.from, defaults.from);
  if (from === null) {
    res.status(400).json({ ok: false, error: 'INVALID_DATE_FROM' });
    return null;
  }

  const to = readDate(req.query.to, defaults.to(from));
  if (to === null) {
    res.status(400).json({ ok: false, error: 'INVALID_DATE_TO' });
    return null;
  }

  if (from > to) {
    res.status(400).json({ ok: false, error: 'DATE_RANGE_INVERTED' });
    return null;
  }

  return { from, to };
};

/** แปลง Scope ของผู้ใช้ให้เป็นรูปแบบที่ฐาน MyMOPH เข้าใจ */
const toMymophCodes = async (hospcodes: string[]): Promise<string[]> => {
  const normalized = await hcodeBridge.normalizeToStored(hospcodes, 'attendance');
  return normalized.filter((code): code is string => !!code);
};
import { requirePermission } from '../../middleware/permission.middleware';
import { requireAssignedScopeMiddleware } from '../../middleware/scope-required.middleware';
import { parsePagination } from '../../shared/utils/pagination';
import { AttendanceModel } from './attendance.model';
import { AttendanceService } from './attendance.service';

const router = Router();
const attendanceService = new AttendanceService(new AttendanceModel(mymophDb, systemDb));

router.get(
  '/dashboard',
  authMiddleware,
  requirePermission('attendance.read'),
  requireAssignedScopeMiddleware,
  auditMiddleware('attendance', 'read_dashboard'),
  asyncHandler(async (req, res) => {
    const range = resolveRange(req, res, {
      from: dayjs().format('YYYY-MM-01'),
      to: () => dayjs().format('YYYY-MM-DD')
    });
    if (!range) return;
    const { from, to } = range;

    const data = await attendanceService.getDashboard(req.auth!, {
      from,
      to,
      effectiveHospcodes: await toMymophCodes(req.auth!.hospcodes)
    });

    res.json({ ok: true, data });
  })
);

router.get(
  '/records',
  authMiddleware,
  requirePermission('attendance.read'),
  requireAssignedScopeMiddleware,
  auditMiddleware('attendance', 'read_records'),
  asyncHandler(async (req, res) => {
    const range = resolveRange(req, res, {
      from: dayjs().format('YYYY-MM-01'),
      to: () => dayjs().format('YYYY-MM-DD')
    });
    if (!range) return;
    const { from, to } = range;
    const search = req.query.search ? String(req.query.search) : undefined;
    const pagination = parsePagination(req.query as Record<string, unknown>);

    const data = await attendanceService.listRecords(req.auth!, {
      from,
      to,
      search,
      ...pagination,
      effectiveHospcodes: await toMymophCodes(req.auth!.hospcodes)
    });

    res.json({ ok: true, data });
  })
);

router.get(
  '/export',
  authMiddleware,
  requirePermission('attendance.export'),
  requireAssignedScopeMiddleware,
  auditMiddleware('attendance', 'export_records'),
  asyncHandler(async (req, res) => {
    const reportType = req.query.reportType === 'monthly' ? 'monthly' : 'daily';
    const range = resolveRange(req, res, {
      from: dayjs().format('YYYY-MM-DD'),
      to: (start) => (reportType === 'monthly' ? dayjs(start).endOf('month').format('YYYY-MM-DD') : start)
    });
    if (!range) return;
    const { from, to } = range;

    const exported = await attendanceService.exportReport(req.auth!, {
      reportType,
      from,
      to,
      search: req.query.search ? String(req.query.search) : undefined,
      effectiveHospcodes: await toMymophCodes(req.auth!.hospcodes)
    });

    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="${exported.filename}"`);
    res.setHeader('Cache-Control', 'no-store');
    res.send(exported.fileBuffer);
  })
);

router.get(
  '/export-pdf',
  authMiddleware,
  requirePermission('attendance.export'),
  requireAssignedScopeMiddleware,
  auditMiddleware('attendance', 'export_records_pdf'),
  asyncHandler(async (req, res) => {
    const reportType = req.query.reportType === 'monthly' ? 'monthly' : 'daily';
    const range = resolveRange(req, res, {
      from: dayjs().format('YYYY-MM-DD'),
      to: (start) => (reportType === 'monthly' ? dayjs(start).endOf('month').format('YYYY-MM-DD') : start)
    });
    if (!range) return;
    const { from, to } = range;

    const exported = await attendanceService.exportPdfReport(req.auth!, {
      reportType,
      from,
      to,
      search: req.query.search ? String(req.query.search) : undefined,
      effectiveHospcodes: await toMymophCodes(req.auth!.hospcodes)
    });

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="${exported.filename}"`);
    res.setHeader('Cache-Control', 'no-store');
    res.send(exported.fileBuffer);
  })
);

export const attendanceRoutes = router;
