import test, { describe } from 'node:test';
import assert from 'node:assert/strict';
import { PersonnelService } from '../personnel.service';
import type { AuthContext } from '../../../shared/types/auth';

/**
 * H-02 — รอบนี้เปิดเฉพาะเมนูใบรับรองภาษี บุคลากรยังปฏิเสธไว้ก่อน
 *
 * เทสต์นี้ไม่ได้ยืนยันว่า "ควรปฏิเสธตลอดไป" แต่ล็อกไว้ว่า **ยังไม่เปิด**
 * เพื่อให้รู้ตัวถ้ามีใครเปิดโดยไม่ตั้งใจ และเป็นจุดที่ต้องแก้เมื่อขยายขอบเขตรอบหน้า
 *
 * ถ้าวันหนึ่งตัดสินใจเปิดเมนูบุคลากรด้วย ให้ลบเทสต์นี้พร้อมกับแก้โค้ด
 */

const auth: AuthContext = {
  userId: 'a', cid: '9999999999999',
  roles: ['hr'],
  permissions: ['personnel.manage'] as AuthContext['permissions'],
  hospcodes: ['CA0002583'], scopeType: 'LIST'
};

function makeService() {
  const model = {
    resolveOfficeCodes: async (codes: string[]) =>
      new Map(codes.map((c) => [c, { code5: null, hcode9: 'CA0002583' }])),
    findByCid: async () => undefined,
    create: async () => 'new-id'
  };
  return new PersonnelService(model as never);
}

describe('H-02 เมนูบุคลากรยังไม่เปิดให้หน่วยงานที่มีแต่ hcode9', () => {
  test('เพิ่มบุคลากรรายคนยังถูกปฏิเสธด้วย OFFICE_WITHOUT_CODE5', async () => {
    const result: any = await makeService().create(auth, {
      cid: '1111111111111',
      firstName: 'ทดสอบ',
      lastName: 'ระบบ',
      hospcode: 'CA0002583'
    } as never);

    assert.equal(result.ok, false);
    assert.equal(
      result.error,
      'OFFICE_WITHOUT_CODE5',
      'ถ้าข้อนี้ล้ม แปลว่ามีคนเปิดเมนูบุคลากรแล้ว ให้ตรวจว่าตั้งใจหรือไม่'
    );
  });
});
