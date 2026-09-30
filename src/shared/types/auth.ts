export type PermissionCode =
  | 'attendance.read'
  | 'attendance.export'
  | 'personnel.read'
  | 'personnel.manage'
  | 'finance_admin.manage'
  | 'mymoph_user.read'
  | 'mymoph_user.verify_hr'
  | 'mymoph_user.delete'
  | 'payroll.read'
  | 'payroll.export'
  | 'office_settings.read'
  | 'office_settings.update'
  | 'user_admin.manage'
  | 'role_admin.manage';

export interface AuthContext {
  userId: string;
  cid: string;
  roles: string[];
  permissions: PermissionCode[];
  hospcodes: string[];
  scopeType: 'ALL' | 'LIST';
  displayName?: string;
}

export interface OAuthUserInfo {
  sub?: string;
  cid?: string;
  given_name?: string;
  family_name?: string;
  name?: string;
  email?: string;
  [key: string]: unknown;
}

/** กลุ่มของเมนูใน sidebar เรียงตามลำดับที่ประกาศไว้ */
export type MenuGroup = 'operations' | 'finance' | 'administration';

export interface MenuItem {
  id: string;
  label: string;
  group: MenuGroup;
  icon: string;
  path: string;
  module: string;
  requiredPermissions: PermissionCode[];
  /**
   * บทบาทที่บังคับเพิ่มจาก permission (ADMIN-06)
   * มีไว้สำหรับเมนูที่ service ตรวจบทบาทเพิ่มอีกชั้น เช่น Finance Office Admin
   * ที่ต้องมี super_admin_affairs มิฉะนั้นเข้าหน้าได้แต่ทุก API ตอบ FORBIDDEN
   */
  requiredRoles?: string[];
  children?: MenuItem[];
}
