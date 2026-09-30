import { MENU_CATALOG } from '../../shared/constants/menu';
import type { MenuItem, PermissionCode } from '../../shared/types/auth';

export class MenuService {
  /**
   * เมนูที่บัญชีนี้เข้าถึงได้ ต้องผ่านทั้ง permission และบทบาทที่เมนูบังคับ
   *
   * ADMIN-06: เดิมกรองด้วย permission อย่างเดียว ทำให้เมนูที่ service
   * ตรวจบทบาทเพิ่ม (Finance Office Admin) โผล่ให้คนที่เข้าไปแล้วใช้งานไม่ได้
   */
  getMenusByPermissions(permissions: PermissionCode[], roles: string[] = []): MenuItem[] {
    return MENU_CATALOG.filter((item) => {
      const hasPermissions = item.requiredPermissions.every(
        (permission) => permissions.includes(permission)
      );
      if (!hasPermissions) return false;

      const requiredRoles = item.requiredRoles ?? [];
      return requiredRoles.every((role) => roles.includes(role));
    });
  }

  getAllowedModules(permissions: PermissionCode[], roles: string[] = []): string[] {
    return this.getMenusByPermissions(permissions, roles).map((item) => item.module);
  }
}
