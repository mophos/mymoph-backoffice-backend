import test, { describe } from 'node:test';
import assert from 'node:assert/strict';
import { TaxService } from '../tax.service';
import type { AuthContext } from '../../../shared/types/auth';

/**
 * เทสต์ TAX-04 + H-01: รหัสหน่วยงานที่สร้างปีภาษีต้องถูกแปลงเป็นรหัสอ้างอิงก่อนบันทึกเสมอ
 * รหัสอ้างอิง = code5 ถ้ามี · ไม่มีก็ hcode9
 *
 * รหัสนี้ไม่ได้ลงแค่ในฐาน แต่กลายเป็นชื่อโฟลเดอร์ที่เก็บไฟล์ด้วย
 * (buildRelativePath -> yearShort/hospcode/fileName) การปล่อยค่าดิบผ่านไป
 * ทำให้ที่เก็บไฟล์มีโฟลเดอร์ปนสองรูปแบบโดยไม่มีใครตั้งใจ
 */

const REGISTRY: Record<string, { code5: string | null; hcode9: string }> = {
  '41124': { code5: '41124', hcode9: 'IA0041124' },
  IA0041124: { code5: '41124', hcode9: 'IA0041124' },
  '10670': { code5: '10670', hcode9: 'IA0010670' },
  IA0010670: { code5: '10670', hcode9: 'IA0010670' },
  CA0002583: { code5: null, hcode9: 'CA0002583' }
};

interface Calls { createdHospcode: string | null }

function makeService(calls: Calls) {
  const model = {
    resolveOfficeCode: async (code: string) => REGISTRY[code.trim()] ?? null,
    findYearByYearHospcode: async () => null,
    createYear: async (input: { hospcode: string }) => {
      calls.createdHospcode = input.hospcode;
      return 999;
    }
  };
  return new TaxService(model as never);
}

const globalActor: AuthContext = {
  userId: 'a', cid: '9999999999999',
  roles: ['super_admin'],
  permissions: ['payroll.export'] as AuthContext['permissions'],
  hospcodes: [], scopeType: 'ALL'
};

const scopedActor: AuthContext = {
  ...globalActor,
  roles: ['hr'],
  hospcodes: ['41124'], scopeType: 'LIST'
};

