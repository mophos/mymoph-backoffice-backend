import { Router } from 'express';
import { z } from 'zod';
import { systemDb } from '../../db/knex';
import { authMiddleware } from '../../middleware/auth.middleware';
import { auditMiddleware } from '../../middleware/audit.middleware';
import { requirePermission } from '../../middleware/permission.middleware';
import { requireAssignedScopeMiddleware } from '../../middleware/scope-required.middleware';
import { parsePagination } from '../../shared/utils/pagination';
import { UserRoleManagementModel } from './user-role-management.model';
import { UserRoleManagementService } from './user-role-management.service';

const router = Router();
const service = new UserRoleManagementService(new UserRoleManagementModel(systemDb));

const upsertSchema = z.object({
  cid: z.string().min(13).max(13),
  roleCode: z.string().min(1).optional(),
  roleCodes: z.array(z.string().min(1)).optional(),
  hospcodes: z.array(z.string().min(1)).default([])
}).transform((value) => {
  const roleCodes = [...new Set([
    ...(value.roleCodes ?? []),
    ...(value.roleCode ? [value.roleCode] : [])
  ])];

  return {
    cid: value.cid,
    roleCodes: roleCodes.length ? roleCodes : ['hr'],
    hospcodes: value.hospcodes
  };
});

router.get(
  '/hr-office-admins',
  authMiddleware,
  requirePermission('user_admin.manage'),
  requireAssignedScopeMiddleware,
  auditMiddleware('user-role-management', 'list_hr_admins'),
  async (req, res) => {
    const pagination = parsePagination(req.query as Record<string, unknown>);

    const data = await service.list(req.auth!, {
      search: req.query.search ? String(req.query.search) : undefined,
      roleCode: req.query.roleCode ? String(req.query.roleCode) : undefined,
      ...pagination
    });

    res.json({ ok: true, data });
  }
);

router.post(
  '/hr-office-admins',
  authMiddleware,
  requirePermission('user_admin.manage'),
  requireAssignedScopeMiddleware,
  auditMiddleware('user-role-management', 'create_hr_admin'),
  async (req, res) => {
    const payload = upsertSchema.parse(req.body);
    const result = await service.create(req.auth!, payload);
    if (!result.ok) {
      res.status(Number(result.status ?? 400)).json(result);
      return;
    }

    res.status(Number(result.status ?? 201)).json(result);
  }
);

router.put(
  '/hr-office-admins/:userId',
  authMiddleware,
  requirePermission('user_admin.manage'),
  requireAssignedScopeMiddleware,
  auditMiddleware('user-role-management', 'update_hr_admin'),
  async (req, res) => {
    const payload = upsertSchema.parse(req.body);
    const result = await service.update(req.auth!, req.params.userId, payload);

    if (!result.ok) {
      res.status(Number(result.status ?? 400)).json(result);
      return;
    }

    res.status(Number(result.status ?? 200)).json(result);
  }
);

router.delete(
  '/hr-office-admins/:userId',
  authMiddleware,
  requirePermission('user_admin.manage'),
  requireAssignedScopeMiddleware,
  auditMiddleware('user-role-management', 'deactivate_hr_admin'),
  async (req, res) => {
    const roleCode = req.query.roleCode ? String(req.query.roleCode) : undefined;
    const result = await service.deactivate(req.auth!, req.params.userId, roleCode);

    if (!result.ok) {
      res.status(Number(result.status ?? 400)).json(result);
      return;
    }

    res.status(Number(result.status ?? 200)).json(result);
  }
);

export const userRoleManagementRoutes = router;
