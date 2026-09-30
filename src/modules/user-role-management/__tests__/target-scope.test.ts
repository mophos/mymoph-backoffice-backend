import test, { describe } from 'node:test';
import assert from 'node:assert/strict';
import { UserRoleManagementService } from '../user-role-management.service';
import type { AuthContext } from '../../../shared/types/auth';

/**
 * เทสต์ ADMIN-03: ผู้กระทำที่มี Scope แบบ LIST ต้องแตะได้เฉพาะบัญชี
 * ที่มีหน่วยงานทับซ้อนกับขอบเขตของตัวเอง
 *
 * ใช้ model ปลอมเพื่อไม่ต้องต่อฐานข้อมูล เทสต์จึงรันได้ทุกที่และไม่แตะข้อมูลจริง
 */

interface FakeState {
  /** ขอบเขตปัจจุบันของบัญชีเป้าหมาย */
  targetScopes: string[];
  deactivateCalled: boolean;
  scopesReplaced: boolean;
}

function makeService(state: FakeState) {
  const model = {
    getActiveScopes: async () => state.targetScopes,
    // ทะเบียนจำลอง: รหัส 5 หลักทุกตัวมีอยู่จริงและมี hcode9 คู่กัน
    resolveOfficeCodes: async (codes: string[]) =>
      new Map(codes.map((code) => [code, { code5: code, hcode9: `IA00${code}` }])),
    getRolesByCodes: async (codes: string[]) => codes.map((code, i) => ({ id: String(i + 1), code })),
    getRoleByCode: async (code: string) => ({ id: '1', code }),
    getUserById: async (id: string) => ({ id, cid: '0000000000000' }),
    upsertUserByCid: async () => ({ id: 'target-user', cid: '0000000000000' }),
    syncUserRoles: async () => { state.scopesReplaced = false; },
    upsertUserRole: async () => {},
    replaceUserScopes: async () => { state.scopesReplaced = true; },
    deactivateUserRoles: async () => { state.deactivateCalled = true; return 1; },
    deactivateUserScopes: async () => {},
    listHrOfficeAdmins: async () => ({ total: 0, rows: [] })
  };

  return new UserRoleManagementService(model as never);
}

const listActor = (hospcodes: string[], extra: Partial<AuthContext> = {}): AuthContext => ({
  userId: 'actor-1',
  cid: '1111111111111',
  roles: ['super_admin_affairs'],
  permissions: ['user_admin.manage', 'finance_admin.manage'] as AuthContext['permissions'],
  hospcodes,
  scopeType: 'LIST',
  ...extra
});

const allActor = (): AuthContext => ({
  ...listActor([]),
  roles: ['super_admin'],
  scopeType: 'ALL'
});

// CID ต้องตรงกับที่ getUserById คืนมา ไม่งั้นจะถูก CID_MISMATCH ตัดก่อน (ADMIN-01)
const payload = { cid: '0000000000000', roleCodes: ['hr'], hospcodes: ['10001'] };

describe('ADMIN-03 update ต้องตรวจขอบเขตของบัญชีเป้าหมาย', () => {
  test('ปฏิเสธเมื่อเป้าหมายอยู่คนละหน่วยงานกับผู้กระทำ', async () => {
    const state: FakeState = { targetScopes: ['99999'], deactivateCalled: false, scopesReplaced: false };
    const service = makeService(state);

    const result = await service.update(listActor(['10001']), 'victim-user', payload);

    assert.equal(result.ok, false);
    assert.equal((result as { error: string }).error, 'TARGET_OUT_OF_SCOPE');
    assert.equal(state.scopesReplaced, false, 'ต้องไม่แตะข้อมูลเมื่อถูกปฏิเสธ');
  });

  test('อนุญาตเมื่อมีหน่วยงานทับซ้อนกัน', async () => {
    const state: FakeState = { targetScopes: ['10001', '99999'], deactivateCalled: false, scopesReplaced: false };
    const service = makeService(state);

    const result = await service.update(listActor(['10001']), 'own-user', payload);

    assert.equal(result.ok, true);
    assert.equal(state.scopesReplaced, true);
  });

  test('อนุญาตเมื่อบัญชีเป้าหมายยังไม่มีขอบเขต ถือว่ายังไม่มีเจ้าของ', async () => {
    const state: FakeState = { targetScopes: [], deactivateCalled: false, scopesReplaced: false };
    const service = makeService(state);

    const result = await service.update(listActor(['10001']), 'new-user', payload);

    assert.equal(result.ok, true);
  });

  test('ผู้มีขอบเขตทุกหน่วยงานผ่านเสมอ', async () => {
    const state: FakeState = { targetScopes: ['99999'], deactivateCalled: false, scopesReplaced: false };
    const service = makeService(state);

    const result = await service.update(allActor(), 'any-user', payload);

    assert.equal(result.ok, true);
  });
});

describe('ADMIN-03 deactivateFinanceAdmin เดิมไม่ตรวจขอบเขตเลย', () => {
  test('ปฏิเสธเมื่อเป้าหมายอยู่คนละหน่วยงาน', async () => {
    const state: FakeState = { targetScopes: ['99999'], deactivateCalled: false, scopesReplaced: false };
    const service = makeService(state);

    const result = await service.deactivateFinanceAdmin(listActor(['10001']), 'victim-user');

    assert.equal(result.ok, false);
    assert.equal((result as { error: string }).error, 'TARGET_OUT_OF_SCOPE');
    assert.equal(state.deactivateCalled, false, 'ต้องไม่ถอนสิทธิ์เมื่อถูกปฏิเสธ');
  });

  test('อนุญาตเมื่อทับซ้อนกัน', async () => {
    const state: FakeState = { targetScopes: ['10001'], deactivateCalled: false, scopesReplaced: false };
    const service = makeService(state);

    const result = await service.deactivateFinanceAdmin(listActor(['10001']), 'own-user');

    assert.equal(result.ok, true);
    assert.equal(state.deactivateCalled, true);
  });
});
