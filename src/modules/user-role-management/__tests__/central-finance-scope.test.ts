import test, { describe } from 'node:test';
import assert from 'node:assert/strict';
import { UserRoleManagementService } from '../user-role-management.service';
import type { AuthContext } from '../../../shared/types/auth';

/**
 * เทสต์ H-07 และ H-08: ผู้ดูแลการเงินส่วนกลางจัดการผู้ดูแลการเงินได้ทุกหน่วยงาน
 *
 * สิ่งที่ต้องพิสูจน์มีสองด้านคู่กัน
 * 1. เส้นทางหน้าการเงินผ่อนให้แล้วจริง ทั้งแต่งตั้ง แก้ไข ถอน และรายชื่อ
 * 2. **เส้นทางหน้า user-admin ทั่วไปยังไม่ผ่อน** ไม่เช่นนั้นบัญชีกลุ่มนี้
 *    จะมอบบทบาทอื่น เช่น hr ข้ามหน่วยงานได้ด้วย ซึ่งเกินขอบเขตที่ตัดสินไว้
 *
 * ใช้ model ปลอม จึงไม่แตะฐานข้อมูลจริง (D-03)
 */

interface FakeState {
  targetScopes: string[];
  deactivateCalled: boolean;
  scopesReplaced: string[] | null;
  listArgs: { actorScopeType: string; actorHospcodes: string[] } | null;
}

function makeState(targetScopes: string[] = []): FakeState {
  return { targetScopes, deactivateCalled: false, scopesReplaced: null, listArgs: null };
}

function makeService(state: FakeState) {
  const model = {
    getActiveScopes: async () => state.targetScopes,
    resolveOfficeCodes: async (codes: string[]) =>
      new Map(codes.map((code) => [code, { code5: code, hcode9: `IA00${code}` }])),
    getRolesByCodes: async (codes: string[]) => codes.map((code, i) => ({ id: String(i + 1), code })),
    getRoleByCode: async (code: string) => ({ id: '1', code }),
    getUserById: async (id: string) => ({ id, cid: '0000000000000' }),
    upsertUserByCid: async () => ({ id: 'target-user', cid: '0000000000000' }),
    syncUserRoles: async () => {},
    upsertUserRole: async () => {},
    replaceUserScopes: async (input: { offices: { code5: string | null }[] }) => {
      state.scopesReplaced = input.offices.map((office) => String(office.code5));
    },
    deactivateUserRoles: async () => { state.deactivateCalled = true; return 1; },
    deactivateUserScopes: async () => {},
    listHrOfficeAdmins: async (input: { actorScopeType: string; actorHospcodes: string[] }) => {
      state.listArgs = { actorScopeType: input.actorScopeType, actorHospcodes: input.actorHospcodes };
      return { total: 0, rows: [] };
    }
  };

  return new UserRoleManagementService(model as never);
}

/** ผู้ดูแลการเงินส่วนกลาง: ขอบเขตแค่หน่วยงานตัวเอง แต่เข้าเกณฑ์ H-07 */
const centralActor = (): AuthContext => ({
  userId: 'central-1',
  cid: '1111111111111',
  roles: ['super_admin_affairs', 'admin_affairs'],
  permissions: ['finance_admin.manage'] as AuthContext['permissions'],
  hospcodes: ['IA0000003'],
  scopeType: 'LIST'
});

/** เข้าหน้าการเงินได้แต่ยังไม่เข้าเกณฑ์ H-07 เพราะไม่มี finance_admin.manage */
const localActor = (): AuthContext => ({
  ...centralActor(),
  permissions: ['payroll.read'] as AuthContext['permissions']
});

const OTHER_OFFICE = '41124';

