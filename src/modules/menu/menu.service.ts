import { MENU_CATALOG } from '../../shared/constants/menu';
import type { MenuItem, PermissionCode } from '../../shared/types/auth';

export class MenuService {
  getMenusByPermissions(permissions: PermissionCode[]): MenuItem[] {
    return MENU_CATALOG.filter((item) => {
      return item.requiredPermissions.every((permission) => permissions.includes(permission));
    });
  }

  getAllowedModules(permissions: PermissionCode[]): string[] {
    return this.getMenusByPermissions(permissions).map((item) => item.module);
  }
}
