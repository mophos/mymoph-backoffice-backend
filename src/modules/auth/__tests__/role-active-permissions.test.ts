import test, { describe } from 'node:test';
import assert from 'node:assert/strict';
import { AuthModel } from '../auth.model';

/**
 * AUTH-02 — ปิด role แล้วสิทธิ์ของ role นั้นต้องหายไปด้วย
 *
 * เดิม getPermissionCodes ไม่ได้ join ตาราง roles เลย จึงเช็ก r.is_active ไม่ได้
 * ผู้ดูแลที่ปิด role เพื่อถอนสิทธิ์จะพบว่าผู้ใช้เสียแค่ชื่อ role
 * แต่สิทธิ์ทั้งหมดยังติดตัวอยู่ ซึ่งตรงข้ามกับที่ตั้งใจ
 */

interface Recorded { joins: string[]; wheres: [string, unknown][] }

/** knex จำลองแบบ chain ได้ บันทึกว่า join อะไรและกรองด้วยอะไรบ้าง */
function recordingDb(recorded: Recorded) {
  const builder: any = {
    innerJoin: (table: string) => { recorded.joins.push(table); return builder; },
    where: (col: unknown, val?: unknown) => {
      if (typeof col === 'string') recorded.wheres.push([col, val]);
      return builder;
    },
    distinct: () => Promise.resolve([{ code: 'payroll.read' }]),
    select: () => Promise.resolve([{ code: 'finance_admin' }])
  };
  const db: any = () => builder;
  return db;
}

describe('AUTH-02 สิทธิ์ต้องผูกกับ role ที่ยังเปิดอยู่เท่านั้น', () => {
  test('getPermissionCodes ต้อง join roles และกรอง r.is_active', async () => {
    const recorded: Recorded = { joins: [], wheres: [] };
    await new AuthModel(recordingDb(recorded) as never).getPermissionCodes('user-1');

    assert.ok(
      recorded.joins.some((table) => table.startsWith('roles as r')),
      'ต้อง join ตาราง roles ไม่งั้นเช็กสถานะของ role ไม่ได้เลย'
    );
    assert.ok(
      recorded.wheres.some(([col, val]) => col === 'r.is_active' && val === 1),
      'ต้องกรอง r.is_active = 1'
    );
  });

  test('ยังกรองชั้นอื่นครบเหมือนเดิม ไม่ได้ทำของเดิมหาย', async () => {
    const recorded: Recorded = { joins: [], wheres: [] };
    await new AuthModel(recordingDb(recorded) as never).getPermissionCodes('user-1');

    for (const col of ['ur.is_active', 'rp.is_active', 'p.is_active']) {
      assert.ok(
        recorded.wheres.some(([c, v]) => c === col && v === 1),
        `ต้องยังกรอง ${col} = 1`
      );
    }
  });

  test('getRoleCodes กรอง r.is_active อยู่แล้ว ใช้เป็นตัวเทียบ', async () => {
    const recorded: Recorded = { joins: [], wheres: [] };
    await new AuthModel(recordingDb(recorded) as never).getRoleCodes('user-1');

    assert.ok(recorded.wheres.some(([c, v]) => c === 'r.is_active' && v === 1));
  });
});
