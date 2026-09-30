import test, { describe } from 'node:test';
import assert from 'node:assert/strict';
import { UserRoleManagementService } from '../user-role-management.service';
import type { AuthContext } from '../../../shared/types/auth';

/**
 * เทสต์ ADMIN-02: การถอดบทบาทหนึ่งต้องไม่ล้างขอบเขตหน่วยงานของบัญชี
 * ถ้ายังเหลือบทบาทอื่นที่ใช้งานได้
 */

interface Calls {
  rolesDeactivated: { roleCode?: string } | null;
  scopesCleared: boolean;
}

/** remainingRoles = จำนวนบทบาทที่ยังเหลือหลังถอด ซึ่ง model จะเป็นคนนับจริง */
function makeService(remainingRoles: number, calls: Calls) {
  const model = {
    getActiveScopes: async () => [],
    deactivateUserRoles: async (input: { roleCode?: string }) => {
      calls.rolesDeactivated = { roleCode: input.roleCode };
      return remainingRoles;
    },
    deactivateUserScopes: async () => { calls.scopesCleared = true; }
  };

  return new UserRoleManagementService(model as never);
}

const superAdmin: AuthContext = {
  userId: 'actor-1',
  cid: '1111111111111',
  roles: ['super_admin'],
  permissions: ['user_admin.manage', 'role_admin.manage'] as AuthContext['permissions'],
  hospcodes: [],
  scopeType: 'ALL'
};

const financeAdmin: AuthContext = {
  ...superAdmin,
  roles: ['super_admin_affairs'],
  permissions: ['finance_admin.manage'] as AuthContext['permissions']
};

describe('ADMIN-02 ถอดบทบาทแล้วต้องไม่ล้างขอบเขตถ้ายังเหลือบทบาทอื่น', () => {
  test('ถอดบทบาทเดียว เหลืออีก 2 บทบาท ขอบเขตต้องอยู่ครบ', async () => {
    const calls: Calls = { rolesDeactivated: null, scopesCleared: false };
    const service = makeService(2, calls);

    const result = await service.deactivate(superAdmin, 'target-user', 'admin_affairs');

    assert.equal(result.ok, true);
    assert.equal(calls.scopesCleared, false, 'ต้องไม่ล้างขอบเขตเมื่อยังเหลือบทบาทอื่น');
    assert.equal((result as { data: { remainingRoles: number } }).data.remainingRoles, 2);
  });

  test('ถอดบทบาทสุดท้าย ไม่เหลือเลย จึงล้างขอบเขต', async () => {
    const calls: Calls = { rolesDeactivated: null, scopesCleared: false };
    const service = makeService(0, calls);

    const result = await service.deactivate(superAdmin, 'target-user', 'hr');

    assert.equal(result.ok, true);
    assert.equal(calls.scopesCleared, true, 'ไม่เหลือบทบาทแล้วต้องล้างขอบเขต');
    assert.equal((result as { data: { scopesCleared: boolean } }).data.scopesCleared, true);
  });

  test('ปิดการใช้งานทั้งบัญชี (ไม่ระบุบทบาท) ล้างขอบเขตด้วย', async () => {
    const calls: Calls = { rolesDeactivated: null, scopesCleared: false };
    const service = makeService(0, calls);

    await service.deactivate(superAdmin, 'target-user');

    assert.equal(calls.rolesDeactivated?.roleCode, undefined, 'ต้องถอดทุกบทบาท');
    assert.equal(calls.scopesCleared, true);
  });

  test('หน้าการเงินถอด admin_affairs แต่เจ้าตัวยังมีบทบาทอื่น ขอบเขตต้องอยู่', async () => {
    const calls: Calls = { rolesDeactivated: null, scopesCleared: false };
    const service = makeService(1, calls);

    const result = await service.deactivateFinanceAdmin(financeAdmin, 'target-user');

    assert.equal(result.ok, true);
    assert.equal(calls.rolesDeactivated?.roleCode, 'admin_affairs', 'ต้องถอดเฉพาะบทบาทการเงิน');
    assert.equal(calls.scopesCleared, false, 'บทบาทอื่นยังอยู่ ขอบเขตจึงต้องไม่ถูกล้าง');
  });
});
