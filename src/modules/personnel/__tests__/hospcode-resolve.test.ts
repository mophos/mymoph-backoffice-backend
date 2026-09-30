import test, { describe } from 'node:test';
import assert from 'node:assert/strict';
import { PersonnelService } from '../personnel.service';
import type { AuthContext } from '../../../shared/types/auth';

/**
 * เทสต์ PERSONNEL-01: รหัสหน่วยงานต้องถูกแปลงเป็น code5 ก่อนบันทึกเสมอ
 *
 * เดิม normalizeInput ตรวจแค่ว่า hospcode ไม่ว่าง ไม่เทียบกับทะเบียนกลางเลย
 * ผู้มีขอบเขตทุกหน่วยงานจึงบันทึกรหัสอะไรก็ได้ และ FK ในฐานนี้ไม่บังคับ (DATA-02)
 */

const REGISTRY: Record<string, { code5: string | null; hcode9: string }> = {
  '41124': { code5: '41124', hcode9: 'IA0041124' },
  IA0041124: { code5: '41124', hcode9: 'IA0041124' },
  '10670': { code5: '10670', hcode9: 'EA0010670' },
  EA0010670: { code5: '10670', hcode9: 'EA0010670' },
  CA0002583: { code5: null, hcode9: 'CA0002583' }
};

interface Calls { savedHospcode: string | null }

function makeService(calls: Calls) {
  const model = {
    resolveOfficeCodes: async (codes: string[]) =>
      new Map(codes.map((c) => [c.trim(), REGISTRY[c.trim()]]).filter(([, v]) => !!v) as [string, { code5: string | null; hcode9: string }][]),
    findByCidHospcode: async () => null,
    findById: async (id: string) => ({ id, cid: '1111111111111', first_name: 'ก', last_name: 'ข', hospcode: '41124', is_active: 1 }),
    create: async (input: { hospcode: string }) => { calls.savedHospcode = input.hospcode; return 'new-id'; },
    updateById: async (_id: string, input: { hospcode: string }) => { calls.savedHospcode = input.hospcode; }
  };
  return new PersonnelService(model as never);
}

const globalActor: AuthContext = {
  userId: 'a', cid: '9999999999999', roles: ['super_admin'],
  permissions: ['personnel.manage'] as AuthContext['permissions'],
  hospcodes: [], scopeType: 'ALL'
};

const scopedActor: AuthContext = { ...globalActor, roles: ['hr'], hospcodes: ['41124'], scopeType: 'LIST' };

const person = (hospcode: string) => ({ cid: '1111111111111', firstName: 'ทดสอบ', lastName: 'ระบบ', hospcode });

describe('PERSONNEL-01 แปลงรหัสหน่วยงานก่อนบันทึกข้อมูลบุคลากร', () => {
  test('ส่ง hcode9 มา ต้องบันทึกเป็น code5', async () => {
    const calls: Calls = { savedHospcode: null };
    const result = await makeService(calls).create(globalActor, person('IA0041124'));

    assert.equal(result.ok, true);
    assert.equal(calls.savedHospcode, '41124');
  });

  test('ส่ง code5 ตามปกติ บันทึกเหมือนเดิม', async () => {
    const calls: Calls = { savedHospcode: null };
    const result = await makeService(calls).create(globalActor, person('41124'));

    assert.equal(result.ok, true);
    assert.equal(calls.savedHospcode, '41124');
  });

  test('รหัสมั่วที่ไม่มีในทะเบียน ต้องถูกปฏิเสธ', async () => {
    const calls: Calls = { savedHospcode: null };
    const result = await makeService(calls).create(globalActor, person('ZZZZZ'));

    assert.equal(result.ok, false);
    assert.equal((result as { error: string }).error, 'HOSPCODE_NOT_FOUND');
    assert.equal(calls.savedHospcode, null, 'เดิมบันทึกผ่านเพราะตรวจแค่ว่าไม่ว่าง');
  });

  test('หน่วยงานที่ไม่มี code5 ต้องถูกปฏิเสธอย่างชัดเจน', async () => {
    const calls: Calls = { savedHospcode: null };
    const result = await makeService(calls).create(globalActor, person('CA0002583'));

    assert.equal(result.ok, false);
    assert.equal((result as { error: string }).error, 'OFFICE_WITHOUT_CODE5');
    assert.equal(calls.savedHospcode, null);
  });

  test('ส่ง hcode9 ของหน่วยงานที่ตัวเองดูแล ต้องผ่าน', async () => {
    const calls: Calls = { savedHospcode: null };
    const result = await makeService(calls).create(scopedActor, person('IA0041124'));

    assert.equal(result.ok, true, 'เดิมถูกปฏิเสธเพราะเอา hcode9 ไปเทียบขอบเขตที่เก็บเป็น code5');
    assert.equal(calls.savedHospcode, '41124');
  });

  test('ส่ง hcode9 ของหน่วยงานนอกขอบเขต ต้องถูกปฏิเสธ', async () => {
    const calls: Calls = { savedHospcode: null };
    const result = await makeService(calls).create(scopedActor, person('EA0010670'));

    assert.equal(result.ok, false);
    assert.equal((result as { error: string }).error, 'SCOPE_FORBIDDEN');
    assert.equal(calls.savedHospcode, null);
  });

  test('แก้ไขด้วย hcode9 ก็ต้องแปลงเหมือนกัน', async () => {
    const calls: Calls = { savedHospcode: null };
    const result = await makeService(calls).update(globalActor, 'id-1', { hospcode: 'IA0041124' });

    assert.equal(result.ok, true);
    assert.equal(calls.savedHospcode, '41124');
  });

  test('แก้ไขย้ายไปหน่วยงานนอกขอบเขต ต้องถูกปฏิเสธ', async () => {
    const calls: Calls = { savedHospcode: null };
    const result = await makeService(calls).update(scopedActor, 'id-1', { hospcode: 'EA0010670' });

    assert.equal(result.ok, false);
    assert.equal((result as { error: string }).error, 'SCOPE_FORBIDDEN');
    assert.equal(calls.savedHospcode, null);
  });
});