describe('H-07 แต่งตั้งผู้ดูแลการเงินข้ามหน่วยงาน', () => {
  test('ผู้ดูแลส่วนกลางแต่งตั้งหน่วยงานที่อยู่นอกขอบเขตตัวเองได้', async () => {
    const state = makeState();
    const service = makeService(state);

    const result = await service.createFinanceAdmin(centralActor(), {
      cid: '0000000000000',
      hospcodes: [OTHER_OFFICE]
    });

    assert.equal(result.ok, true);
    assert.deepEqual(state.scopesReplaced, [OTHER_OFFICE], 'ต้องบันทึกขอบเขตเป็นหน่วยงานที่ระบุ');
  });

  test('บัญชีที่ไม่มี finance_admin.manage ยังถูกปฏิเสธ', async () => {
    const state = makeState();
    const service = makeService(state);

    const result = await service.createFinanceAdmin(localActor(), {
      cid: '0000000000000',
      hospcodes: [OTHER_OFFICE]
    });

    assert.equal(result.ok, false);
    assert.equal((result as { error: string }).error, 'TARGET_SCOPE_OUT_OF_BOUND');
    assert.equal(state.scopesReplaced, null, 'ต้องไม่แตะข้อมูลเมื่อถูกปฏิเสธ');
  });

  test('แก้ไขบัญชีที่ขอบเขตไม่ทับกับตัวเองได้', async () => {
    const state = makeState(['99999']);
    const service = makeService(state);

    const result = await service.updateFinanceAdmin(centralActor(), 'target-user', {
      cid: '0000000000000',
      hospcodes: [OTHER_OFFICE]
    });

    assert.equal(result.ok, true);
    assert.deepEqual(state.scopesReplaced, [OTHER_OFFICE]);
  });

  test('ถอนสิทธิ์บัญชีที่ขอบเขตไม่ทับกับตัวเองได้ เพราะใช้ด่านเดียวกับการแก้ไข', async () => {
    const state = makeState(['99999']);
    const service = makeService(state);

    const result = await service.deactivateFinanceAdmin(centralActor(), 'target-user');

    assert.equal(result.ok, true);
    assert.equal(state.deactivateCalled, true);
  });

  test('การบันทึกโดยไม่ระบุหน่วยงานยังถูกปฏิเสธ ไม่ถูกการผ่อนของ H-07 ข้าม', async () => {
    const state = makeState();
    const service = makeService(state);

    const result = await service.createFinanceAdmin(centralActor(), {
      cid: '0000000000000',
      hospcodes: []
    });

    assert.equal(result.ok, false);
    assert.equal((result as { error: string }).error, 'HOSPCODES_REQUIRED');
    assert.equal(state.scopesReplaced, null);
  });

  test('บัญชีที่ไม่มีบทบาท super_admin_affairs ยังเข้าไม่ได้เลย', async () => {
    const state = makeState();
    const service = makeService(state);
    const outsider: AuthContext = { ...centralActor(), roles: ['hr'] };

    const result = await service.createFinanceAdmin(outsider, {
      cid: '0000000000000',
      hospcodes: [OTHER_OFFICE]
    });

    assert.equal(result.ok, false);
    assert.equal((result as { error: string }).error, 'FORBIDDEN');
  });
});

describe('H-07 ต้องไม่รั่วไปถึงหน้า user-admin ทั่วไป', () => {
  test('แต่งตั้งบทบาท hr ข้ามหน่วยงานยังถูกปฏิเสธ', async () => {
    const state = makeState();
    const service = makeService(state);

    const result = await service.create(centralActor(), {
      cid: '0000000000000',
      roleCodes: ['hr'],
      hospcodes: [OTHER_OFFICE]
    });

    assert.equal(result.ok, false);
    assert.equal((result as { error: string }).error, 'TARGET_SCOPE_OUT_OF_BOUND');
    assert.equal(state.scopesReplaced, null);
  });

  test('แก้ไขบัญชีนอกขอบเขตผ่านหน้าทั่วไปยังถูกปฏิเสธ', async () => {
    const state = makeState(['99999']);
    const service = makeService(state);

    const result = await service.update(centralActor(), 'target-user', {
      cid: '0000000000000',
      roleCodes: ['hr'],
      hospcodes: [OTHER_OFFICE]
    });

    assert.equal(result.ok, false);
    assert.equal((result as { error: string }).error, 'TARGET_OUT_OF_SCOPE');
  });

  test('รายชื่อหน้าทั่วไปยังกรองตามขอบเขตของผู้กระทำ', async () => {
    const state = makeState();
    const service = makeService(state);

    await service.list(centralActor(), { page: 1, pageSize: 20, offset: 0 });

    assert.equal(state.listArgs?.actorScopeType, 'LIST');
    assert.deepEqual(state.listArgs?.actorHospcodes, ['IA0000003']);
  });
});

describe('H-08 รายชื่อผู้ดูแลการเงิน', () => {
  test('ผู้ดูแลส่วนกลางเห็นทุกหน่วยงาน', async () => {
    const state = makeState();
    const service = makeService(state);

    const result = await service.listFinanceAdmins(centralActor(), { page: 1, pageSize: 20, offset: 0 });

    assert.equal(result.ok, true);
    assert.equal(state.listArgs?.actorScopeType, 'ALL', 'ต้องไม่กรองด้วยขอบเขตของผู้กระทำ');
  });

  test('ผู้ดูแลที่ไม่เข้าเกณฑ์ H-07 ยังเห็นเฉพาะขอบเขตตัวเอง', async () => {
    const state = makeState();
    const service = makeService(state);

    const result = await service.listFinanceAdmins(localActor(), { page: 1, pageSize: 20, offset: 0 });

    assert.equal(result.ok, true);
    assert.equal(state.listArgs?.actorScopeType, 'LIST');
    assert.deepEqual(state.listArgs?.actorHospcodes, ['IA0000003']);
  });
});
