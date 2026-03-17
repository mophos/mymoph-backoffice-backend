import { Router } from 'express';
import { authRoutes } from '../modules/auth/auth.routes';
import { menuRoutes } from '../modules/menu/menu.routes';
import { attendanceRoutes } from '../modules/attendance/attendance.routes';
import { personnelRoutes } from '../modules/personnel/personnel.routes';
import { payrollRoutes } from '../modules/payroll/payroll.routes';
import { officeSettingsRoutes } from '../modules/office-settings/office-settings.routes';
import { userRoleManagementRoutes } from '../modules/user-role-management/user-role-management.routes';

const router = Router();

router.get('/health', (_req, res) => {
  res.json({ ok: true, service: 'mymoph-backoffice-api', timezone: 'Asia/Bangkok' });
});

router.use('/auth', authRoutes);
router.use('/menu', menuRoutes);
router.use('/attendance', attendanceRoutes);
router.use('/personnel', personnelRoutes);
router.use('/payroll', payrollRoutes);
router.use('/office-settings', officeSettingsRoutes);
router.use('/admin', userRoleManagementRoutes);

export const apiV1Routes = router;
