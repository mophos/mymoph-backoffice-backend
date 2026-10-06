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

  /**
   * โมดูลที่บัญชีนี้เข้าถึงได้ ไม่ซ้ำกัน
   *
   * เมนูมากกว่าหนึ่งเมนูใช้ module เดียวกันได้ เช่น "ผู้ใช้และสิทธิ์" กับ
   * "ผู้ใช้และสิทธิ์: การเงิน" ที่เป็น user-role-management ทั้งคู่
   * จึงต้องตัดค่าซ้ำก่อนส่งออก
   */
  getAllowedModules(permissions: PermissionCode[], roles: string[] = []): string[] {
    const modules = this.getMenusByPermissions(permissions, roles).map((item) => item.module);
    return [...new Set(modules)];
  }
}
