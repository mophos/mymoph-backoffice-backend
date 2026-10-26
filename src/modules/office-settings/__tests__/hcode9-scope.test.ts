import test, { describe } from 'node:test';
import assert from 'node:assert/strict';
import { OfficeSettingsService } from '../office-settings.service';
import type { AuthContext } from '../../../shared/types/auth';

/**
 * H-01 — ผู้ใช้ที่ขอบเขตเป็น hcode9 ต้องจัดการหน่วยงานตัวเองได้
 *
 * เดิม validateScope รับเฉพาะ code5 และปฏิเสธทันทีเมื่อเป็น null
 * คอมเมนต์ในโค้ดเขียนไว้เองว่าข้อจำกัดจะหายไปเมื่อขอบเขตย้ายไป hcode9
 */

const WITH_CODE5 = { code5: '41124', hcode9: 'IA0041124', name: 'ศทส' };
const WITHOUT_CODE5 = { code5: null, hcode9: 'CA0002583', name: 'คลินิกเอกชน' };

function makeService(office: typeof WITH_CODE5 | typeof WITHOUT_CODE5, calls: { set: boolean }) {
  const model = {
    findOffice: async () => office,
    setCheckinStatus: async () => { calls.set = true; return { status: 'Y', changed: true }; }
  };
  return new OfficeSettingsService(model as never);
}

const actor = (hospcodes: string[], scopeType: 'ALL' | 'LIST' = 'LIST'): AuthContext => ({
  userId: 'a', cid: '9999999999999',
  roles: ['hr'],
  permissions: ['office_settings.update'] as AuthContext['permissions'],
  hospcodes, scopeType
});

describe('H-01 เปิดปิดการลงเวลาด้วยขอบเขตที่เป็น hcode9', () => {
  test('ขอบเขตเป็น hcode9 จัดการหน่วยงานตัวเองได้', async () => {
    const calls = { set: false };
    const result: any = await makeService(WITHOUT_CODE5, calls).setCheckin(actor(['CA0002583']), 'CA0002583', 'Y');

    assert.equal(result.ok, true, 'เดิมถูกปฏิเสธเพราะ code5 เป็น null');
    assert.equal(calls.set, true);
  });

  test('ขอบเขตเป็น hcode9 จัดการหน่วยงานอื่นไม่ได้', async () => {
    const calls = { set: false };
    const result: any = await makeService(WITH_CODE5, calls).setCheckin(actor(['CA0002583']), '41124', 'Y');

    assert.equal(result.ok, false);
    assert.equal(result.error, 'SCOPE_FORBIDDEN');
    assert.equal(calls.set, false);
  });

  test('ขอบเขตเป็น code5 ยังจัดการหน่วยงานตัวเองได้เหมือนเดิม', async () => {
    const calls = { set: false };
    const result: any = await makeService(WITH_CODE5, calls).setCheckin(actor(['41124']), '41124', 'Y');

    assert.equal(result.ok, true, 'ของเดิมต้องไม่ถดถอย');
    assert.equal(calls.set, true);
  });

  test('ขอบเขตเป็น code5 จัดการหน่วยงานที่ไม่มี code5 ไม่ได้', async () => {
    const calls = { set: false };
    const result: any = await makeService(WITHOUT_CODE5, calls).setCheckin(actor(['41124']), 'CA0002583', 'Y');

    assert.equal(result.ok, false);
    assert.equal(result.error, 'SCOPE_FORBIDDEN');
  });

  test('ขอบเขตทุกหน่วยงานยังทำได้ทุกแบบ', async () => {
    for (const office of [WITH_CODE5, WITHOUT_CODE5]) {
      const calls = { set: false };
      const result: any = await makeService(office, calls).setCheckin(actor([], 'ALL'), office.hcode9, 'Y');
      assert.equal(result.ok, true);
    }
  });
});
