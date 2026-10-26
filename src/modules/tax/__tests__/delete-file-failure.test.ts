import test, { describe, mock, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { promises as fs } from 'fs';
import { TaxService } from '../tax.service';
import type { AuthContext } from '../../../shared/types/auth';

/**
 * TAX-02 / TAX-16 — การลบไฟล์ล้มเหลวต้องไม่ทำให้คำขอล้มเหลว
 *
 * ทั้งสองจุดลบแถวในฐานก่อนแล้วค่อยลบไฟล์ ตอนที่ลบไฟล์ ฐาน commit ไปแล้ว
 * ถ้าปล่อยให้ error จากการลบไฟล์ลอยออกไป ผู้ใช้จะได้ 500 ทั้งที่ข้อมูลถูกลบจริง
 * และกรณีลบทั้งปี ไฟล์ที่เหลือในคิวจะไม่ถูกลบต่อ กลายเป็นไฟล์ค้าง
 */

const auth: AuthContext = {
  userId: 'actor-1',
  cid: '9999999999999',
  roles: ['super_admin'],
  permissions: ['payroll.read', 'payroll.export'] as AuthContext['permissions'],
  hospcodes: [],
  scopeType: 'ALL'
};

/** จำลอง unlink ที่ล้มเหลวเฉพาะ path ที่ระบุ ที่เหลือสำเร็จ */
function mockUnlink(failOn: (p: string) => boolean) {
  const attempted: string[] = [];
  mock.method(fs, 'unlink', async (target: string) => {
    attempted.push(String(target));
    if (failOn(String(target))) {
      const error: NodeJS.ErrnoException = new Error('permission denied');
      error.code = 'EACCES';
      throw error;
    }
  });
  return attempted;
}

function serviceForYearDelete(paths: string[], calls: { deleted: boolean }) {
  const model = {
    findYearById: async () => ({ id: 7, year_be: 2568, hospcode: '41124', is_active: 1 }),
    hardDeleteYearDocumentsAndDeactivateYear: async () => {
      calls.deleted = true;
      return paths;
    }
  };
  return new TaxService(model as never);
}

function serviceForDocumentDelete(relativePath: string, calls: { deleted: boolean }) {
  const model = {
    findDocumentByIdWithYear: async () => ({
      id: 'doc-1', tax_year_id: 7, year_be: 2568, hospcode: '41124',
      cid: '1111111111111', file_no: 1, file_name: '68_1111111111111_1.pdf',
      original_file_name: null, relative_path: relativePath,
      source_type: 'single', is_active: 1, year_active: 1
    }),
    hardDeleteDocumentWithLog: async () => { calls.deleted = true; }
  };
  return new TaxService(model as never);
}

afterEach(() => mock.restoreAll());

describe('TAX-16 ลบปีภาษีแล้วลบไฟล์ไม่สำเร็จ', () => {
  test('ยังต้องตอบสำเร็จ ไม่ใช่โยน error ออกไป', async () => {
    const calls = { deleted: false };
    mockUnlink(() => true);                       // ลบไม่ได้สักไฟล์
    const service = serviceForYearDelete(['68/41124/a.pdf', '68/41124/b.pdf'], calls);

    const result: any = await service.deleteYear(auth, 7);

    assert.equal(calls.deleted, true, 'ฐานต้องถูกลบไปแล้ว');
    assert.equal(result.ok, true, 'ต้องไม่ตอบล้มเหลวทั้งที่ฐานลบสำเร็จ');
    assert.equal(result.data.filesFailed, 2);
    assert.equal(result.data.filesRemoved, 0);
  });

  test('ไฟล์ที่เหลือในคิวต้องถูกลบต่อ ไม่หยุดที่ไฟล์แรกที่พัง', async () => {
    const calls = { deleted: false };
    const attempted = mockUnlink((p) => p.endsWith('b.pdf'));
    const service = serviceForYearDelete(
      ['68/41124/a.pdf', '68/41124/b.pdf', '68/41124/c.pdf'],
      calls
    );

    const result: any = await service.deleteYear(auth, 7);

    assert.equal(attempted.length, 3, 'ต้องพยายามลบครบทุกไฟล์');
    assert.equal(result.data.filesRemoved, 2);
    assert.equal(result.data.filesFailed, 1);
  });

  test('ไฟล์ที่ไม่มีอยู่แล้วนับเป็นสำเร็จ', async () => {
    const calls = { deleted: false };
    mock.method(fs, 'unlink', async () => {
      const error: NodeJS.ErrnoException = new Error('no such file');
      error.code = 'ENOENT';
      throw error;
    });
    const service = serviceForYearDelete(['68/41124/a.pdf'], calls);

    const result: any = await service.deleteYear(auth, 7);

    assert.equal(result.ok, true);
    assert.equal(result.data.filesFailed, 0);
    assert.equal(result.data.filesRemoved, 1);
  });

  test('path ว่างต้องถูกข้าม ไม่พยายามลบ', async () => {
    const calls = { deleted: false };
    const attempted = mockUnlink(() => false);
    const service = serviceForYearDelete(['', '68/41124/a.pdf', ''], calls);

    const result: any = await service.deleteYear(auth, 7);

    assert.equal(attempted.length, 1, 'ต้องพยายามลบเฉพาะ path ที่มีค่า');
    assert.equal(result.data.filesRemoved, 1);
  });
});

describe('TAX-02 ลบเอกสารเดี่ยวแล้วลบไฟล์ไม่สำเร็จ', () => {
  test('ยังต้องตอบสำเร็จ และบอกว่าไฟล์ลบไม่ได้', async () => {
    const calls = { deleted: false };
    mockUnlink(() => true);
    const service = serviceForDocumentDelete('68/41124/68_1111111111111_1.pdf', calls);

    const result: any = await service.deleteDocument(auth, 'doc-1');

    assert.equal(calls.deleted, true, 'ฐานต้องถูกลบไปแล้ว');
    assert.equal(result.ok, true, 'ต้องไม่ตอบล้มเหลวทั้งที่ฐานลบสำเร็จ');
    assert.equal(result.data.fileRemoved, false);
  });

  test('ลบไฟล์สำเร็จต้องรายงานว่าสำเร็จ', async () => {
    const calls = { deleted: false };
    mockUnlink(() => false);
    const service = serviceForDocumentDelete('68/41124/68_1111111111111_1.pdf', calls);

    const result: any = await service.deleteDocument(auth, 'doc-1');

    assert.equal(result.ok, true);
    assert.equal(result.data.fileRemoved, true);
  });
});