describe('TAX-04 แปลงรหัสหน่วยงานก่อนสร้างปีภาษี', () => {
  test('ส่ง hcode9 มา ต้องบันทึกเป็น code5 ไม่ใช่ค่าดิบ', async () => {
    const calls: Calls = { createdHospcode: null };
    const result = await makeService(calls).createYear(globalActor, { yearBe: 2569, hospcode: 'IA0041124' });

    assert.equal(result.ok, true);
    assert.equal(calls.createdHospcode, '41124', 'ถ้าเก็บ IA0041124 จะกลายเป็นชื่อโฟลเดอร์บนดิสก์');
  });

  test('ส่ง code5 ตามปกติ ต้องบันทึกเหมือนเดิม', async () => {
    const calls: Calls = { createdHospcode: null };
    const result = await makeService(calls).createYear(globalActor, { yearBe: 2569, hospcode: '41124' });

    assert.equal(result.ok, true);
    assert.equal(calls.createdHospcode, '41124');
  });

  test('ส่ง hcode9 ของหน่วยงานที่ตัวเองดูแล ต้องผ่าน', async () => {
    const calls: Calls = { createdHospcode: null };
    const result = await makeService(calls).createYear(scopedActor, { yearBe: 2569, hospcode: 'IA0041124' });

    assert.equal(result.ok, true, 'เดิมถูกปฏิเสธเพราะเอา hcode9 ไปเทียบขอบเขตที่เก็บเป็น code5');
    assert.equal(calls.createdHospcode, '41124');
  });

  test('ส่ง hcode9 ของหน่วยงานนอกขอบเขต ต้องถูกปฏิเสธ', async () => {
    const calls: Calls = { createdHospcode: null };
    const result = await makeService(calls).createYear(scopedActor, { yearBe: 2569, hospcode: 'IA0010670' });

    assert.equal(result.ok, false);
    assert.equal((result as { error: string }).error, 'SCOPE_FORBIDDEN');
    assert.equal(calls.createdHospcode, null, 'ต้องไม่สร้างอะไรเลย');
  });

  test('รหัสที่ไม่มีในทะเบียน ต้องได้ HOSPCODE_NOT_FOUND', async () => {
    const calls: Calls = { createdHospcode: null };
    const result = await makeService(calls).createYear(globalActor, { yearBe: 2569, hospcode: 'ZZZZZ' });

    assert.equal(result.ok, false);
    assert.equal((result as { error: string }).error, 'HOSPCODE_NOT_FOUND');
    assert.equal(calls.createdHospcode, null);
  });

  /**
   * H-01 เปลี่ยนเจตนาเมื่อ 26 ต.ค. 2569
   *
   * เดิมเทสต์นี้ยืนยันว่าต้องปฏิเสธ โดยให้เหตุผลว่าจะได้โฟลเดอร์ชื่อ CA0002583 บนดิสก์
   * ซึ่งตอนนั้นถือว่าเป็นปัญหา เพราะขอบเขตผู้ใช้เก็บเป็น code5 อย่างเดียว
   * ปีภาษีที่เก็บ hcode9 จึงไม่มีใครมองเห็น
   *
   * ตอนนี้ขอบเขตก็ใช้รหัสอ้างอิงแบบเดียวกัน โฟลเดอร์ชื่อ CA0002583 จึงถูกต้องแล้ว
   * และเป็นทางเดียวที่หน่วยงาน 3,230 แห่งซึ่งไม่มี code5 จะใช้เมนูนี้ได้
   */
  test('หน่วยงานที่ไม่มี code5 ต้องสร้างปีภาษีได้ โดยใช้ hcode9 เป็นรหัสอ้างอิง', async () => {
    const calls: Calls = { createdHospcode: null };
    const result = await makeService(calls).createYear(globalActor, { yearBe: 2569, hospcode: 'CA0002583' });

    assert.equal(result.ok, true, 'ต้องไม่ถูกปฏิเสธอีกแล้ว');
    assert.equal(calls.createdHospcode, 'CA0002583', 'เก็บ hcode9 เป็นรหัสของปีภาษี');
  });

  test('หน่วยงานที่มี code5 ต้องยังเก็บ code5 เหมือนเดิม ไม่เปลี่ยนไปใช้ hcode9', async () => {
    const calls: Calls = { createdHospcode: null };
    const result = await makeService(calls).createYear(globalActor, { yearBe: 2569, hospcode: 'IA0041124' });

    assert.equal(result.ok, true);
    assert.equal(calls.createdHospcode, '41124', 'ของเดิมต้องไม่ถดถอย');
  });

  test('ผู้ใช้ที่มีขอบเขตเป็น hcode9 สร้างปีของหน่วยงานตัวเองได้', async () => {
    const calls: Calls = { createdHospcode: null };
    const actor: AuthContext = { ...globalActor, roles: ['hr'], hospcodes: ['CA0002583'], scopeType: 'LIST' };
    const result = await makeService(calls).createYear(actor, { yearBe: 2569, hospcode: 'CA0002583' });

    assert.equal(result.ok, true);
    assert.equal(calls.createdHospcode, 'CA0002583');
  });

  test('ผู้ใช้ที่มีขอบเขตเป็น hcode9 สร้างปีของหน่วยงานอื่นไม่ได้', async () => {
    const calls: Calls = { createdHospcode: null };
    const actor: AuthContext = { ...globalActor, roles: ['hr'], hospcodes: ['CA0002583'], scopeType: 'LIST' };
    const result = await makeService(calls).createYear(actor, { yearBe: 2569, hospcode: '41124' });

    assert.equal(result.ok, false);
    assert.equal(calls.createdHospcode, null);
  });

  test('ไม่ระบุรหัส และมีขอบเขต hcode9 หน่วยงานเดียว ให้ใช้ของตัวเอง', async () => {
    const calls: Calls = { createdHospcode: null };
    const actor: AuthContext = { ...globalActor, roles: ['hr'], hospcodes: ['CA0002583'], scopeType: 'LIST' };
    const result = await makeService(calls).createYear(actor, { yearBe: 2569 });

    assert.equal(result.ok, true);
    assert.equal(calls.createdHospcode, 'CA0002583');
  });

  test('ไม่ระบุรหัสและมีขอบเขตหน่วยงานเดียว ให้ใช้ของตัวเอง', async () => {
    const calls: Calls = { createdHospcode: null };
    const result = await makeService(calls).createYear(scopedActor, { yearBe: 2569 });

    assert.equal(result.ok, true);
    assert.equal(calls.createdHospcode, '41124');
  });

  test('ไม่ระบุรหัสและมีขอบเขตทุกหน่วยงาน ต้องได้ HOSPCODE_REQUIRED', async () => {
    const calls: Calls = { createdHospcode: null };
    const result = await makeService(calls).createYear(globalActor, { yearBe: 2569 });

    assert.equal(result.ok, false);
    assert.equal((result as { error: string }).error, 'HOSPCODE_REQUIRED');
  });
});
