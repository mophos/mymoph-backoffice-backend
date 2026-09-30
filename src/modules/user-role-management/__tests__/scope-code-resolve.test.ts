import test, { describe } from 'node:test';
import assert from 'node:assert/strict';
import { UserRoleManagementService } from '../user-role-management.service';
import type { AuthContext } from '../../../shared/types/auth';
import type { OfficeCode } from '../user-role-management.model';

/**
 * เทสต์ SCOPE-01: รหัสที่รับเข้ามาต้องถูกแปลงเป็น code5 ก่อนตรวจสิทธิ์และก่อนบันทึก
 *
 * เดิม validation รับ hcode9 ผ่าน แต่การบันทึกเขียนค่าดิบลงคอลัมน์ที่ทุกโมดูล
 * คาดว่าเป็น code5 ไม่มี error ให้เห็น ผู้ใช้แค่มองไม่เห็นข้อมูลของตัวเอง
 */

/** ทะเบียนจำลอง: มีทั้งหน่วยงานปกติ และหน่วยงานที่ยังไม่มีรหัส 5 หลัก */
const REGISTRY: OfficeCode[] = [
  { code5: '41124', hcode9: 'IA0041124' },
  { code5: '10670', hcode9: 'IA0010670' },
  { code5: null, hcode9: 'CA0002583' }
];

interface Calls { savedOffices: OfficeCode[] | null }

function makeService(calls: Calls) {
  const model = {
    getActiveScopes: async () => [],
    resolveOfficeCodes: async (codes: string[]) => {
      const map = new Map<string, OfficeCode>();
      for (const code of codes) {
        const found = REGISTRY.find((o) => o.code5 === code || o.hcode9 === code);
        if (found) map.set(code, found);
      }
      return map;
    },
    getRolesByCodes: async (codes: string[]) => codes.map((code, i) => ({ id: String(i + 1), code })),
    getRoleByCode: async (code: string) => ({ id: '1', code }),
    getUserById: async (id: string) => ({ id, cid: '1111111111111' }),
    upsertUserByCid: async () => ({ id: 'u', cid: '1111111111111' }),
    syncUserRoles: async () => {},
    upsertUserRole: async () => {},
    replaceUserScopes: async (input: { offices: OfficeCode[] }) => { calls.savedOffices = input.offices; }
  };
  return new UserRoleManagementService(model as never);
}

const globalActor: AuthContext = {
  userId: 'a', cid: '9999999999999',
  roles: ['super_admin'],
  permissions: ['user_admin.manage', 'role_admin.manage'] as AuthContext['permissions'],
  hospcodes: [], scopeType: 'ALL'
};

/** ผู้ดูแลที่มีขอบเขตเป็น code5 ตามที่ระบบเก็บจริง */
const scopedActor: AuthContext = {
  ...globalActor,
  roles: ['hr'],
  hospcodes: ['41124'], scopeType: 'LIST'
};

const payload = (hospcodes: string[]) => ({ cid: '1111111111111', roleCodes: ['hr'], hospcodes });

describe('SCOPE-01 แปลงรหัสก่อนบันทึกขอบเขต', () => {
  test('ส่ง hcode9 มา ต้องบันทึกเป็น code5 ไม่ใช่ค่าดิบ', async () => {
    const calls: Calls = { savedOffices: null };
    const result = await makeService(calls).create(globalActor, payload(['IA0041124']));

    assert.equal(result.ok, true);
    assert.deepEqual(calls.savedOffices, [{ code5: '41124', hcode9: 'IA0041124' }]);
  });

  test('ส่ง hcode9 ของหน่วยงานในขอบเขตตัวเอง ต้องผ่าน', async () => {
    const calls: Calls = { savedOffices: null };
    const result = await makeService(calls).create(scopedActor, payload(['IA0041124']));

    assert.equal(result.ok, true, 'เดิมถูกปฏิเสธเพราะเอา hcode9 ไปเทียบกับขอบเขตที่เก็บเป็น code5');
    assert.equal(calls.savedOffices?.[0].code5, '41124');
  });

  test('ส่ง hcode9 ของหน่วยงานนอกขอบเขต ต้องถูกปฏิเสธ', async () => {
    const calls: Calls = { savedOffices: null };
    const result = await makeService(calls).create(scopedActor, payload(['IA0010670']));

    assert.equal(result.ok, false);
    assert.equal((result as { error: string }).error, 'TARGET_SCOPE_OUT_OF_BOUND');
    assert.equal(calls.savedOffices, null, 'ต้องไม่บันทึกอะไรเลย');
  });

  test('รหัสที่ไม่มีในทะเบียน ต้องได้ INVALID_HOSPCODE', async () => {
    const calls: Calls = { savedOffices: null };
    const result = await makeService(calls).create(globalActor, payload(['99999']));

    assert.equal(result.ok, false);
    assert.equal((result as { error: string }).error, 'INVALID_HOSPCODE');
    assert.deepEqual((result as { missingHospcodes: string[] }).missingHospcodes, ['99999']);
  });

  test('หน่วยงานที่ไม่มี code5 ต้องถูกปฏิเสธอย่างชัดเจน ไม่ใช่บันทึกแถวที่กรองไม่เจอ', async () => {
    const calls: Calls = { savedOffices: null };
    const result = await makeService(calls).create(globalActor, payload(['CA0002583']));

    assert.equal(result.ok, false);
    assert.equal((result as { error: string }).error, 'OFFICE_WITHOUT_CODE5');
    assert.equal(calls.savedOffices, null);
  });

  test('ส่ง code5 กับ hcode9 ของหน่วยงานเดียวกัน ต้องได้หน่วยงานเดียว', async () => {
    const calls: Calls = { savedOffices: null };
    const result = await makeService(calls).create(globalActor, payload(['41124', 'IA0041124']));

    assert.equal(result.ok, true);
    assert.equal(calls.savedOffices?.length, 2, 'service ส่งต่อทั้งสองรายการ');
    assert.deepEqual(
      [...new Set(calls.savedOffices!.map((o) => o.code5))],
      ['41124'],
      'ทั้งคู่ต้องชี้ไป code5 เดียวกัน ให้ model ยุบเป็นแถวเดียว'
    );
  });

  test('แก้ไขบัญชีเดิมด้วย hcode9 ก็ต้องแปลงเหมือนกัน', async () => {
    const calls: Calls = { savedOffices: null };
    const result = await makeService(calls).update(globalActor, 'u', payload(['IA0010670']));

    assert.equal(result.ok, true);
    assert.deepEqual(calls.savedOffices, [{ code5: '10670', hcode9: 'IA0010670' }]);
  });

  test('ผู้ดูแลการเงินใช้เส้นทางเดียวกัน', async () => {
    const calls: Calls = { savedOffices: null };
    const financeActor: AuthContext = {
      ...globalActor,
      roles: ['super_admin_affairs'],
      permissions: ['finance_admin.manage'] as AuthContext['permissions']
    };
    const result = await makeService(calls).createFinanceAdmin(financeActor, {
      cid: '1111111111111', hospcodes: ['IA0041124']
    });

    assert.equal(result.ok, true);
    assert.deepEqual(calls.savedOffices, [{ code5: '41124', hcode9: 'IA0041124' }]);
  });
});
