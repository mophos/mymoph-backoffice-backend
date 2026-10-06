import test, { describe } from 'node:test';
import assert from 'node:assert/strict';
import { TaxService } from '../tax.service';
import type { AuthContext } from '../../../shared/types/auth';

/**
 * ขอบเขตของโมดูลใบรับรองภาษี (ตัดสินใจ 5 ตุลาคม 2569)
 *
 * **ฝ่ายการเงินส่วนกลางอ่านได้ทุกหน่วยงาน** — `finance_admin.manage` + `super_admin_affairs`
 * **คนที่มีสิทธิ์แค่หน้าใบรับรองภาษี อ่านได้แค่หน่วยงานตัวเอง**
 *
 * แต่ "เห็นได้" ไม่เท่ากับ "แก้ได้" การสร้าง ลบ และอัปโหลด ยังจำกัดที่หน่วยงาน
 * ของตัวเองเสมอสำหรับทุกคนที่ scopeType เป็น LIST รวมถึงฝ่ายการเงิน
 *
 * เงื่อนไขต้องตรงกับเมนู /finance-user-admin ซึ่งใช้ finance_admin.manage
 * + requiredRoles ['super_admin_affairs'] เหมือนกัน
 */

const OWN = '41124';
const OTHER = '10695';

/** ฝ่ายการเงินส่วนกลาง ขอบเขตที่ได้รับมอบคือ 41124 เท่านั้น */
const financeAdmin: AuthContext = {
  userId: 'f',
  cid: '9999999999999',
  roles: ['super_admin_affairs'],
  permissions: ['payroll.read', 'payroll.export', 'finance_admin.manage'] as unknown as AuthContext['permissions'],
  hospcodes: [OWN],
  scopeType: 'LIST'
};

/** มีสิทธิ์แค่หน้าใบรับรองภาษี */
const taxOnly: AuthContext = {
  userId: 't',
  cid: '8888888888888',
  roles: ['hr'],
  permissions: ['payroll.read', 'payroll.export'] as unknown as AuthContext['permissions'],
  hospcodes: [OWN],
  scopeType: 'LIST'
};

/** มี permission แต่ไม่มีบทบาท — ต้องไม่ได้สิทธิ์อ่านข้ามหน่วยงาน */
const financePermOnly: AuthContext = {
  ...financeAdmin,
  roles: ['hr']
};

const query = { page: 1, pageSize: 10, offset: 0 };

function modelFor(yearHospcode: string, captured: { scopeType?: string } = {}) {
  return {
    listYears: async (input: { scopeType: string }) => {
      captured.scopeType = input.scopeType;
      return [];
    },
    findYearById: async (id: number) => ({ id, year_be: 2568, hospcode: yearHospcode, is_active: 1 }),
    listDocuments: async (input: { scopeType: string }) => {
      captured.scopeType = input.scopeType;
      return { total: 0, rows: [] };
    },
    searchDocuments: async (input: { scopeType: string }) => {
      captured.scopeType = input.scopeType;
      return { total: 0, rows: [] };
    },
    findDocumentByIdWithYear: async () => ({
      id: '6f1e5b4a-0000-4000-8000-000000000000',
      tax_year_id: 9,
      hospcode: yearHospcode,
      cid: '1234567890123',
      file_no: 1,
      file_name: 'x.pdf',
      original_file_name: null,
      relative_path: '68/x/x.pdf',
      source_type: 'batch',
      year_be: 2568,
      is_active: 1,
      year_active: 1
    }),
    hardDeleteDocumentWithLog: async () => undefined,
    hardDeleteYearDocumentsAndDeactivateYear: async () => []
  };
}

