import test, { describe } from 'node:test';
import assert from 'node:assert/strict';
import { TaxService } from '../tax.service';
import type { AuthContext } from '../../../shared/types/auth';

/**
 * เทสต์การค้นไฟล์ข้ามปี
 *
 * เส้นนี้ค้นได้ทั้งตารางจึงเป็นจุดที่ขอบเขตหลุดได้ง่ายที่สุดในโมดูล
 * สองเรื่องที่ต้องคุมคือ
 *   1. บัญชี scope LIST ต้องถูกกรองด้วย hospcodes ของตัวเองเสมอ
 *   2. ส่ง hospcode ที่อยู่นอกขอบเขตมาเป็นตัวกรอง ต้องถูกปฏิเสธก่อนถึง query
 */

interface Captured {
  scopeType: 'ALL' | 'LIST' | null;
  hospcodes: string[] | null;
  hospcode: string | undefined;
  yearBe: number | undefined;
  search: string | undefined;
  called: boolean;
}

function makeService(captured: Captured) {
  const model = {
    searchDocuments: async (input: {
      scopeType: 'ALL' | 'LIST';
      hospcodes: string[];
      hospcode?: string;
      yearBe?: number;
      search?: string;
    }) => {
      captured.called = true;
      captured.scopeType = input.scopeType;
      captured.hospcodes = input.hospcodes;
      captured.hospcode = input.hospcode;
      captured.yearBe = input.yearBe;
      captured.search = input.search;
      return { total: 0, rows: [] };
    }
  };
  return new TaxService(model as never);
}

const fresh = (): Captured => ({
  scopeType: null,
  hospcodes: null,
  hospcode: undefined,
  yearBe: undefined,
  search: undefined,
  called: false
});

const auth = (scopeType: 'ALL' | 'LIST', hospcodes: string[]): AuthContext => ({
  userId: 'a',
  cid: '9999999999999',
  roles: [],
  permissions: [] as unknown as AuthContext['permissions'],
  hospcodes,
  scopeType
});

const query = { page: 1, pageSize: 10, offset: 0 };

describe('ค้นไฟล์ข้ามปี — ขอบเขตหน่วยงาน', () => {
  test('scope LIST ต้องส่ง hospcodes ของตัวเองลงไปกรอง', async () => {
    const captured = fresh();
    const service = makeService(captured);

    const result = await service.searchDocuments(auth('LIST', ['41124']), {
      ...query,
      search: '1234567890123'
    });

    assert.equal(result.ok, true);
    assert.equal(captured.scopeType, 'LIST');
    assert.deepEqual(captured.hospcodes, ['41124']);
  });

  test('scope ALL ไม่ถูกกรองหน่วยงาน', async () => {
    const captured = fresh();
    const service = makeService(captured);

    await service.searchDocuments(auth('ALL', []), { ...query, search: 'abc' });

    assert.equal(captured.scopeType, 'ALL');
  });

  test('ส่ง hospcode นอกขอบเขตมาเป็นตัวกรอง ต้องถูกปฏิเสธและไม่แตะฐาน', async () => {
    const captured = fresh();
    const service = makeService(captured);

    const result = await service.searchDocuments(auth('LIST', ['41124']), {
      ...query,
      hospcode: '10695'
    });

    if (result.ok) throw new Error('ควรถูกปฏิเสธ แต่ผ่าน');
    assert.equal(result.error, 'SCOPE_FORBIDDEN');
    assert.equal(captured.called, false, 'ต้องไม่เรียก model เลย');
  });

  test('ส่ง hospcode ที่อยู่ในขอบเขต ผ่านได้และถูกใช้เป็นตัวกรอง', async () => {
    const captured = fresh();
    const service = makeService(captured);

    const result = await service.searchDocuments(auth('LIST', ['41124', '10695']), {
      ...query,
      hospcode: '10695'
    });

    assert.equal(result.ok, true);
    assert.equal(captured.hospcode, '10695');
  });

  test('scope ALL กรอง hospcode ไหนก็ได้', async () => {
    const captured = fresh();
    const service = makeService(captured);

    const result = await service.searchDocuments(auth('ALL', []), { ...query, hospcode: '99999' });

    assert.equal(result.ok, true);
    assert.equal(captured.hospcode, '99999');
  });

  test('ตัวกรองปีถูกส่งต่อตามที่รับมา', async () => {
    const captured = fresh();
    const service = makeService(captured);

    await service.searchDocuments(auth('LIST', ['41124']), { ...query, yearBe: 2568 });

    assert.equal(captured.yearBe, 2568);
  });

  test('ปีที่เอกสารบันทึกไว้ไม่ตรงกับแถวปี ต้องคืนทั้งสองค่าให้หน้าเว็บเตือนได้', async () => {
    // เคสจริง: ปี id=14 เป็น 2568 แต่เอกสาร 1,228 แถวบันทึก 2500 ไว้
    const model = {
      searchDocuments: async () => ({
        total: 1,
        rows: [
          {
            id: 'x',
            tax_year_id: 14,
            year_be: 2568,
            document_year_be: 2500,
            hospcode: '00003',
            cid: '1234567890123',
            file_no: 1,
            file_name: '00_1234567890123_1.pdf',
            original_file_name: null,
            source_type: 'batch',
            updated_at: null
          }
        ]
      })
    };
    const service = new TaxService(model as never);

    const result = await service.searchDocuments(auth('ALL', []), { ...query, yearBe: 2568 });

    if (!result.ok) throw new Error('ควรสำเร็จ');
    const row = result.data.rows[0];
    assert.equal(row.yearBe, 2568, 'ปีที่ใช้นำทางต้องเป็นของแถวปีภาษี');
    assert.equal(row.documentYearBe, 2500, 'ต้องคืนปีที่เอกสารบันทึกไว้ด้วย');
    assert.equal(row.yearShort, '68', 'yearShort ต้องอิงปีของแถวปีภาษี');
  });

  test('แถวที่คืนออกไปมีปีและหน่วยงานกำกับ ไม่งั้นดูไม่ออกว่ามาจากไหน', async () => {
    const model = {
      searchDocuments: async () => ({
        total: 1,
        rows: [
          {
            id: 'x',
            tax_year_id: 9,
            year_be: 2568,
            document_year_be: 2568,
            hospcode: '41124',
            cid: '1234567890123',
            file_no: 1,
            file_name: '68_1234567890123_1.pdf',
            original_file_name: null,
            source_type: 'batch',
            updated_at: null
          }
        ]
      })
    };
    const service = new TaxService(model as never);

    const result = await service.searchDocuments(auth('LIST', ['41124']), { ...query, search: 'x' });

    if (!result.ok) throw new Error('ควรสำเร็จ');
    const row = result.data.rows[0];
    assert.equal(row.yearBe, 2568);
    assert.equal(row.yearShort, '68');
    assert.equal(row.hospcode, '41124');
  });
});
