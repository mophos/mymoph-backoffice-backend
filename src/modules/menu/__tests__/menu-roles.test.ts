import test, { describe } from 'node:test';
import assert from 'node:assert/strict';
import { MenuService } from '../menu.service';
import type { PermissionCode } from '../../../shared/types/auth';

/**
 * เทสต์ ADMIN-06: เมนูที่ backend บังคับบทบาทเพิ่ม ต้องไม่โผล่ให้คนที่ไม่มีบทบาทนั้น
 * มิฉะนั้นผู้ใช้เข้าหน้าได้แต่ทุกคำขอตอบ FORBIDDEN
 */

const service = new MenuService();
const FINANCE_MENU = 'finance-office-admin';

describe('ADMIN-06 กรองเมนูด้วยบทบาทที่บังคับ', () => {
  test('มี permission แต่ไม่มีบทบาท ต้องไม่เห็นเมนูการเงิน', () => {
    const menus = service.getMenusByPermissions(['finance_admin.manage'] as PermissionCode[], ['hr']);
    assert.equal(menus.find((m) => m.id === FINANCE_MENU), undefined);
  });

  test('มีทั้ง permission และบทบาท จึงเห็นเมนู', () => {
    const menus = service.getMenusByPermissions(
      ['finance_admin.manage'] as PermissionCode[],
      ['super_admin_affairs']
    );
    assert.ok(menus.find((m) => m.id === FINANCE_MENU), 'ควรเห็นเมนูการเงิน');
  });

  test('ไม่ส่งบทบาทมาเลย ก็ต้องไม่เห็นเมนูที่บังคับบทบาท', () => {
    const menus = service.getMenusByPermissions(['finance_admin.manage'] as PermissionCode[]);
    assert.equal(menus.find((m) => m.id === FINANCE_MENU), undefined);
  });

  test('เมนูที่ไม่บังคับบทบาทยังทำงานเหมือนเดิม', () => {
    const menus = service.getMenusByPermissions(['attendance.read'] as PermissionCode[], []);
    assert.ok(menus.find((m) => m.id === 'attendance-dashboard'), 'เมนูลงเวลาต้องยังเห็นได้');
  });

  test('allowedModules ต้องกรองด้วยบทบาทเหมือนกัน', () => {
    const withoutRole = service.getAllowedModules(['finance_admin.manage'] as PermissionCode[], []);
    const withRole = service.getAllowedModules(['finance_admin.manage'] as PermissionCode[], ['super_admin_affairs']);

    assert.equal(withoutRole.includes('user-role-management'), false);
    assert.equal(withRole.includes('user-role-management'), true);
  });
});