describe('ฝ่ายการเงินส่วนกลางอ่านข้ามหน่วยงานได้', () => {
  test('ตารางปี: ฝ่ายการเงินได้ขอบเขตแบบ ALL', async () => {
    const captured: { scopeType?: string } = {};
    const service = new TaxService(modelFor(OWN, captured) as never);

    await service.listYears(financeAdmin);

    assert.equal(captured.scopeType, 'ALL');
  });

  test('ตารางปี: คนที่มีสิทธิ์แค่หน้าภาษีได้ LIST', async () => {
    const captured: { scopeType?: string } = {};
    const service = new TaxService(modelFor(OWN, captured) as never);

    await service.listYears(taxOnly);

    assert.equal(captured.scopeType, 'LIST');
  });

  test('ไฟล์ในปี: ฝ่ายการเงินเปิดปีของหน่วยงานอื่นได้', async () => {
    const captured: { scopeType?: string } = {};
    const service = new TaxService(modelFor(OTHER, captured) as never);

    const result = await service.listDocuments(financeAdmin, 9, query);

    assert.equal(result.ok, true);
    assert.equal(captured.scopeType, 'ALL');
  });

  test('ไฟล์ในปี: คนที่มีสิทธิ์แค่หน้าภาษีเปิดปีของหน่วยงานอื่นไม่ได้', async () => {
    const service = new TaxService(modelFor(OTHER) as never);

    const result = await service.listDocuments(taxOnly, 9, query);

    assert.equal(result.ok, false);
    assert.equal((result as { error?: string }).error, 'SCOPE_FORBIDDEN');
  });

  test('ค้นหาไฟล์: ฝ่ายการเงินกรองหน่วยงานอื่นได้', async () => {
    const captured: { scopeType?: string } = {};
    const service = new TaxService(modelFor(OWN, captured) as never);

    const result = await service.searchDocuments(financeAdmin, { ...query, hospcode: OTHER });

    assert.equal(result.ok, true);
    assert.equal(captured.scopeType, 'ALL');
  });

  test('ค้นหาไฟล์: คนที่มีสิทธิ์แค่หน้าภาษีกรองหน่วยงานอื่นไม่ได้', async () => {
    const service = new TaxService(modelFor(OWN) as never);

    const result = await service.searchDocuments(taxOnly, { ...query, hospcode: OTHER });

    if (result.ok) throw new Error('ควรถูกปฏิเสธ');
    assert.equal(result.error, 'SCOPE_FORBIDDEN');
  });

  test('เปิดไฟล์: ฝ่ายการเงินเปิดไฟล์ของหน่วยงานอื่นได้ (ไม่นับว่าหาไฟล์บนดิสก์เจอ)', async () => {
    const service = new TaxService(modelFor(OTHER) as never);

    const result = await service.getDownloadPayload(financeAdmin, '6f1e5b4a-0000-4000-8000-000000000000');

    // ไฟล์จริงไม่มีบนดิสก์ในเทสต์ จึงต้องไม่ใช่ SCOPE_FORBIDDEN เท่านั้น
    assert.notEqual((result as { error?: string }).error, 'SCOPE_FORBIDDEN');
  });

  test('มี finance_admin.manage แต่ไม่มีบทบาท super_admin_affairs ต้องไม่ได้สิทธิ์อ่านข้าม', async () => {
    const captured: { scopeType?: string } = {};
    const service = new TaxService(modelFor(OWN, captured) as never);

    await service.listYears(financePermOnly);

    assert.equal(captured.scopeType, 'LIST');
  });
});

describe('เห็นได้ไม่เท่ากับแก้ได้ — เส้นเขียนยังจำกัดหน่วยงานตัวเอง', () => {
  test('ลบปีภาษีของหน่วยงานอื่น ฝ่ายการเงินก็ทำไม่ได้', async () => {
    const service = new TaxService(modelFor(OTHER) as never);

    const result = await service.deleteYear(financeAdmin, 9);

    assert.equal(result.ok, false);
    assert.equal((result as { error?: string }).error, 'SCOPE_FORBIDDEN');
  });

  test('ลบไฟล์ของหน่วยงานอื่น ฝ่ายการเงินก็ทำไม่ได้', async () => {
    const service = new TaxService(modelFor(OTHER) as never);

    const result = await service.deleteDocument(financeAdmin, '6f1e5b4a-0000-4000-8000-000000000000');

    assert.equal(result.ok, false);
    assert.equal((result as { error?: string }).error, 'SCOPE_FORBIDDEN');
  });

  test('อัปโหลดเข้าปีของหน่วยงานอื่น ฝ่ายการเงินก็ทำไม่ได้', async () => {
    const service = new TaxService(modelFor(OTHER) as never);

    const result = await service.uploadIndividual(financeAdmin, 9, [
      { cid: '1234567890123', buffer: Buffer.from(''), originalName: 'a.pdf' } as never
    ]);

    assert.equal(result.ok, false);
    assert.equal((result as { error?: string }).error, 'SCOPE_FORBIDDEN');
  });

  test('ลบปีของหน่วยงานตัวเอง ยังทำได้ปกติ', async () => {
    const service = new TaxService(modelFor(OWN) as never);

    const result = await service.deleteYear(financeAdmin, 9);

    assert.equal(result.ok, true);
  });

  test('ลบไฟล์ของหน่วยงานตัวเอง ยังทำได้ปกติ', async () => {
    const service = new TaxService(modelFor(OWN) as never);

    const result = await service.deleteDocument(financeAdmin, '6f1e5b4a-0000-4000-8000-000000000000');

    assert.equal(result.ok, true);
  });
});
