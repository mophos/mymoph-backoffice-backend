import test, { describe } from 'node:test';
import assert from 'node:assert/strict';
import { TaxService } from '../tax.service';
import type { AuthContext } from '../../../shared/types/auth';

/**
 * เทสต์ TAX-03: ใครเห็นข้อมูลรายปีข้ามหน่วยงานได้
 *
 * ผู้ที่มีสิทธิ์แค่หน้าใบรับรองภาษีต้องเห็นเฉพาะหน่วยงานตัวเอง
 * จะเห็นข้ามได้ต้องเข้าถึงหน้า "ผู้ใช้และสิทธิ์: การเงิน" ได้ด้วย
 * คือมีทั้ง finance_admin.manage และบทบาท super_admin_affairs
 */

interface Calls { scopeType: 'ALL' | 'LIST' | null }

function makeService(calls: Calls) {
  const model = {
    findYearById: async (id: number) => ({ id, year_be: 2568, is_active: 1 }),
    listYearlyPeopleOverview: async (input: { scopeType: 'ALL' | 'LIST' }) => {
      calls.scopeType = input.scopeType;
      return { total: 0, rows: [] };
    }
  };
  return new TaxService(model as never);
}

const base: AuthContext = {
  userId: 'a', cid: '9999999999999', roles: [],
  permissions: [] as unknown as AuthContext['permissions'],
  hospcodes: ['41124'], scopeType: 'LIST'
};

const auth = (perms: string[], roles: string[], scopeType: 'ALL' | 'LIST' = 'LIST'): AuthContext => ({
  ...base,
  permissions: perms as unknown as AuthContext['permissions'],
  roles,
  scopeType,
  hospcodes: scopeType === 'ALL' ? [] : ['41124']
});

const query = { search: undefined, page: 1, pageSize: 10, offset: 0 };

describe('TAX-03 ใครเห็นข้อมูลรายปีข้ามหน่วยงาน', () => {
  test('มีสิทธิ์แค่หน้าภาษี ต้องเห็นเฉพาะหน่วยงานตัวเอง', async () => {
    const calls: Calls = { scopeType: null };
    const result = await makeService(calls)
      .listYearlyPeopleOverview(auth(['payroll.read', 'payroll.export'], ['super_admin_affairs']), 1, query);

    assert.equal(result.ok, true);
    assert.equal(calls.scopeType, 'LIST', 'ต้องกรองด้วยหน่วยงานของตัวเอง');
  });

  test('มีสิทธิ์หน้าการเงินด้วย ต้องเห็นทุกหน่วยงาน', async () => {
    const calls: Calls = { scopeType: null };
    const result = await makeService(calls)
      .listYearlyPeopleOverview(auth(['payroll.read', 'finance_admin.manage'], ['super_admin_affairs']), 1, query);

    assert.equal(result.ok, true);
    assert.equal(calls.scopeType, 'ALL', 'ฟีเจอร์นี้มีไว้หาคนที่มีเอกสารหลายหน่วยงาน');
  });

  test('มี finance_admin.manage แต่ไม่มีบทบาท ต้องเปิดมุมมองไม่ได้เลย', async () => {
    const calls: Calls = { scopeType: null };
    const result = await makeService(calls)
      .listYearlyPeopleOverview(auth(['payroll.read', 'finance_admin.manage'], ['hr']), 1, query);

    assert.equal(result.ok, false);
    assert.equal((result as { error: string }).error, 'FORBIDDEN');
    assert.equal(calls.scopeType, null, 'ต้องไม่ถึง query เลย');
  });

  test('super_admin เห็นทุกหน่วยงานเหมือนเดิม', async () => {
    const calls: Calls = { scopeType: null };
    const result = await makeService(calls)
      .listYearlyPeopleOverview(auth(['payroll.read'], ['super_admin'], 'ALL'), 1, query);

    assert.equal(result.ok, true);
    assert.equal(calls.scopeType, 'ALL');
  });

  test('มีบทบาท super_admin_affairs แต่ไม่มีสิทธิ์การเงิน ต้องเห็นแค่ของตัวเอง', async () => {
    const calls: Calls = { scopeType: null };
    const result = await makeService(calls)
      .listYearlyPeopleOverview(auth(['payroll.read'], ['super_admin_affairs']), 1, query);

    assert.equal(result.ok, true);
    assert.equal(calls.scopeType, 'LIST');
  });
});
