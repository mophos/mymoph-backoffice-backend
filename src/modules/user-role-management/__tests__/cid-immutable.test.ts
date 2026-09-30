import test, { describe } from 'node:test';
import assert from 'node:assert/strict';
import { UserRoleManagementService } from '../user-role-management.service';
import type { AuthContext } from '../../../shared/types/auth';

/**
 * เทสต์ ADMIN-01: การแก้ไขต้องไม่สร้างบัญชีใหม่จาก CID ที่ส่งมา
 *
 * ของเดิม update เรียก upsertUserByCid(input.cid) แยกจาก userId
 * ถ้า CID ไม่ตรงกับบัญชีเป้าหมาย จะเกิดบัญชีใหม่ที่ไม่มีใครใช้
 * แล้ว Role/Scope ไปลงที่บัญชีเดิม
 */

interface Calls {
  upsertedCid: string | null;
  rolesSynced: boolean;
  scopesReplaced: boolean;
}

const STORED_CID = '1111111111111';

function makeService(calls: Calls) {
  const model = {
    getActiveScopes: async () => [],
    // ทะเบียนจำลอง: รหัส 5 หลักทุกตัวมีอยู่จริงและมี hcode9 คู่กัน
    resolveOfficeCodes: async (codes: string[]) =>
      new Map(codes.map((code) => [code, { code5: code, hcode9: `IA00${code}` }])),
    getRolesByCodes: async (codes: string[]) => codes.map((code, i) => ({ id: String(i + 1), code })),
    getRoleByCode: async (code: string) => ({ id: '1', code }),
    getUserById: async (id: string) => ({ id, cid: STORED_CID }),
    upsertUserByCid: async (input: { cid: string }) => {
      calls.upsertedCid = input.cid;
      return { id: 'created-by-cid', cid: input.cid };
    },
    syncUserRoles: async () => { calls.rolesSynced = true; },
    upsertUserRole: async () => { calls.rolesSynced = true; },
    replaceUserScopes: async () => { calls.scopesReplaced = true; }
  };

  return new UserRoleManagementService(model as never);
}

const actor: AuthContext = {
  userId: 'actor-1',
  cid: '9999999999999',
  roles: ['super_admin', 'super_admin_affairs'],
  permissions: ['user_admin.manage', 'finance_admin.manage', 'role_admin.manage'] as AuthContext['permissions'],
  hospcodes: [],
  scopeType: 'ALL'
};

describe('ADMIN-01 แก้ไขต้องไม่สร้างบัญชีจาก CID ที่ส่งมา', () => {
  test('ส่ง CID ที่ไม่ตรงกับบัญชีเป้าหมาย ต้องถูกปฏิเสธ', async () => {
    const calls: Calls = { upsertedCid: null, rolesSynced: false, scopesReplaced: false };
    const service = makeService(calls);

    const result = await service.update(actor, 'target-user', {
      cid: '2222222222222',
      roleCodes: ['hr'],
      hospcodes: ['10001']
    });

    assert.equal(result.ok, false);
    assert.equal((result as { error: string }).error, 'CID_MISMATCH');
    assert.equal(calls.upsertedCid, null, 'ต้องไม่สร้างบัญชีใหม่จาก CID ที่ส่งมา');
    assert.equal(calls.rolesSynced, false, 'ต้องไม่แตะบทบาทเมื่อถูกปฏิเสธ');
    assert.equal(calls.scopesReplaced, false, 'ต้องไม่แตะขอบเขตเมื่อถูกปฏิเสธ');
  });

  test('ส่ง CID ตรงกับบัญชีเป้าหมาย ทำงานได้ปกติและไม่ upsert', async () => {
    const calls: Calls = { upsertedCid: null, rolesSynced: false, scopesReplaced: false };
    const service = makeService(calls);

    const result = await service.update(actor, 'target-user', {
      cid: STORED_CID,
      roleCodes: ['hr'],
      hospcodes: ['10001']
    });

    assert.equal(result.ok, true);
    assert.equal(calls.upsertedCid, null, 'การแก้ไขต้องไม่เรียก upsert เลย');
    assert.equal(calls.rolesSynced, true);
    assert.equal(calls.scopesReplaced, true);
  });

  test('หน้าการเงินก็ต้องปฏิเสธ CID ที่ไม่ตรงเช่นกัน', async () => {
    const calls: Calls = { upsertedCid: null, rolesSynced: false, scopesReplaced: false };
    const service = makeService(calls);

    const result = await service.updateFinanceAdmin(actor, 'target-user', {
      cid: '3333333333333',
      hospcodes: ['10001']
    });

    assert.equal(result.ok, false);
    assert.equal((result as { error: string }).error, 'CID_MISMATCH');
    assert.equal(calls.upsertedCid, null);
  });

  test('การเพิ่มผู้ใช้ใหม่ยังสร้างบัญชีจาก CID ได้ตามปกติ', async () => {
    const calls: Calls = { upsertedCid: null, rolesSynced: false, scopesReplaced: false };
    const service = makeService(calls);

    const result = await service.create(actor, {
      cid: '4444444444444',
      roleCodes: ['hr'],
      hospcodes: ['10001']
    });

    assert.equal(result.ok, true);
    assert.equal(calls.upsertedCid, '4444444444444', 'create ต้องยังสร้างบัญชีจาก CID ได้');
  });
});
