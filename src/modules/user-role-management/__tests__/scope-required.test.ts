import test, { describe } from 'node:test';
import assert from 'node:assert/strict';
import { UserRoleManagementService } from '../user-role-management.service';
import type { AuthContext } from '../../../shared/types/auth';

/** เทสต์ ADMIN-04: บันทึกโดยไม่มีหน่วยงานต้องถูกปฏิเสธ ไม่ใช่ล้างขอบเขตเงียบ ๆ */

interface Calls { scopesReplaced: boolean; rolesSynced: boolean }

function makeService(calls: Calls) {
  const model = {
    getActiveScopes: async () => [],
    // ทะเบียนจำลอง: รหัส 5 หลักทุกตัวมีอยู่จริงและมี hcode9 คู่กัน
    resolveOfficeCodes: async (codes: string[]) =>
      new Map(codes.map((code) => [code, { code5: code, hcode9: `IA00${code}` }])),
    getRolesByCodes: async (codes: string[]) => codes.map((code, i) => ({ id: String(i + 1), code })),
    getRoleByCode: async (code: string) => ({ id: '1', code }),
    getUserById: async (id: string) => ({ id, cid: '1111111111111' }),
    upsertUserByCid: async () => ({ id: 'u', cid: '1111111111111' }),
    syncUserRoles: async () => { calls.rolesSynced = true; },
    upsertUserRole: async () => { calls.rolesSynced = true; },
    replaceUserScopes: async () => { calls.scopesReplaced = true; }
  };
  return new UserRoleManagementService(model as never);
}

const actor: AuthContext = {
  userId: 'a', cid: '9999999999999',
  roles: ['super_admin', 'super_admin_affairs'],
  permissions: ['user_admin.manage', 'finance_admin.manage', 'role_admin.manage'] as AuthContext['permissions'],
  hospcodes: [], scopeType: 'ALL'
};

describe('ADMIN-04 ต้องมีหน่วยงานอย่างน้อยหนึ่งแห่ง', () => {
  test('เพิ่มผู้ใช้โดยไม่ระบุหน่วยงาน ต้องถูกปฏิเสธ', async () => {
    const calls: Calls = { scopesReplaced: false, rolesSynced: false };
    const result = await makeService(calls).create(actor, { cid: '1111111111111', roleCodes: ['hr'], hospcodes: [] });

    assert.equal(result.ok, false);
    assert.equal((result as { error: string }).error, 'HOSPCODES_REQUIRED');
    assert.equal(calls.scopesReplaced, false, 'ต้องไม่ล้างขอบเขต');
  });

  test('แก้ไขโดยลบหน่วยงานออกหมด ต้องถูกปฏิเสธ', async () => {
    const calls: Calls = { scopesReplaced: false, rolesSynced: false };
    const result = await makeService(calls).update(actor, 'target', { cid: '1111111111111', roleCodes: ['hr'], hospcodes: [] });

    assert.equal(result.ok, false);
    assert.equal((result as { error: string }).error, 'HOSPCODES_REQUIRED');
    assert.equal(calls.scopesReplaced, false, 'ต้องไม่ล้างขอบเขตเดิม');
  });

  test('หน้าการเงินก็ต้องปฏิเสธเช่นกัน', async () => {
    const calls: Calls = { scopesReplaced: false, rolesSynced: false };
    const result = await makeService(calls).updateFinanceAdmin(actor, 'target', { cid: '1111111111111', hospcodes: [] });

    assert.equal(result.ok, false);
    assert.equal((result as { error: string }).error, 'HOSPCODES_REQUIRED');
  });

  test('ระบุหน่วยงานมาแล้วผ่านปกติ', async () => {
    const calls: Calls = { scopesReplaced: false, rolesSynced: false };
    const result = await makeService(calls).update(actor, 'target', { cid: '1111111111111', roleCodes: ['hr'], hospcodes: ['10001'] });

    assert.equal(result.ok, true);
    assert.equal(calls.scopesReplaced, true);
  });
});
