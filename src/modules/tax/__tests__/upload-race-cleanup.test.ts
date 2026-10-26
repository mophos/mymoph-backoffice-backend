import test, { describe, mock, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { promises as fs } from 'fs';
import { PDFDocument } from 'pdf-lib';
import { TaxService } from '../tax.service';
import type { AuthContext } from '../../../shared/types/auth';

/**
 * TAX-01 — อัปโหลดพร้อมกันแล้วชน UNIQUE (year_be, cid, file_no)
 *
 * สองคำขอของคนเดียวกันปีเดียวกันจะคำนวณ file_no ได้เท่ากัน เพราะต่างฝ่ายอ่าน max
 * ก่อนอีกฝ่าย insert จึงเขียนไฟล์ทับ path เดียวกัน ฝ่ายที่ insert ทีหลังจะชนคีย์
 *
 * เดิมฝ่ายที่แพ้จะลบไฟล์ทิ้งตอนเก็บกวาด ซึ่งเป็นไฟล์ที่แถวของฝ่ายที่ชนะชี้อยู่
 * ผลคือแถวที่ไฟล์หาย และผู้ใช้ฝ่ายที่แพ้ได้ 500 ที่ไม่บอกอะไร
 */

const auth: AuthContext = {
  userId: 'actor-1', cid: '9999999999999',
  roles: ['super_admin'],
  permissions: ['payroll.read', 'payroll.export'] as AuthContext['permissions'],
  hospcodes: [], scopeType: 'ALL'
};

function duplicateKeyError() {
  const error: any = new Error("Duplicate entry '2568-1111111111111-1' for key 'uq_tax_doc_yearbe_cid_file'");
  error.code = 'ER_DUP_ENTRY';
  error.errno = 1062;
  return error;
}

/** model จำลอง: insert ชนคีย์เสมอ และบอกว่า path ไหนมีแถวอื่นอ้างถึงแล้ว */
function makeService(referenced: string[], onInsert: () => never) {
  const model = {
    findYearById: async () => ({ id: 7, year_be: 2568, hospcode: '41124', is_active: 1 }),
    getMaxFileNoByYearBeAndCids: async () => new Map<string, number>(),
    insertDocuments: async () => onInsert(),
    findReferencedPaths: async () => new Set(referenced)
  };
  return new TaxService(model as never);
}

/** ต้องเป็น PDF หน้าเดียวจริง ไม่งั้นติดด่าน validateIndividualPdfPages ก่อนถึง insert */
async function singlePagePdf(): Promise<Buffer> {
  const pdf = await PDFDocument.create();
  pdf.addPage([200, 200]);
  return Buffer.from(await pdf.save());
}

const oneItem = async () => [{
  cid: '1111111111111',
  buffer: await singlePagePdf(),
  originalName: 'a.pdf'
}];

let unlinked: string[] = [];
function stubFs() {
  unlinked = [];
  mock.method(fs, 'mkdir', async () => undefined);
  mock.method(fs, 'writeFile', async () => undefined);
  mock.method(fs, 'unlink', async (target: string) => { unlinked.push(String(target)); });
}

afterEach(() => mock.restoreAll());

describe('TAX-01 เก็บกวาดหลังชนคีย์ต้องไม่ลบไฟล์ของคำขออื่น', () => {
  test('ถ้ามีแถวอื่นอ้างถึง path นั้นแล้ว ต้องไม่ลบไฟล์', async () => {
    stubFs();
    const path = '68/41124/68_1111111111111_1.pdf';
    const service = makeService([path], () => { throw duplicateKeyError(); });

    const result: any = await service.uploadIndividual(auth, 7, (await oneItem()) as never);

    assert.equal(result.ok, false);
    assert.deepEqual(unlinked, [], 'ห้ามลบไฟล์ที่แถวของคำขออื่นชี้อยู่');
  });

  test('ถ้าไม่มีแถวใดอ้างถึง ต้องเก็บกวาดตามปกติ', async () => {
    stubFs();
    const service = makeService([], () => { throw duplicateKeyError(); });

    const result: any = await service.uploadIndividual(auth, 7, (await oneItem()) as never);

    assert.equal(result.ok, false);
    assert.equal(unlinked.length, 1, 'ไฟล์ของตัวเองที่ไม่มีใครอ้างถึงต้องถูกลบ');
  });

  test('ถามฐานไม่ได้ ต้องไม่ลบอะไรเลย ปลอดภัยไว้ก่อน', async () => {
    stubFs();
    const model = {
      findYearById: async () => ({ id: 7, year_be: 2568, hospcode: '41124', is_active: 1 }),
      getMaxFileNoByYearBeAndCids: async () => new Map<string, number>(),
      insertDocuments: async () => { throw duplicateKeyError(); },
      findReferencedPaths: async () => { throw new Error('ฐานล่ม'); }
    };
    const service = new TaxService(model as never);

    const result: any = await service.uploadIndividual(auth, 7, (await oneItem()) as never);

    assert.equal(result.ok, false);
    assert.deepEqual(unlinked, [], 'ตรวจไม่ได้ก็ไม่ควรเดาแล้วลบ');
  });
});

describe('TAX-01 แปลงการชนคีย์เป็นคำตอบที่อ่านรู้เรื่อง', () => {
  test('ชน unique key ต้องได้ 409 ไม่ใช่ 500', async () => {
    stubFs();
    const service = makeService([], () => { throw duplicateKeyError(); });

    const result: any = await service.uploadIndividual(auth, 7, (await oneItem()) as never);

    assert.equal(result.ok, false);
    assert.equal(result.status, 409);
    assert.equal(result.error, 'TAX_DOCUMENT_ALREADY_EXISTS');
  });

  test('error อื่นต้องยังโยนออกไปตามเดิม ไม่กลบเป็น 409', async () => {
    stubFs();
    const service = makeService([], () => { throw new Error('ดิสก์เต็ม'); });

    await assert.rejects(
      async () => service.uploadIndividual(auth, 7, (await oneItem()) as never),
      /ดิสก์เต็ม/
    );
  });
});
