import test, { describe } from 'node:test';
import assert from 'node:assert/strict';
import { UserRoleManagementModel, type OfficeCode } from '../user-role-management.model';

/**
 * H-01 — `replaceUserScopes` ต้องเขียนแถวด้วย "รหัสอ้างอิง"
 *
 * เดิมมี `if (!code5) continue;` ที่ข้ามหน่วยงานซึ่งไม่มี code5 **แบบเงียบ ๆ**
 * ระบบจะตอบว่าบันทึกสำเร็จทั้งที่ไม่มีแถวเกิดขึ้นจริง ซึ่งแย่กว่าการปฏิเสธตรง ๆ
 *
 * เทสต์นี้จับที่จำนวนแถวที่ถูก insert จริง ไม่ใช่แค่ดูว่าไม่มี error
 */

interface Captured { rows: any[] | null }

/** knex จำลองที่พอให้ replaceUserScopes เดินจนจบ และเก็บแถวที่ insert ไว้ตรวจ */
function fakeDb(captured: Captured) {
  const builder = () => {
    const b: any = {
      where: () => b,
      update: async () => 1,
      insert: (rows: any[]) => { captured.rows = rows; return b; },
      onConflict: () => b,
      merge: async () => 1,
      first: async () => undefined,
      select: async () => []
    };
    return b;
  };

  const trx: any = (_table: string) => builder();
  trx.fn = { now: () => 'NOW()' };
  trx.raw = (sql: string) => sql;

  const db: any = (table: string) => {
    // getScopeMeta อ่าน information_schema เพื่อดูว่ามีคอลัมน์ hospcode9 ไหม
    // ตอบว่ามี ให้ตรงกับ production หลัง D-14
    if (table === 'information_schema.columns') {
      const q: any = {
        select: () => q,
        where: () => q,
        andWhere: () => q,
        then: (resolve: (rows: any[]) => unknown) =>
          Promise.resolve([{ name: 'hospcode' }, { name: 'hospcode9' }]).then(resolve)
      };
      return q;
    }
    return builder();
  };
  db.transaction = async (fn: (t: any) => Promise<void>) => fn(trx);
  db.fn = trx.fn;
  db.raw = trx.raw;
  db.client = { database: () => 'mymoph_admin' };
  return db;
}

async function writeScopes(offices: OfficeCode[]) {
  const captured: Captured = { rows: null };
  const model = new UserRoleManagementModel(fakeDb(captured) as never);
  await model.replaceUserScopes({ userId: 'u1', offices, updatedBy: 'actor' });
  return captured.rows ?? [];
}

describe('H-01 บันทึกขอบเขตด้วยรหัสอ้างอิง', () => {
  test('หน่วยงานมี code5 ต้องเก็บ code5 เหมือนเดิม', async () => {
    const rows = await writeScopes([{ code5: '41124', hcode9: 'IA0041124' }]);

    assert.equal(rows.length, 1);
    assert.equal(rows[0].hospcode, '41124', 'ของเดิมต้องไม่เปลี่ยนพฤติกรรม');
    assert.equal(rows[0].hospcode9, 'IA0041124');
  });

  test('หน่วยงานไม่มี code5 ต้องเก็บ hcode9 ไม่ใช่ข้ามทิ้ง', async () => {
    const rows = await writeScopes([{ code5: null, hcode9: 'CA0002583' }]);

    assert.equal(rows.length, 1, 'ต้องมีแถวเกิดขึ้นจริง ไม่ใช่ตกหล่นเงียบ ๆ');
    assert.equal(rows[0].hospcode, 'CA0002583');
    assert.equal(rows[0].hospcode9, 'CA0002583');
  });

  test('ผสมทั้งสองแบบ ต้องได้ครบทุกแถว', async () => {
    const rows = await writeScopes([
      { code5: '41124', hcode9: 'IA0041124' },
      { code5: null, hcode9: 'CA0002583' },
      { code5: '10670', hcode9: 'IA0010670' }
    ]);

    assert.equal(rows.length, 3, 'ห้ามมีแถวไหนหายไป');
    assert.deepEqual(rows.map((r) => r.hospcode).sort(), ['10670', '41124', 'CA0002583'].sort());
  });

  test('code5 เป็นช่องว่างให้ถือว่าไม่มี แล้วใช้ hcode9 แทน', async () => {
    const rows = await writeScopes([{ code5: '   ', hcode9: 'CA0002583' }]);

    assert.equal(rows.length, 1);
    assert.equal(rows[0].hospcode, 'CA0002583');
  });

  test('หน่วยงานซ้ำในคำขอเดียว ต้องเหลือแถวเดียว', async () => {
    const rows = await writeScopes([
      { code5: null, hcode9: 'CA0002583' },
      { code5: null, hcode9: 'CA0002583' }
    ]);

    assert.equal(rows.length, 1);
  });
});
