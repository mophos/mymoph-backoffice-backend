export type PermissionCode =
  | 'attendance.read'
  | 'attendance.export'
  | 'personnel.read'
  | 'personnel.manage'
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

export interface MenuItem {
  id: string;
  label: string;
  icon: string;
  path: string;
  module: string;
  requiredPermissions: PermissionCode[];
  children?: MenuItem[];
}
