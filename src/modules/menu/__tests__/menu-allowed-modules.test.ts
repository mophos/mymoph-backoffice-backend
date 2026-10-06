import test, { describe } from 'node:test';
import assert from 'node:assert/strict';
import { MenuService } from '../menu.service';
import type { PermissionCode } from '../../../shared/types/auth';

/**
 * `allowedModules` ต้องไม่มีค่าซ้ำ
 *
 * MENU_CATALOG มีสองเมนูที่ใช้ `module: 'user-role-management'` เหมือนกัน
 * คือ "ผู้ใช้และสิทธิ์" กับ "ผู้ใช้และสิทธิ์: การเงิน" บัญชีที่เห็นทั้งสองเมนู
 * จึงเคยได้ค่านี้ซ้ำสองครั้งใน response
 */

const service = new MenuService();
const BOTH_ADMIN: PermissionCode[] = ['user_admin.manage', 'finance_admin.manage'];

describe('allowedModules ตัดค่าซ้ำ', () => {
  test('บัญชีที่เห็นสองเมนูซึ่ง module เดียวกัน ต้องได้ค่าเดียว', () => {
    const menus = service.getMenusByPermissions(BOTH_ADMIN, ['super_admin_affairs']);
    const sameModule = menus.filter((m) => m.module === 'user-role-management');
    assert.equal(sameModule.length, 2, 'ต้องเห็นสองเมนูที่ module เดียวกัน');

    const modules = service.getAllowedModules(BOTH_ADMIN, ['super_admin_affairs']);
    assert.equal(modules.filter((m) => m === 'user-role-management').length, 1);
  });

  test('ไม่มีค่าซ้ำเลยไม่ว่าสิทธิ์ชุดไหน', () => {
    const sets: Array<[PermissionCode[], string[]]> = [
      [['payroll.read'], ['super_admin']],
      [BOTH_ADMIN, ['super_admin_affairs']],
      [['attendance.read', 'personnel.read'], ['hr']],
      [[], []]
    ];

    for (const [permissions, roles] of sets) {
      const modules = service.getAllowedModules(permissions, roles);
      assert.equal(modules.length, new Set(modules).size, `มีค่าซ้ำเมื่อสิทธิ์เป็น ${permissions.join(',')}`);
    }
  });
});
