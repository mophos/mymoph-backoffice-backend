import test, { describe } from 'node:test';
import assert from 'node:assert/strict';
import { TaxService } from '../tax.service';
import type { AuthContext } from '../../../shared/types/auth';

/**
 * TAX-08 — ช่วงปี พ.ศ. ที่ยอมรับต้องแคบพอจะกันการพิมพ์ผิด
 *
 * เดิมยอมรับ 2400-2700 และแปลง 0-99 เป็น 2500+n
 * พิมพ์เลข 0 จึงได้ปี 2500 ผ่าน validation ซึ่งเป็นต้นเหตุของ TAX-12
 * และเคยมีคนสร้างปี 2599 ค้างไว้ในระบบจริง
 */

const auth: AuthContext = {
  userId: 'actor-1', cid: '9999999999999',
  roles: ['super_admin'],
  permissions: ['payroll.read', 'payroll.export'] as AuthContext['permissions'],
  hospcodes: [], scopeType: 'ALL'
};

/** model จำลอง ถ้าปีผ่าน validation จะเดินมาถึง resolveOfficeCode แล้วหยุดที่นี่ */
function service() {
  const model = {
    resolveOfficeCode: async () => null,            // ทำให้หยุดหลังผ่านด่านปี
    resolveOfficeCodes: async () => new Map(),
    findYearByYearHospcode: async () => undefined,
    createYear: async () => 1
  };
  return new TaxService(model as never);
}

const currentYearBe = new Date().getFullYear() + 543;
const create = (yearBe: number) =>
  service().createYear(auth, { yearBe, hospcode: '41124' } as never);

describe('TAX-08 ปฏิเสธปีที่อยู่นอกช่วงที่สมเหตุสมผล', () => {
  const rejected: [string, number][] = [
    ['0 ซึ่งเดิมกลายเป็นปี 2500 และทำให้เกิด TAX-12', 0],
    ['2500 ใส่เต็ม', 2500],
    ['99 ซึ่งเดิมกลายเป็นปี 2599', 99],
    ['2599 ปีทดสอบที่เคยค้างในระบบจริง', 2599],
    ['2400 ขอบล่างเดิม', 2400],
    ['2700 ขอบบนเดิม', 2700],
    ['ปีถัดไปอีก 2 ปี', currentYearBe + 2],
    ['ย้อนหลัง 21 ปี', currentYearBe - 21]
  ];

  for (const [label, yearBe] of rejected) {
    test(`${label} ต้องถูกปฏิเสธ`, async () => {
      const result: any = await create(yearBe);
      assert.equal(result.ok, false, `ปี ${yearBe} ไม่ควรผ่าน`);
      assert.equal(result.error, 'INVALID_YEAR_BE');
    });
  }
});

describe('TAX-08 ยังรับปีที่ใช้งานจริงได้ตามเดิม', () => {
  const accepted: [string, number][] = [
    ['ปีปัจจุบัน', currentYearBe],
    ['ปีที่แล้ว', currentYearBe - 1],
    ['ล่วงหน้า 1 ปี เผื่อออกใบต้นปี', currentYearBe + 1],
    ['ย้อนหลัง 20 ปี ขอบล่างใหม่', currentYearBe - 20],
    ['พิมพ์ย่อสองหลัก 68', 68],
    ['พิมพ์ย่อสองหลัก 66 ซึ่งเพิ่งนำเข้าจริง', 66]
  ];

  for (const [label, yearBe] of accepted) {
    test(`${label} ต้องผ่านด่านปี`, async () => {
      const result: any = await create(yearBe);
      // ผ่านด่านปีแล้วจะไปตกที่ด่านหน่วยงานแทน ไม่ใช่ INVALID_YEAR_BE
      assert.notEqual(result.error, 'INVALID_YEAR_BE', `ปี ${yearBe} ควรผ่านด่านปี`);
    });
  }

  test('ค่าที่ไม่ใช่จำนวนเต็มต้องถูกปฏิเสธ', async () => {
    for (const bad of [2568.5, NaN, Infinity]) {
      const result: any = await create(bad as number);
      assert.equal(result.error, 'INVALID_YEAR_BE', `${bad} ควรถูกปฏิเสธ`);
    }
  });
});
