import { Router } from 'express';
import dayjs from 'dayjs';
import { mymophDb, systemDb } from '../../db/knex';
import { authMiddleware } from '../../middleware/auth.middleware';
import { auditMiddleware } from '../../middleware/audit.middleware';
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
  async (req, res) => {
    const from = String(req.query.from ?? dayjs().format('YYYY-MM-01'));
    const to = String(req.query.to ?? dayjs().format('YYYY-MM-DD'));

    const data = await attendanceService.getDashboard(req.auth!, {
      from,
      to,
      effectiveHospcodes: req.auth!.hospcodes
    });

    res.json({ ok: true, data });
  }
);

router.get(
  '/records',
  authMiddleware,
  requirePermission('attendance.read'),
  requireAssignedScopeMiddleware,
  auditMiddleware('attendance', 'read_records'),
  async (req, res) => {
    const from = String(req.query.from ?? dayjs().format('YYYY-MM-01'));
    const to = String(req.query.to ?? dayjs().format('YYYY-MM-DD'));
    const search = req.query.search ? String(req.query.search) : undefined;
    const pagination = parsePagination(req.query as Record<string, unknown>);

    const data = await attendanceService.listRecords(req.auth!, {
      from,
      to,
      search,
      ...pagination,
      effectiveHospcodes: req.auth!.hospcodes
    });

    res.json({ ok: true, data });
  }
);

router.get(
  '/export',
  authMiddleware,
  requirePermission('attendance.export'),
  requireAssignedScopeMiddleware,
  auditMiddleware('attendance', 'export_records'),
  async (req, res) => {
    const reportType = req.query.reportType === 'monthly' ? 'monthly' : 'daily';
    const from = String(req.query.from ?? dayjs().format('YYYY-MM-DD'));
    const to = String(req.query.to ?? (reportType === 'monthly' ? dayjs(from).endOf('month').format('YYYY-MM-DD') : from));

    const exported = await attendanceService.exportReport(req.auth!, {
      reportType,
      from,
      to,
      search: req.query.search ? String(req.query.search) : undefined,
      effectiveHospcodes: req.auth!.hospcodes
    });

    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="${exported.filename}"`);
    res.setHeader('Cache-Control', 'no-store');
    res.send(exported.fileBuffer);
  }
);

router.get(
  '/export-pdf',
  authMiddleware,
  requirePermission('attendance.export'),
  requireAssignedScopeMiddleware,
  auditMiddleware('attendance', 'export_records_pdf'),
  async (req, res) => {
    const reportType = req.query.reportType === 'monthly' ? 'monthly' : 'daily';
    const from = String(req.query.from ?? dayjs().format('YYYY-MM-DD'));
    const to = String(req.query.to ?? (reportType === 'monthly' ? dayjs(from).endOf('month').format('YYYY-MM-DD') : from));

    const exported = await attendanceService.exportPdfReport(req.auth!, {
      reportType,
      from,
      to,
      search: req.query.search ? String(req.query.search) : undefined,
      effectiveHospcodes: req.auth!.hospcodes
    });

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="${exported.filename}"`);
    res.setHeader('Cache-Control', 'no-store');
    res.send(exported.fileBuffer);
  }
);

export const attendanceRoutes = router;
