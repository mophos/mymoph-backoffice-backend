import { Router } from 'express';
import { mymophDb } from '../../db/knex';
import { authMiddleware } from '../../middleware/auth.middleware';
import { auditMiddleware } from '../../middleware/audit.middleware';
import { requirePermission } from '../../middleware/permission.middleware';
import { requireAssignedScopeMiddleware } from '../../middleware/scope-required.middleware';
import { PayrollModel } from './payroll.model';
import { PayrollService } from './payroll.service';

const router = Router();
const payrollService = new PayrollService(new PayrollModel(mymophDb));

router.get(
  '/summary',
  authMiddleware,
  requirePermission('payroll.read'),
  requireAssignedScopeMiddleware,
  auditMiddleware('payroll', 'read_summary'),
  async (req, res) => {
    const rows = await payrollService.list(req.auth!, req.auth!.hospcodes);
    res.json({ ok: true, data: rows });
  }
);

router.get(
  '/export',
  authMiddleware,
  requirePermission('payroll.export'),
  requireAssignedScopeMiddleware,
  auditMiddleware('payroll', 'export'),
  async (_req, res) => {
    res.json({ ok: true, data: { message: 'Payroll export placeholder (phase 2)' } });
  }
);

export const payrollRoutes = router;
