import type { PermissionCode } from '../types/auth';

export const PERMISSIONS: PermissionCode[] = [
  'attendance.read',
  'attendance.export',
  'personnel.read',
  'personnel.manage',
  'payroll.read',
  'payroll.export',
  'office_settings.read',
  'office_settings.update',
  'user_admin.manage',
  'role_admin.manage'
];

export const SUPER_ADMIN_ROLE = 'super_admin';
