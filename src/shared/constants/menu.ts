import type { MenuItem } from '../types/auth';

export const MENU_CATALOG: MenuItem[] = [
  {
    id: 'attendance-dashboard',
    label: 'Checkin-Checkout เข้าทำงาน',
    icon: 'schedule',
    path: '/attendance',
    module: 'attendance',
    requiredPermissions: ['attendance.read']
  },
  {
    id: 'hr-office-admin',
    label: 'HR Office Admin',
    icon: 'manage_accounts',
    path: '/hr-admin',
    module: 'user-role-management',
    requiredPermissions: ['user_admin.manage']
  },
  {
    id: 'personnel',
    label: 'ข้อมูลบุคลากร',
    icon: 'group',
    path: '/personnel',
    module: 'personnel',
    requiredPermissions: ['personnel.read']
  },
  {
    id: 'payroll',
    label: 'Payroll',
    icon: 'payments',
    path: '/payroll',
    module: 'payroll',
    requiredPermissions: ['payroll.read']
  },
  {
    id: 'office-settings',
    label: 'Office Settings',
    icon: 'settings',
    path: '/office-settings',
    module: 'office-settings',
    requiredPermissions: ['office_settings.read']
  }
];
