import type { MenuItem } from '../types/auth';

/**
 * ลำดับในรายการนี้มีผลสองอย่าง
 * 1. ลำดับที่แสดงใน sidebar
 * 2. frontend ใช้ menus[0].path เป็นหน้าแรกหลัง login
 *    การเรียงจึงกำหนดว่าแต่ละบทบาทเปิดมาเจอหน้าอะไร
 *
 * หลักการเรียง: งานปฏิบัติการขึ้นก่อน งานผู้ดูแลระบบลงท้าย
 * และวางเมนูที่ข้อมูลเกี่ยวเนื่องกันไว้ติดกัน
 */
export const MENU_CATALOG: MenuItem[] = [
  {
    id: 'attendance-dashboard',
    label: 'ลงเวลาเข้าออกงาน',
    group: 'operations',
    icon: 'schedule',
    path: '/attendance',
    module: 'attendance',
    requiredPermissions: ['attendance.read']
  },
  {
    // ทะเบียนบุคลากรคือตัวเติมแถวในรายงานลงเวลา จึงวางไว้ติดกัน
    id: 'personnel',
    label: 'ข้อมูลบุคลากร',
    group: 'operations',
    icon: 'group',
    path: '/personnel',
    module: 'personnel',
    requiredPermissions: ['personnel.read']
  },
  {
    // ภาษีมาก่อน Payroll เพราะเป็นเมนูที่มีการใช้งานจริงมากที่สุด
    id: 'tax',
    label: 'ใบรับรองภาษี',
    group: 'finance',
    icon: 'receipt_long',
    path: '/tax',
    module: 'tax',
    requiredPermissions: ['payroll.read']
  },
  {
    id: 'payroll',
    label: 'เงินเดือน',
    group: 'finance',
    icon: 'payments',
    path: '/payroll',
    module: 'payroll',
    requiredPermissions: ['payroll.read']
  },
  {
    id: 'hr-office-admin',
    label: 'ผู้ใช้และสิทธิ์',
    group: 'administration',
    icon: 'manage_accounts',
    path: '/user-admin',
    module: 'user-role-management',
    requiredPermissions: ['user_admin.manage']
  },
  {
    id: 'finance-office-admin',
    label: 'ผู้ใช้และสิทธิ์: การเงิน',
    group: 'administration',
    icon: 'account_balance_wallet',
    path: '/finance-user-admin',
    module: 'user-role-management',
    requiredPermissions: ['finance_admin.manage'],
    // service บังคับบทบาทนี้อีกชั้น ถ้าไม่กรองที่เมนูจะเข้าหน้าได้แต่ใช้งานไม่ได้เลย
    requiredRoles: ['super_admin_affairs']
  },
  {
    id: 'mymoph-users',
    label: 'ผู้ใช้แอป MyMOPH',
    group: 'administration',
    icon: 'person_search',
    path: '/mymoph-users',
    module: 'mymoph-users',
    requiredPermissions: ['mymoph_user.read']
  },
  {
    id: 'office-settings',
    label: 'หน่วยงานและการลงเวลา',
    group: 'administration',
    icon: 'settings',
    path: '/office-settings',
    module: 'office-settings',
    requiredPermissions: ['office_settings.read']
  }
];

/** ป้ายของแต่ละกลุ่มที่ใช้แสดงเป็นหัวข้อใน sidebar */
export const MENU_GROUP_LABELS: Record<MenuItem['group'], string> = {
  operations: 'งานประจำวัน',
  finance: 'การเงิน',
  administration: 'ผู้ดูแลระบบ'
};
